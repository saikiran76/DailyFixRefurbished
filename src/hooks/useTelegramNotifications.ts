import { useInboxNotifications } from "@liveblocks/react";

export default function useTelegramNotifications() {
  const { inboxNotifications, markAllAsRead, markAsRead } = useInboxNotifications();
  
  // Filter for Telegram-specific notifications
  const telegramNotifications = inboxNotifications?.filter(
    (notification) => notification.kind.startsWith('$telegram')
  ) || [];
  
  // Filter for unread notifications
  const unreadNotifications = telegramNotifications.filter(
    (notification) => !notification.readAt
  );
  
  return {
    notifications: telegramNotifications,
    unreadCount: unreadNotifications.length,
    unreadNotifications,
    markAsRead,
    markAllAsRead,
  };
} 