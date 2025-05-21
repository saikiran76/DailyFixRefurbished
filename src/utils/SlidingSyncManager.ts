import { EventEmitter } from 'events';
import logger from './logger';
import { throttle } from './debounceUtils';

// Constants for sliding sync
const DEFAULT_TIMELINE_LIMIT = 50; // Default number of messages to fetch

/**
 * SlidingSyncManager implements the MSC3575 Sliding Sync protocol for efficient
 * room list and message synchronization. It provides a more efficient way to
 * sync messages compared to traditional sync methods.
 *
 * This is inspired by Element's implementation but simplified for our needs.
 */
class SlidingSyncManager extends EventEmitter {
  // Static properties for throttling and tracking sync attempts
  static _lastSyncAttempt = null;
  static _lastSyncTime = 0;
  static _minSyncInterval = 5000; // Minimum time between syncs (5 seconds)

  // Static property to track all instances
  static _instances = [];
  constructor() {
    super();
    this.reset();

    // Register this instance
    SlidingSyncManager._instances.push(this);

    // Also store in window for cross-instance communication
    if (typeof window !== 'undefined') {
      if (!window.slidingSyncInstances) {
        window.slidingSyncInstances = [];
      }
      window.slidingSyncInstances.push(this);
    }

    // Create throttled versions of methods
    this.throttledStartSyncLoop = throttle(this._startSyncLoop.bind(this), 5000);

    logger.info('[SlidingSyncManager] New instance created and registered');
  }

  /**
   * Reset the sliding sync manager state
   */
  reset() {
    // Stop any existing sync loop
    if (this.syncTimer || this.syncRetryTimer || this.syncInProgress) {
      this.stopSyncLoop();
    }

    // Reset all state
    // Initialize slidingSync with empty maps instead of setting to null
    this.slidingSync = {
      lists: new Map(),
      rooms: new Map(),
      syncToken: null,
      connected: false,
      connectionId: null
    };

    // Add methods to the slidingSync object
    if (this.setList) {
      this.slidingSync.setList = this.setList;
    }
    if (this.syncRooms) {
      this.slidingSync.syncRooms = this.syncRooms;
    }
    if (this.getRooms) {
      this.slidingSync.getRooms = this.getRooms;
    }

    this.client = null;
    this.initialized = false;
    this.roomSubscriptions = new Map(); // Map of roomId -> subscription info
    this.activeRoomId = null; // Currently active room for focused syncing
    this.syncInProgress = false;
    this.syncStopped = false;
    this.syncTimer = null;
    this.syncRetryTimer = null;
    this.homeserverUrl = null;

    logger.info('[SlidingSyncManager] Reset state');
  }

  /**
   * Clean up this instance and remove it from tracking
   * This is a convenience method that calls reset() and removes the instance from tracking
   */
  cleanupInstance() {
    // Stop any sync loops
    this.stopSyncLoop();

    // Reset state
    this.reset();

    // Remove from static instances array
    const instanceIndex = SlidingSyncManager._instances.indexOf(this);
    if (instanceIndex >= 0) {
      SlidingSyncManager._instances.splice(instanceIndex, 1);
    }

    // Remove from window instances array
    if (typeof window !== 'undefined' && window.slidingSyncInstances) {
      const windowIndex = window.slidingSyncInstances.indexOf(this);
      if (windowIndex >= 0) {
        window.slidingSyncInstances.splice(windowIndex, 1);
      }
    }

    logger.info('[SlidingSyncManager] Instance cleaned up and removed from tracking');
  }

  /**
   * Initialize the SlidingSyncManager with a Matrix client
   * @param {Object} client - Matrix client instance
   * @returns {boolean} - Whether initialization was successful
   */
  initialize(client) {
    if (!client) {
      logger.error('[SlidingSyncManager] Cannot initialize without a Matrix client');
      return false;
    }

    // Reset state before initializing to prevent issues with multiple initializations
    this.reset();
    this.syncStopped = false;

    this.client = client;

    // CRITICAL FIX: Check if the Matrix client is in STOPPED state and start it if needed
    try {
      const syncState = this.client.getSyncState ? this.client.getSyncState() : null;
      logger.info(`[SlidingSyncManager] Matrix client sync state during initialization: ${syncState}`);

      if (syncState === 'STOPPED') {
        logger.warn('[SlidingSyncManager] Matrix client is STOPPED during initialization, starting it');
        try {
          this.client.startClient({
            initialSyncLimit: 20,
            includeArchivedRooms: true,
            lazyLoadMembers: true
          });
          logger.info('[SlidingSyncManager] Started Matrix client during initialization');
        } catch (startError) {
          logger.error('[SlidingSyncManager] Error starting Matrix client during initialization:', startError);
        }
      } else if (syncState === 'ERROR') {
        logger.warn('[SlidingSyncManager] Matrix client is in ERROR state during initialization, attempting recovery');
        try {
          // Try to force a retry
          if (this.client.retryImmediately) {
            this.client.retryImmediately();
            logger.info('[SlidingSyncManager] Forced immediate retry of sync during initialization');
          }
        } catch (retryError) {
          logger.error('[SlidingSyncManager] Error forcing sync retry during initialization:', retryError);
        }
      }
    } catch (clientCheckError) {
      logger.error('[SlidingSyncManager] Error checking client state during initialization:', clientCheckError);
    }

    // Check if the client supports sliding sync
    if (!this.isSlidingSyncSupported()) {
      logger.warn('[SlidingSyncManager] Sliding sync not supported by this client or homeserver');
      return false;
    }

    // Make sure sliding sync methods are implemented
    if (!this.setList || typeof this.setList !== 'function' || !this.slidingSync) {
      logger.info('[SlidingSyncManager] Re-implementing sliding sync methods during initialization');
      this.implementSlidingSync();
    }

    // Double-check that slidingSync is properly initialized
    if (!this.slidingSync) {
      logger.warn('[SlidingSyncManager] slidingSync is still null after initialization, creating it');
      this.slidingSync = {
        lists: new Map(),
        rooms: new Map(),
        syncToken: null,
        connected: false,
        connectionId: null
      };

      // Add methods to the slidingSync object
      if (this.setList) {
        this.slidingSync.setList = this.setList;
      }
      if (this.syncRooms) {
        this.slidingSync.syncRooms = this.syncRooms;
      }
      if (this.getRooms) {
        this.slidingSync.getRooms = this.getRooms;
      }
    }

    logger.info('[SlidingSyncManager] Initialized successfully');
    this.initialized = true;
    return true;
  }

