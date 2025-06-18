import { useState, useEffect, useCallback } from 'react';
import { useSelector } from 'react-redux';
import platformManager from '@/services/PlatformManager';
import logger from '@/utils/logger';

interface PlatformConnectionStatus {
  whatsappConnected: boolean;
  telegramConnected: boolean;
  connectedPlatforms: string[];
  totalConnected: number;
  isLoading: boolean;
  lastChecked?: Date;
  isApiVerified: boolean;
  refreshWithApiVerification?: () => void;
}

/**
 * Custom hook to get accurate platform connection status using PlatformManager with real-time API verification
 */
export const usePlatformConnection = (): PlatformConnectionStatus => {
  const [connectionStatus, setConnectionStatus] = useState<PlatformConnectionStatus>({
    whatsappConnected: false,
    telegramConnected: false,
    connectedPlatforms: [],
    totalConnected: 0,
    isLoading: true,
    isApiVerified: false
  });

  // Get current user from auth state
  const currentUser = useSelector((state: any) => state.auth.session?.user);

  const checkPlatformConnectionsRealtime = useCallback(async (forceApiCheck: boolean = false) => {
    try {
      logger.info('[usePlatformConnection] Checking platform connection status with real-time API verification');
      
      if (!currentUser?.id) {
        logger.warn('[usePlatformConnection] No user ID available');
        setConnectionStatus({
          whatsappConnected: false,
          telegramConnected: false,
          connectedPlatforms: [],
          totalConnected: 0,
          isLoading: false,
          lastChecked: new Date(),
          isApiVerified: false
        });
        return;
      }

      setConnectionStatus(prev => ({ ...prev, isLoading: true }));

      // Use PlatformManager's new real-time API verification
      const activePlatforms = await platformManager.getAllActivePlatformsRealtime(false, forceApiCheck);
      
      // Check individual platforms
      const whatsappConnected = activePlatforms.includes('whatsapp');
      const telegramConnected = activePlatforms.includes('telegram');
      
      const newStatus = {
        whatsappConnected,
        telegramConnected,
        connectedPlatforms: activePlatforms,
        totalConnected: activePlatforms.length,
        isLoading: false,
        lastChecked: new Date(),
        isApiVerified: forceApiCheck
      };

      logger.info('[usePlatformConnection] Platform connection status updated with API verification:', {
        ...newStatus,
        userId: currentUser.id,
        forceApiCheck
      });

      setConnectionStatus(newStatus);

    } catch (error) {
      logger.error('[usePlatformConnection] Error checking platform connections:', error);
      setConnectionStatus(prev => ({
        ...prev,
        isLoading: false,
        lastChecked: new Date(),
        isApiVerified: false
      }));
    }
  }, [currentUser?.id]);

  // Initial check - use localStorage for fast initial load
  const checkPlatformConnections = useCallback(async () => {
    try {
      logger.info('[usePlatformConnection] Initial platform connection check (localStorage)');
      
      if (!currentUser?.id) {
        logger.warn('[usePlatformConnection] No user ID available');
        setConnectionStatus({
          whatsappConnected: false,
          telegramConnected: false,
          connectedPlatforms: [],
          totalConnected: 0,
          isLoading: false,
          isApiVerified: false
        });
        return;
      }

      // Use PlatformManager to get accurate connection status (no verification for initial check)
      const activePlatforms = platformManager.getAllActivePlatforms(false);
      
      // Check individual platforms
      const whatsappConnected = activePlatforms.includes('whatsapp');
      const telegramConnected = activePlatforms.includes('telegram');
      
      const newStatus = {
        whatsappConnected,
        telegramConnected,
        connectedPlatforms: activePlatforms,
        totalConnected: activePlatforms.length,
        isLoading: false,
        lastChecked: new Date(),
        isApiVerified: false
      };

      logger.info('[usePlatformConnection] Initial platform connection status loaded:', {
        ...newStatus,
        userId: currentUser.id
      });

      setConnectionStatus(newStatus);

      // After initial load, verify with API in the background
      setTimeout(() => {
        checkPlatformConnectionsRealtime(false);
      }, 1000);

    } catch (error) {
      logger.error('[usePlatformConnection] Error checking platform connections:', error);
      setConnectionStatus(prev => ({
        ...prev,
        isLoading: false,
        isApiVerified: false
      }));
    }
  }, [currentUser?.id, checkPlatformConnectionsRealtime]);

  // Force refresh with API verification
  const refreshWithApiVerification = useCallback(() => {
    logger.info('[usePlatformConnection] Force refreshing with API verification');
    checkPlatformConnectionsRealtime(true);
  }, [checkPlatformConnectionsRealtime]);

  // Check connections ONLY on mount and when user changes
  useEffect(() => {
    checkPlatformConnections();
  }, [checkPlatformConnections]);

  // Listen for platform connection change events
  useEffect(() => {
    const handlePlatformConnectionChange = (event: CustomEvent) => {
      logger.info('[usePlatformConnection] Platform connection change event received', event.detail);
      
      // If this is a refresh-all event or API-verified change, do a full API check
      if (event.detail?.source === 'refresh-all' || event.detail?.source === 'api-verification') {
        checkPlatformConnectionsRealtime(true);
      } else {
        // For other events, do a quick localStorage check followed by API verification
        checkPlatformConnections();
      }
    };

    const handleRefreshPlatformStatus = () => {
      logger.info('[usePlatformConnection] Refresh platform status event received');
      refreshWithApiVerification();
    };

    // Add event listeners
    window.addEventListener('platform-connection-changed', handlePlatformConnectionChange as EventListener);
    window.addEventListener('refresh-platform-status', handleRefreshPlatformStatus);

    // Cleanup
    return () => {
      window.removeEventListener('platform-connection-changed', handlePlatformConnectionChange as EventListener);
      window.removeEventListener('refresh-platform-status', handleRefreshPlatformStatus);
    };
  }, [checkPlatformConnections, checkPlatformConnectionsRealtime, refreshWithApiVerification]);

  return {
    ...connectionStatus,
    refreshWithApiVerification
  };
}; 