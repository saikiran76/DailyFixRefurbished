/**
 * Simple utility for caching media URLs to avoid repetitive requests
 */

// In-memory cache for quick access
const memoryCache = new Map();

// Check if IndexedDB is available
const isIndexedDBAvailable = typeof window !== 'undefined' && window.indexedDB;

// Database name and store name
const DB_NAME = 'matrix_media_cache';
const STORE_NAME = 'media_urls';

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>} - The database instance
 */
const initDB = () => {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable) {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, 1);

    request.onerror = (event) => {
      console.error('Error opening IndexedDB:', event.target.error);
      reject(event.target.error);
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
};

/**
 * Get a media URL from the cache
 * @param {string} mxcUrl - The mxc:// URL
 * @param {string} type - The type of media (thumbnail, download)
 * @param {Object} options - Additional options (width, height, etc.)
 * @returns {Promise<string|null>} - The cached URL or null if not found
 */
export const getCachedMediaUrl = async (mxcUrl, type = 'download', options = {}) => {
  if (!mxcUrl) return null;

  // Create a unique key for the cache
  const key = `${mxcUrl}_${type}_${JSON.stringify(options)}`;

  // Check memory cache first
  if (memoryCache.has(key)) {
    return memoryCache.get(key);
  }

  // If IndexedDB is not available, return null
  if (!isIndexedDBAvailable) {
    return null;
  }

  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = (event) => {
        const result = event.target.result;
        if (result) {
          // Add to memory cache for faster access next time
          memoryCache.set(key, result.url);
          resolve(result.url);
        } else {
          resolve(null);
        }
      };

      request.onerror = (event) => {
        console.error('Error getting from cache:', event.target.error);
        resolve(null);
      };
    });
  } catch (error) {
    console.error('Error accessing cache:', error);
    return null;
  }
};

/**
 * Store a media URL in the cache
 * @param {string} mxcUrl - The mxc:// URL
 * @param {string} httpUrl - The HTTP URL
 * @param {string} type - The type of media (thumbnail, download)
 * @param {Object} options - Additional options (width, height, etc.)
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
export const cacheMediaUrl = async (mxcUrl, httpUrl, type = 'download', options = {}) => {
  if (!mxcUrl || !httpUrl) return false;

  // Create a unique key for the cache
  const key = `${mxcUrl}_${type}_${JSON.stringify(options)}`;

  // Add to memory cache
  memoryCache.set(key, httpUrl);

  // If IndexedDB is not available, return true (we at least cached in memory)
  if (!isIndexedDBAvailable) {
    return true;
  }

  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put({
        key,
        url: httpUrl,
        mxcUrl,
        type,
        options,
        timestamp: Date.now()
      });

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('Error storing in cache:', event.target.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('Error accessing cache:', error);
    return false;
  }
};

/**
 * Clear the media cache
 * @returns {Promise<boolean>} - Whether the operation was successful
 */
export const clearMediaCache = async () => {
  // Clear memory cache
  memoryCache.clear();

  // If IndexedDB is not available, return true (we at least cleared memory)
  if (!isIndexedDBAvailable) {
    return true;
  }

  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        resolve(true);
      };

      request.onerror = (event) => {
        console.error('Error clearing cache:', event.target.error);
        resolve(false);
      };
    });
  } catch (error) {
    console.error('Error accessing cache:', error);
    return false;
  }
};

/**
 * Get a media URL with caching
 * @param {Object} client - The Matrix client
 * @param {string} mxcUrl - The mxc:// URL
 * @param {string} type - The type of media (thumbnail, download)
 * @param {Object} options - Additional options (width, height, etc.)
 * @returns {Promise<string>} - The HTTP URL
 */
export const getMediaUrl = async (client, mxcUrl, type = 'download', options = {}) => {
  if (!mxcUrl || !mxcUrl.startsWith('mxc://') || !client) {
    return mxcUrl;
  }

  // Try to get from cache first
  const cachedUrl = await getCachedMediaUrl(mxcUrl, type, options);
  if (cachedUrl) {
    return cachedUrl;
  }

  // If not in cache, generate the URL
  try {
    // Extract the server name and media ID from the mxc URL
    const [, serverName, mediaId] = mxcUrl.match(/^mxc:\/\/([^/]+)\/(.+)$/) || [];
    
    if (!serverName || !mediaId) {
      return client.mxcUrlToHttp(mxcUrl);
    }

    const accessToken = client.getAccessToken();
    let httpUrl;

    if (type === 'thumbnail') {
      const { width = 800, height = 600, method = 'scale' } = options;
      httpUrl = `${client.baseUrl}/_matrix/media/r0/thumbnail/${serverName}/${mediaId}?width=${width}&height=${height}&method=${method}&access_token=${encodeURIComponent(accessToken)}`;
    } else {
      httpUrl = `${client.baseUrl}/_matrix/media/r0/download/${serverName}/${mediaId}?access_token=${encodeURIComponent(accessToken)}`;
    }

    // Cache the URL for future use
    await cacheMediaUrl(mxcUrl, httpUrl, type, options);

    return httpUrl;
  } catch (error) {
    console.error('Error generating media URL:', error);
    return client.mxcUrlToHttp(mxcUrl);
  }
};

export default {
  getCachedMediaUrl,
  cacheMediaUrl,
  clearMediaCache,
  getMediaUrl
};
