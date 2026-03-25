"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { ArrowRight, Github, CheckCircle, Loader2, X, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import LandingNavbar from "@/components/layout/LandingNavbar";
import LandingFooter from "@/components/layout/LandingFooter";
import { SquigglyLine } from "@/components/ui/squiggly-line";
import { BorderBeam } from "@/components/ui/border-beam";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { BlurFade } from "@/components/ui/blur-fade";
import { RetroGrid } from "@/components/ui/retro-grid";
import { ShimmerButton } from "@/components/ui/shimmer-button";
import { Marquee } from "@/components/ui/marquee";
import { AnimatedList } from "@/components/ui/animated-list";
import { IconCloud } from "@/components/ui/icon-cloud";
import { OrbitingCircles } from "@/components/ui/orbiting-circles";
import { SmoothCursor } from "@/components/ui/smooth-cursor";

export default function LandingPage() {
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [_portalLoading, setPortalLoading] = useState(false);
  const [userPlan, setUserPlan] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserPlan() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from("users")
          .select("plan")
          .eq("id", user.id)
          .single();
        setUserPlan(data?.plan || "free");
      }
    }
    fetchUserPlan();
  }, []);

  const startCheckout = async (planId: "pro" | "unlimited" | "lifetime") => {
    try {
      setCheckoutLoading(planId);
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        throw new Error(data?.message || data?.error || "Failed to start checkout");
      }

      if (!data?.url) throw new Error("No checkout URL returned.");
      window.location.href = data.url;
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : "Unable to start checkout right now.");
      setCheckoutLoading(null);
    }
  };

  const _startPortal = async () => {
    try {
      setPortalLoading(true);
      const response = await fetch("/api/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        if (response.status === 404) {
          alert("No active subscription found.");
          return;
        }
        throw new Error(data?.message || data?.error || "Failed to open billing portal");
      }

      if (!data?.url) throw new Error("No portal URL returned.");
      window.location.href = data.url;
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : "Unable to open billing portal right now.");
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-gray-900 font-sans selection:bg-[#3079FF]/20 overflow-x-hidden relative">
      <SmoothCursor />
      <LandingNavbar />

      {/* Animated Grid Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <AnimatedGridPattern
          numSquares={30}
          maxOpacity={0.15}
          duration={3}
          className="[mask-image:radial-gradient(ellipse_80%_80%_at_50%_20%,#000_40%,transparent_100%)]"
        />
      </div>

      <main className="relative z-10">
        {/* ─── HERO SECTION ──────────────────────────────────────────────── */}
        <section className="relative pt-48 pb-24 px-6 overflow-hidden min-h-[78vh] flex flex-col justify-center items-center text-center">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-6xl md:text-8xl lg:text-[7rem] tracking-tight leading-[1.05] mb-8 font-bold text-gray-900"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Know before <br className="hidden md:block" />
            <span className="relative inline-block">
              you{" "}
              <span className="font-garamond italic pr-2 font-normal text-[#111827]">
                ship
              </span>
              <SquigglyLine className="absolute -bottom-4 left-0 w-full" />
            </span>
            .
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-10 leading-relaxed font-light"
            style={{ fontFamily: "var(--font-landing-body)" }}
          >
            AI writes the code. You own the risk. Automatically scan AI-generated
            Next.js and React apps for security flaws, performance bottlenecks,
            and production readiness.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-lg mx-auto"
          >
            <Link
              href="/auth/signup"
              className="landing-btn-secondary px-8 py-4 text-lg w-full sm:w-auto gap-2 group hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-black/5"
            >
              <Github className="w-5 h-5" />
              Scan GitHub Repo
            </Link>
            <Link
              href="/#pricing"
              className="inline-flex h-14 items-center justify-center rounded-full border border-gray-300 bg-white px-8 text-lg font-semibold text-gray-800 transition-colors hover:bg-gray-50"
            >
              View pricing
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="mt-10 flex flex-wrap items-center justify-center gap-3"
          >
            {[
              "3 critical issues caught before deploy",
              "2.3s avg scan time",
              "One-click fix prompts",
            ].map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700"
              >
                {chip}
              </span>
            ))}
          </motion.div>
        </section>

        {/* ─── MARQUEE: AI IDE PARTNERS ─────────────────────────────────────────── */}
        <div className="py-6 bg-[#FAFAFA] border-b border-gray-100 overflow-hidden">
          <p className="text-center text-xs font-medium mb-3" style={{ color: "#9CA3AF", fontFamily: "var(--font-landing-body)" }}>
            Works with code generated by
          </p>
          <div className="relative">
            <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#FAFAFA] to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#FAFAFA] to-transparent z-10 pointer-events-none" />
            <Marquee repeat={3} pauseOnHover className="[--duration:30s]">
              {[
                { name: "Cursor", src: "/ide-logos/cursor.svg" },
                { name: "Windsurf", src: "/ide-logos/windsurf.svg" },
                { name: "GitHub Copilot", src: "/ide-logos/github-copilot.svg" },
                { name: "Claude", src: "/ide-logos/claude.svg" },
                { name: "Tabnine", src: "/ide-logos/tabnine.svg" },
                { name: "Replit", src: "/ide-logos/replit.svg" },
              ].map((tool) => (
                <div
                  key={tool.name}
                  className="mx-5 flex items-center gap-3 px-1 py-1"
                >
                  <Image
                    src={tool.src}
                    alt={tool.name}
                    width={32}
                    height={32}
                    className="h-8 w-8 object-contain"
                  />
                  <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                    {tool.name}
                  </span>
                </div>
              ))}
            </Marquee>
          </div>
        </div>

        {/* ─── STORY SECTION: PRODUCT SHOWCASE ─────────────────────────────────────────────── */}
        <section className="py-20 px-6 relative bg-white">
          <div className="max-w-6xl mx-auto space-y-20">
            {/* ── OPTION A: Animated Vulnerability Detection ──────────────────────── */}
            <BlurFade delay={0.1} direction="up">
            <div className="flex flex-col md:flex-row items-center gap-16">
              <div className="flex-1 space-y-6">
                <h2
                  className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900"
                  style={{ fontFamily: "var(--font-landing-heading)" }}
                >
                  Speed shouldn{`'`}t <br />
                  mean{" "}
                  <span className="font-garamond italic font-normal">
                    vulnerability
                  </span>
                  .
                </h2>
                <p className="text-xl text-gray-600 leading-relaxed font-light">
                  Cursor and Windsurf are amazing at writing code fast. But they
                  lack context on security best practices, production
                  configuration, and your specific business logic.
                </p>
                <ul className="space-y-4 pt-4">
                  {[
                    "Detect hardcoded secrets & weak auth",
                    "Spot unoptimized queries & N+1 issues",
                    "Verify error boundaries & configs",
                  ].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-gray-700">
                      <CheckCircle className="w-5 h-5 text-[#3079FF]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex-1 w-full">
                <div className="h-[340px] overflow-hidden rounded-2xl border border-gray-200 bg-white p-4">
                <AnimatedList delay={1300} maxItems={5} className="w-full max-w-xl">
                  {[
                    { level: "critical", text: "Exposed SUPABASE_SERVICE_ROLE_KEY", file: "app/api/admin/route.ts:14" },
                    { level: "critical", text: "Hardcoded API key in production", file: "lib/config.ts:6" },
                    { level: "high", text: "Missing rate limiting on auth endpoint", file: "app/api/auth/login/route.ts" },
                    { level: "medium", text: "No RLS policy on profiles table", file: "supabase/migrations/001.sql" },
                  ].map((item) => (
                    <div key={item.text} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                      <div className="flex items-start gap-3">
                        {item.level === "critical" ? (
                          <X className="mt-0.5 h-4 w-4 text-red-600" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                        )}
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{item.text}</p>
                          <p className="mt-0.5 text-xs text-gray-500 font-mono">{item.file}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </AnimatedList>
                </div>
              </div>
            </div>
            </BlurFade>

            {/* ── OPTION B: Icon Cloud Deep Integration ─────────────────────────── */}
            <BlurFade delay={0.15} direction="up">
            <div className="flex flex-col md:flex-row-reverse items-center gap-16">
              <div className="flex-1 space-y-6">
                <h2
                  className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900"
                  style={{ fontFamily: "var(--font-landing-heading)" }}
                >
                  Deep integration <br />
                  with{" "}
                  <span className="font-garamond italic font-normal">
                    your stack
                  </span>
                  .
                </h2>
                <p className="text-xl text-gray-600 leading-relaxed font-light">
                  We understand your framework, your database, your deployment
                  platform, and your SaaS patterns — because we{`'`}ve seen them all.
                </p>
              </div>
              <div className="flex-1 w-full flex items-center justify-center">
                <div className="relative flex items-center justify-center min-h-[620px] w-full">
                  <div className="pointer-events-none absolute -z-10 h-[520px] w-[520px] rounded-full bg-gradient-to-br from-blue-100 via-cyan-50 to-indigo-100 blur-2xl" />
                  <IconCloud
                    images={[
                      "/nextjs.svg",
                      "/react.svg",
                      "/supabase.svg",
                      "/vercel.svg",
                      "/postgresql.svg",
                      "/nodedotjs.svg",
                      "/typescript.svg",
                      "/tailwindcss.svg",
                      "/prisma.svg",
                      "/next.svg",
                      "/window.svg",
                      "/file.svg",
                      "/globe.svg",
                    ]}
                  />
                </div>
              </div>
            </div>
            </BlurFade>

            {/* ── OPTION C: Modern Prompt Experience ─────────────────────────────── */}
            <BlurFade delay={0.2} direction="up">
            <div className="flex flex-col md:flex-row items-center gap-16">
              <div className="flex-1 space-y-6">
                <h2
                  className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900"
                  style={{ fontFamily: "var(--font-landing-heading)" }}
                >
                  Fix faster with <br />
                  <span className="font-garamond italic font-normal">
                    instant guidance
                  </span>
                  .
                </h2>
                <p className="text-xl text-gray-600 leading-relaxed font-light">
                  Graft turns scan findings into a clear remediation flow you can
                  hand to your AI coding tool, reviewer, or team in seconds.
                </p>
                <ul className="space-y-4 pt-4">
                  {[
                    "Prioritized by severity and blast radius",
                    "File-by-file remediation steps",
                    "Shareable fix plan for your team",
                  ].map((item) => (
                    <li key={item} className="flex items-center gap-3 text-gray-700">
                      <CheckCircle className="w-5 h-5 text-[#3079FF]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex-1 w-full">
                <div className="relative flex h-[340px] w-full items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  <OrbitingCircles radius={120} iconSize={44} speed={1.1} path className="bg-white border border-gray-200 shadow-sm">
                    <Image src="/ide-logos/cursor.svg" alt="Cursor" className="h-6 w-6 object-contain" />
                    <Image src="/ide-logos/windsurf.svg" alt="Windsurf" className="h-6 w-6 object-contain" />
                    <Image src="/ide-logos/github-copilot.svg" alt="GitHub Copilot" className="h-6 w-6 object-contain" />
                    <Image src="/ide-logos/claude.svg" alt="Claude" className="h-6 w-6 object-contain" />
                    <Image src="/ide-logos/tabnine.svg" alt="Tabnine" className="h-6 w-6 object-contain" />
                    <Image src="/ide-logos/replit.svg" alt="Replit" className="h-6 w-6 object-contain" />
                  </OrbitingCircles>

                  <div className="z-20 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-emerald-50 px-6 py-4 text-center shadow-lg">
                    <Image src="/graft.svg" alt="Graft" className="mx-auto mb-2 h-10 w-10" />
                    <p className="text-sm font-semibold text-gray-900">Graft</p>
                    <p className="text-xs text-gray-600">Finds, prioritizes, and explains fixes</p>
                  </div>
                </div>
              </div>
            </div>
            </BlurFade>
          </div>
        </section>

        {/* ─── PRICING SECTION ──────────────────────────────────────────────── */}
        <section
          id="pricing"
          className="py-32 px-6 relative bg-[#FAFAFA] border-y border-gray-100"
        >
          <div className="max-w-5xl mx-auto">
            <BlurFade delay={0.05}>
            <div className="text-center mb-16">
              <h2
                className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 mb-4"
                style={{ fontFamily: "var(--font-landing-heading)" }}
              >
                Simple, transparent{" "}
                <span className="font-garamond italic font-normal">
                  pricing
                </span>
              </h2>
              <p className="text-xl text-gray-600 font-light">
                Secure your codebase, completely free to start.
              </p>
            </div>
            </BlurFade>

            <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
              {/* Free Tier */}
              <BlurFade delay={0.1}>
              <div className="p-6 rounded-2xl bg-white border border-gray-200 hover:shadow-lg transition-shadow flex flex-col relative overflow-hidden">
                <BorderBeam colorFrom="#94A3B8" colorTo="#94A3B8" size={40} duration={8} />
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Free</h3>
                  <div className="flex items-baseline gap-2">
                    <div className="text-3xl font-bold text-gray-900 font-mono tracking-tight">$0</div>
                    <span className="text-gray-500">/month</span>
                  </div>
                  <p className="text-gray-500 mt-2 text-sm">
                    Perfect for trying it out
                  </p>
                </div>
                <ul className="space-y-3 mb-6 flex-1">
                  {[
                    "3 scans/month",
                    "1 Repository",
                    "Basic security scans",
                    "Community support",
                    "Public repos only",
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-gray-600 text-sm">
                      <CheckCircle className="w-4 h-4 text-gray-400 shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className="w-full py-3 rounded-full border border-gray-300 text-center font-medium text-gray-700 hover:bg-gray-50 transition-colors text-sm"
                >
                  Start for free
                </Link>
              </div>
              </BlurFade>

              {/* Pro Tier */}
              <BlurFade delay={0.2}>
              <div className="p-6 rounded-2xl bg-gray-900 text-white shadow-2xl shadow-gray-900/20 relative overflow-hidden flex flex-col">
                <BorderBeam colorFrom="#3079FF" colorTo="#8B5CF6" size={60} duration={10} delay={2} />
                <div className="absolute top-0 right-0 p-3">
                  <span className="px-2.5 py-1 bg-white/10 rounded-full text-xs font-medium text-white/90 backdrop-blur-sm">
                    Most Popular
                  </span>
                </div>
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur-xl z-0" />
                <div className="relative z-10">
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-white mb-2">Pro</h3>
                    <div className="flex items-baseline gap-2">
                      <div className="text-3xl font-bold text-white font-mono tracking-tight">$15</div>
                      <span className="text-gray-400">/month</span>
                    </div>
                    <p className="text-gray-400 mt-2 text-sm">
                      For serious makers & startups
                    </p>
                  </div>
                  <ul className="space-y-3 mb-6 flex-1">
                    {[
                      "50 scans/month",
                      "Unlimited Repositories",
                      "Deep architectural analysis",
                      "Private & Public repos",
                      "Priority support",
                    ].map((feature, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-gray-200 text-sm">
                        <CheckCircle className="w-4 h-4 text-[#3079FF] shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {userPlan && userPlan !== "free" ? (
                    <Link
                      href="/dashboard/settings?tab=billing"
                      className="w-full py-3 rounded-full bg-white text-black text-center font-medium hover:bg-gray-100 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)] inline-flex items-center justify-center gap-2 text-sm"
                    >
                      Manage Plan
                    </Link>
                  ) : (
                    <Link
                      href="/dashboard/settings?tab=billing"
                      className="w-full py-3 rounded-full bg-white text-black text-center font-medium hover:bg-gray-100 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)] inline-flex items-center justify-center gap-2 text-sm"
                    >
                      Upgrade to Pro
                    </Link>
                  )}
                </div>
              </div>
              </BlurFade>

              {/* Unlimited Tier */}
              <BlurFade delay={0.3}>
              <div className="p-6 rounded-2xl bg-white border-2 border-[#3079FF] hover:shadow-lg transition-shadow flex flex-col relative overflow-hidden">
                <BorderBeam colorFrom="#3079FF" colorTo="#06B6D4" size={50} duration={8} delay={1} />
                <div className="absolute top-0 right-0 p-3">
                  <span className="px-2.5 py-1 bg-[#3079FF]/10 rounded-full text-xs font-medium text-[#3079FF]">
                    Best Value
                  </span>
                </div>
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">Unlimited</h3>
                  <div className="flex items-baseline gap-2">
                    <div className="text-3xl font-bold text-gray-900 font-mono tracking-tight">$39</div>
                    <span className="text-gray-500">/month</span>
                  </div>
                  <p className="text-gray-500 mt-2 text-sm">
                    Scan without limits
                  </p>
                </div>
                <ul className="space-y-3 mb-6 flex-1">
                  {[
                    "Unlimited scans",
                    "Everything in Pro",
                    "API access",
                    "Custom scan rules",
                  ].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2.5 text-gray-600 text-sm">
                      <CheckCircle className="w-4 h-4 text-[#3079FF] shrink-0" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <button
                  disabled={checkoutLoading === "unlimited" || userPlan === "unlimited"}
                  className="w-full py-3 rounded-full border-2 border-[#3079FF] text-[#3079FF] text-center font-medium hover:bg-[#3079FF]/5 transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-70 text-sm"
                >
                  {checkoutLoading === "unlimited" ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {userPlan && userPlan !== "free" ? "View Plans" : "Get Started"}
                </button>
              </div>
              </BlurFade>
            </div>
          </div>

        </section>

        {/* ─── CTA SECTION ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative bg-[#111827] text-white overflow-hidden">
          <div className="absolute inset-0 overflow-hidden">
            <RetroGrid
              angle={70}
              cellSize={80}
              opacity={0.3}
              lightLineColor="rgba(255,255,255,0.15)"
              darkLineColor="rgba(255,255,255,0.15)"
            />
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(48,121,255,0.15)_0%,transparent_70%)]" />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2
              className="text-5xl md:text-6xl font-bold mb-8 tracking-tight text-white"
              style={{ fontFamily: "var(--font-landing-heading)" }}
            >
              Ready to{" "}
              <span className="font-garamond italic font-normal">ship</span>?
            </h2>
            <p
              className="text-xl text-gray-300 mb-12 max-w-2xl mx-auto font-light"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              Join forward-thinking developers securing their AI-generated apps.
              Prevent the nightmare scenario before it happens.
            </p>
            <div className="flex justify-center">
              <ShimmerButton
                shimmerColor="rgba(48,121,255,0.3)"
                background="rgba(255,255,255,0.95)"
                className="px-10 py-5 text-xl gap-2 shadow-2xl hover:shadow-white/20 transition-all text-black"
              >
                <Link href="/auth/signup" className="flex items-center gap-2">
                  Start Scanning Now
                  <ArrowRight className="w-6 h-6" />
                </Link>
              </ShimmerButton>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </div>
  );
}
