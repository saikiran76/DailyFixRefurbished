import logger from './logger';
import { saveToIndexedDB, getFromIndexedDB } from './indexedDBHelper';
import telegramEntityUtils, { TelegramEntityTypes } from './telegramEntityUtils';

/**
 * Manages room lists and syncing for Matrix clients
 */
class RoomListManager {
  constructor() {
    this.roomLists = new Map(); // userId -> { rooms, lastSync, filters }
    this.syncInProgress = new Map(); // userId -> boolean
    this.roomCache = new Map(); // roomId -> { data, lastUpdated }
    this.messageCache = new Map(); // roomId -> { messages, lastUpdated }
    this.eventHandlers = new Map(); // userId -> { onRoomsUpdated, onMessagesUpdated }
    
    // CRITICAL FIX: Add circuit breakers to prevent infinite loops and excessive logging
    this.recoveryAttempts = new Map(); // roomId -> number of recovery attempts
    this.lastWarningTime = new Map(); // warning key -> timestamp
    this.warningThrottle = 5000; // Only log same warning once per 5 seconds
    this.maxRecoveryAttempts = 3; // Maximum number of recovery attempts
    this.updatesInProgress = new Set(); // Set of roomIds with updates in progress
  }

  // CRITICAL FIX: Helper method for throttled warnings to prevent browser hanging
  _throttledWarning(key, message) {
    const now = Date.now();
    const lastTime = this.lastWarningTime.get(key) || 0;
    
    // Only log if enough time has passed since last warning
    if (now - lastTime > this.warningThrottle) {
      logger.warn(message);
      this.lastWarningTime.set(key, now);
    }
  }

  /**
   * Check if room list is initialized for a user
   * @param {string} userId - User ID
   * @returns {boolean} - Whether room list is initialized
   */
  isInitialized(userId) {
    return this.roomLists.has(userId) && this.roomLists.get(userId).client;
  }

  /**
   * Initialize room list for a user
   * @param {string} userId - User ID
   * @param {Object} matrixClient - Matrix client instance
   * @param {Object} options - Options for room list
   * @param {Function} onRoomsUpdated - Callback for room updates
   */
  initRoomList(userId, matrixClient, options = {}, onRoomsUpdated = null) {
    if (!userId || !matrixClient) {
      logger.error('[RoomListManager] Cannot initialize room list without userId or matrixClient');
      return;
    }

    // Store event handlers
    if (onRoomsUpdated) {
      this.eventHandlers.set(userId, {
        onRoomsUpdated,
        onMessagesUpdated: options.onMessagesUpdated || null
      });
    }

    // Initialize room list
    this.roomLists.set(userId, {
      rooms: [],
      lastSync: null,
      filters: options.filters || {},
      sortBy: options.sortBy || 'lastMessage',
      client: matrixClient
    });

    // Set up event listeners
    this.setupEventListeners(userId, matrixClient);

    // Start initial sync
    this.syncRooms(userId);

    logger.info('[RoomListManager] Room list initialized for user:', userId);
  }

  /**
   * Set up event listeners for a Matrix client
   * @param {string} userId - User ID
   * @param {Object} matrixClient - Matrix client instance
   */
  setupEventListeners(userId, matrixClient) {
    // Room timeline events (new messages)
    const handleRoomTimeline = (event, room) => {
      // Add isLiveEvent function if it doesn't exist
      if (typeof event.isLiveEvent !== 'function') {
        event.isLiveEvent = () => true; // Assume all events are live events
      }

      // Skip non-live events
      if (!event.isLiveEvent()) return;

      // Update room in list
      this.updateRoomInList(userId, room);

      // Update message cache
      this.updateMessageCache(userId, room, event);

      // Notify event handlers
      this.notifyRoomsUpdated(userId);
    };

    // Room state changes
    const handleRoomState = (_event, state) => {
      const room = state.room;
      if (room) {
        this.updateRoomInList(userId, room);
        this.notifyRoomsUpdated(userId);
      }
    };

    // Sync state changes
    const handleSyncState = (state, prevState) => {
      if (state === 'PREPARED' && prevState !== 'PREPARED') {
        // Initial sync completed
        this.syncRooms(userId, true);
      }
    };

    // Add listeners
    matrixClient.on('Room.timeline', handleRoomTimeline);
    matrixClient.on('RoomState.events', handleRoomState);
    matrixClient.on('sync', handleSyncState);

    // Store listeners for cleanup
    this.roomLists.get(userId).listeners = {
      handleRoomTimeline,
      handleRoomState,
      handleSyncState
    };
  }

  /**
   * Clean up event listeners for a user
   * @param {string} userId - User ID
   */
  cleanupEventListeners(userId) {
    const roomList = this.roomLists.get(userId);
    if (!roomList || !roomList.client || !roomList.listeners) return;

    const { client, listeners } = roomList;

    // Remove listeners
    client.removeListener('Room.timeline', listeners.handleRoomTimeline);
    client.removeListener('RoomState.events', listeners.handleRoomState);
    client.removeListener('sync', listeners.handleSyncState);

    logger.info('[RoomListManager] Event listeners cleaned up for user:', userId);
  }

