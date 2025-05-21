/**
 * Utility functions for handling Matrix media
 */
import logger from './logger';
import cacheManager from './cacheManager';

// In-memory cache for quick access
const mediaCache = new Map();

// Cache settings
const USE_CACHE = true; // Set to false to disable caching

/**
 * Get a media URL with proper error handling and caching
 * @param {Object} client - Matrix client
 * @param {string} mxcUrl - mxc:// URL
 * @param {Object} options - Options for the media URL
 * @param {string} options.type - Type of media (thumbnail, download)
 * @param {number} options.width - Width for thumbnails
 * @param {number} options.height - Height for thumbnails
 * @param {string} options.method - Method for thumbnails (crop, scale)
 * @param {string} options.fallbackUrl - Fallback URL if mxcUrl is invalid
 * @returns {string} - HTTP URL for the media
 *
 * Note: This function is currently implemented to work synchronously
 * for backward compatibility. In the future, it will be fully async.
 */
export const getMediaUrl = (client, mxcUrl, options = {}) => {
  if (!mxcUrl || !client) {
    return options.fallbackUrl || '';
  }

  // If not an mxc URL, return as is
  if (!mxcUrl.startsWith('mxc://')) {
    return mxcUrl;
  }

  // Create a cache key
  const cacheKey = `${mxcUrl}_${JSON.stringify(options)}`;

  // Try to get from cache first if caching is enabled
  if (USE_CACHE) {
    try {
      // Check memory cache first (fastest)
      if (mediaCache.has(cacheKey)) {
        return mediaCache.get(cacheKey);
      }

      // Check IndexedDB cache next (persistent but still fast)
      // For now, use the synchronous localStorage fallback
      const cachedUrl = localStorage.getItem(`media_cache_${cacheKey}`);
      if (cachedUrl) {
        // Add to memory cache for faster future access
        mediaCache.set(cacheKey, cachedUrl);
        return cachedUrl;
      }

      // In the future, we'll use the async version:
      // const cachedUrl = await getCachedMediaUrl(cacheKey);
    } catch (cacheError) {
      logger.warn('[mediaUtils] Error accessing media cache:', cacheError);
      // Continue with network request if cache fails
    }
  }

  try {
    // Extract the server name and media ID from the mxc URL
    const [, serverName, mediaId] = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/) || [];

    if (!serverName || !mediaId) {
      logger.warn(`[mediaUtils] Invalid mxc URL: ${mxcUrl}`);
      return options.fallbackUrl || '';
    }

    // Get the access token
    const accessToken = client.getAccessToken();
    if (!accessToken) {
      logger.warn('[mediaUtils] No access token available');
      return options.fallbackUrl || '';
    }

    // Create the URL based on the type
    let url;
    const { type = 'download', width = 800, height = 600, method = 'scale' } = options;

    // Use the client/v1 endpoint which is more reliable
    // Note: We're switching to using Authorization header instead of query parameter
    if (type === 'thumbnail') {
      url = `${client.baseUrl}/_matrix/media/v3/thumbnail/${serverName}/${mediaId}?width=${width}&height=${height}&method=${method}&allow_redirect=true`;
    } else {
      url = `${client.baseUrl}/_matrix/media/v3/download/${serverName}/${mediaId}?allow_redirect=true`;
    }

    // For direct use in img src, we need to include the access token
    // We'll use a data URL approach to avoid exposing the token in the DOM
    const fullUrl = `${url}`;

    // For the returned URL, we'll create a version with the access token included
    // This is not ideal for security, but necessary for direct use in img tags
    const urlWithAuth = `${url}&access_token=${encodeURIComponent(accessToken)}`;

    // Cache the URL with its access token for future use if caching is enabled
    if (USE_CACHE) {
      // Store in memory cache
      mediaCache.set(cacheKey, urlWithAuth);

      // Store in persistent cache (synchronous version for now)
      localStorage.setItem(`media_cache_${cacheKey}`, urlWithAuth);

      // In the future, we'll use the async version:
      // await cacheMediaUrl(cacheKey, fullUrl, accessToken);

      // For background caching, we can still call the async version without awaiting
      setTimeout(() => {
        cacheMediaUrl(cacheKey, fullUrl, accessToken)
          .catch(err => logger.warn('[mediaUtils] Background caching error:', err));
      }, 0);
    }

    return urlWithAuth;
  } catch (error) {
    logger.error('[mediaUtils] Error generating media URL:', error);
    return options.fallbackUrl || '';
  }
};

