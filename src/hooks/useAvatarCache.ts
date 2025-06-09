import { useState, useCallback, useEffect } from 'react';
import { useSelector } from 'react-redux';
import avatarCacheService from '@/services/AvatarCacheService';
import type { RootState } from '@/store/store';

/**
 * Hook for managing avatar cache operations
 */
const useAvatarCache = () => {
  const [cacheStats, setCacheStats] = useState({
    size: 0,
    count: 0,
    loading: true,
  });
  const userId = useSelector((state: RootState) => state.auth.user?.id);

  /**
   * Get avatar from cache or fetch from server
   * @param {string} contactId - Contact ID
   * @param {string} mediaId - Media ID
   * @param {number} size - Avatar size
   * @returns {Promise<{url: string|null, fromCache: boolean}>}
   */
  const getAvatar = useCallback(async (contactId: string, mediaId: string, size = 40) => {
    if (!userId || !contactId || !mediaId) {
      return { url: null, fromCache: false };
    }

    try {
      // Try to get from cache first
      const cachedAvatar = await avatarCacheService.getAvatar(userId, contactId, mediaId);
      
      if (cachedAvatar && cachedAvatar.blob) {
        // Create a URL for the cached blob
        const objectUrl = URL.createObjectURL(cachedAvatar.blob);
        return { url: objectUrl, fromCache: true, objectUrl };
      }
      
      // If not in cache, fetch from API
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
      const avatarEndpoint = `${apiUrl}/api/v1/media/avatar/${mediaId}?width=${size}&height=${size}`;
      
      // Get auth token with fallbacks
      let token = localStorage.getItem('access_token');
      
      // If token not found in access_token, try to get from dailyfix_auth
      if (!token) {
        const authDataStr = localStorage.getItem('dailyfix_auth');
        if (authDataStr) {
          try {
            const authData = JSON.parse(authDataStr);
            token = authData.session?.access_token;
          } catch (e) {
            console.error('Error parsing auth data:', e);
          }
        }
      }
      
      // If still no token, try to get from persist:auth (Redux persisted state)
      if (!token) {
        const authStr = localStorage.getItem('persist:auth');
        if (authStr) {
          try {
            const authData = JSON.parse(authStr);
            const sessionData = JSON.parse(authData.session);
            token = sessionData?.access_token;
          } catch (e) {
            console.error('Error parsing persisted auth data:', e);
          }
        }
      }
      
      if (!token) {
        throw new Error('No authentication token available');
      }
      
      const response = await fetch(avatarEndpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch avatar: ${response.status} ${response.statusText}`);
      }
      
      // Get the blob and content type
      const blob = await response.blob();
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      // Store in IndexedDB cache
      await avatarCacheService.storeAvatar(userId, contactId, mediaId, blob, contentType);
      
      // Create a URL for the blob
      const objectUrl = URL.createObjectURL(blob);
      return { url: objectUrl, fromCache: false, objectUrl };
    } catch (error) {
      console.error('Error in getAvatar:', error);
      return { url: null, fromCache: false, error };
    }
  }, [userId]);

  /**
   * Prefetch and cache avatars for a list of contacts
   * @param {Array} contacts - List of contacts with mediaId and contactId
   */
  const prefetchAvatars = useCallback(async (contacts) => {
    if (!userId || !contacts || contacts.length === 0) return;
    
    // Process in batches to avoid overwhelming the browser
    const batchSize = 5;
    const batches = [];
    
    for (let i = 0; i < contacts.length; i += batchSize) {
      batches.push(contacts.slice(i, i + batchSize));
    }
    
    for (const batch of batches) {
      await Promise.all(
        batch.map(async (contact) => {
          if (!contact.mediaId || !contact.id) return;
          
          try {
            // Check if already in cache
            const cachedAvatar = await avatarCacheService.getAvatar(userId, contact.id, contact.mediaId);
            if (cachedAvatar) return; // Skip if already cached
            
            // Fetch and cache
            await getAvatar(contact.id, contact.mediaId);
          } catch (error) {
            console.error(`Error prefetching avatar for contact ${contact.id}:`, error);
          }
        })
      );
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }, [userId, getAvatar]);

  /**
   * Clear all avatars for the current user
   */
  const clearUserCache = useCallback(async () => {
    if (!userId) return;
    
    try {
      await avatarCacheService.clearUserAvatars(userId);
      updateCacheStats();
    } catch (error) {
      console.error('Error clearing user cache:', error);
    }
  }, [userId]);

  /**
   * Clear expired avatars
   * @param {number} days - Number of days after which avatars are considered expired
   */
  const clearExpiredAvatars = useCallback(async (days = 7) => {
    try {
      const deletedCount = await avatarCacheService.clearExpiredAvatars(days);
      updateCacheStats();
      return deletedCount;
    } catch (error) {
      console.error('Error clearing expired avatars:', error);
      return 0;
    }
  }, []);

  /**
   * Update cache statistics
   */
  const updateCacheStats = useCallback(async () => {
    try {
      setCacheStats(prev => ({ ...prev, loading: true }));
      
      const size = await avatarCacheService.getCacheSize();
      
      // Count is more complex to calculate, would require a full scan
      // For now, we'll just set it to a placeholder value
      setCacheStats({
        size,
        count: -1, // Placeholder
        loading: false,
      });
    } catch (error) {
      console.error('Error updating cache stats:', error);
      setCacheStats(prev => ({ ...prev, loading: false }));
    }
  }, []);

  // Update cache stats on mount
  useEffect(() => {
    if (userId) {
      updateCacheStats();
    }
  }, [userId, updateCacheStats]);

  return {
    getAvatar,
    prefetchAvatars,
    clearUserCache,
    clearExpiredAvatars,
    updateCacheStats,
    cacheStats,
  };
};

export default useAvatarCache;
