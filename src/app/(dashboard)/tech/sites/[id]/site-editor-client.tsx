"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  ExternalLink,
  Layers,
  Settings,
  RefreshCw,
} from "lucide-react";

interface SectionData {
  id: string;
  site_id: string;
  type: string;
  label: string;
  order: number;
  fields: Record<string, unknown>;
}

type WebsiteStatus = "queued" | "building" | "live" | "suspended";

const STATUS_OPTIONS: { value: WebsiteStatus; label: string }[] = [
  { value: "queued", label: "Queued" },
  { value: "building", label: "Building" },
  { value: "live", label: "Live" },
  { value: "suspended", label: "Suspended" },
];

export function SiteEditorClient({
  site: rawSite,
  initialSections: rawSections,
}: {
  site: Record<string, unknown>;
  initialSections: Record<string, unknown>[];
}) {
  const router = useRouter();

  const site = rawSite as {
    id: string;
    name: string;
    slug: string;
    status: WebsiteStatus;
    domain: string | null;
    site_url: string | null;
    template_id: string | null;
  };

  const [sections, setSections] = useState<SectionData[]>(
    rawSections as unknown as SectionData[],
  );
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    sections.length > 0 ? sections[0].id : null,
  );
  const [status, setStatus] = useState<WebsiteStatus>(site.status);
  const [saving, setSaving] = useState(false);
  const [savingSection, setSavingSection] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);

  const selectedSection = sections.find((s) => s.id === selectedSectionId);

  const handleStatusChange = async (newStatus: WebsiteStatus) => {
    setStatus(newStatus);
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(`Status updated to ${newStatus}`);
      } else {
        toast.error("Failed to update status");
      }
    } catch {
      toast.error("Network error");
    }
  };

  const handleFieldChange = useCallback(
    (fieldName: string, value: unknown) => {
      if (!selectedSectionId) return;
      setSections((prev) =>
        prev.map((s) =>
          s.id === selectedSectionId
            ? { ...s, fields: { ...s.fields, [fieldName]: value } }
            : s,
        ),
      );
    },
    [selectedSectionId],
  );

  const handleSaveSection = async () => {
    if (!selectedSection) return;
    setSavingSection(true);
    try {
      const res = await fetch(
        `/api/sites/${site.id}/sections/${selectedSection.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields: selectedSection.fields }),
        },
      );
      if (res.ok) {
        toast.success(`Section "${selectedSection.label}" saved`);
        setPreviewKey((k) => k + 1); // refresh preview
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to save section");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSavingSection(false);
    }
  };

  const handleSaveAllSections = async () => {
    setSaving(true);
    let success = 0;
    for (const section of sections) {
      try {
        const res = await fetch(
          `/api/sites/${site.id}/sections/${section.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fields: section.fields }),
          },
        );
        if (res.ok) success++;
      } catch {
        // continue
      }
    }
    setSaving(false);
    if (success === sections.length) {
      toast.success("All sections saved");
    } else {
      toast.warning(`Saved ${success}/${sections.length} sections`);
    }
    setPreviewKey((k) => k + 1);
  };

  // Render field editor based on value type
  const renderFieldEditor = (key: string, value: unknown) => {
    if (typeof value === "string") {
      const isLong = value.length > 100;
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs font-medium capitalize">
            {key.replace(/_/g, " ")}
          </Label>
          {isLong ? (
            <Textarea
              value={value}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              rows={3}
              className="text-sm"
            />
          ) : (
            <Input
              value={value}
              onChange={(e) => handleFieldChange(key, e.target.value)}
              className="text-sm"
            />
          )}
        </div>
      );
    }
    if (typeof value === "boolean") {
      return (
        <div key={key} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => handleFieldChange(key, e.target.checked)}
            className="h-4 w-4"
          />
          <Label className="text-xs font-medium capitalize">
            {key.replace(/_/g, " ")}
          </Label>
        </div>
      );
    }
    if (typeof value === "number") {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs font-medium capitalize">
            {key.replace(/_/g, " ")}
          </Label>
          <Input
            type="number"
            value={value}
            onChange={(e) =>
              handleFieldChange(key, parseFloat(e.target.value) || 0)
            }
            className="text-sm"
          />
        </div>
      );
    }
    if (Array.isArray(value)) {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs font-medium capitalize">
            {key.replace(/_/g, " ")} (JSON array)
          </Label>
          <Textarea
            value={JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try {
                handleFieldChange(key, JSON.parse(e.target.value));
              } catch {
                // keep typing
              }
            }}
            rows={4}
            className="font-mono text-xs"
          />
        </div>
      );
    }
    // Object / complex JSON
    if (typeof value === "object" && value !== null) {
      return (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs font-medium capitalize">
            {key.replace(/_/g, " ")} (JSON)
          </Label>
          <Textarea
            value={JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try {
                handleFieldChange(key, JSON.parse(e.target.value));
              } catch {
                // keep typing
              }
            }}
            rows={4}
            className="font-mono text-xs"
          />
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/tech/builds")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{site.name}</h1>
            <p className="text-sm text-muted-foreground">/{site.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={status}
            onValueChange={(v) => handleStatusChange(v as WebsiteStatus)}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {site.template_id && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() =>
                window.open(`/api/render/site/${site.id}`, "_blank")
              }
            >
              <ExternalLink className="h-4 w-4" />
              Preview
            </Button>
          )}
          <Button
            onClick={handleSaveAllSections}
            disabled={saving}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save All"}
          </Button>
        </div>
      </div>

      {/* Editor layout: sidebar + editor + preview */}
      <div className="grid grid-cols-12 gap-4" style={{ minHeight: "600px" }}>
        {/* Section sidebar */}
        <div className="col-span-3">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Sections ({sections.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="space-y-0.5 px-2 pb-2">
                {sections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => setSelectedSectionId(section.id)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                      selectedSectionId === section.id
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <div className="font-medium truncate">
                      {section.label || section.type}
                    </div>
                    <div
                      className={`text-xs ${
                        selectedSectionId === section.id
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {section.type} · #{section.order}
                    </div>
                  </button>
                ))}
                {sections.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                    No sections yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Section editor */}
        <div className="col-span-4">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  {selectedSection
                    ? selectedSection.label || selectedSection.type
                    : "Select a section"}
                </CardTitle>
                {selectedSection && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveSection}
                    disabled={savingSection}
                    className="gap-1 h-7 text-xs"
                  >
                    <Save className="h-3 w-3" />
                    {savingSection ? "..." : "Save"}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {selectedSection ? (
                <div className="space-y-3 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant="outline" className="text-xs">
                      {selectedSection.type}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {Object.keys(selectedSection.fields).length} fields
                    </span>
                  </div>
                  <Separator />
                  {Object.entries(selectedSection.fields).map(([key, value]) =>
                    renderFieldEditor(key, value),
                  )}
                  {Object.keys(selectedSection.fields).length === 0 && (
                    <p className="text-sm text-muted-foreground py-4 text-center">
                      No editable fields in this section
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  Select a section from the sidebar to edit
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live preview */}
        <div className="col-span-5">
          <Card className="h-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Live Preview</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewKey((k) => k + 1)}
                  className="h-7 w-7 p-0"
                  title="Refresh preview"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-2">
              {site.template_id ? (
                <div className="rounded border overflow-hidden bg-white relative">
                  <div
                    className="relative w-full"
                    style={{ minHeight: "500px" }}
                  >
                    <iframe
                      key={previewKey}
                      src={site.site_url || `/api/render/site/${site.id}`}
                      className="absolute top-0 left-0 border-0 bg-white"
                      style={{
                        width: "1280px",
                        height: "900px",
                        transformOrigin: "top left",
                      }}
                      title="Site preview"
                      sandbox="allow-scripts allow-same-origin"
                      ref={(el) => {
                        if (el) {
                          const container = el.parentElement;
                          if (container) {
                            const scale = container.clientWidth / 1280;
                            el.style.transform = `scale(${scale})`;
                            container.style.height = `${900 * scale}px`;
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-20 text-muted-foreground text-sm">
                  No template assigned
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
