"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Phone, PhoneCall, SignOut as LogOut, WifiHigh as Wifi, WifiSlash as WifiOff } from "@phosphor-icons/react/ssr";

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
      <div className="dash-subhead flex items-center justify-between px-4 py-3 border-b dash-hairline">
        <div className="flex items-center gap-2">
          {started ? (
            connected ? <Wifi className="h-3.5 w-3.5 text-emerald-500" /> : <WifiOff className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
          ) : (
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-foreground/80">
            {!started ? "Dialer" : connected ? "Connected" : "Connecting..."}
          </span>
          {callCount > 0 && <span className="text-xs tabular-nums text-muted-foreground">· {callCount}x</span>}
        </div>
        <button onClick={handleLogout} className="text-xs text-muted-foreground active:text-foreground transition-colors flex items-center gap-1">
          <LogOut className="h-3 w-3" /> Log out
        </button>
      </div>

      {/* Main */}
      <div className="flex-1 flex items-center justify-center px-6">
        {!started ? (
          <div className="dash-panel w-full max-w-xs flex flex-col items-center gap-6 px-8 py-10">
            <div className="dash-chip h-20 w-20 rounded-full flex items-center justify-center">
              <Phone className="h-8 w-8" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-base font-semibold tracking-tight">Get phone ready</p>
              <p className="text-xs text-muted-foreground">Tap to connect to your computer</p>
            </div>
            <button
              onClick={startListening}
              className="px-7 py-3 rounded-full bg-primary text-primary-foreground font-medium text-sm shadow-sm active:scale-95 transition-transform"
            >
              Connect
            </button>
          </div>
        ) : dialRequest ? (
          <div key={animateKey} className="dash-panel w-full max-w-xs flex flex-col items-center justify-center gap-6 px-8 py-10" style={{ animation: "bounceIn 0.3s ease-out" }}>
            {/* Auto-dialed indicator — pink = good news / live call */}
            <div className="dash-chip-pink h-16 w-16 rounded-full flex items-center justify-center">
              <PhoneCall className="h-7 w-7" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-lg font-semibold tracking-tight">{dialRequest.companyName || "Unknown"}</p>
              <p className="text-sm font-mono tabular-nums text-muted-foreground">{dialRequest.phone}</p>
            </div>
            <p className="text-xs font-medium" style={{ color: "var(--dash-accent-2)" }}>Calling...</p>

            {/* Fallback: if auto-redirect was blocked, tap here */}
            <a
              href={`tel:${dialRequest.phone}`}
              className="px-6 py-2.5 rounded-full bg-emerald-500 text-white text-sm font-medium tabular-nums shadow-sm active:scale-95 transition-transform"
            >
              Call {dialRequest.phone}
            </a>

            <button
              onClick={() => setDialRequest(null)}
              className="text-xs text-muted-foreground active:text-foreground transition-colors mt-2"
            >
              Close
            </button>
          </div>
        ) : (
          <div className="dash-panel w-full max-w-xs flex flex-col items-center gap-5 px-8 py-10">
            <div className={`h-16 w-16 rounded-full flex items-center justify-center border transition-colors duration-500 ${connected ? "dash-chip" : "bg-muted/20 dash-hairline"}`}>
              <Phone className={`h-7 w-7 transition-colors duration-500 ${connected ? "" : "text-muted-foreground/30"}`} />
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