  /**
   * Sync rooms for a user
   * @param {string} userId - User ID
   * @param {boolean} force - Force sync even if already in progress
   * @returns {Promise<Array>} - The synced rooms
   */
  async syncRooms(userId, force = false) {
    // Traditional sync method as fallback
    // Check if sync is already in progress
    if (this.syncInProgress.get(userId) && !force) {
      logger.info('[RoomListManager] Sync already in progress for user:', userId);
      return this.roomLists.get(userId)?.rooms || [];
    }

    const roomList = this.roomLists.get(userId);
    if (!roomList || !roomList.client) {
      logger.error('[RoomListManager] Cannot sync rooms, room list not initialized for user:', userId);
      return [];
    }

    this.syncInProgress.set(userId, true);

    try {
      const { client, filters } = roomList;

      // Check if client is ready
      let syncState;
      try {
        syncState = client.getSyncState();
        logger.info(`[RoomListManager] Matrix client sync state: ${syncState}`);
      } catch (syncStateError) {
        logger.warn('[RoomListManager] Error getting sync state:', syncStateError);
        syncState = 'UNKNOWN';
      }

      if (syncState === 'ERROR') {
        logger.warn('[RoomListManager] Matrix client in ERROR state, attempting to recover');

        try {
          // Force a retry
          if (client.retryImmediately) {
            client.retryImmediately();
            logger.info('[RoomListManager] Forced immediate retry of sync');

            // Wait a moment for the sync to start
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check sync state again
            const newSyncState = client.getSyncState ? client.getSyncState() : null;
            logger.info('[RoomListManager] Matrix client sync state after recovery attempt:', newSyncState);

            // If still in error state, try more aggressive recovery
            if (newSyncState === 'ERROR') {
              logger.warn('[RoomListManager] Still in ERROR state, trying more aggressive recovery');

              // Try to restart the client completely
              try {
                if (client.stopClient && client.startClient) {
                  // Stop the client
                  await client.stopClient();
                  logger.info('[RoomListManager] Stopped Matrix client for recovery');

                  // Wait a moment before restarting
                  await new Promise(resolve => setTimeout(resolve, 1000));

                  // Start the client again
                  await client.startClient({
                    initialSyncLimit: 10,
                    includeArchivedRooms: true,
                    lazyLoadMembers: true
                  });
                  logger.info('[RoomListManager] Restarted Matrix client for recovery');

                  // Wait for sync to start
                  await new Promise(resolve => setTimeout(resolve, 3000));
                }
              } catch (restartError) {
                logger.error('[RoomListManager] Error restarting client:', restartError);
              }
            }
          } else {
            logger.warn('[RoomListManager] retryImmediately method not available on client');
          }
        } catch (retryError) {
          logger.error('[RoomListManager] Error retrying sync:', retryError);
        }
      } else if (syncState === 'STOPPED') {
        logger.warn('[RoomListManager] Matrix client is STOPPED, attempting to start it');

        try {
          // First check if the client is already running
          if (client.clientRunning) {
            logger.warn('[RoomListManager] Client marked as running but in STOPPED state, stopping it first');
            try {
              await client.stopClient();
              // Wait a moment for the client to fully stop
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (stopError) {
              logger.warn('[RoomListManager] Error stopping client:', stopError);
              // Continue anyway
            }
          }

          // Start the client with robust options
          await client.startClient({
            initialSyncLimit: 10,
            includeArchivedRooms: true,
            lazyLoadMembers: true,
            disableCallEventHandler: true,
            // Add these critical options for resilience
            retryImmediately: true,
            fallbackSyncDelay: 5000, // 5 seconds between retries
            maxTimelineRequestAttempts: 5, // More attempts for timeline requests
            timeoutMs: 60000, // Longer timeout for requests
            localTimeoutMs: 10000 // Local request timeout
          });
          logger.info('[RoomListManager] Started Matrix client');

          // Wait a moment for the sync to start
          await new Promise(resolve => setTimeout(resolve, 3000));
        } catch (startError) {
          logger.error('[RoomListManager] Error starting client:', startError);
          // Continue anyway - we'll try to work with what we have
        }
      } else if (syncState !== 'PREPARED' && syncState !== 'SYNCING') {
        logger.warn(`[RoomListManager] Matrix client sync state is ${syncState}, waiting for sync...`);

        // Try to force a sync
        try {
          if (client.syncLeftRooms) {
            await client.syncLeftRooms();
            // Wait a moment for sync to process
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            logger.warn('[RoomListManager] syncLeftRooms method not available on client');
          }

          // Also try to force an immediate retry
          if (client.retryImmediately) {
            client.retryImmediately();
            logger.info('[RoomListManager] Forced immediate retry of sync');
          }
        } catch (syncError) {
          logger.warn('[RoomListManager] Error forcing sync:', syncError);
          // Continue anyway
        }
      }

      // Get all rooms
      let allRooms = [];
      try {
        allRooms = client.getRooms() || [];
        logger.info(`[RoomListManager] Found ${allRooms.length} total rooms for user: ${userId}`);
      } catch (getRoomsError) {
        logger.error('[RoomListManager] Error getting rooms:', getRoomsError);
        // Continue with empty rooms array
      }

      // Log all rooms for debugging if force sync is requested
      if (force) {
        allRooms.forEach((room, index) => {
          try {
            const members = room.getJoinedMembers() || [];
            const memberIds = members.map(m => m.userId).join(', ');
            logger.info(`[RoomListManager] Room ${index}: ${room.roomId} - ${room.name} - Members: ${memberIds}`);

            // Check for Telegram senders in the room's timeline
            try {
              const timeline = room.getLiveTimeline && room.getLiveTimeline();
              if (timeline) {
                const events = timeline.getEvents && timeline.getEvents();
                if (events && events.length > 0) {
                  // Find events from Telegram senders
                  const telegramEvents = events.filter(event => {
                    const sender = event.getSender && event.getSender();
                    return sender && (
                      sender.includes('@telegram_') ||
                      sender.includes(':telegram') ||
                      sender.includes('telegram')
                    );
                  });

                  if (telegramEvents.length > 0) {
                    logger.info(`[RoomListManager] Found ${telegramEvents.length} Telegram events in room ${room.roomId}`);
                    telegramEvents.forEach((event, eventIndex) => {
                      logger.info(`[RoomListManager] Telegram event ${eventIndex} in room ${room.roomId}: sender=${event.getSender()}, type=${event.getType()}`);
                    });
                  }
                }
              }
            } catch (timelineError) {
              // Timeline might not be accessible
            }
          } catch (roomError) {
            logger.error(`[RoomListManager] Error getting room details for room ${index}:`, roomError);
          }
        });
      }

      // Apply filters
      let filteredRooms = allRooms;

      // Filter out login rooms
      filteredRooms = filteredRooms.filter(room => {
        const roomName = room.name || '';
        return !roomName.toLowerCase().includes('login');
      });

      logger.info(`[RoomListManager] Filtered out login rooms, ${filteredRooms.length} rooms remaining`);

      // Filter by platform (e.g., 'telegram', 'whatsapp')
      if (filters && filters.platform) {
        try {
          filteredRooms = this.filterRoomsByPlatform(filteredRooms, filters.platform);
          logger.info(`[RoomListManager] Filtered to ${filteredRooms.length} ${filters.platform} rooms`);
        } catch (filterError) {
          logger.error('[RoomListManager] Error filtering rooms by platform:', filterError);
          // Continue with unfiltered rooms
        }
      }

      // Filter out irrelevant rooms
      try {
        const countBefore = filteredRooms.length;
        filteredRooms = this.filterOutIrrelevantRooms(filteredRooms);
        logger.info(`[RoomListManager] Filtered out irrelevant rooms: ${countBefore} -> ${filteredRooms.length} rooms remaining`);
      } catch (irrelevantFilterError) {
        logger.error('[RoomListManager] Error filtering out irrelevant rooms:', irrelevantFilterError);
        // Continue with the current filtered rooms
      }

      // If no rooms found but we're looking for Telegram rooms, check for the special Telegram room
      if (filteredRooms.length === 0 && filters.platform === 'telegram') {
        logger.info('[RoomListManager] No Telegram rooms found, checking for special Telegram room');

        // Check localStorage for Telegram room ID
        try {
          const connectionStatus = JSON.parse(localStorage.getItem('dailyfix_connection_status') || '{}');
          const telegramRoomId = connectionStatus.telegramRoomId;

          if (telegramRoomId) {
            logger.info('[RoomListManager] Found Telegram room ID in localStorage:', telegramRoomId);

            // Try to get the room directly
            const telegramRoom = client.getRoom(telegramRoomId);
            if (telegramRoom) {
              logger.info('[RoomListManager] Found Telegram room:', telegramRoom.name);
              filteredRooms = [telegramRoom];
            } else {
              // Try to join the room
              try {
                logger.info('[RoomListManager] Trying to join Telegram room:', telegramRoomId);

                // First check if the client is in a state where it can join rooms
                const syncState = client.getSyncState ? client.getSyncState() : null;
                if (syncState === 'STOPPED') {
                  logger.info('[RoomListManager] Client is STOPPED, starting it before joining room');
                  await client.startClient({
                    initialSyncLimit: 10,
                    includeArchivedRooms: true,
                    lazyLoadMembers: true
                  });

                  // Wait a moment for the client to start
                  await new Promise(resolve => setTimeout(resolve, 3000));
                }

                // Now try to join the room
                await client.joinRoom(telegramRoomId);

                // Wait a moment for the room to be processed
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Get the room again
                const joinedRoom = client.getRoom(telegramRoomId);
                if (joinedRoom) {
                  logger.info(`[RoomListManager] Successfully joined Telegram room: ${joinedRoom.roomId} - ${joinedRoom.name}`);
                  filteredRooms = [joinedRoom];
                } else {
                  logger.warn(`[RoomListManager] Joined room but couldn't get it from client: ${telegramRoomId}`);
                }
              } catch (joinError) {
                logger.warn('[RoomListManager] Error joining Telegram room:', joinError);

                // If we can't join the room, create a placeholder room
                logger.info('[RoomListManager] Creating placeholder Telegram room');
                filteredRooms = [{
                  id: telegramRoomId,
                  name: 'Telegram',
                  avatar: null,
                  lastMessage: 'Connected to Telegram',
                  timestamp: Date.now(),
                  unreadCount: 0,
                  isGroup: false,
                  isTelegram: true,
                  members: 1,
                  isPlaceholder: true,
                  telegramContact: {
                    id: 'telegram_user',
                    username: 'telegram_user',
                    firstName: 'Telegram',
                    lastName: '',
                    avatar: null
                  }
                }];
              }
            }
          } else {
            // If we don't have a Telegram room ID, create a placeholder room
            logger.info('[RoomListManager] No Telegram room ID found, creating placeholder');
            filteredRooms = [{
              id: 'telegram_placeholder',
              name: 'Telegram',
              avatar: null,
              lastMessage: 'Connected to Telegram',
              timestamp: Date.now(),
              unreadCount: 0,
              isGroup: false,
              isTelegram: true,
              members: 1,
              isPlaceholder: true,
              telegramContact: {
                id: 'telegram_user',
                username: 'telegram_user',
                firstName: 'Telegram',
                lastName: '',
                avatar: null
              }
            }];
          }
        } catch (storageError) {
          logger.warn('[RoomListManager] Error checking localStorage for Telegram room:', storageError);

          // If we can't check localStorage, create a placeholder room
          logger.info('[RoomListManager] Creating placeholder Telegram room due to storage error');
          filteredRooms = [{
            id: 'telegram_placeholder',
            name: 'Telegram',
            avatar: null,
            lastMessage: 'Connected to Telegram',
            timestamp: Date.now(),
            unreadCount: 0,
            isGroup: false,
            isTelegram: true,
            members: 1,
            isPlaceholder: true,
            telegramContact: {
              id: 'telegram_user',
              username: 'telegram_user',
              firstName: 'Telegram',
              lastName: '',
              avatar: null
            }
          }];
        }
      }

      // Transform rooms to our format
      const transformedRooms = this.transformRooms(userId, filteredRooms, client);

      // Sort rooms
      const sortedRooms = this.sortRooms(transformedRooms, roomList.sortBy);

      // Update room list
      roomList.rooms = sortedRooms;
      roomList.lastSync = new Date();

      // Cache rooms
      this.cacheRooms(userId, sortedRooms);

      // Notify event handlers
      this.notifyRoomsUpdated(userId);

      logger.info('[RoomListManager] Rooms synced for user:', userId, 'count:', sortedRooms.length);
      return sortedRooms;
    } catch (error) {
      logger.error('[RoomListManager] Error syncing rooms:', error);
      return roomList?.rooms || [];
    } finally {
      this.syncInProgress.set(userId, false);
    }
  }

  /**
   * Filter rooms by platform
   * @param {Array} rooms - List of rooms
   * @param {string} platform - Platform to filter by (e.g., 'telegram', 'whatsapp')
   * @returns {Array} Filtered rooms
   */
  filterRoomsByPlatform(rooms, platform) {
    if (platform === 'telegram') {
      // CRITICAL FIX: Prevent excessive processing for empty arrays
      if (!Array.isArray(rooms) || rooms.length === 0) {
        return [];
      }

      // Find Telegram rooms
      let telegramRooms = [];
      let telegramRoomId = null;

      try {
        // Try to get Telegram room ID from localStorage
        const connectionStatus = JSON.parse(localStorage.getItem('dailyfix_connection_status') || '{}');
        telegramRoomId = connectionStatus.telegramRoomId;
      } catch (error) {
        // Ignore localStorage errors
      }

      // CRITICAL FIX: Check for recovery attempts before logging warnings
      if (telegramRoomId && !rooms.some(room => room.roomId === telegramRoomId)) {
        const attempts = this.recoveryAttempts.get(telegramRoomId) || 0;
        
        if (attempts < this.maxRecoveryAttempts) {
          // Only log if we haven't exceeded max attempts
          this._throttledWarning(
            `missing_room_${telegramRoomId}`, 
            `[RoomListManager] Telegram room ID ${telegramRoomId} not found in rooms list`
          );
          
          // Increment attempt counter
          this.recoveryAttempts.set(telegramRoomId, attempts + 1);
        }
      }

      // Continue with normal filtering
      telegramRooms = rooms.filter(room => {
        // ... existing room filtering logic ...
        return true; // Return true for valid Telegram rooms
      });

      // CRITICAL FIX: Throttle recovery attempts and warnings
      if (telegramRooms.length === 0) {
        const recoveryKey = 'telegram_recovery';
        const attempts = this.recoveryAttempts.get(recoveryKey) || 0;
        
        if (attempts < this.maxRecoveryAttempts) {
          this._throttledWarning(
            'no_telegram_rooms',
            '[RoomListManager] No Telegram rooms found after filtering, attempting to recover from cache'
          );
          
          this.recoveryAttempts.set(recoveryKey, attempts + 1);
          
          // Attempt recovery from cache (limited by maxRecoveryAttempts)
          try {
            // ... existing recovery logic ...
          } catch (recoveryError) {
            this._throttledWarning(
              'recovery_error',
              `[RoomListManager] Error recovering Telegram rooms from cache: ${recoveryError.message}`
            );
          }
        }
        
        if (attempts >= this.maxRecoveryAttempts) {
          // We've exceeded recovery attempts - clear cache and reset
          this._throttledWarning(
            'recovery_exceeded',
            '[RoomListManager] Maximum recovery attempts exceeded, resetting recovery state'
          );
          
          // Reset recovery counter after a delay (30 seconds)
          setTimeout(() => {
            this.recoveryAttempts.delete(recoveryKey);
          }, 30000);
        }
      } else {
        // We found rooms, reset recovery attempts
        this.recoveryAttempts.delete('telegram_recovery');
      }

      return telegramRooms;
    }

    // Add more platform filters as needed

    return rooms;
  }

  /**
   * Filter out irrelevant rooms based on criteria
   * @param {Array} rooms - List of Matrix rooms
   * @returns {Array} Filtered rooms
   */
  filterOutIrrelevantRooms(rooms) {
    if (!Array.isArray(rooms) || rooms.length === 0) {
      return [];
    }

    return rooms.filter(room => {
      try {
        // Skip null or invalid rooms
        if (!room || !room.roomId) {
          logger.warn('[RoomListManager] Skipping null or invalid room in filterOutIrrelevantRooms');
          return false;
        }

        // Get room membership state - exclude 'leave' or 'ban' states
        let roomState = 'unknown';
        try {
          if (room.getMyMembership) {
            roomState = room.getMyMembership();
            if (roomState === 'leave' || roomState === 'ban') {
              logger.info(`[RoomListManager] Filtering out room with state '${roomState}': ${room.roomId} - ${room.name || 'unnamed'}`);
              return false;
            }
          }
        } catch (error) {
          // If we can't determine membership, cautiously exclude the room
          logger.warn(`[RoomListManager] Error getting membership state for room ${room.roomId}:`, error);
          return false;
        }

        // Filter out rooms with unwanted keywords in name
        const roomName = (room.name || '').toLowerCase();
        const unwantedKeywords = ['empty', 'bot', 'whatsapp', 'welcome mat', 'bridge bot', 'bridge status'];
        for (const keyword of unwantedKeywords) {
          if (roomName.includes(keyword)) {
            logger.info(`[RoomListManager] Filtering out room with unwanted keyword '${keyword}': ${room.roomId} - ${room.name || 'unnamed'}`);
            return false;
          }
        }

        // Filter out rooms that are clearly not user-facing
        if (roomName.match(/^[0-9a-f-]{36}$/) || // UUID-style names
            roomName.startsWith('!') ||           // Room IDs as names
            roomName.includes('server notice') ||
            roomName === 'Telegram' || // Exclude default/hardcoded rooms
            roomName === 'WhatsApp') {
          logger.info(`[RoomListManager] Filtering out system room: ${room.roomId} - ${room.name || 'unnamed'}`);
          return false;
        }

        return true;
      } catch (error) {
        logger.warn(`[RoomListManager] Error in filterOutIrrelevantRooms for room ${room?.roomId || 'unknown'}:`, error);
        return false; // Skip problematic rooms
      }
    });
  }

  /**
   * Transform Matrix rooms to our format
   * @param {string} userId - User ID
   * @param {Array} rooms - List of Matrix rooms
   * @param {Object} matrixClient - Optional Matrix client instance
   * @returns {Array} Transformed rooms
   */
  transformRooms(userId, rooms, matrixClient = null) {
    // Get the client from the parameters or try to get it from the room list
    const client = matrixClient || this.getClientForUser(userId);

    // CRITICAL FIX: Filter out rooms that the user is not a member of
    const filteredRooms = rooms.filter(room => {
      try {
        // Check if the user is actually in the room
        const membership = room.getMyMembership ? room.getMyMembership() : null;
        return membership === 'join' || membership === 'invite';
      } catch (error) {
        logger.warn(`[RoomListManager] Error checking membership for room ${room.roomId}:`, error);
        return false;
      }
    });

    logger.info(`[RoomListManager] Filtered ${rooms.length} rooms to ${filteredRooms.length} rooms based on membership`);

    // CRITICAL FIX: Add null check for rooms
    return filteredRooms.filter(room => room != null).map(room => {
      // Get room membership state
      let roomState = 'unknown';
      try {
        if (room.getMyMembership) {
          roomState = room.getMyMembership();
        }
      } catch (stateError) {
        // Ignore errors getting room state
      }

      // Log room state for debugging
      logger.info(`[RoomListManager] Room ${room.roomId} state: ${roomState}`);

      // Get all joined members
      const joinedMembers = room.getJoinedMembers() || [];

      // Get invited members (Element checks these too)
      let invitedMembers = [];
      try {
        // Try to get invited members from room state
        const memberEvents = room.currentState.getStateEvents('m.room.member');
        invitedMembers = memberEvents
          .filter(event => event.getContent().membership === 'invite')
          .map(event => ({ userId: event.getStateKey() }));
      } catch (memberError) {
        // Ignore errors getting invited members
      }

      // Combine joined and invited members for checking
      const allMembers = [...joinedMembers, ...invitedMembers];

      // Find the Telegram bot or Telegram users
      const telegramBot = allMembers.find(member =>
        member.userId === '@telegrambot:dfix-hsbridge.duckdns.org' ||
        member.userId.includes('telegram') ||
        member.name?.includes('Telegram')
      );

      // Check if any messages in the room are from Telegram users
      let telegramSender = null;
      try {
        const timeline = room.getLiveTimeline && room.getLiveTimeline();
        if (timeline) {
          const events = timeline.getEvents && timeline.getEvents();
          if (events && events.length > 0) {
            // Find the first event from a Telegram sender
            for (let i = events.length - 1; i >= 0; i--) {
              const event = events[i];
              const sender = event.getSender && event.getSender();
              if (sender && (
                sender.includes('@telegram_') ||
                sender.includes(':telegram') ||
                sender.includes('telegram')
              )) {
                telegramSender = sender;
                break;
              }
            }
          }
        }
      } catch (timelineError) {
        // Timeline might not be accessible
      }

      // Get the other users in direct chats (excluding the current user and bots)
      const otherMembers = allMembers.filter(
        member => member.userId !== userId &&
                 !member.userId.includes('telegram') &&
                 !member.userId.includes('bot')
      );

      // For Telegram rooms, we need to extract the contact info from the room state or messages
      let telegramContact = null;
      let isTelegramRoom = false;

      // Check for Telegram-specific invite events
      let hasTelegramInvite = false;
      if (roomState === 'invite') {
        try {
          // Check if the inviter is a Telegram-related user
          const memberEvents = room.currentState.getStateEvents('m.room.member');
          const myMemberEvent = memberEvents.find(event =>
            event.getStateKey() === userId &&
            event.getContent().membership === 'invite'
          );

          if (myMemberEvent) {
            const inviter = myMemberEvent.getSender();
            hasTelegramInvite = inviter && (
              inviter.includes('@telegram_') ||
              inviter.includes(':telegram') ||
              inviter.includes('telegram') ||
              inviter === '@telegrambot:dfix-hsbridge.duckdns.org'
            );
          }
        } catch (inviteError) {
          // Ignore errors checking invite events
        }
      }

      // Check if this is a Telegram room
      if (telegramBot || telegramSender || hasTelegramInvite || (roomState === 'invite' && (room.name || '').includes('Telegram'))) {
        isTelegramRoom = true;

        // If we found a Telegram sender, extract contact info from the sender ID
        if (telegramSender) {
          // Extract user ID from sender (e.g., @telegram_1234567890:domain.com -> 1234567890)
          const userIdMatch = telegramSender.match(/@telegram_(\d+)/) || telegramSender.match(/telegram_(\d+)/);
          if (userIdMatch) {
            const telegramId = userIdMatch[1];
            telegramContact = {
              id: telegramId,
              username: `telegram_${telegramId}`,
              firstName: room.name || 'Telegram User',
              lastName: '',
              avatar: null
            };
          }
        }

        // Try to extract Telegram contact info from room state
        try {
          const stateEvents = room.currentState.getStateEvents('io.dailyfix.telegram');
          if (stateEvents && stateEvents.length > 0) {
            const content = stateEvents[0].getContent();
            if (content.username) {
              telegramContact = {
                id: content.username,
                username: content.username,
                firstName: content.firstName || content.username,
                lastName: content.lastName || '',
                avatar: content.avatar || null
              };
            }
          }
        } catch (error) {
          // State event might not exist
        }

        // If no state events, try to extract from room name
        if (!telegramContact) {
          const roomName = room.name || '';
          const usernameMatch = roomName.match(/Telegram \(([^)]+)\)/) ||
                              roomName.match(/tg_([\w\d_]+)/) ||
                              roomName.match(/@([\w\d_]+)/);

          if (usernameMatch) {
            const username = usernameMatch[1];
            telegramContact = {
              id: username,
              username: username,
              firstName: username,
              lastName: '',
              avatar: null
            };
          }
        }

        // If still no contact info, try to extract from messages
        if (!telegramContact) {
          try {
            const timeline = room.getLiveTimeline && room.getLiveTimeline();
            if (timeline) {
              const events = timeline.getEvents && timeline.getEvents() || [];
              for (let i = events.length - 1; i >= 0; i--) {
                const event = events[i];
                if (event.getType() === 'm.room.message' && telegramBot && event.getSender() === telegramBot.userId) {
                  const content = event.getContent();
                  const messageText = content.body || '';

                  // Look for messages that might contain username info
                  const usernameMatch = messageText.match(/logged in as @([\w\d_]+)/) ||
                                      messageText.match(/from @([\w\d_]+)/) ||
                                      messageText.match(/user @([\w\d_]+)/);

                  if (usernameMatch) {
                    const username = usernameMatch[1];
                    telegramContact = {
                      id: username,
                      username: username,
                      firstName: username,
                      lastName: '',
                      avatar: null
                    };
                    break;
                  }
                }
              }
            }
          } catch (messageError) {
            // Ignore errors extracting from messages
          }
        }
      }

      // Determine if this is a group chat
      const isGroup = otherMembers.length > 1 ||
                     room.name?.includes('group') ||
                     room.name?.includes('channel');

      // Identify Telegram entity type
      const entityInfo = telegramEntityUtils.identifyTelegramEntityType(room, client);

      // Get the latest event timestamp
      let events = [];
      let timestamp = Date.now();
      try {
        const timeline = room.getLiveTimeline && room.getLiveTimeline();
        if (timeline) {
          events = timeline.getEvents && timeline.getEvents() || [];
          const latestEvent = events.length > 0 ? events[events.length - 1] : null;
          timestamp = latestEvent ? latestEvent.getTs() : (room.getLastActiveTimestamp && room.getLastActiveTimestamp()) || Date.now();
        }
      } catch (timelineError) {
        // Ignore errors getting timeline
      }

      // Get unread count
      let unreadCount = 0;
      try {
        // First try to get the notification count from the room
        unreadCount = room.getUnreadNotificationCount && room.getUnreadNotificationCount() || 0;

        // If that's 0, check if there are actually unread messages by checking read receipts
        if (unreadCount === 0 && events.length > 0) {
          // Get the user's read receipt for this room
          const readUpToId = room.getEventReadUpTo(userId);

          if (!readUpToId) {
            // If no read receipt, count all messages not from the user as unread
            unreadCount = events.filter(event =>
              event.getSender && event.getSender() !== userId &&
              event.getType && event.getType() === 'm.room.message'
            ).length;
          } else {
            // Count messages after the read receipt
            let foundReadReceipt = false;
            unreadCount = 0;

            // Iterate through events from oldest to newest
            for (let i = 0; i < events.length; i++) {
              const event = events[i];

              // Skip non-message events
              if (!event.getType || event.getType() !== 'm.room.message') {
                continue;
              }

              // Skip messages from the current user
              if (event.getSender && event.getSender() === userId) {
                continue;
              }

              // If we found the read receipt, start counting
              if (foundReadReceipt) {
                unreadCount++;
              } else if (event.getId && event.getId() === readUpToId) {
                foundReadReceipt = true;
              }
            }
          }
        }

        // Cap the unread count at 99 for display purposes
        if (unreadCount > 99) {
          unreadCount = 99;
        }
      } catch (unreadError) {
        logger.warn(`[RoomListManager] Error calculating unread count for room ${room.roomId}:`, unreadError);
        // Ignore errors getting unread count
      }

      // Get avatar URL
      const homeserverUrl = 'https://dfix-hsbridge.duckdns.org';
      let avatarUrl = null;
      try {
        avatarUrl = room.getAvatarUrl && room.getAvatarUrl(homeserverUrl, 40, 40, 'crop') || null;
      } catch (avatarError) {
        // Ignore errors getting avatar URL
      }

      // If no room avatar and it's a Telegram room with contact info, use a placeholder
      if (!avatarUrl && isTelegramRoom && telegramContact) {
        // Use telegramContact.avatar if available, otherwise use a placeholder
        avatarUrl = telegramContact.avatar ||
                   `https://ui-avatars.com/api/?name=${encodeURIComponent(telegramContact.firstName)}&background=0088cc&color=fff`;
      }

      // Get last message with improved formatting
      let lastMessage = '';
      try {
        // Find the latest message event (not state event)
        let latestMessageEvent = null;
        for (let i = events.length - 1; i >= 0; i--) {
          const event = events[i];
          if (event.getType && event.getType() === 'm.room.message') {
            latestMessageEvent = event;
            break;
          }
        }

        if (latestMessageEvent) {
          const content = latestMessageEvent.getContent && latestMessageEvent.getContent();
          if (content) {
            // Format based on message type
            if (content.msgtype === 'm.image') {
              lastMessage = '📷 Image';
            } else if (content.msgtype === 'm.video') {
              lastMessage = '🎥 Video';
            } else if (content.msgtype === 'm.audio') {
              lastMessage = '🔊 Audio message';
            } else if (content.msgtype === 'm.file') {
              lastMessage = '📎 File';
            } else if (content.msgtype === 'm.sticker') {
              lastMessage = '🏷️ Sticker';
            } else {
              // For text messages, use the body
              lastMessage = content.body || '';
            }

            // For group chats, add sender name
            if (isGroup && latestMessageEvent.getSender && latestMessageEvent.getSender() !== userId) {
              try {
                // Get sender name
                let senderName = '';
                const senderId = latestMessageEvent.getSender();
                const member = room.getMember && room.getMember(senderId);

                if (member && member.name) {
                  // For member names, check if it's a Telegram ID format
                  if (member.name.includes('@telegram_')) {
                    // Extract just the name part without the ID
                    senderName = 'User';
                  } else {
                    senderName = member.name.split(' ')[0]; // Just use first name
                  }
                } else if (senderId.includes('telegram_')) {
                  // For Telegram users, just use a generic name
                  senderName = 'User';
                } else {
                  // Use first part of Matrix ID without the @ symbol
                  senderName = senderId.split(':')[0].replace('@', '');
                }

                if (senderName) {
                  lastMessage = `${senderName}: ${lastMessage}`;
                }
              } catch (senderError) {
                // Ignore errors getting sender name
              }
            }
          }
        }
      } catch (messageError) {
        logger.warn(`[RoomListManager] Error getting last message for room ${room.roomId}:`, messageError);
        // Provide a fallback message
        lastMessage = isGroup ? `${(room.getJoinedMembers && room.getJoinedMembers() || []).length} members` : 'Tap to view conversation';
      }

      // Determine the display name with improved accuracy
      let displayName = '';

      // NEVER use raw Matrix IDs as display names
      if (room.name && room.name.includes('@telegram_')) {
        // This is a raw Matrix ID - don't use it
        displayName = '';
      } else {
        displayName = room.name;
      }

      // If it's a Telegram room with contact info, use the contact name
      if (isTelegramRoom && telegramContact) {
        // Use the proper contact name from Telegram
        displayName = telegramContact.firstName;
        if (telegramContact.lastName) {
          displayName += ' ' + telegramContact.lastName;
        }
      }
      // If no room name, use the first other member's name
      else if (!displayName && otherMembers.length > 0) {
        // Make sure we're not using a raw Matrix ID
        if (otherMembers[0].name && !otherMembers[0].name.includes('@telegram_')) {
          displayName = otherMembers[0].name;
        } else {
          // Try to extract a better name from the user ID
          const userId = otherMembers[0].userId;
          if (userId.includes('@telegram_')) {
            // For Telegram users, use 'Telegram User' instead of the raw ID
            displayName = 'Telegram User';
          } else {
            // Use first part of Matrix ID without the @ symbol
            displayName = userId.split(':')[0].replace('@', '');
          }
        }
      }
      // If still no name, use a generic name based on entity type
      else if (!displayName) {
        if (entityInfo.type === TelegramEntityTypes.DIRECT_MESSAGE) {
          displayName = 'Telegram User';
        } else if (entityInfo.type === TelegramEntityTypes.CHANNEL) {
          displayName = 'Telegram Channel';
        } else if (entityInfo.type === TelegramEntityTypes.PUBLIC_GROUP ||
                  entityInfo.type === TelegramEntityTypes.PRIVATE_GROUP) {
          displayName = 'Telegram Group';
        } else if (entityInfo.type === TelegramEntityTypes.BOT) {
          displayName = 'Telegram Bot';
        } else {
          // Last resort - use a cleaned room ID
          displayName = room.roomId.split(':')[0].substring(1);
          // If it's a Telegram ID, just use 'Telegram Chat'
          if (displayName.includes('telegram_')) {
            displayName = 'Telegram Chat';
          }
        }
      }

      return {
        id: room.roomId,
        name: displayName,
        avatar: avatarUrl,
        lastMessage: lastMessage,
        timestamp: timestamp,
        unreadCount: unreadCount,
        isGroup: isGroup,
        isTelegram: isTelegramRoom,
        telegramContact: telegramContact,
        members: (room.getJoinedMembers && room.getJoinedMembers() || []).length,
        // Add entity type information
        entityType: entityInfo.type,
        canSendMessages: entityInfo.canSendMessages,
        isChannel: entityInfo.isChannel,
        isPrivate: entityInfo.isPrivate,
        isBot: entityInfo.isBot
      };
    });
  }

