import React, { useState, useEffect } from 'react';
import { FaWhatsapp, FaTelegram } from 'react-icons/fa';
import platformManager from '@/services/PlatformManager';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, WifiOff, ServerOff, AlertTriangle, RefreshCw } from "lucide-react";
import api from '@/utils/api';
import logger from '@/utils/logger';
import { toast } from 'react-hot-toast';
import {
  saveWhatsAppStatus,
  saveTelegramStatus,
  getWhatsAppConnectionStatus,
  saveWhatsAppConnectionStatus,
  getTelegramConnectionStatus,
  saveTelegramConnectionStatus
} from '@/utils/connectionStorage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";

interface PlatformsInfoProps {
  onStartSync: (platform: string) => void;
  isCheckingStatus?: boolean; // Prop to indicate status checking
}

const PlatformsInfo: React.FC<PlatformsInfoProps> = ({ onStartSync, isCheckingStatus = false }) => {
  const [activePlatforms, setActivePlatforms] = useState<string[]>([]);
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>(navigator.onLine ? 'online' : 'offline');
  const [serverStatus, setServerStatus] = useState<'up' | 'down' | 'unknown'>('unknown');
  
  // New states for platform status verification
  const [verifyingPlatform, setVerifyingPlatform] = useState<string | null>(null);
  const [verificationAttempts, setVerificationAttempts] = useState<number>(0);
  const [showDisconnectedDialog, setShowDisconnectedDialog] = useState<boolean>(false);
  const [showErrorDialog, setShowErrorDialog] = useState<boolean>(false);
  const [disconnectedPlatform, setDisconnectedPlatform] = useState<string | null>(null);
  // New state for refreshing all platforms
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Monitor network status
  useEffect(() => {
    const handleOnline = () => {
      setNetworkStatus('online');
      // Reset server status when going back online
      setServerStatus('unknown');
    };
    
    const handleOffline = () => {
      setNetworkStatus('offline');
    };
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Listen for refresh events triggered from the platform switcher
  useEffect(() => {
    const handleRefreshEvent = () => {
      logger.info('[PlatformsInfo] Received refresh-platform-status event');
      refreshAllPlatforms();
    };
    
    window.addEventListener('refresh-platform-status', handleRefreshEvent);
    
    return () => {
      window.removeEventListener('refresh-platform-status', handleRefreshEvent);
    };
  }, []);

  // Check for active platforms on mount and when they might change
  useEffect(() => {
    const updateActivePlatforms = () => {
      // If we're offline, don't make any API calls but keep current platforms
      if (networkStatus === 'offline') {
        return;
      }
      
      try {
        // Use verified platforms if status check is complete
        const platforms = isCheckingStatus 
          ? platformManager.getAllActivePlatforms(false) // Get all, including unverified during check
          : platformManager.getAllActivePlatforms(true);  // Get only verified when check is done
          
        // Filter out 'matrix' if it's included, as per requirements
        const filteredPlatforms = platforms.filter(p => p !== 'matrix');
        setActivePlatforms(filteredPlatforms);
        
        // If we successfully got platforms, server must be up
        if (serverStatus === 'down') {
          setServerStatus('up');
        }
      } catch (error) {
        console.error('Error getting active platforms:', error);
        // If we encounter errors, might be a server issue
        setServerStatus('down');
      }
    };

    // Initial check
    updateActivePlatforms();

    // Set up event listener for platform connection changes
    window.addEventListener('platform-connection-changed', updateActivePlatforms);
    
    // Clean up
    return () => {
      window.removeEventListener('platform-connection-changed', updateActivePlatforms);
    };
  }, [isCheckingStatus, networkStatus, serverStatus]);

  // Listen for server errors
  useEffect(() => {
    const handleServerError = (event: CustomEvent) => {
      if (event.detail?.type === 'server_down') {
        setServerStatus('down');
      }
    };
    
    // Add a typed event listener
    window.addEventListener('server-error' as any, handleServerError as EventListener);
    
    return () => {
      window.removeEventListener('server-error' as any, handleServerError as EventListener);
    };
  }, []);

  // Helper function to get platform icon
  const getPlatformIcon = (platform: string) => {
    switch (platform) {
      case 'whatsapp':
        return <FaWhatsapp className="h-6 w-6 text-green-500" />;
      case 'telegram':
        return <FaTelegram className="h-6 w-6 text-blue-500" />;
      default:
        return null;
    }
  };

  // New function to check platform status before starting sync
  const checkPlatformStatus = async (platform: string) => {
    try {
      // Skip if offline
      if (networkStatus === 'offline') {
        return;
      }
      
      // Set verifying state
      setVerifyingPlatform(platform);
      
      // Get current user ID
      const authDataStr = localStorage.getItem('dailyfix_auth');
      if (!authDataStr) {
        console.error('No auth data found for verification');
        setVerifyingPlatform(null);
        return;
      }
      
      const authData = JSON.parse(authDataStr);
      const userId = authData?.user?.id;
      if (!userId) {
        console.error('No user ID found for verification');
        setVerifyingPlatform(null);
        return;
      }
      
      // Increment verification attempt
      const currentAttempts = verificationAttempts + 1;
      setVerificationAttempts(currentAttempts);
      
      console.log(`[PlatformsInfo] Checking ${platform} status, attempt ${currentAttempts}/3`);
      
      // Call the status API
      const response = await api.get(`/api/v1/matrix/${platform}/status`);
      
      if (response.data) {
        console.log(`[PlatformsInfo] ${platform} status response:`, response.data);
        
        const isActive = response.data.status === 'active';
        const isVerified = response.data.verified === true;
        let statusChanged = false;
        
        if (platform === 'whatsapp') {
          // Get current status to check if it's changing
          const currentStatus = getWhatsAppConnectionStatus(userId);
          statusChanged = currentStatus?.isConnected !== isActive;
          
          // Update WhatsApp connection status
          saveWhatsAppConnectionStatus(userId, {
            isConnected: isActive,
            verified: isVerified,
            lastVerified: Date.now(),
            verificationAttempts: 0
          });
          
          // Also update simple status for backwards compatibility
          saveWhatsAppStatus(isActive, userId);
        } else if (platform === 'telegram') {
          // Get current status to check if it's changing
          const currentStatus = getTelegramConnectionStatus(userId);
          statusChanged = currentStatus?.isConnected !== isActive;
          
          // Update Telegram connection status
          saveTelegramConnectionStatus(userId, {
            isConnected: isActive,
            verified: isVerified,
            lastVerified: Date.now(),
            verificationAttempts: 0
          });
          
          // Also update simple status for backwards compatibility
          saveTelegramStatus(isActive, userId);
        }
        
        // If status changed, always notify all components
        if (statusChanged) {
          console.log(`[PlatformsInfo] Platform ${platform} connection status changed to: ${isActive ? 'active' : 'inactive'}`);
          
          // This is the critical part - dispatch an event to update all components that depend on connection status
          // The event needs to reach the AppSidebar component
          const event = new CustomEvent('platform-connection-changed', { 
            detail: { 
              platform,
              isActive,
              timestamp: Date.now()
            }
          });
          window.dispatchEvent(event);
        }
        
        // If platform is disconnected, show dialog
        if (!isActive) {
          setDisconnectedPlatform(platform);
          setShowDisconnectedDialog(true);
          toast.error(`${platform.charAt(0).toUpperCase() + platform.slice(1)} is disconnected. Please reconnect.`);
        } else {
          // Only proceed with sync if status is active
          setVerificationAttempts(0);
          setVerifyingPlatform(null);
          toast.success(`${platform.charAt(0).toUpperCase() + platform.slice(1)} is connected! Starting sync...`);
          onStartSync(platform);
        }
      } else {
        // If no data in response or status is 'error', handle accordingly
        throw new Error('Invalid status response');
      }
    } catch (error) {
      console.error(`Error checking ${platform} status:`, error);
      
      // If we've reached max attempts, show error dialog
      if (verificationAttempts >= 3) {
        setShowErrorDialog(true);
        setVerificationAttempts(0);
        toast.error(`Could not verify ${platform} status after multiple attempts`);
      } else if (verificationAttempts < 3) {
        // Retry if under max attempts
        toast.loading(`Retrying ${platform} status check...`);
        setTimeout(() => {
          checkPlatformStatus(platform);
        }, 2000);
        return;
      }
    } finally {
      // Reset verifying state if error or complete
      if (verificationAttempts >= 3) {
        setVerifyingPlatform(null);
      }
    }
  };

  // New function to refresh all platform connections
  const refreshAllPlatforms = async () => {
    const isOffline = networkStatus === 'offline';
    const isServerDown = serverStatus === 'down';
    if (isOffline || isServerDown || isRefreshing) {
      return;
    }
    
    setIsRefreshing(true);
    toast.loading('Refreshing platform connections...');
    
    try {
      // Get all platforms that need verification
      const platforms = platformManager.getAllActivePlatforms(false);
      
      // Nothing to verify if no platforms
      if (platforms.length === 0) {
        setIsRefreshing(false);
        toast.success('No platforms to refresh');
        return;
      }
      
      // Reset verification attempts
      setVerificationAttempts(0);
      
      console.log('[PlatformsInfo] Refreshing all platform connections:', platforms);
      
      // Verify each platform sequentially
      for (const platform of platforms) {
        await verifyPlatformConnection(platform);
      }
      
      toast.success('All platforms refreshed successfully');
    } catch (error) {
      console.error('[PlatformsInfo] Error refreshing platforms:', error);
      toast.error('Failed to refresh some platform connections');
    } finally {
      setIsRefreshing(false);
    }
  };
  
  // Function to verify a single platform connection status
  const verifyPlatformConnection = async (platform: string) => {
    try {
      const userId = JSON.parse(localStorage.getItem('dailyfix_auth') || '{}')?.user?.id;
      if (!userId) return;
      
      console.log(`[PlatformsInfo] Verifying ${platform} connection status`);
      const response = await api.get(`/api/v1/matrix/${platform}/status`);
      
      if (response.data) {
        const isActive = response.data.status === 'active';
        const isVerified = response.data.verified === true;
        
        // Update connection storage
        if (platform === 'whatsapp') {
          saveWhatsAppConnectionStatus(userId, {
            isConnected: isActive,
            verified: isVerified,
            lastVerified: Date.now(),
            verificationAttempts: 0
          });
        } else if (platform === 'telegram') {
          saveTelegramConnectionStatus(userId, {
            isConnected: isActive,
            verified: isVerified,
            lastVerified: Date.now(),
            verificationAttempts: 0
          });
        }
        
        // Trigger UI update
        const event = new CustomEvent('platform-connection-changed', { 
          detail: { 
            platform,
            isActive,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(event);
      }
    } catch (error) {
      console.error(`[PlatformsInfo] Error verifying ${platform}:`, error);
    }
  };

  // Render connectivity issues if needed
  const isOffline = networkStatus === 'offline';
  const isServerDown = serverStatus === 'down';

  if (isOffline) {
    return (
      <Card className="mb-6 w-full border-red-500/30 bg-red-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center text-xl font-bold text-red-400">
            <WifiOff className="h-5 w-5 mr-2 text-red-400" />
            You're Offline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 mb-4">
            We couldn't connect to the messaging platforms because your device appears to be offline. 
            Please check your internet connection and try again.
          </p>
          <div className="flex justify-end">
            <Button 
              onClick={() => window.location.reload()}
              size="sm"
              variant="outline"
              className="border-red-500/50 text-red-400 hover:bg-red-950/30"
            >
              Retry Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isServerDown) {
    return (
      <Card className="mb-6 w-full border-orange-500/30 bg-orange-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center text-xl font-bold text-orange-400">
            <ServerOff className="h-5 w-5 mr-2 text-orange-400" />
            Server Unavailable
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 mb-4">
            We're having trouble connecting to our servers. This could be due to maintenance or temporary issues.
            Please try again later.
          </p>
          <div className="flex justify-end">
            <Button 
              onClick={() => {
                setServerStatus('unknown');
                window.location.reload();
              }}
              size="sm"
              variant="outline"
              className="border-orange-500/50 text-orange-400 hover:bg-orange-950/30"
            >
              Retry Connection
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Don't render anything if no active platforms and we're not checking status
  if (activePlatforms.length === 0 && !isCheckingStatus) {
    return null;
  }

  // If we're checking status but have no platforms yet, show loading state
  if (activePlatforms.length === 0 && isCheckingStatus) {
    return (
      <Card className="mb-6 w-full border-blue-500/30 bg-blue-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center text-xl font-bold text-blue-400">
            <Loader2 className="h-5 w-5 mr-2 text-blue-400 animate-spin" />
            Checking Platforms
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400">
            We're checking your connected messaging platforms. This should only take a moment...
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-6 w-[100%]">
        <CardHeader className="pb-3">
          <div className="flex justify-between items-center">
            <CardTitle className="text-xl font-bold">Active Platforms</CardTitle>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={refreshAllPlatforms}
              disabled={isRefreshing || isOffline || isServerDown}
              className="h-8 w-8"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh platform status</span>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {activePlatforms.map(platform => (
              <div key={platform} className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  {getPlatformIcon(platform)}
                  <span className="text-base font-medium capitalize">{platform}</span>
                  {(isCheckingStatus || verifyingPlatform === platform || (isRefreshing && verifyingPlatform === null)) && (
                    <span className="text-xs text-blue-400">(Verifying connection...)</span>
                  )}
                </div>
                <Button 
                  onClick={() => checkPlatformStatus(platform)}
                  size="sm"
                  className="bg-primary hover:bg-primary/90"
                  disabled={isCheckingStatus || verifyingPlatform !== null || isServerDown || isRefreshing}
                >
                  {verifyingPlatform === platform ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    'Start Sync'
                  )}
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Platform Disconnected Alert Dialog */}
      <AlertDialog open={showDisconnectedDialog} onOpenChange={setShowDisconnectedDialog}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader className="space-y-2">
            <AlertDialogTitle className="flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-yellow-500" />
              Platform Disconnected
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Your {disconnectedPlatform} connection appears to be inactive. You'll need to reconnect to continue using this platform.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex justify-end gap-2">
            <AlertDialogCancel className="bg-secondary" onClick={() => setShowDisconnectedDialog(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              className="bg-primary text-white"
              onClick={() => {
                setShowDisconnectedDialog(false);
                // Dispatch an event to open settings
                window.dispatchEvent(new Event('open-settings'));
              }}
            >
              Go to Settings
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Status Error Alert Dialog */}
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader className="space-y-2">
            <AlertDialogTitle className="flex items-center">
              <AlertTriangle className="h-5 w-5 mr-2 text-red-500" />
              Connection Error
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              We're currently unable to verify your platform connection status. Please try again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex justify-end">
            <AlertDialogAction 
              className="bg-primary text-white"
              onClick={() => setShowErrorDialog(false)}
            >
              Dismiss
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default PlatformsInfo;
