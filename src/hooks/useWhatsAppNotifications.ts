
import { useInboxNotifications } from "@liveblocks/react";

export default function useWhatsAppNotifications() {
  const { inboxNotifications, markAllAsRead, markAsRead } = useInboxNotifications();
  
  // Filter for WhatsApp-specific notifications
  const whatsappNotifications = inboxNotifications?.filter(
    (notification) => notification.kind.startsWith('$whatsapp')
  ) || [];
  
  // Filter for unread notifications
  const unreadNotifications = whatsappNotifications.filter(
    (notification) => !notification.readAt
  );
  
  return {
    notifications: whatsappNotifications,
    unreadCount: unreadNotifications.length,
    unreadNotifications,
    markAsRead,
    markAllAsRead,
  };
}
