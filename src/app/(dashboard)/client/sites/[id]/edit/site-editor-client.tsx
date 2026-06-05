"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { toast } from "sonner";
import { SitePreview } from "@/components/dashboard/site-preview";
import { FloatingToolbar } from "./floating-toolbar";
import { ChangesPanel, type InlineChange } from "./changes-panel";
import { PageSidebar, type PageInfo } from "./page-sidebar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaperPlaneTilt as Send, FloppyDisk as Save, Coins, List as Menu, FileText, CheckCircle as CheckCircle2, Clock, StackSimple as Layers, House as Home, ChatText as MessageSquare, ArrowSquareOut as ExternalLink } from "@phosphor-icons/react/ssr";

interface ProposalInfo {
  company_name: string;
  town: string | null;
  contact_person: string | null;
  base_price: number | null;
  discount_price: number | null;
  discount_expires_at: string | null;
  status: string;
  variable_symbol: string | null;
  iban: string | null;
  qr_image_url: string | null;
}

interface SiteEditorClientProps {
  site: {
    id: string;
    name: string;
    slug: string;
    domain: string | null;
    site_url: string | null;
    status: string;
    is_paid: boolean;
  };
  creditBalance: number;
  proposal?: ProposalInfo | null;
}

interface ActiveEdit {
  section?: string | null;
  field?: string | null;
  itemId?: string | null;
  cssPath: string;
  elementTag: string;
  isImage: boolean;
  rect: { top: number; left: number; width: number; height: number; bottom: number };
}

