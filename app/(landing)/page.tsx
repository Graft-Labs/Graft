"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Shield,
  Zap,
  Globe,
  ArrowRight,
  Github,
  CheckCircle,
  AlertTriangle,
  Lock,
  ChevronRight,
  Code2,
  Terminal,
} from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import LandingNavbar from "@/components/layout/LandingNavbar";
import LandingFooter from "@/components/layout/LandingFooter";

export default function LandingPage() {
  const { scrollYProgress } = useScroll();
  
  // Subtle parallax for abstract background elements
  const y1 = useTransform(scrollYProgress, [0, 1], [0, 300]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -200]);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans selection:bg-[#3079FF]/20 overflow-x-hidden relative">
      <LandingNavbar />

      {/* Abstract Grid Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden h-[120vh]">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,#000_70%,transparent_100%)] opacity-60" />
      </div>

      <main className="relative z-10">
        {/* ─── HERO SECTION ──────────────────────────────────────────────── */}
        <section className="relative pt-48 pb-32 px-6 overflow-hidden min-h-[90vh] flex flex-col justify-center items-center text-center">
          
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#0000EE]/20 bg-[#3079FF]/5 text-[#0000EE] text-sm font-medium mb-8"
          >
            <span className="flex h-2 w-2 rounded-full bg-[#3079FF]">
              <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-[#3079FF] opacity-75"></span>
            </span>
            ShipGuard AI 2.0 is live
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-6xl md:text-8xl lg:text-[7rem] tracking-tight leading-[1.05] mb-8 font-bold text-gray-900"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Know before <br className="hidden md:block" />
            <span className="text-[#3079FF]">you ship.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-12 leading-relaxed"
            style={{ fontFamily: "var(--font-landing-body)" }}
          >
            AI writes the code. You own the risk. Automatically scan AI-generated Next.js & React apps for security flaws, performance bottlenecks, and production-readiness.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full max-w-md mx-auto"
          >
            <Link
              href="/auth/signup"
              className="landing-btn-primary px-8 py-4 text-lg w-full sm:w-auto gap-2 group"
            >
              <Github className="w-5 h-5" />
              Scan GitHub Repo
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="/pricing"
              className="landing-btn-secondary px-8 py-4 text-lg w-full sm:w-auto text-gray-700 hover:text-gray-900 bg-gray-100 hover:bg-gray-200"
            >
              View Pricing
            </Link>
          </motion.div>

          {/* Minimalist UI Preview / Graphic underneath Hero */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-24 w-full max-w-5xl mx-auto relative"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/50 to-white z-10 pointer-events-none h-[120%]" />
            <div className="rounded-2xl border border-gray-200 bg-white shadow-2xl p-2 relative overflow-hidden">
               <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#3079FF] to-[#0000EE]" />
               
               {/* Mock UI Header */}
               <div className="border-b border-gray-100 p-4 flex items-center justify-between bg-gray-50/50 rounded-t-xl">
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-400" />
                      <div className="w-3 h-3 rounded-full bg-yellow-400" />
                      <div className="w-3 h-3 rounded-full bg-green-400" />
                    </div>
                    <div className="text-sm text-gray-500 font-mono ml-4 px-3 py-1 bg-white border border-gray-200 rounded-md">
                      scan-report-main.json
                    </div>
                  </div>
               </div>

               {/* Mock UI Body */}
               <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                  <div className="col-span-2 space-y-4">
                     <div className="flex items-start gap-4 p-4 rounded-xl border border-red-100 bg-red-50/50">
                        <AlertTriangle className="w-6 h-6 text-red-500 mt-1 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-red-900">Exposed Supabase Service Role Key</h4>
                          <p className="text-sm text-red-700/80 mt-1">Found in app/api/admin/route.ts line 14. This key bypasses RLS policies.</p>
                        </div>
                     </div>
                     <div className="flex items-start gap-4 p-4 rounded-xl border border-yellow-100 bg-yellow-50/50">
                        <Zap className="w-6 h-6 text-yellow-600 mt-1 shrink-0" />
                        <div>
                          <h4 className="font-semibold text-yellow-900">Missing Rate Limiting</h4>
                          <p className="text-sm text-yellow-700/80 mt-1">Authentication endpoints lack rate limiting, susceptible to brute force.</p>
                        </div>
                     </div>
                  </div>
                  
                  <div className="col-span-1 border border-gray-100 rounded-xl p-6 flex flex-col items-center justify-center text-center bg-gray-50/50">
                     <div className="w-24 h-24 rounded-full border-8 border-red-500 flex items-center justify-center mb-4">
                        <span className="text-3xl font-bold text-gray-900">F</span>
                     </div>
                     <h4 className="font-semibold">Security Score</h4>
                     <p className="text-sm text-gray-500 mt-2">Fix critical issues before deploying to production.</p>
                  </div>
               </div>
            </div>
          </motion.div>
        </section>

        {/* ─── STORY SECTION: THE PROBLEM ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative bg-gray-50 border-y border-gray-200">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-4xl md:text-5xl font-bold mb-8 tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
              Fix before they find out.
            </h2>
            <p className="text-xl text-gray-600 leading-relaxed mb-16" style={{ fontFamily: "var(--font-landing-body)" }}>
              Cursor and Windsurf are amazing at writing code fast. But they lack context on security best practices, production configuration, and your business logic. You deploy fast, but you carry the risk of exposed keys, unoptimized queries, and broken auth flows.
            </p>

            <div className="grid md:grid-cols-2 gap-8">
              {[
                { title: "Security Leaks", icon: <Lock className="w-6 h-6 text-red-500" />, desc: "AI often hardcodes secrets or misconfigures Row Level Security." },
                { title: "Scale Bottlenecks", icon: <Zap className="w-6 h-6 text-yellow-500" />, desc: "Missing indexes, N+1 queries, and massive client-side bundles." },
              ].map((item, i) => (
                <div key={i} className="p-8 rounded-2xl bg-white border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                  <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center mb-6">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-gray-900">{item.title}</h3>
                  <p className="text-gray-600">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── FEATURES GRID (Reimagined for Light Theme) ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative bg-white">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-20 max-w-3xl mx-auto">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                Comprehensive analysis across the stack
              </h2>
              <p className="text-xl text-gray-600" style={{ fontFamily: "var(--font-landing-body)" }}>
                We don't just lint. We analyze your architecture, database rules, and API endpoints.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: <Shield className="w-6 h-6 text-[#3079FF]" />,
                  title: "Security Guard",
                  desc: "Detect exposed API keys, weak auth patterns, permissive CORS, and missing rate limits before attackers do.",
                  bg: "bg-blue-50/50",
                  border: "border-blue-100"
                },
                {
                  icon: <Zap className="w-6 h-6 text-yellow-600" />,
                  title: "Scalability Guard",
                  desc: "Spot unnecessary re-renders, massive client bundles, unoptimized images, and inefficient database queries.",
                  bg: "bg-yellow-50/50",
                  border: "border-yellow-100"
                },
                {
                  icon: <Globe className="w-6 h-6 text-purple-600" />,
                  title: "Production Guard",
                  desc: "Verify error boundaries, environment variables, missing meta tags, and critical deployment configs.",
                  bg: "bg-purple-50/50",
                  border: "border-purple-100"
                },
              ].map((feature, i) => (
                <div
                  key={i}
                  className={`p-8 rounded-2xl border ${feature.border} ${feature.bg} hover:shadow-lg transition-all duration-300 group bg-white`}
                >
                  <div className="w-12 h-12 rounded-xl bg-white border border-gray-100 shadow-sm flex items-center justify-center mb-6 group-hover:-translate-y-1 transition-transform">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-gray-900">{feature.title}</h3>
                  <p className="text-gray-600 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── HOW IT WORKS (Vertical Flow) ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative bg-gray-50 border-t border-gray-200">
          <div className="max-w-4xl mx-auto">
             <div className="text-center mb-20">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                Three steps to safety.
              </h2>
            </div>

            <div className="space-y-16">
              {[
                { step: "01", title: "Connect GitHub", desc: "Authorize ShipGuard to access your repository. We only ask for read access." },
                { step: "02", title: "Automated Analysis", desc: "Our engine scans your ASTs, dependencies, Next.js config, and Supabase schema." },
                { step: "03", title: "Review & Fix", desc: "Get specific, copy-pasteable fixes for identified issues directly in your dashboard." },
              ].map((item, i) => (
                <div key={i} className="flex gap-8 relative" >
                  {i !== 2 && <div className="absolute left-[27px] top-16 bottom-[-4rem] w-px bg-gray-300" />}
                  <div className="w-14 h-14 rounded-full border-2 border-gray-200 bg-white flex items-center justify-center text-lg font-bold text-[#0000EE] shrink-0 relative z-10 shadow-sm">
                    {item.step}
                  </div>
                  <div className="pt-2">
                    <h4 className="text-2xl font-bold mb-3 text-gray-900">{item.title}</h4>
                    <p className="text-lg text-gray-600">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── CTA SECTION ──────────────────────────────────────────────── */}
        <section className="py-40 px-6 relative bg-white border-t border-gray-200">
          <div className="absolute inset-0 bg-gradient-to-b from-[#3079FF]/5 to-transparent pointer-events-none" />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-5xl md:text-6xl font-bold mb-8 tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
              Ready to ship?
            </h2>
            <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto" style={{ fontFamily: "var(--font-landing-body)" }}>
              Join forward-thinking indie hackers securing their AI-generated apps. Prevent the nightmare scenario before it happens.
            </p>
            <Link
              href="/auth/signup"
              className="landing-btn-primary px-10 py-5 text-xl gap-2 shadow-lg hover:shadow-xl transition-all"
            >
              Start Free Trial
              <ArrowRight className="w-6 h-6" />
            </Link>
          </div>
        </section>

      </main>
      <LandingFooter />
    </div>
  );
}
