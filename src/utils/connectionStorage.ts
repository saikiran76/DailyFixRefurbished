/**
 * Connection Storage Utilities
 * 
 * Functions to manage platform connection states in localStorage
 * and retrieve connection status for different messaging platforms
 */

/**
 * Check if WhatsApp is connected based on localStorage data
 * @param userId User ID to check connection status for
 * @returns Whether WhatsApp is connected for this user
 */
export function isWhatsAppConnected(userId: string): boolean {
  try {
    // First, check the new connection status format
    const connectionStatusStr = localStorage.getItem('dailyfix_connection_status');
    if (connectionStatusStr) {
      const connectionStatus = JSON.parse(connectionStatusStr);
      if (connectionStatus.whatsapp === true) {
        return true;
      }
    }

    // Then, check user-specific format
    const userConnectionKey = `whatsapp_connected_${userId}`;
    const userConnected = localStorage.getItem(userConnectionKey);
    if (userConnected === 'true') {
      return true;
    }

    // Finally, check the auth data (older storage format)
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        if (authData.whatsappConnected === true) {
          return true;
        }
      } catch (e) {
        console.error('[ConnectionStorage] Error parsing auth data:', e);
      }
    }

    return false;
  } catch (error) {
    console.error('[ConnectionStorage] Error checking WhatsApp connection:', error);
    return false;
  }
}

/**
 * Save WhatsApp connection status to localStorage
 * This is used by the connectionStorageDB as a fallback and by the onboardingSlice
 * @param isConnected Whether WhatsApp is connected
 * @param userId User ID to set connection status for (optional)
 */
export function saveWhatsAppStatus(isConnected: boolean, userId?: string): void {
  try {
    // Update the connection status in the new format
    let connectionStatus: Record<string, boolean> = {};
    const connectionStatusStr = localStorage.getItem('dailyfix_connection_status');
    
    if (connectionStatusStr) {
      connectionStatus = JSON.parse(connectionStatusStr);
    }
    
    connectionStatus.whatsapp = isConnected;
    localStorage.setItem('dailyfix_connection_status', JSON.stringify(connectionStatus));
    
    // If userId is provided, also update user-specific format
    if (userId) {
      const userConnectionKey = `whatsapp_connected_${userId}`;
      localStorage.setItem(userConnectionKey, isConnected.toString());
    }
    
    // Update the auth data if it exists
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        authData.whatsappConnected = isConnected;
        localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
      } catch (e) {
        console.error('[ConnectionStorage] Error updating auth data:', e);
      }
    }
    
    console.info(`[ConnectionStorage] Set WhatsApp connection status to ${isConnected}`);
  } catch (error) {
    console.error('[ConnectionStorage] Error saving WhatsApp status:', error);
  }
}

/**
 * Set WhatsApp connection status in localStorage
 * @param userId User ID to set connection status for
 * @param isConnected Whether WhatsApp is connected
 */
export function setWhatsAppConnected(userId: string, isConnected: boolean): void {
  try {
    // Update the new connection status format
    let connectionStatus: Record<string, boolean> = {};
    const connectionStatusStr = localStorage.getItem('dailyfix_connection_status');
    
    if (connectionStatusStr) {
      connectionStatus = JSON.parse(connectionStatusStr);
    }
    
    connectionStatus.whatsapp = isConnected;
    localStorage.setItem('dailyfix_connection_status', JSON.stringify(connectionStatus));
    
    // Also update the user-specific format for backward compatibility
    const userConnectionKey = `whatsapp_connected_${userId}`;
    localStorage.setItem(userConnectionKey, isConnected.toString());
    
    // Update the auth data if it exists
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        authData.whatsappConnected = isConnected;
        localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
      } catch (e) {
        console.error('[ConnectionStorage] Error updating auth data:', e);
      }
    }
    
    console.info(`[ConnectionStorage] Set WhatsApp connection status to ${isConnected} for user ${userId}`);
  } catch (error) {
    console.error('[ConnectionStorage] Error setting WhatsApp connection:', error);
  }
}

/**
 * Clear all connection status data from localStorage
 */
export function clearConnectionStatus(): void {
  try {
    localStorage.removeItem('dailyfix_connection_status');
    
    // Also clear any user-specific connection status
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('whatsapp_connected_') || 
          key.startsWith('telegram_connected_')) {
        localStorage.removeItem(key);
      }
    });
    
    console.info('[ConnectionStorage] Cleared all connection status data');
  } catch (error) {
    console.error('[ConnectionStorage] Error clearing connection status:', error);
  }
}
