"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
import { createClient } from "@/lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { InteractiveHoverButton } from "@/components/ui/interactive-hover-button";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/#pricing", label: "Pricing" },
];

export default function LandingNavbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <header
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 w-[95%] max-w-5xl rounded-full",
        scrolled
          ? "bg-white/80 backdrop-blur-xl border border-gray-200 shadow-sm"
          : "bg-transparent border border-transparent"
      )}
    >
      <div className="px-6 h-16 flex items-center justify-between">
        {/* Logo and Name */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <Image src="/graft.svg" alt="Graft" width={32} height={32} className="h-8 w-auto transition-transform group-hover:scale-105" />
          <span className="font-bold text-lg tracking-tight text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
            Graft
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm transition-colors duration-150 font-semibold",
                pathname === link.href && link.href !== "/#pricing"
                  ? "text-gray-900"
                  : "text-gray-500 hover:text-gray-900"
              )}
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          {session ? (
            <Link
              href="/dashboard"
              className="landing-btn-secondary px-6 py-2.5 text-sm"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              Go to Dashboard
            </Link>
          ) : (
            <InteractiveHoverButton
              onClick={() => (window.location.href = "/auth/login")}
              hideDot
              className="bg-black text-white border-black hover:border-gray-900 text-sm"
            >
              Sign in
            </InteractiveHoverButton>
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden flex flex-col gap-1.5 p-2 focus:outline-none"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span
            className={cn("block w-5 h-px transition-all duration-200 bg-gray-900", mobileOpen ? "rotate-45 translate-y-[7px]" : "")}
          />
          <span
            className={cn("block w-5 h-px transition-all duration-200 bg-gray-900", mobileOpen ? "opacity-0" : "opacity-100")}
          />
          <span
            className={cn("block w-5 h-px transition-all duration-200 bg-gray-900", mobileOpen ? "-rotate-45 -translate-y-[7px]" : "")}
          />
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 bg-white px-6 py-6 flex flex-col gap-4 mt-2 rounded-2xl mx-auto w-full shadow-lg absolute top-full left-0">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "text-sm font-semibold",
                pathname === link.href ? "text-gray-900" : "text-gray-600"
              )}
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {link.label}
            </Link>
          ))}
          <div className="flex flex-col gap-3 pt-4 border-t border-gray-100">
            {session ? (
              <Link
                href="/dashboard"
                onClick={() => setMobileOpen(false)}
                className="landing-btn-secondary w-full py-3 text-sm"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                Go to Dashboard
              </Link>
            ) : (
              <Link
                href="/auth/login"
                onClick={() => setMobileOpen(false)}
                className="landing-btn-secondary w-full py-3 text-sm"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
