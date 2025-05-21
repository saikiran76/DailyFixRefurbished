import axios from 'axios';
import { supabase } from './supabase';
import { tokenManager } from './tokenManager';
import logger from './logger';

// Standard response structure
export const ResponseStatus = {
  SUCCESS: 'success',
  ERROR: 'error',
  RATE_LIMITED: 'rate_limited',
  PARTIAL: 'partial'
};

// Standard error types
export const ErrorTypes = {
  TOKEN_EXPIRED: 'token_expired',
  TOKEN_INVALID: 'token_invalid',
  RATE_LIMIT: 'rate_limit',
  API_ERROR: 'api_error',
  NETWORK_ERROR: 'network_error',
  VALIDATION_ERROR: 'validation_error',
  SERVICE_UNAVAILABLE: 'service_unavailable'
};

// API response validator
export const validateResponse = (data, schema) => {
  if (!data) return false;

  for (const [key, type] of Object.entries(schema)) {
    if (!(key in data)) return false;
    if (typeof data[key] !== type) return false;
  }

  return true;
};

// Standard response schemas
export const ResponseSchemas = {
  servers: {
    id: 'string',
    name: 'string',
    icon: 'string'
  },
  directMessages: {
    id: 'string',
    recipients: 'object'
  },
  status: {
    status: 'string',
    message: 'string'
  }
};

// Create unified API instance
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:4000",
  timeout: 180000, // 180 seconds
  withCredentials: false, // Changed from true to false to avoid CORS issues
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  }
});

// Initialize tracking arrays if they don't exist
if (typeof window !== 'undefined') {
  window._pendingRequests = window._pendingRequests || [];
  window._socketConnections = window._socketConnections || [];
}

// Add request interceptor to set auth token and track requests
api.interceptors.request.use(async (config) => {
  try {
    // CRITICAL FIX: Track this request with an AbortController
    if (typeof window !== 'undefined' && window.AbortController) {
      const controller = new AbortController();
      config.signal = controller.signal;
      window._pendingRequests.push(controller);

      // Add a unique ID to the request for tracking
      config._requestId = Date.now() + Math.random().toString(36).substring(2, 9);
    }

    // Get token from token manager
    let token = null;

    try {
      token = await tokenManager.getValidToken();
    } catch (tokenError) {
      console.error('[API] Error getting token from tokenManager:', tokenError);

      // Fallback token retrieval if tokenManager fails
      token = localStorage.getItem('access_token');

      // If token not found in access_token, try to get from dailyfix_auth
      if (!token) {
        const authDataStr = localStorage.getItem('dailyfix_auth');
        if (authDataStr) {
          try {
            const authData = JSON.parse(authDataStr);
            token = authData.session?.access_token;
            logger.info('[API] Retrieved token from dailyfix_auth');
          } catch (e) {
            logger.error('[API] Error parsing auth data:', e);
          }
        }
      }

      // If still no token, try to get from persist:auth (Redux persisted state)
      if (!token) {
        const authStr = localStorage.getItem('persist:auth');
        if (authStr) {
          try {
            const authData = JSON.parse(authStr);
            const sessionData = JSON.parse(authData.session);
            token = sessionData?.access_token;
            logger.info('[API] Retrieved token from persist:auth');
          } catch (e) {
            logger.error('[API] Error parsing persisted auth data:', e);
          }
        }
      }
    }

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      logger.info('[API] Added Authorization header');
    } else {
      logger.warn('[API] No token available for request');
    }

    return config;
  } catch (error) {
    logger.error('[API] Error setting auth token:', error);
    return config;
  }
}, (error) => {
  return Promise.reject(error);
});

// Track refresh attempts to prevent infinite loops
let refreshAttempts = 0;
const maxRefreshAttempts = 3;
let refreshPromise = null;
let lastRefreshTime = 0;
const minRefreshInterval = 5000; // 5 seconds

