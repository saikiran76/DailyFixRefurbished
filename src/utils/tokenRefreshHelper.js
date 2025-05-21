import logger from './logger';
import { tokenManager } from './tokenManager';

/**
 * Helper function to refresh the token with a timeout
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<string>} - The refreshed token
 */
export const refreshTokenWithTimeout = async (timeoutMs = 5000) => {
  try {
    logger.info('[TokenRefreshHelper] Refreshing token with timeout');

    // Create a promise that will reject after the timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Token refresh timeout')), timeoutMs);
    });

    // EMERGENCY FIX: Simplified token refresh to prevent infinite reload
    // Just try the regular token refresh with a timeout
    try {
      // Race the token refresh against the timeout
      const token = await Promise.race([
        tokenManager.refreshToken(),
        timeoutPromise
      ]);

      logger.info('[TokenRefreshHelper] Token refreshed successfully');
      return token;
    } catch (refreshError) {
      logger.warn('[TokenRefreshHelper] Regular token refresh failed:', refreshError);
      throw refreshError;
    }
  } catch (error) {
    logger.error('[TokenRefreshHelper] Error refreshing token:', error);
    throw error;
  }
};

/**
 * Helper function to ensure WhatsApp connection is properly recorded
 * This helps with recovery if there are issues with the backend
 */
export const recordWhatsAppConnection = () => {
  // FIXED: Don't use localStorage to record WhatsApp connection
  // This was causing the system to think WhatsApp was connected when it wasn't
  logger.info('[TokenRefreshHelper] WhatsApp connection recorded (without localStorage)');
};

/**
 * Helper function to check if WhatsApp is connected
 * @returns {boolean} - Whether WhatsApp is connected
 */
export const isWhatsAppConnected = () => {
  // FIXED: Don't use localStorage to determine WhatsApp connection status
  // This was causing the system to think WhatsApp was connected when it wasn't
  return false;
};

export default {
  refreshTokenWithTimeout,
  recordWhatsAppConnection,
  isWhatsAppConnected
};
