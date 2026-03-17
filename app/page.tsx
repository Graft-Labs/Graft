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
import { motion, AnimatePresence } from "framer-motion";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";

// ─── Score Ring Component ───────────────────────────────────────────────────────────
function ScoreRing({ score, color, size = 80 }: { score: number; color: string; size?: number }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox="0 0 80 80" className="-rotate-90">
      <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
      <motion.circle
        cx="40"
        cy="40"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1.5, ease: "easeOut", delay: 0.2 }}
      />
      <text
        x="50%"
        y="50%"
        dy=".3em"
        textAnchor="middle"
        fill="#fff"
        fontSize="18"
        fontWeight="600"
        className="rotate-90"
        style={{ fontFamily: "var(--font-ui)" }}
      >
        {score}
      </text>
    </svg>
  );
}

// ─── Main Landing Page ───────────────────────────────────────────────────
export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const features = [
    {
      icon: <Shield className="w-6 h-6" />,
      title: "Security & Secrets",
      desc: "Detect exposed API keys, weak auth patterns, and missing rate limits.",
    },
    {
      icon: <Zap className="w-6 h-6" />,
      title: "Performance & DX",
      desc: "Spot unnecessary re-renders, bloated bundles, and unoptimized assets.",
    },
    {
      icon: <Globe className="w-6 h-6" />,
      title: "Production Readiness",
      desc: "Verify error boundaries, environment variables, and deployment configs.",
    },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-[#f5f5f5] overflow-x-hidden selection:bg-[#ffdc61]/30 font-sans">
      <Navbar />

      <main>
        {/* ─── HERO SECTION ──────────────────────────────────────────────── */}
        <section className="relative pt-40 pb-20 md:pt-52 md:pb-32 px-6 overflow-hidden min-h-[90vh] flex flex-col justify-center">
          {/* Abstract Background Effects */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-[#ffdc61]/10 rounded-full blur-[120px] opacity-50" />
            <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] bg-[#806e31]/10 rounded-full blur-[100px]" />
            <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_40%,#000_70%,transparent_100%)]" />
          </div>

          <div className="max-w-4xl mx-auto text-center relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[#ffdc61]/30 bg-[#ffdc61]/10 text-[#ffdc61] text-sm font-medium mb-8"
            >
              <span className="flex h-2 w-2 rounded-full bg-[#ffdc61]">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-[#ffdc61] opacity-75"></span>
              </span>
              ShipGuard AI 2.0 is live
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-5xl md:text-7xl lg:text-8xl tracking-tight leading-[1.1] mb-8"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Ship with <br className="hidden md:block" />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ffdc61] via-[#806e31] to-[#ffdc61] animate-gradient-x relative">
                Absolute Confidence.
                <div className="absolute -bottom-2 left-0 w-full h-1 bg-gradient-to-r from-transparent via-[#ffdc61]/50 to-transparent blur-sm" />
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-lg md:text-xl text-[#a1a1aa] max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              AI writes the code. You own the risk. Automatically scan AI-generated Next.js & React apps for security flaws, performance bottlenecks, and production-readiness before you deploy.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                href="/scan/new"
                className="group relative inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#ffdc61] text-[#403718] rounded-lg font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98] w-full sm:w-auto overflow-hidden shadow-lg shadow-[#ffdc61]/20"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-[#806e31]/20 to-[#403718]/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                <Github className="w-5 h-5 relative z-10" />
                <span className="relative z-10">Scan GitHub Repo</span>
                <ArrowRight className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center px-8 py-4 rounded-lg font-medium text-lg border border-white/10 hover:bg-white/5 transition-colors w-full sm:w-auto"
              >
                View Pricing
              </Link>
            </motion.div>
          </div>
        </section>

        {/* ─── FEATURES GRID ──────────────────────────────────────────────── */}
        <section className="py-24 px-6 relative border-t border-white/5 bg-black/20">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-semibold mb-4 tracking-tight">Everything you need to ship safely</h2>
              <p className="text-gray-400 max-w-2xl mx-auto">Comprehensive analysis across the entire stack.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {features.map((feature, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="p-8 rounded-2xl bg-white/[0.02] border border-white/[0.05] hover:border-[#ffdc61]/30 transition-all duration-300 group"
                >
                  <div className="w-12 h-12 rounded-lg bg-[#ffdc61]/10 flex items-center justify-center mb-6 text-[#ffdc61] group-hover:scale-110 transition-transform">
                    {feature.icon}
                  </div>
                  <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                  <p className="text-[#a1a1aa] leading-relaxed">{feature.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── HOW IT WORKS (Minimalist) ──────────────────────────────────────────────── */}
        <section className="py-24 px-6 relative">
          <div className="max-w-7xl mx-auto">
            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div>
                <h2 className="text-3xl md:text-5xl font-semibold mb-6 tracking-tight leading-tight">
                  Connect. Scan. <br />
                  <span className="text-[#ffdc61]">Ship it.</span>
                </h2>
                <div className="space-y-8 mt-12">
                  {[
                    { step: "01", title: "Connect Repository", desc: "Paste your GitHub URL or connect your account directly." },
                    { step: "02", title: "Automated Analysis", desc: "Our engine scans ASTs, dependencies, and configurations." },
                    { step: "03", title: "Actionable Report", desc: "Get specific, copy-pasteable fixes for identified issues." },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-6 relative" >
                      {i !== 2 && <div className="absolute left-[23px] top-12 bottom-0 w-px bg-white/10" />}
                      <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center text-sm font-mono shrink-0 bg-[#0C0C0E] relative z-10">
                        {item.step}
                      </div>
                      <div>
                        <h4 className="text-xl font-medium mb-2">{item.title}</h4>
                        <p className="text-[#a1a1aa]">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Minimal Code Preview */}
              <div className="relative rounded-2xl border border-white/10 bg-[#111113] p-6 overflow-hidden shadow-2xl shadow-[#ffdc61]/10">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="font-mono text-sm space-y-3 text-[#a1a1aa]">
                  <div className="flex gap-4">
                    <span className="text-gray-600">1</span>
                    <span><span className="text-pink-400">import</span> {"{ useState }"} <span className="text-pink-400">from</span> <span className="text-green-400">"react"</span>;</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-gray-600">2</span>
                    <span><span className="text-blue-400">export default function</span> <span className="text-yellow-200">App</span>() {"{"}</span>
                  </div>
                  <div className="flex gap-4 relative">
                    <div className="absolute -inset-x-2 -inset-y-1 bg-red-500/10 border border-red-500/20 rounded z-0" />
                    <span className="text-gray-600 relative z-10">3</span>
                    <span className="relative z-10 ml-4">
                      <span className="text-pink-400">const</span> API_KEY = <span className="text-green-400">"sk_live_123..."</span>; <span className="text-red-400 ml-2">// CRITICAL: Exposed Secret</span>
                    </span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-gray-600">4</span>
                    <span className="ml-4">return &lt;div&gt;Hello World&lt;/div&gt;;</span>
                  </div>
                  <div className="flex gap-4">
                    <span className="text-gray-600">5</span>
                    {"}"}
                  </div>
                </div>
                
                {/* Floating Alert */}
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.5 }}
                  className="absolute bottom-6 right-6 p-4 rounded-xl bg-[#0a0a0c] shadow-xl flex items-center gap-3 border border-red-500/20"
                >
                  <AlertTriangle className="w-5 h-5 text-red-500" />
                  <div>
                    <div className="text-sm font-medium text-white">Secret Exposed</div>
                    <div className="text-xs text-gray-400">Move to .env files</div>
                  </div>
                </motion.div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── CTA SECTION ──────────────────────────────────────────────── */}
        <section className="py-32 px-6 relative border-t border-white/5">
          <div className="absolute inset-0 bg-[#ffdc61]/5" />
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-4xl md:text-5xl font-semibold mb-6 tracking-tight">Ready to ship confidently?</h2>
            <p className="text-xl text-[#a1a1aa] mb-10">Join forward-thinking developers securing their AI-generated apps.</p>
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#ffdc61] text-[#403718] rounded-lg font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-[#ffdc61]/20"
            >
              Start Free Trial
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </section>

      </main>
      <Footer />
    </div>
  );
}