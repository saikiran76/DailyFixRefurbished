import React, { Suspense } from "react";
import { useInboxNotifications } from "@liveblocks/react/suspense";
import { Badge } from "@/components/ui/badge";

interface NotificationBadgeProps {
  platform?: 'whatsapp' | 'telegram';
}

// Notification Badge Content Component (needs Suspense)
function NotificationBadgeContent({ platform = 'whatsapp' }: NotificationBadgeProps) {
  const { inboxNotifications } = useInboxNotifications();
  
  // Filter notifications by platform and count unread ones
  const unreadCount = inboxNotifications?.filter(notification => {
    if (notification.readAt) return false; // Already read
    
    // Check platform-specific notification types
    let isPlatformMatch = false;
    switch (platform) {
      case 'telegram':
        isPlatformMatch = notification.kind.startsWith('$telegram');
        break;
      case 'whatsapp':
      default:
        isPlatformMatch = notification.kind.startsWith('$whatsapp');
        break;
    }
    
    if (!isPlatformMatch) return false;

    // Filter out bridge bot notifications
    const activityData = notification?.activities?.[0]?.data;
    if (activityData) {
      const displayName = (activityData.contact_display_name || activityData.sender || '').toLowerCase();
      if (displayName.includes('bridge bot') || 
          displayName.includes('telegram bridge') ||
          displayName.includes('whatsapp bridge')) {
        return false; // Exclude bridge bot notifications from badge count
      }
    }
    
    return true;
  }).length || 0;
  
  if (unreadCount === 0) {
    return null;
  }
  
  return (
    <Badge 
      variant="destructive" 
      className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs font-bold rounded-full"
    >
      {unreadCount > 99 ? '99+' : unreadCount}
    </Badge>
  );
}

// Main Notification Badge Component (with Suspense wrapper)
export function NotificationBadge({ platform = 'whatsapp' }: NotificationBadgeProps) {
  return (
    <Suspense fallback={null}>
      <NotificationBadgeContent platform={platform} />
    </Suspense>
  );
}

export default NotificationBadge; 