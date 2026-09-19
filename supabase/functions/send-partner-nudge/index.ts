// Supabase Edge Function: send-partner-nudge
// Invoked with: supabase functions serve send-partner-nudge / deploy
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tracker_id } = await req.json();
    if (!tracker_id) {
      return new Response(JSON.stringify({ error: "tracker_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data, error } = await supabase.rpc("record_partner_nudge", {
      p_tracker_id: tracker_id,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!data || data.success === false) {
      const status = data?.cooldown_remaining_seconds ? 429 : 403;
      return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Optional FCM push dispatch if FCM_SERVER_KEY is present
    const fcmServerKey = Deno.env.get("FCM_SERVER_KEY");
    const fcmTokens = data.fcm_tokens || [];
    if (fcmServerKey && fcmTokens.length > 0) {
      const partnerName = data.partner_name || "Your partner";
      const pendingSlot = data.pending_slot || "routine";
      for (const token of fcmTokens) {
        await fetch("https://fcm.googleapis.com/fcm/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `key=${fcmServerKey}`,
          },
          body: JSON.stringify({
            to: token,
            notification: {
              title: "Skin Streak ✨",
              body: `${partnerName} thinks you might have forgotten your ${pendingSlot} routine.`,
              icon: "/icons/icon-192.png",
            },
          }),
        }).catch((e) => console.warn("FCM error:", e));
      }
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