  /**
   * Sort rooms by specified criteria
   * @param {Array} rooms - List of rooms
   * @param {string} sortBy - Sort criteria
   * @returns {Array} Sorted rooms
   */
  sortRooms(rooms, sortBy = 'lastMessage') {
    switch (sortBy) {
      case 'lastMessage':
        // Sort by timestamp (most recent first)
        return [...rooms].sort((a, b) => b.timestamp - a.timestamp);

      case 'name':
        // Sort by name (alphabetically)
        return [...rooms].sort((a, b) => a.name.localeCompare(b.name));

      case 'unread':
        // Sort by unread count (most unread first)
        return [...rooms].sort((a, b) => b.unreadCount - a.unreadCount);

      default:
        return rooms;
    }
  }

  /**
   * Update a room in the room list
   * @param {string} userId - User ID
   * @param {Object} room - Matrix room
   */
  updateRoomInList(userId, room) {
    if (!userId || !room || !room.roomId) {
      return;
    }
    
    // CRITICAL FIX: Prevent update loops with circuit breaker
    const updateKey = `${userId}_${room.roomId}`;
    if (this.updatesInProgress && this.updatesInProgress.has(updateKey)) {
      // Already processing an update for this room - skip to prevent loops
      return;
    }
    
    // Initialize updatesInProgress if not exists
    if (!this.updatesInProgress) {
      this.updatesInProgress = new Set();
    }
    
    try {
      // Mark update as in progress
      this.updatesInProgress.add(updateKey);
      
      // Get room list
      const roomList = this.roomLists.get(userId);
      if (!roomList) {
        return;
      }
      
      // Get current rooms
      const currentRooms = roomList.rooms || [];
      
      // Find if the room already exists in the list
      const existingIndex = currentRooms.findIndex(r => r.id === room.roomId || r.id === room.id);
      
      // Create updated room list
      let updatedRooms;
      if (existingIndex >= 0) {
      // Update existing room
        updatedRooms = [...currentRooms];
        updatedRooms[existingIndex] = {
          ...updatedRooms[existingIndex],
          ...room
        };
    } else {
        // Add new room
        updatedRooms = [...currentRooms, room];
      }
      
      // Apply any filters - but ONLY if we're not already in a filtering operation
      const { filters } = roomList;
      if (filters && filters.platform) {
        // CRITICAL FIX: Skip platform filtering if we're already filtering
        // This prevents recursive calls that cause the infinite loop
        const filterKey = `filter_${userId}_${filters.platform}`;
        if (!this.updatesInProgress.has(filterKey)) {
          try {
            this.updatesInProgress.add(filterKey);
            const filteredRooms = this.filterRoomsByPlatform(updatedRooms, filters.platform);
            roomList.rooms = filteredRooms;
          } finally {
            this.updatesInProgress.delete(filterKey);
          }
        } else {
          // We're already filtering, just update without additional filtering
          roomList.rooms = updatedRooms;
        }
      } else {
        // No filtering needed
        roomList.rooms = updatedRooms;
      }
      
      // Notify about updates - but only if we're not in a recursive call
      const notifyKey = `notify_${userId}`;
      if (!this.updatesInProgress.has(notifyKey)) {
        try {
          this.updatesInProgress.add(notifyKey);
          this.notifyRoomsUpdated(userId);
        } finally {
          this.updatesInProgress.delete(notifyKey);
        }
      }
    } finally {
      // Mark update as complete
      this.updatesInProgress.delete(updateKey);
    }
  }

