import { describe, it, expect, vi, beforeEach } from "vitest";

const adminUpdates: Array<Record<string, unknown>> = [];
let firstCallReturnsUndefinedColumn = false;
const ownerIdReturned: string | null = "owner-123";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", app_metadata: { role: "tech_admin" } } },
      }),
    },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: ownerIdReturned ? { owner_id: ownerIdReturned } : null,
            error: null,
          }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        adminUpdates.push(payload);
        const isFirst = adminUpdates.length === 1;
        const error =
          isFirst && firstCallReturnsUndefinedColumn
            ? { code: "42703", message: "Could not find the 'updated_by_role' column" }
            : null;
        return {
          eq: () => ({
            select: () => ({
              single: async () => ({
                data: error
                  ? null
                  : { id: "site-1", ...payload, updated_at: "2026-05-08T01:00:00.000Z" },
                error,
              }),
            }),
          }),
        };
      },
    }),
  }),
}));

import { PUT } from "@/app/api/sites/[id]/route";

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/sites/site-1", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as import("next/server").NextRequest;
}

const params = Promise.resolve({ id: "site-1" });

describe("PUT /api/sites/[id] — defensive retry on missing updated_by_role", () => {
  beforeEach(() => {
    adminUpdates.length = 0;
    firstCallReturnsUndefinedColumn = false;
  });

  // Valid minimal composition — the integrity guard added 2026-05-28
  // requires >=1 page including the home page (index.html). These tests
  // exercise the updated_by_role retry, not composition emptiness, so a
  // valid one-page composition keeps their intent while passing the guard.
  const validComposition = {
    pages: [{ path: "index.html", label: "Home", sections: [] }],
  };

  it("includes updated_by_role on the happy path", async () => {
    const res = await PUT(makeRequest({ composition: validComposition }), { params });
    expect(res.status).toBe(200);
    expect(adminUpdates).toHaveLength(1);
    expect(adminUpdates[0]).toMatchObject({
      composition: validComposition,
      updated_by_role: "tech_admin",
    });
  });

  it("retries WITHOUT updated_by_role when Postgres returns 42703", async () => {
    firstCallReturnsUndefinedColumn = true;
    const res = await PUT(makeRequest({ composition: validComposition }), { params });
    expect(res.status).toBe(200);
    expect(adminUpdates).toHaveLength(2);
    expect(adminUpdates[0]).toHaveProperty("updated_by_role");
    expect(adminUpdates[1]).not.toHaveProperty("updated_by_role");
    expect(adminUpdates[1]).toMatchObject({ composition: validComposition });
  });

  it("does NOT include updated_by_role for non-composition writes", async () => {
    const res = await PUT(makeRequest({ status: "review" }), { params });
    expect(res.status).toBe(200);
    expect(adminUpdates).toHaveLength(1);
    expect(adminUpdates[0]).toMatchObject({ status: "review" });
    expect(adminUpdates[0]).not.toHaveProperty("updated_by_role");
  });
});
