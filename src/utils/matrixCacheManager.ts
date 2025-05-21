/**
 * Matrix Cache Manager
 * 
 * Handles caching of Matrix data in IndexedDB, similar to Element-web's approach
 */
import logger from './logger';

// IndexedDB database name and version
const DB_NAME = 'matrix_cache_db';
const DB_VERSION = 1;

// Store names
const STORES = {
  MESSAGES: 'messages',
  ROOMS: 'rooms',
  EVENTS: 'events',
  USER_DATA: 'user_data'
};

class MatrixCacheManager {
  constructor() {
    this.db = null;
    this.initialized = false;
    this.userId = null;
  }

  /**
   * Initialize the cache manager
   * @param {string} userId - Matrix user ID
   * @returns {Promise<boolean>} - Whether initialization was successful
   */
  async initialize(userId) {
    if (!userId) {
      logger.error('[MatrixCacheManager] Cannot initialize: no userId provided');
      return false;
    }

    this.userId = userId;

    try {
      // Open the database
      this.db = await this._openDatabase();
      this.initialized = true;
      logger.info(`[MatrixCacheManager] Initialized for user ${userId}`);
      return true;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error initializing:', error);
      return false;
    }
  }

  /**
   * Open the IndexedDB database
   * @returns {Promise<IDBDatabase>} - IndexedDB database
   * @private
   */
  _openDatabase() {
    return new Promise((resolve, reject) => {
      // Check if IndexedDB is available
      if (!window.indexedDB) {
        reject(new Error('IndexedDB not supported'));
        return;
      }

      // Open the database
      const request = window.indexedDB.open(`${DB_NAME}_${this.userId}`, DB_VERSION);

      // Handle database upgrade
      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create object stores if they don't exist
        if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
          const messagesStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
          messagesStore.createIndex('roomId', 'roomId', { unique: false });
          messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.ROOMS)) {
          const roomsStore = db.createObjectStore(STORES.ROOMS, { keyPath: 'id' });
          roomsStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.EVENTS)) {
          const eventsStore = db.createObjectStore(STORES.EVENTS, { keyPath: 'id' });
          eventsStore.createIndex('roomId', 'roomId', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORES.USER_DATA)) {
          db.createObjectStore(STORES.USER_DATA, { keyPath: 'key' });
        }