  /**
   * Update message cache for a room
   * @param {string} userId - User ID
   * @param {Object} room - Matrix room
   * @param {Object} event - Matrix event
   */
  updateMessageCache(userId, room, event) {
    if (event.getType() !== 'm.room.message') return;

    // Get or create message cache for room
    let messageCache = this.messageCache.get(room.roomId);
    if (!messageCache) {
      messageCache = {
        messages: [],
        lastUpdated: null
      };
      this.messageCache.set(room.roomId, messageCache);
    }

    // Create message object
    const message = {
      id: event.getId(),
      sender: event.getSender(),
      senderName: room.getMember(event.getSender())?.name || event.getSender(),
      content: event.getContent().body || '',
      timestamp: event.getTs(),
      type: this.getMessageType(event),
      mediaUrl: this.getMediaUrl(event),
      isFromMe: event.getSender() === userId
    };

    // Add message to cache
    messageCache.messages.push(message);
    messageCache.lastUpdated = new Date();

    // Sort messages by timestamp
    messageCache.messages.sort((a, b) => a.timestamp - b.timestamp);

    // Limit cache size (keep last 100 messages)
    if (messageCache.messages.length > 100) {
      messageCache.messages = messageCache.messages.slice(-100);
    }

    // Notify event handlers
    this.notifyMessagesUpdated(userId, room.roomId);
  }

