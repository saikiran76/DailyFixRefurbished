/**
 * Session Recovery Utilities
 * 
 * Functions to help recover from problematic authentication states
 * and clear problematic localStorage items
 */

/**
 * Utility function to clear problematic localStorage items
 * that might be causing issues with the authentication flow.
 * 
 * @returns {string[]} Array of cleared items
 */
export const clearProblematicStorage = (): string[] => {
  // List of problematic prefixes to clean up
  const problematicPrefixes = [
    'matrix_',
    'crossTabClient:', 
    'socket_',
    'temp_',
    'bugfix_'
  ];
  
  // CRITICAL FIX: Remove 'whatsapp_' from problematic prefixes to prevent accidental
  // removal of WhatsApp connection status when tokens are being checked
  
  // List of keys to never remove, even if they match a problematic prefix
  const protectedKeys = [
    // CRITICAL FIX: Added explicit protection for auth tokens
    'refresh_token',
    'access_token',
    'session_expiry',
    'token_expires_at',
    'dailyfix_auth',
    'persist:auth',
    'persist:onboarding',
    'persist:contacts',
    'persist:matrix',
    'supabase.auth.token',
    'supabase-auth-token',
    'supabase-auth',
    'whatsapp_connected' // Protect WhatsApp connection status
  ];
  
  const clearedItems: string[] = [];
  
  try {
    // Get all keys from localStorage
    const allKeys = Object.keys(localStorage);
    
    // Filter for problematic keys but protect critical ones
    const keysToRemove = allKeys.filter(key => {
      // CRITICAL FIX: Never remove any keys that might be related to authorization
      if (key.includes('token') || 
          key.includes('auth') || 
          key.includes('session') ||
          key.includes('expires')) {
        return false;
      }
      
      // Never remove protected keys
      if (protectedKeys.some(pk => key.includes(pk))) {
        return false;
      }
      
      // Remove if it has a problematic prefix
      return problematicPrefixes.some(prefix => key.startsWith(prefix));
    });
    
    // Remove filtered keys
    keysToRemove.forEach(key => {
      localStorage.removeItem(key);
      clearedItems.push(key);
    });
    
    return clearedItems;
  } catch (error) {
    // In case of errors, log but don't throw (non-blocking)
    console.error('[SessionRecovery] Error clearing problematic storage:', error);
    return [];
  }
};

/**
 * Check if there are any signs of a corrupted session state
 */
export function hasCorruptedSessionState(): boolean {
  try {
    // Check for incomplete or corrupted auth data
    const authDataStr = localStorage.getItem('dailyfix_auth');
    const accessToken = localStorage.getItem('access_token');
    const refreshToken = localStorage.getItem('refresh_token');
    const expiry = localStorage.getItem('session_expiry');
    
    // CRITICAL FIX: If we have refresh_token but not access_token, that's not corrupted
    // It just means the access token expired but we can still refresh it
    if (refreshToken && !accessToken) {
      return false;
    }
    
    // If we have some auth data but not all required pieces, it might be corrupted
    if (authDataStr && (!accessToken && !refreshToken)) {
      return true;
    }
    
    // Check if auth data is valid JSON
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        // Check if auth data has expected structure
        if (!authData.session && !authData.user && !authData.access_token) {
          return true;
        }
      } catch (e) {
        // Failed to parse JSON - definitely corrupted
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('[SessionRecovery] Error checking session state:', error);
    return true; // Assume corrupted if we can't check
  }
} 