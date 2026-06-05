"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadSimple as Upload, CircleNotch as Loader2 } from "@phosphor-icons/react/ssr";
import { toast } from "sonner";

const CATEGORIES = [
  "nav",
  "hero",
  "about",
  "services",
  "gallery",
  "reviews",
  "faq",
  "cta",
  "contact",
  "footer",
  "map",
];

export function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [uploading, setUploading] = useState(false);

  function reset() {
    setFile(null);
    setThumbnail(null);
    setCategory("");
    setName("");
    setTags("");
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error("Pick an HTML file first");
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (thumbnail) form.append("thumbnail", thumbnail);
      if (category) form.append("category", category);
      if (name) form.append("name", name);
      if (tags) form.append("tags", tags);

      const res = await fetch("/api/section-templates", {
        method: "POST",
        body: form,
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Upload failed");
        return;
      }

      const verb = data.replaced ? "Replaced" : "Uploaded";
      const fieldText =
        typeof data.field_count === "number"
          ? ` — ${data.field_count} editable field${data.field_count === 1 ? "" : "s"}`
          : "";
      toast.success(
        `${verb} ${data.template.category}/${data.template.name}${fieldText}`,
      );

      // Surface non-fatal warnings (e.g., no data-field detected)
      if (Array.isArray(data.warnings)) {
        for (const w of data.warnings as string[]) {
          toast.warning(w, { duration: 8000 });
        }
      }

      reset();
      router.refresh();
    } catch {
      toast.error("Network error");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form
      onSubmit={handleUpload}
      className="rounded-lg border bg-card p-4 space-y-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Upload className="h-4 w-4" />
        Upload section template
      </div>

      <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
        <p>
          <strong className="text-foreground">Convention required:</strong> every editable element needs a{" "}
          <code className="text-foreground">data-field=&quot;...&quot;</code> attribute. The parser uses these to build the placeholder schema.
        </p>
        <p>
          <strong className="text-foreground">Category detection:</strong> wrap your section in{" "}
          <code className="text-foreground">{`<!-- SECTION:hero:start -->`}</code> ... <code className="text-foreground">{`<!-- SECTION:hero:end -->`}</code> markers, or pick the category manually below.
        </p>
        <p>
          <strong className="text-foreground">Image fields:</strong> work on{" "}
          <code className="text-foreground">&lt;img&gt;</code> (uses src) or any element with{" "}
          <code className="text-foreground">style=&quot;background-image: url(…)&quot;</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-3 space-y-1.5">
          <Label htmlFor="tpl-file" className="text-xs">
            HTML file *
          </Label>
          <Input
            id="tpl-file"
            type="file"
            accept=".html,.htm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          <p className="text-[11px] text-muted-foreground">
            Either a full preview file with <code>{`<!-- SECTION:<cat>:start -->`}</code>{" "}
            markers, or just the section HTML fragment.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="auto-detect" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tpl-name" className="text-xs">
            Name
          </Label>
          <Input
            id="tpl-name"
            placeholder="auto from filename"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tpl-tags" className="text-xs">
            Tags (comma-separated)
          </Label>
          <Input
            id="tpl-tags"
            placeholder="dark, minimal, single-column"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div className="md:col-span-3 space-y-1.5">
          <Label htmlFor="tpl-thumb" className="text-xs">
            Thumbnail image (optional)
          </Label>
          <Input
            id="tpl-thumb"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => setThumbnail(e.target.files?.[0] ?? null)}
          />
          <p className="text-[11px] text-muted-foreground">
            PNG/JPG/WebP. Re-uploading replaces the old thumbnail (old file gets deleted from storage).
            <br />
            Suggested dimensions: <strong>nav</strong> 1200×100, <strong>footer</strong> 1200×200,{" "}
            <strong>hero/about/services/etc.</strong> 1200×675 (16:9).
          </p>
        </div>
      </div>

      <div className="flex items-center justify-end pt-1">
        <Button
          type="submit"
          disabled={uploading || !file}
          size="sm"
          className="gap-2"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Upload
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
