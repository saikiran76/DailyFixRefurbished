import React, { type ReactNode } from "react";
import { LiveblocksProvider, RoomProvider, ClientSideSuspense } from "@liveblocks/react";
import { getSupabaseClient } from "@/utils/supabase";
import api from "@/utils/api";

export function LiveblocksProviderWrapper({ children }: { children: ReactNode }) {
  const publicApiKey = "pk_dev_L5LcTYUaZ2MvmlGCAnLsBPrzUsElOV0zVSBH66jcOSuGHwPViUfwoZPDgCa1vo3P";

  return (
    <LiveblocksProvider 
      authEndpoint={async (room) => {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          throw new Error("User is not authenticated");
        }

        try {
          const response = await api.post("https://dailyfix-api-gateway.duckdns.org/api/v1/liveblocks/auth", {
            room,
            userId: session.user.id,
            userInfo: {
              name: session.user.user_metadata?.full_name || session.user.email,
              email: session.user.email,
            },
          });

          return response.data;
        } catch (error) {
          console.error("Liveblocks auth error:", error);
          throw error;
        }
      }}
      throttle={16}
      resolveUsers={async ({ userIds }) => {
        // Optional: Resolve user info for display
        return userIds.map(userId => ({
          name: `User ${userId}`,
          avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
        }));
      }}
    >
      <RoomProvider id="notifications" initialPresence={{}}>
        <ClientSideSuspense fallback={<div>Loading...</div>}>
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}