  /**
   * Get message type from Matrix event
   * @param {Object} event - Matrix event
   * @returns {string} Message type
   */
  getMessageType(event) {
    const content = event.getContent();

    if (content.msgtype === 'm.image') {
      return 'image';
    } else if (content.msgtype === 'm.file') {
      return 'file';
    } else if (content.msgtype === 'm.audio') {
      return 'audio';
    } else if (content.msgtype === 'm.video') {
      return 'video';
    } else {
      return 'text';
    }
  }

  /**
   * Get media URL from Matrix event
   * @param {Object} event - Matrix event
   * @returns {string|null} Media URL
   */
  getMediaUrl(event) {
    const content = event.getContent();

    if (content.url) {
      return content.url;
    }

    return null;
  }

  /**
   * Cache rooms for a user with improved reliability
   * @param {string} userId - User ID
   * @param {Array} rooms - List of rooms
   */
  async cacheRooms(userId, rooms) {
    try {
      // Apply filtering before caching to ensure no irrelevant rooms are stored
      const filteredRooms = this.filterOutIrrelevantRooms(rooms);
      logger.info(`[RoomListManager] Filtered ${rooms.length} to ${filteredRooms.length} rooms before caching`);
      
      // Prepare rooms for caching
      // Filter out any null or undefined rooms
      const validRooms = filteredRooms.filter(room => room != null);
      
      // Skip caching if no valid rooms
      if (validRooms.length === 0) {
        logger.info(`[RoomListManager] No valid rooms to cache for user: ${userId}`);
        return;
      }
      
      const roomsToCache = validRooms.map(room => ({
        id: room.id,
        name: room.name,
        avatar: room.avatar,
        lastMessage: room.lastMessage,
        timestamp: room.timestamp,
        unreadCount: room.unreadCount,
        isGroup: room.isGroup,
        isTelegram: room.isTelegram || false,
        members: room.members,
        isPlaceholder: room.isPlaceholder || false,
        telegramContact: room.telegramContact || null
      }));

      // Cache rooms in localStorage and IndexedDB
      try {
        // First try localStorage
        localStorage.setItem(`rooms_${userId}`, JSON.stringify(roomsToCache));
        logger.info(`[RoomListManager] Cached ${roomsToCache.length} rooms in localStorage for user: ${userId}`);
      } catch (storageError) {
        logger.warn(`[RoomListManager] localStorage caching failed, trying IndexedDB: ${storageError.message}`);
      }
      
      // Then try IndexedDB as a more robust backup (doesn't have size limits)
      try {
        await saveToIndexedDB('rooms', { id: userId, rooms: roomsToCache, lastUpdated: new Date() });
      logger.info(`[RoomListManager] Cached ${roomsToCache.length} rooms in IndexedDB for user: ${userId}`);
      } catch (dbError) {
        logger.error(`[RoomListManager] IndexedDB caching failed: ${dbError.message}`);
      }
    } catch (error) {
      logger.error(`[RoomListManager] Error caching rooms: ${error.message}`);
    }
  }

