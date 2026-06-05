"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GitCommit as GitCommitVertical, CircleNotch as Loader2, Phone, XCircle, Prohibit as Ban, FileText, Envelope as Mail, Receipt, MapPin, Clock, Note as StickyNote, Skull, Circle } from "@phosphor-icons/react/ssr";
import { formatDistanceToNow, format } from "date-fns";

interface LogEntry {
  id: string;
  outcome: string;
  notes: string | null;
  created_at: string;
  callback_at: string | null;
}

type IconComponent = React.ComponentType<{ className?: string }>;

const OUTCOME_META: Record<string, { label: string; Icon: IconComponent }> = {
  no_answer:      { label: "No answer",          Icon: Phone },
  not_exists:     { label: "Doesn't exist",      Icon: XCircle },
  not_interested: { label: "Not interested",     Icon: Ban },
  send_proposal:  { label: "Send proposal",      Icon: FileText },
  send_email:     { label: "Email sent",         Icon: Mail },
  send_invoice:   { label: "Invoice sent",       Icon: Receipt },
  local_market:   { label: "Local market",       Icon: MapPin },
  callback:       { label: "Call back later",    Icon: Clock },
  note:           { label: "Note",               Icon: StickyNote },
  never_contact:  { label: "Do not contact",     Icon: Skull },
};

// Measures the rendered height to know if the note actually overflows 3 lines.
// Only then show the "Show all / Collapse" toggle.
function ExpandableNote({
  id,
  text,
  expanded,
  onToggle,
}: {
  id: string;
  text: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // When in line-clamp mode, scrollHeight > clientHeight if content actually overflows.
    // Temporarily remove clamp to measure full height against the clamped height.
    const wasClamped = el.classList.contains("line-clamp-3");
    const clampedHeight = el.clientHeight;
    if (wasClamped) {
      el.classList.remove("line-clamp-3");
    }
    const fullHeight = el.scrollHeight;
    if (wasClamped) {
      el.classList.add("line-clamp-3");
    }
    setOverflows(fullHeight > clampedHeight + 1);
  }, [text, id]);

  return (
    <div className="mt-1 border-l-2 border-border pl-2 py-0.5">
      <p
        ref={ref}
        className={`text-[11px] text-foreground/80 italic whitespace-pre-wrap ${
          !expanded ? "line-clamp-3" : ""
        }`}
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={onToggle}
          className="text-[10px] text-primary hover:underline mt-0.5"
        >
          {expanded ? "Collapse" : "Show all"}
        </button>
      )}
    </div>
  );
}

export function StateHistoryPopover({
  contactId,
  companyName,
  children,
  onOpenChange,
}: {
  contactId: string;
  companyName: string;
  children: React.ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadHistory() {
    if (loaded || loading) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("call_logs")
        .select("id, outcome, notes, created_at, callback_at")
        .eq("contact_id", contactId)
        .order("created_at", { ascending: false })
        .limit(50);
      setLogs(data || []);
      setLoaded(true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        onOpenChange?.(v);
        if (v) loadHistory();
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        className="w-80 p-0 overflow-hidden"
      >
        <div className="px-4 py-3 border-b bg-muted/40">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Activity history
          </p>
          <p className="text-sm font-medium truncate mt-0.5">{companyName}</p>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              <GitCommitVertical className="h-5 w-5 mx-auto mb-2 opacity-40" />
              No history
            </div>
          ) : (
            <div className="px-4 py-3">
              <div className="relative">
                {/* Vertical connecting line */}
                <div
                  className="absolute left-1.5 top-2 bottom-2 w-px bg-border"
                  aria-hidden
                />

                <ul className="space-y-3">
                  {logs.map((log, idx) => {
                    const meta = OUTCOME_META[log.outcome] || {
                      label: log.outcome,
                      Icon: Circle,
                    };
                    const OutcomeIcon = meta.Icon;
                    const d = new Date(log.created_at);
                    const relative = formatDistanceToNow(d, {
                      addSuffix: true,
                    });
                    const exact = format(d, "d.M.yyyy HH:mm");
                    const isLatest = idx === 0;

                    return (
                      <li key={log.id} className="relative pl-4">
                        {/* Dot — minimal: filled for latest, outlined for older */}
                        <span
                          className={`absolute left-0.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${
                            isLatest
                              ? "bg-foreground"
                              : "bg-muted-foreground/30"
                          }`}
                          aria-hidden
                        />


                        <div className="space-y-0.5">
                          <p className="text-xs font-medium flex items-center gap-1.5">
                            <OutcomeIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                            {meta.label}
                          </p>
                          <p className="text-[11px] text-muted-foreground" title={exact}>
                            {relative} · {exact}
                          </p>
                          {log.notes && (
                            <ExpandableNote
                              id={log.id}
                              text={log.notes}
                              expanded={expandedIds.has(log.id)}
                              onToggle={() => toggleExpanded(log.id)}
                            />
                          )}
                          {log.callback_at && (
                            <p className="text-[10px] text-muted-foreground italic">
                              Callback: {format(new Date(log.callback_at), "d.M.yyyy")}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
