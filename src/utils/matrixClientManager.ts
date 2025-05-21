import * as matrixSdk from 'matrix-js-sdk';
import logger from './logger';

/**
 * Manages Matrix client instances for the application
 * Handles client creation, initialization, and event handling
 */
class MatrixClientManager {
  constructor() {
    this.clients = new Map();
    this.eventHandlers = new Map();
    this.initPromises = new Map();
    this.roomListeners = new Map();
  }

  /**
   * Creates a new Matrix client instance
   * @param {Object} config - Configuration for the Matrix client
   * @returns {Object} Matrix client instance
   */
  createClient(config) {
    logger.info('[MatrixClientManager] Creating new Matrix client');

    // Use the provided homeserver URL or default to the DailyFix homeserver
    const homeserverUrl = config.homeserver || 'https://dfix-hsbridge.duckdns.org';

    return matrixSdk.createClient({
      baseUrl: homeserverUrl,
      userId: config.userId,
      deviceId: config.deviceId || `DFIX_WEB_${Date.now()}`,
      accessToken: config.accessToken,
      timelineSupport: true,
      store: new matrixSdk.MemoryStore({ localStorage: window.localStorage })
    });
  }

  /**
   * Sets an existing Matrix client for the given user
   * @param {string} userId - User ID
   * @param {Object} client - Matrix client instance
   */
  setClient(userId, client) {
    if (!userId || !client) {
      logger.error('[MatrixClientManager] Cannot set client without userId or client');
      return;
    }

    logger.info('[MatrixClientManager] Setting client for user:', userId);
    this.clients.set(userId, client);
  }

  /**
   * Gets or creates a Matrix client for the given user
   * @param {string} userId - User ID
   * @param {Object} config - Configuration for the Matrix client
   * @returns {Promise<Object>} Matrix client instance
   */
  async getClient(userId, config) {
    // Return existing client if available
    if (this.clients.has(userId)) {
      logger.info('[MatrixClientManager] Returning existing client for user:', userId);
      return this.clients.get(userId);
    }

    // Check if initialization is in progress
    if (this.initPromises.has(userId)) {
      logger.info('[MatrixClientManager] Client initialization in progress, waiting...');
      return this.initPromises.get(userId);
    }

    // Create new client
    const initPromise = this.initializeClient(userId, config);
    this.initPromises.set(userId, initPromise);

    try {
      const client = await initPromise;
      return client;
    } finally {
      this.initPromises.delete(userId);
    }
  }

  /**
   * Starts a Matrix client for the given user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Started Matrix client
   */
  async startClient(userId) {
    try {
      const client = this.clients.get(userId);
      if (!client) {
        throw new Error(`Client not found for user: ${userId}`);
      }

      if (client.clientRunning) {
        logger.info('[MatrixClientManager] Client already running for user:', userId);
        return client;
      }

      // Start client
      logger.info('[MatrixClientManager] Starting client for user:', userId);
      await client.startClient({ initialSyncLimit: 10 });

      logger.info('[MatrixClientManager] Client started successfully:', userId);
      return client;
    } catch (error) {
      logger.error('[MatrixClientManager] Error starting client:', error);
      throw error;
    }
  }

  /**
   * Initializes a Matrix client for the given user
   * @param {string} userId - User ID
   * @param {Object} config - Configuration for the Matrix client
   * @returns {Promise<Object>} Initialized Matrix client
   */
  async initializeClient(userId, config) {
    try {
      logger.info('[MatrixClientManager] Initializing client for user:', userId);

      // Create client
      const client = this.createClient(config);
      this.clients.set(userId, client);

      // Start client
      await client.startClient({ initialSyncLimit: 10 });

      // Wait for initial sync with timeout
      await Promise.race([
        new Promise((resolve) => {
          const onSync = (state) => {
            if (state === 'PREPARED') {
              client.removeListener('sync', onSync);
              resolve();
            }
          };
          client.on('sync', onSync);
        }),
        new Promise(resolve => setTimeout(() => {
          logger.warn('[MatrixClientManager] Initial sync timeout, continuing anyway');
          resolve();
        }, 10000)) // 10 second timeout
      ]);

      logger.info('[MatrixClientManager] Client initialized successfully:', userId);
      return client;
    } catch (error) {
      logger.error('[MatrixClientManager] Error initializing client:', error);
      // Remove client from map if initialization failed
      this.clients.delete(userId);
      throw error;
    }
  }

  /**
   * Stops and removes a Matrix client
   * @param {string} userId - User ID
   */
  async stopClient(userId) {
    const client = this.clients.get(userId);
    if (client) {
      logger.info('[MatrixClientManager] Stopping client for user:', userId);

      // Remove all event handlers
      const eventHandler = this.eventHandlers.get(userId);
      if (eventHandler) {
        eventHandler.cleanup();
        this.eventHandlers.delete(userId);
      }

      // Remove room listeners
      this.roomListeners.get(userId)?.forEach(listener => {
        client.removeListener('Room.timeline', listener);
      });
      this.roomListeners.delete(userId);

      // Stop client
      await client.stopClient();
      this.clients.delete(userId);
    }
  }

  /**
   * Adds a room timeline listener for a specific room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   * @param {Function} callback - Callback function for timeline events
   */
  addRoomListener(userId, roomId, callback) {
    const client = this.clients.get(userId);
    if (!client) {
      logger.error('[MatrixClientManager] Cannot add room listener, client not found:', userId);
      return;
    }

    // Create handler function
    const handler = (event, room) => {
      if (room && room.roomId === roomId) {
        callback(event, room);
      }
    };

    // Add listener
    client.on('Room.timeline', handler);

    // Store listener for cleanup
    if (!this.roomListeners.has(userId)) {
      this.roomListeners.set(userId, new Map());
    }
    this.roomListeners.get(userId).set(roomId, handler);

    logger.info('[MatrixClientManager] Added room listener:', { userId, roomId });
  }

