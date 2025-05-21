import logger from './logger';
import { saveWhatsAppStatus, isWhatsAppConnected as isWhatsAppConnectedLS } from './connectionStorage';

/**
 * ConnectionStorageDB - A utility for storing and retrieving connection status
 * using IndexedDB for persistence across sessions
 */
class ConnectionStorageDB {
  constructor() {
    this.dbName = 'dailyfix_connection_db';
    this.storeName = 'connection_status';
    this.dbVersion = 1;
    this.db = null;
    this.initPromise = this.initDB();
  }

  /**
   * Initialize the IndexedDB database
   */
  async initDB() {
    try {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);

        request.onerror = (event) => {
          logger.error('[ConnectionStorageDB] Error opening database:', event.target.error);
          reject(event.target.error);
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          logger.info('[ConnectionStorageDB] Database opened successfully');
          resolve(this.db);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: 'id' });
            logger.info('[ConnectionStorageDB] Object store created');
          }
        };
      });
    } catch (error) {
      logger.error('[ConnectionStorageDB] Error initializing database:', error);
      // Fallback to localStorage if IndexedDB fails
      return null;
    }
  }

  /**
   * Set WhatsApp connection status
   * @param {boolean} isConnected - Whether WhatsApp is connected
   * @param {string} userId - User ID
   */
  async setWhatsAppConnected(isConnected, userId = 'default') {
    try {
      await this.initPromise;
      
      if (!this.db) {
        // Fallback to localStorage
        saveWhatsAppStatus(isConnected, userId);
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const data = {
        id: `whatsapp_${userId}`,
        platform: 'whatsapp',
        isConnected,
        userId,
        timestamp: Date.now()
      };

      const request = store.put(data);

      request.onsuccess = () => {
        logger.info('[ConnectionStorageDB] WhatsApp connection status saved to IndexedDB');
        
        // Also update localStorage as a backup
        saveWhatsAppStatus(isConnected, userId);
        
        // Update Redux persist storage
        try {
          const persistData = localStorage.getItem('persist:onboarding');
          if (persistData) {
            const parsedData = JSON.parse(persistData);
            parsedData.whatsappConnected = JSON.stringify(isConnected);
            if (isConnected) {
              parsedData.isComplete = JSON.stringify(true);
              parsedData.currentStep = JSON.stringify('complete');
            }
            localStorage.setItem('persist:onboarding', JSON.stringify(parsedData));
          }
        } catch (e) {
          logger.error('[ConnectionStorageDB] Error updating Redux persist storage:', e);
        }
      };

      request.onerror = (event) => {
        logger.error('[ConnectionStorageDB] Error saving WhatsApp connection status:', event.target.error);
        // Fallback to localStorage
        saveWhatsAppStatus(isConnected, userId);
      };
    } catch (error) {
      logger.error('[ConnectionStorageDB] Error setting WhatsApp connection:', error);
      // Fallback to localStorage
      saveWhatsAppStatus(isConnected, userId);
    }
  }

  /**
   * Check if WhatsApp is connected
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Whether WhatsApp is connected
   */
  async isWhatsAppConnected(userId = 'default') {
    try {
      await this.initPromise;
      
      if (!this.db) {
        // Fallback to localStorage
        return isWhatsAppConnectedLS(userId);
      }

      return new Promise((resolve) => {
        const transaction = this.db.transaction([this.storeName], 'readonly');
        const store = transaction.objectStore(this.storeName);
        const request = store.get(`whatsapp_${userId}`);

        request.onsuccess = (event) => {
          const data = event.target.result;
          if (data && data.isConnected) {
            logger.info('[ConnectionStorageDB] WhatsApp connected according to IndexedDB');
            resolve(true);
          } else {
            // If not found in IndexedDB, check localStorage
            const localStorageResult = isWhatsAppConnectedLS(userId);
            if (localStorageResult) {
              logger.info('[ConnectionStorageDB] WhatsApp connected according to localStorage');
              
              // Update IndexedDB with the localStorage value
              this.setWhatsAppConnected(true, userId);
            }
            resolve(localStorageResult);
          }
        };

        request.onerror = () => {
          logger.error('[ConnectionStorageDB] Error checking WhatsApp connection status');
          // Fallback to localStorage
          resolve(isWhatsAppConnectedLS(userId));
        };
      });
    } catch (error) {
      logger.error('[ConnectionStorageDB] Error checking WhatsApp connection:', error);
      // Fallback to localStorage
      return isWhatsAppConnectedLS(userId);
    }
  }

  /**
   * Clear all connection data
   */
  async clearAll() {
    try {
      await this.initPromise;
      
      if (!this.db) {
        // Fallback to localStorage
        localStorage.removeItem('dailyfix_connection_status');
        return;
      }

      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => {
        logger.info('[ConnectionStorageDB] All connection data cleared from IndexedDB');
        // Also clear localStorage
        localStorage.removeItem('dailyfix_connection_status');
      };

      request.onerror = (event) => {
        logger.error('[ConnectionStorageDB] Error clearing connection data:', event.target.error);
      };
    } catch (error) {
      logger.error('[ConnectionStorageDB] Error clearing connection data:', error);
      // Fallback to localStorage
      localStorage.removeItem('dailyfix_connection_status');
    }
  }
}

// Create a singleton instance
const connectionStorageDB = new ConnectionStorageDB();

// Export convenience methods
export const setWhatsAppConnectedDB = (isConnected, userId) => 
  connectionStorageDB.setWhatsAppConnected(isConnected, userId);

export const isWhatsAppConnectedDB = (userId) => 
  connectionStorageDB.isWhatsAppConnected(userId);

export const clearConnectionDataDB = () => 
  connectionStorageDB.clearAll();

export default connectionStorageDB;
