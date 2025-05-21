/**
 * Cache Manager
 *
 * A utility for managing cached data using IndexedDB.
 * Provides methods for storing, retrieving, and invalidating cached data.
 */

import logger from './logger';

// Constants
const DB_NAME = 'matrix_cache';
const DB_VERSION = 1;
const STORES = {
  MESSAGES: 'messages',
  ROOMS: 'rooms',
  MEMBERS: 'members',
  MEDIA: 'media'
};

// Cache expiration time (in milliseconds)
const CACHE_EXPIRY = {
  MESSAGES: 24 * 60 * 60 * 1000, // 24 hours
  ROOMS: 12 * 60 * 60 * 1000,    // 12 hours
  MEMBERS: 6 * 60 * 60 * 1000,   // 6 hours
  MEDIA: 7 * 24 * 60 * 60 * 1000 // 7 days
};

class CacheManager {
  constructor() {
    this.db = null;
    this.isInitializing = false;
    this.initPromise = null;
  }

  /**
   * Initialize the database
   * @returns {Promise} - Promise that resolves when the database is initialized
   */
  async initialize() {
    if (this.db) {
      return Promise.resolve(this.db);
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = new Promise((resolve, reject) => {
      try {
        logger.info('[CacheManager] Initializing IndexedDB cache');
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // Create object stores if they don't exist
          if (!db.objectStoreNames.contains(STORES.MESSAGES)) {
            const messagesStore = db.createObjectStore(STORES.MESSAGES, { keyPath: 'id' });
            messagesStore.createIndex('roomId', 'roomId', { unique: false });
            messagesStore.createIndex('timestamp', 'timestamp', { unique: false });
            messagesStore.createIndex('roomId_timestamp', ['roomId', 'timestamp'], { unique: false });
          }

          if (!db.objectStoreNames.contains(STORES.ROOMS)) {
            const roomsStore = db.createObjectStore(STORES.ROOMS, { keyPath: 'id' });
            roomsStore.createIndex('lastUpdated', 'lastUpdated', { unique: false });
          }

          if (!db.objectStoreNames.contains(STORES.MEMBERS)) {
            const membersStore = db.createObjectStore(STORES.MEMBERS, { keyPath: 'id' });
            membersStore.createIndex('roomId', 'roomId', { unique: false });
            membersStore.createIndex('userId', 'userId', { unique: false });
          }

          if (!db.objectStoreNames.contains(STORES.MEDIA)) {
            const mediaStore = db.createObjectStore(STORES.MEDIA, { keyPath: 'url' });
            mediaStore.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          }

          logger.info('[CacheManager] Database schema created/updated');
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          this.isInitializing = false;
          logger.info('[CacheManager] Database initialized successfully');
          resolve(this.db);
        };

        request.onerror = (event) => {
          this.isInitializing = false;
          logger.error('[CacheManager] Database initialization error:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        this.isInitializing = false;
        logger.error('[CacheManager] Error initializing database:', error);
        reject(error);
      }
    });

    return this.initPromise;
  }

  /**
   * Store messages in the cache
   * @param {Array} messages - Array of message objects to store
   * @param {string} roomId - Room ID
   * @returns {Promise} - Promise that resolves when the messages are stored
   */
  async cacheMessages(messages, roomId) {
    if (!messages || !Array.isArray(messages) || messages.length === 0 || !roomId) {
      return Promise.resolve();
    }

    try {
      const db = await this.initialize();
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);

      // Add expiry timestamp to each message and make sure they're serializable
      const now = Date.now();
      const messagesWithExpiry = messages.map(message => {
        // Create a serializable version of the message by removing functions and circular references
        const serializableMessage = this._createSerializableMessage(message);

        return {
          ...serializableMessage,
          roomId,
          cachedAt: now,
          expiresAt: now + CACHE_EXPIRY.MESSAGES
        };
      });

      // Store each message
      const promises = messagesWithExpiry.map(message => {
        return new Promise((resolve, reject) => {
          const request = store.put(message);
          request.onsuccess = () => resolve();
          request.onerror = (event) => {
            logger.warn(`[CacheManager] Error caching message ${message.id}:`, event.target.error);
            reject(event.target.error);
          };
        });
      });

      await Promise.all(promises);
      logger.info(`[CacheManager] Cached ${messages.length} messages for room ${roomId}`);
      return true;
    } catch (error) {
      logger.error('[CacheManager] Error caching messages:', error);
      return false;
    }
  }

  /**
   * Create a serializable version of a message object
   * @param {Object} message - Message object
   * @returns {Object} - Serializable message object
   * @private
   */
  _createSerializableMessage(message) {
    // Create a new object with only the properties we need
    const serializableMessage = {
      id: message.id,
      body: message.body,
      timestamp: message.timestamp,
      sender: message.sender,
      senderName: message.senderName,
      isFromMe: message.isFromMe,
      isOptimistic: message.isOptimistic || false,
      replyToEventId: message.replyToEventId,
      content: message.content ? this._sanitizeContent(message.content) : null,
      replyToEvent: null // Initialize this property
    };

    // If there's a reply, make sure it's also serializable
    if (message.replyToEvent) {
      serializableMessage.replyToEvent = this._createSerializableMessage(message.replyToEvent);
    }

    return serializableMessage;
  }

  /**
   * Sanitize message content to ensure it's serializable
   * @param {Object} content - Message content object
   * @returns {Object} - Sanitized content object
   * @private
   */
  _sanitizeContent(content) {
    // Create a new object to avoid modifying the original
    const sanitized = {};

    // Only copy primitive values and simple objects
    for (const key in content) {
      const value = content[key];
      const type = typeof value;

      // Skip functions and complex objects that might cause issues
      if (type === 'function') continue;

      // Handle simple values directly
      if (type !== 'object' || value === null) {
        sanitized[key] = value;
        continue;
      }

      // Handle arrays by recursively sanitizing each element
      if (Array.isArray(value)) {
        sanitized[key] = value.map(item => {
          return typeof item === 'object' && item !== null
            ? this._sanitizeContent(item)
            : item;
        });
        continue;
      }

      // Handle nested objects recursively
      sanitized[key] = this._sanitizeContent(value);
    }

    return sanitized;
  }

  /**
   * Get cached messages for a room
   * @param {string} roomId - Room ID
   * @param {Object} options - Options for retrieving messages
   * @param {number} options.limit - Maximum number of messages to retrieve
   * @param {number} options.before - Retrieve messages before this timestamp
   * @param {number} options.after - Retrieve messages after this timestamp
   * @returns {Promise<Array>} - Promise that resolves with an array of messages
   */
  async getCachedMessages(roomId, options = {}) {
    if (!roomId) {
      return Promise.resolve([]);
    }

    const { limit = 100, before = Date.now(), after = 0 } = options;

    try {
      const db = await this.initialize();
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('roomId_timestamp');

      // Use a range to get messages for the room within the timestamp range
      const range = IDBKeyRange.bound([roomId, after], [roomId, before]);

      return new Promise((resolve, reject) => {
        const messages = [];
        const now = Date.now();

        const request = index.openCursor(range, 'prev'); // Get newest messages first

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor && messages.length < limit) {
            const message = cursor.value;

            // Skip expired messages
            if (message.expiresAt && message.expiresAt > now) {
              messages.push(message);
            }

            cursor.continue();
          } else {
            logger.info(`[CacheManager] Retrieved ${messages.length} cached messages for room ${roomId}`);
            resolve(messages);
          }
        };

        request.onerror = (event) => {
          logger.warn(`[CacheManager] Error retrieving cached messages for room ${roomId}:`, event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logger.error('[CacheManager] Error retrieving cached messages:', error);
      return [];
    }
  }

  /**
   * Invalidate cached messages for a room
   * @param {string} roomId - Room ID
   * @returns {Promise} - Promise that resolves when the messages are invalidated
   */
  async invalidateRoomMessages(roomId) {
    if (!roomId) {
      return Promise.resolve();
    }

    try {
      const db = await this.initialize();
      const transaction = db.transaction(STORES.MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('roomId');
      const range = IDBKeyRange.only(roomId);

      return new Promise((resolve, reject) => {
        const request = index.openCursor(range);

        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            logger.info(`[CacheManager] Invalidated cached messages for room ${roomId}`);
            resolve();
          }
        };

        request.onerror = (event) => {
          logger.warn(`[CacheManager] Error invalidating cached messages for room ${roomId}:`, event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logger.error('[CacheManager] Error invalidating cached messages:', error);
    }
  }

  /**
   * Cache media URL and data
   * @param {string} url - Media URL
   * @param {Blob|string} data - Media data (blob or base64 string)
   * @returns {Promise} - Promise that resolves when the media is cached
   */
  async cacheMedia(url, data) {
    if (!url || !data) {
      return Promise.resolve();
    }

    try {
      const db = await this.initialize();
      const transaction = db.transaction(STORES.MEDIA, 'readwrite');
      const store = transaction.objectStore(STORES.MEDIA);

      const now = Date.now();
      const mediaItem = {
        url,
        data,
        lastAccessed: now,
        cachedAt: now,
        expiresAt: now + CACHE_EXPIRY.MEDIA
      };

      return new Promise((resolve, reject) => {
        const request = store.put(mediaItem);

        request.onsuccess = () => {
          logger.info(`[CacheManager] Cached media for URL: ${url}`);
          resolve(true);
        };

        request.onerror = (event) => {
          logger.warn(`[CacheManager] Error caching media for URL ${url}:`, event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logger.error('[CacheManager] Error caching media:', error);
      return false;
    }
  }

  /**
   * Get cached media
   * @param {string} url - Media URL
   * @returns {Promise<Blob|string|null>} - Promise that resolves with the media data or null if not found
   */
  async getCachedMedia(url) {
    if (!url) {
      return Promise.resolve(null);
    }

    try {
      const db = await this.initialize();
      const transaction = db.transaction(STORES.MEDIA, 'readwrite'); // Use readwrite to update lastAccessed
      const store = transaction.objectStore(STORES.MEDIA);

      return new Promise((resolve, reject) => {
        const request = store.get(url);

        request.onsuccess = (event) => {
          const mediaItem = event.target.result;

          if (mediaItem) {
            const now = Date.now();

            // Check if the media has expired
            if (mediaItem.expiresAt && mediaItem.expiresAt < now) {
              // Media has expired, delete it
              store.delete(url);
              logger.info(`[CacheManager] Expired media removed for URL: ${url}`);
              resolve(null);
            } else {
              // Update last accessed time
              mediaItem.lastAccessed = now;
              store.put(mediaItem);

              logger.info(`[CacheManager] Retrieved cached media for URL: ${url}`);
              resolve(mediaItem.data);
            }
          } else {
            resolve(null);
          }
        };

        request.onerror = (event) => {
          logger.warn(`[CacheManager] Error retrieving cached media for URL ${url}:`, event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logger.error('[CacheManager] Error retrieving cached media:', error);
      return null;
    }
  }

  /**
   * Get cached messages for a room
   * @param {string} roomId - Room ID
   * @returns {Promise<Array>} - Array of cached messages
   */
  async getMessages(roomId) {
    if (!roomId) {
      logger.warn('[CacheManager] Cannot get messages: No roomId provided');
      return [];
    }

    try {
      const db = await this.initialize();
      const transaction = db.transaction(STORES.MESSAGES, 'readonly');
      const store = transaction.objectStore(STORES.MESSAGES);
      const index = store.index('roomId');

      return new Promise((resolve, reject) => {
        const request = index.getAll(roomId);

        request.onsuccess = (event) => {
          const messages = event.target.result || [];
          logger.info(`[CacheManager] Retrieved ${messages.length} cached messages for room ${roomId}`);
          resolve(messages);
        };

        request.onerror = (event) => {
          logger.warn(`[CacheManager] Error retrieving messages for room ${roomId}:`, event.target.error);
          reject(event.target.error);
        };
      });
    } catch (error) {
      logger.error('[CacheManager] Error getting cached messages:', error);
      return [];
    }
  }

  /**
   * Clean up expired cache entries
   * @returns {Promise} - Promise that resolves when cleanup is complete
   */
  async cleanupExpiredCache() {
    try {
      // Initialize the database first
      await this.initialize();
      const now = Date.now();

      // Clean up expired messages
      await this._cleanupStore(STORES.MESSAGES, 'expiresAt', now);

      // Clean up expired media
      await this._cleanupStore(STORES.MEDIA, 'expiresAt', now);

      logger.info('[CacheManager] Expired cache entries cleaned up');
      return true;
    } catch (error) {
      logger.error('[CacheManager] Error cleaning up expired cache:', error);
      return false;
    }
  }

  /**
   * Clean up a specific store
   * @param {string} storeName - Store name
   * @param {string} expiryField - Field name for expiry timestamp
   * @param {number} now - Current timestamp
   * @returns {Promise} - Promise that resolves when cleanup is complete
   */
  async _cleanupStore(storeName, expiryField, now) {
    const db = await this.initialize();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);

    return new Promise((resolve, reject) => {
      const request = store.openCursor();
      let deletedCount = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const item = cursor.value;
          if (item[expiryField] && item[expiryField] < now) {
            cursor.delete();
            deletedCount++;
          }
          cursor.continue();
        } else {
          logger.info(`[CacheManager] Deleted ${deletedCount} expired entries from ${storeName}`);
          resolve(deletedCount);
        }
      };

      request.onerror = (event) => {
        logger.warn(`[CacheManager] Error cleaning up ${storeName}:`, event.target.error);
        reject(event.target.error);
      };
    });
  }
}

// Create a singleton instance
const cacheManager = new CacheManager();

// Make it available globally
if (typeof window !== 'undefined') {
  window.cacheManager = cacheManager;
}

export default cacheManager;
