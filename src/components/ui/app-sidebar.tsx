import * as React from "react"
import '@/index.css'
import { useState, useEffect } from "react"
import { Command, MessageCircle, Settings, CheckCircle, Plus, Wifi, WifiOff, Inbox, RefreshCw, HelpCircle } from "lucide-react"
import { FaWhatsapp, FaTelegram } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { PlatformSwitcher } from "@/components/platforms/PlatformSwitcher";
import ThemeToggle from "@/components/ui/ThemeToggle";

import { NavUser } from "@/components/ui/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { isWhatsAppConnected, isTelegramConnected, isInstagramConnected, isLinkedInConnected } from '@/utils/connectionStorage';
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

// This is sample data
interface PlatformItem {
  id: string;
  title: string;
  icon: React.ElementType;
  onClick: () => void;
  isActive: boolean;
  isConnected: boolean;
  color: string;
}

interface AppSidebarProps {
  onWhatsAppSelected?: () => void;
  onTelegramSelected?: () => void;
  onInstagramSelected?: () => void;
  onLinkedInSelected?: () => void;
  onSettingsSelected?: () => void;
  onPlatformConnect?: (platformId: string) => void;
  onPlatformSelect?: (platformId: string) => void;
}

export function AppSidebar({
  onWhatsAppSelected,
  onTelegramSelected,
  onInstagramSelected,
  onLinkedInSelected,
  onSettingsSelected,
  onPlatformConnect,
  onPlatformSelect,
  ...props
}: AppSidebarProps) {
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

  const [connectionStatusChangeCounter, setConnectionStatusChangeCounter] = React.useState(0);

  React.useEffect(() => {
    const handlePlatformConnectionChange = () => {
      setConnectionStatusChangeCounter(prev => prev + 1);
      console.log('[AppSidebar] Platform connection status changed, updating UI');
    };
    window.addEventListener('platform-connection-changed', handlePlatformConnectionChange);
    return () => {
      window.removeEventListener('platform-connection-changed', handlePlatformConnectionChange);
    };
  }, []);

  const whatsAppConnected = React.useMemo(
    () => userId ? isWhatsAppConnected(userId) : false,
    [userId, connectionStatusChangeCounter]
  );

  const telegramConnected = React.useMemo(
    () => userId ? isTelegramConnected(userId) : false,
    [userId, connectionStatusChangeCounter]
  );

  const instagramConnected = React.useMemo(
    () => userId ? isInstagramConnected(userId) : false,
    [userId, connectionStatusChangeCounter]
  );

  const linkedInConnected = React.useMemo(
    () => userId ? isLinkedInConnected(userId) : false,
    [userId, connectionStatusChangeCounter]
  );

  const platformItems: PlatformItem[] = React.useMemo(() => [
    {
      id: "whatsapp",
      title: "WhatsApp",
      icon: FaWhatsapp,
      onClick: onWhatsAppSelected || (() => {}),
      isActive: whatsAppConnected,
      isConnected: whatsAppConnected,
      color: "text-green-500"
    },
    {
      id: "telegram",
      title: "Telegram",
      icon: FaTelegram,
      onClick: onTelegramSelected || (() => {}),
      isActive: telegramConnected,
      isConnected: telegramConnected,
      color: "text-blue-500"
    },
    {
      id: "instagram",
      title: "Instagram",
      icon: ({ className }: { className?: string }) => (
        <span className={`text-pink-500 font-bold ${className}`}>I</span>
      ),
      onClick: () => {
        if (onPlatformSelect) {
          onPlatformSelect('instagram');
        }
      },
      isActive: instagramConnected,
      isConnected: instagramConnected,
      color: "text-pink-500"
    },
    {
      id: "linkedin",
      title: "LinkedIn",
      icon: ({ className }: { className?: string }) => (
        <span className={`text-blue-500 font-bold ${className}`}>L</span>
      ),
      onClick: () => {
        if (onPlatformSelect) {
          onPlatformSelect('linkedin');
        }
      },
      isActive: linkedInConnected,
      isConnected: linkedInConnected,
      color: "text-blue-500"
    }
  ], [onWhatsAppSelected, onTelegramSelected, onPlatformSelect, whatsAppConnected, telegramConnected, instagramConnected, linkedInConnected]);

  const [activePlatform, setActivePlatform] = React.useState<string | null>(
    whatsAppConnected ? "whatsapp" : (telegramConnected ? "telegram" : (instagramConnected ? "instagram" : (linkedInConnected ? "linkedin" : null)))
  );

  React.useEffect(() => {
    if (activePlatform && !platformItems.find(p => p.id === activePlatform && p.isConnected)) {
      const nextConnectedPlatform = platformItems.find(p => p.isConnected);
      setActivePlatform(nextConnectedPlatform ? nextConnectedPlatform.id : null);
      console.log('[AppSidebar] Active platform disconnected, switching to:', nextConnectedPlatform?.id || 'none');
    }
  }, [platformItems, activePlatform]);

  const handlePlatformChange = (platformId: string) => {
    console.log('[AppSidebar] Platform changed to:', platformId);
    setActivePlatform(platformId);
    if (platformId === 'whatsapp' && onWhatsAppSelected) {
      onWhatsAppSelected();
    } else if (platformId === 'telegram' && onTelegramSelected) {
      onTelegramSelected();
    } else if (platformId === 'instagram' && onInstagramSelected) {
      onInstagramSelected();
    }
    if (onPlatformSelect) {
      onPlatformSelect(platformId);
    }
  };

  const [helpOpen, setHelpOpen] = useState(false);
  const isMobile = useIsMobile();

  // Updated consistent button styling class with theme-aware colors
  const buttonClass = `flex items-center ${isMobile ? 'justify-start w-full gap-2 px-3' : 'justify-center'} h-9 ${isMobile ? 'w-full' : 'w-9'} rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors ${isMobile ? '' : 'mx-auto'} text-sidebar-foreground`;

  return (
    <Sidebar
      collapsible="icon"
      className="overflow-hidden [&>[data-sidebar=sidebar]]:flex-row"
      {...props}
    >
      <Sidebar
        collapsible="none"
        className={`${isMobile ? '!w-auto max-w-[240px]' : '!w-[calc(var(--sidebar-width-icon)_+_2px)]'} border-r border-sidebar-border bg-sidebar`}
      >
        <SidebarHeader className="px-2 py-3">
          <div className={`flex ${isMobile ? 'w-full justify-start gap-2 px-1' : 'aspect-square size-9 justify-center'} items-center rounded-lg bg-primary text-primary-foreground ${isMobile ? '' : 'mx-auto'}`}>
            <Command className="size-4" />
            {isMobile && <span className="text-sm font-medium">DailyFix</span>}
          </div>
        </SidebarHeader>
        <SidebarContent className="px-2">
          <SidebarGroup className="px-0 mb-4">
            <PlatformSwitcher
              platforms={platformItems}
              activePlatform={activePlatform}
              onPlatformChange={handlePlatformChange}
              onPlatformConnect={onPlatformConnect}
            />
          </SidebarGroup>
          <SidebarGroup className="px-0 mt-4">
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <button
                    className={`${buttonClass} text-sm`}
                    onClick={() => {
                      console.log('[AppSidebar] Settings clicked');
                      if (onSettingsSelected) onSettingsSelected();
                    }}
                  >
                    🛞
                    {isMobile && <span className="text-sm">Settings</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent className="bg-popover border-border bg-red-400" side="right" sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="px-2 pb-4">
          <SidebarGroup className="px-0 mb-4">
            <Dialog className="bg-popover border-border" open={helpOpen} onOpenChange={setHelpOpen}>
              <DialogTrigger asChild>
                <TooltipProvider>
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <button
                        className={`${buttonClass} text-sm`}
                        onClick={() => setHelpOpen(true)}
                      >
                        🆘
                        {isMobile && <span className="text-sm">Help</span>}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="bg-popover bg-red-400 border-border" side="right"sideOffset={8}>
                      Help
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] bg-popover border-border">
                <DialogHeader className="mb-4">
                  <DialogTitle className="text-xl font-semibold text-popover-foreground">Help Center</DialogTitle>
                </DialogHeader>
                <Help />
              </DialogContent>
            </Dialog>
          </SidebarGroup>
          
          {/* Theme Toggle */}
          <SidebarGroup className="px-0 mb-4">
            <ThemeToggle /> 
          </SidebarGroup>
          
          <NavUser />
        </SidebarFooter>
      </Sidebar>
    </Sidebar>
  );
}
