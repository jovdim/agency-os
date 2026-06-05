"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { CheckCircle as CircleCheckIcon, Info as InfoIcon, WarningOctagon as OctagonXIcon, Warning as TriangleAlertIcon, X as XIcon } from "@phosphor-icons/react/ssr";
import type { Icon as LucideIcon } from "@phosphor-icons/react";import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative w-full overflow-hidden rounded-xl border px-4 py-3.5 text-sm shadow-sm transition-colors [&>svg]:pointer-events-none [&>svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-card text-card-foreground border-border",
        success:
          "border-success-border bg-success-bg text-foreground",
        info:
          "border-info-border bg-info-bg text-foreground",
        warning:
          "border-warning-border bg-warning-bg text-foreground",
        destructive:
          "border-destructive-border bg-destructive-bg text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const iconWrapperVariants = cva(
  "flex size-9 shrink-0 items-center justify-center rounded-lg",
  {
    variants: {
      variant: {
        default: "bg-muted text-foreground",
        success: "bg-success/15 text-success",
        info: "bg-info/15 text-info",
        warning: "bg-warning/15 text-warning",
        destructive: "bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

const iconAnimationByVariant: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  string
> = {
  default: "sk-animate-icon-pop",
  success: "sk-animate-check-pop",
  info: "sk-animate-icon-pop",
  warning: "sk-animate-wiggle",
  destructive: "sk-animate-shake",
}

const defaultIconByVariant: Record<
  NonNullable<VariantProps<typeof alertVariants>["variant"]>,
  LucideIcon
> = {
  default: InfoIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  destructive: OctagonXIcon,
}

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  icon?: LucideIcon | null
  onDismiss?: () => void
  animate?: boolean
}

function Alert({
  className,
  variant = "default",
  icon,
  onDismiss,
  animate = true,
  children,
  ...props
}: AlertProps) {
  const resolvedVariant = variant ?? "default"
  const Icon =
    icon === null ? null : (icon ?? defaultIconByVariant[resolvedVariant])
  const iconAnim = iconAnimationByVariant[resolvedVariant]

  return (
    <div
      data-slot="alert"
      data-variant={resolvedVariant}
      role={resolvedVariant === "destructive" ? "alert" : "status"}
      className={cn(
        alertVariants({ variant: resolvedVariant }),
        animate && "sk-animate-spring-in",
        "flex gap-3",
        className
      )}
      {...props}
    >
      {Icon && (
        <div className={cn(iconWrapperVariants({ variant: resolvedVariant }))}>
          <Icon className={cn("size-4.5", animate && iconAnim)} strokeWidth={2.5} />
        </div>
      )}

      <div className="flex-1 min-w-0 self-center">{children}</div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="ml-1 -mr-1 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-all hover:scale-110 hover:bg-accent hover:text-accent-foreground"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  )
}

function AlertTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h5
      data-slot="alert-title"
      className={cn(
        "mb-0.5 text-sm font-semibold leading-tight tracking-tight",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm leading-relaxed text-muted-foreground [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
