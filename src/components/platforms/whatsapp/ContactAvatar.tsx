import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import avatarCacheService from '@/services/AvatarCacheService';
import { useSelector } from 'react-redux';
import type { RootState } from '@/store/store';

/**
 * Component to display a contact's avatar with fallback to initials when no avatar is available
 * Uses IndexedDB for persistent caching of avatars
 */
const ContactAvatar = ({ contact, size = 40 }: { contact: any, size?: number }) => {
  const [loadingState, setLoadingState] = useState('loading');
  const [mediaId, setMediaId] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const userId = useSelector((state: RootState) => state.auth.user?.id);

  const containerStyle = {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${size / 2.5}px`
  };

  // Extract media ID from Matrix MXC URLs or full URLs
  useEffect(() => {
    if (!contact?.avatar_url) {
      setLoadingState('error');
      return;
    }

    const avatarUrl = contact.avatar_url;

    // Extract media ID
    let extractedId = null;

    // Handle mxc:// URLs
    if (avatarUrl.startsWith('mxc://')) {
      const matches = avatarUrl.match(/mxc:\/\/[^/]+\/([^?]+)/);
      extractedId = matches ? matches[1] : null;
    }
    // Handle thumbnail URLs
    else if (avatarUrl.includes('/thumbnail/')) {
      const matches = avatarUrl.match(/\/thumbnail\/[^/]+\/([^?]+)/);
      extractedId = matches ? matches[1] : null;
    }

    if (extractedId) {
      setMediaId(extractedId);

      // Fetch avatar with IndexedDB caching
      fetchAvatarWithCache(extractedId, contact.id);
    } else {
      setLoadingState('error');
    }
  }, [contact?.avatar_url, contact?.id, size, userId]);

  // Fetch avatar with IndexedDB caching
  const fetchAvatarWithCache = async (mediaId: string, contactId: string) => {
    if (!userId || !contactId || !mediaId) {
      setLoadingState('error');
      return;
    }

    try {
      // Try to get from IndexedDB cache first
      const cachedAvatar: any = await avatarCacheService.getAvatar(userId, contactId, mediaId);

      if (cachedAvatar && cachedAvatar.blob) {
        // Create a URL for the cached blob
        const objectUrl = URL.createObjectURL(cachedAvatar.blob);
        setImageUrl(objectUrl);
        setLoadingState('loaded');
        console.log(`Avatar loaded from cache: ${contactId}:${mediaId}`);
        return;
      }

      // Not in cache, fetch from API
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
      setImageUrl(objectUrl);
      setLoadingState('loaded');
      console.log(`Avatar fetched and cached: ${contactId}:${mediaId}`);
    } catch (error) {
      console.error(`Error fetching avatar for ${mediaId}:`, error);
      setLoadingState('error');
    }
  };

  // Clean up blob URLs on unmount or when they change
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  // If no avatar or error occurred, show initials
  if (!mediaId || loadingState === 'error') {
    return (
      <div
        className="rounded-full bg-purple-600 flex items-center justify-center text-white font-medium"
        style={containerStyle}
      >
        {contact?.display_name?.[0]?.toUpperCase() || '?'}
      </div>
    );
  }

  // Show loading placeholder while fetching
  if (loadingState === 'loading') {
    return (
      <div
        className="rounded-full bg-gray-700 flex items-center justify-center animate-pulse"
        style={containerStyle}
      >
        <span className="text-xs text-gray-300">...</span>
      </div>
    );
  }

  // Show the image with fallback handling
  return (
    <img
      src={imageUrl || ''}
      alt={contact?.display_name || 'Contact'}
      className="rounded-full object-cover"
      style={containerStyle}
      onError={() => setLoadingState('error')}
      loading="lazy"
    />
  );
};

ContactAvatar.propTypes = {
  contact: PropTypes.object.isRequired,
  size: PropTypes.number
};

export default ContactAvatar;