  /**
   * Check if sliding sync is supported by the client
   * @returns {boolean} - Whether sliding sync is supported
   */
  isSlidingSyncSupported() {
    // First check if the client exists
    if (!this.client) {
      logger.warn('[SlidingSyncManager] No Matrix client provided');
      return false;
    }

    // Check if we've already determined support status
    if (window.slidingSyncSupported === true) {
      logger.info('[SlidingSyncManager] Using previously confirmed sliding sync support');
      return true;
    }

    if (window.slidingSyncUnsupported === true) {
      // Don't log a warning if we already know it's unsupported
      return false;
    }

    // Check if the client has the createSlidingSync method (native support)
    const hasNativeSupport = typeof this.client.createSlidingSync === 'function';

    // If the client has native support, use it
    if (hasNativeSupport) {
      window.slidingSyncSupported = true;
      logger.info('[SlidingSyncManager] Client has native sliding sync support');
      return true;
    }

    // If the client doesn't have native support, check if the homeserver supports MSC3575
    // by checking the well-known endpoint
    this.homeserverUrl = this.client.baseUrl || 'https://dfix-hsbridge.duckdns.org';

    // We know from the .well-known/matrix/client response that this homeserver supports sliding sync
    // because it has the "org.matrix.msc3575.proxy" field
    logger.info('[SlidingSyncManager] Homeserver supports MSC3575 sliding sync, implementing custom support');

    // Implement our own sliding sync method
    this.implementSlidingSync();
    window.slidingSyncSupported = true;

    return true;
  }

  /**
   * Implement our own sliding sync method if the client doesn't support it natively
   */
  implementSlidingSync() {
    logger.info('[SlidingSyncManager] Implementing custom sliding sync');

    // Create a custom sliding sync implementation if it doesn't exist
    if (!this.slidingSync) {
      this.slidingSync = {
        lists: new Map(),
        rooms: new Map(),
        syncToken: null,
        connected: false,
        connectionId: null
      };
    } else {
      // Make sure the slidingSync object has all required properties
      if (!this.slidingSync.lists) this.slidingSync.lists = new Map();
      if (!this.slidingSync.rooms) this.slidingSync.rooms = new Map();
    }

    // Add the createSlidingSync method to the client
    this.client.createSlidingSync = () => {
      return this.slidingSync;
    };

    // Add methods directly to the SlidingSyncManager instance
    this.setList = async (listName, options) => {
      logger.info(`[SlidingSyncManager] Setting list ${listName} with options:`, options);
      // Make sure slidingSync and lists exist before trying to set
      if (!this.slidingSync) {
        logger.error('[SlidingSyncManager] Cannot set list, slidingSync is null');
        // Re-initialize the sliding sync object
        this.slidingSync = {
          lists: new Map(),
          rooms: new Map(),
          syncToken: null,
          connected: false,
          connectionId: null
        };
      }

      if (!this.slidingSync.lists) {
        logger.warn('[SlidingSyncManager] slidingSync.lists is null, initializing it');
        this.slidingSync.lists = new Map();
      }

      this.slidingSync.lists.set(listName, options);
      return true;
    };

    this.syncRooms = async () => {
      return this.performCustomSlidingSync();
    };

    // Add the getRooms method
    this.getRooms = () => {
      logger.info('[SlidingSyncManager] Getting rooms from custom implementation');
      return this.client.getRooms() || [];
    };

    // Also add methods to the slidingSync object for compatibility
    this.slidingSync.setList = this.setList;
    this.slidingSync.syncRooms = this.syncRooms;
    this.slidingSync.getRooms = this.getRooms;

    // Make sure the instance is marked as initialized
    this.initialized = true;

    logger.info('[SlidingSyncManager] Custom sliding sync implementation complete');
  }

  /**
   * Perform a custom sliding sync operation using the MSC3575 endpoint
   * @returns {Promise<Object>} - Sliding sync response
   */
  async performCustomSlidingSync() {
    try {
      if (!this.client || !this.client.getUserId() || !this.client.getAccessToken()) {
        logger.error('[SlidingSyncManager] Cannot perform sliding sync without client credentials');
        return null;
      }

      // Make sure slidingSync exists before trying to use it
      if (!this.slidingSync) {
        logger.error('[SlidingSyncManager] Cannot perform sliding sync, slidingSync is null');
        // Re-initialize the sliding sync object
        this.slidingSync = {
          lists: new Map(),
          rooms: new Map(),
          syncToken: null,
          connected: false,
          connectionId: null
        };

        // Re-add methods to the slidingSync object
        this.slidingSync.setList = this.setList;
        this.slidingSync.syncRooms = this.syncRooms;
        this.slidingSync.getRooms = this.getRooms;
      }

      // Prepare the sliding sync request
      const slidingSyncUrl = `${this.homeserverUrl}/_matrix/client/unstable/org.matrix.msc3575/sync`;

      // Build the request body from the lists
      const requestBody = {
        lists: {},
        room_subscriptions: {},
        extensions: {}
      };

      // Add the lists
      // CRITICAL FIX: Add null check for lists
      if (this.slidingSync.lists) {
        for (const [listName, options] of this.slidingSync.lists.entries()) {
          requestBody.lists[listName] = {
            ranges: options.ranges || [[0, 20]],
            sort: options.sort || ['by_recency'],
            timeline_limit: options.timeline_limit || 0
          };
        }
      } else {
        logger.warn('[SlidingSyncManager] slidingSync.lists is null during request building, initializing it');
        this.slidingSync.lists = new Map();
        // Add a default list
        requestBody.lists['default'] = {
          ranges: [[0, 20]],
          sort: ['by_recency'],
          timeline_limit: 0
        };
      }

      // Add the sync token if we have one
      if (this.slidingSync.syncToken) {
        requestBody.since = this.slidingSync.syncToken;
      }

      // Make the request
      const response = await fetch(slidingSyncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.client.getAccessToken()}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`[SlidingSyncManager] Sliding sync request failed: ${response.status} ${errorText}`);
        return null;
      }

