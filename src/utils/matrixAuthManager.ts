import * as matrixSdk from 'matrix-js-sdk';
import logger from './logger';
import { saveToIndexedDB, getFromIndexedDB } from './indexedDBHelper';
import { MATRIX_CREDENTIALS_KEY } from '../constants';

/**
 * Matrix Authentication Manager following Element Web practices
 * Handles token refresh, session persistence, and account recovery
 */
const matrixAuthManager = {
  /**
   * Get valid Matrix credentials, refreshing if necessary
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<Object>} - Valid Matrix credentials
   */
  async getValidCredentials(userId) {
    logger.info('[matrixAuthManager] Getting valid Matrix credentials');

    // Step 1: Try to get credentials from all storage locations
    const credentials = await this._getStoredCredentials(userId);

    if (credentials) {
      logger.info('[matrixAuthManager] Found stored credentials, validating');

      // Step 2: Validate the credentials
      try {
        const validCredentials = await this._validateCredentials(credentials);
        if (validCredentials) {
          logger.info('[matrixAuthManager] Credentials are valid');
          return validCredentials;
        }
      } catch (error) {
        logger.warn('[matrixAuthManager] Credentials validation failed:', error);
      }

      // Step 3: Try to refresh the token
      try {
        logger.info('[matrixAuthManager] Attempting to refresh token');
        const refreshedCredentials = await this._refreshToken(credentials);
        if (refreshedCredentials) {
          logger.info('[matrixAuthManager] Successfully refreshed token');
          return refreshedCredentials;
        }
      } catch (error) {
        logger.warn('[matrixAuthManager] Token refresh failed:', error);
      }

      // Step 4: Try to recover the session
      try {
        logger.info('[matrixAuthManager] Attempting session recovery');
        const recoveredCredentials = await this._recoverSession(credentials);
        if (recoveredCredentials) {
          logger.info('[matrixAuthManager] Successfully recovered session');
          return recoveredCredentials;
        }
      } catch (error) {
        logger.warn('[matrixAuthManager] Session recovery failed:', error);
      }
    }

    // Step 5: If all else fails, try to login with stored username/password
    try {
      logger.info('[matrixAuthManager] Attempting login with stored credentials');
      const loginCredentials = await this._loginWithStoredCredentials(userId);
      if (loginCredentials) {
        logger.info('[matrixAuthManager] Successfully logged in with stored credentials');
        return loginCredentials;
      }
    } catch (error) {
      logger.warn('[matrixAuthManager] Login with stored credentials failed:', error);
    }

    // If we get here, we couldn't get valid credentials
    logger.error('[matrixAuthManager] Failed to get valid Matrix credentials');
    return null;
  },

  /**
   * Get stored Matrix credentials from all storage locations
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<Object>} - Stored Matrix credentials
   */
  async _getStoredCredentials(userId) {
    // Try IndexedDB first
    try {
      const indexedDBData = await getFromIndexedDB(userId);
      if (indexedDBData && indexedDBData[MATRIX_CREDENTIALS_KEY]) {
        logger.info('[matrixAuthManager] Found credentials in IndexedDB');
        return indexedDBData[MATRIX_CREDENTIALS_KEY];
      }
    } catch (error) {
      logger.warn('[matrixAuthManager] Error getting credentials from IndexedDB:', error);
    }

    // Try localStorage
    try {
      // Try custom localStorage key
      const localStorageKey = `dailyfix_connection_${userId}`;
      const localStorageData = localStorage.getItem(localStorageKey);
      if (localStorageData) {
        const parsedData = JSON.parse(localStorageData);
        if (parsedData.matrix_credentials) {
          logger.info('[matrixAuthManager] Found credentials in localStorage (custom key)');
          return parsedData.matrix_credentials;
        }
      }

      // Try Element-style localStorage keys
      const mx_access_token = localStorage.getItem('mx_access_token');
      const mx_user_id = localStorage.getItem('mx_user_id');
      const mx_device_id = localStorage.getItem('mx_device_id');
      const mx_hs_url = localStorage.getItem('mx_hs_url');

      if (mx_access_token && mx_user_id) {
        logger.info('[matrixAuthManager] Found credentials in localStorage (Element-style)');
        return {
          accessToken: mx_access_token,
          userId: mx_user_id,
          deviceId: mx_device_id,
          homeserver: mx_hs_url || 'https://dfix-hsbridge.duckdns.org'
        };
      }
    } catch (error) {
      logger.warn('[matrixAuthManager] Error getting credentials from localStorage:', error);
    }

    // No credentials found
    logger.warn('[matrixAuthManager] No stored credentials found');
    return null;
  },

  /**
   * Validate Matrix credentials
   * @param {Object} credentials - Matrix credentials to validate
   * @returns {Promise<Object>} - Validated credentials
   */
  async _validateCredentials(credentials) {
    if (!credentials || !credentials.accessToken || !credentials.userId) {
      logger.warn('[matrixAuthManager] Invalid credentials format');
      return null;
    }

    try {
      // Create a temporary client to validate the token
      const tempClient = matrixSdk.createClient({
        baseUrl: credentials.homeserver || 'https://dfix-hsbridge.duckdns.org',
        accessToken: credentials.accessToken,
        userId: credentials.userId,
        useAuthorizationHeader: true
      });

      // Try a simple API call to validate the token
      await tempClient.whoami();

      logger.info('[matrixAuthManager] Credentials validated successfully');
      return credentials;
    } catch (error) {
      if (error.errcode === 'M_UNKNOWN_TOKEN' ||
          (error.message && error.message.includes('token')) ||
          (error.data && error.data.error && error.data.error.includes('token'))) {
        logger.warn('[matrixAuthManager] Token validation failed: token is invalid or expired');
        throw error;
      } else {
        logger.error('[matrixAuthManager] Token validation failed with unexpected error:', error);
        throw error;
      }
    }
  },

  /**
   * Refresh Matrix token
   * @param {Object} credentials - Matrix credentials with expired token
   * @returns {Promise<Object>} - Refreshed credentials
   */
  async _refreshToken(credentials) {
    // Element Web doesn't actually have a direct token refresh mechanism
    // Instead, it uses the stored device ID and password to log in again

    if (!credentials || !credentials.userId) {
      return null;
    }

    try {
      // Extract username from userId (e.g., @user123:example.com -> user123)
      const username = credentials.userId.split(':')[0].substring(1);

      // Create a temporary client for login
      const tempClient = matrixSdk.createClient({
        baseUrl: credentials.homeserver || 'https://dfix-hsbridge.duckdns.org'
      });

      // Try to login with stored password if available
      if (credentials.password) {
        // Note: Using the old login format as the new format seems to be causing issues
        const loginResponse = await tempClient.login('m.login.password', {
          user: username,
          password: credentials.password,
          device_id: credentials.deviceId, // Use the same device ID to maintain sessions
          initial_device_display_name: `DailyFix Web ${new Date().toISOString()}`
        });

        if (loginResponse && loginResponse.access_token) {
          const refreshedCredentials = {
            ...credentials,
            accessToken: loginResponse.access_token,
            deviceId: loginResponse.device_id || credentials.deviceId
          };

          // Save the refreshed credentials
          await this._saveCredentials(credentials.userId.split(':')[0].substring(1), refreshedCredentials);

          return refreshedCredentials;
        }
      }

      return null;
    } catch (error) {
      logger.error('[matrixAuthManager] Token refresh failed:', error);
      throw error;
    }
  },

  /**
   * Recover Matrix session
   * @param {Object} credentials - Matrix credentials
   * @returns {Promise<Object>} - Recovered credentials
   */
  async _recoverSession(credentials) {
    // Element Web uses a session store to recover sessions
    // We'll try to use the stored device ID to recover the session

    if (!credentials || !credentials.userId || !credentials.deviceId) {
      return null;
    }

    try {
      // Check for stored session data
      const sessionKey = `mx_session_${credentials.userId}`;
      const sessionData = localStorage.getItem(sessionKey);

      if (sessionData) {
        const parsedSession = JSON.parse(sessionData);

        // Create a temporary client for login
        const tempClient = matrixSdk.createClient({
          baseUrl: credentials.homeserver || 'https://dfix-hsbridge.duckdns.org'
        });

        // Try to login with session
        // Note: Using the old login format as the new format seems to be causing issues
        const loginResponse = await tempClient.login('m.login.token', {
          token: parsedSession.session,
          user: credentials.userId.split(':')[0].substring(1),
          device_id: credentials.deviceId,
          initial_device_display_name: `DailyFix Web ${new Date().toISOString()}`
        });

        if (loginResponse && loginResponse.access_token) {
          const recoveredCredentials = {
            ...credentials,
            accessToken: loginResponse.access_token,
            deviceId: loginResponse.device_id || credentials.deviceId
          };

          // Save the recovered credentials
          await this._saveCredentials(credentials.userId.split(':')[0].substring(1), recoveredCredentials);

          return recoveredCredentials;
        }
      }

      return null;
    } catch (error) {
      logger.error('[matrixAuthManager] Session recovery failed:', error);
      throw error;
    }
  },

  /**
   * Login with stored username/password
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<Object>} - Login credentials
   */
  async _loginWithStoredCredentials(userId) {
    // This is a last resort when we don't have valid credentials
    // but we know the username format and can try to login

    try {
      // Create username based on user ID (same format as registration)
      const username = `user${userId.replace(/-/g, '')}matrixttestkoraca`;

      // Create a temporary client for login
      const tempClient = matrixSdk.createClient({
        baseUrl: 'https://dfix-hsbridge.duckdns.org'
      });

      logger.info('[matrixAuthManager] Attempting login with username:', username);

      // Try to login with default password
      // This is a last resort and only works if the account was created with this password
      // Note: Using the old login format as the new format seems to be causing issues
      const loginResponse = await tempClient.login('m.login.password', {
        user: username,
        password: 'DailyFixSecurePassword2023!', // Default password
        initial_device_display_name: `DailyFix Web ${new Date().toISOString()}`
      });

      if (loginResponse && loginResponse.access_token) {
        const loginCredentials = {
          userId: loginResponse.user_id,
          accessToken: loginResponse.access_token,
          deviceId: loginResponse.device_id,
          homeserver: 'https://dfix-hsbridge.duckdns.org',
          password: 'DailyFixSecurePassword2023!' // Store password for future refreshes
        };

        // Save the login credentials
        await this._saveCredentials(userId, loginCredentials);

        return loginCredentials;
      }

      return null;
    } catch (error) {
      logger.error('[matrixAuthManager] Login with stored credentials failed:', error);
      throw error;
    }
  },

  /**
   * Save Matrix credentials to all storage locations
   * @param {string} userId - The Supabase user ID
   * @param {Object} credentials - Matrix credentials to save
   */
  async _saveCredentials(userId, credentials) {
    try {
      // Save to IndexedDB
      await saveToIndexedDB(userId, {
        [MATRIX_CREDENTIALS_KEY]: credentials
      });

      // Save to localStorage (custom key)
      const localStorageKey = `dailyfix_connection_${userId}`;
      const localStorageData = localStorage.getItem(localStorageKey);
      const parsedData = localStorageData ? JSON.parse(localStorageData) : {};
      parsedData.matrix_credentials = credentials;
      localStorage.setItem(localStorageKey, JSON.stringify(parsedData));

      // Save to Element-style localStorage keys
      localStorage.setItem('mx_access_token', credentials.accessToken);
      localStorage.setItem('mx_user_id', credentials.userId);
      localStorage.setItem('mx_device_id', credentials.deviceId);
      localStorage.setItem('mx_hs_url', credentials.homeserver);

      logger.info('[matrixAuthManager] Credentials saved successfully');
    } catch (error) {
      logger.error('[matrixAuthManager] Error saving credentials:', error);
      throw error;
    }
  },

  /**
   * Create a Matrix client with valid credentials
   * @param {Object} credentials - Valid Matrix credentials
   * @returns {Object} - Matrix client
   */
  createClient(credentials) {
    if (!credentials || !credentials.accessToken || !credentials.userId) {
      logger.error('[matrixAuthManager] Cannot create client: invalid credentials');
      return null;
    }

    try {
      // Create client options
      const clientOpts = {
        baseUrl: credentials.homeserver || 'https://dfix-hsbridge.duckdns.org',
        accessToken: credentials.accessToken,
        userId: credentials.userId,
        deviceId: credentials.deviceId,
        timelineSupport: true,
        useAuthorizationHeader: true
      };

      // Create the client
      const client = matrixSdk.createClient(clientOpts);

      logger.info('[matrixAuthManager] Matrix client created successfully');
      return client;
    } catch (error) {
      logger.error('[matrixAuthManager] Error creating Matrix client:', error);
      return null;
    }
  }
};

export default matrixAuthManager;