export function SiteEditorClient({
  site,
  creditBalance: initialCredits,
  proposal,
}: SiteEditorClientProps) {
  // ── State ──
  const [pendingChanges, setPendingChanges] = useState<InlineChange[]>(() => {
    // Restore saved changes from localStorage
    try {
      const saved = localStorage.getItem(`sk-changes-${site.id}`);
      if (saved) {
        const parsed = JSON.parse(saved) as InlineChange[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [activeEdit, setActiveEdit] = useState<ActiveEdit | null>(null);
  const [showChangesPanel, setShowChangesPanel] = useState(false);
  const [activePage, setActivePage] = useState<string>("index.html");
  const [editorReady, setEditorReady] = useState(false);
  const [credits, setCredits] = useState(initialCredits);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showDraftSavedDialog, setShowDraftSavedDialog] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showPaymentBanner, setShowPaymentBanner] = useState(!site.is_paid);
  const [discoveredPages, setDiscoveredPages] = useState<PageInfo[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingChangesRef = useRef(pendingChanges);
  pendingChangesRef.current = pendingChanges;

  // ── Iframe offset for toolbar positioning ──
  const iframeOffset = useMemo(() => {
    if (!containerRef.current) return { top: 0, left: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return { top: rect.top, left: rect.left };
  }, [activeEdit]); // recalc when activeEdit changes

  // ── Scale from SitePreview (for toolbar positioning) ──
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const updateScale = () => {
      if (containerRef.current) {
        const cw = containerRef.current.offsetWidth;
        setScale(cw / Math.max(1280, cw));
      }
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // ── Page path for preview ──
  const previewPagePath = useMemo(() => {
    if (activePage === "index.html") return undefined;
    return activePage;
  }, [activePage]);

  // ── PostMessage Handler ──
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { data } = event;
      if (!data?.type) return;

      switch (data.type) {
        case "EDITOR_READY":
          setEditorReady(true);
          // Re-apply pending changes for this page (after navigating back)
          setTimeout(() => {
            const pageChanges = pendingChangesRef.current.filter(
              (c) => c.file_path === activePage
            );
            for (const change of pageChanges) {
              iframeRef.current?.contentWindow?.postMessage(
                {
                  type: "APPLY_CHANGE",
                  field: change.field,
                  itemId: change.item_id,
                  cssPath: change.css_path,
                  value: change.new_value,
                  isImage: change.action === "replace_image",
                },
                "*"
              );
            }
            // Highlight element if page was switched for this purpose
            if (pendingHighlightRef.current) {
              const h = pendingHighlightRef.current;
              pendingHighlightRef.current = null;
              setTimeout(() => {
                iframeRef.current?.contentWindow?.postMessage(
                  {
                    type: "HIGHLIGHT_ELEMENT",
                    section: h.section,
                    field: h.field,
                    itemId: h.item_id,
                    cssPath: h.css_path,
                  },
                  "*"
                );
              }, 200);
            }
          }, 300);
          break;

        case "TEXT_EDIT_START":
          setActiveEdit({
            section: data.section,
            field: data.field,
            itemId: data.itemId,
            cssPath: data.cssPath,
            elementTag: data.elementTag || "SPAN",
            isImage: false,
            rect: data.rect || { top: 0, left: 0, width: 100, height: 30, bottom: 30 },
          });
          break;

        case "TEXT_EDIT_COMPLETE": {
          if (data.oldValue !== data.newValue) {
            const change: InlineChange = {
              id: `change_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              file_path: activePage,
              css_path: data.cssPath || "",
              section: data.section || null,
              field: data.field || null,
              item_id: data.itemId || null,
              action: "update_text",
              old_value: data.oldValue || "",
              new_value: data.newValue || "",
              element_tag: data.elementTag || "SPAN",
              element_preview: buildPreview(data),
              timestamp: Date.now(),
            };

            setPendingChanges((prev) => {
              // Replace if same element was already edited
              const existingIdx = prev.findIndex(
                (c) => c.css_path === change.css_path && c.file_path === change.file_path
              );
              if (existingIdx >= 0) {
                const updated = [...prev];
                // Keep original old_value from the first edit
                change.old_value = updated[existingIdx].old_value;
                updated[existingIdx] = change;
                return updated;
              }
              return [...prev, change];
            });
          }
          setActiveEdit(null);
          break;
        }

        case "TEXT_EDIT_CANCEL":
          setActiveEdit(null);
          break;

        case "IMAGE_REPLACED": {
          // Upload immediately so the URL is permanent (not blob)
          const dataUrl = data.dataUrl as string;
          const oldSrc = data.oldSrc as string;
          const changeCssPath = data.cssPath || "";

          toast.loading("Uploading image...", { id: `upload-${changeCssPath}` });

          fetch(dataUrl).then(r => r.blob()).then(async (blob) => {
            const file = new File([blob], data.fileName || "image.png", { type: data.fileType || "image/png" });

            // Upload to Supabase Storage right away
            const uploadedUrl = await uploadFile(file, site.id);

            if (!uploadedUrl) {
              toast.error("Failed to upload the image", { id: `upload-${changeCssPath}` });
              return;
            }

            toast.success("Image replaced", { id: `upload-${changeCssPath}` });

            const change: InlineChange = {
              id: `change_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              file_path: activePage,
              css_path: changeCssPath,
              section: data.section || null,
              field: data.field || null,
              item_id: data.itemId || null,
              action: "replace_image",
              old_value: oldSrc || "",
              new_value: uploadedUrl,
              element_tag: data.elementTag || "IMG",
              element_preview: data.section ? `${data.section} → image` : "Image",
              timestamp: Date.now(),
            };

            setPendingChanges((prev) => {
              const existingIdx = prev.findIndex(
                (c) => c.css_path === change.css_path && c.file_path === change.file_path
              );
              if (existingIdx >= 0) {
                const updated = [...prev];
                change.old_value = updated[existingIdx].old_value;
                updated[existingIdx] = change;
                return updated;
              }
              return [...prev, change];
            });
          });
          break;
        }

        case "GALLERY_IMAGE_REMOVE": {
          const change: InlineChange = {
            id: `change_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            file_path: activePage,
            css_path: data.cssPath || "",
            section: null,
            field: null,
            item_id: null,
            action: "remove_gallery_image",
            old_value: data.imgSrc || "",
            new_value: "",
            element_tag: "IMG",
            element_preview: `Gallery → photo removed`,
            timestamp: Date.now(),
            gallery_id: data.galleryId || null,
          };
          setPendingChanges((prev) => [...prev, change]);
          break;
        }

        case "GALLERY_IMAGE_ADD": {
          const previewChangeId = data.changeId as string;
          const dataUrl = data.dataUrl as string;
          const galleryId = (data.galleryId as string) || "";
          const galleryCssPath = (data.galleryCssPath as string) || "";
          const fileName = (data.fileName as string) || "image.png";
          const fileType = (data.fileType as string) || "image/png";

          toast.loading("Uploading image...", { id: `upload-${previewChangeId}` });

          fetch(dataUrl).then(r => r.blob()).then(async (blob) => {
            const file = new File([blob], fileName, { type: fileType });
            const uploadedUrl = await uploadFile(file, site.id);
            if (!uploadedUrl) {
              toast.error("Failed to upload the photo", { id: `upload-${previewChangeId}` });
              // Tell iframe to drop the preview
              const iframe = iframeRef.current;
              iframe?.contentWindow?.postMessage({ type: "REVERT_GALLERY_ADD", changeId: previewChangeId }, "*");
              return;
            }
            toast.success("Photo added", { id: `upload-${previewChangeId}` });

            // Swap the data-URL preview for the uploaded URL inside the iframe
            const iframe = iframeRef.current;
            iframe?.contentWindow?.postMessage({ type: "APPLY_GALLERY_ADD", changeId: previewChangeId, src: uploadedUrl }, "*");

            const change: InlineChange = {
              id: previewChangeId,
              file_path: activePage,
              css_path: galleryCssPath,
              section: null,
              field: null,
              item_id: null,
              action: "add_gallery_image",
              old_value: "",
              new_value: uploadedUrl,
              element_tag: "IMG",
              element_preview: `Gallery → new photo`,
              timestamp: Date.now(),
              gallery_id: galleryId,
            };
            setPendingChanges((prev) => [...prev, change]);
          });
          break;
        }

        case "GALLERY_ADD_REVERTED": {
          // Client removed a freshly-added image before submit
          setPendingChanges((prev) => prev.filter((c) => c.id !== data.changeId));
          break;
        }

        case "PAGES_DISCOVERED": {
          const rawPages = (data.pages || []) as PageInfo[];
          // Keep DOM order, just ensure index.html is first
          const pages = rawPages.filter((p) => p.path !== "index.html");
          const home = rawPages.find((p) => p.path === "index.html");
          pages.unshift(home || { path: "index.html", label: "Home" });
          setDiscoveredPages(pages);
          setPagesLoading(false);
          break;
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [activePage]);

  // ── Image Picker ──
  function openImagePicker(data: {
    section?: string;
    field?: string;
    itemId?: string;
    cssPath: string;
    elementTag?: string;
    currentSrc?: string;
  }) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) {
        setActiveEdit(null);
        return;
      }

      const previewUrl = URL.createObjectURL(file);

      // Store file for upload on submit
      const fileKey = `_pendingFile_${Date.now()}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      w[fileKey] = file;
      if (!w._pendingFileMap) w._pendingFileMap = {};
      w._pendingFileMap[previewUrl] = fileKey;

      // Track the change
      const change: InlineChange = {
        id: `change_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        file_path: activePage,
        css_path: data.cssPath,
        section: data.section || null,
        field: data.field || null,
        item_id: data.itemId || null,
        action: "replace_image",
        old_value: data.currentSrc || "",
        new_value: previewUrl,
        element_tag: "IMG",
        element_preview: buildPreview({ ...data, elementTag: "IMG" }),
        timestamp: Date.now(),
      };

      setPendingChanges((prev) => {
        const existingIdx = prev.findIndex(
          (c) => c.css_path === change.css_path && c.file_path === change.file_path
        );
        if (existingIdx >= 0) {
          const updated = [...prev];
          change.old_value = updated[existingIdx].old_value;
          updated[existingIdx] = change;
          return updated;
        }
        return [...prev, change];
      });

      // Send blob URL to iframe to update visually
      iframeRef.current?.contentWindow?.postMessage(
        {
          type: "UPDATE_IMAGE_SRC",
          section: data.section,
          field: data.field,
          itemId: data.itemId,
          cssPath: data.cssPath,
          src: previewUrl,
        },
        "*"
      );

      setActiveEdit(null);
    };
    input.click();
  }

  // ── Build preview text for changes panel ──
  function buildPreview(data: { section?: string; field?: string; elementTag?: string }) {
    if (data.section && data.field) return `${data.section} → ${data.field}`;
    if (data.field) return data.field;
    if (data.section) return data.section;
    return data.elementTag || "Element";
  }

  // ── Revert a change ──
  const handleRevert = useCallback(
    (changeId: string) => {
      const change = pendingChanges.find((c) => c.id === changeId);
      if (!change) return;

      const iframe = iframeRef.current?.contentWindow;
      if (change.action === "add_gallery_image") {
        iframe?.postMessage({ type: "REVERT_GALLERY_ADD", changeId: change.id }, "*");
      } else if (change.action === "remove_gallery_image") {
        iframe?.postMessage({ type: "REVERT_GALLERY_REMOVE", cssPath: change.css_path }, "*");
      } else {
        iframe?.postMessage(
          {
            type: "REVERT_FIELD",
            section: change.section,
            field: change.field,
            itemId: change.item_id,
            cssPath: change.css_path,
            value: change.old_value,
            isImage: change.action === "replace_image",
          },
          "*"
        );
      }

      // Remove from pending changes
      setPendingChanges((prev) => prev.filter((c) => c.id !== changeId));
    },
    [pendingChanges]
  );

  // ── Highlight element in iframe (switches page if needed) ──
  const pendingHighlightRef = useRef<InlineChange | null>(null);

  const handleHighlight = useCallback((change: InlineChange) => {
    const changePage = change.file_path || "index.html";
    if (changePage !== activePage) {
      // Switch page first, highlight will happen in EDITOR_READY handler
      pendingHighlightRef.current = change;
      setActivePage(changePage);
      setActiveEdit(null);
      setEditorReady(false);
      return;
    }
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "HIGHLIGHT_ELEMENT",
        section: change.section,
        field: change.field,
        itemId: change.item_id,
        cssPath: change.css_path,
      },
      "*"
    );
  }, [activePage]);

  // ── Discard all ──
  const handleDiscardAll = useCallback(() => {
    if (confirm("Discard all changes?")) {
      setPendingChanges([]);
      try { localStorage.removeItem(`sk-changes-${site.id}`); } catch {}
      // Reload iframe to reset all visual changes
      setEditorReady(false);
      const iframe = iframeRef.current;
      if (iframe) {
        // eslint-disable-next-line no-self-assign
        iframe.src = iframe.src;
      }
    }
  }, []);

  // ── Upload file helper ──
  async function uploadFile(file: File, siteId: string): Promise<string | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("bucket", "site-uploads");
      formData.append(
        "path",
        `${siteId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${file.name.split(".").pop() || "png"}`
      );
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      return data.url || null;
    } catch {
      return null;
    }
  }

  // ── Submit to IT (pending) ──
  async function handleSubmit() {
    if (pendingChanges.length === 0) return;
    setIsSubmitting(true);

    try {
      const res = await fetch("/api/change-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_id: site.id,
          changes: pendingChanges,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to submit the changes");
        return;
      }

      setPendingChanges([]);
      setShowChangesPanel(false);
      try { localStorage.removeItem(`sk-changes-${site.id}`); } catch {}

      if (data.isDraft) {
        // Unpaid client — changes saved as draft, no credit deducted.
        setShowDraftSavedDialog(true);
      } else {
        setCredits((c) => Math.max(0, c - 12.5));
        toast.success("Changes have been submitted for approval!");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Check if active edit's field has a pending change ──
  const activeEditHasChange = activeEdit
    ? pendingChanges.some(
        (c) => c.css_path === activeEdit.cssPath && c.file_path === activePage
      )
    : false;

  return (
    <>
      <div className="flex flex-col overflow-hidden" style={{ height: "100vh" }}>
        {/* ── Header ── */}
        <header className="h-11 dash-hairline border-b flex items-center justify-between px-4 shrink-0 bg-card">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-1.5 rounded-md hover:bg-secondary transition-colors"
              >
                <Menu className="w-4 h-4" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40 cursor-pointer" onClick={() => setMenuOpen(false)} />
                  <div className="absolute top-full left-0 mt-1 z-50 dash-panel rounded-xl py-1.5 min-w-[180px]">
                    <button
                      onClick={() => { window.location.href = "/client"; setMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                    >
                      <Home className="w-4 h-4 text-muted-foreground" />
                      Overview
                    </button>
                    <button
                      onClick={() => { window.location.href = "/client/messages"; setMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                    >
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                      Message us
                    </button>
                    <button
                      onClick={() => { window.location.href = "/client/requests"; setMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground" />
                      Requests
                    </button>
                    <button
                      onClick={() => { window.location.href = "/client/balance"; setMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-secondary transition-colors text-left"
                    >
                      <Coins className="w-4 h-4 text-muted-foreground" />
                      Balance
                    </button>
                  </div>
                </>
              )}
            </div>
            <h1 className="text-sm font-semibold leading-tight">{site.name}</h1>
          </div>

          <div className="flex items-center gap-3">
            {/* Balance */}
            <div className="dash-chip flex items-center gap-1.5 px-2.5 py-1 rounded-full">
              <Coins className="w-3.5 h-3.5" />
              <span className="text-sm font-medium tabular-nums">${credits.toFixed(2)}</span>
            </div>

            {/* Live site link */}
            {site.site_url && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => window.open(site.site_url!, "_blank")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Live
              </Button>
            )}

            {/* Changes badge */}
            {pendingChanges.length > 0 && (
              <button
                onClick={() => setShowChangesPanel(!showChangesPanel)}
                className="dash-chip flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium hover:brightness-105 transition-[filter]"
              >
                <Layers className="w-3.5 h-3.5" />
                <span className="tabular-nums">{pendingChanges.length}</span> {pendingChanges.length === 1 ? "change" : "changes"}
              </button>
            )}

            {/* Submit */}
            <Button
              size="sm"
              onClick={() => setShowSubmitDialog(true)}
              disabled={pendingChanges.length === 0 || isSubmitting}
              className="gap-1.5 h-8"
            >
              <Send className="w-3.5 h-3.5" />
              {isSubmitting ? "Sending..." : "Submit changes"}
            </Button>
          </div>
        </header>

        {/* ── Proposal info bar ── */}
        {proposal && (() => {
          const isPaid = site.is_paid || proposal.status === "paid";
          const basePrice = proposal.base_price ?? 299;
          const discountPrice = proposal.discount_price;
          const expiresAt = proposal.discount_expires_at ? new Date(proposal.discount_expires_at) : null;
          const discountActive = !isPaid && !!discountPrice && !!expiresAt && new Date() < expiresAt;
          const activePrice = discountActive ? discountPrice! : basePrice;
          const daysLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000)) : 0;
          const nameLine = [proposal.company_name, proposal.town].filter(Boolean).join(", ");

          return (
            <div className="shrink-0 dash-hairline border-b dash-subhead">
              <div className="px-4 py-1.5 flex items-center justify-between gap-4 text-xs">
                <span className="text-muted-foreground truncate min-w-0">
                  Proposal for: <span className="text-foreground font-medium">{nameLine}</span>
                </span>
                <div className="flex items-center gap-2 shrink-0 tabular-nums">
                  {discountActive && discountPrice && discountPrice < basePrice ? (
                    <>
                      <span className="line-through text-muted-foreground">${basePrice}</span>
                      <span className="font-semibold text-foreground">${activePrice}</span>
                    </>
                  ) : (
                    <span className="font-semibold text-foreground">${activePrice}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isPaid ? (
                    <span className="inline-flex items-center gap-1 font-medium text-(--dash-accent-2)">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Paid
                    </span>
                  ) : (
                    <>
                      {discountActive ? (
                        <span className="inline-flex items-center gap-1 text-amber-500 font-medium tabular-nums">
                          <Clock className="w-3.5 h-3.5" /> {daysLeft} {daysLeft === 1 ? "day" : "days"} left
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          <Clock className="w-3.5 h-3.5" /> Pending
                        </span>
                      )}
                      <button
                        onClick={() => setShowPaymentBanner(!showPaymentBanner)}
                        className="text-[10px] dash-accent hover:underline font-medium"
                      >
                        {showPaymentBanner ? "Hide" : "Pay"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Payment banner */}
              {!isPaid && showPaymentBanner && (
                <div className="px-4 pb-3 pt-1 dash-hairline border-t bg-muted/30">
                  <div className="flex items-start gap-6 max-w-2xl mx-auto">
                    <div className="flex-1 text-xs space-y-1.5">
                      <p className="font-medium text-sm tabular-nums">
                        Price{" "}
                        {discountActive && discountPrice && discountPrice < basePrice && (
                          <span className="line-through text-muted-foreground">${basePrice}</span>
                        )}{" "}
                        <span className="text-lg font-bold">${activePrice}</span>
                      </p>
                      <p className="text-muted-foreground">
                        Scan the QR code with your banking app or use the details below.
                      </p>
                      <div className="flex gap-4 text-[11px] text-muted-foreground mt-2">
                        <span>IBAN: <span className="text-foreground font-mono tabular-nums">{(proposal.iban || "SK1309000000005221380177").replace(/(.{4})/g, "$1 ").trim()}</span></span>
                        <span>VS: <span className="text-foreground font-mono tabular-nums">{proposal.variable_symbol || "—"}</span></span>
                      </div>
                    </div>
                    {proposal.qr_image_url && (
                      <div className="shrink-0 bg-white p-1.5 rounded-lg dash-panel">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={proposal.qr_image_url} alt="QR" width={80} height={80} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Sidebar + Preview ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Page sidebar — auto-hide for single-page sites */}
          {(discoveredPages.length > 1 || pagesLoading) && (
            <PageSidebar
              pages={discoveredPages}
              activePage={activePage}
              onPageSelect={(path) => {
                if (path === activePage) return;
                setActivePage(path);
                setActiveEdit(null);
                setEditorReady(false);
                setPagesLoading(true);
              }}
              isLoading={pagesLoading}
              pendingChanges={pendingChanges}
              collapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
            />
          )}

          {/* Preview + overlays */}
          <div ref={containerRef} className="flex-1 overflow-hidden relative">
          <SitePreview
            siteId={site.id}
            siteUrl={site.site_url || site.domain || undefined}
            pagePath={previewPagePath}
            mode="inline-edit"
            iframeRef={iframeRef}
          />

          {/* Floating toolbar near active element */}
          {activeEdit && (
            <FloatingToolbar
              section={activeEdit.section}
              field={activeEdit.field}
              elementTag={activeEdit.elementTag}
              isImage={activeEdit.isImage}
              rect={activeEdit.rect}
              scale={scale}
              iframeOffset={iframeOffset}
              canRevert={activeEditHasChange}
              onRevert={() => {
                const change = pendingChanges.find(
                  (c) => c.css_path === activeEdit.cssPath && c.file_path === activePage
                );
                if (change) handleRevert(change.id);
              }}
              onConfirm={() => {
                // Send blur to iframe to confirm the edit
                iframeRef.current?.contentWindow?.postMessage({ type: "CONFIRM_EDIT" }, "*");
              }}
              onDismiss={() => {
                // Send cancel to iframe to restore original text
                iframeRef.current?.contentWindow?.postMessage({ type: "CANCEL_EDIT" }, "*");
                setActiveEdit(null);
              }}
            />
          )}

          {/* Changes panel (slide-in from right) */}
          {(showChangesPanel || pendingChanges.length > 0) && (
            <ChangesPanel
              visible={showChangesPanel}
              changes={pendingChanges}
              onRevert={handleRevert}
              onDiscardAll={handleDiscardAll}
              onSubmit={() => setShowSubmitDialog(true)}
              onHighlight={handleHighlight}
              onClose={() => setShowChangesPanel(false)}
              credits={credits}
              isPaid={site.is_paid}
              isSubmitting={isSubmitting}
            />
          )}

          {/* Floating changes badge (bottom-right) */}
          {pendingChanges.length > 0 && !showChangesPanel && (
            <button
              onClick={() => setShowChangesPanel(true)}
              className="absolute bottom-6 right-6 z-30 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground shadow-[var(--dash-shadow)] hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              <Layers className="w-4 h-4" />
              <span className="tabular-nums">{pendingChanges.length}</span> {pendingChanges.length === 1 ? "change" : "changes"}
            </button>
          )}
        </div>
        </div>{/* close flex sidebar+preview */}
      </div>

      {/* ── Submit Confirmation Dialog ── */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              What would you like to do with your changes?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 pt-2 text-sm">
                <span className="block">
                  You have {pendingChanges.length} {pendingChanges.length === 1 ? "change" : "changes"}.
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-1">
            {/* Option 1: Submit to IT (paid) OR Save as draft (unpaid) */}
            <button
              onClick={() => {
                setShowSubmitDialog(false);
                handleSubmit();
              }}
              disabled={isSubmitting || (site.is_paid && credits < 12.5)}
              className="dash-panel w-full text-left rounded-xl p-4 transition-colors hover:border-(--dash-accent)/40 disabled:opacity-40 disabled:cursor-not-allowed group"
            >
              <div className="flex items-center gap-3">
                <div className="dash-chip w-9 h-9 rounded-lg flex items-center justify-center shrink-0">
                  <Send className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">
                    {site.is_paid ? "Submit for approval" : "Save as draft"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {site.is_paid
                      ? "Changes will go to the IT technician, costs $12.50"
                      : "No credit deducted yet, sent after payment"}
                  </div>
                </div>
              </div>
              {site.is_paid && credits < 12.5 && (
                <div className="mt-2 text-xs text-destructive font-medium flex items-center gap-1.5 pl-12 tabular-nums">
                  <Coins className="w-3 h-3" />
                  Insufficient balance (${credits.toFixed(2)})
                </div>
              )}
              {site.is_paid && credits >= 12.5 && (
                <div className="mt-1.5 text-xs text-muted-foreground pl-12 tabular-nums">
                  Balance: ${credits.toFixed(2)} → ${(credits - 12.5).toFixed(2)}
                </div>
              )}
            </button>

            {/* Option 2: Save locally */}
            <button
              onClick={() => {
                // Save to localStorage — no API call
                try {
                  localStorage.setItem(
                    `sk-changes-${site.id}`,
                    JSON.stringify(pendingChanges)
                  );
                } catch {}
                setShowSubmitDialog(false);
                toast.success("Changes have been saved");
              }}
              className="dash-hairline w-full text-left rounded-xl border p-4 transition-colors hover:bg-secondary/50 group"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center shrink-0 group-hover:bg-secondary/80 transition-colors">
                  <Save className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">Save for later</div>
                  <div className="text-xs text-muted-foreground">
                    Your changes stay saved, submit them when you're ready
                  </div>
                </div>
              </div>
            </button>
          </div>

          <DialogFooter className="pt-1">
            <Button variant="ghost" size="sm" onClick={() => setShowSubmitDialog(false)} className="w-full text-muted-foreground">
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── "Saved as draft" info dialog for unpaid clients ── */}
      <Dialog open={showDraftSavedDialog} onOpenChange={setShowDraftSavedDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="dash-chip-pink mx-auto mb-2 w-12 h-12 rounded-full flex items-center justify-center">
              <Save className="w-6 h-6" />
            </div>
            <DialogTitle className="text-center">Changes saved as a draft</DialogTitle>
            <DialogDescription className="text-center">
              Your changes are safely saved. Before we can send them to our IT team, you first need to pay for your website.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div className="dash-hairline rounded-xl border bg-muted/30 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">Payment verification:</strong> within 5 minutes of the payment reaching our account.
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <strong className="text-foreground">After payment:</strong> all your drafts are automatically sent to the IT team.
                </div>
              </div>
            </div>

            <Button onClick={() => setShowDraftSavedDialog(false)} className="w-full">
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
