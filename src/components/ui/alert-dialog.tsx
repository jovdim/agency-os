"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckCircle as CircleCheckIcon, Info as InfoIcon, WarningOctagon as OctagonXIcon, Warning as TriangleAlertIcon } from "@phosphor-icons/react/ssr";
import type { Icon as LucideIcon } from "@phosphor-icons/react";import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "@/components/ui/button"

function AlertDialog({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/60 backdrop-blur-sm",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150",
        className
      )}
      {...props}
    />
  )
}

const contentVariants = cva(
  "fixed left-[50%] top-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-5 rounded-2xl border p-6 shadow-2xl outline-none sm:max-w-md",
  {
    variants: {
      variant: {
        default: "bg-card border-border",
        success: "bg-success-bg border-success-border",
        info: "bg-info-bg border-info-border",
        warning: "bg-warning-bg border-warning-border",
        destructive: "bg-destructive-bg border-destructive-border",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

type AlertDialogVariant = NonNullable<
  VariantProps<typeof contentVariants>["variant"]
>

function AlertDialogContent({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> &
  VariantProps<typeof contentVariants>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-variant={variant}
        className={cn(
          // Animation is bound via globals.css → [data-slot="alert-dialog-content"][data-state="..."]
          contentVariants({ variant }),
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-lg font-semibold leading-tight", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants(), className)}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "outline" }), className)}
      {...props}
    />
  )
}

/* ─── Icon header used by ConfirmDialog ────────────────────────────────── */

const iconWrapperVariants = cva(
  "mx-auto flex size-14 items-center justify-center rounded-2xl ring-8 sm:mx-0",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground ring-muted/40",
        success: "bg-success/15 text-success ring-success/10",
        info: "bg-info/15 text-info ring-info/10",
        warning: "bg-warning/15 text-warning ring-warning/10",
        destructive: "bg-destructive/15 text-destructive ring-destructive/10",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

const iconAnimationByVariant: Record<AlertDialogVariant, string> = {
  default: "sk-animate-icon-pop",
  success: "sk-animate-check-pop",
  info: "sk-animate-icon-pop",
  warning: "sk-animate-wiggle",
  destructive: "sk-animate-shake",
}

const defaultIconByVariant: Record<AlertDialogVariant, LucideIcon> = {
  default: InfoIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  destructive: OctagonXIcon,
}

/* ─── ConfirmDialog — controlled, single-component confirmation ──────── */

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: AlertDialogVariant
  icon?: LucideIcon | null
  onConfirm: () => void | Promise<void>
  loading?: boolean
  children?: React.ReactNode
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  icon,
  onConfirm,
  loading = false,
  children,
}: ConfirmDialogProps) {
  const [pending, setPending] = React.useState(false)
  const Icon =
    icon === null ? null : (icon ?? defaultIconByVariant[variant])
  const iconAnim = iconAnimationByVariant[variant]

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      setPending(true)
      await onConfirm()
      onOpenChange(false)
    } finally {
      setPending(false)
    }
  }

  const isBusy = loading || pending
  const confirmVariant =
    variant === "destructive" ? "destructive" : "default"

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent variant={variant}>
        <AlertDialogHeader>
          {Icon && (
            <div className={cn(iconWrapperVariants({ variant }))}>
              <Icon className={cn("size-7", iconAnim)} strokeWidth={2.5} />
            </div>
          )}
          <AlertDialogTitle className="mt-1">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        {children && <div className="text-sm">{children}</div>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isBusy}>{cancelLabel}</AlertDialogCancel>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={isBusy}
          >
            {isBusy ? "..." : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
  ConfirmDialog,
}