  /**
   * Removes a room timeline listener
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   */
  removeRoomListener(userId, roomId) {
    const client = this.clients.get(userId);
    const listeners = this.roomListeners.get(userId);
    const handler = listeners?.get(roomId);

    if (client && handler) {
      client.removeListener('Room.timeline', handler);
      listeners.delete(roomId);
      logger.info('[MatrixClientManager] Removed room listener:', { userId, roomId });
    }
  }

  /**
   * Gets all rooms for a user
   * @param {string} userId - User ID
   * @returns {Array} List of rooms
   */
  getRooms(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      logger.error('[MatrixClientManager] Cannot get rooms, client not found:', userId);
      return [];
    }

    return client.getRooms();
  }

  /**
   * Gets Telegram rooms for a user
   * @param {string} userId - User ID
   * @returns {Array} List of Telegram rooms
   */
  getTelegramRooms(userId) {
    const client = this.clients.get(userId);
    if (!client) {
      logger.error('[MatrixClientManager] Cannot get Telegram rooms, client not found:', userId);
      return [];
    }

    // Get all rooms
    const rooms = client.getRooms();

    // Filter for Telegram rooms
    // Telegram rooms are identified by the presence of the Telegram bot in the room
    // and specific state events or room name patterns
    return rooms.filter(room => {
      // Check if room has Telegram bot as a member
      const members = room.getJoinedMembers();
      const hasTelegramBot = members.some(member =>
        member.userId === '@telegrambot:dfix-hsbridge.duckdns.org' || // Specific bot ID
        member.userId.includes('telegram') ||
        member.name.includes('Telegram')
      );

      // Check room name for Telegram indicators
      const roomName = room.name || '';
      const isTelegramRoom = roomName.includes('Telegram') ||
                            roomName.includes('tg_') ||
                            room.getCanonicalAlias()?.includes('telegram');

      // Check for Telegram-specific state events
      let hasTelegramState = false;
      try {
        const telegramStateEvents = room.currentState.getStateEvents('io.dailyfix.telegram');
        hasTelegramState = telegramStateEvents && telegramStateEvents.length > 0;
      } catch (error) {
        // State event might not exist
        hasTelegramState = false;
      }

      return hasTelegramBot || isTelegramRoom || hasTelegramState;
    });
  }

  /**
   * Creates a new room for Telegram integration
   * @param {string} userId - User ID
   * @param {string} name - Room name
   * @returns {Promise<Object>} Created room
   */
  async createTelegramRoom(userId, name) {
    const client = this.clients.get(userId);
    if (!client) {
      logger.error('[MatrixClientManager] Cannot create Telegram room, client not found:', userId);
      throw new Error('Matrix client not initialized');
    }

    logger.info('[MatrixClientManager] Creating Telegram room:', name);
    logger.info('[MatrixClientManager] Using homeserver: https://dfix-hsbridge.duckdns.org');

    try {
      // Create room with specific properties for Telegram
      const room = await client.createRoom({
        name: `Telegram - ${name}`,
        topic: 'Telegram integration room',
        preset: 'private_chat',
        visibility: 'private',
        initial_state: [
          {
            type: 'm.room.history_visibility',
            content: { history_visibility: 'shared' }
          },
          {
            type: 'io.dailyfix.telegram',
            content: {
              enabled: true,
              bridge: 'telegram',
              homeserver: 'dfix-hsbridge.duckdns.org'
            }
          }
        ]
      });

      logger.info('[MatrixClientManager] Telegram room created:', room.room_id);
      return room;
    } catch (error) {
      logger.error('[MatrixClientManager] Error creating Telegram room:', error);
      throw error;
    }
  }

  /**
   * Invites the Telegram bot to a room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   * @param {string} botUserId - Telegram bot's Matrix user ID
   * @returns {Promise<void>}
   */
  async inviteTelegramBot(userId, roomId, botUserId) {
    const client = this.clients.get(userId);
    if (!client) {
      logger.error('[MatrixClientManager] Cannot invite Telegram bot, client not found:', userId);
      throw new Error('Matrix client not initialized');
    }

    logger.info('[MatrixClientManager] Inviting Telegram bot to room:', { roomId, botUserId });

    try {
      await client.invite(roomId, botUserId);
      logger.info('[MatrixClientManager] Telegram bot invited successfully');
    } catch (error) {
      logger.error('[MatrixClientManager] Error inviting Telegram bot:', error);
      throw error;
    }
  }

  /**
   * Sends a message to a room
   * @param {string} userId - User ID
   * @param {string} roomId - Room ID
   * @param {string} content - Message content
   * @returns {Promise<Object>} Send response
   */
  async sendMessage(userId, roomId, content) {
    const client = this.clients.get(userId);
    if (!client) {
      logger.error('[MatrixClientManager] Cannot send message, client not found:', userId);
      throw new Error('Matrix client not initialized');
    }

    try {
      // If content is a string, convert to proper message format
      const messageContent = typeof content === 'string'
        ? { msgtype: 'm.text', body: content }
        : content;

      return await client.sendMessage(roomId, messageContent);
    } catch (error) {
      logger.error('[MatrixClientManager] Error sending message:', error);
      throw error;
    }
  }
}

// Export singleton instance
const matrixClientManager = new MatrixClientManager();
export default matrixClientManager;
