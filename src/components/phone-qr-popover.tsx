"use client";

import { useState, useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Phone, Copy, Check, DeviceMobile as Smartphone } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface PhoneQrPopoverProps {
  phone: string;
  companyName?: string;
  children: React.ReactNode;
}

// Cache the user's dial preference + userId
let cachedPreference: string | null = null;
let cachedUserId: string | null = null;
let cacheTimestamp = 0;
// Track last dialed globally + force re-renders via event
let lastDialedPhone: string | null = null;
const listeners = new Set<() => void>();
function setLastDialed(phone: string) {
  lastDialedPhone = phone;
  listeners.forEach(fn => fn());
}

async function loadPreference() {
  // Refresh cache every 10 seconds so settings changes are picked up quickly
  if (cachedPreference && Date.now() - cacheTimestamp < 10000) return;
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      cachedUserId = user.id;
      const { data } = await supabase.from("profiles").select("dial_preference").eq("id", user.id).single();
      cachedPreference = data?.dial_preference || "push";
      cacheTimestamp = Date.now();
    }
  } catch {}
}

export function PhoneQrPopover({ phone, companyName, children }: PhoneQrPopoverProps) {
  const [isDesktop, setIsDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pushed, setPushed] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [preference, setPreference] = useState<string>("push");
  const [, forceUpdate] = useState(0);

  // Re-render when last dialed changes globally
  useEffect(() => {
    const fn = () => forceUpdate(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  useEffect(() => {
    setIsDesktop(window.matchMedia("(pointer: fine)").matches);
    loadPreference().then(() => {
      setPreference(cachedPreference || "qr");
    });
  }, []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  async function handlePush() {
    if (pushing || pushed) return;
    if (!cachedUserId) {
      await loadPreference();
      if (!cachedUserId) {
        toast.error("You are not signed in");
        return;
      }
    }
    setPushing(true);
    try {
      const supabase = createClient();
      const channel = supabase.channel(`dial-${cachedUserId}`, {
        config: { broadcast: { ack: true } },
      });

      await channel.subscribe();
      // Small delay to ensure channel is ready
      await new Promise(r => setTimeout(r, 300));

      await channel.send({
        type: "broadcast",
        event: "dial",
        payload: {
          phone,
          companyName: companyName || "",
          timestamp: Date.now(),
        },
      });

      supabase.removeChannel(channel);
      setLastDialed(phone);
      setPushed(true);
      setPushing(false);
      setTimeout(() => setPushed(false), 5000);
      toast.success("Sent to phone");
    } catch (err) {
      console.error("[PushDial] Error:", err);
      setPushing(false);
      toast.error("Failed to send to phone");
    }
  }

  // On mobile, just render a normal tel: link
  if (!isDesktop) {
    return <a href={`tel:${phone}`}>{children}</a>;
  }

  const isLastDialed = lastDialedPhone === phone;

  // Push only — no QR popup, just broadcast
  if (preference === "push") {
    return (
      <button
        disabled={pushing}
        className={`inline-flex items-center gap-1 hover:underline cursor-pointer active:scale-95 transition-all duration-100 ${pushing ? "text-amber-400 animate-pulse" : isLastDialed ? "text-emerald-400" : "text-primary"}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handlePush();
        }}
      >
        {children}
      </button>
    );
  }

  // QR or Both — show popover
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`inline-flex items-center gap-1 hover:underline cursor-pointer active:scale-95 transition-all duration-100 ${isLastDialed ? "text-emerald-400" : "text-primary"}`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="bg-white p-2 rounded-lg">
            <QRCodeSVG value={`tel:${phone}`} size={128} />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-mono">{phone}</span>
          </div>
          <div className="flex gap-1.5 w-full">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1.5 flex-1"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            {(preference === "both" || preference === "push") && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 flex-1"
                onClick={handlePush}
              >
                {pushed ? <Check className="h-3 w-3" /> : <Smartphone className="h-3 w-3" />}
                {pushed ? "Sent" : "To phone"}
              </Button>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Scan with your phone to dial
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
