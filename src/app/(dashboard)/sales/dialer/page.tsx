"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Phone, PhoneCall, LogOut, Wifi, WifiOff } from "lucide-react";

interface DialRequest {
  phone: string;
  companyName: string;
  timestamp: number;
}

export default function DialerPage() {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [dialRequest, setDialRequest] = useState<DialRequest | null>(null);
  const [callCount, setCallCount] = useState(0);
  const [animateKey, setAnimateKey] = useState(0);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  async function startListening() {
    setStarted(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const channel = supabase.channel(`dial-${user.id}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on("broadcast", { event: "dial" }, (payload) => {
        const data = payload.payload as DialRequest;
        setAnimateKey(k => k + 1);
        setDialRequest(data);
        setCallCount(c => c + 1);
        if (navigator.vibrate) navigator.vibrate([200]);
        // Send acknowledgement back to the laptop
        channel.send({ type: "broadcast", event: "dial-ack", payload: { phone: data.phone, timestamp: Date.now() } });
        // Auto-open dialer — skip the green button screen
        window.location.href = `tel:${data.phone}`;
      })
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    channelRef.current = channel;
  }

  useEffect(() => {
    return () => {
      if (channelRef.current) {
        const supabase = createClient();
        supabase.removeChannel(channelRef.current);
      }
    };
  }, []);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col z-50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          {started ? (
            connected ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
          ) : (
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs text-muted-foreground">
            {!started ? "Dialer" : connected ? "Connected" : "Connecting..."}
          </span>
          {callCount > 0 && <span className="text-xs text-muted-foreground">· {callCount}x</span>}
        </div>
        <button onClick={handleLogout} className="text-xs text-muted-foreground active:text-foreground flex items-center gap-1">
          <LogOut className="h-3 w-3" /> Log out
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center px-6">
        {!started ? (
          <div className="flex flex-col items-center gap-6">
            <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Phone className="h-8 w-8 text-primary" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-base font-medium">Get phone ready</p>
              <p className="text-xs text-muted-foreground">Tap to connect to your computer</p>
            </div>
            <button
              onClick={startListening}
              className="px-6 py-3 rounded-full bg-primary text-primary-foreground font-medium text-sm active:scale-95 transition-transform"
            >
              Connect
            </button>
          </div>
        ) : dialRequest ? (
          <div key={animateKey} className="w-full flex flex-col items-center justify-center gap-6" style={{ animation: "bounceIn 0.3s ease-out" }}>
            {/* Auto-dialed indicator */}
            <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <PhoneCall className="h-7 w-7 text-emerald-500" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-lg font-bold">{dialRequest.companyName || "Unknown"}</p>
              <p className="text-sm font-mono text-muted-foreground">{dialRequest.phone}</p>
            </div>
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Calling...</p>

            {/* Fallback: if auto-redirect was blocked, tap here */}
            <a
              href={`tel:${dialRequest.phone}`}
              className="px-6 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-medium active:scale-95 transition-transform"
            >
              Call {dialRequest.phone}
            </a>

            <button
              onClick={() => setDialRequest(null)}
              className="text-xs text-muted-foreground active:text-foreground mt-4"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4">
            <div className={`h-16 w-16 rounded-full flex items-center justify-center transition-colors duration-500 ${connected ? "bg-emerald-500/10" : "bg-muted/10"}`}>
              <Phone className={`h-7 w-7 transition-colors duration-500 ${connected ? "text-emerald-500/50" : "text-muted-foreground/30"}`} />
            </div>
            <p className="text-xs text-muted-foreground">
              {connected ? "Waiting for a call..." : "Connecting..."}
            </p>
          </div>
        )}
      </div>

      {/* CSS animations */}
      <style jsx>{`
        @keyframes bounceIn {
          0% { opacity: 0; transform: scale(0.8) translateY(20px); }
          50% { opacity: 1; transform: scale(1.05) translateY(-5px); }
          100% { transform: scale(1) translateY(0); }
        }
        @keyframes numberPop {
          0% { opacity: 0; transform: scale(0.5); }
          70% { transform: scale(1.1); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
