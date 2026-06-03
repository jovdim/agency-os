/**
 * Type definitions for content.json structure
 *
 * content.json is the single source of truth for website content.
 * It is created during vibe-coding and imported into the dashboard.
 *
 * The same structure is used in:
 *  1. The vibe-coded website (HTML/CSS/JS reads this file)
 *  2. The SK Dashboard database (sections stored as JSON)
 */

/**
 * A repeater item within a section (e.g., a service card, a gallery image)
 */
export interface ContentItem {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any; // Contains strings/numbers/booleans + runtime File objects (_pendingFile)
}

/**
 * The fields object for a section.
 * Can contain primitive values or arrays of ContentItem for repeaters.
 */
export interface ContentField {
  [key: string]: string | boolean | number | ContentItem[] | undefined;
}

/**
 * A single section within the site content.
 */
export interface ContentSection {
  type: string;
  id: string;
  label: string;
  order: number;
  /** Which page this section belongs to: 'home', 'about', etc. null/undefined = global (all pages) */
  page?: string | null;
  /** Original content.json section ID (e.g. "hero_1"). Maps to data-section in HTML. */
  content_id?: string | null;
  fields: ContentField;
}

/**
 * The full content.json structure.
 * This is what gets exported from vibe-coded websites
 * and imported into the dashboard.
 */
export interface SiteContent {
  site_name: string;
  site_url?: string;
  schema_version: string;
  sections: ContentSection[];
}

// --- Change Request Types ---

/**
 * Describes a single field-level change made by the client.
 */
export interface FieldChange {
  section_id: string;
  field: string;
  item_id?: string;      // For changes within a repeater item
  action: "update_field" | "replace_image" | "add_item" | "remove_item" | "reorder" | "add_gallery_image" | "remove_gallery_image" | "update_text";
  old_value?: string;
  new_value?: string;     // For text changes, new text; for images, the uploaded URL
  uploaded_file?: string; // The server path of the uploaded image
  items?: ContentItem[];  // For add_item action
  new_order?: string[];   // For reorder action

  // ── Rich context for tech admin review ──
  section_label?: string;               // Human-readable section name (e.g., "Main navigation")
  field_label?: string;                 // Human-readable field label (e.g., "Headline")
  repeater_key?: string;                // For item changes: which repeater array (e.g., "links", "items", "social")
  repeater_label?: string;              // Human-readable repeater name (e.g., "Menu Links")
  item_title?: string;                  // Best human-readable label for the item (title, label, name, caption)
  item_index?: number;                  // 0-based position in the array
  old_item?: ContentItem;               // For remove_item: full data of the removed item
  old_order?: string[];                 // For reorder: original order of IDs
  item_labels?: Record<string, string>; // For reorder: id → human label mapping
}
