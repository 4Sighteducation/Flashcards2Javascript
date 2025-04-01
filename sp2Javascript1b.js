import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from './UserContext';

// Create the context
const StudyPlanContext = createContext();

export const StudyPlanProvider = ({ children }) => {
  const { user, isAuthenticated } = useUser();
  
  // Main state for the study plan
  const [studyPlan, setStudyPlan] = useState({
    weekStart: null,
    quote: '',
    courseTypes: [],
    sessions: {}, // Organized by date string
    sharing: {
      sharedWith: [],
      feedback: []
    },
    history: {} // Previous weeks
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(null);

  // Load study plan data when user is authenticated and has a recordId
  useEffect(() => {
    if (isAuthenticated && user?.recordId) {
      console.log("User authenticated with recordId, loading study plan data:", user.recordId);
      loadStudyPlanData();
    } else if (isAuthenticated && !user?.recordId) {
      console.log("User authenticated but missing recordId, waiting for recordId");
    }
  }, [isAuthenticated, user?.recordId]); // Specifically depend on recordId

  // Setup message listener for data from Knack
  useEffect(() => {
    const handleMessage = (event) => {
      // In production, verify event origin
      if (!event.data || !event.data.type) return;
      
      console.log("StudyPlan received message:", event.data.type);
      
      // Handle different message types from Knack
      if (event.data.type === 'KNACK_DATA') {
        try {
          // Process data from Knack
          console.log("Received study plan data from Knack:", event.data);
          
          const planData = event.data.studyPlan || {};
          
          // Check if we got a valid data structure
          if (typeof planData === 'object') {
            setStudyPlan(prev => ({
              ...prev,
              ...planData,
              // Provide default empty objects for essential properties
              weekStart: planData.weekStart || prev.weekStart || null,
              quote: planData.quote || prev.quote || '',
              courseTypes: planData.courseTypes || prev.courseTypes || [],
              sessions: planData.sessions || prev.sessions || {},
              sharing: planData.sharing || prev.sharing || { sharedWith: [], feedback: [] },
              history: planData.history || prev.history || {}
            }));
          } else {
            console.warn("Received invalid planData format:", planData);
          }
          setIsLoading(false);
        } catch (err) {
          console.error('Error processing study plan data:', err);
          setError('Error loading study plan data');
          setIsLoading(false);
        }
      } else if (event.data.type === 'SAVE_RESULT') {
        // Handle save result
        setIsSaving(false);
        if (event.data.success) {
          setSaveSuccess(true);
          // Clear success message after 3 seconds
          setTimeout(() => setSaveSuccess(null), 3000);
        } else {
          setSaveSuccess(false);
          setError(event.data.error || 'Error saving data');
          // Clear error message after 5 seconds
          setTimeout(() => {
            setSaveSuccess(null);
            setError(null);
          }, 5000);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  // Request study plan data from Knack
  const loadStudyPlanData = useCallback(() => {
    if (!user?.recordId) {
      console.error('No record ID available to load data:', user);
      setError('No record ID available to load data');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log("Requesting updated data with recordId:", user.recordId);
      
      // Format data for both new and old integration script compatibility
      const messageData = {
        type: 'REQUEST_UPDATED_DATA',
        recordId: user.recordId,
        data: {
          recordId: user.recordId  // Include recordId both at top level and in data property
        }
      };
      
      // Request data from parent Knack window
      window.parent.postMessage(messageData, '*');
    } catch (err) {
      console.error('Error requesting study plan data:', err);
      setError('Failed to request study plan data');
      setIsLoading(false);
    }
  }, [user?.recordId]); // Explicitly depend on recordId

  // Save study plan data to Knack
  const saveStudyPlanData = useCallback(() => {
    if (!user?.recordId) {
      setError('No record ID available to save data');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Send data to parent Knack window
      window.parent.postMessage({
        type: 'SAVE_DATA',
        recordId: user.recordId,
        studyPlan: studyPlan,
        preserveFields: true // Ensure other fields are preserved
      }, '*');
    } catch (err) {
      console.error('Error saving study plan data:', err);
      setError('Failed to save study plan data');
      setIsSaving(false);
    }
  }, [user, studyPlan]);

  // Add a new session
  const addSession = useCallback((day, sessionData) => {
    const dayKey = day.toDateString();
    const newSessionId = `session_${Date.now()}`;
    
    setStudyPlan(prev => {
      const daySessions = prev.sessions[dayKey] ? [...prev.sessions[dayKey]] : [];
      
      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [dayKey]: [
            ...daySessions,
            {
              id: newSessionId,
              ...sessionData
            }
          ]
        }
      };
    });
    
    return newSessionId;
  }, []);

  // Update an existing session
  const updateSession = useCallback((day, sessionId, sessionData) => {
    const dayKey = day.toDateString();
    
    setStudyPlan(prev => {
      const daySessions = prev.sessions[dayKey] || [];
      const updatedSessions = daySessions.map(session => 
        session.id === sessionId ? { ...session, ...sessionData } : session
      );
      
      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [dayKey]: updatedSessions
        }
      };
    });
  }, []);

  // Delete a session
  const deleteSession = useCallback((day, sessionId) => {
    const dayKey = day.toDateString();
    
    setStudyPlan(prev => {
      const daySessions = prev.sessions[dayKey] || [];
      const filteredSessions = daySessions.filter(session => session.id !== sessionId);
      
      return {
        ...prev,
        sessions: {
          ...prev.sessions,
          [dayKey]: filteredSessions
        }
      };
    });
  }, []);

  // Set week start date and initialize week data
  const setWeekStartDate = useCallback((date) => {
    setStudyPlan(prev => ({
      ...prev,
      weekStart: date.toISOString()
    }));
  }, []);

  // Set the quote for the week
  const setWeekQuote = useCallback((quote) => {
    setStudyPlan(prev => ({
      ...prev,
      quote
    }));
  }, []);

  // Set selected course types
  const setCourseTypes = useCallback((types) => {
    setStudyPlan(prev => ({
      ...prev,
      courseTypes: types
    }));
  }, []);

  // Share study plan with a teacher
  const shareWithTeacher = useCallback((teacherId) => {
    setStudyPlan(prev => {
      // Avoid duplicates
      if (prev.sharing.sharedWith.includes(teacherId)) {
        return prev;
      }
      
      return {
        ...prev,
        sharing: {
          ...prev.sharing,
          sharedWith: [...prev.sharing.sharedWith, teacherId]
        }
      };
    });
    
    // Save changes immediately when sharing
    saveStudyPlanData();
  }, [saveStudyPlanData]);

  // Remove sharing with a teacher
  const removeSharing = useCallback((teacherId) => {
    setStudyPlan(prev => ({
      ...prev,
      sharing: {
        ...prev.sharing,
        sharedWith: prev.sharing.sharedWith.filter(id => id !== teacherId)
      }
    }));
    
    // Save changes immediately when removing sharing
    saveStudyPlanData();
  }, [saveStudyPlanData]);

  // Add teacher feedback
  const addTeacherFeedback = useCallback((feedback) => {
    if (!user || user.role !== 'teacher') {
      setError('Only teachers can add feedback');
      return;
    }
    
    const newFeedback = {
      teacherId: user.id,
      teacherName: user.name,
      timestamp: new Date().toISOString(),
      text: feedback,
      isRead: false
    };
    
    setStudyPlan(prev => ({
      ...prev,
      sharing: {
        ...prev.sharing,
        feedback: [...(prev.sharing.feedback || []), newFeedback]
      }
    }));
    
    // Save changes immediately when adding feedback
    saveStudyPlanData();
  }, [user, saveStudyPlanData]);

  // Mark feedback as read
  const markFeedbackAsRead = useCallback((feedbackId) => {
    setStudyPlan(prev => ({
      ...prev,
      sharing: {
        ...prev.sharing,
        feedback: (prev.sharing.feedback || []).map(item => 
          item.id === feedbackId ? { ...item, isRead: true } : item
        )
      }
    }));
  }, []);

  // Archive current week to history
  const archiveCurrentWeek = useCallback(() => {
    if (!studyPlan.weekStart) return;
    
    setStudyPlan(prev => {
      const weekKey = new Date(prev.weekStart).toISOString().split('T')[0];
      
      return {
        ...prev,
        history: {
          ...prev.history,
          [weekKey]: {
            weekStart: prev.weekStart,
            quote: prev.quote,
            courseTypes: prev.courseTypes,
            sessions: prev.sessions,
            sharing: prev.sharing
          }
        },
        // Reset current week
        weekStart: null,
        quote: '',
        sessions: {},
        sharing: {
          sharedWith: prev.sharing.sharedWith, // Keep shared teachers
          feedback: []
        }
      };
    });
    
    // Save changes immediately when archiving
    saveStudyPlanData();
  }, [studyPlan.weekStart, saveStudyPlanData]);

  // Value object to be provided by context
  const value = {
    studyPlan,
    isLoading,
    error,
    isSaving,
    saveSuccess,
    loadStudyPlanData,
    saveStudyPlanData,
    addSession,
    updateSession,
    deleteSession,
    setWeekStartDate,
    setWeekQuote,
    setCourseTypes,
    shareWithTeacher,
    removeSharing,
    addTeacherFeedback,
    markFeedbackAsRead,
    archiveCurrentWeek
  };

  return <StudyPlanContext.Provider value={value}>{children}</StudyPlanContext.Provider>;
};

// Custom hook for using this context
export const useStudyPlan = () => {
  const context = useContext(StudyPlanContext);
  if (context === undefined) {
    throw new Error('useStudyPlan must be used within a StudyPlanProvider');
  }
  return context;
};

export default StudyPlanContext;
