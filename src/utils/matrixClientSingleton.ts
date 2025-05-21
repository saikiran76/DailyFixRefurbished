import * as matrixSdk from 'matrix-js-sdk';
import logger from './logger';
import { patchMatrixFetch } from './matrixFetchUtils';

/**
 * Singleton manager for Matrix client instances
 * Ensures only one client instance exists per user ID
 */
class MatrixClientSingleton {
  constructor() {
    this._instances = new Map();
    this._initPromises = new Map();
    this._initInProgress = new Map();
    this._lastInitTime = new Map();
    this._initCooldown = 5000; // 5 seconds between init attempts
  }

  /**
   * Get or create a Matrix client instance
   * @param {Object} config - Configuration for the Matrix client
   * @param {string} userId - The user ID to use as a key
   * @returns {Promise<Object>} - The Matrix client instance
   */
  async getClient(config, userId) {
    // Check if we already have an instance for this user
    if (this._instances.has(userId) && this._instances.get(userId)) {
      logger.info(`[matrixClientSingleton] Returning existing client for user ${userId}`);
      return this._instances.get(userId);
    }

    // Check if initialization is already in progress
    if (this._initInProgress.get(userId)) {
      logger.info(`[matrixClientSingleton] Initialization already in progress for user ${userId}, waiting...`);
      try {
        return await this._initPromises.get(userId);
      } catch (error) {
        logger.warn(`[matrixClientSingleton] Previous initialization failed for user ${userId}:`, error);
        // Continue with new initialization
      }
    }

    // Check if we're in cooldown period
    const now = Date.now();
    const lastInit = this._lastInitTime.get(userId) || 0;
    if (now - lastInit < this._initCooldown) {
      logger.warn(`[matrixClientSingleton] In cooldown period for user ${userId}, waiting...`);
      await new Promise(resolve => setTimeout(resolve, this._initCooldown - (now - lastInit)));
    }

    // Set initialization in progress
    this._initInProgress.set(userId, true);
    this._lastInitTime.set(userId, Date.now());

    // Create initialization promise
    this._initPromises.set(userId, (async () => {
      try {
        logger.info(`[matrixClientSingleton] Creating new Matrix client for user ${userId}`);

        // Apply fetch patch to prevent errors (patches global fetch)
        patchMatrixFetch();

        // Create client with provided config
        const client = matrixSdk.createClient({
          baseUrl: config.homeserver || 'https://dfix-hsbridge.duckdns.org',
          userId: config.userId,
          deviceId: config.deviceId || `DFIX_WEB_${Date.now()}`,
          accessToken: config.accessToken,
          timelineSupport: true,
          store: new matrixSdk.MemoryStore({ localStorage: window.localStorage }),
          verificationMethods: ['m.sas.v1'],
          unstableClientRelationAggregation: true,
          useAuthorizationHeader: true,
          // Add these critical options for resilience
          retryImmediately: true,
          fallbackSyncDelay: 5000, // 5 seconds between retries
          maxTimelineRequestAttempts: 5, // More attempts for timeline requests
          timeoutMs: 60000, // Longer timeout for requests
          localTimeoutMs: 10000, // Local request timeout
          // CRITICAL FIX: Disable call event handler to prevent "Cannot read properties of undefined (reading 'start')" error
          disableCallEventHandler: true
        });

        // Store the instance
        this._instances.set(userId, client);

        // Also set as global client for compatibility
        window.matrixClient = client;

        return client;
      } finally {
        this._initInProgress.set(userId, false);
      }
    })());

    return this._initPromises.get(userId);
  }

  /**
   * Remove a client instance
   * @param {string} userId - The user ID key
   */
  removeClient(userId) {
    const client = this._instances.get(userId);
    if (client) {
      logger.info(`[matrixClientSingleton] Removing client for user ${userId}`);
      try {
        if (client.clientRunning) {
          client.stopClient();
        }
      } catch (error) {
        logger.warn(`[matrixClientSingleton] Error stopping client for user ${userId}:`, error);
      }
      this._instances.delete(userId);

      // Clear global reference if it matches
      if (window.matrixClient === client) {
        window.matrixClient = null;
      }
    }
  }

  /**
   * Check if a client exists for a user
   * @param {string} userId - The user ID key
   * @returns {boolean} - Whether a client exists
   */
  hasClient(userId) {
    return this._instances.has(userId) && !!this._instances.get(userId);
  }

  /**
   * Get all client instances
   * @returns {Map<string, Object>} - Map of user IDs to client instances
   */
  getAllClients() {
    return this._instances;
  }
}

// Create and export singleton instance
const matrixClientSingleton = new MatrixClientSingleton();
export default matrixClientSingleton;
