"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { SitePreview } from "@/components/dashboard/site-preview";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle as CheckCircle2, XCircle, ArrowSquareOut as ExternalLink, FileText, Image as ImageIcon, Plus, Minus, ArrowsDownUp as ArrowUpDown, ArrowRight, PencilSimple as Pencil, Eye, Checks as CheckCheck, Warning as AlertTriangle, ChatText as MessageSquare } from "@phosphor-icons/react/ssr";

interface FieldChange {
  section_id: string;
  field: string;
  item_id?: string;
  action: string;
  old_value?: string;
  new_value?: string;
  items?: Array<{ id: string; [key: string]: unknown }>;
  new_order?: string[];
  // Rich context fields
  section_label?: string;
  field_label?: string;
  repeater_key?: string;
  repeater_label?: string;
  item_title?: string;
  item_index?: number;
  old_item?: Record<string, unknown>;
  old_order?: string[];
  item_labels?: Record<string, string>;
}

// Inline change format (new Webflow-style editor)
interface InlineChange {
  id?: string;
  file_path: string;
  css_path: string;
  section?: string | null;
  field?: string | null;
  item_id?: string | null;
  action: "update_text" | "replace_image" | "add_gallery_image" | "remove_gallery_image" | "message";
  old_value: string;
  new_value: string;
  element_tag?: string;
  element_preview?: string;
  gallery_id?: string | null;
}

interface SectionInfo {
  id: string;
  type: string;
  label: string;
  fields?: Record<string, unknown>;
}

const TEXT_TRUNCATE = 80;

function TextDiff({ oldValue, newValue }: { oldValue: string; newValue: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = oldValue.length > TEXT_TRUNCATE || newValue.length > TEXT_TRUNCATE;

  return (
    <div className="space-y-1 text-[11px] mt-1">
      <div className="line-through text-muted-foreground wrap-break-word">
        {expanded || !needsExpand ? oldValue : oldValue.slice(0, TEXT_TRUNCATE) + "..."}
      </div>
      <div className="text-foreground wrap-break-word">
        {expanded || !needsExpand ? newValue : newValue.slice(0, TEXT_TRUNCATE) + "..."}
      </div>
      {needsExpand && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-[10px] text-primary hover:underline font-medium"
        >
          {expanded ? "Hide" : "Show full text"}
        </button>
      )}
    </div>
  );
}

