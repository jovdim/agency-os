"use client";

import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  RemoveFormatting,
  Undo,
  Redo,
} from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { sanitizeRichText, unwrapTipTapWrap } from "@/lib/templates/sanitize";

interface Props {
  /** Stored HTML (already sanitized by `sanitizeRichText`). Pass an empty
   *  string to show the placeholder. */
  value: string;
  /** Placeholder text shown when the editor is empty. Typically the
   *  template's default copy for this field. */
  fallback: string;
  /** Fires whenever the user mutates the content. The HTML passed back is
   *  already run through `sanitizeRichText` so the caller can store it
   *  directly — no second pass needed. */
  onChange: (html: string) => void;
  /** When true, strip TipTap's top-level `<p>…</p>` wrapper before
   *  emitting. Use for `text` and `longtext` fields whose template
   *  containers (h1-h6, span, p, a, li, …) can't legally hold a nested
   *  `<p>` — the stored value becomes plain inline HTML, so downstream
   *  consumers (slugify, validators, attribute stamping, search) read
   *  clean strings without needing their own HTML-strip pass. Multi-
   *  paragraph input collapses to `<br>`-joined inline runs (see
   *  unwrapTipTapWrap). LEAVE OFF for `richtext` fields where multiple
   *  paragraphs are legitimate document structure (about_body, etc.). */
  unwrap?: boolean;
}

/**
 * Rich-text editor used inside the composer's right-hand panel for every
 * `data-type="richtext"` field on every template (services descriptions,
 * about copy, hero leads, FAQ answers, etc. — ~32 templates promote
 * paragraph fields to richtext via scripts/promote-richtext-fields.mjs).
 *
 * Built on TipTap (ProseMirror).
 *
 * History note: we tried swapping to Quill 2.x in 2026-05-16 for a fuller
 * Word-style toolbar (color picker, font size, alignment). Quill's
 * full-featured toolbar emits inline `style="color:…"`, `style="font-size:…"`,
 * `style="text-align:…"` on every span/paragraph by design. Those inline
 * styles overrode the templates' carefully-designed typography in the
 * iframe preview AND the published HTML — every paragraph the user touched
 * inherited the editor's own font-size / color rather than the template's,
 * effectively breaking the design system. Reverted. If a future request
 * really wants color/size controls inside the rich text editor, the right
 * solution is per-paragraph CSS variables that the template can map to
 * its own scale — NOT raw inline styles.
 *
 * Extension set is deliberately MINIMAL — matched 1:1 to the existing
 * `sanitizeRichText` whitelist (p, br, strong, b, em, i, u, a, ul, ol,
 * li). Heading / strike / code / blockquote / horizontalRule from
 * StarterKit are explicitly DISABLED because the sanitizer strips those
 * tags on save and the user would see headings vanish from their
 * description — confusing. If you want to add headings/blockquote to the
 * richtext fields, extend the sanitizer whitelist FIRST, then re-enable
 * the extension here.
 *
 * Output is still piped through `sanitizeRichText` as a belt-and-
 * suspenders pass — TipTap shouldn't ever emit `<script>` or `on*`
 * handlers, but the consistent sanitization keeps storage clean across
 * all entry points (TipTap, paste, AI fill, JSON round-trip).
 */
