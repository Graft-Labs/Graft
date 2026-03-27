import { describe, it, expect } from "vitest";
import {
  PLAN_SCANS_LIMITS,
  getPlanFromSubscription,
  getNormalizedStatus,
  getCancellationScheduled,
  getSubscriptionsFromStatePayload,
  pickBestSubscription,
} from "../subscription-utils";

// ─── helpers ────────────────────────────────────────────────────────────────

const PLAN_MAP: Record<string, string> = {
  "prod-pro-123": "pro",
  "prod-unlimited-456": "unlimited",
};

function makeSub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "sub-1", status: "active", ...overrides };
}

// ─── PLAN_SCANS_LIMITS ───────────────────────────────────────────────────────

describe("PLAN_SCANS_LIMITS", () => {
  it("free plan allows 3 scans", () => {
    expect(PLAN_SCANS_LIMITS.free).toBe(3);
  });

  it("pro plan allows 50 scans", () => {
    expect(PLAN_SCANS_LIMITS.pro).toBe(50);
  });

  it("unlimited plan allows 999999 scans", () => {
    expect(PLAN_SCANS_LIMITS.unlimited).toBe(999999);
  });
});

// ─── getPlanFromSubscription ─────────────────────────────────────────────────

describe("getPlanFromSubscription", () => {
  describe("metadata check (highest priority)", () => {
    it("returns 'pro' when metadata.plan is 'pro'", () => {
      const sub = makeSub({ metadata: { plan: "pro" } });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("pro");
    });

    it("returns 'unlimited' when metadata.plan is 'unlimited'", () => {
      const sub = makeSub({ metadata: { plan: "unlimited" } });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });

    it("is case-insensitive for metadata.plan", () => {
      expect(getPlanFromSubscription(makeSub({ metadata: { plan: "PRO" } }), PLAN_MAP)).toBe("pro");
      expect(getPlanFromSubscription(makeSub({ metadata: { plan: "Unlimited" } }), PLAN_MAP)).toBe("unlimited");
    });

    it("ignores unknown metadata.plan values and falls through", () => {
      const sub = makeSub({
        metadata: { plan: "enterprise" },
        product_id: "prod-pro-123",
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("pro");
    });

    it("metadata takes precedence over product_id", () => {
      // metadata says unlimited, product_id maps to pro — metadata wins
      const sub = makeSub({
        metadata: { plan: "unlimited" },
        product_id: "prod-pro-123",
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });
  });

  describe("top-level product_id", () => {
    it("detects pro plan from product_id", () => {
      const sub = makeSub({ product_id: "prod-pro-123" });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("pro");
    });

    it("detects unlimited plan from product_id", () => {
      const sub = makeSub({ product_id: "prod-unlimited-456" });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });

    it("detects plan from subscription.product.id", () => {
      const sub = makeSub({ product: { id: "prod-unlimited-456" } });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });

    it("returns null for unknown product_id", () => {
      const sub = makeSub({ product_id: "prod-unknown-999" });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBeNull();
    });
  });

  describe("items array", () => {
    it("detects plan from items[].product_id", () => {
      const sub = makeSub({
        items: [{ product_id: "prod-pro-123" }],
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("pro");
    });

    it("detects plan from items[].product.id", () => {
      const sub = makeSub({
        items: [{ product: { id: "prod-unlimited-456" } }],
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });

    it("detects plan from items[].metadata.plan", () => {
      const sub = makeSub({
        items: [{ metadata: { plan: "unlimited" } }],
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });

    it("checks all items and returns first match", () => {
      const sub = makeSub({
        items: [
          { product_id: "prod-unknown" },
          { product_id: "prod-unlimited-456" },
        ],
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });
  });

  describe("products array", () => {
    it("detects plan from products[].id", () => {
      const sub = makeSub({
        products: [{ id: "prod-pro-123" }],
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("pro");
    });

    it("detects plan from products[].product_id", () => {
      const sub = makeSub({
        products: [{ product_id: "prod-unlimited-456" }],
      });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBe("unlimited");
    });
  });

  describe("edge cases", () => {
    it("returns null when no plan identifiers are present", () => {
      expect(getPlanFromSubscription(makeSub(), PLAN_MAP)).toBeNull();
    });

    it("returns null when planProductMap is empty", () => {
      const sub = makeSub({ product_id: "prod-pro-123" });
      expect(getPlanFromSubscription(sub, {})).toBeNull();
    });

    it("handles missing metadata gracefully", () => {
      const sub = makeSub({ metadata: null });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBeNull();
    });

    it("handles empty items array", () => {
      const sub = makeSub({ items: [] });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBeNull();
    });

    it("handles non-array items field", () => {
      const sub = makeSub({ items: "not-an-array" });
      expect(getPlanFromSubscription(sub, PLAN_MAP)).toBeNull();
    });
  });
});

// ─── getNormalizedStatus ─────────────────────────────────────────────────────

describe("getNormalizedStatus", () => {
  it("active subscription → { status: 'active', active: true }", () => {
    expect(getNormalizedStatus(makeSub({ status: "active" }))).toEqual({
      status: "active",
      active: true,
    });
  });

  it("trialing subscription → { status: 'active', active: true }", () => {
    expect(getNormalizedStatus(makeSub({ status: "trialing" }))).toEqual({
      status: "active",
      active: true,
    });
  });

  it("status is case-insensitive", () => {
    expect(getNormalizedStatus(makeSub({ status: "ACTIVE" }))).toEqual({
      status: "active",
      active: true,
    });
    expect(getNormalizedStatus(makeSub({ status: "Trialing" }))).toEqual({
      status: "active",
      active: true,
    });
  });

  it("cancelled subscription → { status: 'cancelled', active: true }", () => {
    expect(getNormalizedStatus(makeSub({ status: "cancelled" }))).toEqual({
      status: "cancelled",
      active: true,
    });
  });

  it("canceled (US spelling) → { status: 'cancelled', active: true }", () => {
    expect(getNormalizedStatus(makeSub({ status: "canceled" }))).toEqual({
      status: "cancelled",
      active: true,
    });
  });

  it("cancel_at_period_end=true treats subscription as cancelled-but-active", () => {
    const sub = makeSub({ status: "active", cancel_at_period_end: true });
    expect(getNormalizedStatus(sub)).toEqual({
      status: "cancelled",
      active: true,
    });
  });

  it("camelCase cancelAtPeriodEnd=true is also recognised", () => {
    const sub = makeSub({ status: "active", cancelAtPeriodEnd: true });
    expect(getNormalizedStatus(sub)).toEqual({
      status: "cancelled",
      active: true,
    });
  });

  it("expired / unknown status → { status: <raw>, active: false }", () => {
    expect(getNormalizedStatus(makeSub({ status: "expired" }))).toEqual({
      status: "expired",
      active: false,
    });
  });

  it("missing status → { status: null, active: false }", () => {
    expect(getNormalizedStatus({})).toEqual({ status: null, active: false });
  });
});

// ─── getCancellationScheduled ────────────────────────────────────────────────

describe("getCancellationScheduled", () => {
  it("returns false for a normal active subscription", () => {
    expect(getCancellationScheduled(makeSub({ status: "active" }))).toBe(false);
  });

  it("returns true when cancel_at_period_end=true", () => {
    expect(
      getCancellationScheduled(makeSub({ cancel_at_period_end: true }))
    ).toBe(true);
  });

  it("returns true when cancelAtPeriodEnd=true (camelCase)", () => {
    expect(
      getCancellationScheduled(makeSub({ cancelAtPeriodEnd: true }))
    ).toBe(true);
  });

  it("returns true for status=cancelled", () => {
    expect(getCancellationScheduled(makeSub({ status: "cancelled" }))).toBe(true);
  });

  it("returns true for status=canceled (US spelling)", () => {
    expect(getCancellationScheduled(makeSub({ status: "canceled" }))).toBe(true);
  });

  it("returns false for status=expired (not the same as cancelled)", () => {
    expect(getCancellationScheduled(makeSub({ status: "expired" }))).toBe(false);
  });
});

// ─── getSubscriptionsFromStatePayload ────────────────────────────────────────

describe("getSubscriptionsFromStatePayload", () => {
  const sub1 = makeSub({ id: "sub-a" });
  const sub2 = makeSub({ id: "sub-b" });

  it("returns active_subscriptions when present and non-empty", () => {
    const payload = { active_subscriptions: [sub1, sub2], subscriptions: [] };
    expect(getSubscriptionsFromStatePayload(payload)).toEqual([sub1, sub2]);
  });

  it("falls back to subscriptions array when active_subscriptions is empty", () => {
    const payload = { active_subscriptions: [], subscriptions: [sub1] };
    expect(getSubscriptionsFromStatePayload(payload)).toEqual([sub1]);
  });

  it("falls back to subscriptions array when active_subscriptions is absent", () => {
    const payload = { subscriptions: [sub2] };
    expect(getSubscriptionsFromStatePayload(payload)).toEqual([sub2]);
  });

  it("extracts nested customer_state.subscriptions", () => {
    const payload = { customer_state: { subscriptions: [sub1] } };
    expect(getSubscriptionsFromStatePayload(payload)).toEqual([sub1]);
  });

  it("returns empty array when no subscription fields are present", () => {
    expect(getSubscriptionsFromStatePayload({})).toEqual([]);
  });

  it("returns empty array when active_subscriptions is empty and no other fields", () => {
    expect(getSubscriptionsFromStatePayload({ active_subscriptions: [] })).toEqual([]);
  });
});

// ─── pickBestSubscription ────────────────────────────────────────────────────

describe("pickBestSubscription", () => {
  it("returns null for an empty list", () => {
    expect(pickBestSubscription([])).toBeNull();
  });

  it("returns the only item regardless of status", () => {
    const sub = makeSub({ status: "expired" });
    expect(pickBestSubscription([sub])).toBe(sub);
  });

  it("prefers active over other statuses", () => {
    const expired = makeSub({ id: "e", status: "expired" });
    const active = makeSub({ id: "a", status: "active" });
    expect(pickBestSubscription([expired, active])).toBe(active);
  });

  it("prefers trialing over expired", () => {
    const expired = makeSub({ id: "e", status: "expired" });
    const trialing = makeSub({ id: "t", status: "trialing" });
    expect(pickBestSubscription([expired, trialing])).toBe(trialing);
  });

  it("prefers cancelled over expired (still within paid period)", () => {
    const expired = makeSub({ id: "e", status: "expired" });
    const cancelled = makeSub({ id: "c", status: "cancelled" });
    expect(pickBestSubscription([expired, cancelled])).toBe(cancelled);
  });

  it("prefers canceled (US spelling) over expired", () => {
    const expired = makeSub({ id: "e", status: "expired" });
    const canceled = makeSub({ id: "c", status: "canceled" });
    expect(pickBestSubscription([expired, canceled])).toBe(canceled);
  });

  it("returns first item when none match preferred statuses", () => {
    const s1 = makeSub({ id: "1", status: "expired" });
    const s2 = makeSub({ id: "2", status: "past_due" });
    expect(pickBestSubscription([s1, s2])).toBe(s1);
  });

  it("returns the first preferred match when multiple active subs exist", () => {
    const active1 = makeSub({ id: "a1", status: "active" });
    const active2 = makeSub({ id: "a2", status: "active" });
    expect(pickBestSubscription([active1, active2])).toBe(active1);
  });
});

// ─── Integration-style scenarios ─────────────────────────────────────────────

describe("subscription lifecycle scenarios", () => {
  it("new free user: no subscription → plan stays free", () => {
    // No subscription from Polar → we keep whatever the DB says (free default)
    const sub = null;
    const dbPlan = "free";
    const effectivePlan = sub ? "would-be-set" : dbPlan;
    expect(effectivePlan).toBe("free");
    expect(PLAN_SCANS_LIMITS[effectivePlan]).toBe(3);
  });

  it("just upgraded to unlimited: subscription has metadata.plan=unlimited", () => {
    const sub = makeSub({
      status: "active",
      metadata: { plan: "unlimited" },
    });
    const { active } = getNormalizedStatus(sub);
    const detectedPlan = getPlanFromSubscription(sub, PLAN_MAP);
    const effectivePlan = active ? detectedPlan ?? "pro" : "free";
    expect(effectivePlan).toBe("unlimited");
    expect(PLAN_SCANS_LIMITS[effectivePlan]).toBe(999999);
  });

  it("just upgraded to pro via product_id", () => {
    const sub = makeSub({ status: "active", product_id: "prod-pro-123" });
    const { active } = getNormalizedStatus(sub);
    const detectedPlan = getPlanFromSubscription(sub, PLAN_MAP);
    const effectivePlan = active ? detectedPlan ?? "pro" : "free";
    expect(effectivePlan).toBe("pro");
    expect(PLAN_SCANS_LIMITS[effectivePlan]).toBe(50);
  });

  it("subscription cancelled at period end: still active until expiry", () => {
    const sub = makeSub({ status: "active", cancel_at_period_end: true });
    const { active, status } = getNormalizedStatus(sub);
    const isCancellationScheduled = getCancellationScheduled(sub);
    expect(active).toBe(true); // user still has access
    expect(status).toBe("cancelled");
    expect(isCancellationScheduled).toBe(true);
  });

  it("subscription expired: effective plan falls back to free", () => {
    const sub = makeSub({ status: "expired", product_id: "prod-unlimited-456" });
    const { active } = getNormalizedStatus(sub);
    const detectedPlan = getPlanFromSubscription(sub, PLAN_MAP);
    // expired → not active → free
    const effectivePlan = active ? detectedPlan ?? "pro" : "free";
    expect(effectivePlan).toBe("free");
    expect(PLAN_SCANS_LIMITS[effectivePlan]).toBe(3);
  });

  it("unlimited plan via items array (checkout-style payload)", () => {
    const sub = makeSub({
      status: "active",
      items: [
        { product_id: "prod-unknown", quantity: 1 },
        { product_id: "prod-unlimited-456", quantity: 1 },
      ],
    });
    const { active } = getNormalizedStatus(sub);
    const detectedPlan = getPlanFromSubscription(sub, PLAN_MAP);
    const effectivePlan = active ? detectedPlan ?? "pro" : "free";
    expect(effectivePlan).toBe("unlimited");
  });

  it("Polar customer state payload: extracts active subscription correctly", () => {
    const activeSub = makeSub({
      id: "sub-active",
      status: "active",
      metadata: { plan: "unlimited" },
    });
    const expiredSub = makeSub({ id: "sub-old", status: "expired" });

    const payload = { active_subscriptions: [activeSub], subscriptions: [activeSub, expiredSub] };
    const subs = getSubscriptionsFromStatePayload(payload);
    const best = pickBestSubscription(subs);

    expect(best).toEqual(activeSub);
    const detectedPlan = best ? getPlanFromSubscription(best, PLAN_MAP) : null;
    expect(detectedPlan).toBe("unlimited");
  });

  it("scan limit enforcement: free user at limit is blocked", () => {
    const scansUsed = 3;
    const scansLimit = PLAN_SCANS_LIMITS.free; // 3
    expect(scansUsed >= scansLimit).toBe(true); // should be blocked
  });

  it("scan limit enforcement: unlimited user is never blocked", () => {
    const scansUsed = 9999;
    const scansLimit = PLAN_SCANS_LIMITS.unlimited; // 999999
    expect(scansUsed >= scansLimit).toBe(false); // should pass
  });

  it("scan limit enforcement: pro user within limit is allowed", () => {
    const scansUsed = 49;
    const scansLimit = PLAN_SCANS_LIMITS.pro; // 50
    expect(scansUsed >= scansLimit).toBe(false); // should pass
  });

  it("scan limit enforcement: pro user at exact limit is blocked", () => {
    const scansUsed = 50;
    const scansLimit = PLAN_SCANS_LIMITS.pro; // 50
    expect(scansUsed >= scansLimit).toBe(true); // should be blocked
  });
});
