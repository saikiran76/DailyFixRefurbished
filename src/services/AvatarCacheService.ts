/**
 * AvatarCacheService.js
 * Service for caching avatar images in IndexedDB
 */

const DB_NAME = 'dailyfix-avatar-cache';
const DB_VERSION = 1;
const STORE_NAME = 'avatars';

class AvatarCacheService {
  constructor() {
    this.db = null;
    this.initPromise = this.initDB();
  }

  /**
   * Initialize the IndexedDB database
   */
  async initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (event) => {
        console.error('Error opening avatar cache database:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('Avatar cache database opened successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create object store for avatars
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          
          // Create indexes for efficient querying
          store.createIndex('contactId', 'contactId', { unique: false });
          store.createIndex('userId', 'userId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          
          console.log('Avatar object store created');
        }
      };
    });
  }

  /**
   * Get an avatar from the cache
   * @param {string} userId - The user ID
   * @param {string} contactId - The contact ID
   * @param {string} mediaId - The media ID
   * @returns {Promise<Object|null>} The cached avatar or null if not found
   */
  async getAvatar(userId, contactId, mediaId) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        // Create a composite key
        const id = `${userId}:${contactId}:${mediaId}`;
        const request = store.get(id);
        
        request.onsuccess = (event) => {
          const result = event.target.result;
          if (result) {
            console.log(`Avatar found in cache: ${id}`);
            // Check if the avatar is expired (older than 7 days)
            const now = Date.now();
            const age = now - result.timestamp;
            const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
            
            if (age > maxAge) {
              console.log(`Avatar expired: ${id}, age: ${age}ms`);
              resolve(null);
            } else {
              resolve(result);
            }
          } else {
            console.log(`Avatar not found in cache: ${id}`);
            resolve(null);
          }
        };
        
        request.onerror = (event) => {
          console.error('Error getting avatar from cache:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in getAvatar:', error);
        resolve(null); // Resolve with null instead of rejecting to prevent errors
      }
    });
  }

  /**
   * Store an avatar in the cache
   * @param {string} userId - The user ID
   * @param {string} contactId - The contact ID
   * @param {string} mediaId - The media ID
   * @param {Blob} blob - The avatar image blob
   * @param {string} contentType - The content type of the image
   * @returns {Promise<void>}
   */
  async storeAvatar(userId, contactId, mediaId, blob, contentType) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Create a composite key
        const id = `${userId}:${contactId}:${mediaId}`;
        
        // Store the avatar with metadata
        const avatar = {
          id,
          userId,
          contactId,
          mediaId,
          blob,
          contentType,
          timestamp: Date.now()
        };
        
        const request = store.put(avatar);
        
        request.onsuccess = () => {
          console.log(`Avatar stored in cache: ${id}`);
          resolve();
        };
        
        request.onerror = (event) => {
          console.error('Error storing avatar in cache:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in storeAvatar:', error);
        resolve(); // Resolve instead of rejecting to prevent errors
      }
    });
  }

  /**
   * Delete an avatar from the cache
   * @param {string} userId - The user ID
   * @param {string} contactId - The contact ID
   * @param {string} mediaId - The media ID
   * @returns {Promise<void>}
   */
  async deleteAvatar(userId, contactId, mediaId) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        // Create a composite key
        const id = `${userId}:${contactId}:${mediaId}`;
        const request = store.delete(id);
        
        request.onsuccess = () => {
          console.log(`Avatar deleted from cache: ${id}`);
          resolve();
        };
        
        request.onerror = (event) => {
          console.error('Error deleting avatar from cache:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in deleteAvatar:', error);
        resolve(); // Resolve instead of rejecting to prevent errors
      }
    });
  }

  /**
   * Clear all avatars for a specific user
   * @param {string} userId - The user ID
   * @returns {Promise<void>}
   */
  async clearUserAvatars(userId) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('userId');
        
        const request = index.openCursor(IDBKeyRange.only(userId));
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            console.log(`All avatars cleared for user: ${userId}`);
            resolve();
          }
        };
        
        request.onerror = (event) => {
          console.error('Error clearing user avatars:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in clearUserAvatars:', error);
        resolve(); // Resolve instead of rejecting to prevent errors
      }
    });
  }

  /**
   * Clear expired avatars (older than specified days)
   * @param {number} days - Number of days after which avatars are considered expired
   * @returns {Promise<number>} Number of deleted avatars
   */
  async clearExpiredAvatars(days = 7) {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        
        const maxAge = days * 24 * 60 * 60 * 1000; // Convert days to milliseconds
        const cutoffTime = Date.now() - maxAge;
        
        let deletedCount = 0;
        
        const request = index.openCursor(IDBKeyRange.upperBound(cutoffTime));
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            deletedCount++;
            cursor.continue();
          } else {
            console.log(`Cleared ${deletedCount} expired avatars`);
            resolve(deletedCount);
          }
        };
        
        request.onerror = (event) => {
          console.error('Error clearing expired avatars:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in clearExpiredAvatars:', error);
        resolve(0); // Resolve with 0 instead of rejecting to prevent errors
      }
    });
  }

  /**
   * Get the total size of the avatar cache
   * @returns {Promise<number>} Size in bytes
   */
  async getCacheSize() {
    await this.initPromise;
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        
        const request = store.openCursor();
        let size = 0;
        
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            const avatar = cursor.value;
            if (avatar.blob && avatar.blob.size) {
              size += avatar.blob.size;
            }
            cursor.continue();
          } else {
            console.log(`Avatar cache size: ${size} bytes`);
            resolve(size);
          }
        };
        
        request.onerror = (event) => {
          console.error('Error calculating cache size:', event.target.error);
          reject(event.target.error);
        };
      } catch (error) {
        console.error('Error in getCacheSize:', error);
        resolve(0); // Resolve with 0 instead of rejecting to prevent errors
      }
    });
  }
}

// Create a singleton instance
const avatarCacheService = new AvatarCacheService();
export default avatarCacheService;
