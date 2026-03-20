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
} from "lucide-react";
import { motion, useScroll, useTransform } from "framer-motion";
import LandingNavbar from "@/components/layout/LandingNavbar";
import LandingFooter from "@/components/layout/LandingFooter";
import { SquigglyLine } from "@/components/ui/squiggly-line";
import { GlowingBorder } from "@/components/ui/glowing-border";

export default function LandingPage() {
  const { scrollYProgress } = useScroll();
  
  // Subtle parallax for abstract background elements
  const y1 = useTransform(scrollYProgress, [0, 1], [0, 300]);
  const y2 = useTransform(scrollYProgress, [0, 1], [0, -200]);

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-gray-900 font-sans selection:bg-[#3079FF]/20 overflow-x-hidden relative">
      <LandingNavbar />

      {/* Abstract Grid Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden h-[120vh]">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,#000_70%,transparent_100%)] opacity-60" />
      </div>

      <main className="relative z-10">
        {/* ─── HERO SECTION ──────────────────────────────────────────────── */}
        <section className="relative pt-48 pb-32 px-6 overflow-hidden min-h-[90vh] flex flex-col justify-center items-center text-center">
          
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-6xl md:text-8xl lg:text-[7rem] tracking-tight leading-[1.05] mb-8 font-bold text-gray-900"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Know before <br className="hidden md:block" />
            <span className="relative inline-block">
              you <span className="font-garamond italic pr-2 font-normal text-[#111827]">ship</span>
              <SquigglyLine className="absolute -bottom-4 left-0 w-full" />
            </span>.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-xl md:text-2xl text-gray-600 max-w-3xl mx-auto mb-12 leading-relaxed font-light"
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
              className="landing-btn-secondary px-8 py-4 text-lg w-full sm:w-auto gap-2 group hover:scale-[1.02] active:scale-[0.98] transition-transform shadow-lg shadow-black/5"
            >
              <Github className="w-5 h-5" />
              Scan GitHub Repo
            </Link>
          </motion.div>

          {/* Minimalist UI Preview / Graphic underneath Hero */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-24 w-full max-w-5xl mx-auto relative"
          >
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#FDFDFD]/80 to-[#FDFDFD] z-10 pointer-events-none h-[120%]" />
            <GlowingBorder>
              <div className="rounded-2xl border border-gray-200/60 bg-white/50 backdrop-blur-xl shadow-2xl shadow-black/[0.03] p-2 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#3079FF]/50 to-transparent" />
                
                {/* Mock UI Header */}
                <div className="border-b border-gray-100 p-4 flex items-center justify-between bg-white/50 rounded-t-xl">
                    <div className="flex items-center gap-3">
                      <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-red-400" />
                        <div className="w-3 h-3 rounded-full bg-yellow-400" />
                        <div className="w-3 h-3 rounded-full bg-green-400" />
                      </div>
                      <div className="text-sm text-gray-500 font-mono ml-4 px-3 py-1 bg-gray-50 border border-gray-100 rounded-md">
                        scan-report-main.json
                      </div>
                    </div>
                </div>

                {/* Mock UI Body */}
                <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6 text-left bg-white/30">
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
                    
                    <div className="col-span-1 border border-gray-100 rounded-xl p-6 flex flex-col items-center justify-center text-center bg-white shadow-sm">
                      <div className="w-24 h-24 rounded-full border-8 border-red-50 flex items-center justify-center mb-4 relative">
                          <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="46" fill="none" stroke="#ef4444" strokeWidth="8" strokeDasharray="289" strokeDashoffset="230" className="opacity-20" />
                            <circle cx="50" cy="50" r="46" fill="none" stroke="#ef4444" strokeWidth="8" strokeDasharray="289" strokeDashoffset="180" strokeLinecap="round" />
                          </svg>
                          <span className="text-3xl font-bold text-gray-900 font-garamond italic">F</span>
                      </div>
                      <h4 className="font-semibold font-garamond text-xl">Security Score</h4>
                      <p className="text-sm text-gray-500 mt-2">Critical issues require immediate attention.</p>
                    </div>
                </div>
              </div>
            </GlowingBorder>
          </motion.div>
        </section>

        {/* ─── STORY SECTION: ALTERNATING LAYOUT ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative bg-white border-y border-gray-100">
          <div className="max-w-6xl mx-auto space-y-32">
            
            {/* Left Text, Right Image */}
            <div className="flex flex-col md:flex-row items-center gap-16">
              <div className="flex-1 space-y-6">
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                  Speed shouldn't <br/>mean <span className="font-garamond italic font-normal">vulnerability</span>.
                </h2>
                <p className="text-xl text-gray-600 leading-relaxed font-light">
                  Cursor and Windsurf are amazing at writing code fast. But they lack context on security best practices, production configuration, and your specific business logic.
                </p>
                <ul className="space-y-4 pt-4">
                  {['Detect hardcoded secrets & weak auth', 'Spot unoptimized queries & N+1 issues', 'Verify error boundaries & configs'].map((item, i) => (
                    <li key={i} className="flex items-center gap-3 text-gray-700">
                      <CheckCircle className="w-5 h-5 text-[#3079FF]" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex-1 w-full">
                <GlowingBorder>
                  <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 aspect-square flex items-center justify-center relative overflow-hidden">
                     {/* Decorative code visualization */}
                     <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(68,64,60,0.05)_50%,transparent_75%,transparent_100%)] bg-[length:250px_250px] animate-[gradient_3s_linear_infinite]" />
                     <div className="relative z-10 w-full max-w-sm space-y-4 font-mono text-sm opacity-80">
                       <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                       <div className="h-4 bg-red-200 rounded w-full"></div>
                       <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                       <div className="h-4 bg-gray-200 rounded w-2/3 ml-4"></div>
                       <div className="h-4 bg-yellow-200 rounded w-full ml-4"></div>
                     </div>
                  </div>
                </GlowingBorder>
              </div>
            </div>

            {/* Right Text, Left Image */}
            <div className="flex flex-col md:flex-row-reverse items-center gap-16">
              <div className="flex-1 space-y-6">
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                  Deep integration <br/>with <span className="font-garamond italic font-normal">your stack</span>.
                </h2>
                <p className="text-xl text-gray-600 leading-relaxed font-light">
                  We don't just lint generic JavaScript. We analyze your Next.js architecture, Supabase RLS policies, and API endpoint configurations.
                </p>
                <div className="flex gap-4 pt-4">
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 shadow-sm flex items-center gap-2">
                    <div className="w-6 h-6 bg-black rounded-full text-white flex items-center justify-center text-xs font-bold">N</div>
                    <span className="font-semibold text-sm">Next.js</span>
                  </div>
                  <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 shadow-sm flex items-center gap-2">
                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-xs">S</div>
                    <span className="font-semibold text-sm">Supabase</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 w-full">
                <GlowingBorder>
                  <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 aspect-square flex items-center justify-center relative overflow-hidden">
                     {/* Decorative architecture visualization */}
                     <div className="flex flex-col items-center gap-6 relative z-10 w-full">
                       <div className="w-full p-4 bg-white rounded-lg border border-gray-200 shadow-sm text-center font-mono text-sm font-semibold text-gray-700">Frontend (App Router)</div>
                       <div className="h-8 w-px bg-blue-300 relative">
                         <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-[#3079FF] rounded-full animate-ping" />
                       </div>
                       <div className="w-full p-4 bg-white rounded-lg border border-red-200 shadow-sm text-center font-mono text-sm font-semibold text-red-600 relative overflow-hidden">
                         <div className="absolute inset-0 bg-red-50 opacity-50" />
                         <span className="relative z-10">API Route (Missing RLS)</span>
                       </div>
                       <div className="h-8 w-px bg-blue-300" />
                       <div className="w-full p-4 bg-white rounded-lg border border-gray-200 shadow-sm text-center font-mono text-sm font-semibold text-gray-700">PostgreSQL DB</div>
                     </div>
                  </div>
                </GlowingBorder>
              </div>
            </div>

          </div>
        </section>

        {/* ─── PRICING SECTION ──────────────────────────────────────────────── */}
        <section id="pricing" className="py-32 px-6 relative bg-[#FAFAFA] border-y border-gray-100">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 mb-4" style={{ fontFamily: "var(--font-landing-heading)" }}>
                Simple, transparent <span className="font-garamond italic font-normal">pricing</span>
              </h2>
              <p className="text-xl text-gray-600 font-light">
                Secure your codebase, completely free to start.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
              {/* Free Tier */}
              <div className="p-8 rounded-3xl bg-white border border-gray-200 hover:shadow-lg transition-shadow flex flex-col">
                <div className="mb-8">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Free</h3>
                  <div className="flex items-baseline gap-2">
                    <div className="text-4xl font-bold text-gray-900 font-mono tracking-tight">$0</div>
                    <span className="text-gray-500">/month</span>
                  </div>
                  <p className="text-gray-500 mt-2">Perfect for trying it out</p>
                </div>
                <ul className="space-y-4 mb-8 flex-1">
                  {['1 Repository', 'Basic security scans', 'Community support', 'Public repos only'].map((feature, i) => (
                    <li key={i} className="flex items-center gap-3 text-gray-600">
                      <CheckCircle className="w-5 h-5 text-gray-400" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className="w-full py-4 rounded-full border border-gray-300 text-center font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Start for free
                </Link>
              </div>

              {/* Pro Tier */}
              <div className="p-8 rounded-3xl bg-gray-900 text-white shadow-2xl shadow-gray-900/20 relative overflow-hidden flex flex-col">
                <div className="absolute top-0 right-0 p-4">
                  <span className="px-3 py-1 bg-white/10 rounded-full text-xs font-medium text-white/90 backdrop-blur-sm">Most Popular</span>
                </div>
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-500/20 to-purple-500/20 blur-xl z-0" />
                <div className="relative z-10">
                  <div className="mb-8">
                    <h3 className="text-2xl font-bold text-white mb-2">Pro</h3>
                    <div className="flex items-baseline gap-2">
                      <div className="text-4xl font-bold text-white font-mono tracking-tight">$15</div>
                      <span className="text-gray-400">/month</span>
                    </div>
                    <p className="text-gray-400 mt-2">For serious makers & startups</p>
                  </div>
                  <ul className="space-y-4 mb-8 flex-1">
                    {[
                      'Unlimited Repositories', 
                      'Deep architectural analysis', 
                      'Private & Public repos', 
                      'Priority support',
                      'Custom scan rules'
                    ].map((feature, i) => (
                      <li key={i} className="flex items-center gap-3 text-gray-200">
                        <CheckCircle className="w-5 h-5 text-[#3079FF]" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/auth/signup?plan=pro"
                    className="w-full py-4 rounded-full bg-white text-black text-center font-medium hover:bg-gray-100 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.3)]"
                  >
                    Upgrade to Pro
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA SECTION ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative bg-[#111827] text-white overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(48,121,255,0.15)_0%,transparent_70%)]" />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-5xl md:text-6xl font-bold mb-8 tracking-tight text-white" style={{ fontFamily: "var(--font-landing-heading)" }}>
              Ready to <span className="font-garamond italic font-normal">ship</span>?
            </h2>
            <p className="text-xl text-gray-300 mb-12 max-w-2xl mx-auto font-light" style={{ fontFamily: "var(--font-landing-body)" }}>
              Join forward-thinking developers securing their AI-generated apps. Prevent the nightmare scenario before it happens.
            </p>
            <Link
              href="/auth/signup"
              className="landing-btn-primary px-10 py-5 text-xl gap-2 shadow-2xl hover:shadow-white/20 transition-all border-0 text-black bg-white"
            >
              Start Scanning Now
              <ArrowRight className="w-6 h-6" />
            </Link>
          </div>
        </section>

      </main>
      <LandingFooter />
    </div>
  );
}
