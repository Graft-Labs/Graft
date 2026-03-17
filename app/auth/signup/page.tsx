"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Github,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  CheckCircle,
  User,
} from "lucide-react";
import { createClient } from "@/lib/supabase";

function GoogleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

const perks = [
  "1 free scan every month",
  "Full 4-Guard security report",
  "Copy-paste fix suggestions",
  "No credit card required",
];

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "verify" | "error">("form");
  const [error, setError] = useState("");

  // This function handles the form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Create Supabase client (this connects to your database)
    const supabase = createClient();

    // Try to sign up with email and password
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
    });

    // If there's an error, show it to the user
    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      setStep("error");
      return;
    }

    // If successful, show the "check your email" message
    // (Supabase sends a confirmation email by default)
    setLoading(false);
    setStep("verify");
  };

  // Show "check your email" screen after successful signup
  if (step === "verify") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--obsidian)" }}
      >
        <div className="max-w-md w-full px-8 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{
              background: "var(--accent-glow)",
              border: "1px solid var(--border-amber)",
            }}
          >
            <Mail size={28} style={{ color: "var(--accent)" }} />
          </div>
          <h1
            className="text-3xl mb-3"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Check your email
          </h1>
          <p
            className="text-sm leading-relaxed mb-8"
            style={{
              color: "var(--text-secondary)",
              fontFamily: "var(--font-label)",
            }}
          >
            We sent a verification link to{" "}
            <span style={{ color: "var(--text-primary)" }}>{email}</span>. Click
            the link to activate your account and start scanning.
          </p>
          <Link
            href="/auth/login"
            className="text-sm"
            style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ background: "var(--obsidian)" }}
    >
      {/* Left panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-1/2 p-16 relative overflow-hidden"
        style={{
          background: "var(--obsidian-1)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <div className="absolute inset-0 grid-pattern opacity-30" />
        <div
          className="absolute top-0 right-0 w-[500px] h-[400px] pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at top right, rgba(232,160,32,0.1) 0%, transparent 70%)",
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

        {/* Center content */}
        <div className="relative">
          <p
            className="text-xs font-semibold uppercase tracking-widest mb-4"
            style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
          >
            Free forever
          </p>
          <h2
            className="text-4xl leading-tight mb-8"
            style={{ fontFamily: "var(--font-ui)" }}
          >
            Everything you need
            <br />
            to ship with confidence
          </h2>

          <ul className="flex flex-col gap-4">
            {perks.map((perk) => (
              <li key={perk} className="flex items-center gap-3">
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    background: "var(--accent-glow)",
                    border: "1px solid var(--border-amber)",
                  }}
                >
                  <CheckCircle size={12} style={{ color: "var(--accent)" }} />
                </div>
                <span
                  style={{
                    fontSize: "14px",
                    color: "var(--text-secondary)",
                    fontFamily: "var(--font-label)",
                  }}
                >
                  {perk}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom stat */}
        <div className="relative">
          <div
            className="inline-block p-4 rounded-xl"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-ui)",

                fontSize: "40px",
                color: "var(--accent)",
                lineHeight: 1,
                marginBottom: 4,
              }}
            >
              847+
            </p>
            <p
              style={{
                color: "var(--text-tertiary)",
                fontSize: "13px",
                fontFamily: "var(--font-label)",
              }}
            >
              builders already scanning
            </p>
          </div>
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
              Create your account
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "14px",
                fontFamily: "var(--font-label)",
              }}
            >
              Free forever. No credit card required.
            </p>
          </div>

          {/* Error message */}
          {step === "error" && error && (
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
            className="w-full flex items-center justify-center gap-3 py-3 rounded-lg mb-3 font-medium text-sm transition-all duration-200 hover:-translate-y-px"
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

          {/* Google OAuth */}
          <button
            type="button"
            onClick={async () => {
              const supabase = createClient();
              await supabase.auth.signInWithOAuth({
                provider: "google",
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
            <GoogleIcon />
            Continue with Google
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

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div>
              <label
                className="block text-xs font-medium mb-1.5"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-label)",
                }}
              >
                Name
              </label>
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-lg"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <User size={15} style={{ color: "var(--text-tertiary)" }} />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-label)",
                  }}
                  required
                />
              </div>
            </div>

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
                className="flex items-center gap-3 px-4 py-3 rounded-lg"
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
              <label
                className="block text-xs font-medium mb-1.5"
                style={{
                  color: "var(--text-secondary)",
                  fontFamily: "var(--font-label)",
                }}
              >
                Password
              </label>
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
                  placeholder="Min. 8 characters"
                  className="flex-1 bg-transparent outline-none text-sm"
                  style={{
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-label)",
                  }}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="opacity-40 hover:opacity-70 transition-opacity"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              {password && (
                <div className="flex gap-1 mt-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="flex-1 h-1 rounded-full transition-all duration-300"
                      style={{
                        background:
                          password.length >= i * 2
                            ? i <= 2
                              ? "var(--guard-security)"
                              : i === 3
                                ? "var(--accent)"
                                : "var(--guard-monetize)"
                            : "var(--obsidian-5)",
                      }}
                    />
                  ))}
                </div>
              )}
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
                  Create account
                  <ArrowRight size={15} />
                </>
              )}
            </button>

            <p
              className="text-center text-xs leading-relaxed"
              style={{
                color: "var(--text-tertiary)",
                fontFamily: "var(--font-label)",
              }}
            >
              By signing up, you agree to our{" "}
              <Link href="#" style={{ color: "var(--text-secondary)" }}>
                Terms
              </Link>{" "}
              and{" "}
              <Link href="#" style={{ color: "var(--text-secondary)" }}>
                Privacy Policy
              </Link>
            </p>
          </form>

          <p
            className="text-center text-sm mt-6"
            style={{
              color: "var(--text-tertiary)",
              fontFamily: "var(--font-label)",
            }}
          >
            Already have an account?{" "}
            <Link
              href="/auth/login"
              style={{ color: "var(--accent)", fontWeight: 500 }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
