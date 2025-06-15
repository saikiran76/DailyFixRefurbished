
import { useEffect } from "react";
import { useClient, JsonObject } from "@liveblocks/react";
import { toast } from "react-hot-toast";

interface WhatsAppMessageEvent extends JsonObject {
  kind: '$whatsappMessage';
  activityData: {
    sender: string;
    message: string;
  }
}

function NotificationListener() {
  const client = useClient();
  
  useEffect(() => {
    if (!client) {
      return;
    }
    
    // Enter the notifications room to listen for broadcast events
    const { room, leave } = client.enterRoom("notifications");
    
    const unsubscribe = room.events.customEvent.subscribe(({ event }) => {
      console.log("New broadcast event received:", event);
      
      const customEvent = event as WhatsAppMessageEvent;
      if (customEvent && customEvent.kind === '$whatsappMessage' && customEvent.activityData) {
        toast.success(`New message from ${customEvent.activityData.sender}: ${customEvent.activityData.message}`);
      }
    });
    
    return () => {
      unsubscribe();
      leave();
    };
  }, [client]);
  
  return null; // This component doesn't render anything
}

export default NotificationListener;
