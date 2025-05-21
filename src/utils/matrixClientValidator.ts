import logger from './logger';

/**
 * Utility to validate Matrix client state and prevent infinite refresh loops
 */
const matrixClientValidator = {
  // Track validation attempts to prevent loops
  _validationAttempts: 0,
  _maxValidationAttempts: 3,
  _lastValidationTime: 0,
  _validationCooldown: 10000, // 10 seconds between validation attempts
  _validationInProgress: false,
  _validationPromise: null,
  
  /**
   * Validate a Matrix client and ensure it's in a usable state
   * @param {Object} client - The Matrix client to validate
   * @param {string} userId - The user ID for logging
   * @returns {Promise<Object>} - The validated client or null if validation fails
   */
  async validateClient(client, userId) {
    // Check if we're already validating
    if (this._validationInProgress) {
      logger.info('[matrixClientValidator] Validation already in progress, waiting...');
      try {
        return await this._validationPromise;
      } catch (error) {
        logger.warn('[matrixClientValidator] Previous validation failed:', error);
      }
    }
    
    // Check if we're in cooldown period
    const now = Date.now();
    if (now - this._lastValidationTime < this._validationCooldown) {
      logger.warn('[matrixClientValidator] In cooldown period, skipping validation');
      return client; // Return the client as-is during cooldown
    }
    
    // Check if we've exceeded max attempts
    if (this._validationAttempts >= this._maxValidationAttempts) {
      logger.error(`[matrixClientValidator] Max validation attempts (${this._maxValidationAttempts}) reached, giving up`);
      
      // Reset attempts after a longer cooldown
      setTimeout(() => {
        this._validationAttempts = 0;
        logger.info('[matrixClientValidator] Reset validation attempts counter');
      }, 60000); // 1 minute cooldown
      
      return client; // Return the client as-is after max attempts
    }
    
    // Set validation in progress
    this._validationInProgress = true;
    this._lastValidationTime = now;
    this._validationAttempts++;
    
    // Create validation promise
    this._validationPromise = (async () => {
      try {
        logger.info(`[matrixClientValidator] Validating client (attempt ${this._validationAttempts}/${this._maxValidationAttempts})`);
        
        // Basic validation checks
        if (!client) {
          logger.error('[matrixClientValidator] Client is null or undefined');
          return null;
        }
        
        if (!client.getUserId()) {
          logger.error('[matrixClientValidator] Client has no user ID');
          return null;
        }
        
        if (!client.getAccessToken()) {
          logger.error('[matrixClientValidator] Client has no access token');
          return null;
        }
        
        // Check sync state
        const syncState = client.getSyncState();
        logger.info(`[matrixClientValidator] Client sync state: ${syncState}`);
        
        // If sync state is null but client is running, wait briefly for it to initialize
        if (syncState === null && client.clientRunning) {
          logger.info('[matrixClientValidator] Client is running but sync state is null, waiting briefly...');
          
          try {
            // Wait for sync state to change (max 5 seconds)
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                client.removeListener('sync', onSync);
                reject(new Error('Sync state timeout'));
              }, 5000);
              
              const onSync = (state) => {
                if (state !== null) {
                  clearTimeout(timeout);
                  client.removeListener('sync', onSync);
                  resolve();
                }
              };
              
              client.on('sync', onSync);
              
              // Also resolve if sync state changes while we're setting up the listener
              if (client.getSyncState() !== null) {
                clearTimeout(timeout);
                client.removeListener('sync', onSync);
                resolve();
              }
            });
            
            // Check sync state again after waiting
            const newSyncState = client.getSyncState();
            logger.info(`[matrixClientValidator] Client sync state after waiting: ${newSyncState}`);
            
            if (newSyncState === null) {
              logger.error('[matrixClientValidator] Client sync state is still null after waiting');
              return null;
            }
          } catch (error) {
            logger.warn('[matrixClientValidator] Error waiting for sync state:', error);
            // Continue with validation despite timeout
          }
        }
        
        // Perform a simple API call to verify the client works
        try {
          await client.whoami();
          logger.info('[matrixClientValidator] Client API call successful');
          
          // Reset attempts on successful validation
          this._validationAttempts = 0;
          
          return client;
        } catch (error) {
          logger.error('[matrixClientValidator] Client API call failed:', error);
          return null;
        }
      } finally {
        this._validationInProgress = false;
      }
    })();
    
    return this._validationPromise;
  }
};

export default matrixClientValidator;
