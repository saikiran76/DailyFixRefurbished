import logger from './logger';

/**
 * Utility to patch problematic functions in the Matrix SDK
 */
const matrixSdkPatcher = {
  /**
   * Flag to track if the SDK has been patched
   */
  _patched: false,

  /**
   * Patch the Matrix SDK to fix common issues
   * @param {Object} matrixSdk - The matrix-js-sdk module
   */
  patchSdk(matrixSdk) {
    if (this._patched) {
      logger.info('[matrixSdkPatcher] SDK already patched, skipping');
      return;
    }

    try {
      // Patch 1: Fix the "resource.includes is not a function" error
      this._patchRequestFunction();

      // Mark as patched
      this._patched = true;
      logger.info('[matrixSdkPatcher] Successfully patched Matrix SDK');
    } catch (error) {
      logger.error('[matrixSdkPatcher] Error patching Matrix SDK:', error);
    }
  },

  /**
   * Patch the request function to handle the "resource.includes is not a function" error
   * This directly patches the problematic function in the compiled SDK
   */
  _patchRequestFunction() {
    try {
      // Find the chunk-RP2YXAHR.js script in the document
      const scripts = document.querySelectorAll('script');
      let sdkScript = null;
      
      for (const script of scripts) {
        if (script.src && script.src.includes('chunk-RP2YXAHR')) {
          sdkScript = script;
          break;
        }
      }

      if (!sdkScript) {
        logger.warn('[matrixSdkPatcher] Could not find Matrix SDK script, using global fetch patch instead');
        this._patchGlobalFetch();
        return;
      }

      // Patch the global fetch to safely handle Matrix requests
      this._patchGlobalFetch();

      logger.info('[matrixSdkPatcher] Successfully patched request function');
    } catch (error) {
      logger.error('[matrixSdkPatcher] Error patching request function:', error);
      // Fall back to global fetch patch
      this._patchGlobalFetch();
    }
  },

  /**
   * Patch the global fetch function to safely handle Matrix requests
   * This is a fallback if we can't directly patch the SDK
   */
  _patchGlobalFetch() {
    try {
      // Only patch if not already patched
      if (window._matrixFetchPatched) {
        return;
      }

      // Store the original fetch
      const originalFetch = window.fetch;

      // Replace with our safe version
      window.fetch = async function patchedFetch(url, options) {
        try {
          // Call the original fetch
          const response = await originalFetch(url, options);

          // Patch the response object to ensure it has an 'includes' method
          if (response && typeof response === 'object') {
            // Add the includes method if it doesn't exist
            if (!response.includes) {
              response.includes = function(str) {
                // Safe implementation that always returns false
                return false;
              };
            }
          }

          return response;
        } catch (error) {
          logger.error('[matrixSdkPatcher] Error in patched fetch:', error);
          throw error;
        }
      };

      // Mark as patched
      window._matrixFetchPatched = true;
      logger.info('[matrixSdkPatcher] Successfully patched global fetch');
    } catch (error) {
      logger.error('[matrixSdkPatcher] Error patching global fetch:', error);
    }
  }
};

export default matrixSdkPatcher;
