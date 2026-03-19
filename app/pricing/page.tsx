"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  X,
  Zap,
  Shield,
  Globe,
  DollarSign,
  ArrowRight,
  Clock,
  Star,
} from "lucide-react";
import Navbar from "@/components/layout/LandingNavbar";
import Footer from "@/components/layout/LandingFooter";
import { createClient } from "@/lib/supabase";

type Billing = "monthly" | "annual";

const plans = [
  {
    id: "free",
    name: "Free",
    tagline: "For trying it out",
    priceMonthly: 0,
    priceAnnual: 0,
    highlight: false,
    badge: null,
    cta: "Start Free",
    ctaHref: "/auth/signup",
    features: {
      "Scans per month": "1",
      "Security Guard": true,
      "Scalability Guard": true,
      "Monetization Guard": false,
      "Distribution Guard": false,
      "Fix suggestions": "Basic",
      "PDF export": false,
      "Scan history": "7 days",
      "Shareable report links": false,
      "Weekly auto-scans": false,
      "Priority support": false,
    },
  },
  {
    id: "pro",
    name: "Pro",
    tagline: "For serious builders",
    priceMonthly: 19,
    priceAnnual: 15,
    highlight: true,
    badge: "Most Popular",
    cta: "Get Pro",
    ctaHref: "/auth/signup?plan=pro",
    features: {
      "Scans per month": "Unlimited",
      "Security Guard": true,
      "Scalability Guard": true,
      "Monetization Guard": true,
      "Distribution Guard": true,
      "Fix suggestions": "Full copy-paste",
      "PDF export": true,
      "Scan history": "90 days",
      "Shareable report links": false,
      "Weekly auto-scans": false,
      "Priority support": true,
    },
  },
  {
    id: "unlimited",
    name: "Unlimited",
    tagline: "For power users",
    priceMonthly: 39,
    priceAnnual: 29,
    highlight: false,
    badge: null,
    cta: "Get Unlimited",
    ctaHref: "/auth/signup?plan=unlimited",
    features: {
      "Scans per month": "Unlimited",
      "Security Guard": true,
      "Scalability Guard": true,
      "Monetization Guard": true,
      "Distribution Guard": true,
      "Fix suggestions": "Full copy-paste",
      "PDF export": true,
      "Scan history": "Unlimited",
      "Shareable report links": true,
      "Weekly auto-scans": true,
      "Priority support": true,
    },
  },
  {
    id: "lifetime",
    name: "Lifetime",
    tagline: "Early bird — first 100 users",
    priceMonthly: 199,
    priceAnnual: 199,
    highlight: false,
    badge: "Early Bird",
    cta: "Get Lifetime Deal",
    ctaHref: "/auth/signup?plan=lifetime",
    features: {
      "Scans per month": "Unlimited",
      "Security Guard": true,
      "Scalability Guard": true,
      "Monetization Guard": true,
      "Distribution Guard": true,
      "Fix suggestions": "Full copy-paste",
      "PDF export": true,
      "Scan history": "Unlimited",
      "Shareable report links": true,
      "Weekly auto-scans": true,
      "Priority support": true,
    },
  },
];

const featureRows = [
  "Scans per month",
  "Security Guard",
  "Scalability Guard",
  "Monetization Guard",
  "Distribution Guard",
  "Fix suggestions",
  "PDF export",
  "Scan history",
  "Shareable report links",
  "Weekly auto-scans",
  "Priority support",
];

const faqItems = [
  {
    q: "What counts as a scan?",
    a: "Each time you submit a repository URL or ZIP file for analysis counts as one scan. You can re-scan the same repo multiple times.",
  },
  {
    q: "Can I upgrade or downgrade at any time?",
    a: "Yes. Upgrades are instant. Downgrades take effect at the end of your current billing period.",
  },
  {
    q: "Do you support private GitHub repositories?",
    a: "Yes. Connect your GitHub account via OAuth and ShipGuard can access private repos you have permission to read.",
  },
  {
    q: "What's the Lifetime deal exactly?",
    a: "A one-time payment of $199 gives you everything in Unlimited — forever. No monthly fees. Limited to the first 100 users.",
  },
  {
    q: "Is my code safe?",
    a: "We clone your repo to run analysis, then delete it immediately after the scan completes. We store only the report metadata, not your source code.",
  },
];

