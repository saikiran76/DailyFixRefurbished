import { supabase } from '../utils/supabase';
import logger from '../utils/logger';

class TokenService {
  constructor() {
    this.tokenRefreshPromise = null;
    this.lastRefresh = null;
    this.MIN_TOKEN_LIFETIME = 30000; // 30 seconds
    this.subscribers = new Set();
  }

  async getValidToken() {
    try {
      // Check if we're already refreshing
      if (this.tokenRefreshPromise) {
        logger.info('[TokenService] Token refresh in progress, waiting for completion');
        return this.tokenRefreshPromise;
      }

      // First check localStorage directly for a token
      try {
        const authDataStr = localStorage.getItem('dailyfix_auth');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          if (authData?.session?.access_token) {
            // Check if the token is still valid
            const isValid = this.validateToken(authData.session.access_token);
            if (isValid) {
              // Use the token from localStorage if valid
              logger.info('[TokenService] Using valid token from localStorage');
              return {
                access_token: authData.session.access_token,
                userId: authData.session.user?.id || authData.user?.id
              };
            } else {
              logger.warn('[TokenService] Token in localStorage is invalid or expired');
            }
          }
        }
      } catch (localStorageError) {
        logger.error('[TokenService] Error reading from localStorage:', localStorageError);
      }

      // If localStorage check fails, try to get from Supabase
      const { data: { session } } = await supabase.auth.getSession();
      
      logger.info('[TokenService] Session fetch result:', { 
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        userId: session?.user?.id
      });
      
      if (!session) {
        throw new Error('No session found');
      }

      // Check if token needs refresh
      if (this.shouldRefreshToken(session)) {
        logger.info('[TokenService] Token needs refresh, refreshing...');
        return this.refreshToken();
      }

      // Update localStorage with the fresh session
      try {
        const authDataStr = localStorage.getItem('dailyfix_auth');
        if (authDataStr) {
          const authData = JSON.parse(authDataStr);
          authData.session = session;
          localStorage.setItem('dailyfix_auth', JSON.stringify(authData));
          localStorage.setItem('access_token', session.access_token);
          logger.info('[TokenService] Updated localStorage with fresh session');
        }
      } catch (updateError) {
        logger.error('[TokenService] Error updating localStorage:', updateError);
      }

      return {
        access_token: session.access_token,
        userId: session.user.id
      };
    } catch (error) {
      logger.error('[TokenService] Failed to get valid token:', error);
      
      // Throw a more detailed error
      const enhancedError = new Error(`No session found: ${error.message}`);
      enhancedError.originalError = error;
      enhancedError.code = 'AUTH_SESSION_MISSING';
      throw enhancedError;
    }
  }

  shouldRefreshToken(session) {
    if (!session?.expires_at) return true;
    
    const expiresAt = session.expires_at * 1000; // Convert to milliseconds
    const now = Date.now();
    
    return (expiresAt - now) < this.MIN_TOKEN_LIFETIME;
  }

  async refreshToken() {
    try {
      // Ensure only one refresh at a time
      if (this.tokenRefreshPromise) {
        return this.tokenRefreshPromise;
      }

      this.tokenRefreshPromise = (async () => {
        try {
          const { data, error } = await supabase.auth.refreshSession();
          
          if (error) throw error;
          if (!data.session) throw new Error('No session after refresh');

          this.lastRefresh = Date.now();
          
          const tokenData = {
            access_token: data.session.access_token,
            userId: data.session.user.id
          };

          // Notify subscribers of new token
          this._notifySubscribers(tokenData);
          
          return tokenData;
        } finally {
          this.tokenRefreshPromise = null;
        }
      })();

      return this.tokenRefreshPromise;
    } catch (error) {
      logger.error('Token refresh failed:', error);
      throw error;
    }
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  _notifySubscribers(tokenData) {
    this.subscribers.forEach(callback => {
      try {
        callback(tokenData);
      } catch (error) {
        logger.error('Error in token subscriber:', error);
      }
    });
  }

  validateToken(token) {
    if (!token) return false;
    
    try {
      // Basic JWT format validation
      const parts = token.split('.');
      if (parts.length !== 3) return false;

      // Validate header and payload are valid JSON
      const header = JSON.parse(atob(parts[0]));
      const payload = JSON.parse(atob(parts[1]));

      // Check required fields
      if (!header.alg || !payload.exp) return false;

      // Check expiration
      const expiresAt = payload.exp * 1000;
      if (Date.now() >= expiresAt) return false;

      return true;
    } catch (error) {
      logger.error('Token validation failed:', error);
      return false;
    }
  }

  async getValidTokens() {
    try {
      const tokenData = await this.getValidToken();
      return {
        accessToken: tokenData.access_token,
        userId: tokenData.userId
      };
    } catch (error) {
      logger.error('Failed to get valid tokens:', error);
      throw error;
    }
  }
}

export const tokenService = new TokenService();
export default tokenService; 