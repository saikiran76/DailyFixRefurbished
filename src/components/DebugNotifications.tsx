import React, { Suspense, useState } from "react";
import { useInboxNotifications } from "@liveblocks/react";
import type { InboxNotification as LiveblocksNotification } from "@liveblocks/core";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Bug } from "lucide-react";

// Define a more specific type for notifications with activityData
type NotificationWithActivity = LiveblocksNotification & {
  activities: { data: Record<string, any> }[];
  subjectId?: string;
};

function DebugNotificationsContent() {
  const [showDetails, setShowDetails] = useState(false);
  const { inboxNotifications: rawNotifications } = useInboxNotifications();
  const inboxNotifications = rawNotifications as NotificationWithActivity[];

  const notificationStats = {
    total: inboxNotifications.length,
    whatsappMessages: inboxNotifications.filter(n => n.kind === '$whatsappMessage').length,
    groupInvites: inboxNotifications.filter(n => n.kind === '$groupInvite').length,
    others: inboxNotifications.filter(n => !['$whatsappMessage', '$groupInvite'].includes(n.kind)).length,
    withActivityData: inboxNotifications.filter(n => n.activities && n.activities.length > 0 && n.activities[0].data).length,
    withoutActivityData: inboxNotifications.filter(n => !n.activities || n.activities.length === 0 || !n.activities[0].data).length,
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bug className="h-5 w-5 text-blue-500" />
          Notification Debug Panel
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Statistics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Total Notifications:</p>
            <Badge variant="outline" className="">{notificationStats.total}</Badge>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">WhatsApp Messages:</p>
            <Badge variant="default" className="">{notificationStats.whatsappMessages}</Badge>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Group Invites:</p>
            <Badge variant="destructive" className="">{notificationStats.groupInvites}</Badge>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">With Activity Data:</p>
            <Badge variant="secondary" className="">{notificationStats.withActivityData}</Badge>
          </div>
        </div>

        {/* Toggle Details Button */}
        <Button
          variant="outline"
          onClick={() => setShowDetails(!showDetails)}
          className="w-full"
        >
          {showDetails ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
          {showDetails ? 'Hide' : 'Show'} Detailed Notifications
        </Button>

        {/* Detailed Notifications */}
        {showDetails && (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {inboxNotifications.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No notifications to display</p>
            ) : (
              inboxNotifications.map((notification, index) => {
                const activityData = notification?.activities?.[0]?.data;
                return (
                  <div key={notification.id || index} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant={notification.kind === '$whatsappMessage' ? 'default' : 'destructive'} className="">
                        {notification.kind}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        ID: {notification.id?.slice(-8) || 'No ID'}
                      </span>
                    </div>
                    
                    {activityData ? (
                      <div className="text-xs space-y-1">
                        <p><strong>Sender:</strong> {activityData.sender || 'N/A'}</p>
                        <p><strong>Display Name:</strong> {activityData.contact_display_name || 'N/A'}</p>
                        <p><strong>Message:</strong> {activityData.message || 'N/A'}</p>
                        <p><strong>Timestamp:</strong> {activityData.timestamp || 'N/A'}</p>
                        <p><strong>Room:</strong> {activityData.room || 'N/A'}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-red-500">❌ No activityData</p>
                    )}
                    
                    <div className="text-xs text-muted-foreground">
                      <p><strong>Read:</strong> {notification.readAt ? 'Yes' : 'No'}</p>
                      <p><strong>Subject ID:</strong> {notification.subjectId || 'N/A'}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Instructions */}
        <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg text-sm">
          <p className="font-medium text-blue-800 dark:text-blue-200 mb-2">🔍 Debug Instructions:</p>
          <ul className="text-blue-700 dark:text-blue-300 space-y-1 text-xs">
            <li>• Send a WhatsApp message to test notifications</li>
            <li>• Check browser console for detailed logs</li>
            <li>• Valid notifications should have activityData with sender and message</li>
            <li>• Group invites without proper data are filtered out</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export function DebugNotifications() {
  return (
    <Suspense fallback={
      <Card className="w-full max-w-2xl">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
            <span className="ml-2">Loading debug info...</span>
          </div>
        </CardContent>
      </Card>
    }>
      <DebugNotificationsContent />
    </Suspense>
  );
} 