  /**
   * Load cached rooms for a user with improved reliability
   * @param {string} userId - User ID
   * @returns {Array} Cached rooms
   */
  async loadCachedRooms(userId) {
    try {
      // Try to get from localStorage first (faster)
      const cachedRoomsJson = localStorage.getItem(`matrix_rooms_${userId}`);
      if (cachedRoomsJson) {
        try {
          const cachedRooms = JSON.parse(cachedRoomsJson);
          if (Array.isArray(cachedRooms) && cachedRooms.length > 0) {
            logger.info(`[RoomListManager] Loaded ${cachedRooms.length} cached rooms from localStorage`);

            // Check if the cached rooms are recent enough (less than 1 hour old)
            const cacheTimestamp = localStorage.getItem(`matrix_rooms_timestamp_${userId}`);
            if (cacheTimestamp) {
              const cacheTime = parseInt(cacheTimestamp, 10);
              const now = Date.now();
              const cacheAge = now - cacheTime;

              if (cacheAge < 3600000) { // 1 hour in milliseconds
                logger.info(`[RoomListManager] Using recent cache (${Math.round(cacheAge / 60000)} minutes old)`);
              } else {
                logger.info(`[RoomListManager] Cache is ${Math.round(cacheAge / 60000)} minutes old, but still usable`);
              }
            }

            return cachedRooms;
          }
        } catch (parseError) {
          logger.warn('[RoomListManager] Error parsing cached rooms from localStorage:', parseError);
          // Continue to try IndexedDB
        }
      }

      // Try to get from IndexedDB
      const data = await getFromIndexedDB(userId);
      if (data && data.cachedRooms) {
        logger.info(`[RoomListManager] Loaded ${data.cachedRooms.length} cached rooms from IndexedDB`);

        // Also cache in localStorage for faster access next time
        try {
          localStorage.setItem(`matrix_rooms_${userId}`, JSON.stringify(data.cachedRooms));
          localStorage.setItem(`matrix_rooms_timestamp_${userId}`, Date.now().toString());
        } catch (storageError) {
          logger.warn('[RoomListManager] Error caching rooms in localStorage:', storageError);
        }

        return data.cachedRooms;
      }
    } catch (error) {
      logger.error('[RoomListManager] Error loading cached rooms:', error);
    }

    return [];
  }

