/**
 * No-op stub.
 *
 * The audit_log table was removed in migration 00071 (Peter 2026-05-20).
 * This module is kept as a no-op so the ~30 API routes that already do
 * `await logAudit(...)` don't have to be edited. New code should not
 * call logAudit — the call is silently dropped.
 */
export async function logAudit(_params: {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  // intentionally empty
}
