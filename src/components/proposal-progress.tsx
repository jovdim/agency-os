"use client";

import { UserPlus, Hammer, Globe, Pencil, CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const STEPS = [
  { key: "contact_created", label: "Contact Created", icon: UserPlus },
  { key: "building",        label: "Tech Building",   icon: Hammer },
  { key: "website_ready",   label: "Website Ready",   icon: Globe },
  { key: "paid",            label: "Paid",            icon: CreditCard },
];

function getActiveStepIndex(status: string | null, hasProposal: boolean): number {
  if (!hasProposal || !status) return 0;
  switch (status) {
    case "draft":
    case "submitted":
    case "building":
    case "revision":
      return 1;
    case "review":
    case "sent":
    case "viewed":
    case "accepted":
      return 2;
    case "paid":
      return 3;
    default:
      return 0;
  }
}

interface ProposalProgressProps {
  status: string | null;
  hasProposal: boolean;
  compact?: boolean;
  className?: string;
}

export function ProposalProgress({
  status,
  hasProposal,
  compact = false,
  className = "",
}: ProposalProgressProps) {
  const activeIndex = getActiveStepIndex(status, hasProposal);
  const isRevision = status === "revision";
  const isTerminal = ["review", "sent", "viewed", "accepted", "paid"].includes(status ?? "");

  if (compact) {
    return (
      <TooltipProvider delayDuration={200}>
        <div className={`flex items-center gap-1 ${className}`}>
          {STEPS.map((step, i) => {
            const isDone = i < activeIndex || (i === activeIndex && isTerminal);
            const isCurrent = i === activeIndex && !isTerminal;

            return (
              <Tooltip key={step.key}>
                <TooltipTrigger asChild>
                  <div className="flex items-center">
                    <div
                      className={`h-2 w-2 rounded-full shrink-0 transition-colors ${
                        isCurrent
                          ? isRevision && step.key === "building"
                            ? "bg-yellow-500 ring-2 ring-yellow-500/30"
                            : "bg-primary ring-2 ring-primary/30"
                          : isDone
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/20"
                      }`}
                    />
                    {i < STEPS.length - 1 && (
                      <div className={`h-[1.5px] w-4 ${i < activeIndex ? "bg-emerald-500" : "bg-muted-foreground/15"}`} />
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {step.label}
                  {isRevision && step.key === "building" && " (Revision)"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-start">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const isDone = i < activeIndex || (i === activeIndex && isTerminal);
          const isCurrent = i === activeIndex && !isTerminal;
          const isRevisionStep = isRevision && step.key === "building";

          return (
            <div key={step.key} className="flex items-start flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 min-w-0">
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    isCurrent
                      ? isRevisionStep
                        ? "bg-yellow-500/15 text-yellow-600 ring-2 ring-yellow-500/30"
                        : "bg-primary/15 text-primary ring-2 ring-primary/30"
                      : isDone
                        ? "bg-emerald-500/15 text-emerald-600"
                        : "bg-muted text-muted-foreground/40"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-center">
                  <p
                    className={`text-[10px] leading-tight font-medium ${
                      isCurrent
                        ? isRevisionStep
                          ? "text-yellow-600 dark:text-yellow-400"
                          : "text-primary"
                        : isDone
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground/40"
                    }`}
                  >
                    {step.label}
                  </p>
                  {isRevisionStep && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 h-3.5 mt-0.5 text-yellow-600 border-yellow-300"
                    >
                      <Pencil className="h-2 w-2 mr-0.5" />
                      Revision
                    </Badge>
                  )}
                </div>
              </div>

              {i < STEPS.length - 1 && (
                <div
                  className={`h-[2px] flex-1 mt-4 mx-1 ${
                    i < activeIndex ? "bg-emerald-500" : "bg-muted-foreground/15"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
