import logger from './logger';
import { getSupabaseClient } from './supabase';

// Storage keys for auth state
const STATE_STORAGE_KEY = 'supabase_auth_state';
const REDIRECT_STORAGE_KEY = 'auth_redirect';


/**
 * Get the Google OAuth URL from Supabase directly
 * @returns {Promise<string>} The Google OAuth URL
 */
export const getGoogleAuthUrl = async () => {
  try {
    // Get the Supabase client instance
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
      logger.error('[GoogleAuth] Supabase client is not initialized');
      throw new Error('Authentication service is not available');
    }
    
    // Use the authorization code flow (PKCE) to get refresh tokens
    const callbackUrl = window.location.origin + '/auth/callback';
    logger.info('[GoogleAuth] Using callback URL:', callbackUrl);

    // Use Supabase's signInWithOAuth method with proper authorization code flow
    // Let Supabase handle the PKCE flow internally
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: callbackUrl,
        skipBrowserRedirect: false,
        scopes: 'email profile',
        queryParams: {
          // Request offline access for refresh tokens
          access_type: 'offline',
          // Force account selection
          prompt: 'select_account',
          // Use authorization code flow instead of implicit flow
          response_type: 'code'
        }
      }
    });

    // Store the state in localStorage for verification
    if (data?.url) {
      const url = new URL(data.url);
      const state = url.searchParams.get('state');
      if (state) {
        localStorage.setItem(STATE_STORAGE_KEY, state);
        logger.info('[GoogleAuth] Stored auth state in localStorage');
      }

      logger.info('[GoogleAuth] Generated auth URL:', data.url.substring(0, 50) + '...');
    }

    if (error) throw error;
    if (!data?.url) throw new Error('No URL returned from authentication provider');

    return data.url;
  } catch (error) {
    logger.error('[GoogleAuth] Error getting Google auth URL:', error);
    throw new Error('Failed to get Google authentication URL');
  }
};

/**
 * Initiate Google Sign-in process
 * This function gets the Google OAuth URL and redirects the user to it
 * @returns {Promise<void>}
 */
export const initiateGoogleSignIn = async (): Promise<void> => {
  try {
    logger.info('[GoogleAuth] Initiating Google sign-in');
    
    // Clean up any existing auth state to prevent conflicts
    cleanupAuthStorage();
    
    const url = await getGoogleAuthUrl();
    
    // Save current page URL to return to after sign-in
    try {
      localStorage.setItem(REDIRECT_STORAGE_KEY, window.location.pathname);
      logger.info('[GoogleAuth] Saved redirect path:', window.location.pathname);
    } catch (storageError) {
      logger.warn('[GoogleAuth] Failed to save redirect path:', storageError);
    }
    
    // Redirect to Google sign-in
    window.location.href = url;
  } catch (error) {
    logger.error('[GoogleAuth] Error initiating Google sign-in:', error);
    throw new Error('Failed to start Google authentication process');
  }
};

/**
 * Clean up any existing auth storage data
 */
const cleanupAuthStorage = () => {
  try {
    localStorage.removeItem(STATE_STORAGE_KEY);
    logger.info('[GoogleAuth] Cleaned up existing auth storage');
  } catch (error) {
    logger.warn('[GoogleAuth] Error cleaning up auth storage:', error);
  }
};

/**
 * Handle the Google OAuth callback
 * This is used by the SimpleAuthCallback component
 * @returns {Promise<Object>} The authentication result
 */
export const handleGoogleCallback = async () => {
  try {
    // Get the Supabase client instance
    const supabaseClient = getSupabaseClient();
    if (!supabaseClient) {
      logger.error('[GoogleAuth] Supabase client is not initialized');
      throw new Error('Authentication service is not available');
    }
    
    // Check for code parameter in URL (Authorization Code flow)
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    
    // Verify state if present
    const storedState = localStorage.getItem(STATE_STORAGE_KEY);
    if (state && storedState && state !== storedState) {
      logger.error('[GoogleAuth] State mismatch, possible CSRF attack');
      throw new Error('Security validation failed');
    }

    if (code) {
      logger.info('[GoogleAuth] Authorization code detected:', code.substring(0, 5) + '...');

      try {
        // Exchange the code for a session using Supabase's PKCE flow
        // Supabase internally handles the PKCE flow, no need to pass codeVerifier
        logger.info('[GoogleAuth] Exchanging code for session');
        const { data: exchangeData, error: exchangeError } = await supabaseClient.auth.exchangeCodeForSession(code);
        
        if (exchangeError) {
          logger.error('[GoogleAuth] Error exchanging code for session:', exchangeError);
          throw exchangeError;
        }
        
        if (!exchangeData?.session) {
          logger.error('[GoogleAuth] No session returned from exchangeCodeForSession');
          throw new Error('No session returned after code exchange');
        }
        
        logger.info('[GoogleAuth] Successfully exchanged code for session');
        
        // Clean up storage after successful authentication
        cleanupAuthStorage();
        
        return exchangeData;
      } catch (exchangeError) {
        logger.error('[GoogleAuth] Error in code exchange:', exchangeError);
        
        // Fallback to getSession if code exchange fails
        logger.info('[GoogleAuth] Falling back to getSession');
        const { data, error } = await supabaseClient.auth.getSession();
        
        if (error) {
          logger.error('[GoogleAuth] Error getting session:', error);
          throw error;
        }
        
        if (!data?.session) {
          logger.error('[GoogleAuth] No session returned from getSession');
          throw new Error('No session returned after Google sign-in');
        }
        
        logger.info('[GoogleAuth] Successfully obtained session after fallback');
        
        // Clean up storage after successful authentication
        cleanupAuthStorage();
        
        return data;
      }
    }

    // If no code is found, try getting the current session
    logger.info('[GoogleAuth] No authorization code found, trying to get current session');
    
    const { data, error } = await supabaseClient.auth.getSession();
    
    if (error) {
      logger.error('[GoogleAuth] Error getting session:', error);
      throw error;
    }
    
    if (!data?.session) {
      logger.warn('[GoogleAuth] No session found from getSession()');
      throw new Error('Authentication incomplete - no session found');
    }
    
    logger.info('[GoogleAuth] Successfully obtained existing session');
    
    // Clean up storage after successful authentication
    cleanupAuthStorage();
    
    return data;
  } catch (error) {
    // Clean up storage on error
    cleanupAuthStorage();
    logger.error('[GoogleAuth] Error handling Google callback:', error);
    throw error;
  }
};

/**
 * Get redirect path after successful authentication
 * @returns {string} The path to redirect to
 */
export const getAuthRedirectPath = (): string => {
  try {
    const redirectPath = localStorage.getItem(REDIRECT_STORAGE_KEY);
    // Clean up after reading
    localStorage.removeItem(REDIRECT_STORAGE_KEY);
    
    if (redirectPath) {
      logger.info('[GoogleAuth] Found redirect path:', redirectPath);
      return redirectPath;
    }
  } catch (error) {
    logger.warn('[GoogleAuth] Error reading redirect path:', error);
  }
  
  // Default redirect path
  return '/dashboard';
};