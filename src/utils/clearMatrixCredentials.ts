import logger from './logger';
import { saveToIndexedDB } from './indexedDBHelper';
import { MATRIX_CREDENTIALS_KEY } from '../constants';

/**
 * Utility to completely clear all Matrix credentials from all storage locations
 * @param {string} userId - The user ID to clear credentials for
 * @returns {Promise<void>}
 */
const clearMatrixCredentials = async (userId) => {
  try {
    logger.info('[clearMatrixCredentials] Clearing all Matrix credentials');
    
    // 1. Clear from IndexedDB
    try {
      await saveToIndexedDB(userId, { [MATRIX_CREDENTIALS_KEY]: null });
      logger.info('[clearMatrixCredentials] Cleared credentials from IndexedDB');
    } catch (indexedDBError) {
      logger.error('[clearMatrixCredentials] Error clearing from IndexedDB:', indexedDBError);
    }
    
    // 2. Clear from localStorage (custom key)
    try {
      const localStorageKey = `dailyfix_connection_${userId}`;
      const localStorageData = localStorage.getItem(localStorageKey);
      if (localStorageData) {
        const parsedData = JSON.parse(localStorageData);
        if (parsedData.matrix_credentials) {
          parsedData.matrix_credentials = null;
          localStorage.setItem(localStorageKey, JSON.stringify(parsedData));
        }
      }
      logger.info('[clearMatrixCredentials] Cleared credentials from localStorage (custom key)');
    } catch (localStorageError) {
      logger.error('[clearMatrixCredentials] Error clearing from localStorage (custom key):', localStorageError);
    }
    
    // 3. Clear from Element-style localStorage keys
    try {
      localStorage.removeItem('mx_access_token');
      localStorage.removeItem('mx_user_id');
      localStorage.removeItem('mx_device_id');
      localStorage.removeItem('mx_hs_url');
      localStorage.removeItem('mx_has_pickle_key');
      localStorage.removeItem('mx_is_guest');
      localStorage.removeItem('mx_last_room_id');
      localStorage.removeItem('mx_local_settings');
      localStorage.removeItem('mx_sync_store');
      
      // Also clear any other Matrix-related keys
      Object.keys(localStorage).forEach(key => {
        if (key.startsWith('mx_') || key.includes('matrix') || key.includes('Matrix')) {
          localStorage.removeItem(key);
        }
      });
      
      logger.info('[clearMatrixCredentials] Cleared credentials from localStorage (Element-style)');
    } catch (elementStorageError) {
      logger.error('[clearMatrixCredentials] Error clearing from localStorage (Element-style):', elementStorageError);
    }
    
    // 4. Clear global Matrix client
    if (window.matrixClient) {
      try {
        // Stop the client if it's running
        if (window.matrixClient.clientRunning) {
          await window.matrixClient.stopClient();
        }
        
        // Clear the global reference
        window.matrixClient = null;
        logger.info('[clearMatrixCredentials] Cleared global Matrix client');
      } catch (clientError) {
        logger.error('[clearMatrixCredentials] Error clearing global Matrix client:', clientError);
      }
    }
    
    logger.info('[clearMatrixCredentials] Successfully cleared all Matrix credentials');
  } catch (error) {
    logger.error('[clearMatrixCredentials] Error clearing Matrix credentials:', error);
  }
};

export default clearMatrixCredentials;
