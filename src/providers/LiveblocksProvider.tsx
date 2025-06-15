import React, { ReactNode } from "react";
import { LiveblocksProvider, ClientSideSuspense } from "@liveblocks/react";
import { getSupabaseClient } from "@/utils/supabase";

export function LiveblocksProviderWrapper({ children }: { children: ReactNode }) {
  const publicApiKey = "pk_dev_L5LcTYUaZ2MvmlGCAnLsBPrzUsElOV0zVSBH66jcOSuGHwPViUfwoZPDgCa1vo3P";
  const authEndpoint = "https://survive-instead-deemed-tm.trycloudflare.com/api/v1/liveblocks/auth";

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

        const response = await fetch(authEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          // Send permissions as an array of strings.
          body: JSON.stringify({ room, access: ["room:read", "room:write"] }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Liveblocks auth failed:", response.status, errorText);
          throw new Error(`Failed to authenticate with Liveblocks: ${errorText}`);
        }

        return await response.json();
      }}
    >
      <ClientSideSuspense fallback={<div>Loading...</div>}>
        {children}
      </ClientSideSuspense>
    </LiveblocksProvider>
  );
}
