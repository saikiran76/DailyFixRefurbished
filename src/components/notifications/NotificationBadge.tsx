import React, { Suspense } from "react";
import { useUnreadInboxNotificationsCount } from "@liveblocks/react/suspense";
import { Badge } from "@/components/ui/badge";

// Notification Badge Content Component (needs Suspense)
function NotificationBadgeContent() {
  const { count } = useUnreadInboxNotificationsCount();
  
  if (count === 0) {
    return null;
  }
  
  return (
    <Badge 
      variant="destructive" 
      className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs font-bold rounded-full"
    >
      {count > 99 ? '99+' : count}
    </Badge>
  );
}

// Main Notification Badge Component (with Suspense wrapper)
export function NotificationBadge() {
  return (
    <Suspense fallback={null}>
      <NotificationBadgeContent />
    </Suspense>
  );
}

export default NotificationBadge; 