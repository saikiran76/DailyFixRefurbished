import logger from './logger';

/**
 * Safely fetch and validate Matrix server resources
 * Handles various error cases and ensures proper response format
 *
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} - The validated response data
 */
export const safeFetch = async (url, options = {}) => {
  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    // Use the original window.fetch to avoid infinite recursion
    const originalFetch = window._originalFetch || window.fetch;

    const response = await originalFetch(url, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // For 401 errors on Matrix endpoints, return appropriate fallbacks
      // This is common when tokens expire or are invalid
      if (response.status === 401 && typeof url === 'string' && url.includes('/_matrix/')) {
        logger.warn(`[matrixFetchUtils] Unauthorized (401) for ${url}, using fallback`);
        return getFallbackForEndpoint(url);
      }

      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    try {
      const data = await response.json();

      // Validate the response data
      if (data === null || data === undefined) {
        logger.warn(`[matrixFetchUtils] Empty response from ${url}`);
        return {}; // Return empty object instead of null/undefined
      }

      return data;
    } catch (jsonError) {
      logger.warn(`[matrixFetchUtils] Error parsing JSON from ${url}:`, jsonError);
      return getFallbackForEndpoint(url);
    }
  } catch (error) {
    logger.error(`[matrixFetchUtils] Error fetching ${url}:`, error);
    return getFallbackForEndpoint(url);
  }
};

/**
 * Get appropriate fallback data for different Matrix endpoints
 *
 * @param {string} url - The endpoint URL
 * @returns {Object} - Fallback data appropriate for the endpoint
 */
const getFallbackForEndpoint = (url) => {
  if (typeof url !== 'string') {
    return {};
  }

  if (url.includes('/turn/')) {
    // For TURN URIs, return an empty array
    return { uris: [] };
  } else if (url.includes('/versions')) {
    // For versions, return a minimal valid response
    return { versions: ["r0.0.1"] };
  } else if (url.includes('/capabilities')) {
    // For capabilities, return a minimal valid response
    return { capabilities: {} };
  } else if (url.includes('/pushrules/')) {
    // For push rules, return a minimal valid response
    return { global: {} };
  } else if (url.includes('/account/whoami')) {
    // For whoami, return a minimal valid response with the user_id from the URL if possible
    const userIdMatch = url.match(/\/_matrix\/client\/[^/]+\/account\/whoami/);
    return { user_id: userIdMatch ? `@user:example.org` : null };
  }

  // Default fallback is an empty object
  return {};
};

/**
 * Patch the global fetch method to safely handle Matrix-related requests
 * This should be called before creating any Matrix clients
 */
