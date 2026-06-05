"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Sparkle as Sparkles, Rocket, Heart as HeartIcon, Trash as TrashIcon } from "@phosphor-icons/react/ssr";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function AlertsDemoClient() {
  const [confirmVariant, setConfirmVariant] = React.useState<
    null | "default" | "success" | "info" | "warning" | "destructive"
  >(null);

  const [dismissed, setDismissed] = React.useState<Record<string, boolean>>({});

  const toastsRow = [
    {
      label: "Success",
      handler: () =>
        toast.success("Website published!", {
          description: "Live at yourdomain.pages.dev in a few seconds.",
        }),
    },
    {
      label: "Error",
      handler: () =>
        toast.error("Publishing failed", {
          description: "Cloudflare API returned 503. Please try again.",
        }),
    },
    {
      label: "Warning",
      handler: () =>
        toast.warning("Domain is not active yet", {
          description: "The client is waiting for your next step.",
        }),
    },
    {
      label: "Info",
      handler: () =>
        toast.info("Syncing content", {
          description: "This may take a moment.",
        }),
    },
    {
      label: "Loading",
      handler: () => {
        const id = toast.loading("Uploading files...");
        setTimeout(() => {
          toast.success("Done!", { id });
        }, 1800);
      },
    },
    {
      label: "Action",
      handler: () =>
        toast("Client was deleted", {
          description: "The action will be applied in 5 seconds.",
          action: {
            label: "Undo",
            onClick: () => toast.success("Restored."),
          },
        }),
    },
    {
      label: "Custom (Sparkles)",
      handler: () =>
        toast("New version available", {
          description: "Click to refresh.",
          icon: <Sparkles className="size-4.5 text-info" />,
        }),
    },
    {
      label: "Multi-fire (stack)",
      handler: () => {
        toast.success("First done");
        setTimeout(() => toast.info("Second running..."), 200);
        setTimeout(() => toast.warning("Third waiting"), 400);
        setTimeout(() => toast.error("Fourth failed"), 600);
      },
    },
  ];

  const inlineAlerts: Array<{
    key: string;
    variant: "default" | "success" | "info" | "warning" | "destructive";
    title: string;
    description: string;
    dismissible?: boolean;
  }> = [
    {
      key: "default",
      variant: "default",
      title: "For your information",
      description: "This is the default alert without a specific meaning.",
    },
    {
      key: "success",
      variant: "success",
      title: "Payment confirmed",
      description:
        "The client paid $299. The invoice was generated automatically and the website marked as paid.",
      dismissible: true,
    },
    {
      key: "info",
      variant: "info",
      title: "New version available",
      description:
        "Composer 2.3.0 brings faster publishing and improved AI fill. Reload the page to update.",
    },
    {
      key: "warning",
      variant: "warning",
      title: "Domain is not configured yet",
      description:
        "Set a custom domain before publishing, otherwise the website will only be available on the *.pages.dev subdomain.",
      dismissible: true,
    },
    {
      key: "destructive",
      variant: "destructive",
      title: "Publishing failed",
      description:
        "GitHub API returned error 403: Rate limit exceeded. Try again in 5 minutes or contact the tech team.",
    },
  ];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/super">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              Alert system preview
              <Sparkles className="size-5 text-info sk-animate-icon-pop" />
            </h1>
            <p className="text-sm text-muted-foreground">
              Live preview of the new animated notification layer. Click the
              buttons to trigger them.
            </p>
          </div>
        </div>
      </div>

      {/* Toasts */}
      <Card>
        <CardHeader>
          <CardTitle>Toast notifications (sonner)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {toastsRow.map((t) => (
              <Button
                key={t.label}
                variant="outline"
                onClick={t.handler}
                className="transition-transform hover:scale-105 active:scale-95"
              >
                {t.label}
              </Button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Sonner v2.0.7 — API unchanged. The existing 419 toast call-sites
            work without modifications.
          </p>
        </CardContent>
      </Card>

      {/* Inline alerts */}
      <Card>
        <CardHeader>
          <CardTitle>Inline alerts (&lt;Alert&gt;)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {inlineAlerts.map((a) =>
            dismissed[a.key] ? null : (
              <Alert
                key={a.key}
                variant={a.variant}
                onDismiss={
                  a.dismissible
                    ? () => setDismissed((d) => ({ ...d, [a.key]: true }))
                    : undefined
                }
              >
                <AlertTitle>{a.title}</AlertTitle>
                <AlertDescription>{a.description}</AlertDescription>
              </Alert>
            )
          )}
          {Object.keys(dismissed).length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed({})}
              className="mt-2"
            >
              Reset
            </Button>
          )}

          <div className="pt-4 border-t border-border space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Custom icons
            </p>
            <Alert variant="info" icon={Rocket}>
              <AlertTitle>Deploy started</AlertTitle>
              <AlertDescription>
                Cloudflare Pages will build in ~30 seconds.
              </AlertDescription>
            </Alert>
            <Alert variant="success" icon={HeartIcon}>
              <AlertTitle>Thank you!</AlertTitle>
              <AlertDescription>
                Your feedback was sent to the developers.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>

      {/* Interactive table rows */}
      <Card>
        <CardHeader>
          <CardTitle>Interactive table rows (&lt;TableRow interactive&gt;)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Opt-in via <code className="rounded bg-muted px-1 py-0.5 text-[11px]">interactive</code> prop
            on <code className="rounded bg-muted px-1 py-0.5 text-[11px]">&lt;TableRow&gt;</code>,
            or <code className="rounded bg-muted px-1 py-0.5 text-[11px]">data-interactive=&quot;true&quot;</code> on raw
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">&lt;tr&gt;</code>.
            Deeper hover bg + cursor + left accent bar (drawn via inset shadow, no layout shift).
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow
                interactive
                onClick={() => toast.success("Opened: BalkAr s.r.o.")}
              >
                <TableCell className="font-medium">BalkAr s.r.o.</TableCell>
                <TableCell>
                  <span className="rounded-full bg-info-bg border border-info-border px-2 py-0.5 text-xs">
                    sent
                  </span>
                </TableCell>
                <TableCell>$299</TableCell>
                <TableCell>2026-05-18</TableCell>
              </TableRow>
              <TableRow
                interactive
                onClick={() => toast.success("Opened: Acme Construction")}
              >
                <TableCell className="font-medium">Acme Construction</TableCell>
                <TableCell>
                  <span className="rounded-full bg-success-bg border border-success-border px-2 py-0.5 text-xs">
                    paid
                  </span>
                </TableCell>
                <TableCell>$349</TableCell>
                <TableCell>2026-05-15</TableCell>
              </TableRow>
              <TableRow
                interactive
                onClick={() => toast.success("Opened: Lux Garden")}
              >
                <TableCell className="font-medium">Lux Garden</TableCell>
                <TableCell>
                  <span className="rounded-full bg-warning-bg border border-warning-border px-2 py-0.5 text-xs">
                    revision
                  </span>
                </TableCell>
                <TableCell>$249</TableCell>
                <TableCell>2026-05-12</TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="font-medium text-muted-foreground">
                  Without interactive prop (static row)
                </TableCell>
                <TableCell colSpan={3} className="text-muted-foreground text-xs">
                  Does not react to hover, no accent bar.
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Interactive cards */}
      <Card>
        <CardHeader>
          <CardTitle>Interactive cards (&lt;Card interactive&gt;)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Opt-in via the <code className="rounded bg-muted px-1 py-0.5 text-[11px]">interactive</code> prop.
            Subtle lift + shadow + cursor on hover. Existing static cards are untouched.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card
              interactive
              onClick={() => toast.success("You clicked card 1")}
            >
              <CardHeader>
                <CardTitle className="text-base">Proposals</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">24</p>
                <p className="text-xs text-muted-foreground mt-1">
                  awaiting approval
                </p>
              </CardContent>
            </Card>

            <Card
              interactive
              onClick={() => toast.info("You clicked card 2")}
            >
              <CardHeader>
                <CardTitle className="text-base">Clients</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">142</p>
                <p className="text-xs text-muted-foreground mt-1">
                  active
                </p>
              </CardContent>
            </Card>

            <Card
              interactive
              onClick={() => toast.warning("You clicked card 3")}
            >
              <CardHeader>
                <CardTitle className="text-base">Domain requests</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">7</p>
                <p className="text-xs text-muted-foreground mt-1">
                  pending
                </p>
              </CardContent>
            </Card>
          </div>

          <p className="mt-4 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            For comparison: static card
          </p>
          <div className="mt-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Without interactive prop</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Does not react to hover, looks the same as before.
                </p>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Regular Dialog modals */}
      <Card>
        <CardHeader>
          <CardTitle>Dialog modals (&lt;Dialog&gt;)</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            Same bouncy spring + backdrop blur as AlertDialog. All 25+ existing
            Dialog call-sites get this automatically.
          </p>
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="transition-transform hover:scale-105 active:scale-95"
                >
                  Simple dialog
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit contact</DialogTitle>
                  <DialogDescription>
                    Fill in the details and click save.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="demo-name">Name</Label>
                    <Input id="demo-name" defaultValue="[Your Name]" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="demo-email">Email</Label>
                    <Input id="demo-email" defaultValue="name@youragency.com" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button onClick={() => toast.success("Saved!")}>
                    Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="transition-transform hover:scale-105 active:scale-95"
                >
                  Long-content dialog
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Invoice details</DialogTitle>
                  <DialogDescription>
                    Preview before sending to the client.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Client</span>
                      <span className="font-medium">BalkAr s.r.o.</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-muted-foreground">Company ID</span>
                      <span className="font-medium">12345678</span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-muted-foreground">Variable symbol</span>
                      <span className="font-mono font-medium">2024031501</span>
                    </div>
                  </div>
                  <div className="rounded-lg border p-3">
                    <div className="flex justify-between font-semibold">
                      <span>Total due</span>
                      <span>$299,00</span>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline">Close</Button>
                  <Button onClick={() => toast.success("Sent to client")}>
                    Send
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Confirm dialogs */}
      <Card>
        <CardHeader>
          <CardTitle>Confirmation dialogs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { v: "default", label: "Default", icon: undefined },
                { v: "info", label: "Info", icon: undefined },
                { v: "success", label: "Success" },
                { v: "warning", label: "Warning" },
                { v: "destructive", label: "Delete (destructive)" },
              ] as const
            ).map((d) => (
              <Button
                key={d.v}
                variant={d.v === "destructive" ? "destructive" : "outline"}
                onClick={() => setConfirmVariant(d.v)}
                className="transition-transform hover:scale-105 active:scale-95"
              >
                {d.label}
              </Button>
            ))}
          </div>

          <ConfirmDialog
            open={confirmVariant !== null}
            onOpenChange={(o) => !o && setConfirmVariant(null)}
            variant={confirmVariant ?? "default"}
            icon={confirmVariant === "destructive" ? TrashIcon : undefined}
            title={
              confirmVariant === "destructive"
                ? "Delete client?"
                : confirmVariant === "warning"
                  ? "Continue without a domain?"
                  : confirmVariant === "success"
                    ? "Mark as paid?"
                    : confirmVariant === "info"
                      ? "Start synchronization?"
                      : "Confirm action"
            }
            description={
              confirmVariant === "destructive"
                ? "The client and all their websites will be permanently deleted. This action cannot be undone."
                : confirmVariant === "warning"
                  ? "Without a custom domain the website will only be available via the subdomain. Continue?"
                  : confirmVariant === "success"
                    ? "After confirmation an invoice is created and the client receives an email."
                    : confirmVariant === "info"
                      ? "Synchronization may take 30-60 seconds."
                      : "Are you sure you want to continue?"
            }
            confirmLabel={
              confirmVariant === "destructive" ? "Delete" : "Confirm"
            }
            cancelLabel="Cancel"
            onConfirm={async () => {
              await new Promise((r) => setTimeout(r, 800));
              toast.success(`Action "${confirmVariant}" confirmed`);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