export function ChangeRequestReviewClient({
  request: raw,
  site,
  sections,
  reviewerId,
}: {
  request: Record<string, unknown>;
  site: Record<string, unknown> | null;
  sections: Record<string, unknown>[];
  reviewerId: string;
}) {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [previewImg, setPreviewImg] = useState<string | null>(null);

  const req = raw as {
    id: string;
    site_id: string;
    user_id: string;
    status: string;
    changes: FieldChange[];
    admin_note: string | null;
    created_at: string;
    updated_at: string;
  };

  const siteName = (site?.name as string) || "Unknown site";
  const siteId = site?.id as string;
  const siteUrl = site?.site_url as string | null;
  const isPending = req.status === "pending";

  // Detect if these are inline changes (new format) vs legacy section changes
  const isInlineFormat = req.changes.length > 0 && "css_path" in req.changes[0];
  const inlineChanges = isInlineFormat ? (req.changes as unknown as InlineChange[]) : [];

  // Preview iframe ref for sending postMessages
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reviewReady, setReviewReady] = useState(false);
  // Track which page the preview is showing (for subpage changes)
  const [previewPage, setPreviewPage] = useState("index.html");
  // Get unique pages from changes
  const changePages = Array.from(new Set(inlineChanges.map((c) => c.file_path || "index.html")));

  // Listen for REVIEW_READY from the iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "REVIEW_READY") {
        setReviewReady(true);
        // Send all changes for this page to highlight them
        if (isInlineFormat && iframeRef.current?.contentWindow) {
          const pageChanges = inlineChanges.filter(
            (c) => (c.file_path || "index.html") === previewPage
          );
          iframeRef.current.contentWindow.postMessage({
            type: "HIGHLIGHT_CHANGES",
            changes: pageChanges.map((c) => ({
              cssPath: c.css_path,
              section: c.section,
              field: c.field,
              itemId: c.item_id,
            })),
          }, "*");

          // Fire pending highlight after page switch
          if (pendingHighlightRef.current) {
            const h = pendingHighlightRef.current;
            pendingHighlightRef.current = null;
            setTimeout(() => {
              iframeRef.current?.contentWindow?.postMessage({
                type: "HIGHLIGHT_ELEMENT",
                cssPath: h.css_path,
                section: h.section,
                field: h.field,
                itemId: h.item_id,
              }, "*");
            }, 400);
          }
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [isInlineFormat, inlineChanges, previewPage]);

  // Pending highlight after page switch
  const pendingHighlightRef = useRef<InlineChange | null>(null);

  // Highlight a specific change in the preview (switches page if needed)
  const highlightInPreview = useCallback((change: InlineChange) => {
    const changePage = change.file_path || "index.html";
    if (changePage !== previewPage) {
      pendingHighlightRef.current = change;
      setPreviewPage(changePage);
      setReviewReady(false);
      return;
    }
    iframeRef.current?.contentWindow?.postMessage({
      type: "HIGHLIGHT_ELEMENT",
      cssPath: change.css_path,
      section: change.section,
      field: change.field,
      itemId: change.item_id,
    }, "*");
  }, [previewPage]);

  // Map sections by ID for field change context
  const sectionMap = new Map(
    sections.map((s) => [s.id as string, s as unknown as SectionInfo]),
  );

  // Per-change selection state (for selective approval)
  const [selectedChanges, setSelectedChanges] = useState<Set<number>>(
    () => new Set(req.changes.map((_, i) => i)),
  );

  function toggleChange(index: number) {
    setSelectedChanges((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }

  function selectAll() {
    setSelectedChanges(new Set(req.changes.map((_, i) => i)));
  }

  function deselectAll() {
    setSelectedChanges(new Set());
  }

  async function handleAction(action: "approve" | "reject") {
    setProcessing(true);
    try {
      const body: Record<string, unknown> = {
        action,
        admin_note: adminNote || null,
        processed_by: reviewerId,
      };

      // If approving with selective changes, send approved indices
      if (action === "approve" && selectedChanges.size < req.changes.length) {
        body.approved_indices = Array.from(selectedChanges).sort(
          (a, b) => a - b,
        );
      }

      const res = await fetch(`/api/change-requests/${req.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseData = await res.json();
      if (!res.ok) {
        toast.error(responseData.error || "Failed to process");
        return;
      }

      // Check for conflicts in the response
      if (responseData.conflicts && responseData.conflicts.length > 0) {
        toast.warning(
          `Applied ${responseData.applied || 0} changes. ${responseData.conflicts.length} conflict(s) detected — some elements were modified since the client's edit.`,
          { duration: 8000 }
        );
      } else {
        toast.success(
          action === "approve"
            ? `Approved ${selectedChanges.size} change${selectedChanges.size !== 1 ? "s" : ""}`
            : "Change request rejected (credit refunded)",
        );
      }
      router.push("/tech/queue");
      router.refresh();
      // Keep processing=true so buttons stay disabled during redirect
      // (prevents double-click while navigating away)
    } catch {
      toast.error("Network error");
      setProcessing(false);
    }
  }

  const actionConfig: Record<
    string,
    { label: string; icon: React.ReactNode; color: string }
  > = {
    update_field: {
      label: "Update Field",
      icon: <Pencil className="h-3 w-3" />,
      color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    },
    replace_image: {
      label: "Replace Image",
      icon: <ImageIcon className="h-3 w-3" />,
      color:
        "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
    },
    add_gallery_image: {
      label: "Add to Gallery",
      icon: <Plus className="h-3 w-3" />,
      color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    remove_gallery_image: {
      label: "Remove from Gallery",
      icon: <Minus className="h-3 w-3" />,
      color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    add_item: {
      label: "Add Item",
      icon: <Plus className="h-3 w-3" />,
      color:
        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
    },
    remove_item: {
      label: "Remove Item",
      icon: <Minus className="h-3 w-3" />,
      color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
    },
    reorder: {
      label: "Reorder",
      icon: <ArrowUpDown className="h-3 w-3" />,
      color:
        "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
    },
  };

  function isImageUrl(val?: string): boolean {
    if (!val) return false;
    return /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(val) ||
      val.includes("/storage/v1/object/public/");
  }

  return (
    <>
    <div className="dash-root space-y-6">
      {/* Clean page header — back affordance, icon chip, eyebrow, title +
          one-line subtitle. No gradient: this is an operational review
          screen, so a quiet header reads better than a hero band. */}
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/tech/queue")}
          className="-ml-2 h-7 px-2 text-muted-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="dash-chip mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
              <FileText className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Change request
              </p>
              <h1 className="text-2xl font-bold tracking-tight">
                Review Change Request
              </h1>
              <p className="text-sm text-muted-foreground">
                {siteName}
                <span className="mx-1.5 text-muted-foreground/50">·</span>
                <span className="font-mono text-xs">#{req.id.slice(0, 8)}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant={
                req.status === "pending"
                  ? "secondary"
                  : req.status === "approved"
                    ? "default"
                    : "destructive"
              }
              className="capitalize"
            >
              {req.status}
            </Badge>
            {siteId && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() =>
                  window.open(`/api/render/site/${siteId}`, "_blank")
                }
              >
                <ExternalLink className="h-4 w-4" />
                Preview Site
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── MESSAGE REQUEST: Simple message view ── */}
      {isInlineFormat && inlineChanges.length > 0 && inlineChanges[0].action === "message" ? (
        <div className="max-w-2xl space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                  <MessageSquare className="h-4 w-4" />
                </span>
                <CardTitle className="text-base">Client Message</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="dash-panel rounded-lg p-4">
                <p className="text-sm whitespace-pre-wrap">{inlineChanges[0].new_value}</p>
              </div>
              <div className="text-xs text-muted-foreground">
                Sent {new Date(req.created_at).toLocaleString("en-US")}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          {isPending && (
            <Card>
              <CardContent className="pt-6 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Admin note / reply (optional)</Label>
                  <Textarea
                    placeholder="Write a reply or note..."
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    rows={3}
                    className="text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1 gap-1.5"
                    onClick={() => handleAction("approve")}
                    disabled={processing}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark as Done
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 gap-1.5"
                    onClick={() => handleAction("reject")}
                    disabled={processing}
                  >
                    <XCircle className="h-4 w-4" />
                    Reject (Refund)
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : isInlineFormat && siteUrl ? (
        <div className="flex flex-col gap-4 lg:flex-row" style={{ minHeight: "calc(100vh - 200px)" }}>
          {/* Left: Full website preview */}
          <div className="dash-card flex flex-1 flex-col overflow-hidden p-0">
            {/* Page tabs — show when changes span multiple pages */}
            {changePages.length > 1 && (
              <div className="dash-subhead flex shrink-0 items-center gap-1.5 border-b px-3 py-2 dash-hairline">
                <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Page
                </span>
                {changePages.map((page) => (
                  <button
                    key={page}
                    onClick={() => { setPreviewPage(page); setReviewReady(false); }}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      previewPage === page
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {page === "index.html" ? "Domov" : page.replace(".html", "")}
                  </button>
                ))}
              </div>
            )}
            <div className="min-h-[60vh] flex-1 overflow-hidden lg:min-h-0">
              <SitePreview
                siteId={siteId}
                siteUrl={siteUrl}
                pagePath={previewPage === "index.html" ? undefined : previewPage}
                mode="review"
                iframeRef={iframeRef}
              />
            </div>
          </div>

          {/* Right: Changes list + actions */}
          <div className="flex w-full shrink-0 flex-col gap-3 lg:w-80">
            {/* Action buttons */}
            {isPending && (
              <Card>
                <CardContent className="space-y-2.5 p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Review
                    </span>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">
                      {selectedChanges.size}/{req.changes.length} selected
                    </span>
                  </div>
                  <Button
                    onClick={() => handleAction("approve")}
                    disabled={processing || selectedChanges.size === 0}
                    className="h-9 w-full gap-1.5 text-sm"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {processing ? "Processing..." : `Approve ${selectedChanges.size}`}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleAction("reject")}
                    disabled={processing}
                    className="h-9 w-full gap-1.5 text-sm"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Reject (Refund)
                  </Button>
                  <Textarea
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Admin note (optional)..."
                    rows={2}
                    className="text-xs"
                  />
                </CardContent>
              </Card>
            )}

            {/* Changes list */}
            <div className="flex items-center justify-between px-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Changes
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {inlineChanges.length}
              </span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto lg:max-h-[calc(100vh-240px)]">
              {inlineChanges.map((change, i) => {
                const isSelected = selectedChanges.has(i);
                const isText = change.action === "update_text";

                return (
                  <div
                    key={change.id || i}
                    className={`dash-card cursor-pointer p-3 ${
                      isPending && !isSelected ? "opacity-40" : ""
                    } ${
                      isPending && isSelected
                        ? "border-(--dash-accent)/40"
                        : ""
                    }`}
                    onMouseEnter={() => highlightInPreview(change)}
                    onClick={() => {
                      if (isPending) toggleChange(i);
                      highlightInPreview(change);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      {isPending && (
                        <Checkbox checked={isSelected} onCheckedChange={() => toggleChange(i)} className="mt-0.5" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span
                            className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
                              isText ? "dash-chip" : "dash-chip-pink"
                            }`}
                          >
                            {isText
                              ? <Pencil className="h-3 w-3" />
                              : <ImageIcon className="h-3 w-3" />
                            }
                          </span>
                          <span className="truncate text-xs font-medium">
                            {change.element_preview || change.field || change.element_tag || "Element"}
                          </span>
                          {change.file_path !== "index.html" && (
                            <Badge variant="outline" className="px-1 py-0 text-[9px]">{change.file_path.replace(".html", "")}</Badge>
                          )}
                        </div>
                        {isText && (
                          <TextDiff oldValue={change.old_value} newValue={change.new_value} />
                        )}
                        {!isText && (change.old_value || change.new_value) && (
                          <div className="mt-1.5 flex items-center gap-2">
                            {change.old_value && (
                              <button onClick={(e) => { e.stopPropagation(); setPreviewImg(change.old_value); }} className="min-w-0 flex-1 text-left">
                                <div className="mb-0.5 text-[9px] font-medium text-muted-foreground">Original</div>
                                <div className="h-16 overflow-hidden rounded-md border bg-secondary transition-all hover:ring-2 hover:ring-(--dash-accent)/40">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={change.old_value} alt="Old" className="h-full w-full object-cover" />
                                </div>
                              </button>
                            )}
                            <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                            {change.new_value && (
                              <button onClick={(e) => { e.stopPropagation(); setPreviewImg(change.new_value); }} className="min-w-0 flex-1 text-left">
                                <div className="mb-0.5 text-[9px] font-medium text-(--dash-accent-2)">New</div>
                                <div className="h-16 overflow-hidden rounded-md border bg-secondary transition-all hover:ring-2 hover:ring-(--dash-accent-2)/40">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={change.new_value} alt="New" className="h-full w-full object-cover" />
                                </div>
                              </button>
                            )}
                          </div>
                        )}
                        {!isText && !change.old_value && !change.new_value && (
                          <div className="text-[11px] text-muted-foreground">Image replaced</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── LEGACY CHANGES: Card grid layout ── */}
      {(!isInlineFormat || !siteUrl) && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Changes list (2/3 width) */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2.5 text-base">
                  <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <FileText className="h-4 w-4" />
                  </span>
                  Requested Changes ({req.changes.length})
                </CardTitle>
                {isPending && req.changes.length > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={selectAll}
                    >
                      <CheckCheck className="h-3 w-3" />
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={deselectAll}
                    >
                      Deselect All
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {req.changes.length > 0 ? (
                <div className="space-y-3">
                  {isInlineFormat ? (
                    /* ── Inline changes (new format) ── */
                    inlineChanges.map((change, i) => {
                      const isSelected = selectedChanges.has(i);
                      const isText = change.action === "update_text";
                      const config = isText
                        ? { label: "Text Change", icon: <Pencil className="h-3 w-3" />, color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" }
                        : { label: "Image Replace", icon: <ImageIcon className="h-3 w-3" />, color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" };

                      return (
                        <div
                          key={change.id || i}
                          className={`dash-card cursor-pointer space-y-3 p-4 ${
                            isPending && !isSelected ? "opacity-50" : ""
                          }`}
                          onMouseEnter={() => highlightInPreview(change)}
                        >
                          <div className="flex items-start gap-3">
                            {isPending && (
                              <Checkbox checked={isSelected} onCheckedChange={() => toggleChange(i)} className="mt-0.5" />
                            )}
                            <div className="flex-1 space-y-2">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}>
                                  {config.icon} {config.label}
                                </span>
                                <span className="text-sm font-medium">
                                  {change.element_preview || change.field || change.section || change.element_tag || "Element"}
                                </span>
                                {change.file_path !== "index.html" && (
                                  <Badge variant="outline" className="text-[10px]">{change.file_path}</Badge>
                                )}
                              </div>

                              {/* Visual diff */}
                              {isText ? (
                                <TextDiff oldValue={change.old_value} newValue={change.new_value} />
                              ) : (
                                <div className="flex items-center gap-3">
                                  {change.old_value && (
                                    <div className="space-y-1">
                                      <span className="text-[10px] font-medium text-red-500 uppercase">Old</span>
                                      <div className="w-24 h-24 rounded-md border border-red-200 dark:border-red-800 overflow-hidden bg-secondary">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={change.old_value} alt="Old" className="w-full h-full object-cover" />
                                      </div>
                                    </div>
                                  )}
                                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                                  {change.new_value && (
                                    <div className="space-y-1">
                                      <span className="text-[10px] font-medium text-green-500 uppercase">New</span>
                                      <div className="w-24 h-24 rounded-md border border-green-200 dark:border-green-800 overflow-hidden bg-secondary">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={change.new_value} alt="New" className="w-full h-full object-cover" />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    /* ── Legacy section changes ── */
                    req.changes.map((change, i) => {
                    const section = sectionMap.get(change.section_id);
                    const config = actionConfig[change.action] || {
                      label: change.action,
                      icon: <FileText className="h-3 w-3" />,
                      color: "bg-gray-100 text-gray-700",
                    };
                    const isSelected = selectedChanges.has(i);

                    return (
                      <div
                        key={i}
                        className={`dash-card space-y-3 p-4 ${
                          isPending && !isSelected
                            ? "opacity-50"
                            : ""
                        }`}
                      >
                        {/* Change header */}
                        <div className="flex items-start gap-3">
                          {isPending && (
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleChange(i)}
                              className="mt-0.5"
                            />
                          )}
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.color}`}
                              >
                                {config.icon}
                                {config.label}
                              </span>
                              <span className="text-sm font-medium">
                                {getChangeDescription(change, section)}
                              </span>
                            </div>

                            {/* Visual diff based on action type */}
                            <ChangeVisualDiff change={change} isImageUrl={isImageUrl} />
                          </div>
                        </div>
                      </div>
                    );
                  })
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No changes listed
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Actions sidebar (1/3 width) */}
        <div className="space-y-4">
          {/* Admin action */}
          {isPending && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2.5 text-base">
                  <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <CheckCheck className="h-4 w-4" />
                  </span>
                  Review Action
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="dash-panel rounded-lg px-3 py-2 text-sm text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">
                    {selectedChanges.size}
                  </span>{" "}
                  of {req.changes.length} change
                  {req.changes.length !== 1 ? "s" : ""} selected
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="admin_note">Admin Note (optional)</Label>
                  <Textarea
                    id="admin_note"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Add a note visible to the client..."
                    rows={3}
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Button
                    onClick={() => handleAction("approve")}
                    disabled={processing || selectedChanges.size === 0}
                    className="gap-2 w-full"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {processing
                      ? "Processing..."
                      : `Approve ${selectedChanges.size === req.changes.length ? "All" : selectedChanges.size} Change${selectedChanges.size !== 1 ? "s" : ""}`}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleAction("reject")}
                    disabled={processing}
                    className="gap-2 w-full"
                  >
                    <XCircle className="h-4 w-4" />
                    {processing ? "Processing..." : "Reject (Refund Credit)"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Existing admin note (when already processed) */}
          {!isPending && req.admin_note && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2.5 text-base">
                  <span className="dash-chip inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <MessageSquare className="h-4 w-4" />
                  </span>
                  Admin Note
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="dash-panel rounded-lg p-3 text-sm">{req.admin_note}</div>
              </CardContent>
            </Card>
          )}

          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="dash-row flex items-center justify-between rounded-md px-2 py-1.5">
                <span className="text-muted-foreground">Site</span>
                <span className="font-medium">{siteName}</span>
              </div>
              <div className="dash-row flex items-center justify-between rounded-md px-2 py-1.5">
                <span className="text-muted-foreground">Changes</span>
                <span className="font-medium tabular-nums">{req.changes.length}</span>
              </div>
              <div className="dash-row flex items-center justify-between rounded-md px-2 py-1.5">
                <span className="text-muted-foreground">Submitted</span>
                <span className="font-medium tabular-nums">
                  {new Date(req.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="dash-row flex items-center justify-between rounded-md px-2 py-1.5">
                <span className="text-muted-foreground">Status</span>
                <Badge
                  variant={
                    req.status === "pending"
                      ? "secondary"
                      : req.status === "approved"
                        ? "default"
                        : "destructive"
                  }
                  className="text-xs capitalize"
                >
                  {req.status}
                </Badge>
              </div>
              {siteId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 w-full gap-2"
                  onClick={() =>
                    window.open(`/api/render/site/${siteId}`, "_blank")
                  }
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview Current Site
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      )}
    </div>

    {/* Image preview lightbox */}
    {previewImg && (
      <div
        className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/70 backdrop-blur-sm"
        onClick={() => setPreviewImg(null)}
      >
        <div className="relative max-h-[80vh] max-w-[80vw]">
          <button
            onClick={() => setPreviewImg(null)}
            className="absolute -right-3 -top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card hover:bg-secondary"
          >
            <XCircle className="w-4 h-4" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewImg}
            alt="Preview"
            className="max-w-full max-h-[80vh] rounded-lg shadow-2xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </div>
    )}
    </>
  );
}

/* ───────── Human-Readable Change Description ───────── */

function getChangeDescription(
  change: FieldChange,
  section?: SectionInfo,
): React.ReactNode {
  const parts: string[] = [];

  // Section name
  parts.push(
    change.section_label ||
      section?.label ||
      section?.type ||
      `Section ${change.section_id.slice(0, 8)}`,
  );

  // Repeater name (e.g., "Menu Links", "Images", "Social Links")
  if (change.repeater_label) {
    parts.push(change.repeater_label);
  }

  // Item identification
  if (change.item_title) {
    parts.push(`'${change.item_title}'`);
  } else if (change.item_id && change.action !== "remove_item" && change.action !== "reorder") {
    parts.push(`Item ${change.item_id.slice(0, 8)}`);
  }

  // Field name (for update_field / replace_image within repeater items)
  if (
    (change.action === "update_field" || change.action === "replace_image") &&
    change.field_label &&
    change.repeater_key
  ) {
    parts.push(change.field_label);
  } else if (
    (change.action === "update_field" || change.action === "replace_image") &&
    !change.repeater_key
  ) {
    parts.push(change.field_label || change.field.replace(/_/g, " "));
  }

  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && (
            <span className="text-muted-foreground mx-1">&rarr;</span>
          )}
          <span className={i === 0 ? "" : "text-muted-foreground font-normal"}>
            {part}
          </span>
        </span>
      ))}
    </>
  );
}

