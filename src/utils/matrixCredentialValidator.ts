import logger from './logger';

/**
 * Utility to validate and fix Matrix credentials
 */
const matrixCredentialValidator = {
  /**
   * Validate and fix Matrix credentials
   * @param {Object} credentials - The credentials to validate
   * @returns {Object} - The validated and fixed credentials
   */
  validateCredentials(credentials) {
    if (!credentials) {
      logger.error('[matrixCredentialValidator] No credentials provided');
      return null;
    }

    // Create a copy to avoid modifying the original
    const validatedCredentials = { ...credentials };

    // Check for required fields
    if (!validatedCredentials.userId) {
      logger.error('[matrixCredentialValidator] Missing userId in credentials');
      return null;
    }

    if (!validatedCredentials.accessToken) {
      logger.error('[matrixCredentialValidator] Missing accessToken in credentials');
      return null;
    }

    // Ensure we have a homeserver
    if (!validatedCredentials.homeserver) {
      logger.warn('[matrixCredentialValidator] Missing homeserver in credentials, using default');
      validatedCredentials.homeserver = 'https://dfix-hsbridge.duckdns.org';
    }

    // Ensure we have a deviceId
    if (!validatedCredentials.deviceId) {
      logger.warn('[matrixCredentialValidator] Missing deviceId in credentials, generating one');
      validatedCredentials.deviceId = `DFIX_WEB_${Date.now()}`;
    }

    // Log the validated credentials (without the full access token)
    logger.info('[matrixCredentialValidator] Validated credentials:', {
      ...validatedCredentials,
      accessToken: validatedCredentials.accessToken ? 
        `${validatedCredentials.accessToken.substring(0, 5)}...${validatedCredentials.accessToken.substring(validatedCredentials.accessToken.length - 5)}` : 
        'missing'
    });

    return validatedCredentials;
  },

  /**
   * Validate credentials from localStorage
   * @param {string} key - The localStorage key
   * @returns {Object|null} - The validated credentials or null
   */
  validateFromLocalStorage(key) {
    try {
      const storedData = localStorage.getItem(key);
      if (!storedData) {
        return null;
      }

      const credentials = JSON.parse(storedData);
      return this.validateCredentials(credentials);
    } catch (error) {
      logger.error(`[matrixCredentialValidator] Error validating credentials from localStorage key ${key}:`, error);
      return null;
    }
  },

  /**
   * Validate credentials from API response
   * @param {Object} response - The API response
   * @returns {Object|null} - The validated credentials or null
   */
  validateFromApiResponse(response) {
    try {
      if (!response || !response.data || !response.data.credentials) {
        logger.error('[matrixCredentialValidator] Invalid API response format');
        return null;
      }

      return this.validateCredentials(response.data.credentials);
    } catch (error) {
      logger.error('[matrixCredentialValidator] Error validating credentials from API response:', error);
      return null;
    }
  }
};

export default matrixCredentialValidator;
