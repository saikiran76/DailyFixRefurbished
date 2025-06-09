/**
 * Connection Storage Utilities
 * 
 * Functions to manage platform connection states in localStorage
 * and retrieve connection status for different messaging platforms
 */

/**
 * WhatsApp connection status type with verification state
 */
export type WhatsAppConnectionStatus = {
  isConnected: boolean;
  verified: boolean;
  lastVerified: number; // timestamp
  verificationAttempts: number;
};

/**
 * Telegram connection status type with verification state
 */
export type TelegramConnectionStatus = {
  isConnected: boolean;
  verified: boolean;
  lastVerified: number; // timestamp
  verificationAttempts: number;
};

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
 * Check if Telegram is connected based on localStorage data
 * @param userId User ID to check connection status for
 * @returns Whether Telegram is connected for this user
 */
export function isTelegramConnected(userId: string): boolean {
  try {
    // First, check the new connection status format
    const connectionStatusStr = localStorage.getItem('dailyfix_connection_status');
    if (connectionStatusStr) {
      const connectionStatus = JSON.parse(connectionStatusStr);
      if (connectionStatus.telegram === true) {
        return true;
      }
    }

    // Then, check user-specific format
    const userConnectionKey = `telegram_connected_${userId}`;
    const userConnected = localStorage.getItem(userConnectionKey);
    if (userConnected === 'true') {
      return true;
    }

    // Finally, check the auth data (older storage format)
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        if (authData.telegramConnected === true) {
          return true;
        }
      } catch (e) {
        console.error('[ConnectionStorage] Error parsing auth data:', e);
      }
    }

    return false;
  } catch (error) {
    console.error('[ConnectionStorage] Error checking Telegram connection:', error);
    return false;
  }
}

/**
 * Get detailed WhatsApp connection status including verification state
 * @param userId User ID to check connection status for
 * @returns Detailed connection status object or null if not found
 */
export function getWhatsAppConnectionStatus(userId: string): WhatsAppConnectionStatus | null {
  try {
    // First check for detailed status in the enhanced format
    const detailedStatusKey = `whatsapp_status_${userId}`;
    const detailedStatusStr = localStorage.getItem(detailedStatusKey);
    
    if (detailedStatusStr) {
      return JSON.parse(detailedStatusStr);
    }
    
    // If no detailed status exists, create one based on the simple connection state
    const isConnected = isWhatsAppConnected(userId);
    return {
      isConnected,
      verified: false, // Default to unverified
      lastVerified: 0,
      verificationAttempts: 0
    };
  } catch (error) {
    console.error('[ConnectionStorage] Error getting detailed WhatsApp status:', error);
    return null;
  }
}

/**
 * Get detailed Telegram connection status including verification state
 * @param userId User ID to check connection status for
 * @returns Detailed connection status object or null if not found
 */
export function getTelegramConnectionStatus(userId: string): TelegramConnectionStatus | null {
  try {
    // First check for detailed status in the enhanced format
    const detailedStatusKey = `telegram_status_${userId}`;
    const detailedStatusStr = localStorage.getItem(detailedStatusKey);
    
    if (detailedStatusStr) {
      return JSON.parse(detailedStatusStr);
    }
    
    // If no detailed status exists, create one based on the simple connection state
    const isConnected = isTelegramConnected(userId);
    return {
      isConnected,
      verified: false, // Default to unverified
      lastVerified: 0,
      verificationAttempts: 0
    };
  } catch (error) {
    console.error('[ConnectionStorage] Error getting detailed Telegram status:', error);
    return null;
  }
}

/**
 * Save detailed WhatsApp connection status
 * @param userId User ID to set connection status for
 * @param status Detailed status object
 */
export function saveWhatsAppConnectionStatus(userId: string, status: WhatsAppConnectionStatus): void {
  try {
    // Save the detailed status
    const detailedStatusKey = `whatsapp_status_${userId}`;
    localStorage.setItem(detailedStatusKey, JSON.stringify(status));
    
    // Also update the simple connection status for backward compatibility
    saveWhatsAppStatus(status.isConnected, userId);
    
    console.info(`[ConnectionStorage] Saved detailed WhatsApp status for user ${userId}: connected=${status.isConnected}, verified=${status.verified}`);
  } catch (error) {
    console.error('[ConnectionStorage] Error saving detailed WhatsApp status:', error);
  }
}

/**
 * Save detailed Telegram connection status
 * @param userId User ID to set connection status for
 * @param status Detailed status object
 */
export function saveTelegramConnectionStatus(userId: string, status: TelegramConnectionStatus): void {
  try {
    // Save the detailed status
    const detailedStatusKey = `telegram_status_${userId}`;
    localStorage.setItem(detailedStatusKey, JSON.stringify(status));
    
    // Also update the simple connection status for backward compatibility
    saveTelegramStatus(status.isConnected, userId);
    
    console.info(`[ConnectionStorage] Saved detailed Telegram status for user ${userId}: connected=${status.isConnected}, verified=${status.verified}`);
  } catch (error) {
    console.error('[ConnectionStorage] Error saving detailed Telegram status:', error);
  }
}

