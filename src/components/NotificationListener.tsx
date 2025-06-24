import { useEffect } from "react";
import { useClient, type JsonObject } from "@liveblocks/react";
import { toast } from "react-hot-toast";
import logger from "@/utils/logger";

interface WhatsAppMessageEvent extends JsonObject {
  kind: '$whatsappMessage';
  activityData: {
    sender: string;
    message: string;
    timestamp?: string;
  }
}

interface WhatsAppMentionEvent extends JsonObject {
  kind: '$whatsappMention';
  activityData: {
    sender: string;
    message: string;
    room: string;
    timestamp?: string;
  }
}

interface NewContactEvent extends JsonObject {
  kind: '$newContact';
  activityData: {
    contactName: string;
    timestamp?: string;
  }
}

interface GroupInviteEvent extends JsonObject {
  kind: '$groupInvite';
  activityData: {
    inviter: string;
    room: string;
    timestamp?: string;
  }
}

type NotificationEvent = WhatsAppMessageEvent | WhatsAppMentionEvent | NewContactEvent | GroupInviteEvent;

function NotificationListener() {
  const client = useClient();
  
  useEffect(() => {
    if (!client) {
      logger.warn('[NotificationListener] Liveblocks client not available');
      return;
    }
    
    logger.info('[NotificationListener] Initializing notification listener');
    
    try {
      // Enter the notifications room to listen for broadcast events
      const { room, leave } = client.enterRoom("notifications");
      
      const unsubscribe = room.events.customEvent.subscribe(({ event }) => {
        logger.info('[NotificationListener] New broadcast event received:', event);
        
        try {
          const customEvent = event as NotificationEvent;
          
          if (!customEvent || !customEvent.kind || !customEvent.activityData) {
            logger.warn('[NotificationListener] Invalid event structure:', customEvent);
            return;
          }
          
          // Handle different notification types
          switch (customEvent.kind) {
            case '$whatsappMessage':
              handleWhatsAppMessage(customEvent);
              break;
            case '$whatsappMention':
              handleWhatsAppMention(customEvent);
              break;
            case '$newContact':
              handleNewContact(customEvent);
              break;
            case '$groupInvite':
              handleGroupInvite(customEvent);
              break;
            default:
              logger.info('[NotificationListener] Unknown notification type:', customEvent.kind);
          }
        } catch (error) {
          logger.error('[NotificationListener] Error processing notification:', error);
        }
      });
      
      logger.info('[NotificationListener] Successfully subscribed to notifications room');
      
      return () => {
        logger.info('[NotificationListener] Cleaning up notification listener');
        unsubscribe();
        leave();
      };
    } catch (error) {
      logger.error('[NotificationListener] Error initializing notification listener:', error);
    }
  }, [client]);
  
  const handleWhatsAppMessage = (event: WhatsAppMessageEvent) => {
    const { sender, message } = event.activityData;
    toast.success(`💬 ${sender}: ${message}`, {
      duration: 4000,
      style: {
        background: '#10B981',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(16, 185, 129, 0.15)',
      },
    });
  };
  
  const handleWhatsAppMention = (event: WhatsAppMentionEvent) => {
    const { sender, room } = event.activityData;
    toast.success(`@️ You were mentioned by ${sender} in ${room}`, {
      duration: 5000,
      style: {
        background: '#3B82F6',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.15)',
      },
    });
  };
  
  const handleNewContact = (event: NewContactEvent) => {
    const { contactName } = event.activityData;
    toast.success(`👤 ${contactName} is now available on WhatsApp`, {
      duration: 4000,
      style: {
        background: '#8B5CF6',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(139, 92, 246, 0.15)',
      },
    });
  };
  
  const handleGroupInvite = (event: GroupInviteEvent) => {
    const { inviter, room } = event.activityData;
    toast.success(`👥 ${inviter} invited you to ${room}`, {
      duration: 5000,
      style: {
        background: '#F59E0B',
        color: '#ffffff',
        border: 'none',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)',
      },
    });
  };
  
  return null; // This component doesn't render anything
}

export default NotificationListener;
