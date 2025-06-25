import React, { Suspense, useCallback } from "react";
import { useInboxNotifications, useMarkInboxNotificationAsRead } from "@liveblocks/react/suspense";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, AtSign, UserPlus, Users, Check, CheckCheck, Send } from "lucide-react";
import { format } from "date-fns";

// Custom notification renderer for Telegram messages
const TelegramMessageNotification = ({ notification, onNotificationClick }: any) => {
  // The core of the fix: activityData is nested inside the 'activities' array
  const activityData = notification?.activities?.[0]?.data;
  const { kind, readAt } = notification;

  // 🔥 DEBUG: Log the exact notification structure being processed
  console.log('🐛 [FRONTEND DEBUG] Processing Telegram notification:', {
    id: notification?.id,
    kind,
    activityData: activityData,
  });

  // Defensive programming for the extracted data
  if (!activityData) {
    console.warn("🚨 [FRONTEND] Telegram notification has no activity data, skipping render.", notification);
    return null;
  }

  // Ensure activityData exists with fallback
  const safeActivityData = activityData || {};
  
  const getIcon = () => {
    switch (kind) {
      case '$telegramMessage':
        return <Send className="h-4 w-4 text-blue-600" />;
      case '$telegramMention':
        return <AtSign className="h-4 w-4 text-blue-600" />;
      case '$telegramNewContact':
        return <UserPlus className="h-4 w-4 text-purple-600" />;
      case '$telegramGroupInvite':
        return <Users className="h-4 w-4 text-orange-600" />;
      default:
        return <Send className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTitle = () => {
    // Use the new `contact_display_name` field from the backend, with a fallback
    const sender = safeActivityData.contact_display_name || safeActivityData.sender || 'Unknown sender';
    const contactName = safeActivityData.contactName || 'Unknown contact';
    
    switch (kind) {
      case '$telegramMessage':
        return `New message from ${sender}`;
      case '$telegramMention':
        return `You were mentioned by ${sender}`;
      case '$telegramNewContact':
        return `New contact: ${contactName}`;
      case '$telegramGroupInvite':
        return `Group invite from ${safeActivityData.inviter || 'Unknown'}`;
      default:
        return 'New notification';
    }
  };

  const getMessage = () => {
    const message = safeActivityData.message || 'No message content';
    const contactName = safeActivityData.contactName || 'Unknown contact';
    const groupName = safeActivityData.room || 'Unknown group';
    
    switch (kind) {
      case '$telegramMessage':
      case '$telegramMention':
        return message;
      case '$telegramNewContact':
        return `${contactName} has been added to your contacts`;
      case '$telegramGroupInvite':
        return `You've been invited to join ${groupName}`;
      default:
        return 'You have a new notification';
    }
  };

  const getTimestamp = () => {
    if (safeActivityData.timestamp) {
      try {
        // Handle both timestamp formats (number and string)
        const date = typeof safeActivityData.timestamp === 'number' 
          ? new Date(safeActivityData.timestamp) 
          : new Date(safeActivityData.timestamp);
        return format(date, 'MMM d, h:mm a');
      } catch (error) {
        console.warn("Invalid timestamp format:", safeActivityData.timestamp);
        return 'Just now';
      }
    }
    return 'Just now';
  };

  // 🎯 SUCCESS: This is a valid Telegram message notification
  console.log('✅ [FRONTEND] Rendering valid Telegram notification:', {
    kind,
    sender: safeActivityData.sender,
    contact_display_name: safeActivityData.contact_display_name,
    message: safeActivityData.message,
  });

  return (
    <div
      className={`flex items-start space-x-3 p-3 rounded-lg transition-colors cursor-pointer hover:bg-primary/10 ${
        readAt ? 'bg-card opacity-75' : 'bg-accent'
      }`}
      onClick={() => onNotificationClick(notification)}
    >
      <div className="flex-shrink-0 mt-1">
        {getIcon()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground truncate">
            {getTitle()}
          </p>
          <div className="flex items-center space-x-1">
            {readAt ? (
              <CheckCheck className="h-3 w-3 text-muted-foreground" />
            ) : (
              <Check className="h-3 w-3 text-blue-500" />
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
          {getMessage()}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {getTimestamp()}
        </p>
      </div>
    </div>
  );
};

// Notifications Content Component (needs Suspense)
function TelegramNotificationsContent() {
  const { inboxNotifications } = useInboxNotifications();
  const markInboxNotificationAsRead = useMarkInboxNotificationAsRead();

  const handleNotificationClick = useCallback((notification: any) => {
    if (!notification.readAt) {
      markInboxNotificationAsRead(notification.id);
    }

    if (notification.subjectId) {
      // Dispatch a custom event to be handled by MainLayout
      window.dispatchEvent(new CustomEvent('navigate-to-chat', {
        detail: {
          platform: 'telegram',
          contactId: notification.subjectId,
        }
      }));

      // Also, dispatch an event to close the popover
      window.dispatchEvent(new CustomEvent('close-notification-popover'));
      
      console.log(`[Notifications] Dispatched navigate-to-chat for Telegram contact: ${notification.subjectId}`);
    } else {
      console.warn('[Notifications] Clicked Telegram notification is missing a subjectId', notification);
    }
  }, [markInboxNotificationAsRead]);

  // Filter out invalid notifications before rendering
  const validNotifications = (inboxNotifications || []).filter((notification) => {
    if (!notification || !notification.id) {
      console.warn("🚨 [FRONTEND] Skipping Telegram notification without ID:", notification);
      return false;
    }
    
    // Only show Telegram messages for now until other types are properly implemented
    if (notification.kind !== '$telegramMessage') {
      console.log(`🚨 [FRONTEND] Filtering out non-message Telegram notification: ${notification.kind}`);
      return false;
    }
    
    // The core of the fix: activityData is nested inside the 'activities' array
    const activityData = notification?.activities?.[0]?.data;

    // Ensure Telegram messages have required data
    if (notification.kind === '$telegramMessage') {
      // Use the new `contact_display_name` field for validation
      const hasValidData = activityData && 
                          (activityData.contact_display_name || activityData.sender) && 
                          activityData.message;
      if (!hasValidData) {
        console.warn("🚨 [FRONTEND] Filtering out Telegram message with missing data:", { 
          id: notification.id, 
          kind: notification.kind,
          activityData: activityData 
        });
        return false;
      }

      // Filter out bridge bot notifications
      const displayName = (activityData.contact_display_name || activityData.sender || '').toLowerCase();
      if (displayName.includes('bridge bot') || 
          displayName.includes('telegram bridge') ||
          displayName.includes('whatsapp bridge')) {
        console.log(`🚨 [FRONTEND] Filtering out bridge bot notification from: ${displayName}`);
        return false;
      }
    }
    
    return true;
  });
  
  console.log(`🎯 [FRONTEND] Showing ${validNotifications.length} valid Telegram notifications out of ${inboxNotifications.length} total`);
  
  if (validNotifications.length === 0) {
    return (
      <div className="p-8 text-center">
        <Send className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">No notifications yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          You'll see Telegram messages here when they arrive
        </p>
        {inboxNotifications.length > 0 && (
          <p className="text-xs text-orange-600 mt-2">
            ({inboxNotifications.length} notifications filtered out - check console for details)
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {validNotifications.map((notification) => (
        <TelegramMessageNotification
          key={notification.id}
          notification={notification}
          onNotificationClick={handleNotificationClick}
        />
      ))}
    </div>
  );
}

// Main Telegram Notifications Component (with Suspense wrapper)
export function TelegramNotifications() {
  return (
    <Suspense 
      fallback={
        <div className="p-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-start space-x-3 p-3 rounded-lg bg-muted animate-pulse">
              <div className="h-4 w-4 bg-muted-foreground/20 rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-muted-foreground/20 rounded w-3/4" />
                <div className="h-3 bg-muted-foreground/20 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      }
    >
      <TelegramNotificationsContent />
    </Suspense>
  );
} 