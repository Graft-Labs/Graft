"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const isDashboard = pathname.startsWith("/dashboard") || pathname.startsWith("/scan");

  return (
    <header
      className={cn(
        "fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 w-[95%] max-w-5xl rounded-full",
        scrolled
          ? "border shadow-lg backdrop-blur-xl"
          : "border border-transparent"
      )}
      style={{
        background: scrolled ? "rgba(10, 10, 10, 0.7)" : "transparent",
        borderColor: scrolled ? "rgba(255, 255, 255, 0.08)" : "transparent",
      }}
    >
      <div className="px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div
            className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold transition-all duration-200 group-hover:scale-105"
            style={{
              background: "var(--accent)",
              color: "var(--obsidian)",
              fontFamily: "var(--font-ui)",
              
              fontSize: "16px",
            }}
          >
            SG
          </div>
          <span
            className="font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-ui)", fontSize: "15px", letterSpacing: "-0.02em" }}
          >
            ShipGuard
            <span style={{ color: "var(--accent)" }}> AI</span>
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8 absolute left-1/2 -translate-x-1/2">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                "text-sm transition-colors duration-150",
                pathname === link.href
                  ? "font-medium"
                  : "hover:opacity-100 opacity-60"
              )}
              style={{
                fontFamily: "var(--font-label)",
                color: pathname === link.href ? "var(--accent)" : "var(--text-primary)",
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/auth/login"
            className="text-sm px-4 py-2 rounded transition-colors duration-150"
            style={{
              fontFamily: "var(--font-label)",
              color: "var(--text-secondary)",
            }}
          >
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="text-sm px-5 py-2 rounded-md font-semibold transition-all duration-200 hover:-translate-y-px"
            style={{
              background: "var(--accent)",
              color: "var(--obsidian)",
              fontFamily: "var(--font-ui)",
            }}
          >
            Start Free Scan
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden flex flex-col gap-1.5 p-2 focus:outline-none"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <span
            className={cn("block w-5 h-px transition-all duration-200", mobileOpen ? "rotate-45 translate-y-[7px]" : "")}
            style={{ background: "var(--text-primary)" }}
          />
          <span
            className={cn("block w-5 h-px transition-all duration-200", mobileOpen ? "opacity-0" : "opacity-100")}
            style={{ background: "var(--text-primary)" }}
          />
          <span
            className={cn("block w-5 h-px transition-all duration-200", mobileOpen ? "-rotate-45 -translate-y-[7px]" : "")}
            style={{ background: "var(--text-primary)" }}
          />
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="md:hidden border-t px-6 py-6 flex flex-col gap-4 mt-2 rounded-2xl mx-auto w-[95%] max-w-5xl fixed top-20 left-1/2 -translate-x-1/2 z-40 backdrop-blur-xl border shadow-2xl"
          style={{
            background: "rgba(10, 10, 10, 0.95)",
            borderColor: "rgba(255, 255, 255, 0.08)",
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="text-sm"
              style={{
                fontFamily: "var(--font-label)",
                color: pathname === link.href ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {link.label}
            </Link>
          ))}
          <div className="flex flex-col gap-2 pt-4 border-t" style={{ borderColor: "var(--border)" }}>
            <Link
              href="/auth/login"
              onClick={() => setMobileOpen(false)}
              className="text-sm text-center py-2"
              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
            >
              Sign in
            </Link>
            <Link
              href="/auth/signup"
              onClick={() => setMobileOpen(false)}
              className="text-sm text-center py-2.5 rounded-md font-semibold"
              style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-ui)" }}
            >
              Start Free Scan
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