/**
 * Update verification attempts counter for WhatsApp
 * @param userId User ID to update
 * @param increment Whether to increment or reset the counter
 * @returns Updated number of attempts
 */
export function updateWhatsAppVerificationAttempts(userId: string, increment: boolean = true): number {
  try {
    const status = getWhatsAppConnectionStatus(userId);
    if (!status) {
      return increment ? 1 : 0;
    }
    
    const updatedStatus = {
      ...status,
      verificationAttempts: increment ? status.verificationAttempts + 1 : 0
    };
    
    saveWhatsAppConnectionStatus(userId, updatedStatus);
    return updatedStatus.verificationAttempts;
  } catch (error) {
    console.error('[ConnectionStorage] Error updating WhatsApp verification attempts:', error);
    return increment ? 1 : 0;
  }
}

/**
 * Update verification attempts counter for Telegram
 * @param userId User ID to update
 * @param increment Whether to increment or reset the counter
 * @returns Updated number of attempts
 */
export function updateTelegramVerificationAttempts(userId: string, increment: boolean = true): number {
  try {
    const status = getTelegramConnectionStatus(userId);
    if (!status) {
      return increment ? 1 : 0;
    }
    
    const updatedStatus = {
      ...status,
      verificationAttempts: increment ? status.verificationAttempts + 1 : 0
    };
    
    saveTelegramConnectionStatus(userId, updatedStatus);
    return updatedStatus.verificationAttempts;
  } catch (error) {
    console.error('[ConnectionStorage] Error updating Telegram verification attempts:', error);
    return increment ? 1 : 0;
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
 * Save Telegram connection status to localStorage
 * This is used by the connectionStorageDB as a fallback and by the onboardingSlice
 * @param isConnected Whether Telegram is connected
 * @param userId User ID to set connection status for (optional)
 */
export function saveTelegramStatus(isConnected: boolean, userId?: string): void {
  try {
    // Update the connection status in the new format
    let connectionStatus: Record<string, boolean> = {};
    const connectionStatusStr = localStorage.getItem('dailyfix_connection_status');
    
    if (connectionStatusStr) {
      try {
        connectionStatus = JSON.parse(connectionStatusStr);
      } catch (e) {
        console.error('[ConnectionStorage] Error parsing connection status:', e);
        connectionStatus = {};
      }
    }
    
    connectionStatus.telegram = isConnected;
    localStorage.setItem('dailyfix_connection_status', JSON.stringify(connectionStatus));
    
    // If userId is provided, also update user-specific format
    if (userId) {
      const userConnectionKey = `telegram_connected_${userId}`;
      localStorage.setItem(userConnectionKey, isConnected.toString());
    }
    
    // Update the auth data if it exists
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        authData.telegramConnected = isConnected;
        localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
      } catch (e) {
        console.error('[ConnectionStorage] Error updating auth data:', e);
      }
    }
    
    console.info(`[ConnectionStorage] Set Telegram connection status to ${isConnected}`);
  } catch (error) {
    console.error('[ConnectionStorage] Error saving Telegram status:', error);
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
 * Set Telegram connection status in localStorage
 * @param userId User ID to set connection status for
 * @param isConnected Whether Telegram is connected
 */
export function setTelegramConnected(userId: string, isConnected: boolean): void {
  try {
    // Update the new connection status format
    let connectionStatus: Record<string, boolean> = {};
    const connectionStatusStr = localStorage.getItem('dailyfix_connection_status');
    
    if (connectionStatusStr) {
      try {
        connectionStatus = JSON.parse(connectionStatusStr);
      } catch (e) {
        console.error('[ConnectionStorage] Error parsing connection status:', e);
        connectionStatus = {};
      }
    }
    
    connectionStatus.telegram = isConnected;
    localStorage.setItem('dailyfix_connection_status', JSON.stringify(connectionStatus));
    
    // Also update the user-specific format for backward compatibility
    const userConnectionKey = `telegram_connected_${userId}`;
    localStorage.setItem(userConnectionKey, isConnected.toString());
    
    // Update the auth data if it exists
    const authDataStr = localStorage.getItem('dailyfix_auth');
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        authData.telegramConnected = isConnected;
        localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
      } catch (e) {
        console.error('[ConnectionStorage] Error updating auth data:', e);
      }
    }
    
    console.info(`[ConnectionStorage] Set Telegram connection status to ${isConnected} for user ${userId}`);
  } catch (error) {
    console.error('[ConnectionStorage] Error setting Telegram connection:', error);
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
          key.startsWith('telegram_connected_') ||
          key.startsWith('whatsapp_status_') ||
          key.startsWith('telegram_status_')) {
        localStorage.removeItem(key);
      }
    });
    
    console.info('[ConnectionStorage] Cleared all connection status data');
  } catch (error) {
    console.error('[ConnectionStorage] Error clearing connection status:', error);
  }
}
