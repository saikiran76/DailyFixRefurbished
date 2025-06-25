import React, { Suspense, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell } from "lucide-react";
import { NotificationBadge } from "./NotificationBadge";
import { WhatsAppNotifications } from "./WhatsAppNotifications";
import { TelegramNotifications } from "./TelegramNotifications";

interface NotificationPopoverProps {
  platform?: 'whatsapp' | 'telegram';
}

export function NotificationPopover({ platform = 'whatsapp' }: NotificationPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleClose = () => setIsOpen(false);
    window.addEventListener('close-notification-popover', handleClose);
    return () => {
      window.removeEventListener('close-notification-popover', handleClose);
    };
  }, []);

  const renderNotifications = () => {
    switch (platform) {
      case 'telegram':
        return <TelegramNotifications />;
      case 'whatsapp':
      default:
        return <WhatsAppNotifications />;
    }
  };

  const getTitle = () => {
    switch (platform) {
      case 'telegram':
        return 'Telegram Notifications';
      case 'whatsapp':
      default:
        return 'WhatsApp Notifications';
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      {/* Trigger Button */}
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative text-header-foreground hover:bg-accent"
        >
          <Bell className="h-5 w-5" />
          <NotificationBadge platform={platform} />
          <span className="sr-only">Notifications</span>
        </Button>
      </PopoverTrigger>
      
      {/* Popover Content */}
      <PopoverContent 
        className="w-80 p-0 bg-popover border-border shadow-lg"
        align="end"
        sideOffset={8}
      >
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-popover-foreground">{getTitle()}</h3>
        </div>
        
        <div className="max-h-96 overflow-y-auto">
          <Suspense 
            fallback={
              <div className="p-4 text-center text-muted-foreground">
                Loading notifications...
              </div>
            }
          >
            {renderNotifications()}
          </Suspense>
        </div>
      </PopoverContent>
    </Popover>
  );
} 