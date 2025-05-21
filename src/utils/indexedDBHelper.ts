import logger from './logger';

const DB_NAME = 'dailyfix_db';
const DB_VERSION = 1;
const STORE_NAME = 'connection_status';

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>} The database instance
 */
const initDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      logger.error('[IndexedDB] Error opening database:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      const db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
        logger.info('[IndexedDB] Object store created');
      }
    };
  });
};

/**
 * Save connection status to IndexedDB
 * @param {string} userId - User ID
 * @param {Object} data - Connection status data
 * @returns {Promise<void>}
 */
export const saveToIndexedDB = async (userId, data) => {
  if (!userId) {
    logger.error('[IndexedDB] Cannot save without userId');
    return;
  }

  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Get existing data directly from the store to avoid transaction issues
    const getRequest = store.get(userId);

    return new Promise((resolve, reject) => {
      getRequest.onsuccess = (event) => {
        const existingData = event.target.result || {};
        const combinedData = { ...existingData, ...data, userId };

        // Put the combined data in the same transaction
        const putRequest = store.put(combinedData);

        putRequest.onsuccess = () => {
          logger.info('[IndexedDB] Data saved successfully');
          resolve();
        };

        putRequest.onerror = (event) => {
          logger.error('[IndexedDB] Error saving data:', event.target.error);
          reject(event.target.error);
        };
      };

      getRequest.onerror = (event) => {
        logger.error('[IndexedDB] Error getting existing data:', event.target.error);

        // Try to save without existing data
        try {
          const putRequest = store.put({ ...data, userId });

          putRequest.onsuccess = () => {
            logger.info('[IndexedDB] Data saved successfully (without existing data)');
            resolve();
          };

          putRequest.onerror = (putEvent) => {
            logger.error('[IndexedDB] Error saving data:', putEvent.target.error);
            reject(putEvent.target.error);
          };
        } catch (putError) {
          logger.error('[IndexedDB] Error in fallback put:', putError);
          reject(event.target.error);
        }
      };

      // Close the database when transaction completes
      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    logger.error('[IndexedDB] Error in saveToIndexedDB:', error);
    // Fallback to localStorage if IndexedDB fails
    try {
      const storageKey = `dailyfix_connection_${userId}`;
      const existingData = JSON.parse(localStorage.getItem(storageKey) || '{}');
      const combinedData = { ...existingData, ...data };
      localStorage.setItem(storageKey, JSON.stringify(combinedData));
      logger.info('[IndexedDB] Fallback to localStorage successful');
    } catch (storageError) {
      logger.error('[IndexedDB] Fallback to localStorage failed:', storageError);
    }
  }
};

/**
 * Get connection status from IndexedDB
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} Connection status data
 */
export const getFromIndexedDB = async (userId) => {
  if (!userId) {
    logger.error('[IndexedDB] Cannot get data without userId');
    return null;
  }

  try {
    const db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(userId);

    return new Promise((resolve, reject) => {
      request.onsuccess = (event) => {
        const result = event.target.result;
        resolve(result || null);
      };

      request.onerror = (event) => {
        logger.error('[IndexedDB] Error getting data:', event.target.error);
        reject(event.target.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    logger.error('[IndexedDB] Error in getFromIndexedDB:', error);

    // Fallback to localStorage if IndexedDB fails
    try {
      const storageKey = `dailyfix_connection_${userId}`;
      const data = JSON.parse(localStorage.getItem(storageKey) || '{}');
      logger.info('[IndexedDB] Fallback to localStorage for reading successful');
      return Object.keys(data).length > 0 ? data : null;
    } catch (storageError) {
      logger.error('[IndexedDB] Fallback to localStorage for reading failed:', storageError);
      return null;
    }
  }
};

/**
 * Check if a specific platform is connected
 * @param {string} userId - User ID
 * @param {string} platform - Platform name (e.g., 'telegram', 'whatsapp')
 * @returns {Promise<boolean>} Whether the platform is connected
 */
export const isPlatformConnected = async (userId, platform) => {
  if (!userId || !platform) {
    return false;
  }

  try {
    const data = await getFromIndexedDB(userId);
    return data && data[platform] === true;
  } catch (error) {
    logger.error(`[IndexedDB] Error checking if ${platform} is connected:`, error);
    return false;
  }
};
