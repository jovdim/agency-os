"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, QrCode, Smartphone, Check } from "lucide-react";
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
    <div className="space-y-6 max-w-xl">
      <h1 className="text-xl font-semibold">Settings</h1>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Dialing numbers</CardTitle>
          <p className="text-xs text-muted-foreground">How you want to call contacts from your computer</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {DIAL_OPTIONS.map(opt => {
            const Icon = opt.icon;
            const isActive = preference === opt.value;
            return (
              <button
                key={opt.value}
                disabled={saving}
                onClick={() => save(opt.value)}
                className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
              >
                <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isActive ? "text-primary" : ""}`}>{opt.label}</p>
                  <p className="text-[11px] text-muted-foreground">{opt.description}</p>
                </div>
                {isActive && <Check className="h-4 w-4 text-primary shrink-0" />}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {preference !== "qr" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Phone — connection</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Open this page on your phone and keep it open:
            </p>
            <div className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-sm select-all">
              {typeof window !== "undefined" ? `${window.location.origin}/sales/dialer` : "/sales/dialer"}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              When you click a number on your computer, it appears automatically on your phone.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
