
import { useEffect } from "react";
import { useClient } from "@liveblocks/react";
import { toast } from "react-hot-toast";

function NotificationListener() {
  const client = useClient();
  
  useEffect(() => {
    if (!client) {
      return;
    }
    
    // Enter the notifications room to listen for broadcast events
    const { room, leave } = client.enterRoom("notifications");
    
    const unsubscribe = room.events.broadcast.subscribe(({ event }) => {
      console.log("New broadcast event received:", event);
      
      if (event && event.kind === '$whatsappMessage' && event.activityData) {
        toast.success(`New message from ${event.activityData.sender}: ${event.activityData.message}`);
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
