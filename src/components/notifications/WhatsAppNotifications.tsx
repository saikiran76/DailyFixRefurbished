import React, { Suspense } from "react";
import { useInboxNotifications } from "@liveblocks/react/suspense";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageSquare, AtSign, UserPlus, Users, Check, CheckCheck } from "lucide-react";
import { format } from "date-fns";

// Custom notification renderer for WhatsApp messages
const WhatsAppMessageNotification = ({ notification }: any) => {
  // The core of the fix: activityData is nested inside the 'activities' array
  const activityData = notification?.activities?.[0]?.data;
  const { kind, readAt } = notification;

  // 🔥 DEBUG: Log the exact notification structure being processed
  console.log('🐛 [FRONTEND DEBUG] Processing notification:', {
    id: notification?.id,
    kind,
    activityData: activityData,
  });

  // Defensive programming for the extracted data
  if (!activityData) {
    console.warn("🚨 [FRONTEND] Notification has no activity data, skipping render.", notification);
    return null;
  }

  // Ensure activityData exists with fallback
  const safeActivityData = activityData || {};
  
  const getIcon = () => {
    switch (kind) {
      case '$whatsappMessage':
        return <MessageSquare className="h-4 w-4 text-green-600" />;
      case '$whatsappMention':
        return <AtSign className="h-4 w-4 text-blue-600" />;
      case '$newContact':
        return <UserPlus className="h-4 w-4 text-purple-600" />;
      case '$groupInvite':
        return <Users className="h-4 w-4 text-orange-600" />;
      default:
        return <MessageSquare className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTitle = () => {
    // Use the new `contact_display_name` field from the backend, with a fallback
    const sender = safeActivityData.contact_display_name || safeActivityData.sender || 'Unknown sender';
    const contactName = safeActivityData.contactName || 'Unknown contact';
    
    switch (kind) {
      case '$whatsappMessage':
        return `New message from ${sender}`;
      case '$whatsappMention':
        return `You were mentioned by ${sender}`;
      case '$newContact':
        return `New contact: ${contactName}`;
      case '$groupInvite':
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
      case '$whatsappMessage':
      case '$whatsappMention':
        return message;
      case '$newContact':
        return `${contactName} has been added to your contacts`;
      case '$groupInvite':
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

  // 🎯 SUCCESS: This is a valid WhatsApp message notification
  console.log('✅ [FRONTEND] Rendering valid WhatsApp notification:', {
    kind,
    sender: safeActivityData.sender,
    contact_display_name: safeActivityData.contact_display_name,
    message: safeActivityData.message,
  });

  return (
    <div className={`flex items-start space-x-3 p-3 rounded-lg transition-colors ${
      readAt ? 'bg-card opacity-75' : 'bg-accent'
    }`}>
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
function WhatsAppNotificationsContent() {
  let inboxNotifications = [];
  
  try {
    const result = useInboxNotifications();
    inboxNotifications = result.inboxNotifications || [];
    
  } catch (error) {
    console.error("Error fetching inbox notifications:", error);
    return (
      <div className="p-8 text-center">
        <MessageSquare className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <p className="text-red-600">Error loading notifications</p>
        <p className="text-sm text-muted-foreground mt-1">
          Please try refreshing the page
        </p>
      </div>
    );
  }
  
  // Filter out invalid notifications before rendering
  const validNotifications = inboxNotifications.filter((notification) => {
    if (!notification || !notification.id) {
      console.warn("🚨 [FRONTEND] Skipping notification without ID:", notification);
      return false;
    }
    
    // For now, only show WhatsApp messages until other types are properly implemented
    if (notification.kind !== '$whatsappMessage') {
      console.log(`🚨 [FRONTEND] Filtering out non-message notification: ${notification.kind}`);
      return false;
    }
    
    // The core of the fix: activityData is nested inside the 'activities' array
    const activityData = notification?.activities?.[0]?.data;

    // Ensure WhatsApp messages have required data
    if (notification.kind === '$whatsappMessage') {
      // Use the new `contact_display_name` field for validation
      const hasValidData = activityData && 
                          (activityData.contact_display_name || activityData.sender) && 
                          activityData.message;
      if (!hasValidData) {
        console.warn("🚨 [FRONTEND] Filtering out WhatsApp message with missing data:", { 
          id: notification.id, 
          kind: notification.kind,
          activityData: activityData 
        });
        return false;
      }
    }
    
    return true;
  });
  
  console.log(`🎯 [FRONTEND] Showing ${validNotifications.length} valid notifications out of ${inboxNotifications.length} total`);
  
  if (validNotifications.length === 0) {
    return (
      <div className="p-8 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <p className="text-muted-foreground">No notifications yet</p>
        <p className="text-sm text-muted-foreground mt-1">
          You'll see WhatsApp messages here when they arrive
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
        <WhatsAppMessageNotification
          key={notification.id}
          notification={notification}
        />
      ))}
    </div>
  );
}

// Main WhatsApp Notifications Component (with Suspense wrapper)
export function WhatsAppNotifications() {
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
      <WhatsAppNotificationsContent />
    </Suspense>
  );
} 