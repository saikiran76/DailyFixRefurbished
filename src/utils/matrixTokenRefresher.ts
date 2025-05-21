// Matrix SDK is imported by matrixDirectConnect, no need to import it here
import logger from './logger';
import matrixDirectConnect from './matrixDirectConnect';
import { saveToIndexedDB, getFromIndexedDB } from './indexedDBHelper';
import { MATRIX_CREDENTIALS_KEY } from '../constants';
import matrixClientValidator from './matrixClientValidator';

// Detect Vercel environment
const isVercel = typeof window !== 'undefined' &&
                (window.location.hostname.includes('vercel.app') ||
                 document.referrer.includes('vercel.app'));

/**
 * Utility for refreshing Matrix tokens
 */
const matrixTokenRefresher = {
  // Track refresh attempts to prevent 429 errors
  _refreshAttempts: 0,
  _maxRefreshAttempts: 3, // Limit to 3 attempts
  _resetRefreshAttemptsTimeout: null,
  _lastRefreshAttempt: 0,
  _refreshCooldown: 5000, // 5 seconds between refresh attempts
  _heartbeatInterval: null,
  _tokenCheckInterval: null,
  _refreshInProgress: false,
  _refreshPromise: null,
  _errorSuppressed: false,

  /**
   * Ensure token validity by checking expiration and refreshing if needed
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<boolean>} - Whether the token is valid
   */
  async ensureTokenValidity(userId) {
    try {
      // Check if we have credentials in localStorage
      const localStorageKey = `dailyfix_connection_${userId}`;
      const localStorageData = localStorage.getItem(localStorageKey);

      if (!localStorageData) {
        logger.warn('[matrixTokenRefresher] No credentials found in localStorage');
        return false;
      }

      const parsedData = JSON.parse(localStorageData);
      if (!parsedData.matrix_credentials) {
        logger.warn('[matrixTokenRefresher] No Matrix credentials in localStorage data');
        return false;
      }

      const credentials = parsedData.matrix_credentials;

      // Check if token is expired or about to expire (within 2 minutes)
      if (credentials.expires_at && Date.now() > credentials.expires_at - 120000) {
        logger.info('[matrixTokenRefresher] Token expired or expiring soon, refreshing via API');

        try {
          // Import the API utility to ensure proper authentication headers
          const api = (await import('./api')).default;

          // Call the Matrix status API to get fresh credentials using the API utility
          // This endpoint calls matrixService.preCheckMatrixUser which includes token refresh logic
          const { data, error } = await api.get('/api/v1/matrix/status');

          if (error) {
            throw new Error(`API error: ${error}`);
          }

          if (!data) {
            throw new Error('API returned empty response');
          }

          if (!data.credentials) {
            throw new Error('API response did not contain credentials');
          }

          // Update localStorage with new credentials
          parsedData.matrix_credentials = data.credentials;
          localStorage.setItem(localStorageKey, JSON.stringify(parsedData));

          // Also update IndexedDB
          try {
            await saveToIndexedDB(userId, {
              [MATRIX_CREDENTIALS_KEY]: data.credentials
            });
          } catch (dbError) {
            logger.warn('[matrixTokenRefresher] Error saving to IndexedDB:', dbError);
          }

          // If we have an active client, update its token
          if (window.matrixClient && window.matrixClient.getUserId()) {
            try {
              window.matrixClient.setAccessToken(data.credentials.accessToken);
              logger.info('[matrixTokenRefresher] Updated access token in existing client');
            } catch (tokenError) {
              logger.warn('[matrixTokenRefresher] Could not update token in existing client:', tokenError);
            }
          }

          logger.info('[matrixTokenRefresher] Successfully refreshed token via API');
          return true;
        } catch (apiError) {
          logger.error('[matrixTokenRefresher] API token refresh failed:', apiError);

          // No longer attempting direct refresh - rely solely on the API
          logger.warn('[matrixTokenRefresher] Token refresh via API failed, cannot proceed without valid token');
          return false;
        }
      }

      // Token is still valid
      return true;
    } catch (error) {
      logger.error('[matrixTokenRefresher] Error ensuring token validity:', error);
      return false;
    }
  },

  /**
   * Set up heartbeat to detect and recover from stalled clients
   * @param {Object} client - The Matrix client
   * @param {string} userId - The Supabase user ID
   */
  setupHeartbeat(client, userId) {
    // Clear any existing interval
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
    }

    let lastEventTimestamp = Date.now();
    let lastSyncTimestamp = Date.now();

    // Update timestamp when we receive events
    const onEvent = () => {
      lastEventTimestamp = Date.now();
    };

    const onSync = (state) => {
      if (state === 'SYNCING' || state === 'PREPARED') {
        lastSyncTimestamp = Date.now();
      }
    };

    client.on('event', onEvent);
    client.on('Room.timeline', onEvent);
    client.on('sync', onSync);

    // Check heartbeat every 2 minutes
    this._heartbeatInterval = setInterval(async () => {
      // If no events for 5 minutes and client should be running
      const inactiveTime = Date.now() - lastEventTimestamp;
      const syncInactiveTime = Date.now() - lastSyncTimestamp;

      if (inactiveTime > 300000 && client.clientRunning) {
        logger.warn(`[matrixTokenRefresher] No events received for ${Math.round(inactiveTime/1000)}s, checking client health`);

        try {
          // Try a simple API call to check client health
          await client.whoami();
          logger.info('[matrixTokenRefresher] Client is healthy despite inactivity');

          // Force a sync to make sure we're still connected
          client.retryImmediately();
        } catch (error) {
          logger.error('[matrixTokenRefresher] Client appears unhealthy, refreshing:', error);
          await this.refreshClient(userId);
        }
      } else if (syncInactiveTime > 180000 && client.clientRunning) {
        // If no sync for 3 minutes, force a sync
        logger.warn(`[matrixTokenRefresher] No sync for ${Math.round(syncInactiveTime/1000)}s, forcing sync`);
        client.retryImmediately();
      }
    }, 120000); // Every 2 minutes
  },
  /**
   * Check if the Matrix client is valid and refresh if needed
   * @param {Object} client - The Matrix client to check
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<Object>} - A valid Matrix client
   */
  async ensureValidClient(client, userId) {
    try {
      // Check if client is valid
      if (!client) {
        logger.warn('[matrixTokenRefresher] No client provided, creating new one');
        return this.refreshClient(userId);
      }

      // Use the validator to check client state
      const validatedClient = await matrixClientValidator.validateClient(client, userId);

      // If validation failed, refresh the client
      if (!validatedClient) {
        logger.warn('[matrixTokenRefresher] Client validation failed, refreshing');

        // Check if we're in cooldown period to prevent infinite loops
        const now = Date.now();
        if (now - this._lastRefreshAttempt < this._refreshCooldown) {
          logger.warn('[matrixTokenRefresher] In cooldown period, skipping refresh');
          return client; // Return the original client to prevent loops
        }

        // Check if we've exceeded max attempts
        if (this._refreshAttempts >= this._maxRefreshAttempts) {
          logger.error(`[matrixTokenRefresher] Max refresh attempts (${this._maxRefreshAttempts}) reached, giving up`);
          return client; // Return the original client after max attempts
        }

        this._lastRefreshAttempt = now;
        return this.refreshClient(userId);
      }

      // Client is valid
      logger.info('[matrixTokenRefresher] Client validation successful');
      return validatedClient;
    } catch (error) {
      logger.error('[matrixTokenRefresher] Error ensuring valid client:', error);

      // Check if we're in cooldown period to prevent infinite loops
      const now = Date.now();
      if (now - this._lastRefreshAttempt < this._refreshCooldown) {
        logger.warn('[matrixTokenRefresher] In cooldown period, skipping refresh after error');
        return client; // Return the original client to prevent loops
      }

      this._lastRefreshAttempt = now;
      return this.refreshClient(userId);
    }
  },

  /**
   * Refresh the Matrix client
   * @param {string} userId - The Supabase user ID
   * @returns {Promise<Object>} - A new Matrix client
   */
  async refreshClient(userId) {
    try {
      logger.info('[matrixTokenRefresher] Refreshing Matrix client');

      // Check if we've exceeded the maximum number of attempts
      if (this._refreshAttempts >= this._maxRefreshAttempts) {
        logger.warn(`[matrixTokenRefresher] Maximum refresh attempts (${this._maxRefreshAttempts}) reached, waiting for cooldown`);

        // Show a toast notification to the user - but only once per cooldown period
        if (!this._toastShown) {
          try {
            // Using dynamic import to avoid circular dependencies
            const { toast } = await import('react-hot-toast');
            toast.error('Too many connection attempts. Please try again in a minute.', {
              id: 'matrix-refresh-limit', // Use a consistent ID to prevent duplicates
              duration: 5000 // Show for 5 seconds
            });
            this._toastShown = true;

            // Reset toast shown flag after cooldown
            setTimeout(() => {
              this._toastShown = false;
            }, 60000); // 1 minute cooldown for toast
          } catch (toastError) {
            logger.warn('[matrixTokenRefresher] Could not show toast notification:', toastError);
          }
        }

        // Set a longer cooldown period after max attempts with exponential backoff
        if (!this._resetRefreshAttemptsTimeout) {
          // Calculate backoff time: 30s, 60s, 120s based on consecutive failures
          const backoffTime = Math.min(30000 * Math.pow(2, Math.floor(this._refreshAttempts / this._maxRefreshAttempts)), 120000);

          logger.info(`[matrixTokenRefresher] Setting cooldown period of ${backoffTime/1000}s`);

          this._resetRefreshAttemptsTimeout = setTimeout(() => {
            this._refreshAttempts = 0;
            this._resetRefreshAttemptsTimeout = null;
            logger.info('[matrixTokenRefresher] Reset refresh attempts counter after cooldown');
          }, backoffTime);
        }

        // Clear the refresh flag
        sessionStorage.removeItem('matrix_token_refreshing');

        // Return the existing client if available, or null
        return window.matrixClient || null;
      }

      // Increment the attempts counter
      this._refreshAttempts++;
      logger.info(`[matrixTokenRefresher] Refresh attempt ${this._refreshAttempts}/${this._maxRefreshAttempts}`);

      // Set a flag to indicate we're refreshing the token
      sessionStorage.setItem('matrix_token_refreshing', 'true');

      // Prevent multiple simultaneous refresh attempts
      if (this._refreshInProgress) {
        logger.warn('[matrixTokenRefresher] Refresh already in progress, waiting...');
        try {
          // Wait for the existing refresh to complete
          const result = await Promise.race([
            this._refreshPromise,
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Refresh timeout')), 10000);
            })
          ]);

          logger.info('[matrixTokenRefresher] Previous refresh completed, returning client');
          // Clear the refresh flag
          sessionStorage.removeItem('matrix_token_refreshing');
          return result || window.matrixClient;
        } catch (error) {
          logger.warn('[matrixTokenRefresher] Previous refresh failed or timed out:', error);
          // Continue with a new refresh, but with a small delay to prevent hammering
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      // Set up refresh promise with timeout
      this._refreshInProgress = true;
      this._refreshPromise = (async () => {
        try {
          // Store the old client's user ID before stopping it
          const oldUserId = window.matrixClient ? window.matrixClient.getUserId() : null;

          // Stop the existing client if it exists
          if (window.matrixClient) {
            try {
              if (window.matrixClient.clientRunning) {
                await window.matrixClient.stopClient();
              }
              window.matrixClient = null;
            } catch (e) {
              logger.warn('[matrixTokenRefresher] Error stopping existing client:', e);
            }
          }

          // Get fresh credentials from the API
          logger.info('[matrixTokenRefresher] Attempting to get credentials from API');
          try {
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

              // Also update IndexedDB
              try {
                await saveToIndexedDB(userId, {
                  [MATRIX_CREDENTIALS_KEY]: newCredentials
                });
              } catch (dbError) {
                logger.warn('[matrixTokenRefresher] Error saving to IndexedDB:', dbError);
              }

              logger.info('[matrixTokenRefresher] Stored new credentials in localStorage and IndexedDB');
            } catch (storageError) {
              logger.warn('[matrixTokenRefresher] Failed to store credentials in localStorage:', storageError);
            }

            // Create a new client with the fresh credentials
            const matrixSdk = (await import('matrix-js-sdk')).default;
            const newClient = matrixSdk.createClient({
              baseUrl: newCredentials.homeserver || 'https://dfix-hsbridge.duckdns.org',
              accessToken: newCredentials.accessToken,
              userId: newCredentials.userId,
              deviceId: newCredentials.deviceId,
              timelineSupport: true,
              useAuthorizationHeader: true
            });

            logger.info('[matrixTokenRefresher] Successfully created client with new credentials from API');
            return newClient;
          } catch (apiError) {
            logger.error('[matrixTokenRefresher] API token refresh failed:', apiError);

            // If API call fails, we have no choice but to try direct connect as a last resort
            logger.warn('[matrixTokenRefresher] API call failed, attempting direct connect as last resort');
            try {
              const newClient = await Promise.race([
                matrixDirectConnect.connectToMatrix(userId),
                new Promise((_, reject) => {
                  setTimeout(() => reject(new Error('Connect timeout')), 15000);
                })
              ]);

              // If we got a client, use it
              if (newClient) {
                // Set the global Matrix client
                window.matrixClient = newClient;

                // Start the client with timeout
                await Promise.race([
                  matrixDirectConnect.startClient(newClient),
                  new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Start client timeout')), 15000);
                  })
                ]);

                // If this was for Telegram, make sure the flag is still set
                // This ensures future refreshes will work
                if (oldUserId && oldUserId.includes('@telegram_')) {
                  logger.info('[matrixTokenRefresher] Preserving Telegram connection flag for future refreshes');
                  sessionStorage.setItem('connecting_to_telegram', 'true');
                }

                logger.info('[matrixTokenRefresher] Successfully refreshed Matrix client');

                // Reset the refresh attempts counter on successful refresh
                this._refreshAttempts = 0;
                if (this._resetRefreshAttemptsTimeout) {
                  clearTimeout(this._resetRefreshAttemptsTimeout);
                  this._resetRefreshAttemptsTimeout = null;
                }

                return newClient;
              } else {
                throw new Error('Failed to get Matrix client');
              }
            } catch (directConnectError) {
              // If the error indicates we need to get credentials from the API,
              // we should redirect the user to re-authenticate
              if (directConnectError.message && directConnectError.message.includes('Please use the API to get new credentials')) {
                logger.warn('[matrixTokenRefresher] Need to get new credentials from the API');

                // Show a toast notification for the error
                try {
                  const { toast } = await import('react-hot-toast');
                  toast.error('Your session has expired. Please reconnect to Telegram.', {
                    id: 'matrix-credentials-expired',
                    duration: 5000
                  });
                } catch {
                  // Ignore toast errors
                }

                // Clear any stored credentials
                try {
                  localStorage.removeItem(`dailyfix_connection_${userId}`);
                  localStorage.removeItem('mx_access_token');
                  localStorage.removeItem('mx_user_id');
                  localStorage.removeItem('mx_device_id');
                  localStorage.removeItem('mx_hs_url');
                } catch (e) {
                  logger.warn('[matrixTokenRefresher] Failed to clear localStorage:', e);
                }

                // Return null to indicate we need to re-authenticate
                return null;
              }

              // For other errors, just rethrow
              throw directConnectError;
            }
          }

          // This code is now handled inside the try/catch block above
        } finally {
          this._refreshInProgress = false;
          // Clear the refresh flag
          sessionStorage.removeItem('matrix_token_refreshing');
        }
      })();

      try {
        // Wait for the refresh with a timeout
        return await Promise.race([
          this._refreshPromise,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Refresh timeout')), 20000);
          })
        ]);
      } catch (timeoutError) {
        logger.error('[matrixTokenRefresher] Refresh timed out:', timeoutError);
        // Return the existing client if available, or null
        return window.matrixClient || null;
      }
    } catch (error) {
      logger.error('[matrixTokenRefresher] Error refreshing client:', error);

      // Prevent alert loops by suppressing errors for a short time
      if (!this._errorSuppressed) {
        this._errorSuppressed = true;
        setTimeout(() => {
          this._errorSuppressed = false;
        }, 10000); // Suppress errors for 10 seconds

        // Show a toast notification for the error, but don't throw
        try {
          const { toast } = await import('react-hot-toast');
          toast.error('Connection error. Retrying...', {
            id: 'matrix-refresh-error',
            duration: 3000
          });
        } catch {
          // Ignore toast errors
        }

        // Return the existing client if available, or null
        return window.matrixClient || null;
      } else {
        logger.warn('[matrixTokenRefresher] Suppressing additional error alerts');
        return window.matrixClient || null;
      }
    }
  },

  /**
   * Set up token refresh listeners on a client
   * @param {Object} client - The Matrix client
   * @param {string} userId - The Supabase user ID
   */
  setupRefreshListeners(client, userId) {
    if (!client) return;

    // Initialize refresh state tracking
    this._refreshInProgress = false;
    this._refreshPromise = null;
    this._errorSuppressed = false;
    // Reset the last refresh attempt time
    this._lastRefreshAttempt = 0;

    // Set up heartbeat to detect and recover from stalled clients
    this.setupHeartbeat(client, userId);

    // Clear any existing token check interval
    if (this._tokenCheckInterval) {
      clearInterval(this._tokenCheckInterval);
    }

    // Add periodic token check (every 60 seconds)
    this._tokenCheckInterval = setInterval(() => {
      if (client && userId) {
        this.ensureTokenValidity(userId).catch(e => {
          logger.warn('[matrixTokenRefresher] Token check failed:', e);
        });
      }
    }, 60000);

    // Remove any existing listeners
    client.removeAllListeners('Session.logged_out');
    client.removeAllListeners('sync');

    // Listen for logout events
    client.on('Session.logged_out', () => {
      logger.warn('[matrixTokenRefresher] Session logged out, refreshing client');

      // Check if we're in cooldown period
      const now = Date.now();
      if (now - this._lastRefreshAttempt < this._refreshCooldown) {
        logger.warn('[matrixTokenRefresher] In cooldown period, skipping refresh');
        return;
      }

      this._lastRefreshAttempt = now;

      this.refreshClient(userId).catch(error => {
        logger.error('[matrixTokenRefresher] Error refreshing client after logout:', error);
      });
    });

    // Listen for sync state changes
    client.on('sync', (state, prevState, data) => {
      logger.info(`[matrixTokenRefresher] Sync state changed: ${prevState} -> ${state}`);

      // If sync state changes to ERROR, check if it's a token issue
      if (state === 'ERROR') {
        logger.warn('[matrixTokenRefresher] Sync error, checking if token is valid');

        // Check if the error is related to the token
        const error = data ? data.error : null;
        if (error && (
            error.errcode === 'M_UNKNOWN_TOKEN' ||
            (error.message && error.message.includes('token')) ||
            (error.data && error.data.error && error.data.error.includes('token'))
        )) {
          // Check if we're in cooldown period
          const now = Date.now();
          if (now - this._lastRefreshAttempt < this._refreshCooldown) {
            logger.warn('[matrixTokenRefresher] In cooldown period, skipping refresh');
            return;
          }

          this._lastRefreshAttempt = now;

          logger.warn('[matrixTokenRefresher] Token error detected, refreshing client');
          this.refreshClient(userId).catch(refreshError => {
            logger.error('[matrixTokenRefresher] Error refreshing client after sync error:', refreshError);
          });
        }
      }
    });

    // Listen for request errors
    client.on('request', (request) => {
      request.on('error', (error) => {
        if (error.errcode === 'M_UNKNOWN_TOKEN' ||
            (error.message && error.message.includes('token')) ||
            (error.data && error.data.error && error.data.error.includes('token'))) {
          // Check if we're in cooldown period
          const now = Date.now();
          if (now - this._lastRefreshAttempt < this._refreshCooldown) {
            logger.warn('[matrixTokenRefresher] In cooldown period, skipping refresh');
            return;
          }

          this._lastRefreshAttempt = now;

          logger.warn('[matrixTokenRefresher] Token error in request:', error);
          this.refreshClient(userId).catch(refreshError => {
            logger.error('[matrixTokenRefresher] Error refreshing client after request error:', refreshError);
          });
        }
      });
    });

    // Set up a global error handler to suppress Matrix auth alerts
    if (!window._matrixErrorHandlerInstalled) {
      const originalAlert = window.alert;
      window.alert = function(message) {
        if (typeof message === 'string' &&
            (message.includes('session') ||
             message.includes('expired') ||
             message.includes('log in') ||
             message.includes('Matrix'))) {
          logger.warn('[matrixTokenRefresher] Suppressing Matrix auth alert:', message);
          // Instead of showing an alert, try to refresh the client
          const now = Date.now();
          if (now - matrixTokenRefresher._lastRefreshAttempt > matrixTokenRefresher._refreshCooldown) {
            matrixTokenRefresher._lastRefreshAttempt = now;
            if (window.matrixClient && userId) {
              matrixTokenRefresher.refreshClient(userId).catch(e => {
                logger.error('[matrixTokenRefresher] Error refreshing after alert suppression:', e);
              });
            }
          }
          return;
        }
        return originalAlert.call(this, message);
      };
      window._matrixErrorHandlerInstalled = true;
    }

    // Listen for network status changes
    if (!window._networkListenersInstalled) {
      window.addEventListener('online', () => {
        logger.info('[matrixTokenRefresher] Network connection restored');
        if (window.matrixClient && !window.matrixClient.clientRunning) {
          logger.info('[matrixTokenRefresher] Restarting Matrix client after network restoration');
          window.matrixClient.startClient().catch(e => {
            logger.error('[matrixTokenRefresher] Error restarting client:', e);
          });
        } else if (window.matrixClient) {
          // Force a sync
          window.matrixClient.retryImmediately();
          logger.info('[matrixTokenRefresher] Forced sync after network restoration');
        }
      });

      window.addEventListener('offline', () => {
        logger.warn('[matrixTokenRefresher] Network connection lost');
        // We'll let the client handle this naturally, but log it for debugging
      });

      window._networkListenersInstalled = true;
    }

    logger.info('[matrixTokenRefresher] Set up refresh listeners');
  }
};

export default matrixTokenRefresher;
