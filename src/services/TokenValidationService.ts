import { tokenManager } from '../utils/tokenManager';
import { executeAtomically } from '../utils/atomicOperations';
import logger from '../utils/logger';

const VALIDATION_CACHE_TIME = 60000; // 1 minute
const TOKEN_REFRESH_BUFFER = 300000; // 5 minutes

class TokenValidationService {
  constructor() {
    this.validationCache = new Map(); // userId -> { token, timestamp }
    this.validationPromises = new Map(); // userId -> Promise
  }

  async validateToken(userId, token, forceRefresh = false) {
    try {
      return await executeAtomically(`validate-${userId}`, async () => {
        // Check cache first
        if (!forceRefresh) {
          const cached = this.validationCache.get(userId);
          if (cached && Date.now() - cached.timestamp < VALIDATION_CACHE_TIME) {
            return cached.token === token;
          }
        }

        // Check if validation is already in progress
        const existingPromise = this.validationPromises.get(userId);
        if (existingPromise) {
          return existingPromise;
        }

        const validationPromise = this._performValidation(userId, token);
        this.validationPromises.set(userId, validationPromise);

        try {
          const isValid = await validationPromise;
          this.validationCache.set(userId, {
            token,
            timestamp: Date.now()
          });
          return isValid;
        } finally {
          this.validationPromises.delete(userId);
        }
      });
    } catch (error) {
      logger.info('[TokenValidation] Error validating token:', error);
      return false;
    }
  }

  async ensureValidToken(userId) {
    try {
      return await executeAtomically(`ensure-${userId}`, async () => {
        const token = await tokenManager.getValidToken(userId);
        if (!token) {
          throw new Error('No valid token available');
        }

        const isValid = await this.validateToken(userId, token);
        if (!isValid) {
          // Try one refresh
          const newToken = await tokenManager.getValidToken(userId, true);
          if (!newToken || !await this.validateToken(userId, newToken, true)) {
            throw new Error('Token validation failed after refresh');
          }
          return newToken;
        }

        return token;
      });
    } catch (error) {
      logger.info('[TokenValidation] Error ensuring valid token:', error);
      throw error;
    }
  }

  async _performValidation(userId, token) {
    try {
      // Check token expiration
      const decoded = this._decodeToken(token);
      if (!decoded) return false;

      const now = Math.floor(Date.now() / 1000);
      if (decoded.exp <= now + TOKEN_REFRESH_BUFFER) {
        return false;
      }

      // Verify with backend
      const response = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ userId })
      });

      return response.ok;
    } catch (error) {
      logger.info('[TokenValidation] Validation failed:', error);
      return false;
    }
  }

  _decodeToken(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      return JSON.parse(jsonPayload);
    } catch (error) {
      logger.info('[TokenValidation] Token decode failed:', error);
      return null;
    }
  }

  clearCache(userId) {
    this.validationCache.delete(userId);
  }
}

export const tokenValidationService = new TokenValidationService(); 