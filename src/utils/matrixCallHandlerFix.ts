/**
 * Fix for Matrix client call event handler
 * This module provides a patch for the Matrix client to handle the case where the call event handler is undefined
 */

import logger from './logger';

/**
 * Apply the call handler fix to a Matrix client
 * @param {Object} client - The Matrix client
 */
export function applyCallHandlerFix(client) {
  if (!client) return;

  // Save the original startClient method
  const originalStartClient = client.startClient;

  // Override the startClient method
  client.startClient = function(...args) {
    try {
      // Check if the client has a call event handler
      if (typeof this.startCallEventHandler === 'function') {
        // Original function exists, no need to patch
        logger.info('[matrixCallHandlerFix] Call event handler exists, no need to patch');
      } else {
        // Add a dummy startCallEventHandler method
        logger.info('[matrixCallHandlerFix] Adding dummy call event handler');
        this.startCallEventHandler = function() {
          logger.info('[matrixCallHandlerFix] Dummy call event handler called');
          return { start: function() {} };
        };
      }

      // Call the original startClient method
      return originalStartClient.apply(this, args);
    } catch (error) {
      logger.error('[matrixCallHandlerFix] Error in patched startClient:', error);
      // Still try to call the original method
      return originalStartClient.apply(this, args);
    }
  };

  logger.info('[matrixCallHandlerFix] Applied call handler fix to Matrix client');
}

export default { applyCallHandlerFix };