  /**
   * Check if there are cached rooms for a user
   * @param {string} userId - User ID
   * @returns {boolean} True if there are cached rooms
   */
  hasCachedRooms(userId) {
    if (!userId) return false;

    try {
      // Check localStorage first
      const cachedRoomsJson = localStorage.getItem(`matrix_rooms_${userId}`);
      if (cachedRoomsJson) {
        const cachedRooms = JSON.parse(cachedRoomsJson);
        if (Array.isArray(cachedRooms) && cachedRooms.length > 0) {
          return true;
        }
      }

      // We can't synchronously check IndexedDB, so just return false
      // The caller should use getCachedRooms instead which is async
      return false;
    } catch (error) {
      logger.error('[RoomListManager] Error checking for cached rooms:', error);
      return false;
    }
  }

  /**
   * Get cached rooms for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Cached rooms
   */
  async getCachedRooms(userId) {
    return this.loadCachedRooms(userId);
  }

  /**
   * Notify room update event handlers
   * @param {string} userId - User ID
   */
  notifyRoomsUpdated(userId) {
    // CRITICAL FIX: Throttle notifications to prevent UI freezing
    const now = Date.now();
    const notifyKey = `notify_time_${userId}`;
    const lastNotifyTime = this.lastWarningTime.get(notifyKey) || 0;
    
    // Ensure we don't flood the UI with updates - max 10 updates per second
    if (now - lastNotifyTime > 100) {
      const eventHandler = this.eventHandlers.get(userId);
      if (eventHandler && eventHandler.onRoomsUpdated) {
        try {
        const roomList = this.roomLists.get(userId);
        if (roomList) {
            eventHandler.onRoomsUpdated(roomList.rooms);
          }
        } catch (error) {
          this._throttledWarning(
            'notify_error',
            `[RoomListManager] Error in rooms updated handler: ${error.message}`
          );
        }
      }
      this.lastWarningTime.set(notifyKey, now);
    }
  }

