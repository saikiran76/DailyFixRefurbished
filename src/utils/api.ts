import axios from 'axios';
import { supabase } from '@/utils/supabase';
import { tokenManager } from '@/utils/tokenManager';
import logger from '@/utils/logger';

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

// Update the response interceptor to handle auth errors consistently
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

    // Don't retry if this is already a retry
    if (originalRequest?._isRetry) {
      logger.error('[API] Retry failed, triggering session expired event');
      
      // Dispatch session-expired event to match our new event handler
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('session-expired'));
      }
      
      return Promise.reject(error);
    }

    // Only handle 401/403 errors
    if (error.response?.status === 401 || error.response?.status === 403) {
      // Don't retry for certain paths
      const skipRefreshPaths = [
        '/auth/login',
        '/auth/logout',
        '/auth/refresh',
        '/auth/register'
      ];
      
      if (originalRequest && skipRefreshPaths.some(path => originalRequest.url?.includes(path))) {
        logger.info(`[API] Skipping token refresh for auth path: ${originalRequest.url}`);
        return Promise.reject(error);
      }

      const now = Date.now();

      // Check if we're refreshing too frequently
      if (now - lastRefreshTime < minRefreshInterval) {
        logger.warn('[API] Token refresh attempted too soon after previous refresh');
        refreshAttempts++;

        // If we've tried too many times in quick succession, trigger session expired
        if (refreshAttempts >= maxRefreshAttempts) {
          logger.error(`[API] Maximum refresh attempts (${maxRefreshAttempts}) reached`);
          refreshAttempts = 0; // Reset for future attempts

          // Dispatch session-expired event to match our new event handler
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('session-expired'));
            logger.info('[API] Session expired event dispatched due to max refresh attempts');
          }

          return Promise.reject(error);
        }
      } else {
        // Reset attempts counter if enough time has passed
        refreshAttempts = 1;
      }

      lastRefreshTime = now;
      logger.info('[API] Received 401/403 error, attempting to refresh token');

      // Use a single refresh promise for multiple concurrent requests
      if (refreshPromise) {
        logger.info('[API] Using existing refresh promise');
        try {
          const newToken = await refreshPromise;
          if (newToken) {
            logger.info('[API] Token refreshed successfully via shared promise, retrying request');
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
            api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
            originalRequest._isRetry = true;
            return api(originalRequest);
          }
        } catch (e) {
          logger.error('[API] Shared refresh promise failed:', e);
        }
      }

      // Create a new refresh promise
      try {
        refreshPromise = tokenManager.refreshToken();
        const newToken = await refreshPromise;
        refreshPromise = null;

        if (newToken) {
          logger.info('[API] Token refreshed successfully, retrying request');
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
          originalRequest._isRetry = true;
          return api(originalRequest);
        } else {
          logger.error('[API] Token refresh returned null token');
          
          // Dispatch session-expired event to match our new event handler
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('session-expired'));
            logger.info('[API] Session expired event dispatched due to null refresh token');
          }

          return Promise.reject(error);
        }
      } catch (refreshError) {
        logger.error('[API] Error refreshing token:', refreshError);
        refreshPromise = null;
        
        // Dispatch session-expired event to match our new event handler
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('session-expired'));
          logger.info('[API] Session expired event dispatched due to refresh error');
        }

        return Promise.reject(error);
      }
    }

    // For other errors, simply reject the promise
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