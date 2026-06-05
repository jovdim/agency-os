"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";

export function DismissReminderButton({ reminderId }: { reminderId: string }) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState(false);

  async function dismiss() {
    setDismissing(true);
    try {
      await fetch(`/api/reminders/${reminderId}`, { method: "PUT" });
      router.refresh();
    } catch {
      setDismissing(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={dismiss}
      disabled={dismissing}
      className="shrink-0 h-7 w-7 p-0"
      title="Dismiss"
    >
      {dismissing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <X className="h-3.5 w-3.5" />
      )}
    </Button>
  );
}
