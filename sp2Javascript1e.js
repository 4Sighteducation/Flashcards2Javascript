// StudyPlanner 2.0 - Knack Integration Script - v1.0
// This script must be added to Knack builder to enable communication between Knack and the embedded React app
(function() {
  // Configuration (to be set in Knack)
  if (!window.STUDYPLANNER_CONFIG) {
    console.error("StudyPlanner: Missing STUDYPLANNER_CONFIG. Please define configuration in Knack.");
    return;
  }

  // --- Constants and Configuration ---
  const knackAppId = window.STUDYPLANNER_CONFIG.knackAppId;
  const knackApiKey = window.STUDYPLANNER_CONFIG.knackApiKey;
  const KNACK_API_URL = 'https://api.knack.com/v1';
  const STUDYPLANNER_APP_CONFIG = window.STUDYPLANNER_CONFIG.appConfig || {
    'scene_1208': {
      'view_3008': {
        appType: 'study-planner',
        elementSelector: '.kn-rich-text',
        appUrl: window.STUDYPLANNER_CONFIG.appUrl || 'https://studyplanner2-fc98f9e231f4.herokuapp.com/'
      }
    }
  };
  const STUDYPLANNER_OBJECT = 'object_110'; // Study Plan object
  const FIELD_MAPPING = {
    userId: 'field_3040', // User ID
    userEmail: 'field_3041', // User Email
    userName: 'field_3039', // User Name
    planData: 'field_3042', // JSON Data field
    lastSaved: 'field_3043', // Last saved timestamp (to be added if not exists)
    teacherConnection: 'field_3044' // Teacher connection field (to be added if not exists)
  };

  // --- Helper Functions ---
  
  // Safe URI component decoding function
  function safeDecodeURIComponent(str) {
    if (!str) return str;
    if (typeof str === 'string' && !str.includes('%')) return str;
    try {
      return decodeURIComponent(str.replace(/\+/g, ' '));
    } catch (error) {
      console.error("StudyPlanner: Error decoding URI component:", error, "String:", String(str).substring(0, 100));
      try {
        const cleaned = String(str).replace(/%(?![0-9A-Fa-f]{2})/g, '%25');
        return decodeURIComponent(cleaned.replace(/\+/g, ' '));
      } catch (secondError) {
        console.error("StudyPlanner: Second attempt to decode failed:", secondError);
        return String(str);
      }
    }
  }

  // Safely encode URI component
  function safeEncodeURIComponent(str) {
    try {
      return encodeURIComponent(String(str));
    } catch (e) {
      console.error("Error encoding URI component:", e, "Input:", str);
      return String(str);
    }
  }

  // Safe JSON parsing function
  function safeParseJSON(jsonString, defaultVal = null) {
    if (!jsonString) return defaultVal;
    try {
      // If it's already an object, return it directly
      if (typeof jsonString === 'object' && jsonString !== null) return jsonString;
      return JSON.parse(jsonString);
    } catch (error) {
      console.warn("StudyPlanner: Initial JSON parse failed:", error, "String:", String(jsonString).substring(0, 100));
      try {
        const cleanedString = String(jsonString).trim().replace(/^\uFEFF/, '');
        const recovered = cleanedString
          .replace(/\\"/g, '"')
          .replace(/,\s*([}\]])/g, '$1');
        const result = JSON.parse(recovered);
        console.log("StudyPlanner: JSON recovery successful.");
        return result;
      } catch (secondError) {
        console.error("StudyPlanner: JSON recovery failed:", secondError);
        return defaultVal;
      }
    }
  }

  // Check if a string is a valid Knack record ID
  function isValidKnackId(id) {
    if (!id) return false;
    return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);
  }

  // Extract a valid record ID from various formats
  function extractValidRecordId(value) {
    if (!value) return null;

    // If it's already an object
    if (typeof value === 'object') {
      let idToCheck = null;
      if (value.id) {
        idToCheck = value.id;
      } else if (value.identifier) {
        idToCheck = value.identifier;
      } else if (Array.isArray(value) && value.length === 1 && value[0].id) {
        idToCheck = value[0].id;
      } else if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
        idToCheck = value[0];
      }

      if (idToCheck) {
        return isValidKnackId(idToCheck) ? idToCheck : null;
      }
    }

    // If it's a string
    if (typeof value === 'string') {
      return isValidKnackId(value) ? value : null;
    }

    return null;
  }

  // Safely remove HTML from strings
  function sanitizeField(value) {
    if (value === null || value === undefined) return "";
    const strValue = String(value);
    let sanitized = strValue.replace(/<[^>]*?>/g, "");
    sanitized = sanitized.replace(/[*_~`#]/g, "");
    sanitized = sanitized
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");
    return sanitized.trim();
  }

  // Debug logging helper
  function debugLog(title, data) {
    console.log(`%c[StudyPlanner] ${title}`, 'color: #5d00ff; font-weight: bold; font-size: 12px;');
    try {
      console.log(JSON.parse(JSON.stringify(data, null, 2)));
    } catch (e) {
      console.log("Data could not be fully serialized for logging:", data);
    }
    return data;
  }

  // Generic retry function for API calls
  function retryApiCall(apiCall, maxRetries = 3, delay = 1000) {
    return new Promise((resolve, reject) => {
      const attempt = (retryCount) => {
        apiCall()
          .then(resolve)
          .catch((error) => {
            const attemptsMade = retryCount + 1;
            console.warn(`API call failed (Attempt ${attemptsMade}/${maxRetries}):`, error.status, error.statusText, error.responseText);

            if (retryCount < maxRetries - 1) {
              const retryDelay = delay * Math.pow(2, retryCount);
              console.log(`Retrying API call in ${retryDelay}ms...`);
              setTimeout(() => attempt(retryCount + 1), retryDelay);
            } else {
              console.error(`API call failed after ${maxRetries} attempts.`);
              reject(error);
            }
          });
      };
      attempt(0);
    });
  }

  // Function to refresh authentication
  function refreshAuthentication() {
    return new Promise((resolve, reject) => {
      try {
        const currentToken = Knack.getUserToken();
        if (currentToken) {
          console.log(`Auth token available via Knack.getUserToken()`);
          resolve(currentToken);
        } else {
          console.error(`Cannot get auth token - Knack.getUserToken() returned null`);
          reject(new Error("Auth token not available"));
        }
      } catch (error) {
        console.error(`Error getting auth token:`, error);
        reject(error);
      }
    });
  }

  // Handle token refresh request from React app
  function handleTokenRefresh(iframeWindow) {
    console.log("Handling token refresh request from React app");
    try {
      const currentToken = Knack.getUserToken();
      if (!currentToken) {
        console.error("Cannot get token from Knack");
        if (iframeWindow) iframeWindow.postMessage({ type: "AUTH_REFRESH_RESULT", success: false, error: "Token not available from Knack" }, "*");
        return;
      }
      // Send the current token back
      if (iframeWindow) iframeWindow.postMessage({ type: "AUTH_REFRESH_RESULT", success: true, token: currentToken }, "*");
      console.log("Successfully sent current token for refresh");
    } catch (error) {
      console.error("Error refreshing token:", error);
      if (iframeWindow) iframeWindow.postMessage({ type: "AUTH_REFRESH_RESULT", success: false, error: error.message || "Unknown error refreshing token" }, "*");
    }
  }

  // --- Save Queue Class ---
  class SaveQueue {
    constructor() {
      this.queue = [];
      this.isSaving = false;
      this.retryAttempts = new Map();
      this.maxRetries = 3;
      this.retryDelay = 1000;
    }

    // Adds an operation to the queue
    addToQueue(operation) {
      return new Promise((resolve, reject) => {
        if (!operation.type || !operation.recordId) {
          console.error("[SaveQueue] Invalid operation added:", operation);
          return reject(new Error("Invalid save operation: missing type or recordId"));
        }

        const queuedOperation = {
          ...operation,
          resolve,
          reject,
          timestamp: new Date().toISOString()
        };
        this.queue.push(queuedOperation);
        console.log(`[SaveQueue] Added operation to queue: ${operation.type} for record ${operation.recordId}. Queue length: ${this.queue.length}`);
        this.processQueue();
      });
    }

    // Processes the next operation in the queue if not already saving
    async processQueue() {
      if (this.isSaving || this.queue.length === 0) {
        return;
      }

      this.isSaving = true;
      const operation = this.queue[0];
      console.log(`[SaveQueue] Processing operation: ${operation.type} for record ${operation.recordId}`);

      try {
        const updateData = await this.prepareSaveData(operation);
        debugLog("[SaveQueue] Prepared update data", updateData);
        const response = await this.performSave(updateData, operation.recordId);
        debugLog("[SaveQueue] API Save successful", response);
        this.handleSaveSuccess(operation);
      } catch (error) {
        console.error(`[SaveQueue] Error during processing for ${operation.type} (record ${operation.recordId}):`, error);
        this.handleSaveError(operation, error);
      }
    }

    // Prepares the data to save
    async prepareSaveData(operation) {
      const { type, data, recordId, preserveFields } = operation;
      console.log(`[SaveQueue] Preparing save data for type: ${type}, record: ${recordId}, preserveFields: ${preserveFields}`);

      // Start with the mandatory lastSaved field
      const updateData = {
        [FIELD_MAPPING.lastSaved]: new Date().toISOString()
      };

      try {
        // Fetch existing data ONLY if preserving fields
        let existingData = null;
        if (preserveFields) {
          console.log(`[SaveQueue] Preserving fields for ${type}, fetching existing data...`);
          try {
            existingData = await this.getExistingData(recordId);
            debugLog("[SaveQueue] Fetched existing data for preservation", existingData ? `Record ${recordId} found` : `Record ${recordId} NOT found`);
          } catch (fetchError) {
            console.error(`[SaveQueue] Failed to fetch existing data for field preservation (record ${recordId}):`, fetchError);
            console.warn("[SaveQueue] Proceeding with save WITHOUT field preservation due to fetch error.");
            existingData = null;
          }
        }

        // Add data based on operation type
        switch (type) {
          case 'studyPlan':
            updateData[FIELD_MAPPING.planData] = JSON.stringify(
              this.ensureSerializable(data || {})
            );
            console.log("[SaveQueue] Prepared studyPlan data for save.");
            break;
          default:
            console.error(`[SaveQueue] Unknown save operation type: ${type}`);
            throw new Error(`Unknown save operation type: ${type}`);
        }

        // If preserving fields and we successfully fetched existing data, merge
        if (preserveFields && existingData) {
          console.log(`[SaveQueue] Merging prepared data with existing data for record ${recordId}`);
          this.preserveExistingFields(updateData, existingData);
          debugLog("[SaveQueue] Merged data after preservation", updateData);
        } else if (preserveFields && !existingData) {
          console.warn(`[SaveQueue] Cannot preserve fields for record ${recordId} because existing data could not be fetched.`);
        }

        return updateData;
      } catch (error) {
        console.error(`[SaveQueue] Error in prepareSaveData for type ${type}:`, error);
        throw error;
      }
    }

    // Fetches current record data from Knack
    async getExistingData(recordId) {
      console.log(`[SaveQueue] Fetching existing data for record ${recordId}`);
      const apiCall = () => {
        return new Promise((resolve, reject) => {
          $.ajax({
            url: `${KNACK_API_URL}/objects/${STUDYPLANNER_OBJECT}/records/${recordId}`,
            type: 'GET',
            headers: this.getKnackHeaders(),
            data: { format: 'raw' },
            success: function(response) {
              console.log(`[SaveQueue] Successfully fetched existing data for record ${recordId}`);
              resolve(response);
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.error(`[SaveQueue] Error fetching existing data for record ${recordId}: Status ${jqXHR.status} - ${errorThrown}`, jqXHR.responseText);
              const error = new Error(`Failed to fetch record ${recordId}: ${jqXHR.status} ${errorThrown}`);
              error.status = jqXHR.status;
              error.responseText = jqXHR.responseText;
              reject(error);
            }
          });
        });
      };
      return retryApiCall(apiCall);
    }

    // Merges updateData with existingData, preserving specific fields
    preserveExistingFields(updateData, existingData) {
      console.log(`[SaveQueue] Preserving fields for record. Fields in updateData: ${Object.keys(updateData).join(', ')}`);
      // Define all fields managed by the app that could be preserved
      const allAppFieldIds = [
        FIELD_MAPPING.planData,
        FIELD_MAPPING.teacherConnection
      ];

      allAppFieldIds.forEach(fieldId => {
        if (updateData[fieldId] === undefined && existingData[fieldId] !== undefined && existingData[fieldId] !== null) {
          console.log(`[SaveQueue] Preserving existing data for field ID: ${fieldId}`);
          updateData[fieldId] = existingData[fieldId];
        }
      });
    }

    // Performs the actual Knack API PUT request
    async performSave(updateData, recordId) {
      console.log(`[SaveQueue] Performing API save for record ${recordId}`);
      if (!recordId) {
        throw new Error("Cannot perform save: recordId is missing.");
      }
      if (Object.keys(updateData).length <= 1 && updateData[FIELD_MAPPING.lastSaved]) {
        console.warn(`[SaveQueue] Save payload for record ${recordId} only contains lastSaved timestamp. Skipping API call.`);
        return { message: "Save skipped, only timestamp update." };
      }

      const apiCall = () => {
        return new Promise((resolve, reject) => {
          $.ajax({
            url: `${KNACK_API_URL}/objects/${STUDYPLANNER_OBJECT}/records/${recordId}`,
            type: 'PUT',
            headers: this.getKnackHeaders(),
            data: JSON.stringify(updateData),
            success: function(response) {
              console.log(`[SaveQueue] API PUT successful for record ${recordId}`);
              resolve(response);
            },
            error: function(jqXHR, textStatus, errorThrown) {
              console.error(`[SaveQueue] API PUT failed for record ${recordId}: Status ${jqXHR.status} - ${errorThrown}`, jqXHR.responseText);
              const error = new Error(`API Save failed for record ${recordId}: ${jqXHR.status} ${errorThrown}`);
              error.status = jqXHR.status;
              error.responseText = jqXHR.responseText;
              reject(error);
            }
          });
        });
      };
      return retryApiCall(apiCall);
    }

    // Handles successful save completion
    handleSaveSuccess(operation) {
      const completedOperation = this.queue.shift();
      if (completedOperation !== operation) {
        console.error("[SaveQueue] Mismatch between completed operation and head of queue!", operation, completedOperation);
        const opIndex = this.queue.findIndex(op => op === operation);
        if(opIndex > -1) this.queue.splice(opIndex, 1);
      }
      this.retryAttempts.delete(operation);
      console.log(`[SaveQueue] Operation ${operation.type} succeeded for record ${operation.recordId}. Queue length: ${this.queue.length}`);
      operation.resolve(true);
      this.isSaving = false;
      this.processQueue();
    }

    // Handles save errors, implements retry logic
    handleSaveError(operation, error) {
      if (this.queue[0] !== operation) {
        console.warn(`[SaveQueue] Stale error encountered for operation ${operation.type} (record ${operation.recordId}). Operation no longer at head of queue. Ignoring error.`);
        if (!this.isSaving && this.queue.length > 0) {
          this.processQueue();
        }
        return;
      }

      const attempts = (this.retryAttempts.get(operation) || 0) + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[SaveQueue] Save error for ${operation.type} (record ${operation.recordId}, Attempt ${attempts}/${this.maxRetries}):`, errorMessage, error);

      if (attempts < this.maxRetries) {
        this.retryAttempts.set(operation, attempts);
        const delay = this.retryDelay * Math.pow(2, attempts - 1);
        console.log(`[SaveQueue] Retrying operation ${operation.type} (record ${operation.recordId}) in ${delay}ms...`);
        this.isSaving = false;
        setTimeout(() => {
          console.log(`[SaveQueue] Attempting retry for ${operation.type} (record ${operation.recordId}) after delay.`);
          this.processQueue();
        }, delay);
      } else {
        console.error(`[SaveQueue] Max retries reached for operation ${operation.type} (record ${operation.recordId}). Aborting.`);
        const failedOperation = this.queue.shift();
        if (failedOperation !== operation) {
          console.error("[SaveQueue] Mismatch during failure handling!", operation, failedOperation);
        }
        this.retryAttempts.delete(operation);
        operation.reject(error || new Error(`Save failed after ${this.maxRetries} retries`));
        this.isSaving = false;
        this.processQueue();
      }
    }

    // Helper to get standard Knack API headers
    getKnackHeaders() {
      if (typeof Knack === 'undefined' || typeof Knack.getUserToken !== 'function') {
        console.error("[SaveQueue] Knack object or getUserToken function not available.");
        throw new Error("Knack authentication context not available.");
      }
      const token = Knack.getUserToken();
      if (!token) {
        console.warn("[SaveQueue] Knack user token is null or undefined. API calls may fail.");
      }
      return {
        'X-Knack-Application-Id': knackAppId,
        'X-Knack-REST-API-Key': knackApiKey,
        'Authorization': token || '',
        'Content-Type': 'application/json'
      };
    }

    // Helper to ensure data is serializable (prevents circular references)
    ensureSerializable(data) {
      try {
        // Test serialization
        JSON.stringify(data);
        return data;
      } catch (e) {
        console.warn('[SaveQueue] Data contains circular references or non-serializable values. Stripping them.', e);
        const cache = new Set();
        try {
          return JSON.parse(JSON.stringify(data, (key, value) => {
            if (typeof value === 'object' && value !== null) {
              if (cache.has(value)) {
                return undefined;
              }
              cache.add(value);
            }
            return value;
          }));
        } catch (parseError) {
          console.error("[SaveQueue] Failed to serialize data even after attempting to strip circular references:", parseError);
          return data;
        }
      }
    }
  }

  // Create singleton instance
  const saveQueue = new SaveQueue();

  // --- Knack Integration Initialization ---
  // Keep track of initialization state to prevent duplicate initializations
  let isInitialized = false;
  let appReadyReceived = false;
  
  $(document).on('knack-scene-render.scene_1208', function(event, scene) {
    console.log("StudyPlanner: Scene rendered:", scene.key);
    if (!isInitialized) {
      isInitialized = true;
      initializeStudyPlanner();
    } else {
      console.log("StudyPlanner: Already initialized, skipping duplicate initialization");
    }
  });

  // Initialize the React app
  function initializeStudyPlanner() {
    console.log("Initializing StudyPlanner React app");
    const config = STUDYPLANNER_APP_CONFIG['scene_1208']?.['view_3008'];

    if (!config) {
      console.error("StudyPlanner: Configuration for scene_1208/view_3008 not found.");
      return;
    }

    // Check if user is authenticated
    if (typeof Knack === 'undefined' || !Knack.getUserToken) {
      console.error("StudyPlanner: Knack context or getUserToken not available.");
      return;
    }

    if (Knack.getUserToken()) {
      console.log("StudyPlanner: User is authenticated");
      const userToken = Knack.getUserToken();
      const appId = Knack.application_id;
      const user = Knack.getUserAttributes();

      console.log("StudyPlanner: Basic user info:", user);
      window.currentKnackUser = user;

      // Get complete user data (async)
      getCompleteUserData(user.id, function(completeUserData) {
        if (completeUserData) {
          window.currentKnackUser = Object.assign({}, user, completeUserData);
          debugLog("Enhanced global user object", window.currentKnackUser);
        } else {
          console.warn("StudyPlanner: Could not get complete user data, continuing with basic info");
        }
        continueInitialization(config, userToken, appId);
      });
    } else {
      console.error("StudyPlanner: User is not authenticated (Knack.getUserToken() returned null/false).");
    }
  }

  // Continue initialization after potentially fetching complete user data
  function continueInitialization(config, userToken, appId) {
    const currentUser = window.currentKnackUser;

    // Extract and store connection field IDs safely
    currentUser.emailId = extractValidRecordId(currentUser.id);
    currentUser.schoolId = extractValidRecordId(currentUser.school || currentUser.field_122);
    currentUser.teacherId = extractValidRecordId(currentUser.tutor);
    currentUser.roleId = extractValidRecordId(currentUser.role);

    debugLog("FINAL CONNECTION FIELD IDs", {
      emailId: currentUser.emailId,
      schoolId: currentUser.schoolId,
      teacherId: currentUser.teacherId,
      roleId: currentUser.roleId
    });

    // Find or create container for the app
    let container = document.querySelector(config.elementSelector);
    // Fallback selectors
    if (!container) container = document.querySelector('.kn-rich-text');
    if (!container) {
      const viewElement = document.getElementById('view_3008') || document.querySelector('.view_3008');
      if (viewElement) {
        console.log("Creating container inside view_3008");
        container = document.createElement('div');
        container.id = 'studyplanner-app-container-generated';
        viewElement.appendChild(container);
      }
    }
    // Final fallback to scene
    if (!container) {
      const sceneElement = document.getElementById('kn-scene_1208');
      if (sceneElement) {
        console.log("Creating container inside scene_1208");
        container = document.createElement('div');
        container.id = 'studyplanner-app-container-generated';
        sceneElement.appendChild(container);
      } else {
        console.error("StudyPlanner: Cannot find any suitable container for the app.");
        return;
      }
    }

    container.innerHTML = '';

    // Loading indicator
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'studyplanner-loading-indicator';
    loadingDiv.innerHTML = '<p>Loading Study Planner...</p>';
    loadingDiv.style.padding = '20px';
    loadingDiv.style.textAlign = 'center';
    container.appendChild(loadingDiv);

    // Create iframe
    const iframe = document.createElement('iframe');
    iframe.id = 'studyplanner-app-iframe';
    iframe.style.width = '100%';
    iframe.style.minHeight = '800px';
    iframe.style.border = 'none';
    iframe.style.display = 'none';
    iframe.src = config.appUrl;
    container.appendChild(iframe);

  // Setup listener ONCE
    const messageHandler = function(event) {
      if (event.source !== iframe.contentWindow) {
        return;
      }

      if (!event.data || !event.data.type) {
        console.warn("[Knack Script] Ignoring message with invalid format:", event.data);
        return;
      }

      const { type, data } = event.data;
      const iframeWindow = iframe.contentWindow;

      if (type !== 'PING') {
        console.log(`[Knack Script] Received message type: ${type}`);
      }

      if (type === 'APP_READY') {
        // Prevent handling duplicate APP_READY messages
        if (appReadyReceived) {
          console.log("StudyPlanner: Ignoring duplicate APP_READY message");
          return;
        }
        
        appReadyReceived = true;
        console.log("StudyPlanner: React app reported APP_READY.");
        
        if (!window.currentKnackUser || !window.currentKnackUser.id) {
          console.error("Cannot send initial info: Current Knack user data not ready.");
          return;
        }

        loadingDiv.innerHTML = '<p>Loading User Data...</p>';

        loadStudyPlannerUserData(window.currentKnackUser.id, function(userData) {
          if (iframeWindow && iframe.contentWindow === iframeWindow) {
            const initialData = {
              type: 'KNACK_USER_INFO',
              data: {
                id: window.currentKnackUser.id,
                email: window.currentKnackUser.email,
                name: window.currentKnackUser.name || '',
                token: userToken,
                appId: appId,
                userData: userData || {},
                emailId: window.currentKnackUser.emailId,
                schoolId: window.currentKnackUser.schoolId,
                teacherId: window.currentKnackUser.teacherId,
                roleId: window.currentKnackUser.roleId
              }
            };
            debugLog("--> Sending KNACK_USER_INFO to React App", initialData.data);
            iframeWindow.postMessage(initialData, '*');

            // Show iframe after sending initial data
            loadingDiv.style.display = 'none';
            iframe.style.display = 'block';
            console.log("StudyPlanner initialized and visible.");
          } else {
            console.warn("[Knack Script] Iframe window no longer valid when sending initial data.");
          }
        });
      } else {
        handleMessageRouter(type, data, iframeWindow);
      }
    };

    window.addEventListener('message', messageHandler);
    console.log("StudyPlanner initialization sequence complete. Waiting for APP_READY from iframe.");
  }

  // Central Message Router
  function handleMessageRouter(type, data, iframeWindow) {
    if (!type) {
      console.warn("[Knack Script] Received message without type.");
      return;
    }
    if (!iframeWindow) {
      console.error("[Knack Script] iframeWindow is missing in handleMessageRouter. Cannot send response.");
      return;
    }

    console.log(`[Knack Script] Routing message type: ${type}`);

    switch (type) {
      case 'SAVE_DATA':
        handleSaveDataRequest(data, iframeWindow);
        break;
      case 'REQUEST_UPDATED_DATA':
        handleDataUpdateRequest(data, iframeWindow);
        break;
      case 'REQUEST_TOKEN_REFRESH':
        handleTokenRefresh(iframeWindow);
        break;
      case 'REQUEST_RECORD_ID':
        handleRecordIdRequest(data, iframeWindow);
        break;
      case 'AUTH_CONFIRMED':
        console.log("[Knack Script] React App confirmed auth.");
        const loadingIndicator = document.getElementById('studyplanner-loading-indicator');
        if (loadingIndicator) loadingIndicator.style.display = 'none';
        const appIframe = document.getElementById('studyplanner-app-iframe');
        if (appIframe) appIframe.style.display = 'block';
        break;
      default:
        console.warn(`[Knack Script] Unhandled message type: ${type}`);
    }
  }

  // Handle 'SAVE_DATA' request from React app
  async function handleSaveDataRequest(data, iframeWindow) {
    console.log("[Knack Script] Handling SAVE_DATA request");
    if (!data || !data.recordId) {
      console.error("[Knack Script] SAVE_DATA request missing recordId.");
      if (iframeWindow) iframeWindow.postMessage({ type: 'SAVE_RESULT', success: false, error: "Missing recordId" }, '*');
      return;
    }
    debugLog("[Knack Script] Data received for SAVE_DATA:", data);

    try {
      await saveQueue.addToQueue({
        type: 'studyPlan',
        data: data.studyPlan,
        recordId: data.recordId,
        preserveFields: data.preserveFields || false
      });

      console.log(`[Knack Script] SAVE_DATA for record ${data.recordId} completed successfully.`);
      if (iframeWindow) iframeWindow.postMessage({ type: 'SAVE_RESULT', success: true, timestamp: new Date().toISOString() }, '*');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[Knack Script] SAVE_DATA failed for record ${data.recordId}:`, errorMessage);
      if (iframeWindow) iframeWindow.postMessage({ type: 'SAVE_RESULT', success: false, error: errorMessage || 'Unknown save error' }, '*');
    }
  }

  // Handle request for updated data from React app
  async function handleDataUpdateRequest(messageData, iframeWindow) {
    console.log("[Knack Script] Handling REQUEST_UPDATED_DATA request", messageData);
    const userId = window.currentKnackUser?.id;
    
    // Extract recordId - check both direct on message AND in data property
    let recordId = null;
    
    // Try to access recordId in different ways
    if (typeof messageData === 'object' && messageData !== null) {
      // Check directly on message object
      if (messageData.recordId) {
        recordId = messageData.recordId;
      } 
      // Check in data property if it exists
      else if (messageData.data && messageData.data.recordId) {
        recordId = messageData.data.recordId;
      }
    }
    
    console.log("[Knack Script] Extracted recordId:", recordId);

    if (!userId) {
      console.error("[Knack Script] Cannot refresh data - user ID not found.");
      if (iframeWindow) iframeWindow.postMessage({ type: 'DATA_REFRESH_ERROR', error: 'User ID not found' }, '*');
      return;
    }
    
    // Check for record ID
    if (!recordId) {
      // If we don't have a recordId, see if we have the userId and try to look up the record
      console.warn("[Knack Script] No recordId provided, attempting to find by userId:", userId);
      
      loadStudyPlannerUserData(userId, function(userData) {
        if (userData && userData.recordId && iframeWindow) {
          console.log(`[Knack Script] Found record ID by userId: ${userData.recordId}`);
          iframeWindow.postMessage({
            type: 'KNACK_DATA',
            studyPlan: userData.studyPlan || {},
            recordId: userData.recordId,
            timestamp: new Date().toISOString()
          }, '*');
        } else if (iframeWindow) {
          console.error("[Knack Script] Cannot refresh data - missing record ID and could not find by userId");
          iframeWindow.postMessage({ type: 'DATA_REFRESH_ERROR', error: 'Missing record ID in request and could not find by userId' }, '*');
        }
      });
      return;
    }

    console.log("[Knack Script] Proceeding with data request for record ID:", recordId);

    loadStudyPlannerUserData(userId, function(userData) {
      if (userData && iframeWindow) {
        if (userData.recordId === recordId) {
          console.log("[Knack Script] Sending refreshed data to React app (on request)");
          iframeWindow.postMessage({
            type: 'KNACK_DATA',
            studyPlan: userData.studyPlan || {},
            recordId: userData.recordId,
            timestamp: new Date().toISOString()
          }, '*');
        } else {
          console.warn(`[Knack Script] Loaded data record ID (${userData.recordId}) does not match requested record ID (${recordId}). Sending loaded data anyway.`);
          iframeWindow.postMessage({
            type: 'KNACK_DATA',
            studyPlan: userData.studyPlan || {},
            recordId: userData.recordId,
            timestamp: new Date().toISOString()
          }, '*');
        }
      } else if (iframeWindow) {
        console.error("[Knack Script] Error loading updated data (on request)");
        iframeWindow.postMessage({ type: 'DATA_REFRESH_ERROR', error: 'Failed to load data' }, '*');
      }
    });
  }

  // Handle record ID request
  async function handleRecordIdRequest(data, iframeWindow) {
    console.log("[Knack Script] Handling REQUEST_RECORD_ID request");
    const userId = window.currentKnackUser?.id;
    if (!userId) {
      console.error("[Knack Script] Cannot get record ID - user ID not found.");
      if (iframeWindow) iframeWindow.postMessage({ type: 'RECORD_ID_ERROR', error: 'User ID not found' }, '*');
      return;
    }

    loadStudyPlannerUserData(userId, function(userData) {
      if (userData && userData.recordId && iframeWindow) {
        console.log(`[Knack Script] Found record ID: ${userData.recordId}`);
        iframeWindow.postMessage({
          type: 'RECORD_ID_RESPONSE',
          recordId: userData.recordId,
          timestamp: new Date().toISOString()
        }, '*');
      } else if (iframeWindow) {
        console.error(`[Knack Script] Could not find record ID for user ${userId}`);
        iframeWindow.postMessage({
          type: 'RECORD_ID_ERROR',
          error: 'Record ID not found',
          timestamp: new Date().toISOString()
        }, '*');
      }
    });
  }

  // Get complete user data from Knack
  function getCompleteUserData(userId, callback) {
    console.log("[Knack Script] Getting complete user data for:", userId);
    const apiCall = () => new Promise((resolve, reject) => {
      $.ajax({
        url: `${KNACK_API_URL}/objects/object_3/records/${userId}`,
        type: 'GET',
        headers: saveQueue.getKnackHeaders(),
        data: { format: 'raw' },
        success: resolve,
        error: reject
      });
    });

    retryApiCall(apiCall)
      .then(response => {
        console.log("[Knack Script] Complete user data received.");
        debugLog("[Knack Script] Raw Complete User Data:", response);
        callback(response);
      })
      .catch(error => {
        console.error("[Knack Script] Error retrieving complete user data:", error);
        callback(null);
      });
  }

  // Load user's study planner data
  function loadStudyPlannerUserData(userId, callback) {
    console.log(`[Knack Script] Loading study planner data for user ID: ${userId}`);
    const findRecordApiCall = () => new Promise((resolve, reject) => {
      $.ajax({
        url: `${KNACK_API_URL}/objects/${STUDYPLANNER_OBJECT}/records`,
        type: 'GET',
        headers: saveQueue.getKnackHeaders(),
        data: {
          format: 'raw',
          filters: JSON.stringify({
            match: 'and',
            rules: [{ field: FIELD_MAPPING.userId, operator: 'is', value: userId }]
          })
        },
        success: resolve,
        error: reject
      });
    });

    retryApiCall(findRecordApiCall)
      .then((response) => {
        debugLog("[Knack Script] Study Planner data search response:", response);
        if (response && response.records && response.records.length > 0) {
          const record = response.records[0];
          console.log(`[Knack Script] Found existing study planner record: ${record.id}`);

          // Assemble userData from record fields safely
          let userData = { recordId: record.id };
          try {
            // Helper to parse potentially encoded fields
            const parseField = (fieldName) => {
              const rawValue = record[fieldName];
              if (rawValue === undefined || rawValue === null) return null;
              const decodedValue = (typeof rawValue === 'string' && rawValue.includes('%'))
                ? safeDecodeURIComponent(rawValue)
                : rawValue;
              if (typeof decodedValue === 'string' && (decodedValue.startsWith('{') || decodedValue.startsWith('['))) {
                return safeParseJSON(decodedValue);
              }
              return decodedValue;
            };

            userData.studyPlan = parseField(FIELD_MAPPING.planData) || {};
            userData.lastSaved = record[FIELD_MAPPING.lastSaved];
            userData.teacherConnection = parseField(FIELD_MAPPING.teacherConnection) || [];

            debugLog("[Knack Script] ASSEMBLED USER DATA from loaded record", userData);
            callback(userData);
          } catch (e) {
            console.error("[Knack Script] Error parsing loaded user data fields:", e);
            callback(userData);
          }
        } else {
          // No existing data, create a new record
          console.log(`[Knack Script] No existing study planner record found for user ${userId}, creating new one...`);
          createStudyPlannerUserRecord(userId, function(success, newRecordId) {
            if (success && newRecordId) {
              console.log(`[Knack Script] New record created with ID: ${newRecordId}`);
              callback({
                recordId: newRecordId,
                studyPlan: {}
              });
            } else {
              console.error(`[Knack Script] Failed to create new study planner record for user ${userId}.`);
              callback(null);
            }
          });
        }
      })
      .catch((error) => {
        console.error("[Knack Script] Error loading study planner user data after retries:", error);
        callback(null);
      });
  }

  // Create a new study planner user record
  function createStudyPlannerUserRecord(userId, callback) {
    console.log("[Knack Script] Creating new study planner user record for:", userId);
    const user = window.currentKnackUser;
    
    if (!user) {
      console.error("[Knack Script] Cannot create record: window.currentKnackUser is not defined.");
      callback(false, null);
      return;
    }

    // Basic data structure for a new record
    const data = {
      [FIELD_MAPPING.userId]: userId,
      [FIELD_MAPPING.userEmail]: sanitizeField(user.email),
      [FIELD_MAPPING.userName]: sanitizeField(user.name || ""),
      [FIELD_MAPPING.lastSaved]: new Date().toISOString(),
      [FIELD_MAPPING.planData]: JSON.stringify({})
    };

    // Add teacher connection if it exists
    if (window.currentKnackUser.teacherId) {
      data[FIELD_MAPPING.teacherConnection] = window.currentKnackUser.teacherId;
    }

    debugLog("[Knack Script] CREATING NEW RECORD PAYLOAD", data);

    const apiCall = () => new Promise((resolve, reject) => {
      $.ajax({
        url: `${KNACK_API_URL}/objects/${STUDYPLANNER_OBJECT}/records`,
        type: 'POST',
        headers: saveQueue.getKnackHeaders(),
        data: JSON.stringify(data),
        success: resolve,
        error: reject
      });
    });

    retryApiCall(apiCall)
      .then(response => {
        console.log("[Knack Script] Successfully created user record:", response);
        callback(true, response.id);
      })
      .catch(error => {
        console.error("[Knack Script] Error creating user record:", error);
        callback(false, null);
      });
  }
})();
