"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, QrCode, DeviceMobile as Smartphone, Check, GearSix as Settings, LinkSimple as Link2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

const DIAL_OPTIONS = [
  { value: "qr", label: "QR code", description: "Scan the QR code with your phone to dial", icon: QrCode },
  { value: "push", label: "Push to phone", description: "The number is sent automatically to your phone (open /sales/dialer on your phone)", icon: Smartphone },
  { value: "both", label: "Both", description: "QR code + automatic push to phone", icon: Phone },
] as const;

export default function SalesSettingsPage() {
  const [preference, setPreference] = useState<string>("push");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase.from("profiles").select("dial_preference").eq("id", user.id).single();
        setPreference(data?.dial_preference || "push");
      }
      setLoaded(true);
    })();
  }, []);

  async function save(value: string) {
    setSaving(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from("profiles").update({ dial_preference: value }).eq("id", user.id);
      setPreference(value);
      toast.success("Setting saved");
    }
    setSaving(false);
  }

  if (!loaded) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <div className="dash-chip">
          <Settings className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">Personal preferences for how you work and call contacts.</p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <p className="dash-subhead">Dialing</p>
          <CardTitle className="text-base">Dialing numbers</CardTitle>
          <p className="text-xs text-muted-foreground">How you want to call contacts from your computer.</p>
        </CardHeader>
        <CardContent className="space-y-2.5">
          {DIAL_OPTIONS.map(opt => {
            const Icon = opt.icon;
            const isActive = preference === opt.value;
            return (
              <button
                key={opt.value}
                disabled={saving}
                onClick={() => save(opt.value)}
                className={`group w-full flex items-center gap-3.5 rounded-xl border p-3.5 text-left transition-colors disabled:opacity-60 ${isActive ? "border-(--dash-accent)/40 bg-(--dash-accent)/5" : "border-border hover:bg-muted/40"}`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${isActive ? "bg-(--dash-accent)/12 text-(--dash-accent)" : "bg-muted text-muted-foreground group-hover:text-foreground"}`}>
                  <Icon className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isActive ? "dash-accent" : ""}`}>{opt.label}</p>
                  <p className="text-xs text-muted-foreground leading-snug">{opt.description}</p>
                </div>
                {isActive && (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-(--dash-accent)/12 text-(--dash-accent)">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {preference !== "qr" && (
        <Card>
          <CardHeader className="pb-3">
            <p className="dash-subhead">Connection</p>
            <CardTitle className="text-base flex items-center gap-2">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              Phone connection
            </CardTitle>
            <p className="text-xs text-muted-foreground">Open this page on your phone and keep it open.</p>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-sm select-all break-all">
              <Smartphone className="h-4 w-4 shrink-0 text-muted-foreground" />
              {typeof window !== "undefined" ? `${window.location.origin}/sales/dialer` : "/sales/dialer"}
            </div>
            <p className="text-xs text-muted-foreground">
              When you click a number on your computer, it appears automatically on your phone.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
