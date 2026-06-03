"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      visibleToasts={5}
      expand
      closeButton
      icons={{
        success: <CircleCheckIcon className="size-4.5" strokeWidth={2.5} />,
        info: <InfoIcon className="size-4.5" strokeWidth={2.5} />,
        warning: <TriangleAlertIcon className="size-4.5" strokeWidth={2.5} />,
        error: <OctagonXIcon className="size-4.5" strokeWidth={2.5} />,
        loading: <Loader2Icon className="size-4.5 animate-spin" />,
      }}
      toastOptions={{
        duration: 4500,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "calc(var(--radius) + 4px)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