// Add response interceptor to handle token refresh and clean up tracked requests
api.interceptors.response.use(
  (response) => {
    // CRITICAL FIX: Remove this request from the tracking array
    if (typeof window !== 'undefined' && window._pendingRequests && response.config?._requestId) {
      const index = window._pendingRequests.findIndex(controller =>
        controller._requestId === response.config._requestId
      );
      if (index !== -1) {
        window._pendingRequests.splice(index, 1);
      }
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // CRITICAL FIX: Remove this request from the tracking array
    if (typeof window !== 'undefined' && window._pendingRequests && originalRequest?._requestId) {
      const index = window._pendingRequests.findIndex(controller =>
        controller._requestId === originalRequest._requestId
      );
      if (index !== -1) {
        window._pendingRequests.splice(index, 1);
      }
    }

    // CRITICAL FIX: Improved token refresh handling with multiple safeguards
    if ((error.response?.status === 401 || error.response?.status === 403) && !originalRequest._retry) {
      // CRITICAL FIX: Prevent multiple retries of the same request
      originalRequest._retry = true;

      // Dispatch a custom event to notify the SessionExpirationHandler
      if (error.response?.status === 403 &&
          typeof originalRequest.url === 'string' &&
          originalRequest.url.includes('supabase.co/auth/v1')) {
        logger.warn('[API] Detected Supabase auth 403 error, dispatching session expired event');

        if (typeof window !== 'undefined') {
          const sessionExpiredEvent = new CustomEvent('supabase-session-expired', {
            detail: { reason: 'auth-403-error' }
          });
          window.dispatchEvent(sessionExpiredEvent);
          logger.info('[API] Dispatched supabase-session-expired event');

          // Don't attempt to refresh the token if we've already dispatched the session expired event
          return Promise.reject(error);
        }
      }

      // CRITICAL FIX: Prevent too many refresh attempts in a short period
      const now = Date.now();
      if (now - lastRefreshTime < minRefreshInterval) {
        logger.warn('[API] Token refresh attempted too soon after previous refresh');
        refreshAttempts++;

        // If we've tried too many times in quick succession, show a non-refreshing error
        if (refreshAttempts >= maxRefreshAttempts) {
          logger.error(`[API] Maximum refresh attempts (${maxRefreshAttempts}) reached`);
          refreshAttempts = 0; // Reset for future attempts

          // CRITICAL FIX: Use the global session expired event instead of toast
          // This will trigger the SessionExpiredModal to show
          logger.info('[API] Maximum refresh attempts reached, triggering global session expired event');

          // Dispatch a custom event that the App component will listen for
          const sessionExpiredEvent = new CustomEvent('sessionExpired', {
            detail: { reason: 'max_attempts_reached' }
          });
          window.dispatchEvent(sessionExpiredEvent);

          // Don't redirect, just return the error
          return Promise.reject(error);
        }
      } else {
        // Reset attempts counter if enough time has passed
        refreshAttempts = 1;
      }

      lastRefreshTime = now;
      logger.info('[API] Received 401 error, attempting to refresh token');

      // CRITICAL FIX: Use a single refresh promise for multiple concurrent requests
      if (refreshPromise) {
        logger.info('[API] Using existing refresh promise');
        try {
          const newToken = await refreshPromise;
          if (newToken) {
            logger.info('[API] Token refreshed successfully via shared promise, retrying request');
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
            return api(originalRequest);
          }
        } catch (e) {
          logger.error('[API] Shared refresh promise failed:', e);
          // Continue to create a new refresh promise
        }
      }

      // Create a new refresh promise
      refreshPromise = (async () => {
        try {
          // Force token refresh
          const newToken = await tokenManager.refreshToken();

          if (newToken) {
            logger.info('[API] Token refreshed successfully, retrying request');
            // Update the Authorization header with the new token
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            // Also update the default headers for future requests
            api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
            return newToken;
          } else {
            logger.error('[API] Token refresh returned null token');
            // CRITICAL FIX: Use the global session expired event instead of toast
            // This will trigger the SessionExpiredModal to show

            // Only trigger if we're not already on the login page and not in a modal
            if (!window.location.pathname.includes('/login') &&
                !window.location.pathname.includes('/auth/callback') &&
                !document.querySelector('.modal-open')) {

              logger.info('[API] Token refresh failed, triggering global session expired event');

              // Dispatch a custom event that the App component will listen for
              const sessionExpiredEvent = new CustomEvent('sessionExpired', {
                detail: { reason: 'token_refresh_failed' }
              });
              window.dispatchEvent(sessionExpiredEvent);

              // Don't redirect automatically - the modal will handle this
              // This prevents the jarring page refresh experience
            }
            return null;
          }
        } catch (refreshError) {
          logger.error('[API] Token refresh failed:', refreshError);
          // CRITICAL FIX: Use the global session expired event instead of toast
          // This will trigger the SessionExpiredModal to show

          // Only trigger if we're not already on the login page and not in a modal
          if (!window.location.pathname.includes('/login') &&
              !window.location.pathname.includes('/auth/callback') &&
              !document.querySelector('.modal-open')) {

            logger.info('[API] Token refresh error, triggering global session expired event');

            // Dispatch a custom event that the App component will listen for
            const sessionExpiredEvent = new CustomEvent('sessionExpired', {
              detail: { reason: 'refresh_error' }
            });
            window.dispatchEvent(sessionExpiredEvent);

            // Don't redirect automatically - the modal will handle this
            // This prevents the jarring page refresh experience
          }
          return null;
        } finally {
          // CRITICAL FIX: Clear the promise reference to allow future refresh attempts
          setTimeout(() => {
            refreshPromise = null;
          }, 100);
        }
      })();

      try {
        const newToken = await refreshPromise;
        if (newToken) {
          return api(originalRequest);
        }
      } catch (e) {
        logger.error('[API] Error waiting for refresh promise:', e);
      }
    }

    return Promise.reject(error);
  }
);

// Helper method to get current auth state
api.getAuthState = async () => {
  try {
    const token = await tokenManager.getValidToken();
    if (!token) return null;

    const session = await supabase.auth.getSession();
    return session?.data?.session || null;
  } catch (error) {
    console.error('Error getting auth state:', error);
    return null;
  }
};

export default api;