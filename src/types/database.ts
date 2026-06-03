/**
 * Database types - will be auto-generated from Supabase CLI later.
 * For now, manually define the core types matching our schema.
 */

export type UserRole =
  | "client"
  | "sales"
  | "tech_admin"
  | "administrator"
  | "super_admin";

export type ContactStatus =
  | "new"
  | "no_answer"
  | "not_exists"
  | "interested"
  | "not_interested"
  | "send_proposal"
  | "send_email"
  | "send_invoice"
  | "directory_note"
  | "converted"
  | "callback"
  | "needs_ecommerce"
  | "local_market";

export type CallOutcome =
  | "no_answer"
  | "not_exists"
  | "interested"
  | "not_interested"
  | "send_proposal"
  | "send_email"
  | "send_invoice"
  | "directory_note"
  | "callback"
  | "needs_ecommerce"
  | "local_market"
  | "handed_over"
  | "whatsapp_sent"
  | "note"
  | "never_contact";

export type ProposalStatus =
  | "draft"
  | "submitted"
  | "building"
  | "review"
  | "revision"
  | "sent"
  | "viewed"
  | "accepted"
  | "paid";

export type WebsiteStatus =
  | "proposal"
  | "queued"
  | "building"
  | "live"
  | "suspended";

export type ChangeRequestStatus = "pending" | "approved" | "rejected";

export type PaymentStatus = "pending" | "confirmed" | "failed";

export type InvoiceType = "proforma" | "invoice";

export type CreditTxType =
  | "purchase"
  | "admin_grant"
  | "submission_deduct"
  | "rejection_refund";

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string;
  phone: string | null;
  company_name: string | null;
  is_active: boolean;
  ico: string | null;
  dic: string | null;
  ic_dph: string | null;
  billing_street: string | null;
  billing_city: string | null;
  billing_zip: string | null;
  business_email: string | null;
  business_email_password: string | null;
  username: string | null;
  login_password: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  company_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  business_email: string | null;
  website_url: string | null;
  industry: string | null;
  town: string | null;
  location: string | null;
  status: string;
  assigned_to: string | null;
  assigned_at: string | null;
  notes: string | null;
  social_links: string | null;
  quoted_price: number | null;
  client_status: string | null;
  client_user_id: string | null;
  source: string | null;
  total_listings: number | null;
  description: string | null;
  services_offered: string | null;
  source_url: string | null;
  cities_count: number | null;
  postal_code: string | null;
  location_raw: string | null;
  created_at: string;
  updated_at: string;
}

export interface CallLog {
  id: string;
  contact_id: string;
  sales_person_id: string;
  outcome: CallOutcome;
  notes: string | null;
  callback_at: string | null;
  created_at: string;
}

export interface Template {
  id: string;
  name: string;
  industry: string;
  design_variant: string;
  storage_path: string;
  thumbnail_path: string | null;
  color_scheme: Record<string, string> | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export type DeployStatus = "pending" | "deploying" | "live" | "failed";

export interface Proposal {
  id: string;
  slug: string;
  contact_id: string | null;
  sales_person_id: string;
  built_by: string | null;
  template_id: string | null;
  company_name: string;
  industry: string | null;
  town: string | null;
  services: string[] | null;
  content_overrides: Record<string, unknown> | null;
  requirements: string | null;
  feedback: string | null;
  status: ProposalStatus;
  price: number | null;
  greeting_text: string | null;
  discount_price: number | null;
  base_price: number | null;
  sent_at: string | null;
  discount_expires_at: string | null;
  paid_at: string | null;
  viewed_at: string | null;
  accepted_at: string | null;
  variable_symbol: string | null;
  created_at: string;
  updated_at: string;
}

export interface Site {
  id: string;
  name: string;
  slug: string;
  site_url: string | null;
  codebase_link: string | null;
  domain: string | null;
  status: WebsiteStatus;
  owner_id: string;
  proposal_id: string | null;
  template_id: string | null;
  domain_expiry_date: string | null;
  domain_registrar: string | null;
  domain_renewal_status: string | null;
  next_billing_date: string | null;
  billing_cycle_months: number | null;
  website_live_date: string | null;
  client_temp_password: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClientNote {
  id: string;
  profile_id: string;
  author_id: string;
  content: string;
  created_at: string;
}

export interface Deployment {
  id: string;
  proposal_id: string | null;
  site_id: string | null;
  github_repo: string;
  github_url: string | null;
  cloudflare_project_id: string | null;
  subdomain: string;
  deploy_status: DeployStatus;
  deploy_error: string | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Section {
  id: string;
  site_id: string;
  type: string;
  label: string;
  order: number;
  fields: Record<string, unknown>;
}

export interface ChangeRequest {
  id: string;
  site_id: string;
  user_id: string;
  status: ChangeRequestStatus;
  changes: Record<string, unknown>[];
  admin_note: string | null;
  processed_by: string | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreditBalance {
  id: string;
  site_id: string;
  balance: number;
}

export interface CreditTransaction {
  id: string;
  site_id: string;
  user_id: string | null;
  amount: number;
  type: CreditTxType;
  payment_id: string | null;
  note: string | null;
  created_at: string;
}

export interface Payment {
  id: string;
  profile_id: string;
  site_id: string | null;
  proposal_id: string | null;
  amount: number;
  currency: string;
  payment_method: string | null;
  status: PaymentStatus;
  description: string | null;
  created_at: string;
}

export interface ProposalReminder {
  id: string;
  proposal_id: string;
  sales_person_id: string;
  reminder_type: string;
  due_at: string;
  is_dismissed: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  type: InvoiceType;
  profile_id: string;
  site_id: string | null;
  payment_id: string | null;
  amount: number;
  vat_amount: number;
  line_items: Record<string, unknown>[];
  issued_at: string;
  paid_at: string | null;
  pdf_path: string | null;
}

export interface Service {
  id: string;
  site_id: string;
  type: string;
  name: string;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  price: number | null;
  created_at: string;
}

export interface Commission {
  id: string;
  sales_person_id: string;
  proposal_id: string | null;
  payment_id: string | null;
  amount: number;
  is_paid: boolean;
  paid_at: string | null;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

/**
 * Proposal tagging — see migration 00046_proposal_tags.sql.
 *
 * `color` is a Tailwind hue keyword (red/orange/purple/etc.) that
 * `tagPalette()` in src/components/proposal-tags maps to actual classes.
 * Storing the keyword (not the full class string) keeps the DB free of
 * presentation details.
 */
export type TagColor =
  | "red" | "orange" | "amber" | "yellow" | "green" | "emerald"
  | "teal" | "cyan" | "blue" | "indigo" | "violet" | "purple"
  | "pink" | "rose" | "gray" | "slate";

export interface ProposalTag {
  id: string;
  name: string;
  /** Stable slug — used to look up seeded tags by code (e.g. "urgent"). */
  slug: string;
  color: TagColor;
  created_by: string | null;
  created_at: string;
  /** Computed server-side on GET /api/proposal-tags only: true when the
   *  requesting user is allowed to delete this tag from the shared
   *  library (their own custom tag, or super_admin on a non-tier tag).
   *  Absent on payloads from other endpoints (POST, attachments, etc.)
   *  — never trust client state for permission decisions. */
  can_delete?: boolean;
}

export interface ProposalTagAssignment {
  proposal_id: string;
  tag_id: string;
  assigned_by: string | null;
  assigned_at: string;
}
