import React from 'react';
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { MessageCircle, Plus, Wifi, WifiOff, RefreshCw, CheckCircle, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import '@/components/styles/glowing-platform-icons.css';
// import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import logger from '@/utils/logger';
import platformManager from '@/services/PlatformManager';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";

interface PlatformItem {
  id: string;
  title: string;
  icon: React.ElementType;
  isConnected: boolean;
  color: string;
}

interface PlatformSwitcherProps {
  platforms: PlatformItem[];
  activePlatform: string | null;
  onPlatformChange: (platformId: string) => void;
  onPlatformConnect?: (platformId: string) => void;
}

interface SwitchingState {
  isActive: boolean;
  platform: string | null;
  stage: 'verifying' | 'switching' | 'refreshing' | 'completed' | 'failed';
  progress: number;
  message: string;
  startTime: number;
  timeoutId?: NodeJS.Timeout;
}

export const PlatformSwitcher = ({
  platforms,
  activePlatform,
  onPlatformChange,
  onPlatformConnect
}: PlatformSwitcherProps) => {
  const isMobile = useIsMobile();
  const connectedPlatforms = platforms.filter(platform => platform.isConnected);
  const availablePlatforms = platforms.filter(platform => !platform.isConnected);
  const currentPlatform = connectedPlatforms.find(p => p.id === activePlatform) || connectedPlatforms[0];

  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isOpen, setIsOpen] = React.useState(false);
  const [switchingState, setSwitchingState] = React.useState<SwitchingState>({
    isActive: false,
    platform: null,
    stage: 'verifying',
    progress: 0,
    message: '',
    startTime: 0
  });
  const [showContactRefreshPrompt, setShowContactRefreshPrompt] = React.useState(false);

  // Reset switching state when modal closes
  React.useEffect(() => {
    if (!isOpen && switchingState.isActive) {
      // Clear any timeout
      if (switchingState.timeoutId) {
        clearTimeout(switchingState.timeoutId);
      }
      setSwitchingState({
        isActive: false,
        platform: null,
        stage: 'verifying',
        progress: 0,
        message: '',
        startTime: 0
      });
    }
  }, [isOpen, switchingState.isActive, switchingState.timeoutId]);

  const updateSwitchingProgress = (
    stage: SwitchingState['stage'],
    progress: number,
    message: string
  ) => {
    setSwitchingState(prev => ({
      ...prev,
      stage,
      progress,
      message
    }));
  };

  const refreshPlatformStatus = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    logger.info('[PlatformSwitcher] Refreshing platform connection statuses with real-time API verification');
    
    try {
      // Use PlatformManager's new real-time API verification
      const activePlatforms = await platformManager.refreshAllPlatformStatuses();
      
      logger.info('[PlatformSwitcher] Platform status refresh completed:', activePlatforms);
      
      // Show success toast
      if (activePlatforms.length > 0) {
        toast.success(`Refreshed: ${activePlatforms.join(', ')} connected`);
      } else {
        toast.info('No platforms are currently connected');
      }
    } catch (error) {
      logger.error('[PlatformSwitcher] Error refreshing platform statuses:', error);
      toast.error('Failed to refresh platform status');
      
      // Fallback to the old event-based refresh
    const refreshEvent = new CustomEvent('refresh-platform-status');
    window.dispatchEvent(refreshEvent);
    } finally {
    setTimeout(() => setIsRefreshing(false), 2000);
    }
  };

  let IconComponent: React.ElementType = MessageCircle;
  let iconColor = "text-gray-200";
  let tooltipText = "Switch Platforms";

  if (connectedPlatforms.length === 0) {
    IconComponent = Plus;
    iconColor = "text-muted-foreground";
    tooltipText = "Connect Platform";
  } else if (currentPlatform) {
    IconComponent = currentPlatform.icon;
    iconColor = currentPlatform.color;
    tooltipText = `Switch from ${currentPlatform.title}`;
  } else {
    const firstConnected = connectedPlatforms[0];
    IconComponent = firstConnected.icon;
    iconColor = firstConnected.color;
    tooltipText = "Switch Platforms";
  }

  const handleConnectedPlatformClick = async (platformId: string) => {
    logger.info('[PlatformSwitcher] Switching to platform:', platformId);
    
    // Only perform platform switch actions if we're actually switching platforms (not clicking the same one)
    if (platformId !== activePlatform) {
      try {
        // Initialize switching state
        const startTime = Date.now();
        setSwitchingState({
          isActive: true,
          platform: platformId,
          stage: 'verifying',
          progress: 10,
          message: `Verifying ${platformId.charAt(0).toUpperCase() + platformId.slice(1)} connection...`,
          startTime
        });

        // Set up timeout handler (35 seconds as mentioned in logs)
        const timeoutId = setTimeout(() => {
          logger.warn(`[PlatformSwitcher] Platform switch to ${platformId} timed out after 35 seconds`);
          updateSwitchingProgress('failed', 100, 'Connection verification timed out. Using cached status...');
          
          // Fall back to localStorage and complete the switch
          setTimeout(() => {
            try {
              localStorage.setItem('dailyfix_active_platform', platformId);
              logger.info(`[PlatformSwitcher] Set ${platformId} as active platform in localStorage (fallback)`);
              
              // Dispatch platform change event
              window.dispatchEvent(new CustomEvent('platform-connection-changed', {
                detail: {
                  platform: platformId,
                  isActive: true,
                  timestamp: Date.now(),
                  source: 'platform-switch-timeout-fallback'
                }
              }));
              
              updateSwitchingProgress('completed', 100, 'Switched using cached status');
              toast.warning(`Switched to ${platformId.charAt(0).toUpperCase() + platformId.slice(1)} (using cached status)`);
              
              // Show contact refresh prompt
              setShowContactRefreshPrompt(true);
              
              // Auto-close after showing prompt
              setTimeout(() => {
                setSwitchingState(prev => ({ ...prev, isActive: false }));
                onPlatformChange(platformId);
              }, 2000);
              
            } catch (error) {
              logger.error('[PlatformSwitcher] Error in timeout fallback:', error);
              updateSwitchingProgress('failed', 100, 'Switch failed');
              toast.error(`Failed to switch to ${platformId.charAt(0).toUpperCase() + platformId.slice(1)}`);
              setTimeout(() => setSwitchingState(prev => ({ ...prev, isActive: false })), 2000);
            }
          }, 1500);
        }, 55000); // 55 second timeout

        // Update switching state with timeout ID
        setSwitchingState(prev => ({ ...prev, timeoutId }));

        // Step 1: Verify platform connection via API
        updateSwitchingProgress('verifying', 25, `Checking ${platformId} API status...`);
        
        const isConnected = await platformManager.verifyPlatformConnectionRealtime(platformId);
        
        // Clear timeout if API call completed
        clearTimeout(timeoutId);
        
        if (!isConnected) {
          updateSwitchingProgress('failed', 100, `${platformId.charAt(0).toUpperCase() + platformId.slice(1)} is not connected`);
          toast.error(`${platformId.charAt(0).toUpperCase() + platformId.slice(1)} is not connected. Please check your connection.`);
          logger.error(`[PlatformSwitcher] Cannot switch to ${platformId} - API verification failed`);
          
          setTimeout(() => {
            setSwitchingState(prev => ({ ...prev, isActive: false }));
          }, 2000);
          return;
        }

        // Step 2: Update localStorage
        updateSwitchingProgress('switching', 50, 'Updating platform settings...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay for UX

      localStorage.setItem('dailyfix_active_platform', platformId);
      logger.info(`[PlatformSwitcher] Set ${platformId} as active platform in localStorage`);
        
        // Step 3: Dispatch events and refresh contacts
        updateSwitchingProgress('refreshing', 75, 'Refreshing contact list...');
        await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay for UX
      
      // Use setTimeout to ensure this runs after all synchronous code,
      // preventing potential initialization order issues
      setTimeout(() => {
        try {
          // Trigger proper contact refresh based on the platform
          const userId = JSON.parse(localStorage.getItem('dailyfix_auth') || '{}')?.user?.id;
          if (userId) {
              // Dispatch a verified platform change event
              window.dispatchEvent(new CustomEvent('platform-connection-changed', {
                detail: {
                  platform: platformId,
                  isActive: true,
                  timestamp: Date.now(),
                  source: 'platform-switch'
                }
              }));
              
            logger.info(`[PlatformSwitcher] Auto-refreshed contacts after switching to ${platformId}`);
          }
        } catch (error) {
          logger.error('[PlatformSwitcher] Error during platform switch event dispatching:', error);
        }
      }, 0);
      
        // Step 4: Complete the switch
        updateSwitchingProgress('completed', 100, `Successfully switched to ${platformId.charAt(0).toUpperCase() + platformId.slice(1)}`);
        
        // Show success toast
        toast.success(`Switched to ${platformId.charAt(0).toUpperCase() + platformId.slice(1)}`);
        
        // Show contact refresh prompt
        setShowContactRefreshPrompt(true);
        
        logger.info(`[PlatformSwitcher] Successfully switched to ${platformId}`);
        
        // Auto-close after 2 seconds
        setTimeout(() => {
          setSwitchingState(prev => ({ ...prev, isActive: false }));
          onPlatformChange(platformId);
        }, 2000);
        
      } catch (error) {
        // Clear timeout on error
        if (switchingState.timeoutId) {
          clearTimeout(switchingState.timeoutId);
        }
        
        logger.error(`[PlatformSwitcher] Error during platform switch to ${platformId}:`, error);
        updateSwitchingProgress('failed', 100, 'Switch failed');
        toast.error(`Failed to switch to ${platformId.charAt(0).toUpperCase() + platformId.slice(1)}`);
        
        setTimeout(() => {
          setSwitchingState(prev => ({ ...prev, isActive: false }));
        }, 2000);
      }
    } else {
      // Same platform clicked, just close
    onPlatformChange(platformId);
    setIsOpen(false);
    }
  };

  const handleConnectPlatformClick = (platformId: string) => {
    logger.info('[PlatformSwitcher] Connecting to platform:', platformId);
    if (onPlatformConnect) {
      onPlatformConnect(platformId);
    }
    setIsOpen(false);
  };

  const handleRefreshContacts = () => {
    setShowContactRefreshPrompt(false);
    
    // Dispatch contact refresh event
    window.dispatchEvent(new CustomEvent('force-refresh-contacts', {
      detail: {
        platform: switchingState.platform,
        timestamp: Date.now()
      }
    }));
    
    toast.success('Refreshing contacts...');
    setIsOpen(false);
  };

  const buttonClass = `flex items-center ${isMobile ? 'justify-start w-full gap-2' : 'justify-center'} h-8 ${isMobile ? 'w-full' : 'w-8'} p-2 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors relative ${connectedPlatforms.length === 0 ? 'border-2 border-dashed border-muted-foreground/30' : ''}`;

  // Determine platform-specific glow classes
  const getGlowClasses = (platformId: string) => {
    if (platformId === 'telegram') {
      return 'platform-icon-glow-base telegram-icon-glow';
    }
    if (platformId === 'whatsapp') {
      return 'platform-icon-glow-base whatsapp-icon-glow';
    }
    return '';
  };

  // Determine active indicator classes
  const getActiveIndicatorClasses = (platformId: string) => {
    if (platformId === 'telegram') {
      return 'platform-active-indicator telegram-active-indicator';
    }
    if (platformId === 'whatsapp') {
      return 'platform-active-indicator whatsapp-active-indicator';
    }
    return '';
  };

  // Show loading indicator if switching
  if (switchingState.isActive) {
    IconComponent = Loader2;
    iconColor = "text-blue-500 animate-spin";
    tooltipText = switchingState.message;
  }

  return (
    <TooltipProvider>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button className={buttonClass} disabled={switchingState.isActive}>
                <span className={currentPlatform && !switchingState.isActive ? getGlowClasses(currentPlatform.id) : ''}>
                  <IconComponent className={`h-5 w-5 ${iconColor}`} />
                </span>
                {isMobile && <span className="text-sm text-gray-200">{tooltipText}</span>}
                {currentPlatform && connectedPlatforms.length > 0 && !switchingState.isActive && (
                  <div className={`absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full border-2 border-sidebar-background ${getActiveIndicatorClasses(currentPlatform.id)}`} />
                )}
                {switchingState.isActive && (
                  <div className="absolute -top-1 -right-1 h-3 w-3 bg-blue-500 rounded-full border-2 border-sidebar-background animate-pulse" />
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="bg-white/50" side="right" sideOffset={8}>
            {tooltipText}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          className="w-80 p-4 z-[9999] fixed bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg"
          align="center"
          side={isMobile ? "bottom" : "right"}
          sideOffset={20}
        >
          {/* Platform Switching Progress */}
          {switchingState.isActive && (
            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border">
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                <span className="text-sm font-medium">Switching Platform</span>
                <Clock className="h-3 w-3 text-muted-foreground ml-auto" />
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{switchingState.message}</span>
                  <span>{switchingState.progress}%</span>
                </div>
                <Progress value={switchingState.progress} className="h-2" />
              </div>
              
              {switchingState.stage === 'verifying' && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <div className="w-1 h-1 bg-blue-500 rounded-full animate-pulse"></div>
                    API verification in progress...
                  </div>
                </div>
              )}
              
              {switchingState.stage === 'failed' && (
                <div className="mt-2 text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Falling back to cached status
                </div>
              )}
            </div>
          )}

          {/* Contact Refresh Prompt */}
          {showContactRefreshPrompt && !switchingState.isActive && (
            <Alert className="mb-4 border-orange-200 bg-orange-50 dark:bg-orange-950/20">
              <RefreshCw className="h-4 w-4" />
              <AlertDescription className="text-sm">
                Platform switched successfully! Would you like to refresh your contact list to ensure it's up to date?
                <div className="flex gap-2 mt-2">
                  <Button size="sm" onClick={handleRefreshContacts} className="h-7">
                    <RefreshCw className="h-3 w-3 mr-1" />
                    Refresh Contacts
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowContactRefreshPrompt(false)} className="h-7">
                    Later
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-between items-center mb-3">
            <span className="text-xs text-muted-foreground">Platform Status</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={refreshPlatformStatus}
              disabled={isRefreshing || switchingState.isActive}
              title="Refresh platform connection status via API"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh connection status</span>
            </Button>
          </div>

          {/* Rest of the popover content remains the same but with disabled states during switching */}
          {connectedPlatforms.length === 0 && (
            <>
              <div className="text-sm font-medium py-1.5 px-2">Available Platforms</div>
              <div className="h-px bg-muted my-1 -mx-1" />
              <div className="space-y-1">
                {availablePlatforms.map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <button
                      key={platform.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleConnectPlatformClick(platform.id)}
                      disabled={switchingState.isActive}
                    >
                      <span className={getGlowClasses(platform.id)}>
                        <Icon className={`h-4 w-4 ${platform.color}`} />
                      </span>
                      <span>{platform.title}</span>
                      <Plus className="ml-auto h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {connectedPlatforms.length > 0 && (
            <>
              <div className="text-sm font-medium py-1.5 px-2 flex items-center gap-2">
                <Wifi className="h-3 w-3 text-green-500" />
                Connected Platforms
              </div>
              <div className="h-px bg-muted my-1 -mx-1" />
              <div className="space-y-1 mb-3">
                {connectedPlatforms.map((platform) => {
                  const Icon = platform.icon;
                  const isCurrentlySwitching = switchingState.isActive && switchingState.platform === platform.id;
                  return (
                    <button
                      key={platform.id}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed ${activePlatform === platform.id ? 'bg-muted' : ''} ${isCurrentlySwitching ? 'bg-blue-50 dark:bg-blue-950/20' : ''}`}
                      onClick={() => handleConnectedPlatformClick(platform.id)}
                      disabled={switchingState.isActive}
                    >
                      <span className={getGlowClasses(platform.id)}>
                        {isCurrentlySwitching ? (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                        ) : (
                        <Icon className={`h-4 w-4 ${platform.color}`} />
                        )}
                      </span>
                      <span>{platform.title}</span>
                      {activePlatform === platform.id && !isCurrentlySwitching && (
                        <CheckCircle className="ml-auto h-3 w-3 text-green-500" />
                      )}
                      {isCurrentlySwitching && (
                        <div className="ml-auto text-xs text-blue-600">Switching...</div>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          {availablePlatforms.length > 0 && connectedPlatforms.length > 0 && (
            <>
              <div className="text-sm font-medium py-1.5 px-2 flex items-center gap-2">
                <WifiOff className="h-3 w-3 text-muted-foreground" />
                Available Platforms
              </div>
              <div className="h-px bg-muted my-1 -mx-1" />
              <div className="space-y-1">
                {availablePlatforms.map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <button
                      key={platform.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleConnectPlatformClick(platform.id)}
                      disabled={switchingState.isActive}
                    >
                      <span className={getGlowClasses(platform.id)}>
                        <Icon className={`h-4 w-4 ${platform.color}`} />
                      </span>
                      <span>{platform.title}</span>
                      <Plus className="ml-auto h-3 w-3" />
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
};