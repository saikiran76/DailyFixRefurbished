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
    'whatsapp_',
    'bugfix_'
  ];
  
  // List of keys to never remove, even if they match a problematic prefix
  const protectedKeys = [
    'persist:auth',
    'persist:onboarding',
    'persist:contacts',
    'persist:matrix',
    'dailyfix_auth',
    'supabase.auth.token',
    'supabase-auth-token',
    'supabase-auth'
  ];
  
  const clearedItems: string[] = [];
  
  try {
    // Get all keys from localStorage
    const allKeys = Object.keys(localStorage);
    
    // Filter for problematic keys but protect critical ones
    const keysToRemove = allKeys.filter(key => {
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
    const expiry = localStorage.getItem('session_expiry');
    
    // If we have some auth data but not all required pieces, it might be corrupted
    if (authDataStr && (!accessToken || !expiry)) {
      return true;
    }
    
    // Check if auth data is valid JSON
    if (authDataStr) {
      try {
        const authData = JSON.parse(authDataStr);
        // Check if auth data has expected structure
        if (!authData.user || !authData.access_token) {
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