/**
 * Get a cached media URL from IndexedDB
 * @param {string} cacheKey - Cache key
 * @returns {Promise<string|null>} - Cached URL or null if not found
 *
 * Note: This async function is currently not used directly in the synchronous getMediaUrl
 * but will be used in the future when we make getMediaUrl fully async.
 */
// Export for future use
export const _getCachedMediaUrlAsync = async (cacheKey) => {
  if (!USE_CACHE) return null;

  try {
    // First check in-memory cache (fastest)
    if (mediaCache.has(cacheKey)) {
      return mediaCache.get(cacheKey);
    }

    // Then check persistent cache using cacheManager
    const cachedData = await cacheManager.getCachedMedia(cacheKey);
    if (cachedData) {
      // Add to memory cache for faster future access
      mediaCache.set(cacheKey, cachedData);
      return cachedData;
    }

    // Fallback to localStorage for backward compatibility
    const cachedUrl = localStorage.getItem(`media_cache_${cacheKey}`);
    if (cachedUrl) {
      return cachedUrl;
    }
  } catch (error) {
    logger.warn('[mediaUtils] Error accessing media cache:', error);
  }
  return null;
};

/**
 * Cache a media URL in IndexedDB
 * @param {string} cacheKey - Cache key
 * @param {string} url - URL to cache
 * @param {string} accessToken - Access token for authentication
 */
const cacheMediaUrl = async (cacheKey, url, accessToken) => {
  // This function is async but called in a non-awaited context from getMediaUrl
  if (!USE_CACHE) return;

  try {
    // Add authentication token if provided
    const urlWithAuth = accessToken ? `${url}&access_token=${encodeURIComponent(accessToken)}` : url;

    // Add to memory cache
    mediaCache.set(cacheKey, urlWithAuth);

    // Add to persistent cache using cacheManager
    await cacheManager.cacheMedia(cacheKey, urlWithAuth);

    // Also keep in localStorage for backward compatibility
    localStorage.setItem(`media_cache_${cacheKey}`, urlWithAuth);

    logger.debug(`[mediaUtils] Cached media URL for key: ${cacheKey}`);
  } catch (error) {
    logger.warn('[mediaUtils] Error caching media URL:', error);
  }
};

/**
 * Clear the media cache
 */
export const clearMediaCache = async () => {
  // Clear memory cache
  mediaCache.clear();

  // Clear IndexedDB cache using cacheManager
  try {
    // Run cleanup to remove expired cache entries
    await cacheManager.cleanupExpiredCache();

    // Clear localStorage cache for backward compatibility
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('media_cache_')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
    logger.info(`[mediaUtils] Cleared media cache and ${keysToRemove.length} legacy cached items`);
  } catch (error) {
    logger.error('[mediaUtils] Error clearing cache:', error);
  }
};

/**
 * Get a fallback avatar URL for a user
 * @param {string} name - User name
 * @param {string} color - Background color
 * @returns {string} - Data URL for the avatar
 */
export const getFallbackAvatarUrl = (name = '?', color = '#0088cc') => {
  const initial = name.charAt(0).toUpperCase();
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
      <rect width="40" height="40" fill="${color}" rx="20" ry="20"/>
      <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="20" fill="white" text-anchor="middle" dominant-baseline="central">${initial}</text>
    </svg>
  `;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
};

export default {
  getMediaUrl,
  clearMediaCache,
  getFallbackAvatarUrl
};
