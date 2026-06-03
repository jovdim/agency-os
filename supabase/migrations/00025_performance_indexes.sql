-- Performance indexes for faster queries
-- Run this on production Supabase to speed up dashboard pages

-- Proposals: sales contacts page filters by contact_id
CREATE INDEX IF NOT EXISTS idx_proposals_contact_id ON public.proposals(contact_id);

-- Proposals: sales dashboard filters by sales_person + status
CREATE INDEX IF NOT EXISTS idx_proposals_sales_status ON public.proposals(sales_person_id, status);

-- Deployments: production page filters by deploy_status
CREATE INDEX IF NOT EXISTS idx_deployments_deploy_status ON public.deployments(deploy_status);

-- Sections: editor loads all sections for a site
CREATE INDEX IF NOT EXISTS idx_sections_site_id ON public.sections(site_id);

-- Change requests: client/tech pages filter by site + status
CREATE INDEX IF NOT EXISTS idx_change_requests_site_id ON public.change_requests(site_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON public.change_requests(status);
CREATE INDEX IF NOT EXISTS idx_change_requests_site_status ON public.change_requests(site_id, status);

-- Credits: client pages load balances and transactions per site
CREATE INDEX IF NOT EXISTS idx_credit_balances_site_id ON public.credit_balances(site_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_site_id ON public.credit_transactions(site_id);

-- Sites: client dashboard filters by owner, proposal detail looks up by proposal_id
CREATE INDEX IF NOT EXISTS idx_sites_owner_id ON public.sites(owner_id);
CREATE INDEX IF NOT EXISTS idx_sites_proposal_id ON public.sites(proposal_id);

-- Contacts: sales pages filter by assigned salesperson + status
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_to ON public.contacts(assigned_to);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned_status ON public.contacts(assigned_to, status);

-- Payments: super admin filters by proposal_id
CREATE INDEX IF NOT EXISTS idx_payments_proposal_id ON public.payments(proposal_id);

-- Proposal reminders: sales dashboard filters by salesperson + dismissed status
CREATE INDEX IF NOT EXISTS idx_reminders_sales_dismissed ON public.proposal_reminders(sales_person_id, is_dismissed);

-- Contact submissions: rate limiting lookups by IP + time
-- (already created in 00022, but adding composite for safety)
CREATE INDEX IF NOT EXISTS idx_contact_submissions_ip_created ON public.contact_submissions(ip_address, created_at DESC);

-- Audit log: admin pages filter by action type + time
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log(created_at DESC);