/* ───────── Visual Diff Component ───────── */

function ChangeVisualDiff({
  change,
  isImageUrl,
}: {
  change: FieldChange;
  isImageUrl: (val?: string) => boolean;
}) {
  switch (change.action) {
    case "add_gallery_image": {
      return (
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-emerald-500 uppercase">New photo</span>
            <div className="w-24 h-24 rounded-md border border-emerald-200 dark:border-emerald-800 overflow-hidden bg-secondary">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={change.new_value} alt="New gallery photo" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      );
    }
    case "remove_gallery_image": {
      return (
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-red-500 uppercase">Remove</span>
            <div className="w-24 h-24 rounded-md border border-red-200 dark:border-red-800 overflow-hidden bg-secondary opacity-60">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={change.old_value} alt="Photo to remove" className="w-full h-full object-cover" />
            </div>
          </div>
        </div>
      );
    }
    case "update_field":
    case "replace_image": {
      const showOldImage = isImageUrl(change.old_value);
      const showNewImage = isImageUrl(change.new_value);

      return (
        <div className="space-y-2">
          {/* Image previews */}
          {(showOldImage || showNewImage) && (
            <div className="flex items-center gap-3">
              {showOldImage && change.old_value && (
                <div className="space-y-1">
                  <span className="text-[10px] font-medium text-red-500 uppercase">
                    Old
                  </span>
                  <div className="w-24 h-24 rounded-md border border-red-200 dark:border-red-800 overflow-hidden bg-secondary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={change.old_value}
                      alt="Old"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
              {showOldImage && showNewImage && (
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              {showNewImage && change.new_value && (
                <div className="space-y-1">
                  <span className="text-[10px] font-medium text-green-500 uppercase">
                    New
                  </span>
                  <div className="w-24 h-24 rounded-md border border-green-200 dark:border-green-800 overflow-hidden bg-secondary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={change.new_value}
                      alt="New"
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Text diff */}
          {!showOldImage && !showNewImage && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
              {change.old_value && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-medium text-red-500 uppercase shrink-0 mt-0.5 w-7">
                    Old
                  </span>
                  <span className="line-through text-muted-foreground">
                    {change.old_value.length > 300
                      ? change.old_value.slice(0, 300) + "..."
                      : change.old_value}
                  </span>
                </div>
              )}
              {change.new_value && (
                <div className="flex items-start gap-2">
                  <span className="text-[10px] font-medium text-green-500 uppercase shrink-0 mt-0.5 w-7">
                    New
                  </span>
                  <span className="font-medium text-foreground">
                    {change.new_value.length > 300
                      ? change.new_value.slice(0, 300) + "..."
                      : change.new_value}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Image URL for reference */}
          {(showOldImage || showNewImage) && change.new_value && (
            <p
              className="text-[10px] text-muted-foreground truncate cursor-pointer hover:text-foreground"
              onClick={() => navigator.clipboard.writeText(change.new_value!)}
              title="Click to copy URL"
            >
              {change.new_value}
            </p>
          )}
        </div>
      );
    }

    case "add_item": {
      if (!change.items || change.items.length === 0) {
        return (
          <p className="text-xs text-muted-foreground">New item(s) to add</p>
        );
      }

      return (
        <div className="space-y-2">
          {change.items.map((item, idx) => {
            const fields = Object.entries(item).filter(
              ([key]) =>
                key !== "id" &&
                key !== "_pendingFile" &&
                key !== "_uploading",
            );

            return (
              <div
                key={item.id || idx}
                className="rounded-md border border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10 p-3"
              >
                <div className="space-y-1.5">
                  {fields.map(([key, val]) => {
                    if (!val && val !== 0) return null;
                    const strVal = String(val);
                    if (!strVal) return null;

                    return (
                      <div key={key} className="flex items-start gap-2 text-xs">
                        <span className="text-muted-foreground font-medium capitalize shrink-0 min-w-[60px]">
                          {key.replace(/_/g, " ")}:
                        </span>
                        {isImageUrl(strVal) ? (
                          <div className="w-16 h-16 rounded border overflow-hidden">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={strVal}
                              alt={key}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        ) : (
                          <span className="text-foreground">
                            {strVal}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    case "remove_item": {
      const oldItem = change.old_item;

      // Show full item data if available
      if (oldItem && Object.keys(oldItem).length > 0) {
        const fields = Object.entries(oldItem).filter(
          ([key]) =>
            key !== "id" &&
            key !== "_pendingFile" &&
            key !== "_uploading",
        );

        return (
          <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-3">
            <p className="text-[10px] font-medium text-red-500 uppercase mb-2">
              Removed{change.item_title ? `: "${change.item_title}"` : ""}
            </p>
            <div className="space-y-1.5">
              {fields.map(([key, val]) => {
                if (!val && val !== 0) return null;
                const strVal = String(val);
                if (!strVal) return null;

                return (
                  <div key={key} className="flex items-start gap-2 text-xs">
                    <span className="text-red-400 font-medium capitalize shrink-0 min-w-[60px]">
                      {key.replace(/_/g, " ")}:
                    </span>
                    {isImageUrl(strVal) ? (
                      <div className="w-16 h-16 rounded border border-red-200 dark:border-red-800 overflow-hidden opacity-60">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={strVal}
                          alt={key}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <span className="text-red-600 dark:text-red-400 line-through">
                        {strVal}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      // Fallback: show item title or ID
      return (
        <div className="rounded-md border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10 p-3">
          <p className="text-xs text-red-600 dark:text-red-400">
            Remove item:{" "}
            <span className="font-medium">
              {change.item_title || change.item_id}
            </span>
          </p>
        </div>
      );
    }

    case "reorder": {
      if (!change.new_order || change.new_order.length === 0) {
        return (
          <p className="text-xs text-muted-foreground">Reorder items</p>
        );
      }

      const labels = change.item_labels || {};
      const hasOldOrder = change.old_order && change.old_order.length > 0;

      return (
        <div className="rounded-md border bg-muted/30 p-3 space-y-3">
          {hasOldOrder && (
            <div>
              <p className="text-[10px] font-medium text-red-500 uppercase mb-1.5">
                Previous Order
              </p>
              <div className="flex flex-wrap gap-1.5">
                {change.old_order!.map((id, idx) => (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs"
                  >
                    <span className="text-red-400">{idx + 1}.</span>
                    <span className="text-red-600 dark:text-red-400">
                      {labels[id] || id.slice(0, 8)}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-medium text-green-500 uppercase mb-1.5">
              New Order
            </p>
            <div className="flex flex-wrap gap-1.5">
              {change.new_order.map((id, idx) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-xs"
                >
                  <span className="text-green-400">{idx + 1}.</span>
                  <span className="text-green-600 dark:text-green-400">
                    {labels[id] || id.slice(0, 8)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    }

    default:
      return (
        <p className="text-xs text-muted-foreground">
          Unknown action: {change.action}
        </p>
      );
  }
}
