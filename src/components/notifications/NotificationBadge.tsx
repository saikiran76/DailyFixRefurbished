import React from "react";
import { useInboxNotifications } from "@liveblocks/react";

interface NotificationBadgeProps {
  platform?: 'whatsapp' | 'telegram';
}

export function NotificationBadge({ platform = 'whatsapp' }: NotificationBadgeProps) {
  const { inboxNotifications } = useInboxNotifications();

  const getFilteredCount = () => {
    if (!inboxNotifications) return 0;

    const platformPrefix = platform === 'telegram' ? '$telegram' : '$whatsapp';
    
    return inboxNotifications.filter((notification) => {
      // Filter by platform
      if (!notification.kind.startsWith(platformPrefix)) return false;
      
      // Only count unread notifications
      if (notification.readAt) return false;

      // Filter out bridge bot notifications
      const activityData = (notification as any)?.activities?.[0]?.data;
      if (activityData) {
        const displayName = String(activityData.contact_display_name || activityData.sender || '').toLowerCase();
        if (displayName.includes('bridge bot') || 
            displayName.includes('telegram bridge') ||
            displayName.includes('whatsapp bridge')) {
          return false; // Exclude bridge bot notifications from badge count
        }
      }
      
      return true;
    }).length || 0;
  };

  const count = getFilteredCount();

  if (count === 0) return null;

  return (
    <span className={`absolute -top-1 -right-1 h-5 w-5 rounded-full text-xs font-medium flex items-center justify-center text-white ${
      platform === 'telegram' ? 'bg-blue-500' : 'bg-green-500'
    }`}>
      {count > 99 ? '99+' : count}
    </span>
  );
} 