import * as React from "react"
import { useState, useEffect } from "react"
import { Command, MessageCircle, Settings, CheckCircle, Plus, Wifi, WifiOff, Inbox, RefreshCw, HelpCircle } from "lucide-react"
import { FaWhatsapp, FaTelegram } from "react-icons/fa";
import { Button } from "@/components/ui/button";

import { NavUser } from "@/components/ui/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { isWhatsAppConnected, isTelegramConnected } from '@/utils/connectionStorage';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Help } from "@/components/ui/modals/help";

// Define interface for the AppSidebar props
interface AppSidebarProps {
  onWhatsAppSelected?: () => void;
  onTelegramSelected?: () => void;
  onSettingsSelected?: () => void;
  onPlatformConnect?: (platformId: string) => void; // New prop for connecting platforms
  onPlatformSelect?: (platformId: string) => void; // New prop for selecting platforms
  [key: string]: any;
}

// Interface for platform item
interface PlatformItem {
  id: string;
  title: string;
  icon: React.ElementType;
  color: string;
  onClick?: () => void;
  isActive: boolean;
  isConnected: boolean; // Add connection status
}

// Platform Switcher Component - Uses Popover for proper positioning
const PlatformSwitcher = ({ 
  platforms, 
  activePlatform, 
  onPlatformChange,
  onPlatformConnect
}: { 
  platforms: PlatformItem[]; 
  activePlatform: string | null;
  onPlatformChange: (platformId: string) => void;
  onPlatformConnect?: (platformId: string) => void;
}) => {
  const isMobile = useIsMobile();
  
  // Show all platforms, but separate connected from available
  const connectedPlatforms = platforms.filter(platform => platform.isConnected);
  const availablePlatforms = platforms.filter(platform => !platform.isConnected);
  
  // Get the active platform details (only from connected platforms)
  const currentPlatform = connectedPlatforms.find(p => p.id === activePlatform) || connectedPlatforms[0];
  
  // State for refreshing platforms
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  
  // Function to refresh platform connection status
  const refreshPlatformStatus = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering parent click handlers
    
    if (isRefreshing) return;
    
    setIsRefreshing(true);
    console.log('[AppSidebar] Refreshing platform connection statuses');
    
    // Create and dispatch event to trigger platform verification
    const refreshEvent = new CustomEvent('refresh-platform-status');
    window.dispatchEvent(refreshEvent);
    
    // Set a timeout to reset the refreshing state after a short delay
    setTimeout(() => setIsRefreshing(false), 2000);
  };
  
  // Determine what icon to show
  let IconComponent: React.ElementType = MessageCircle;
  let iconColor = "";
  let tooltipText = "Switch Platforms";
  
  if (connectedPlatforms.length === 0) {
    // No connected platforms - show Plus icon
    IconComponent = Plus;
    iconColor = "text-muted-foreground";
    tooltipText = "Connect Platform";
  } else if (currentPlatform) {
    // There's an active platform - show its icon
    IconComponent = currentPlatform.icon;
    iconColor = currentPlatform.color;
    tooltipText = `Switch from ${currentPlatform.title}`;
  } else {
    // There are connected platforms but no active one - show first connected platform
    const firstConnected = connectedPlatforms[0];
    IconComponent = firstConnected.icon;
    iconColor = firstConnected.color;
    tooltipText = "Switch Platforms";
  }

  // State for popover
  const [isOpen, setIsOpen] = React.useState(false);

  // Create handler functions that close the popover
  const handleConnectedPlatformClick = (platformId: string) => {
    console.log('[PlatformSwitcher] Switching to platform:', platformId);
    onPlatformChange(platformId);
    setIsOpen(false);
  };

  const handleConnectPlatformClick = (platformId: string) => {
    console.log('[PlatformSwitcher] Connecting to platform:', platformId);
    if (onPlatformConnect) {
      onPlatformConnect(platformId);
    }
    setIsOpen(false);
  };

  return (
    <TooltipProvider>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className={`flex items-center ${isMobile ? 'justify-start w-full gap-2' : 'justify-center'} h-8 ${isMobile ? 'w-full' : 'w-8'} p-2 rounded-md hover:bg-gray-300 hover:text-neutral-800 transition-colors relative ${
                  connectedPlatforms.length === 0 ? 'border-2 border-dashed border-muted-foreground/30' : ''
                }`}
              >
                <Inbox className="h-5 w-5 text-white" />
                {isMobile && <span className="text-sm text-white">Switch Platforms</span>}
                {currentPlatform && connectedPlatforms.length > 0 && (
                  <div className="absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full border-2 border-sidebar-background"></div>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent className="bg-white/50" side="right" sideOffset={8}>
            {tooltipText}
          </TooltipContent>
        </Tooltip>
        
        <PopoverContent 
          className="w-48 p-2 z-[9999] fixed bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg" 
          align="center" 
          side={isMobile ? "bottom" : "right"}
          sideOffset={20}
        >
          {/* Refresh Button - Always shown at the top */}
          <div className="flex justify-end mb-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={refreshPlatformStatus}
              disabled={isRefreshing}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="sr-only">Refresh connection status</span>
            </Button>
          </div>

          {/* No Connected Platforms */}
          {connectedPlatforms.length === 0 && (
            <>
              <div className="text-sm font-medium py-1.5 px-2">Available Platforms</div>
              <div className="h-px bg-muted my-1 -mx-1"></div>
              <div className="space-y-1">
                {availablePlatforms.map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <button
                      key={platform.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => handleConnectPlatformClick(platform.id)}
                    >
                      <Icon className={`h-4 w-4 ${platform.color}`} />
                      <span>{platform.title}</span>
                      <Plus className="ml-auto h-3 w-3 text-muted-foreground" />
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Connected Platforms */}
          {connectedPlatforms.length > 0 && (
            <>
              <div className="text-sm font-medium py-1.5 px-2 flex items-center gap-2">
                <Wifi className="h-3 w-3 text-green-500" />
                Connected Platforms
              </div>
              <div className="h-px bg-muted my-1 -mx-1"></div>
              <div className="space-y-1 mb-3">
                {connectedPlatforms.map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <button
                      key={platform.id}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground ${
                        activePlatform === platform.id ? 'bg-muted' : ''
                      }`}
                      onClick={() => handleConnectedPlatformClick(platform.id)}
                    >
                      <Icon className={`h-4 w-4 ${platform.color}`} />
                      <span>{platform.title}</span>
                      {activePlatform === platform.id && (
                        <CheckCircle className="ml-auto h-3 w-3 text-green-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          
          {/* Available Platforms (when there are already connected ones) */}
          {availablePlatforms.length > 0 && connectedPlatforms.length > 0 && (
            <>
              <div className="text-sm font-medium py-1.5 px-2 flex items-center gap-2">
                <WifiOff className="h-3 w-3 text-muted-foreground" />
                Available Platforms
              </div>
              <div className="h-px bg-muted my-1 -mx-1"></div>
              <div className="space-y-1">
                {availablePlatforms.map((platform) => {
                  const Icon = platform.icon;
                  return (
                    <button
                      key={platform.id}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-accent hover:text-accent-foreground"
                      onClick={() => handleConnectPlatformClick(platform.id)}
                    >
                      <Icon className={`h-4 w-4 ${platform.color}`} />
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

export function AppSidebar({
  onWhatsAppSelected,
  onTelegramSelected,
  onSettingsSelected,
  onPlatformConnect,
  onPlatformSelect,
  ...props
}: AppSidebarProps) {
  // Get user ID for connection checks
  const userId = React.useMemo(() => {
    try {
      const authData = localStorage.getItem('dailyfix_auth');
      if (authData) {
        const parsed = JSON.parse(authData);
        return parsed?.user?.id;
      }
    } catch (e) {
      console.error('Error getting user ID:', e);
    }
    return undefined;
  }, []);

  // State to force component updates when platform connection status changes
  const [connectionStatusChangeCounter, setConnectionStatusChangeCounter] = React.useState(0);

  // Add event listener for platform connection changes
  React.useEffect(() => {
    const handlePlatformConnectionChange = () => {
      // Increment counter to force re-render and update platform status
      setConnectionStatusChangeCounter(prev => prev + 1);
      console.log('[AppSidebar] Platform connection status changed, updating UI');
    };

    // Listen for platform connection change events
    window.addEventListener('platform-connection-changed', handlePlatformConnectionChange);

    // Clean up event listener
    return () => {
      window.removeEventListener('platform-connection-changed', handlePlatformConnectionChange);
    };
  }, []);

  // Check platform connection status - now using counter in dependency array to refresh on changes
  const whatsAppConnected = React.useMemo(
    () => userId ? isWhatsAppConnected(userId) : false, 
    [userId, connectionStatusChangeCounter]
  );
  
  const telegramConnected = React.useMemo(
    () => userId ? isTelegramConnected(userId) : false, 
    [userId, connectionStatusChangeCounter]
  );

  // Define ALL platform nav items (both connected and available)
  const platformItems = React.useMemo(() => [
    {
      id: "whatsapp",
      title: "WhatsApp",
      icon: FaWhatsapp,
      onClick: onWhatsAppSelected,
      isActive: whatsAppConnected,
      isConnected: whatsAppConnected,
      color: "text-green-500"
    },
    {
      id: "telegram",
      title: "Telegram",
      icon: FaTelegram,
      onClick: onTelegramSelected,
      isActive: telegramConnected,
      isConnected: telegramConnected,
      color: "text-blue-500"
    }
  ], [onWhatsAppSelected, onTelegramSelected, whatsAppConnected, telegramConnected]);

  // State for active platform (only allow connected platforms to be active)
  // Update active platform when connection status changes
  const [activePlatform, setActivePlatform] = React.useState<string | null>(
    whatsAppConnected ? "whatsapp" : (telegramConnected ? "telegram" : null)
  );

  // Update active platform when connection status changes
  React.useEffect(() => {
    // If current active platform is no longer connected, switch to another one or null
    if (activePlatform && !platformItems.find(p => p.id === activePlatform && p.isConnected)) {
      const nextConnectedPlatform = platformItems.find(p => p.isConnected);
      setActivePlatform(nextConnectedPlatform ? nextConnectedPlatform.id : null);
      console.log('[AppSidebar] Active platform disconnected, switching to:', nextConnectedPlatform?.id || 'none');
    }
  }, [platformItems, activePlatform]);

  // Enhanced platform change handler that calls the correct callback
  const handlePlatformChange = (platformId: string) => {
    console.log('[AppSidebar] Platform changed to:', platformId);
    setActivePlatform(platformId);
    
    // Call the platform-specific callback if available
    if (platformId === 'whatsapp' && onWhatsAppSelected) {
      onWhatsAppSelected();
    } else if (platformId === 'telegram' && onTelegramSelected) {
      onTelegramSelected();
    }
    
    // Call the generic onPlatformSelect callback if available
    if (onPlatformSelect) {
      onPlatformSelect(platformId);
    }
  };

  // State for help dialog
  const [helpOpen, setHelpOpen] = useState(false);
  const isMobile = useIsMobile();

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden [&>[data-sidebar=sidebar]]:flex-row"
      {...props}>
      {/* This is the first sidebar */}
      {/* We disable collapsible and adjust width to icon. */}
      {/* This will make the sidebar appear as icons. */}
      <Sidebar
        collapsible="none"
        className={`${isMobile ? '!w-auto max-w-[240px]' : '!w-[calc(var(--sidebar-width-icon)_+_1px)]'} border-r`}>
        <SidebarHeader className="px-2 py-3">
          <div className={`flex ${isMobile ? 'w-full justify-start gap-2' : 'aspect-square size-8 justify-center'} items-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground ${isMobile ? '' : 'mx-auto'}`}>
            <Command className="size-4" />
            {isMobile && <span className="text-sm font-medium">DailyFix</span>}
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2">
          {/* Platform Switcher Component */}
          <SidebarGroup className="px-0 mb-4">
            <PlatformSwitcher 
              platforms={platformItems}
              activePlatform={activePlatform}
              onPlatformChange={handlePlatformChange}
              onPlatformConnect={onPlatformConnect}
            />
          </SidebarGroup>

          {/* Settings */}
          <SidebarGroup className="px-0 mt-4">
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    className={`flex items-center ${isMobile ? 'justify-start w-full gap-2' : 'justify-center'} h-8 ${isMobile ? 'w-full' : 'w-8'} p-2 border-2 border-gray-300 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors ${isMobile ? '' : 'mx-auto'}`}
                      onClick={() => {
                      console.log('[AppSidebar] Settings clicked');
                      if (onSettingsSelected) onSettingsSelected();
                    }}
                  >
                    <Settings className="h-5 w-5" />
                    {isMobile && <span className="text-sm">Settings</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="bg-white/60" side="right" sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-2 pb-4">
          {/* Help Button */}
          <SidebarGroup className="px-0 mb-4">
            <Dialog className="bg-neutral-700" open={helpOpen} onOpenChange={setHelpOpen}>
              <DialogTrigger asChild>
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        className={`flex items-center ${isMobile ? 'justify-start w-full gap-2' : 'justify-center'} text-blue-600 h-8 ${isMobile ? 'w-full' : 'w-8'} p-2 border-2 border-gray-300 rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors ${isMobile ? '' : 'mx-auto mb-4'}`}
                        onClick={() => setHelpOpen(true)}
                      >
                        <HelpCircle className="h-5 w-5" />
                        {isMobile && <span className="text-sm">Help</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-white/60" side="right" sideOffset={8}>
                      Help
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] bg-neutral-800'">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-xl font-semibold">Help Center</DialogTitle>
                </DialogHeader>
                <Help />
              </DialogContent>
            </Dialog>
          </SidebarGroup>
          
          {/* Using NavUser which now gets real user data from Redux */}
          <NavUser />
        </SidebarFooter>
      </Sidebar>
      {/* This is the second sidebar */}
      {/* We disable collapsible and let it fill remaining space */}
    </Sidebar>
  );
}
