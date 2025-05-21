import * as matrixSdk from 'matrix-js-sdk';
import logger from './logger';
import { getFromIndexedDB } from './indexedDBHelper';
import { MATRIX_CREDENTIALS_KEY } from '../constants';
import { patchMatrixFetch } from './matrixFetchUtils';

/**
 * Utility for directly connecting to Matrix with a consistent password
 * This bypasses the token refresh mechanism and just creates a new client
 */
const matrixDirectConnect = {
  /**
   * Connect to Matrix using a secure approach
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<Object>} - The Matrix client
   */
  async connectToMatrix(userId) {
    try {
      logger.info('[matrixDirectConnect] Connecting to Matrix for user:', userId);

      // Check if we're connecting for Telegram, but only for initial connections, not refreshes
      const connectingToTelegram = sessionStorage.getItem('connecting_to_telegram') === 'true';
      const isTokenRefresh = sessionStorage.getItem('matrix_token_refreshing') === 'true';

      // Skip the check if this is a token refresh operation
      if (!connectingToTelegram && !isTokenRefresh) {
        // Check if we have an existing Matrix client that needs refreshing
        const existingClient = window.matrixClient;
        if (existingClient && existingClient.getUserId()) {
          // If we have an existing client, this is likely a refresh operation
          logger.info('[matrixDirectConnect] Existing Matrix client found, proceeding with refresh');
          // Set the refresh flag to avoid future checks during this refresh operation
          sessionStorage.setItem('matrix_token_refreshing', 'true');
        } else {
          logger.warn('[matrixDirectConnect] Not connecting to Telegram and not refreshing, aborting Matrix connection');
          throw new Error('Matrix connection is only needed for Telegram');
        }
      }

      // First, try to get existing credentials from localStorage or IndexedDB
      let existingCredentials = null;

      // Try to get from localStorage (custom key)
      try {
        const localStorageKey = `dailyfix_connection_${userId}`;
        const localStorageData = localStorage.getItem(localStorageKey);
        if (localStorageData) {
          const parsedData = JSON.parse(localStorageData);
          if (parsedData.matrix_credentials &&
              parsedData.matrix_credentials.userId &&
              parsedData.matrix_credentials.accessToken) {
            existingCredentials = parsedData.matrix_credentials;
            logger.info('[matrixDirectConnect] Found existing credentials in localStorage (custom key)');
          }
        }
      } catch (e) {
        logger.warn('[matrixDirectConnect] Failed to get credentials from localStorage (custom key):', e);
      }

      // If not found in localStorage, try IndexedDB
      if (!existingCredentials) {
        try {
          const indexedDBData = await getFromIndexedDB(userId);
          if (indexedDBData &&
              indexedDBData[MATRIX_CREDENTIALS_KEY] &&
              indexedDBData[MATRIX_CREDENTIALS_KEY].userId &&
              indexedDBData[MATRIX_CREDENTIALS_KEY].accessToken) {
            existingCredentials = indexedDBData[MATRIX_CREDENTIALS_KEY];
            logger.info('[matrixDirectConnect] Found existing credentials in IndexedDB');
          }
        } catch (e) {
          logger.warn('[matrixDirectConnect] Failed to get credentials from IndexedDB:', e);
        }
      }

      // If we found existing credentials, try to use them directly
      if (existingCredentials) {
        logger.info('[matrixDirectConnect] Attempting to use existing credentials');

        try {
          // Create a Matrix client with the existing credentials
          const client = matrixSdk.createClient({
            baseUrl: existingCredentials.homeserver || 'https://dfix-hsbridge.duckdns.org',
            accessToken: existingCredentials.accessToken,
            userId: existingCredentials.userId,
            deviceId: existingCredentials.deviceId,
            timelineSupport: true,
            useAuthorizationHeader: true
          });

          // Validate the credentials with a simple API call
          try {
            await client.whoami();
            logger.info('[matrixDirectConnect] Existing credentials are valid, using them');
            return client;
          } catch (validationError) {
            // If validation fails, we'll fall back to login/registration
            logger.warn('[matrixDirectConnect] Existing credentials are invalid, falling back to login/registration:', validationError);
          }
        } catch (clientError) {
          logger.warn('[matrixDirectConnect] Error creating client with existing credentials, falling back to login/registration:', clientError);
        }
      }

      // If we couldn't use existing credentials, we need to get new ones from the API
      // Apply fetch patch to prevent errors (patches global fetch)
      patchMatrixFetch();

      // Instead of trying to register or login directly, we should use the API
      logger.info('[matrixDirectConnect] Existing credentials are invalid or not found');

      // Try to get new credentials from the API
      try {
        logger.info('[matrixDirectConnect] Attempting to get new credentials from the API');

        // Import the API utility to ensure proper authentication headers
        const api = (await import('./api')).default;

        // Call the Matrix status API to get fresh credentials using the API utility
        // This endpoint calls matrixService.preCheckMatrixUser which includes token refresh logic
        const { data, error } = await api.get('/api/v1/matrix/status');

        if (error) {
          throw new Error(`API error: ${error}`);
        }

        if (!data || !data.credentials) {
          throw new Error('API response did not contain credentials');
        }

        // Create a Matrix client with the new credentials
        const newCredentials = data.credentials;

        // Store the credentials for future use
        try {
          const localStorageKey = `dailyfix_connection_${userId}`;
          const existingData = localStorage.getItem(localStorageKey);
          const parsedData = existingData ? JSON.parse(existingData) : {};
          parsedData.matrix_credentials = newCredentials;
          localStorage.setItem(localStorageKey, JSON.stringify(parsedData));

          // Also update IndexedDB if available
          try {
            const { saveToIndexedDB } = await import('./indexedDBHelper');
            const { MATRIX_CREDENTIALS_KEY } = await import('../constants');
            await saveToIndexedDB(userId, {
              [MATRIX_CREDENTIALS_KEY]: newCredentials
            });
          } catch (dbError) {
            logger.warn('[matrixDirectConnect] Error saving to IndexedDB:', dbError);
          }

          logger.info('[matrixDirectConnect] Stored new credentials in localStorage and IndexedDB');
        } catch (storageError) {
          logger.warn('[matrixDirectConnect] Failed to store credentials in localStorage:', storageError);
        }

        // Create a new client with the fresh credentials
        const client = matrixSdk.createClient({
          baseUrl: newCredentials.homeserver || 'https://dfix-hsbridge.duckdns.org',
          accessToken: newCredentials.accessToken,
          userId: newCredentials.userId,
          deviceId: newCredentials.deviceId,
          timelineSupport: true,
          useAuthorizationHeader: true
        });

        logger.info('[matrixDirectConnect] Successfully created client with new credentials from API');
        return client;
      } catch (apiError) {
        logger.error('[matrixDirectConnect] Error getting credentials from API:', apiError);
        throw new Error('Failed to get Matrix credentials from API. Please refresh the page and try again.');
      }
    } catch (error) {
      logger.error('[matrixDirectConnect] Error connecting to Matrix:', error);
      throw error;
    }
  },

  /**
   * Start a Matrix client with timeout
   * @param {Object} client - The Matrix client
   * @returns {Promise<void>}
   */
  async startClient(client) {
    logger.info('[matrixDirectConnect] Starting Matrix client');

    // Set up a timeout for the entire client start and sync process
    const startTime = Date.now();
    const MAX_WAIT_TIME = 15000; // 15 seconds max for the entire process

    try {
      // Start the client with a timeout
      await Promise.race([
        client.startClient(),
        new Promise((_, reject) => setTimeout(() => {
          reject(new Error('Matrix client start timeout'));
        }, 5000)) // 5 second timeout for client start
      ]);

      logger.info('[matrixDirectConnect] Matrix client started successfully');

      // Wait for sync with a timeout
      logger.info('[matrixDirectConnect] Waiting for Matrix sync');

      try {
        await Promise.race([
          new Promise((syncResolve) => {
            const onSync = (state) => {
              if (state === 'PREPARED' || state === 'SYNCING') {
                client.removeListener('sync', onSync);
                logger.info(`[matrixDirectConnect] Matrix sync state: ${state}`);
                syncResolve();
              }
            };
            client.on('sync', onSync);
          }),
          // Add a timeout to prevent getting stuck
          new Promise((_, syncReject) => setTimeout(() => {
            logger.warn('[matrixDirectConnect] Matrix sync timeout, proceeding anyway');
            syncReject(new Error('Matrix sync timeout'));
          }, Math.max(1000, MAX_WAIT_TIME - (Date.now() - startTime)))) // Use remaining time or at least 1 second
        ]);

        logger.info('[matrixDirectConnect] Matrix sync completed successfully');
      } catch (syncError) {
        // If sync times out, we'll still proceed
        logger.warn('[matrixDirectConnect] Matrix sync error or timeout:', syncError);
        logger.info('[matrixDirectConnect] Proceeding despite sync issues');
      }
    } catch (startError) {
      // If client start fails, log it but continue
      logger.error('[matrixDirectConnect] Error starting Matrix client:', startError);
      logger.info('[matrixDirectConnect] Proceeding despite client start issues');
    }
  }
};

export default matrixDirectConnect;