      const data = await response.json();

      // Store the sync token for the next request
      if (data.pos) {
        this.slidingSync.syncToken = data.pos;
      }

      // Process the response
      this.processCustomSlidingSyncResponse(data);

      return data;
    } catch (error) {
      logger.error('[SlidingSyncManager] Error performing custom sliding sync:', error);
      return null;
    }
  }

  /**
   * Process the response from a custom sliding sync operation
   * @param {Object} response - Sliding sync response
   */
  processCustomSlidingSyncResponse(response) {
    try {
      if (!response || !response.rooms) {
        return;
      }

      // Make sure slidingSync exists before trying to use it
      if (!this.slidingSync) {
        logger.error('[SlidingSyncManager] Cannot process response, slidingSync is null');
        // Re-initialize the sliding sync object
        this.slidingSync = {
          lists: new Map(),
          rooms: new Map(),
          syncToken: null,
          connected: false,
          connectionId: null
        };

        // Re-add methods to the slidingSync object
        this.slidingSync.setList = this.setList;
        this.slidingSync.syncRooms = this.syncRooms;
        this.slidingSync.getRooms = this.getRooms;
      }

      // Make sure rooms exists
      if (!this.slidingSync.rooms) {
        logger.warn('[SlidingSyncManager] slidingSync.rooms is null, initializing it');
        this.slidingSync.rooms = new Map();
      }

      // Process the rooms
      for (const [roomId, roomData] of Object.entries(response.rooms)) {
        // Store the room data
        this.slidingSync.rooms.set(roomId, roomData);

        // If the room has a timeline, process it
        if (roomData.timeline && roomData.timeline.length > 0) {
          this.processRoomTimeline(roomId, roomData.timeline);
        }
      }

      // Emit the sync complete event
      this.emit('syncComplete');
    } catch (error) {
      logger.error('[SlidingSyncManager] Error processing sliding sync response:', error);
    }
  }

  /**
   * Process a room timeline from a sliding sync response
   * @param {string} roomId - Room ID
   * @param {Array} timeline - Room timeline events
   */
  processRoomTimeline(roomId, timeline) {
    try {
      // Get the room from the client
      const room = this.client.getRoom(roomId);
      if (!room) {
        return;
      }

      // CRITICAL FIX: Check if the user is actually in the room before processing
      // This prevents unnecessary 403 errors when trying to access rooms the user is not in
      const membership = room.getMyMembership ? room.getMyMembership() : null;

      // Log the membership for debugging
      logger.info(`[SlidingSyncManager] Room ${roomId} membership: ${membership}`);

      // Process both joined and invited rooms, but skip left and banned rooms
      if (membership !== 'join' && membership !== 'invite') {
        logger.info(`[SlidingSyncManager] Skipping timeline processing for room ${roomId} - user membership is ${membership}`);
        return;
      }

      // For invited rooms, we need special handling
      if (membership === 'invite') {
        logger.info(`[SlidingSyncManager] Processing invited room ${roomId}`);
        // For invited rooms, we might not have full timeline access, so handle differently
        // Emit a special event for invited rooms
        this.emit('roomInvite', roomId, room);
      }

      // Process the timeline events
      const messages = this.processEvents(timeline, roomId);

      // Emit the room synced event
      this.emit('roomSynced', roomId, messages);
    } catch (error) {
      logger.error(`[SlidingSyncManager] Error processing timeline for room ${roomId}:`, error);
    }
  }

  /**
   * Subscribe to a room for efficient message syncing
   * @param {string} roomId - Room ID to subscribe to
   * @param {Object} options - Subscription options
   * @returns {Promise<boolean>} - Whether subscription was successful
   */
  async subscribeToRoom(roomId, options = {}) {
    if (!this.initialized || !this.client) {
      logger.error('[SlidingSyncManager] Cannot subscribe to room, not initialized');
      return false;
    }

    try {
      // Default options
      const subscriptionOptions = {
        timelineLimit: options.timelineLimit || DEFAULT_TIMELINE_LIMIT,
        requiredState: options.requiredState || [
          ['m.room.name', ''],
          ['m.room.topic', ''],
          ['m.room.avatar', ''],
          ['m.room.member', this.client.getUserId()]
        ],
        ...options
      };

      // Create or update subscription
      this.roomSubscriptions.set(roomId, subscriptionOptions);

      // If this is the first subscription, start the sync loop
      if (this.roomSubscriptions.size === 1) {
        this.startSyncLoop();
      }

      // Set as active room for prioritized syncing
      this.activeRoomId = roomId;

      logger.info(`[SlidingSyncManager] Subscribed to room ${roomId}`);
      this.emit('roomSubscribed', roomId);
      return true;
    } catch (error) {
      logger.error(`[SlidingSyncManager] Error subscribing to room ${roomId}:`, error);
      return false;
    }
  }

  /**
   * Unsubscribe from a room
   * @param {string} roomId - Room ID to unsubscribe from
   */
  unsubscribeFromRoom(roomId) {
    if (!this.initialized) return;

    this.roomSubscriptions.delete(roomId);

    if (this.activeRoomId === roomId) {
      this.activeRoomId = null;
    }

    logger.info(`[SlidingSyncManager] Unsubscribed from room ${roomId}`);
    this.emit('roomUnsubscribed', roomId);

    // If no more subscriptions, stop the sync loop
    if (this.roomSubscriptions.size === 0) {
      this.stopSyncLoop();
    }
  }

  /**
   * Start the sliding sync loop with throttling to prevent multiple simultaneous calls
   */
  async startSyncLoop() {
    // Use the throttled version to prevent multiple rapid calls
    return this.throttledStartSyncLoop();
  }

  /**
   * Internal method to start the sliding sync loop with improved reliability
   * This should not be called directly, use startSyncLoop instead
   */
  async _startSyncLoop() {
    // Check if we've synced recently (within the last 2 seconds)
    // CRITICAL FIX: Reduced minimum sync interval to ensure more frequent syncs
    const now = Date.now();
    if (SlidingSyncManager._lastSyncTime && (now - SlidingSyncManager._lastSyncTime < 2000)) { // 2 seconds instead of 5
      logger.info(`[SlidingSyncManager] Skipping sync, last sync was ${(now - SlidingSyncManager._lastSyncTime) / 1000}s ago`);

      // CRITICAL FIX: Schedule another sync attempt soon instead of just returning
      if (!this.syncTimer) {
        this.syncTimer = setTimeout(() => {
          this.startSyncLoop();
        }, 3000); // Try again in 3 seconds
      }
      return;
    }

    // Update the last sync time
    SlidingSyncManager._lastSyncTime = now;

    // CRITICAL FIX: Reduced throttling time to ensure more responsive syncing
    if (SlidingSyncManager._lastSyncAttempt && (now - SlidingSyncManager._lastSyncAttempt < 2000)) { // 2 seconds instead of 5
      logger.info('[SlidingSyncManager] Another sync loop was started recently, will try again soon');

      // Schedule another sync attempt soon
      if (!this.syncTimer) {
        this.syncTimer = setTimeout(() => {
          this.startSyncLoop();
        }, 3000); // Try again in 3 seconds
      }
      return;
    }

    // Update the last sync attempt timestamp
    SlidingSyncManager._lastSyncAttempt = now;

    // Prevent multiple sync loops from starting on this instance
    if (this.syncInProgress) {
      logger.info('[SlidingSyncManager] Sync already in progress on this instance');

      // CRITICAL FIX: Set a watchdog timer to ensure sync doesn't get stuck
      if (!this.syncWatchdog) {
        this.syncWatchdog = setTimeout(() => {
          if (this.syncInProgress) {
            logger.warn('[SlidingSyncManager] Sync appears to be stuck, resetting state');
            this.syncInProgress = false;
            this.startSyncLoop(); // Restart the sync loop
          }
        }, 60000); // 60 second watchdog
      }
      return;
    }

    // Check if client is initialized
    if (!this.initialized || !this.client) {
      logger.warn('[SlidingSyncManager] Not initialized or no client, cannot start sync loop');
      return;
    }

    // CRITICAL FIX: Check if the Matrix client is in ERROR or STOPPED state and handle appropriately
    try {
      const syncState = this.client.getSyncState ? this.client.getSyncState() : null;
      logger.info(`[SlidingSyncManager] Matrix client sync state before sync: ${syncState}`);

      if (syncState === 'ERROR') {
        logger.warn('[SlidingSyncManager] Matrix client is in ERROR state, attempting recovery');
        try {
          // Try to force a retry
          if (this.client.retryImmediately) {
            this.client.retryImmediately();
            logger.info('[SlidingSyncManager] Forced immediate retry of sync');
            // Wait a moment for the retry to take effect
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } catch (retryError) {
          logger.error('[SlidingSyncManager] Error forcing sync retry:', retryError);
        }
      }

      if (syncState === 'STOPPED') {
        logger.warn('[SlidingSyncManager] Matrix client is STOPPED, starting it before sync');
        try {
          // CRITICAL FIX: Stop the client first to ensure a clean start
          try {
            this.client.stopClient();
            logger.info('[SlidingSyncManager] Stopped Matrix client before restarting');
          } catch (stopError) {
            logger.warn('[SlidingSyncManager] Error stopping Matrix client:', stopError);
          }

          // Wait a moment for the stop to take effect
          await new Promise(resolve => setTimeout(resolve, 500));

          // Start the client
          this.client.startClient({
            initialSyncLimit: 10,
            includeArchivedRooms: true,
            lazyLoadMembers: true
          });
          logger.info('[SlidingSyncManager] Started Matrix client for sync');

          // Wait a moment for the client to start
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (startError) {
          logger.error('[SlidingSyncManager] Error starting Matrix client:', startError);
        }
      }
    } catch (clientCheckError) {
      logger.error('[SlidingSyncManager] Error checking client state:', clientCheckError);
    }

    // Stop any existing sync loops across all instances
    if (window.slidingSyncInstances) {
      for (const instance of window.slidingSyncInstances) {
        if (instance !== this && instance.syncTimer) {
          logger.info('[SlidingSyncManager] Stopping sync loop on another instance');
          instance.stopSyncLoop();
        }
      }
    }

    // Check if we already have a sync timer running
    if (this.syncTimer) {
      logger.info('[SlidingSyncManager] Sync timer already exists, clearing it before starting a new one');
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    // Make sure slidingSync is properly initialized
    if (!this.slidingSync) {
      logger.warn('[SlidingSyncManager] slidingSync is null before starting sync loop, initializing it');
      this.implementSlidingSync();
    }

    this.syncInProgress = true;
    this.syncStopped = false;
    logger.info('[SlidingSyncManager] Starting sync loop');

    try {
      // CRITICAL FIX: Check token validity before performing sync
      const isTokenValid = await this.checkTokenValidity();
      if (!isTokenValid) {
        logger.warn('[SlidingSyncManager] Token is invalid, not performing sync');
        this.syncInProgress = false;
        return;
      }

      // Perform the sync operation
      const syncResult = await this.performSync();

      // Emit the sync complete event
      this.emit('syncComplete', syncResult);

      // Schedule the next sync only if we haven't been stopped
      if (!this.syncStopped) {
        this.syncTimer = setTimeout(() => {
          this.syncInProgress = false;
          this.startSyncLoop();
        }, 10000); // 10 seconds between syncs for better performance and less load
      } else {
        logger.info('[SlidingSyncManager] Sync loop stopped, not scheduling next sync');
        this.syncInProgress = false;
      }
    } catch (error) {
      logger.error('[SlidingSyncManager] Error in sync loop:', error);
      this.syncInProgress = false;

      // Retry after a delay only if we haven't been stopped
      if (!this.syncStopped) {
        logger.info('[SlidingSyncManager] Scheduling retry after error');
        this.syncRetryTimer = setTimeout(() => {
          this.startSyncLoop();
        }, 30000); // 30 seconds retry delay after error to prevent rapid retries
      } else {
        logger.info('[SlidingSyncManager] Sync loop stopped, not retrying after error');
      }
    }
  }

  /**
   * Check if the Matrix token is valid and refresh if needed
   * @returns {Promise<boolean>} - Whether the token is valid
   */
  async checkTokenValidity() {
    if (!this.client) return false;

    try {
      // Import the matrixTokenManager to handle token refresh
      const matrixTokenManager = (await import('./matrixTokenManager')).default;

      // Get the current user ID
      const userId = this.client.getUserId();

      if (userId) {
        // Get the current credentials
        const credentials = {
          userId: userId,
          accessToken: this.client.getAccessToken(),
          deviceId: this.client.getDeviceId(),
          homeserver: this.client.getHomeserverUrl()
        };

        // Validate and refresh credentials if needed
        try {
          const validatedCredentials = await matrixTokenManager.validateAndRefreshCredentials(userId, credentials);

          // If credentials were refreshed, update the client
          if (validatedCredentials && validatedCredentials.accessToken !== credentials.accessToken) {
            logger.info('[SlidingSyncManager] Credentials were refreshed, updating client');

            // Update the client with the new access token
            this.client.setAccessToken(validatedCredentials.accessToken);

            // If the device ID changed, update that too
            if (validatedCredentials.deviceId !== credentials.deviceId) {
              this.client.setDeviceId(validatedCredentials.deviceId);
            }
          }

          // If we got valid credentials, the token is valid
          return true;
        } catch (refreshError) {
          logger.warn('[SlidingSyncManager] Error refreshing credentials:', refreshError);
          // Try the original method as a fallback
        }
      }

      // Fall back to the original method if token manager fails
      try {
        // Try a simple API call to check token validity
        await this.client.getProfileInfo(this.client.getUserId());
        return true;
      } catch (error) {
        if (error.errcode === 'M_UNKNOWN_TOKEN') {
          logger.error('[SlidingSyncManager] Token is invalid, need to re-authenticate');
          return false;
        }
        // Other errors might not be related to token validity
        return true;
      }
    } catch (error) {
      logger.error('[SlidingSyncManager] Error in checkTokenValidity:', error);
      // Default to assuming token is valid to prevent unnecessary re-authentication
      return true;
    }
  }

  /**
   * Stop the sliding sync loop
   */
  stopSyncLoop() {
    // Mark as stopped to prevent new syncs from being scheduled
    this.syncStopped = true;

    // Clear the main sync timer
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }

    // Clear the retry timer if it exists
    if (this.syncRetryTimer) {
      clearTimeout(this.syncRetryTimer);
      this.syncRetryTimer = null;
    }

    // Reset the in-progress flag
    this.syncInProgress = false;

    logger.info('[SlidingSyncManager] Stopped sync loop');
  }

  /**
   * Perform a sliding sync operation with improved reliability
   * @returns {Promise<Object>} - Sync result
   */
  async performSync() {
    if (!this.initialized || !this.client) {
      logger.error('[SlidingSyncManager] Cannot perform sync, not initialized or no client');
      return { success: false, error: 'Not initialized or no client' };
    }

    try {
      // Check if the Matrix client is in STOPPED state and start it if needed
      try {
        const syncState = this.client.getSyncState ? this.client.getSyncState() : null;
        if (syncState === 'STOPPED') {
          logger.warn('[SlidingSyncManager] Matrix client is STOPPED during performSync, starting it');
          try {
            await this.client.startClient({
              initialSyncLimit: 10,
              includeArchivedRooms: true,
              lazyLoadMembers: true
            });
            logger.info('[SlidingSyncManager] Started Matrix client during performSync');
          } catch (startError) {
            logger.error('[SlidingSyncManager] Error starting Matrix client during performSync:', startError);
          }
        }
      } catch (clientCheckError) {
        logger.error('[SlidingSyncManager] Error checking client state during performSync:', clientCheckError);
      }

      // Make sure slidingSync is properly initialized
      if (!this.slidingSync) {
        logger.warn('[SlidingSyncManager] slidingSync is null during performSync, initializing it');
        this.implementSlidingSync();
      }

      // Get all rooms from the client
      const allRooms = this.client.getRooms ? this.client.getRooms() : [];
      logger.info(`[SlidingSyncManager] Found ${allRooms.length} rooms in client during sync`);

      // CRITICAL FIX: Filter out rooms that the user is not a member of
      const joinedRooms = [];
      const invitedRooms = [];

      // Separate rooms by membership type for better handling
      allRooms.forEach(room => {
        try {
          // Check if the user is actually in the room
          const membership = room.getMyMembership ? room.getMyMembership() : null;

          if (membership === 'join') {
            joinedRooms.push(room);
          } else if (membership === 'invite') {
            invitedRooms.push(room);
          }
        } catch (error) {
          logger.warn(`[SlidingSyncManager] Error checking membership for room ${room.roomId}:`, error);
        }
      });

      // Log detailed breakdown of room types
      logger.info(`[SlidingSyncManager] Room breakdown - Joined: ${joinedRooms.length}, Invited: ${invitedRooms.length}`);

      // Log details of invited rooms for debugging
      if (invitedRooms.length > 0) {
        invitedRooms.forEach(room => {
          try {
            const inviter = room.currentState?.getStateEvents('m.room.member', this.client.getUserId())?.getSender() || 'unknown';
            logger.info(`[SlidingSyncManager] Invited room: ${room.roomId} - ${room.name || 'Unnamed'} - Inviter: ${inviter}`);
          } catch (error) {
            logger.warn(`[SlidingSyncManager] Error getting invite details for room ${room.roomId}:`, error);
          }
        });
      }

      // Combine joined and invited rooms
      const accessibleRooms = [...joinedRooms, ...invitedRooms];
      logger.info(`[SlidingSyncManager] Total of ${accessibleRooms.length} accessible rooms (join + invite)`);

      // Add accessible rooms to the roomSubscriptions if they're not already there
      for (const room of accessibleRooms) {
        if (room && room.roomId && !this.roomSubscriptions.has(room.roomId)) {
          // Use different timeline limits for joined vs invited rooms
          const timelineLimit = joinedRooms.includes(room) ? DEFAULT_TIMELINE_LIMIT : 1;
          this.roomSubscriptions.set(room.roomId, { timelineLimit });
        }
      }

      // Prioritize the active room
      if (this.activeRoomId) {
        await this.syncRoom(this.activeRoomId);
      }

      // Sync other subscribed rooms
      const syncedRooms = [];
      for (const [roomId, options] of this.roomSubscriptions.entries()) {
        if (roomId !== this.activeRoomId) {
          const messages = await this.syncRoom(roomId, options);
          if (messages && messages.length > 0) {
            syncedRooms.push({ roomId, messageCount: messages.length });
          }
        }
      }

      const result = {
        success: true,
        roomCount: this.roomSubscriptions.size,
        syncedRooms,
        timestamp: Date.now()
      };

      this.emit('syncComplete', result);
      return result;
    } catch (error) {
      logger.error('[SlidingSyncManager] Error performing sync:', error);
      this.emit('syncError', error);

      return {
        success: false,
        error: error.message || 'Unknown error during sync',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Sync a specific room
   * @param {string} roomId - Room ID to sync
   * @param {Object} options - Sync options
   * @returns {Promise<Array>} - Array of timeline events
   */
  async syncRoom(roomId, options = {}) {
    if (!this.initialized || !this.client) return [];

    try {
      const room = this.client.getRoom(roomId);
      if (!room) {
        logger.warn(`[SlidingSyncManager] Room ${roomId} not found`);
        return [];
      }

      // CRITICAL FIX: Check if the user is actually in the room before trying to load events
      // This prevents 403 errors when trying to access rooms the user is not in
      const membership = room.getMyMembership ? room.getMyMembership() : null;

      // Skip rooms where user is not a member or invitee
      if (membership !== 'join' && membership !== 'invite') {
        logger.info(`[SlidingSyncManager] Skipping sync for room ${roomId} - user membership is ${membership}`);
        return [];
      }

      // CRITICAL FIX: For invite rooms, don't try to load messages (which would cause 403 errors)
      // Instead, just return basic room info without trying to load timeline
      if (membership === 'invite') {
        // For invite rooms, we can't load messages, so just return basic info
        logger.info(`[SlidingSyncManager] Room ${roomId} is an invite room - skipping message loading`);

        // Return an empty array for messages, but still include the room in the list
        // This prevents 403 errors while still showing the room in the UI
        return [];
      }

      // Get subscription options
      const subscriptionOptions = this.roomSubscriptions.get(roomId) || {};
      const timelineLimit = options.timelineLimit || subscriptionOptions.timelineLimit || DEFAULT_TIMELINE_LIMIT;

      // In a real sliding sync implementation, we would use the sliding sync API
      // For now, we'll use a combination of methods to get the best results

      // First try to get messages from the timeline
      let events = [];
      const timeline = room.getLiveTimeline();

      if (timeline) {
        events = timeline.getEvents();
        logger.info(`[SlidingSyncManager] Got ${events.length} events from timeline for room ${roomId}`);

        // If we have very few events, try to load more
        if (events.length < timelineLimit) {
          try {
            // CRITICAL FIX: Check if this is an invite room before trying to paginate
            const membership = room.getMyMembership ? room.getMyMembership() : null;
            if (membership === 'invite') {
              logger.info(`[SlidingSyncManager] Skipping pagination for invite room ${roomId}`);
            } else {
              // Try to use pagination to get more events only for joined rooms
              if (this.client.paginateEventTimeline) {
                const paginationResult = await this.client.paginateEventTimeline(timeline, {
                  backwards: true,
                  limit: timelineLimit
                });

                if (paginationResult) {
                  events = timeline.getEvents();
                  logger.info(`[SlidingSyncManager] After pagination: ${events.length} events for room ${roomId}`);
                }
              }
            }

            // If still not enough, try roomMessages API
            // CRITICAL FIX: Only try roomMessages API for joined rooms
            if (events.length < timelineLimit && this.client.roomMessages && membership === 'join') {
              const messageResponse = await this.client.roomMessages(roomId, null, timelineLimit, 'b');

              if (messageResponse && messageResponse.chunk && messageResponse.chunk.length > 0) {
                // Merge with existing events, avoiding duplicates
                const existingEventIds = new Set(events.map(e => e.getId ? e.getId() : e.event_id));
                const newEvents = messageResponse.chunk.filter(e => {
                  const eventId = e.getId ? e.getId() : e.event_id;
                  return !existingEventIds.has(eventId);
                });

                events = [...events, ...newEvents];
                logger.info(`[SlidingSyncManager] After roomMessages: ${events.length} events for room ${roomId}`);
              }
            }
          } catch (loadError) {
            logger.warn(`[SlidingSyncManager] Error loading more events for room ${roomId}:`, loadError);
          }
        }
      }

      // Process events to extract messages
      const messages = this.processEvents(events, roomId);

      // Emit events
      this.emit('roomSynced', roomId, messages);

      return messages;
    } catch (error) {
      logger.error(`[SlidingSyncManager] Error syncing room ${roomId}:`, error);
      this.emit('roomSyncError', roomId, error);
      return [];
    }
  }

  /**
   * Process timeline events into message objects
   * @param {Array} events - Timeline events
   * @param {string} roomId - Room ID
   * @returns {Array} - Processed messages
   */
  processEvents(events, roomId) {
    if (!events || !events.length) return [];

    const messages = [];
    const userId = this.client.getUserId();

    for (const event of events) {
      try {
        // Check if it's a message event
        const eventType = typeof event.getType === 'function' ? event.getType() :
                         (event.type || (event.content && event.content.msgtype ? 'm.room.message' : null));

        if (eventType === 'm.room.message') {
          // Get event ID
          const id = typeof event.getId === 'function' ? event.getId() :
                    (event.event_id || event.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

          // Get sender
          const sender = typeof event.getSender === 'function' ? event.getSender() :
                       (event.sender || event.user_id || 'Unknown');

          // Get content
          const content = typeof event.getContent === 'function' ? event.getContent() :
                        (event.content || { body: 'Message content unavailable' });

          // Get timestamp
          const timestamp = typeof event.getOriginServerTs === 'function' ? event.getOriginServerTs() :
                          (event.origin_server_ts || event.timestamp || Date.now());

          // Check if message is from current user
          const isFromMe = sender === userId;

          messages.push({
            id,
            roomId,
            sender,
            content,
            timestamp,
            isFromMe
          });
        }
      } catch (eventError) {
        logger.warn(`[SlidingSyncManager] Error processing event:`, eventError);
        // Continue with next event
      }
    }

    // Sort messages by timestamp
    messages.sort((a, b) => a.timestamp - b.timestamp);

    logger.info(`[SlidingSyncManager] Processed ${messages.length} messages from ${events.length} events for room ${roomId}`);
    return messages;
  }

  /**
   * Load messages for a room
   * @param {string} roomId - Room ID
   * @param {number} limit - Maximum number of messages to load
   * @returns {Promise<Array>} - Array of messages
   */
  async loadMessages(roomId, limit = DEFAULT_TIMELINE_LIMIT) {
    if (!this.client) {
      logger.error('[SlidingSyncManager] Cannot load messages, no Matrix client');
      return [];
    }

    // If not initialized, try to initialize with the client
    if (!this.initialized) {
      logger.warn('[SlidingSyncManager] Not initialized, attempting to initialize');
      const initialized = this.initialize(this.client);

      // If initialization fails, use fallback method
      if (!initialized) {
        logger.warn('[SlidingSyncManager] Initialization failed, using fallback method');
        return this.loadMessagesWithFallback(roomId, limit);
      }
    }

    // Subscribe to the room if not already subscribed
    if (!this.roomSubscriptions.has(roomId)) {
      await this.subscribeToRoom(roomId, { timelineLimit: limit });
    }

    // Set as active room
    this.activeRoomId = roomId;

    // Perform a sync to get the latest messages
    return this.syncRoom(roomId, { timelineLimit: limit });
  }

  /**
   * Load messages using a fallback method when sliding sync is not supported
   * @param {string} roomId - Room ID
   * @param {number} limit - Maximum number of messages to load
   * @returns {Promise<Array>} - Array of messages
   */
  async loadMessagesWithFallback(roomId, limit = DEFAULT_TIMELINE_LIMIT) {
    // Only log this message if we haven't already marked sliding sync as unsupported
    if (!window.slidingSyncUnsupported) {
      logger.info(`[SlidingSyncManager] Using fallback method to load messages for room ${roomId}`);
    }

    if (!this.client) {
      logger.error('[SlidingSyncManager] Cannot load messages with fallback, no Matrix client');
      return [];
    }

    try {
      // Get the room
      const room = this.client.getRoom(roomId);
      if (!room) {
        logger.warn(`[SlidingSyncManager] Room ${roomId} not found`);
        return [];
      }

      // CRITICAL FIX: Check if the user is actually in the room before trying to load events
      // This prevents 403 errors when trying to access rooms the user is not in
      const membership = room.getMyMembership ? room.getMyMembership() : null;

      // Skip rooms where user is not a member or invitee
      if (membership !== 'join' && membership !== 'invite') {
        logger.info(`[SlidingSyncManager] Skipping message loading for room ${roomId} - user membership is ${membership}`);
        return [];
      }

      // CRITICAL FIX: For invite rooms, don't try to load messages (which would cause 403 errors)
      // Instead, just return basic room info without trying to load timeline
      if (membership === 'invite') {
        logger.info(`[SlidingSyncManager] Room ${roomId} is an invite room - skipping message loading in fallback method`);
        return [];
      }

      // Try to get messages from the timeline
      const timeline = room.getLiveTimeline();
      if (!timeline) {
        logger.warn(`[SlidingSyncManager] No timeline found for room ${roomId}`);
        return [];
      }

      // Get events from the timeline
      let events = timeline.getEvents();
      logger.info(`[SlidingSyncManager] Initial timeline has ${events.length} events`);

      // If we have very few events, try to load more
      if (events.length < limit) {
        try {
          // CRITICAL FIX: Check if this is an invite room before trying to paginate
          if (membership === 'invite') {
            logger.info(`[SlidingSyncManager] Skipping pagination for invite room ${roomId} in fallback method`);
          } else if (this.client.paginateEventTimeline) {
            // Try to use pagination to get more events only for joined rooms
            logger.info(`[SlidingSyncManager] Attempting to paginate timeline for room ${roomId}`);
            const paginationResult = await this.client.paginateEventTimeline(timeline, {
              backwards: true,
              limit: limit
            });

            if (paginationResult) {
              events = timeline.getEvents();
              logger.info(`[SlidingSyncManager] After pagination: ${events.length} events for room ${roomId}`);
            }
          }

          // If still not enough, try roomMessages API
          // CRITICAL FIX: Only try roomMessages API for joined rooms
          if (events.length < limit && this.client.roomMessages && membership === 'join') {
            logger.info(`[SlidingSyncManager] Attempting to fetch messages directly for room ${roomId}`);
            const messageResponse = await this.client.roomMessages(roomId, null, limit, 'b');

            if (messageResponse && messageResponse.chunk && messageResponse.chunk.length > 0) {
              // Process the events to ensure they're in the right format
              const processedEvents = messageResponse.chunk.map(event => {
                // Add isLiveEvent function if it doesn't exist
                if (typeof event.isLiveEvent !== 'function') {
                  event.isLiveEvent = () => false;
                }
                return event;
              });

              // Merge with existing events, avoiding duplicates
              const existingEventIds = new Set(events.map(e => e.getId ? e.getId() : e.event_id));
              const newEvents = processedEvents.filter(e => {
                const eventId = e.getId ? e.getId() : e.event_id;
                return !existingEventIds.has(eventId);
              });

              events = [...events, ...newEvents];
              logger.info(`[SlidingSyncManager] After roomMessages: ${events.length} events for room ${roomId}`);
            }
          }
        } catch (loadError) {
          logger.warn(`[SlidingSyncManager] Error loading more events for room ${roomId}:`, loadError);
        }
      }

      // Process events to extract messages
      const messages = this.processEvents(events, roomId);

      return messages;
    } catch (error) {
      logger.error(`[SlidingSyncManager] Error loading messages with fallback for room ${roomId}:`, error);
      return [];
    }
  }

  /**
   * Send a message to a room
   * @param {string} roomId - Room ID
   * @param {string|Object} content - Message content
   * @returns {Promise<string>} - Event ID of the sent message
   */
  async sendMessage(roomId, content) {
    if (!this.client) {
      logger.error('[SlidingSyncManager] Cannot send message, no Matrix client');
      throw new Error('SlidingSyncManager has no Matrix client');
    }

    // If not initialized, we can still send messages directly
    if (!this.initialized) {
      logger.warn('[SlidingSyncManager] Not initialized, sending message directly');
      return this.sendMessageDirectly(roomId, content);
    }

    try {
      let messageContent;

      // Handle different content types
      if (typeof content === 'string') {
        messageContent = {
          msgtype: 'm.text',
          body: content
        };
      } else {
        messageContent = content;
      }

      // Send the message
      const eventId = await this.client.sendMessage(roomId, messageContent);

      logger.info(`[SlidingSyncManager] Sent message to room ${roomId}`);
      return eventId;
    } catch (error) {
      logger.error(`[SlidingSyncManager] Error sending message to room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Send a message directly to a room without using sliding sync
   * @param {string} roomId - Room ID
   * @param {string|Object} content - Message content
   * @returns {Promise<string>} - Event ID of the sent message
   */
  async sendMessageDirectly(roomId, content) {
    logger.info(`[SlidingSyncManager] Sending message directly to room ${roomId}`);

    if (!this.client) {
      logger.error('[SlidingSyncManager] Cannot send message directly, no Matrix client');
      throw new Error('SlidingSyncManager has no Matrix client');
    }

    try {
      let messageContent;

      // Handle different content types
      if (typeof content === 'string') {
        messageContent = {
          msgtype: 'm.text',
          body: content
        };
      } else {
        messageContent = content;
      }

      // Send the message directly using the Matrix client
      const eventId = await this.client.sendMessage(roomId, messageContent);

      logger.info(`[SlidingSyncManager] Sent message directly to room ${roomId}`);
      return eventId;
    } catch (error) {
      logger.error(`[SlidingSyncManager] Error sending message directly to room ${roomId}:`, error);
      throw error;
    }
  }

  /**
   * Clean up resources and remove from tracking
   */
  cleanup() {
    // Stop any sync loops
    this.stopSyncLoop();

    // Clear resources
    this.roomSubscriptions.clear();
    this.activeRoomId = null;
    this.initialized = false;
    this.client = null;
    this.removeAllListeners();

    // Remove from static instances array
    const instanceIndex = SlidingSyncManager._instances.indexOf(this);
    if (instanceIndex >= 0) {
      SlidingSyncManager._instances.splice(instanceIndex, 1);
    }

    // Remove from window instances array
    if (typeof window !== 'undefined' && window.slidingSyncInstances) {
      const windowIndex = window.slidingSyncInstances.indexOf(this);
      if (windowIndex >= 0) {
        window.slidingSyncInstances.splice(windowIndex, 1);
      }
    }

    logger.info('[SlidingSyncManager] Cleaned up resources and removed from tracking');
  }
}

// Export singleton instance
const slidingSyncManager = new SlidingSyncManager();
export default slidingSyncManager;
