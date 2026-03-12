"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Github, Mail, Eye, EyeOff, ArrowRight, Shield } from "lucide-react";
import { createClient } from "@/lib/supabase";

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // This function handles the form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Create Supabase client (this connects to your database)
    const supabase = createClient();

    // Try to sign in with email and password
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    // If there's an error, show it to the user
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // If successful, redirect to dashboard
    if (data.user) {
      router.push("/dashboard");
    } else {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex"
      style={{ background: "var(--obsidian)" }}
    >
      {/* Left panel — decorative */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 p-16 relative overflow-hidden"
        style={{
          background: "var(--obsidian-1)",
          borderRight: "1px solid var(--border)",
        }}
      >
        {/* Grid background */}
        <div className="absolute inset-0 grid-pattern opacity-30" />

        {/* Amber glow */}
        <div
          className="absolute bottom-0 left-0 w-[500px] h-[400px] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at bottom left, rgba(232,160,32,0.12) 0%, transparent 70%)",
          }}
        />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              background: "var(--accent)",
              fontFamily: "var(--font-ui)",
              fontSize: "18px",
              color: "var(--obsidian)",
              fontWeight: 700,
            }}
          >
            SG
          </div>
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            ShipGuard <span style={{ color: "var(--accent)" }}>AI</span>
          </span>
        </div>

        {/* Center copy */}
        <div className="relative">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-4"
            style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
          >
            Production readiness
          </p>
          <h2
            className="text-4xl leading-tight mb-6"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Know before you ship.
            <br />
            Fix before they find out.
          </h2>

          {/* Mini guard score cards */}
          <div className="flex flex-col gap-3 max-w-sm">
            {[
              {
                label: "Security Guard",
                score: 34,
                color: "var(--guard-security)",
              },
              {
                label: "Monetization Guard",
                score: 28,
                color: "var(--guard-monetize)",
              },
              {
                label: "Distribution Guard",
                score: 52,
                color: "var(--guard-distrib)",
              },
            ].map((g) => (
              <div
                key={g.label}
                className="flex items-center gap-4 p-3 rounded-lg"
                style={{
                  background: "var(--surface-3)",
                  border: "1px solid var(--border)",
                }}
              >
                <Shield size={14} style={{ color: g.color }} />
                <span
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-label)",
                  }}
                >
                  {g.label}
                </span>
                <div className="flex items-center gap-2">
                  <div
                    className="w-24 h-1.5 rounded-full"
                    style={{ background: "var(--obsidian-5)" }}
                  >
                    <div
                      style={{
                        width: `${g.score}%`,
                        height: "100%",
                        background: g.color,
                        borderRadius: "9999px",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: "12px",
                      color: g.color,
                      fontFamily: "var(--font-ui)",
                      fontWeight: 600,
                      width: 24,
                      textAlign: "right",
                    }}
                  >
                    {g.score}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom quote */}
        <div className="relative">
          <p
            className="text-sm italic"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-ui)",
            }}
          >
            &ldquo;ShipGuard found an exposed Stripe key and 3 CVEs I
            didn&apos;t know about. Fixed everything in a day.&rdquo;
          </p>
          <p
            className="text-xs mt-1"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-label)",
            }}
          >
            — Priya S., indie hacker
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div
              className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold"
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
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 600,
                letterSpacing: "-0.02em",
              }}
            >
              ShipGuard <span style={{ color: "var(--accent)" }}>AI</span>
            </span>
          </div>

          <div className="mb-8">
            <h1
              className="text-3xl mb-2"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Welcome back
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "14px",
                fontFamily: "var(--font-label)",
              }}
            >
              Sign in to your ShipGuard account
            </p>
          </div>

          {/* Error message */}
          {error && (
            <div
              className="mb-4 p-3 rounded-lg text-sm"
              style={{
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                color: "#ef4444",
              }}
            >
              {error}
            </div>
          )}

          {/* GitHub OAuth */}
          <button
            type="button"
            onClick={async () => {
              const supabase = createClient();
              await supabase.auth.signInWithOAuth({
                provider: "github",
                options: {
                  redirectTo: getAuthRedirectUrl(),
                },
              });
            }}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-lg mb-6 font-medium text-sm transition-all duration-200 hover:-translate-y-px"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
            }}
          >
            <Github size={17} />
            Continue with GitHub
          </button>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-6">
            <div
              className="flex-1 h-px"
              style={{ background: "var(--border)" }}
            />
            <span
              style={{
                color: "var(--text-tertiary)",
                fontSize: "12px",
                fontFamily: "var(--font-label)",
              }}
            >
              or with email
            </span>
            <div
              className="flex-1 h-px"
              style={{ background: "var(--border)" }}
            />
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Email */}
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-label)",
                }}
              >
                Email
              </label>
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-lg transition-all"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <Mail size={15} style={{ color: "var(--text-tertiary)" }} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-label)",
                  }}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  className="text-xs font-medium"
                  style={{
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-label)",
                  }}
                >
                  Password
                </label>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs transition-colors"
                  style={{
                    color: "var(--accent)",
                    fontFamily: "var(--font-label)",
                  }}
                >
                  Forgot password?
                </Link>
              </div>
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-lg"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-label)",
                  }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="opacity-40 hover:opacity-70 transition-opacity"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg font-semibold text-sm flex items-center justify-center gap-2 mt-2 transition-all duration-200 hover:-translate-y-0.5 disabled:opacity-60 disabled:translate-y-0"
              style={{
                background: "var(--accent)",
                color: "var(--obsidian)",
                fontFamily: "var(--font-ui)",
                boxShadow: "0 4px 20px var(--accent-glow-strong)",
              }}
            >
              {loading ? (
                <div className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          <p
            className="text-center text-sm mt-6"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-label)",
            }}
          >
            Don&apos;t have an account?{" "}
            <Link
              href="/auth/signup"
              style={{ color: "var(--accent)", fontWeight: 500 }}
            >
              Sign up free
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
