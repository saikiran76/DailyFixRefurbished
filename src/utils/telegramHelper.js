import { getFromIndexedDB } from './indexedDBHelper';
import logger from './logger';

/**
 * Check if Telegram is connected for a user
 * @param {string} userId - The user ID to check
 * @returns {Promise<boolean>} - Whether Telegram is connected
 */
export const isTelegramConnected = async (userId) => {
  if (!userId) {
    logger.warn('[telegramHelper] Cannot check Telegram connection without userId');
    return false;
  }

  try {
    // First check IndexedDB
    const userData = await getFromIndexedDB(userId);
    if (userData && userData.telegram === true) {
      logger.info('[telegramHelper] Found Telegram connection in IndexedDB');
      return true;
    }

    // Then check localStorage as fallback
    try {
      const connectionStatus = JSON.parse(localStorage.getItem('dailyfix_connection_status') || '{}');
      if (connectionStatus.telegram === true) {
        logger.info('[telegramHelper] Found Telegram connection in localStorage');
        return true;
      }
    } catch (localStorageError) {
      logger.error('[telegramHelper] Error checking localStorage for Telegram connection:', localStorageError);
    }

    // Check Matrix credentials in IndexedDB
    const matrixData = await getFromIndexedDB(userId);
    if (matrixData && matrixData.matrix_credentials) {
      logger.info('[telegramHelper] Found Matrix credentials in IndexedDB, checking for Telegram rooms');
      
      // If we have Matrix credentials, check for Telegram rooms
      const matrixUserId = matrixData.matrix_credentials.userId;
      if (matrixUserId) {
        // Check for cached rooms
        const cachedRoomsKey = `matrix_rooms_${matrixUserId}`;
        const cachedRoomsStr = localStorage.getItem(cachedRoomsKey);
        
        if (cachedRoomsStr) {
          try {
            const cachedRooms = JSON.parse(cachedRoomsStr);
            // Check if any room is a Telegram room (has "Telegram" in the name)
            const hasTelegramRoom = cachedRooms.some(room => 
              room.name === 'Telegram' || 
              (room.name && room.name.includes('(Telegram)'))
            );
            
            if (hasTelegramRoom) {
              logger.info('[telegramHelper] Found Telegram rooms in cached Matrix rooms');
              
              // Update connection status since we found Telegram rooms
              const connectionStatus = JSON.parse(localStorage.getItem('dailyfix_connection_status') || '{}');
              connectionStatus.telegram = true;
              localStorage.setItem('dailyfix_connection_status', JSON.stringify(connectionStatus));
              
              return true;
            }
          } catch (parseError) {
            logger.error('[telegramHelper] Error parsing cached Matrix rooms:', parseError);
          }
        }
      }
    }

    logger.info('[telegramHelper] No Telegram connection found');
    return false;
  } catch (error) {
    logger.error('[telegramHelper] Error checking Telegram connection:', error);
    return false;
  }
};

export default {
  isTelegramConnected
};
