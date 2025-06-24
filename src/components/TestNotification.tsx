import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "react-hot-toast";
import api from "@/utils/api";
import { getSupabaseClient } from "@/utils/supabase";
import { DebugNotifications } from "./DebugNotifications";

export function TestNotification() {
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  const triggerTestNotification = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        toast.error("Supabase not initialized");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("User not authenticated");
        return;
      }

      // Try to trigger a test notification using the correct backend structure
      // This should match your backend's expected webhook payload
      const testPayload = {
        event_type: "whatsapp_message_received",
        user_id: session.user.id,
        room_id: "notifications",
        notification_data: {
          kind: "$whatsappMessage",
          activityData: {
            sender: "Test Contact",
            message: "🧪 This is a test notification from the frontend",
            timestamp: new Date().toISOString(),
          }
        }
      };

      console.log("Sending test notification payload:", testPayload);

      const response = await api.post("/api/v1/notifications/webhook", testPayload);

      toast.success("Test notification sent successfully!");
      console.log("Test notification response:", response.data);
      
    } catch (error: any) {
      console.error("Failed to send test notification:", error);
      
      // More detailed error handling
      if (error.response) {
        const status = error.response.status;
        const message = error.response.data?.message || error.message;
        
        if (status === 400) {
          toast.error(`Bad Request: ${message}. Check console for payload details.`);
        } else if (status === 404) {
          toast.error("Webhook endpoint not found. Backend may not be running.");
        } else if (status === 500) {
          toast.error("Backend server error. Check backend logs.");
        } else {
          toast.error(`HTTP ${status}: ${message}`);
        }
      } else {
        toast.error("Network error: Cannot reach backend");
      }
    }
  };

  const triggerDirectLiveblocksTest = async () => {
    try {
      const supabase = getSupabaseClient();
      if (!supabase) {
        toast.error("Supabase not initialized");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error("User not authenticated");
        return;
      }

      // Try to directly call the Liveblocks auth endpoint to test connection
      const response = await api.post("/api/v1/liveblocks/auth", {
        room: "notifications",
        userId: session.user.id,
        userInfo: {
          name: session.user.user_metadata?.full_name || session.user.email,
          email: session.user.email,
        },
      });

      toast.success("✅ Liveblocks auth test successful!");
      console.log("Liveblocks auth response:", response.data);
      
    } catch (error: any) {
      console.error("Liveblocks auth test failed:", error);
      toast.error("❌ Liveblocks auth test failed");
    }
  };

  return (
    <>
      <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2">
        <Button 
          onClick={triggerTestNotification}
          variant="outline"
          size="sm"
          className="bg-yellow-500 hover:bg-yellow-600 text-black"
        >
          🧪 Test Notification
        </Button>
        
        <Button 
          onClick={triggerDirectLiveblocksTest}
          variant="outline"
          size="sm"
          className="bg-blue-500 hover:bg-blue-600 text-white"
        >
          🔗 Test Liveblocks Auth
        </Button>

        <Button 
          onClick={() => setShowDebugPanel(!showDebugPanel)}
          variant="outline"
          size="sm"
          className="bg-purple-500 hover:bg-purple-600 text-white"
        >
          🐛 Debug Panel
        </Button>
      </div>

      {/* Debug Panel Overlay */}
      {showDebugPanel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4">
          <div className="relative">
            <Button
              onClick={() => setShowDebugPanel(false)}
              variant="outline"
              size="sm"
              className="absolute -top-2 -right-2 z-10 bg-red-500 hover:bg-red-600 text-white"
            >
              ✕
            </Button>
            <DebugNotifications />
          </div>
        </div>
      )}
    </>
  );
} 