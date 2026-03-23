"use client";

import { useRef } from "react";
import { ShieldCheck, CheckCircle, ArrowRight, Terminal, Github } from "lucide-react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";

export function AnimatedBeamSection() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLDivElement>(null);
  const toRef = useRef<HTMLDivElement>(null);

  return (
    <div className="relative flex flex-col md:flex-row items-center gap-16">
      <div className="flex-1 space-y-6">
        <h2
          className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900"
          style={{ fontFamily: "var(--font-landing-heading)" }}
        >
          One click <br />
          to{" "}
          <span className="font-garamond italic font-normal">
            peace of mind
          </span>
          .
        </h2>
        <p className="text-xl text-gray-600 leading-relaxed font-light">
          Connect your GitHub repo, click scan, and get a detailed report
          of every security issue — sorted by severity, with fix
          suggestions included.
        </p>
        <ul className="space-y-4 pt-4">
          {[
            "Auto-fix suggestions for every issue",
            "GitHub PR comments with context",
            "CI/CD integration in minutes",
          ].map((item, i) => (
            <li key={i} className="flex items-center gap-3 text-gray-700">
              <CheckCircle className="w-5 h-5 text-[#3079FF]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div ref={containerRef} className="flex-1 w-full relative">
        {/* Animated Beam connecting code to shield */}
        <div ref={fromRef} className="absolute -left-4 top-1/2 -translate-y-1/2 z-20">
          <div className="w-16 h-16 rounded-2xl bg-[#0D1117] border border-gray-700 flex items-center justify-center shadow-xl">
            <div className="flex flex-col items-center gap-1">
              <Github className="w-7 h-7 text-white" />
              <div className="flex gap-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              </div>
            </div>
          </div>
        </div>

        <AnimatedBeam
          containerRef={containerRef}
          fromRef={fromRef}
          toRef={toRef}
          curvature={80}
          duration={4}
          gradientStartColor="#3079FF"
          gradientStopColor="#8B5CF6"
          pathColor="#3079FF"
          pathWidth={2}
          pathOpacity={0.3}
        />

        <div ref={toRef} className="ml-12">
          <div className="rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-purple-600 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-semibold text-white text-sm">Graft Scan Report</div>
                  <div className="text-xs text-white/70">247 files · 2.3s scan time</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs font-mono border border-red-500/30">3 CRITICAL</span>
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs font-mono border border-yellow-500/30">5 WARN</span>
              </div>
            </div>

            {/* Terminal Output */}
            <div className="p-4 font-mono text-xs space-y-1.5 bg-[#0D1117]">
              <div className="text-[#7EE787] flex items-center gap-2">
                <Terminal size={10} className="shrink-0" />
                $ graft scan --repo myapp
              </div>
              <div className="text-gray-500 ml-4">Initializing security scan...</div>
              <div className="text-gray-500 ml-4">Analyzing 247 files across 12 directories</div>
              <div className="text-red-400 flex items-center gap-2 mt-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                CRITICAL: Exposed SUPABASE_SERVICE_ROLE_KEY
              </div>
              <div className="text-gray-500 ml-6 text-[10px]">app/api/admin/route.ts:14</div>
              <div className="text-yellow-400 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse shrink-0" />
                WARN: Missing rate limiting on /api/auth
              </div>
              <div className="text-[#3079FF] mt-3 flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-[#3079FF] shrink-0" />
                Scan complete — 3 issues found
              </div>
            </div>

            {/* CTA */}
            <div className="px-5 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <CheckCircle size={12} className="text-green-500" />
                Report ready
              </div>
              <div className="flex items-center gap-1 text-xs font-medium text-[#3079FF]">
                View full report <ArrowRight size={12} />
              </div>
            </div>
          </div>
        </div>

        {/* Background pattern for this section */}
        <div className="absolute -inset-8 -z-10 pointer-events-none">
          <AnimatedGridPattern
            numSquares={20}
            maxOpacity={0.08}
            duration={4}
            className="[mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)]"
          />
        </div>
      </div>
    </div>
  );
}