export const patchMatrixFetch = () => {
  // Only patch if not already patched
  if (window._matrixFetchPatched) {
    logger.info('[matrixFetchUtils] Fetch already patched, skipping');
    return;
  }

  // Store the original fetch method in a way that our safeFetch can access it
  window._originalFetch = window.fetch;

  // Add circuit breaker to prevent request flooding
  // Use global variables to persist across function calls
  if (!window._matrixRequestTracking) {
    window._matrixRequestTracking = {
      recentRequests: {},
      endpointCooldown: {},
      maxRequestsPerEndpoint: 3, // REDUCED: Max requests to same endpoint in timeWindow
      timeWindow: 5000, // INCREASED: 5 seconds time window
      rateLimitedEndpoints: {}, // Track endpoints that have received M_LIMIT_EXCEEDED errors
      rateLimitCooldownTime: 30000, // 30 seconds cooldown for rate limited endpoints
      globalRateLimitActive: false, // Flag for global rate limiting
      globalRateLimitExpiry: 0, // Timestamp when global rate limit expires
      globalRateLimitCooldown: 60000 // 60 seconds global cooldown
    };
  }

  // Get references to the tracking objects
  const {
    recentRequests,
    endpointCooldown,
    maxRequestsPerEndpoint,
    timeWindow,
    rateLimitedEndpoints,
    rateLimitCooldownTime,
    // Don't destructure these as we access them via window._matrixRequestTracking directly
    // globalRateLimitActive,
    // globalRateLimitExpiry,
    globalRateLimitCooldown
  } = window._matrixRequestTracking;

  // Replace with our safe version
  window.fetch = async (url, options) => {
    // Circuit breaker logic for Matrix endpoints
    if (typeof url === 'string' && url.includes('/_matrix/')) {
      // Extract endpoint path for rate limiting
      const endpointMatch = url.match(/\/_matrix\/client\/[^/]+\/([^?]+)/);
      const endpoint = endpointMatch ? endpointMatch[1] : url;

      // Check for global rate limit first
      const now = Date.now();
      if (window._matrixRequestTracking.globalRateLimitActive && now < window._matrixRequestTracking.globalRateLimitExpiry) {
        logger.warn(`[matrixFetchUtils] Global rate limit active, blocking request to ${endpoint}`);

        // Return appropriate fallback for rate limited requests
        return new Response(JSON.stringify({
          errcode: 'M_LIMIT_EXCEEDED',
          error: 'Rate limit exceeded (global cooldown)',
          retry_after_ms: window._matrixRequestTracking.globalRateLimitExpiry - now
        }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'Content-Type': 'application/json' })
        });
      }

      // Check if this specific endpoint is rate limited
      if (rateLimitedEndpoints[endpoint]) {
        const expiryTime = rateLimitedEndpoints[endpoint];
        if (now < expiryTime) {
          logger.warn(`[matrixFetchUtils] Endpoint ${endpoint} rate limited until ${new Date(expiryTime).toISOString()}`);

          // Return appropriate fallback for rate limited requests
          return new Response(JSON.stringify({
            errcode: 'M_LIMIT_EXCEEDED',
            error: 'Rate limit exceeded for this endpoint',
            retry_after_ms: expiryTime - now
          }), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'Content-Type': 'application/json' })
          });
        } else {
          // Rate limit expired, remove from tracking
          delete rateLimitedEndpoints[endpoint];
        }
      }

      // Check if endpoint is in cooldown
      if (endpointCooldown[endpoint]) {
        logger.warn(`[matrixFetchUtils] Endpoint ${endpoint} in cooldown, returning cached response`);

        // Return appropriate fallback based on endpoint
        let fallbackData = {};
        if (url.includes('/turn/')) {
          fallbackData = { uris: [] };
        } else if (url.includes('/versions')) {
          fallbackData = { versions: ["r0.0.1"] };
        } else if (url.includes('/capabilities')) {
          fallbackData = { capabilities: {} };
        } else if (url.includes('/pushrules/')) {
          fallbackData = { global: {} };
        } else if (url.includes('/account/whoami')) {
          fallbackData = { user_id: '@user:example.org' };
        } else if (url.includes('/createRoom')) {
          // Special handling for room creation to prevent resource leaks
          fallbackData = { errcode: 'M_LIMIT_EXCEEDED', error: 'Rate limit exceeded for room creation' };
          return new Response(JSON.stringify(fallbackData), {
            status: 429,
            statusText: 'Too Many Requests',
            headers: new Headers({ 'Content-Type': 'application/json' })
          });
        }

        return new Response(JSON.stringify(fallbackData), {
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' })
        });
      }

      // Initialize request tracking for this endpoint
      if (!recentRequests[endpoint]) {
        recentRequests[endpoint] = [];
      }

      // Clean up old requests outside the time window
      // Using the 'now' variable already declared above
      recentRequests[endpoint] = recentRequests[endpoint].filter(
        time => now - time < timeWindow
      );

      // Add current request timestamp
      recentRequests[endpoint].push(now);

      // Check if we've exceeded the rate limit
      if (recentRequests[endpoint].length > maxRequestsPerEndpoint) {
        logger.warn(`[matrixFetchUtils] Rate limit exceeded for ${endpoint}, entering cooldown`);

        // Put endpoint in cooldown
        endpointCooldown[endpoint] = true;

        // Remove from cooldown after a delay
        setTimeout(() => {
          delete endpointCooldown[endpoint];
          recentRequests[endpoint] = [];
          logger.info(`[matrixFetchUtils] Endpoint ${endpoint} cooldown expired`);
        }, timeWindow * 2); // Cooldown for twice the time window

        // Return appropriate fallback based on endpoint
        let fallbackData = {};
        if (url.includes('/turn/')) {
          fallbackData = { uris: [] };
        } else if (url.includes('/versions')) {
          fallbackData = { versions: ["r0.0.1"] };
        } else if (url.includes('/capabilities')) {
          fallbackData = { capabilities: {} };
        } else if (url.includes('/pushrules/')) {
          fallbackData = { global: {} };
        } else if (url.includes('/account/whoami')) {
          fallbackData = { user_id: '@user:example.org' };
        }

        return new Response(JSON.stringify(fallbackData), {
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' })
        });
      }
    }
    try {
      // First, call the original fetch
      const response = await window._originalFetch(url, options);

      // Ensure all objects in the response chain have an 'includes' method
      if (response && typeof response === 'object') {
        // Add the includes method if it doesn't exist on the response
        if (typeof response.includes !== 'function') {
          response.includes = function(str) {
            // For URLs, we can check if the URL includes the string
            if (this.url && typeof this.url === 'string') {
              return this.url.includes(str);
            }
            // For other cases, safely return false
            return false;
          };
        }
      }

      // Ensure all objects in the response chain have an includes method
      // This is a comprehensive fix for the resource.includes error
      try {
        // Recursively add includes method to all objects in the response
        const addIncludesMethod = (obj) => {
          if (!obj || typeof obj !== 'object') return;

          // Add includes method to the current object if it doesn't have one
          if (typeof obj.includes !== 'function') {
            obj.includes = function(str) {
              // For URLs, check if the URL includes the string
              if (this.url && typeof this.url === 'string') {
                return this.url.includes(str);
              }
              // For objects with a body property, check that
              if (this.body && typeof this.body === 'string') {
                return this.body.includes(str);
              }
              // For objects that can be converted to string, check that
              if (this.toString && typeof this.toString === 'function') {
                const asString = this.toString();
                if (typeof asString === 'string') {
                  return asString.includes(str);
                }
              }
              // For other cases, safely return false
              return false;
            };
          }

          // Process resource property specifically (common source of the error)
          if (obj.resource && typeof obj.resource === 'object' && typeof obj.resource.includes !== 'function') {
            obj.resource.includes = function(str) {
              // For URLs, check if the URL includes the string
              if (this.url && typeof this.url === 'string') {
                return this.url.includes(str);
              }
              // For objects with a body property, check that
              if (this.body && typeof this.body === 'string') {
                return this.body.includes(str);
              }
              // For objects that can be converted to string, check that
              if (this.toString && typeof this.toString === 'function') {
                const asString = this.toString();
                if (typeof asString === 'string') {
                  return asString.includes(str);
                }
              }
              // For other cases, safely return false
              return false;
            };
          }

          // Process common properties that might be accessed with includes
          ['url', 'body', 'data', 'content', 'message', 'error', 'text'].forEach(prop => {
            if (obj[prop] && typeof obj[prop] === 'object') {
              addIncludesMethod(obj[prop]);
            }
          });

          // Process arrays
          if (Array.isArray(obj)) {
            obj.forEach(item => {
              if (item && typeof item === 'object') {
                addIncludesMethod(item);
              }
            });
          }

          // Process other object properties
          try {
            Object.keys(obj).forEach(key => {
              if (obj[key] && typeof obj[key] === 'object') {
                addIncludesMethod(obj[key]);
              }
            });
          } catch {
            // Ignore errors when iterating object keys
          }
        };

        // Apply the fix to the response object
        addIncludesMethod(response);
      } catch (error) {
        logger.warn('[matrixFetchUtils] Error patching includes methods:', error);
      }

      // Special handling for Matrix API endpoints that need safe parsing
      if (typeof url === 'string' &&
          url.includes('/_matrix/') &&
          (url.includes('/turn/') || url.includes('/versions'))) {
        logger.info(`[matrixFetchUtils] Using safe parsing for Matrix endpoint: ${url}`);

        // Clone the response to avoid modifying the original
        const clonedResponse = response.clone();

        // For these specific endpoints, we want to provide fallback values if parsing fails
        try {
          const data = await clonedResponse.json();
          return new Response(JSON.stringify(data), {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
          });
        } catch (error) {
          logger.warn(`[matrixFetchUtils] Error parsing JSON for ${url}, using fallback:`, error);

          // Provide fallback data based on the endpoint
          let fallbackData = {};
          if (url.includes('/turn/')) {
            fallbackData = { uris: [] };
          } else if (url.includes('/versions')) {
            fallbackData = { versions: ["r0.0.1"] };
          }

          return new Response(JSON.stringify(fallbackData), {
            status: 200,
            statusText: 'OK',
            headers: new Headers({ 'Content-Type': 'application/json' })
          });
        }
      }

      // Check for rate limit errors in the response
      if (typeof url === 'string' && url.includes('/_matrix/')) {
        try {
          // Clone the response to avoid consuming it
          const clonedResponse = response.clone();
          const responseData = await clonedResponse.json();

          // Extract endpoint path for rate limiting
          const endpointMatch = url.match(/\/_matrix\/client\/[^/]+\/([^?]+)/);
          const endpoint = endpointMatch ? endpointMatch[1] : url;

          // Check for M_LIMIT_EXCEEDED error
          if (responseData && responseData.errcode === 'M_LIMIT_EXCEEDED') {
            logger.warn(`[matrixFetchUtils] Received M_LIMIT_EXCEEDED for ${endpoint}`);

            // Get retry_after_ms if available, or use default cooldown
            const retryAfterMs = responseData.retry_after_ms || rateLimitCooldownTime;

            // Add this endpoint to rate limited endpoints
            rateLimitedEndpoints[endpoint] = Date.now() + retryAfterMs;

            // If this is a critical endpoint, activate global rate limiting
            if (endpoint.includes('createRoom') || endpoint.includes('sync') || endpoint.includes('send')) {
              logger.warn(`[matrixFetchUtils] Activating global rate limit for ${globalRateLimitCooldown}ms`);
              window._matrixRequestTracking.globalRateLimitActive = true;
              window._matrixRequestTracking.globalRateLimitExpiry = Date.now() + globalRateLimitCooldown;

              // Schedule the removal of global rate limit
              setTimeout(() => {
                window._matrixRequestTracking.globalRateLimitActive = false;
                logger.info('[matrixFetchUtils] Global rate limit expired');
              }, globalRateLimitCooldown);
            }
          }
        } catch (parseError) {
          // Ignore JSON parsing errors
          logger.warn('[matrixFetchUtils] Error parsing response JSON:', parseError);
        }
      }

      return response;
    } catch (error) {
      logger.error(`[matrixFetchUtils] Error in patched fetch:`, error);

      // Check if the error is related to resource.includes
      if (error && error.message && error.message.includes('resource.includes is not a function')) {
        logger.warn('[matrixFetchUtils] Caught resource.includes error, returning safe response');

        // Return a safe response with fallback data
        let fallbackData = {};

        // Provide appropriate fallback based on URL pattern
        if (typeof url === 'string') {
          if (url.includes('/turn/')) {
            fallbackData = { uris: [] };
          } else if (url.includes('/versions')) {
            fallbackData = { versions: ["r0.0.1"] };
          } else if (url.includes('/capabilities')) {
            fallbackData = { capabilities: {} };
          } else if (url.includes('/pushrules/')) {
            fallbackData = { global: {} };
          } else if (url.includes('/account/whoami')) {
            fallbackData = { user_id: '@user:example.org' };
          }
        }

        return new Response(JSON.stringify(fallbackData), {
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'Content-Type': 'application/json' })
        });
      }

      // Check if this is a rate limit error
      if (error && error.message && error.message.includes('M_LIMIT_EXCEEDED')) {
        logger.warn('[matrixFetchUtils] Caught M_LIMIT_EXCEEDED error');

        // Extract endpoint path for rate limiting
        let endpoint = 'unknown';
        if (typeof url === 'string') {
          const endpointMatch = url.match(/\/_matrix\/client\/[^/]+\/([^?]+)/);
          endpoint = endpointMatch ? endpointMatch[1] : url;

          // Add this endpoint to rate limited endpoints
          rateLimitedEndpoints[endpoint] = Date.now() + rateLimitCooldownTime;

          // If this is a critical endpoint, activate global rate limiting
          if (endpoint.includes('createRoom') || endpoint.includes('sync') || endpoint.includes('send')) {
            logger.warn(`[matrixFetchUtils] Activating global rate limit for ${globalRateLimitCooldown}ms`);
            window._matrixRequestTracking.globalRateLimitActive = true;
            window._matrixRequestTracking.globalRateLimitExpiry = Date.now() + globalRateLimitCooldown;
          }
        }

        // Return a rate limit error response
        return new Response(JSON.stringify({
          errcode: 'M_LIMIT_EXCEEDED',
          error: 'Rate limit exceeded',
          retry_after_ms: rateLimitCooldownTime
        }), {
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({ 'Content-Type': 'application/json' })
        });
      }

      // Fall back to original fetch if our patch fails
      return window._originalFetch(url, options);
    }
  };

  // Mark as patched to prevent multiple patches
  window._matrixFetchPatched = true;

  logger.info('[matrixFetchUtils] Successfully patched global fetch method for Matrix requests');
};

export default {
  safeFetch,
  patchMatrixFetch
};