export default function PricingPage() {
  const [billing, setBilling] = useState<Billing>("monthly");
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  const displayPrice = (plan: typeof plans[0]) => {
    if (plan.id === "lifetime") return "$199";
    if (plan.priceMonthly === 0) return "$0";
    const price = billing === "annual" ? plan.priceAnnual : plan.priceMonthly;
    return `$${price}`;
  };

  const displayPer = (plan: typeof plans[0]) => {
    if (plan.id === "lifetime") return "one time";
    if (plan.priceMonthly === 0) return "forever";
    return billing === "annual" ? "per month, billed annually" : "per month";
  };

  const handleUpgrade = async (planId: string) => {
    if (planId === "free") {
      router.push("/auth/signup");
      return;
    }

    setLoadingPlan(planId);

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        router.push(`/auth/login?redirect=/pricing&plan=${planId}`);
        return;
      }

      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          userId: user.id,
          email: user.email,
        }),
      });

      const data = await response.json();

      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        alert(data.message || "Failed to create checkout. Please try again.");
      }
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Something went wrong. Please try again.");
    } finally {
      setLoadingPlan(null);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: "var(--obsidian)" }}>
      <div className="noise-overlay" />
      <Navbar />

      {/* ─── Header ─── */}
      <section className="relative pt-32 pb-16 overflow-hidden">
        <div className="absolute inset-0 grid-pattern opacity-20" />
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
        />
        <div className="relative max-w-4xl mx-auto px-6 text-center">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-4"
            style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
          >
            Pricing
          </p>
          <h1
            className="text-5xl md:text-6xl mb-4"
            style={{ fontFamily: "var(--font-ui)",  }}
          >
            Simple, honest pricing
          </h1>
          <p
            className="text-lg max-w-lg mx-auto mb-8"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-ui)" }}
          >
            Start free, no credit card required. Upgrade when you&apos;re ready to ship seriously.
          </p>

          {/* Billing toggle */}
          <div
            className="inline-flex p-1 rounded-xl"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            {(["monthly", "annual"] as Billing[]).map((b) => (
              <button
                key={b}
                onClick={() => setBilling(b)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all duration-150"
                style={{
                  background: billing === b ? "var(--surface-3)" : "transparent",
                  color: billing === b ? "var(--text-primary)" : "var(--text-tertiary)",
                  border: billing === b ? "1px solid var(--border-hover)" : "1px solid transparent",
                  fontFamily: "var(--font-label)",
                }}
              >
                {b === "annual" ? "Annual" : "Monthly"}
                {b === "annual" && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded"
                    style={{
                      background: "var(--accent-glow)",
                      color: "var(--accent)",
                      border: "1px solid var(--border-amber)",
                      fontFamily: "var(--font-label)",
                    }}
                  >
                    Save 20%
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Pricing Cards ─── */}
      <section className="pb-20 max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="relative flex flex-col p-6 rounded-2xl"
              style={{
                background: plan.highlight ? "var(--accent-glow)" : "var(--surface-2)",
                border: plan.highlight
                  ? "1px solid var(--border-amber)"
                  : plan.id === "lifetime"
                  ? "1px solid rgba(160,64,232,0.3)"
                  : "1px solid var(--border)",
              }}
            >
              {plan.badge && (
                <div
                  className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                  style={{
                    background: plan.highlight ? "var(--accent)" : plan.id === "lifetime" ? "var(--guard-distrib)" : "var(--surface-3)",
                    color: plan.highlight ? "var(--obsidian)" : "var(--text-primary)",
                    fontFamily: "var(--font-label)",
                  }}
                >
                  {plan.badge === "Early Bird" && <Clock size={10} className="inline mr-1" />}
                  {plan.badge}
                </div>
              )}

              {/* Plan name & price */}
              <div className="mb-6">
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-3"
                  style={{ color: plan.highlight ? "var(--accent)" : "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
                >
                  {plan.name}
                </p>
                <div className="flex items-baseline gap-1.5 mb-1">
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      
                      fontSize: "40px",
                      color: plan.highlight ? "var(--accent)" : "var(--text-primary)",
                      lineHeight: 1,
                    }}
                  >
                    {displayPrice(plan)}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: "12px",
                    color: "var(--text-tertiary)",
                    fontFamily: "var(--font-label)",
                    marginBottom: 8,
                  }}
                >
                  {displayPer(plan)}
                </p>
                <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                  {plan.tagline}
                </p>
              </div>

              {/* Feature list */}
              <ul className="flex flex-col gap-2.5 flex-1 mb-6">
                {featureRows.slice(0, 6).map((feature) => {
                  const val = plan.features[feature as keyof typeof plan.features];
                  const enabled = val !== false;
                  return (
                    <li key={feature} className="flex items-start gap-2.5">
                      {typeof val === "boolean" ? (
                        val ? (
                          <CheckCircle size={13} style={{ color: plan.highlight ? "var(--accent)" : "var(--guard-monetize)", flexShrink: 0, marginTop: 2 }} />
                        ) : (
                          <X size={13} style={{ color: "var(--text-tertiary)", flexShrink: 0, marginTop: 2 }} />
                        )
                      ) : (
                        <CheckCircle size={13} style={{ color: plan.highlight ? "var(--accent)" : "var(--guard-monetize)", flexShrink: 0, marginTop: 2 }} />
                      )}
                      <span
                        style={{
                          fontSize: "13px",
                          color: enabled ? "var(--text-secondary)" : "var(--text-tertiary)",
                          fontFamily: "var(--font-label)",
                          opacity: enabled ? 1 : 0.5,
                        }}
                      >
                        {typeof val === "string" ? (
                          <>
                            <span style={{ color: enabled ? "var(--text-primary)" : "var(--text-tertiary)", fontWeight: 500 }}>
                              {val}
                            </span>
                            {" "}
                            {feature.toLowerCase()}
                          </>
                        ) : (
                          feature
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <button
                onClick={() => handleUpgrade(plan.id)}
                disabled={loadingPlan !== null}
                className="block text-center py-3 rounded-xl text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: plan.highlight ? "var(--accent)" : "var(--surface-3)",
                  color: plan.highlight ? "var(--obsidian)" : "var(--text-primary)",
                  border: plan.highlight ? "none" : "1px solid var(--border)",
                  fontFamily: "var(--font-ui)",
                }}
              >
                {loadingPlan === plan.id ? "Loading..." : plan.cta}
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Feature Comparison Table ─── */}
      <section
        className="py-20 border-y"
        style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}
      >
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-12">
            <h2
              className="text-3xl md:text-4xl"
              style={{ fontFamily: "var(--font-ui)",  }}
            >
              Full comparison
            </h2>
          </div>

          <div
            className="rounded-2xl overflow-hidden"
            style={{ border: "1px solid var(--border)" }}
          >
            {/* Header */}
            <div
              className="grid"
              style={{
                gridTemplateColumns: "1fr repeat(4, 1fr)",
                background: "var(--surface-3)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div className="p-4" />
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="p-4 text-center"
                  style={{
                    background: plan.highlight ? "var(--accent-glow)" : "transparent",
                    borderLeft: "1px solid var(--border)",
                  }}
                >
                  <p
                    className="font-semibold text-sm"
                    style={{
                      fontFamily: "var(--font-ui)",
                      color: plan.highlight ? "var(--accent)" : "var(--text-primary)",
                    }}
                  >
                    {plan.name}
                  </p>
                </div>
              ))}
            </div>

            {/* Rows */}
            {featureRows.map((feature, i) => (
              <div
                key={feature}
                className="grid"
                style={{
                  gridTemplateColumns: "1fr repeat(4, 1fr)",
                  background: i % 2 === 0 ? "var(--obsidian-2)" : "var(--surface-2)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <div
                  className="p-4 flex items-center"
                  style={{ borderRight: "1px solid var(--border)" }}
                >
                  <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                    {feature}
                  </span>
                </div>
                {plans.map((plan) => {
                  const val = plan.features[feature as keyof typeof plan.features];
                  return (
                    <div
                      key={plan.id}
                      className="p-4 flex items-center justify-center"
                      style={{
                        borderLeft: "1px solid var(--border)",
                        background: plan.highlight ? "rgba(232,160,32,0.04)" : "transparent",
                      }}
                    >
                      {typeof val === "boolean" ? (
                        val ? (
                          <CheckCircle size={15} style={{ color: plan.highlight ? "var(--accent)" : "var(--guard-monetize)" }} />
                        ) : (
                          <X size={15} style={{ color: "var(--text-tertiary)" }} />
                        )
                      ) : (
                        <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-label)", textAlign: "center" }}>
                          {val}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section className="py-20 max-w-3xl mx-auto px-6">
        <div className="text-center mb-12">
          <h2
            className="text-3xl md:text-4xl"
            style={{ fontFamily: "var(--font-ui)",  }}
          >
            Questions answered
          </h2>
        </div>

        <div className="flex flex-col gap-3">
          {faqItems.map((item, i) => (
            <div
              key={i}
              className="rounded-xl overflow-hidden"
              style={{
                background: "var(--surface-2)",
                border: `1px solid ${openFaq === i ? "var(--border-amber)" : "var(--border)"}`,
              }}
            >
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <span
                  className="text-sm font-medium"
                  style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.01em" }}
                >
                  {item.q}
                </span>
                <span
                  className="text-lg ml-4 flex-shrink-0 transition-transform duration-200"
                  style={{
                    color: "var(--accent)",
                    transform: openFaq === i ? "rotate(45deg)" : "rotate(0)",
                    fontFamily: "var(--font-ui)",
                    lineHeight: 1,
                  }}
                >
                  +
                </span>
              </button>
              {openFaq === i && (
                <div
                  className="px-5 pb-5"
                >
                  <p style={{ fontSize: "14px", color: "var(--text-secondary)", fontFamily: "var(--font-label)", lineHeight: "1.7" }}>
                    {item.a}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section
        className="py-20 border-t"
        style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}
      >
        <div className="max-w-2xl mx-auto px-6 text-center">
          <h2
            className="text-4xl mb-4"
            style={{ fontFamily: "var(--font-ui)",  }}
          >
            Start with free, today
          </h2>
          <p
            className="mb-8"
            style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
          >
            One scan. No card. All 4 guards.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-3 px-8 py-4 rounded-xl font-semibold transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background: "var(--accent)",
              color: "var(--obsidian)",
              fontFamily: "var(--font-ui)",
              boxShadow: "0 8px 40px var(--accent-glow-strong)",
            }}
          >
            Get my free scan
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <Footer />
    </div>
  );
}