        logger.info('[MatrixCacheManager] Database schema created/upgraded');
      };

      // Handle success
      request.onsuccess = (event) => {
        const db = event.target.result;
        logger.info('[MatrixCacheManager] Database opened successfully');
        resolve(db);
      };

      // Handle error
      request.onerror = (event) => {
        logger.error('[MatrixCacheManager] Error opening database:', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Cache messages for a room
   * @param {string} roomId - Room ID
   * @param {Array} messages - Array of messages
   * @returns {Promise<boolean>} - Whether caching was successful
   */
  async cacheMessages(roomId, messages) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot cache messages: not initialized');
      return false;
    }

    if (!roomId || !messages || !Array.isArray(messages)) {
      logger.error('[MatrixCacheManager] Cannot cache messages: invalid parameters');
      return false;
    }

    try {
      const transaction = this.db.transaction([STORES.MESSAGES, STORES.ROOMS], 'readwrite');
      const messagesStore = transaction.objectStore(STORES.MESSAGES);
      const roomsStore = transaction.objectStore(STORES.ROOMS);

      // Add each message to the store
      for (const message of messages) {
        // Add roomId to the message for indexing
        const messageWithRoom = {
          ...message,
          roomId
        };

        // Put the message in the store
        messagesStore.put(messageWithRoom);
      }

      // Update the room's last updated timestamp
      roomsStore.put({
        id: roomId,
        lastUpdated: Date.now(),
        messageCount: messages.length
      });

      // Wait for the transaction to complete
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
      });

      logger.info(`[MatrixCacheManager] Cached ${messages.length} messages for room ${roomId}`);
      return true;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error caching messages:', error);
      return false;
    }
  }

  /**
   * Get cached messages for a room
   * @param {string} roomId - Room ID
   * @param {Object} options - Options
   * @param {number} options.limit - Maximum number of messages to get
   * @param {number} options.before - Get messages before this timestamp
   * @returns {Promise<Array>} - Array of messages
   */
  async getMessages(roomId, options = {}) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot get messages: not initialized');
      return [];
    }

    if (!roomId) {
      logger.error('[MatrixCacheManager] Cannot get messages: no roomId provided');
      return [];
    }

    const {
      limit = 100,
      before = Date.now()
    } = options;

    try {
      const transaction = this.db.transaction(STORES.MESSAGES, 'readonly');
      const messagesStore = transaction.objectStore(STORES.MESSAGES);
      const roomIndex = messagesStore.index('roomId');

      // Get all messages for the room
      const messages = await new Promise((resolve, reject) => {
        const request = roomIndex.getAll(roomId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
      });

      // Filter and sort messages
      const filteredMessages = messages
        .filter(message => message.timestamp < before)
        .sort((a, b) => a.timestamp - b.timestamp)
        .slice(-limit);

      logger.info(`[MatrixCacheManager] Retrieved ${filteredMessages.length} cached messages for room ${roomId}`);
      return filteredMessages;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error getting messages:', error);
      return [];
    }
  }

  /**
   * Cache a single event
   * @param {string} roomId - Room ID
   * @param {Object} event - Event object
   * @returns {Promise<boolean>} - Whether caching was successful
   */
  async cacheEvent(roomId, event) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot cache event: not initialized');
      return false;
    }

    if (!roomId || !event || !event.id) {
      logger.error('[MatrixCacheManager] Cannot cache event: invalid parameters');
      return false;
    }

    try {
      const transaction = this.db.transaction(STORES.EVENTS, 'readwrite');
      const eventsStore = transaction.objectStore(STORES.EVENTS);

      // Add roomId to the event for indexing
      const eventWithRoom = {
        ...event,
        roomId
      };

      // Put the event in the store
      eventsStore.put(eventWithRoom);

      // Wait for the transaction to complete
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
      });

      logger.info(`[MatrixCacheManager] Cached event ${event.id} for room ${roomId}`);
      return true;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error caching event:', error);
      return false;
    }
  }

  /**
   * Get a cached event
   * @param {string} eventId - Event ID
   * @returns {Promise<Object>} - Event object
   */
  async getEvent(eventId) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot get event: not initialized');
      return null;
    }

    if (!eventId) {
      logger.error('[MatrixCacheManager] Cannot get event: no eventId provided');
      return null;
    }

    try {
      const transaction = this.db.transaction(STORES.EVENTS, 'readonly');
      const eventsStore = transaction.objectStore(STORES.EVENTS);

      // Get the event
      const event = await new Promise((resolve, reject) => {
        const request = eventsStore.get(eventId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
      });

      if (event) {
        logger.info(`[MatrixCacheManager] Retrieved cached event ${eventId}`);
      } else {
        logger.info(`[MatrixCacheManager] Event ${eventId} not found in cache`);
      }

      return event || null;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error getting event:', error);
      return null;
    }
  }

  /**
   * Store user data
   * @param {string} key - Data key
   * @param {any} value - Data value
   * @returns {Promise<boolean>} - Whether storing was successful
   */
  async storeUserData(key, value) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot store user data: not initialized');
      return false;
    }

    if (!key) {
      logger.error('[MatrixCacheManager] Cannot store user data: no key provided');
      return false;
    }

    try {
      const transaction = this.db.transaction(STORES.USER_DATA, 'readwrite');
      const userDataStore = transaction.objectStore(STORES.USER_DATA);

      // Put the data in the store
      userDataStore.put({
        key,
        value,
        timestamp: Date.now()
      });

      // Wait for the transaction to complete
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = (event) => reject(event.target.error);
      });

      logger.info(`[MatrixCacheManager] Stored user data for key ${key}`);
      return true;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error storing user data:', error);
      return false;
    }
  }

  /**
   * Get user data
   * @param {string} key - Data key
   * @returns {Promise<any>} - Data value
   */
  async getUserData(key) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot get user data: not initialized');
      return null;
    }

    if (!key) {
      logger.error('[MatrixCacheManager] Cannot get user data: no key provided');
      return null;
    }

    try {
      const transaction = this.db.transaction(STORES.USER_DATA, 'readonly');
      const userDataStore = transaction.objectStore(STORES.USER_DATA);

      // Get the data
      const data = await new Promise((resolve, reject) => {
        const request = userDataStore.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => reject(event.target.error);
      });

      if (data) {
        logger.info(`[MatrixCacheManager] Retrieved user data for key ${key}`);
        return data.value;
      } else {
        logger.info(`[MatrixCacheManager] User data for key ${key} not found`);
        return null;
      }
    } catch (error) {
      logger.error('[MatrixCacheManager] Error getting user data:', error);
      return null;
    }
  }

  /**
   * Clear the cache for a room
   * @param {string} roomId - Room ID
   * @returns {Promise<boolean>} - Whether clearing was successful
   */
  async clearRoomCache(roomId) {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot clear room cache: not initialized');
      return false;
    }

    if (!roomId) {
      logger.error('[MatrixCacheManager] Cannot clear room cache: no roomId provided');
      return false;
    }

    try {
      // Clear messages
      const messagesTransaction = this.db.transaction(STORES.MESSAGES, 'readwrite');
      const messagesStore = messagesTransaction.objectStore(STORES.MESSAGES);
      const roomIndex = messagesStore.index('roomId');

      // Get all message keys for the room
      const messageKeys = await new Promise((resolve, reject) => {
        const request = roomIndex.getAllKeys(roomId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
      });

      // Delete each message
      for (const key of messageKeys) {
        messagesStore.delete(key);
      }

      // Wait for the transaction to complete
      await new Promise((resolve, reject) => {
        messagesTransaction.oncomplete = () => resolve();
        messagesTransaction.onerror = (event) => reject(event.target.error);
      });

      // Clear events
      const eventsTransaction = this.db.transaction(STORES.EVENTS, 'readwrite');
      const eventsStore = eventsTransaction.objectStore(STORES.EVENTS);
      const eventRoomIndex = eventsStore.index('roomId');

      // Get all event keys for the room
      const eventKeys = await new Promise((resolve, reject) => {
        const request = eventRoomIndex.getAllKeys(roomId);
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (event) => reject(event.target.error);
      });

      // Delete each event
      for (const key of eventKeys) {
        eventsStore.delete(key);
      }

      // Wait for the transaction to complete
      await new Promise((resolve, reject) => {
        eventsTransaction.oncomplete = () => resolve();
        eventsTransaction.onerror = (event) => reject(event.target.error);
      });

      // Clear room data
      const roomsTransaction = this.db.transaction(STORES.ROOMS, 'readwrite');
      const roomsStore = roomsTransaction.objectStore(STORES.ROOMS);
      roomsStore.delete(roomId);

      // Wait for the transaction to complete
      await new Promise((resolve, reject) => {
        roomsTransaction.oncomplete = () => resolve();
        roomsTransaction.onerror = (event) => reject(event.target.error);
      });

      logger.info(`[MatrixCacheManager] Cleared cache for room ${roomId}`);
      return true;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error clearing room cache:', error);
      return false;
    }
  }

  /**
   * Clear all cache
   * @returns {Promise<boolean>} - Whether clearing was successful
   */
  async clearAllCache() {
    if (!this.initialized || !this.db) {
      logger.error('[MatrixCacheManager] Cannot clear all cache: not initialized');
      return false;
    }

    try {
      // Close the database
      this.db.close();

      // Delete the database
      await new Promise((resolve, reject) => {
        const request = window.indexedDB.deleteDatabase(`${DB_NAME}_${this.userId}`);
        request.onsuccess = () => resolve();
        request.onerror = (event) => reject(event.target.error);
      });

      // Reinitialize
      this.db = await this._openDatabase();

      logger.info('[MatrixCacheManager] Cleared all cache');
      return true;
    } catch (error) {
      logger.error('[MatrixCacheManager] Error clearing all cache:', error);
      return false;
    }
  }
}

// Create a singleton instance
const matrixCacheManager = new MatrixCacheManager();

export default matrixCacheManager;
