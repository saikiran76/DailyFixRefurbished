/**
 * Utility for prefetching and managing avatar images
 */
import avatarCacheService from '../services/AvatarCacheService';
import store from '../store';

/**
 * Prefetch avatars for all contacts in the background
 * @param {boolean} force - Force prefetch even if already cached
 */
export const prefetchAllAvatars = async (force = false) => {
  const state = store.getState();
  const contacts = state.contacts?.items || [];
  const userId = state.auth?.user?.id;
  
  if (!userId || contacts.length === 0) {
    console.log('No contacts or user ID available for prefetching avatars');
    return;
  }
  
  console.log(`Starting background prefetch for ${contacts.length} contacts`);
  
  // Process in batches to avoid overwhelming the browser
  const batchSize = 5;
  const contactsWithAvatars = contacts.filter(contact => contact.avatar_url);
  
  console.log(`Found ${contactsWithAvatars.length} contacts with avatars`);
  
  // Process in batches
  const batches = [];
  for (let i = 0; i < contactsWithAvatars.length; i += batchSize) {
    batches.push(contactsWithAvatars.slice(i, i + batchSize));
  }
  
  let prefetchedCount = 0;
  let cachedCount = 0;
  let errorCount = 0;
  
  for (const [batchIndex, batch] of batches.entries()) {
    console.log(`Processing batch ${batchIndex + 1}/${batches.length}`);
    
    await Promise.all(
      batch.map(async (contact) => {
        try {
          if (!contact.avatar_url) return;
          
          // Extract media ID from avatar URL
          let mediaId = null;
          
          if (contact.avatar_url.startsWith('mxc://')) {
            const matches = contact.avatar_url.match(/mxc:\/\/[^/]+\/([^?]+)/);
            mediaId = matches ? matches[1] : null;
          } else if (contact.avatar_url.includes('/thumbnail/')) {
            const matches = contact.avatar_url.match(/\/thumbnail\/[^/]+\/([^?]+)/);
            mediaId = matches ? matches[1] : null;
          }
          
          if (!mediaId) return;
          
          // Check if already in cache
          if (!force) {
            const cachedAvatar = await avatarCacheService.getAvatar(userId, contact.id, mediaId);
            if (cachedAvatar) {
              cachedCount++;
              return; // Skip if already cached
            }
          }
          
          // Fetch avatar
          const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000';
          const avatarEndpoint = `${apiUrl}/api/v1/media/avatar/${mediaId}?width=40&height=40`;
          
          const response = await fetch(avatarEndpoint, {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
            },
          });
          
          if (!response.ok) {
            throw new Error(`Failed to fetch avatar: ${response.status} ${response.statusText}`);
          }
          
          // Get the blob and content type
          const blob = await response.blob();
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          
          // Store in IndexedDB cache
          await avatarCacheService.storeAvatar(userId, contact.id, mediaId, blob, contentType);
          
          prefetchedCount++;
        } catch (error) {
          console.error(`Error prefetching avatar for contact ${contact.id}:`, error);
          errorCount++;
        }
      })
    );
    
    // Small delay between batches to avoid overwhelming the browser
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log(`Avatar prefetch complete: ${prefetchedCount} prefetched, ${cachedCount} already cached, ${errorCount} errors`);
  return { prefetchedCount, cachedCount, errorCount };
};

/**
 * Clear all cached avatars for the current user
 */
export const clearAllAvatars = async () => {
  const state = store.getState();
  const userId = state.auth?.user?.id;
  
  if (!userId) {
    console.log('No user ID available for clearing avatars');
    return;
  }
  
  await avatarCacheService.clearUserAvatars(userId);
  console.log('All avatars cleared for current user');
};

/**
 * Get cache statistics
 */
export const getAvatarCacheStats = async () => {
  const size = await avatarCacheService.getCacheSize();
  return {
    size,
    sizeFormatted: formatBytes(size),
  };
};

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export default {
  prefetchAllAvatars,
  clearAllAvatars,
  getAvatarCacheStats,
};
