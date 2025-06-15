
import { useEffect } from "react";
import { useRoom } from "@liveblocks/react";
import { toast } from "react-hot-toast";

function NotificationListener() {
  // Replace with your notifications room ID
  const room = useRoom("notifications");
  
  useEffect(() => {
    if (!room) return;
    
    // Set up a broadcast event listener
    const unsubscribe = room.events.notification.subscribe((data) => {
      // Handle new notification
      console.log("New notification received:", data);
      
      if (data.kind === '$whatsappMessage' && data.activityData) {
        toast.success(`New message from ${data.activityData.sender}: ${data.activityData.message}`);
      }
    });
    
    return () => {
      unsubscribe();
    };
  }, [room]);
  
  return null; // This component doesn't render anything
}

export default NotificationListener;