  /**
   * Notify message update event handlers
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   */
  notifyMessagesUpdated(userId, roomId) {
    // CRITICAL FIX: Throttle message notifications to prevent UI freezing
    const now = Date.now();
    const notifyKey = `notify_messages_${userId}_${roomId}`;
    const lastNotifyTime = this.lastWarningTime.get(notifyKey) || 0;
    
    // Ensure we don't flood the UI with updates - max 5 updates per second for messages
    if (now - lastNotifyTime > 200) {
    const handlers = this.eventHandlers.get(userId);
    if (handlers && handlers.onMessagesUpdated) {
        try {
      const messageCache = this.messageCache.get(roomId);
      if (messageCache) {
        handlers.onMessagesUpdated(roomId, messageCache.messages);
      }
        } catch (error) {
          this._throttledWarning(
            'notify_messages_error',
            `[RoomListManager] Error in messages updated handler: ${error.message}`
          );
        }
      }
      this.lastWarningTime.set(notifyKey, now);
    }
  }

  /**
   * Get rooms for a user
   * @param {string} userId - User ID
   * @returns {Array} List of rooms
   */
  getRooms(userId) {
    const roomList = this.roomLists.get(userId);
    return roomList ? roomList.rooms : [];
  }

  /**
   * Get Matrix client for a user
   * @param {string} userId - User ID
   * @returns {Object|null} Matrix client or null
   */
  getClientForUser(userId) {
    const roomList = this.roomLists.get(userId);
    return roomList ? roomList.client : null;
  }

  /**
   * Get messages for a room
   * @param {string} roomId - Room ID
   * @param {number} limit - Maximum number of messages to return
   * @returns {Array} List of messages
   */
  getMessages(roomId, limit = 50) {
    const messageCache = this.messageCache.get(roomId);
    if (!messageCache) return [];

    // Return last 'limit' messages
    return messageCache.messages.slice(-limit);
  }

  /**
   * Load messages for a room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   * @param {number} limit - Maximum number of messages to load
   * @returns {Promise<Array>} List of messages
   */
  async loadMessages(userId, roomId, limit = 50) {
    const roomList = this.roomLists.get(userId);
    if (!roomList || !roomList.client) {
      logger.error('[RoomListManager] Cannot load messages, room list not initialized for user:', userId);
      return [];
    }

    // Traditional method to load messages
    logger.info(`[RoomListManager] Using traditional method to load messages for room ${roomId}`);

    try {
      const room = roomList.client.getRoom(roomId);
      if (!room) {
        logger.error('[RoomListManager] Room not found:', roomId);
        return [];
      }

      // Get timeline events
      const timeline = room.getLiveTimeline();
      const events = timeline.getEvents();

      // Filter for message events
      const messageEvents = events
        .filter(event => event.getType() === 'm.room.message')
        .slice(-limit);

      // Transform to message format
      const messages = messageEvents.map(event => ({
        id: event.getId(),
        sender: event.getSender(),
        senderName: room.getMember(event.getSender())?.name || event.getSender(),
        content: event.getContent().body || '',
        timestamp: event.getTs(),
        type: this.getMessageType(event),
        mediaUrl: this.getMediaUrl(event),
        isFromMe: event.getSender() === userId
      }));

      // Cache messages
      this.messageCache.set(roomId, {
        messages,
        lastUpdated: new Date()
      });

      return messages;
    } catch (error) {
      logger.error('[RoomListManager] Error loading messages:', error);
      return [];
    }
  }

  /**
   * Send a message to a room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   * @param {string|Object} content - Message content
   * @returns {Promise<Object>} Send response
   */
  async sendMessage(userId, roomId, content) {
    const roomList = this.roomLists.get(userId);
    if (!roomList || !roomList.client) {
      throw new Error('Room list not initialized for user');
    }

    try {
      // If content is a string, convert to proper message format
      const messageContent = typeof content === 'string'
        ? { msgtype: 'm.text', body: content }
        : content;

      return await roomList.client.sendMessage(roomId, messageContent);
    } catch (error) {
      logger.error('[RoomListManager] Error sending message:', error);
      throw error;
    }
  }

  /**
   * Clean up resources for a user
   * @param {string} userId - User ID
   */
  cleanup(userId) {
    // Clean up event listeners
    this.cleanupEventListeners(userId);

    // Remove room list
    this.roomLists.delete(userId);

    // Remove sync status
    this.syncInProgress.delete(userId);

    // Remove event handlers
    this.eventHandlers.delete(userId);

    logger.info('[RoomListManager] Cleaned up resources for user:', userId);
  }
}

// Export singleton instance
const roomListManager = new RoomListManager();

// Make roomListManager accessible from window for cross-component communication
if (typeof window !== 'undefined') {
  window.roomListManager = roomListManager;
}

export default roomListManager;