export function ComposerRichTextEditor({ value, fallback, onChange, unwrap }: Props) {
  // Guard against feedback-loop re-renders. When the parent updates
  // `value` because of OUR own onUpdate, we don't want to call
  // setContent again — TipTap's setContent moves the caret, which would
  // be jarring while the user is typing. The ref tracks the last HTML
  // WE emitted; the value-sync effect skips when the prop matches.
  const lastEmittedHtml = useRef<string>("");

  const editor = useEditor({
    // Required for Next.js SSR — without this TipTap warns about
    // server-side rendering. The editor is client-only anyway (it
    // mounts inside the composer's "use client" tree).
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // Disable nodes not in the sanitizer whitelist. Without these
        // flags TipTap would happily emit `<h2>` / `<s>` / `<code>` /
        // `<blockquote>` / `<hr>` and the sanitizer would strip them on
        // save — the user sees their formatting disappear, which feels
        // broken. Re-enable only after extending sanitize.ts.
        heading: false,
        strike: false,
        code: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
        // Keep: bold, italic, paragraph, hardBreak (Shift+Enter),
        // bulletList, orderedList, listItem, history (undo/redo),
        // dropcursor, gapcursor.
      }),
      Underline,
      Link.configure({
        // Author types/pastes a URL; opening the link inside the
        // composer would navigate the WHOLE composer away. Disabled.
        openOnClick: false,
        // Match the email editor's underline-on-primary look so links
        // are visually distinct from regular text.
        HTMLAttributes: { class: "text-primary underline" },
        autolink: true,
      }),
      Placeholder.configure({
        placeholder: fallback,
        emptyEditorClass:
          // Show the placeholder via the standard TipTap pattern:
          // empty <p> gets `data-placeholder` attribute, CSS::before
          // injects the text. The classes mirror the editor's body
          // color so the hint sits at muted-foreground opacity.
          "is-editor-empty",
        // Always emit the placeholder when the editor is fully empty,
        // not just when on the first line — matches the contenteditable
        // editor's old `fallback` UX exactly.
        showOnlyWhenEditable: true,
      }),
    ],
    // Initial content. TipTap parses + validates this against the
    // configured extensions, so any stale `<h2>` from before this
    // refactor would render as plain text (no crash).
    content: value || "",
    onUpdate: ({ editor }) => {
      // Convert the editor's current state into stored HTML. TipTap
      // always wraps the document in a top-level node, so a fully
      // empty editor produces `<p></p>` — we normalize that to "" so
      // the placeholder fallback shows again and the saved value
      // matches the template's "no override" state.
      let html = editor.getHTML();
      if (html === "<p></p>") html = "";
      let clean = sanitizeRichText(html);
      // When the parent flagged this field as plain-text-shaped (text /
      // longtext), strip TipTap's <p> wrapper at SAVE time so the value
      // stored in the database is clean inline HTML. Without this, every
      // downstream consumer (slugify, publish validators, attribute
      // stampers, future search/filter UIs) has to remember to strip
      // tags or break — option 2 in the 2026-05-21 audit. Inner inline
      // marks (<strong>, <em>, <a>, etc.) survive intact. lastEmittedHtml
      // tracks the post-unwrap shape so the value-sync effect below
      // recognises our own emission and doesn't move the caret.
      if (unwrap) clean = unwrapTipTapWrap(clean);
      lastEmittedHtml.current = clean;
      onChange(clean);
    },
    editorProps: {
      attributes: {
        // `prose prose-sm dark:prose-invert` — give paragraphs proper
        // top/bottom margin (so Enter produces a visible gap) AND keep
        // text readable in dark mode (without `dark:prose-invert` the
        // prose plugin hardcodes near-black text and the user types
        // into an invisible field). `[&_p]:my-1` tightens prose's
        // default 1.25em → 0.25rem so descriptions don't take a tower
        // of vertical space inside the composer panel.
        class:
          "prose prose-sm dark:prose-invert max-w-none px-3 py-2 text-sm min-h-[5rem] max-h-80 overflow-y-auto focus:outline-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:pointer-events-none",
      },
    },
  });

  // External value sync. When the parent passes a NEW `value` prop
  // (e.g. AI fill, undo, template default reload), push it into the
  // editor — but skip the case where the value matches what we just
  // emitted, otherwise typing would constantly reset the caret.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmittedHtml.current) return;
    const currentHtml = editor.getHTML() === "<p></p>" ? "" : editor.getHTML();
    if (value === currentHtml) return;
    // `emitUpdate: false` prevents this programmatic setContent from
    // firing onUpdate → onChange, which would loop with the parent's
    // state setter and force-reset the caret on every render.
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  // Placeholder live-update — when the fallback prop changes (rare,
  // mostly when switching templates), force the Placeholder extension
  // to re-read its config. TipTap doesn't re-apply config reactively
  // by default, so a manual chain().focus().run() refresh suffices.
  useEffect(() => {
    if (!editor) return;
    // The Placeholder extension caches the placeholder string in its
    // own state. Updating extension options requires extendOptions —
    // but since the editor is recreated rarely, this branch is best-
    // effort: empty editors will pick up the new placeholder on the
    // next render via the prose decoration.
    const ext = editor.extensionManager.extensions.find(
      (e) => e.name === "placeholder",
    );
    if (ext && typeof ext.options === "object") {
      (ext.options as { placeholder?: string }).placeholder = fallback;
    }
  }, [fallback, editor]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const previousHref = editor.getAttributes("link").href as
      | string
      | undefined;
    const url = window.prompt("URL", previousHref ?? "https://");
    // Cancel keeps the existing link; explicit empty unsets it; otherwise
    // apply across the current selection (extendMarkRange grabs the
    // whole link if the user clicked anywhere on it).
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="rounded-md border bg-background overflow-hidden">
      <div className="flex flex-wrap items-center gap-0.5 px-1 py-1 border-b bg-muted/30">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          title="Underline (Ctrl+U)"
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          onClick={setLink}
          active={editor.isActive("link")}
          title="Add link"
        >
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
          title="Clear formatting"
        >
          <RemoveFormatting className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarDivider />
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
        >
          <Undo className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      // Prevent the toolbar button from stealing focus from the editor
      // BEFORE its click fires — otherwise the click would lose the
      // text selection that the command operates on (Bold/Italic toggles
      // depend on the selection being intact when the command runs).
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={`h-7 w-7 rounded inline-flex items-center justify-center transition-colors ${
        disabled
          ? "text-muted-foreground/40 cursor-not-allowed"
          : active
            ? "bg-muted text-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-0.5 inline-block h-4 w-px bg-border" />;
}

export type { Editor };
