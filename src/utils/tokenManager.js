import logger from './logger';
import { supabase } from './supabase';
import { toast } from 'react-hot-toast';

class TokenManager {
  constructor() {
    this.tokens = new Map();
    this.sessionMonitorInterval = null;

    // Start session monitoring when the TokenManager is created
    this.startSessionMonitoring();
  }

  // CRITICAL FIX: Periodically check session validity
  startSessionMonitoring() {
    // Clear any existing interval
    if (this.sessionMonitorInterval) {
      clearInterval(this.sessionMonitorInterval);
    }

    // Check session validity every 5 minutes
    this.sessionMonitorInterval = setInterval(async () => {
      try {
        // Only run checks if we're on a protected route
        const isProtectedRoute = !window.location.pathname.includes('/login') &&
                                !window.location.pathname.includes('/signup') &&
                                !window.location.pathname.includes('/auth/callback');

        if (!isProtectedRoute) {
          return; // Don't check on non-protected routes
        }

        logger.info('[TokenManager] Performing periodic session check');

        // Check if session is about to expire
        const expiryStr = localStorage.getItem('session_expiry');
        if (expiryStr) {
          try {
            const expiryTime = new Date(expiryStr).getTime();
            const currentTime = Date.now();
            const timeRemaining = expiryTime - currentTime;

            // If session expires in less than 30 minutes, try to refresh it proactively
            if (timeRemaining < 30 * 60 * 1000 && timeRemaining > 0) {
              logger.info(`[TokenManager] Session expires in ${Math.round(timeRemaining/60000)} minutes, refreshing proactively`);
              await this.refreshToken();
            }
            // If session has already expired, show notification
            else if (timeRemaining <= 0) {
              logger.warn('[TokenManager] Session has expired during periodic check');

              // Try to refresh one last time
              const newToken = await this.refreshToken();
              if (!newToken) {
                // CRITICAL FIX: Use the global session expired event instead of toast
                // This will trigger the SessionExpiredModal to show
                logger.info('[TokenManager] Session expired during periodic check, triggering global session expired event');

                // Dispatch a custom event that the App component will listen for
                const sessionExpiredEvent = new CustomEvent('sessionExpired', {
                  detail: { reason: 'session_expired' }
                });
                window.dispatchEvent(sessionExpiredEvent);

                // Don't redirect automatically - the modal will handle this
                // This prevents the jarring page refresh experience
              }
            }
          } catch (e) {
            logger.error('[TokenManager] Error checking session expiry:', e);
          }
        }
      } catch (error) {
        logger.error('[TokenManager] Error in session monitoring:', error);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  // Track token validation attempts to prevent infinite loops
  validationAttempts = 0;
  maxValidationAttempts = 3;
  validationPromise = null;
  lastValidationTime = 0;
  minValidationInterval = 2000; // 2 seconds

  async getValidToken(userId = 'default', forceRefresh = false) {
    try {
      // If we've already detected that no refresh token is available, don't try to validate
      if (this._noRefreshTokenDetected) {
        logger.warn('[TokenManager] No refresh token available, skipping token validation');

        // Dispatch the session expired event again if needed
        if (typeof window !== 'undefined') {
          const sessionExpiredEvent = new CustomEvent('supabase-session-expired', {
            detail: { reason: 'no-refresh-token' }
          });
          window.dispatchEvent(sessionExpiredEvent);
        }

        return null;
      }

      // CRITICAL FIX: Prevent multiple simultaneous validation attempts
      const now = Date.now();
      if (this.validationPromise) {
        logger.info('[TokenManager] Token validation already in progress, waiting for it to complete');
        return this.validationPromise;
      }

      // CRITICAL FIX: Prevent too frequent validation attempts
      if (now - this.lastValidationTime < this.minValidationInterval && !forceRefresh) {
        logger.info('[TokenManager] Token validation attempted too soon after previous validation, using cached token');
        const cachedToken = localStorage.getItem('access_token');
        if (cachedToken) {
          return cachedToken;
        }
      }

      // CRITICAL FIX: Prevent infinite validation loops
      if (this.validationAttempts >= this.maxValidationAttempts) {
        logger.error(`[TokenManager] Maximum validation attempts (${this.maxValidationAttempts}) reached, using cached token if available`);
        this.validationAttempts = 0;

        // Try to use any available token as a fallback
        const cachedToken = localStorage.getItem('access_token');
        if (cachedToken) {
          return cachedToken;
        }

        // If no token is available, show a non-refreshing toast
        // toast.error('Authentication error. Please refresh the page.');
        return null;
      }

      this.validationAttempts++;
      this.lastValidationTime = now;

      // Create a promise for this validation attempt
      this.validationPromise = (async () => {
        try {
          // CRITICAL FIX: Check token expiration with better error handling
          const checkTokenExpiration = () => {
            try {
              const expiryStr = localStorage.getItem('session_expiry');
              if (!expiryStr) return true; // If no expiry, assume expired

              const expiryTime = new Date(expiryStr).getTime();
              const currentTime = Date.now();
              // Add a 5-minute buffer to ensure we refresh before expiration
              const isExpired = expiryTime - currentTime < 5 * 60 * 1000;

              if (isExpired) {
                logger.info('[TokenManager] Token is expired or expiring soon');
              }

              return isExpired;
            } catch (e) {
              logger.error('[TokenManager] Error checking token expiration:', e);
              return true; // Assume expired on error
            }
          };

          const isTokenExpired = checkTokenExpiration();

          // Try to get token from multiple sources with better error handling
          let token = null;
          let tokenSource = null;

          // Try dailyfix_auth
          try {
            const dailyfixAuth = localStorage.getItem('dailyfix_auth');
            if (dailyfixAuth) {
              const authData = JSON.parse(dailyfixAuth);
              if (authData.session?.access_token || authData.access_token) {
                token = authData.session?.access_token || authData.access_token;
                tokenSource = 'dailyfix_auth';
              }
            }
          } catch (e) {
            logger.error('[TokenManager] Error getting token from dailyfix_auth:', e);
          }

          // Try access_token
          if (!token) {
            try {
              const accessToken = localStorage.getItem('access_token');
              if (accessToken) {
                token = accessToken;
                tokenSource = 'access_token';
              }
            } catch (e) {
              logger.error('[TokenManager] Error getting token from access_token:', e);
            }
          }

          logger.info('[TokenManager] Token check result:', {
            hasToken: !!token,
            tokenSource,
            userId,
            forceRefresh,
            isTokenExpired
          });

          // If token is expired or force refresh is requested, refresh immediately
          if (forceRefresh || isTokenExpired || !token) {
            logger.info('[TokenManager] Token expired or force refresh requested, refreshing token');
            return this.refreshToken(userId);
          }

          // If we have a valid token, use it
          if (token) {
            logger.info(`[TokenManager] Using token from ${tokenSource}`);
            return token;
          }

          // If we get here, we need to refresh the token
          logger.info('[TokenManager] No valid token found, attempting refresh');
          return this.refreshToken(userId);
        } catch (error) {
          logger.error('[TokenManager] Error in getValidToken inner try-catch:', error);

          // Try to use any available token as a fallback
          try {
            const cachedToken = localStorage.getItem('access_token');
            if (cachedToken) {
              return cachedToken;
            }
          } catch (e) {
            logger.error('[TokenManager] Error getting fallback token:', e);
          }

          return null;
        } finally {
          // CRITICAL FIX: Clear the promise reference to allow future validation attempts
          setTimeout(() => {
            this.validationPromise = null;
          }, 100);
        }
      })();

      return this.validationPromise;
    } catch (error) {
      logger.error('[TokenManager] Error in getValidToken outer try-catch:', error);
      this.validationPromise = null;

      // Try to use any available token as a last resort
      try {
        const cachedToken = localStorage.getItem('access_token');
        if (cachedToken) {
          return cachedToken;
        }
      } catch (e) {
        logger.error('[TokenManager] Error getting last resort token:', e);
      }

      return null;
    }
  }

  // Track refresh attempts to prevent infinite loops
  refreshAttempts = 0;
  maxRefreshAttempts = 3;
  refreshPromise = null;
  lastRefreshTime = 0;
  minRefreshInterval = 5000; // 5 seconds

  async refreshToken(userId = 'default') {
    try {
      // CRITICAL FIX: Prevent multiple simultaneous refresh attempts
      const now = Date.now();
      if (this.refreshPromise) {
        logger.info('[TokenManager] Token refresh already in progress, waiting for it to complete');
        return this.refreshPromise;
      }

      // CRITICAL FIX: Prevent too frequent refresh attempts
      if (now - this.lastRefreshTime < this.minRefreshInterval) {
        logger.info('[TokenManager] Token refresh attempted too soon after previous refresh, using cached token');
        const cachedToken = localStorage.getItem('access_token');
        if (cachedToken) {
          return cachedToken;
        }
      }

      // CRITICAL FIX: Prevent infinite refresh loops
      if (this.refreshAttempts >= this.maxRefreshAttempts) {
        logger.error(`[TokenManager] Maximum refresh attempts (${this.maxRefreshAttempts}) reached, forcing logout`);
        this.refreshAttempts = 0;
        this.clearTokens();

        // Don't redirect if we're already on the login page
        if (!window.location.pathname.includes('/login')) {
          // Use a non-refreshing toast to inform the user
          toast.error('Your session has expired. Please log in again.', {
            autoClose: 5000,
            hideProgressBar: false,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: true,
          });

          // Delay redirect to allow toast to be seen
          setTimeout(() => {
            window.location.href = '/login';
          }, 2000);
        }

        return null;
      }

      this.refreshAttempts++;
      this.lastRefreshTime = now;

      // Create a promise for this refresh attempt
      this.refreshPromise = (async () => {
        try {
          logger.info('[TokenManager] Attempting to refresh token');

          // CRITICAL FIX: Try multiple sources for refresh token
          let refreshToken = null;

          // First try to get refresh token from separate localStorage item
          refreshToken = localStorage.getItem('refresh_token');

          // If not found, try to get from dailyfix_auth
          if (!refreshToken) {
            const authData = localStorage.getItem('dailyfix_auth');
            if (authData) {
              try {
                const parsedAuthData = JSON.parse(authData);
                if (parsedAuthData.session && parsedAuthData.session.refresh_token) {
                  refreshToken = parsedAuthData.session.refresh_token;
                }
              } catch (parseError) {
                logger.error('[TokenManager] Error parsing dailyfix_auth:', parseError);
              }
            }
          }

          // CRITICAL FIX: Try to get from supabase directly as a last resort
          if (!refreshToken) {
            try {
              const { data: sessionData } = await supabase.auth.getSession();
              if (sessionData && sessionData.session && sessionData.session.refresh_token) {
                refreshToken = sessionData.session.refresh_token;
                logger.info('[TokenManager] Retrieved refresh token from supabase.auth.getSession()');
              }
            } catch (sessionError) {
              logger.error('[TokenManager] Error getting session from Supabase:', sessionError);
            }
          }

          if (!refreshToken) {
            logger.warn('[TokenManager] No refresh token found in any storage location');

            // Dispatch a custom event to notify the SessionExpirationHandler
            if (typeof window !== 'undefined') {
              const sessionExpiredEvent = new CustomEvent('supabase-session-expired', {
                detail: { reason: 'no-refresh-token' }
              });
              window.dispatchEvent(sessionExpiredEvent);
              logger.info('[TokenManager] Dispatched supabase-session-expired event');
            }

            // Set a flag to prevent repeated refresh attempts
            this._noRefreshTokenDetected = true;

            throw new Error('No refresh token found in any storage location');
          }

          logger.info('[TokenManager] Found refresh token, attempting to refresh session');

          // CRITICAL FIX: Implement a robust token refresh mechanism with proper error handling
          let data, error;
          let refreshAttempted = false;

          try {
            // STEP 1: First try to get a fresh session directly from Supabase
            // This is the most reliable method and avoids using refresh tokens
            logger.info('[TokenManager] Attempting to get current session first');
            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

            if (!sessionError && sessionData?.session?.access_token) {
              logger.info('[TokenManager] Successfully retrieved current session');
              data = sessionData;
              error = null;

              // Store the new tokens immediately
              try {
                if (sessionData.session.refresh_token) {
                  localStorage.setItem('refresh_token', sessionData.session.refresh_token);
                }
                if (sessionData.session.access_token) {
                  localStorage.setItem('access_token', sessionData.session.access_token);
                }
                if (sessionData.session.expires_at) {
                  localStorage.setItem('session_expiry', sessionData.session.expires_at);
                }
              } catch (storageError) {
                logger.error('[TokenManager] Error storing refreshed tokens:', storageError);
              }
            } else {
              // STEP 2: If direct session retrieval fails, try to refresh with our token
              logger.info('[TokenManager] Current session unavailable, attempting refresh');
              refreshAttempted = true;

              // Use a mutex to prevent concurrent refresh attempts
              if (window.isRefreshingToken) {
                logger.info('[TokenManager] Another refresh is in progress, waiting...');
                // Wait for the other refresh to complete (max 5 seconds)
                for (let i = 0; i < 10; i++) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                  if (!window.isRefreshingToken) {
                    // Try to get the session again after the other refresh completed
                    const { data: newSessionData } = await supabase.auth.getSession();
                    if (newSessionData?.session?.access_token) {
                      logger.info('[TokenManager] Using session from concurrent refresh');
                      data = newSessionData;
                      error = null;
                      break;
                    }
                  }
                }
              }

              // If we still don't have a session, try to refresh ourselves
              if (!data) {
                // Set the mutex to prevent concurrent refreshes
                window.isRefreshingToken = true;

                try {
                  // CRITICAL FIX: Add timeout to prevent hanging refresh requests
                  const refreshPromise = supabase.auth.refreshSession({
                    refresh_token: refreshToken
                  });

                  // Create a timeout promise
                  const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Token refresh timeout')), 10000);
                  });

                  // Race the refresh and timeout promises
                  const result = await Promise.race([refreshPromise, timeoutPromise]);
                  data = result.data;
                  error = result.error;

                  // CRITICAL FIX: Store the new tokens immediately if refresh succeeded
                  if (!error && data?.session) {
                    try {
                      if (data.session.refresh_token) {
                        localStorage.setItem('refresh_token', data.session.refresh_token);
                        logger.info('[TokenManager] Stored new refresh token');
                      }
                      if (data.session.access_token) {
                        localStorage.setItem('access_token', data.session.access_token);
                      }
                      if (data.session.expires_at) {
                        localStorage.setItem('session_expiry', data.session.expires_at);
                      }
                    } catch (storageError) {
                      logger.error('[TokenManager] Error storing refreshed tokens:', storageError);
                    }
                  }
                } finally {
                  // Always clear the mutex
                  window.isRefreshingToken = false;
                }
              }

              // STEP 3: Handle specific error cases
              if (error) {
                const errorMsg = error.message || '';

                // CRITICAL FIX: Handle "Already Used" error specifically
                if (errorMsg.includes('Already Used')) {
                  logger.warn('[TokenManager] Detected "Already Used" refresh token error');

                  // Clear the invalid refresh token
                  localStorage.removeItem('refresh_token');

                  // STEP 4: Try to recover using stored credentials
                  try {
                    // Try to get email/password from localStorage
                    const storedCredentials = localStorage.getItem('dailyfix_credentials');

                    if (storedCredentials) {
                      const { email, password } = JSON.parse(storedCredentials);

                      if (email && password) {
                        logger.info('[TokenManager] Found stored credentials, attempting silent re-authentication');
                        const signInResult = await supabase.auth.signInWithPassword({
                          email,
                          password
                        });

                        if (!signInResult.error && signInResult.data?.session) {
                          logger.info('[TokenManager] Successfully re-authenticated with stored credentials');
                          data = signInResult.data;
                          error = null;

                          // Store the new tokens
                          try {
                            if (data.session.refresh_token) {
                              localStorage.setItem('refresh_token', data.session.refresh_token);
                            }
                            if (data.session.access_token) {
                              localStorage.setItem('access_token', data.session.access_token);
                            }
                            if (data.session.expires_at) {
                              localStorage.setItem('session_expiry', data.session.expires_at);
                            }
                          } catch (storageError) {
                            logger.error('[TokenManager] Error storing new tokens after re-auth:', storageError);
                          }
                        } else {
                          logger.error('[TokenManager] Re-authentication failed:', signInResult.error);
                        }
                      }
                    } else {
                      logger.warn('[TokenManager] No stored credentials available for recovery');
                    }
                  } catch (credentialsError) {
                    logger.error('[TokenManager] Error using stored credentials:', credentialsError);
                  }
                } else if (errorMsg.includes('expired')) {
                  // Handle expired token errors
                  logger.warn('[TokenManager] Token expired, clearing invalid tokens');
                  localStorage.removeItem('refresh_token');
                  localStorage.removeItem('access_token');
                }
              }
            }
          } catch (refreshError) {
            logger.error('[TokenManager] Error during refresh process:', refreshError);
            error = refreshError;
          }

          // STEP 5: If all recovery attempts failed, show a user-friendly notification
          if (error && refreshAttempted) {
            // Only show this if we actually attempted a refresh (not on first load)
            try {
              // Check if we're on a protected route
              const isProtectedRoute = !window.location.pathname.includes('/login') &&
                                      !window.location.pathname.includes('/signup') &&
                                      !window.location.pathname.includes('/auth/callback');

              if (isProtectedRoute) {
                // CRITICAL FIX: Use the global session expired event instead of toast
                // This will trigger the SessionExpiredModal to show
                logger.info('[TokenManager] Session expired, triggering global session expired event');

                // Dispatch a custom event that the App component will listen for
                const sessionExpiredEvent = new CustomEvent('sessionExpired', {
                  detail: { reason: 'token_refresh_failed' }
                });
                window.dispatchEvent(sessionExpiredEvent);

                // Don't redirect automatically - the modal will handle this
                // This prevents the jarring page refresh experience
              }
            } catch (notificationError) {
              logger.error('[TokenManager] Error showing session expiry notification:', notificationError);
            }
          }

          if (error || !data || !data.session) {
            throw error || new Error('Failed to refresh token');
          }

          const session = data.session;

          // Log the refreshed session details
          logger.info('[TokenManager] Session refreshed successfully:', {
            hasAccessToken: !!session.access_token,
            hasRefreshToken: !!session.refresh_token,
            expiresAt: session.expires_at
          });

          // Reset refresh attempts on success
          this.refreshAttempts = 0;

          // Update stored tokens with comprehensive error handling
          try {
            const newAuthData = {
              session: {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: session.expires_at,
                expires_in: session.expires_in,
                token_type: session.token_type,
                provider_token: session.provider_token,
                provider_refresh_token: session.provider_refresh_token,
                user: session.user
              },
              user: session.user
            };

            // CRITICAL FIX: Use try-catch for each storage operation
            try {
              localStorage.setItem('dailyfix_auth', JSON.stringify(newAuthData));
            } catch (storageError) {
              logger.error('[TokenManager] Error saving to dailyfix_auth:', storageError);
            }

            try {
              localStorage.setItem('access_token', session.access_token);
            } catch (storageError) {
              logger.error('[TokenManager] Error saving to access_token:', storageError);
            }

            try {
              localStorage.setItem('refresh_token', session.refresh_token);
            } catch (storageError) {
              logger.error('[TokenManager] Error saving to refresh_token:', storageError);
            }

            try {
              localStorage.setItem('session_expiry', session.expires_at);
            } catch (storageError) {
              logger.error('[TokenManager] Error saving to session_expiry:', storageError);
            }

            // CRITICAL FIX: Also update the token in memory for immediate use
            this.tokens.set(userId, session.access_token);

            logger.info('[TokenManager] Token refreshed and stored successfully');
          } catch (storageError) {
            logger.error('[TokenManager] Error updating stored tokens:', storageError);
            // Even if storage fails, we can still return the token for immediate use
          }

          return session.access_token;
        } catch (error) {
          logger.error('[TokenManager] Token refresh failed:', error);
          return null;
        } finally {
          // CRITICAL FIX: Always clear the promise reference to allow future refresh attempts
          this.refreshPromise = null;
        }
      })();

      // Return the promise
      return this.refreshPromise;
    } catch (error) {
      logger.error('[TokenManager] Error in refreshToken outer try-catch:', error);
      // CRITICAL FIX: Clear the promise reference on error
      this.refreshPromise = null;
      return null;
    }
  }

  clearTokens(userId = 'default') {
    try {
      localStorage.removeItem('dailyfix_auth');
      localStorage.removeItem('access_token');
      this.tokens.delete(userId);
      logger.info('[TokenManager] Tokens cleared for user:', userId);
    } catch (error) {
      logger.info('[TokenManager] Error clearing tokens:', error);
    }
  }

  setToken(token, userId = 'default') {
    try {
      this.tokens.set(userId, token);
      localStorage.setItem('access_token', token);

      // Ensure the token is also set in the dailyfix_auth object
      const dailyfixAuth = localStorage.getItem('dailyfix_auth');
      if (dailyfixAuth) {
        const authData = JSON.parse(dailyfixAuth);
        if (authData.session) {
          authData.session.access_token = token;
        } else {
          authData.session = {
            access_token: token,
            refresh_token: null,
            expires_at: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
          };
        }
        localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
      }

      logger.info('[TokenManager] Token set for user:', userId);
    } catch (error) {
      logger.error('[TokenManager] Error setting token:', error);
    }
  }
}

export const tokenManager = new TokenManager();
export default tokenManager;