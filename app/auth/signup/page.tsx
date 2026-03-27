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
  Shield,
  Zap,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase";
import Image from "next/image";

function GoogleIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

function getPostConfirmRedirectUrl() {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

  return `${baseUrl}/dashboard`;
}

const perks = [
  "Free security scans",
  "Full architectural analysis",
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
  const [isGithubLoading, setIsGithubLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [step, setStep] = useState<"form" | "verify" | "error">("form");
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: getPostConfirmRedirectUrl(),
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      setStep("error");
      return;
    }

    const isRepeatedSignup =
      Array.isArray(data.user?.identities) && data.user?.identities.length === 0;

    if (isRepeatedSignup) {
      setLoading(false);
      setStep("error");
      setError(
        "This email is already registered. Try signing in, resetting your password, or using Resend verification from the login page.",
      );
      return;
    }

    setLoading(false);

    if (data.session) {
      router.push("/dashboard");
      return;
    }

    setVerifyMessage(
      "Verification email sent. If it does not arrive in 1-2 minutes, use Resend and check spam/promotions.",
    );
    setStep("verify");
  };

  if (step === "verify") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] font-sans">
        <div className="max-w-md w-full px-8 text-center bg-white p-12 rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50">
          <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-8 bg-blue-50 border-8 border-blue-100/50">
            <Mail className="w-8 h-8 text-[#3079FF]" />
          </div>
          <h1
            className="text-3xl font-bold tracking-tight text-gray-900 mb-4"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Check your email
          </h1>
          <p className="text-gray-600 mb-8 leading-relaxed">
            We sent a verification link to{" "}
            <span className="font-semibold text-gray-900">{email}</span>. Click
            the link to activate your account and start scanning.
          </p>
          {verifyMessage && (
            <p
              className="mb-5 text-sm text-gray-600"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {verifyMessage}
            </p>
          )}
          <div className="mb-6">
            <button
              type="button"
              onClick={async () => {
                setResending(true);
                setResendMessage(null);
                const supabase = createClient();
                const { error: resendError } = await supabase.auth.resend({
                  type: "signup",
                  email,
                  options: { emailRedirectTo: getPostConfirmRedirectUrl() },
                });
                if (resendError) {
                  setResendMessage(resendError.message);
                } else {
                  setResendMessage("Verification email sent again. Check spam/promotions too.");
                }
                setResending(false);
              }}
              disabled={resending}
              className="inline-flex items-center justify-center px-4 py-2 rounded-full border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {resending ? "Resending..." : "Resend email"}
            </button>
            {resendMessage && (
              <p className="mt-3 text-sm text-gray-600" style={{ fontFamily: "var(--font-landing-body)" }}>
                {resendMessage}
              </p>
            )}
          </div>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 text-sm font-medium text-[#3079FF] hover:text-[#0000EE] transition-colors"
          >
            Back to sign in
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-white font-sans text-gray-900 selection:bg-[#3079FF]/20">
      {/* Left panel — decorative */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-16 relative overflow-hidden bg-[#FAFAFA] border-r border-gray-100">
        {/* Subtle Background Elements */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(48,121,255,0.05)_0%,transparent_70%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#f0f0f0_1px,transparent_1px),linear-gradient(to_bottom,#f0f0f0_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_50%,#000_20%,transparent_100%)] opacity-30 pointer-events-none" />

        {/* Logo */}
        <Link
          href="/"
          className="relative flex items-center gap-3 w-fit z-10 group"
        >
          <Image
            src="/graft.svg"
            alt="Graft"
            width={32}
            height={32}
            className="h-8 w-auto group-hover:scale-105 transition-transform"
          />
          <span
            className="font-bold text-lg tracking-tight text-gray-900"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Graft
          </span>
        </Link>

        {/* Center copy */}
        <div className="relative z-10 max-w-lg mt-12">
          <h2
            className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900 mb-8 leading-[1.1]"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Everything you need
            <br />
            to <span className="font-garamond italic font-normal">
              ship
            </span>{" "}
            with confidence
          </h2>

          <ul className="flex flex-col gap-5">
            {perks.map((perk) => (
              <li key={perk} className="flex items-center gap-4 group">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-blue-50 border border-blue-100 text-[#3079FF] group-hover:scale-110 transition-transform">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <span className="text-gray-700 font-medium text-lg">
                  {perk}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom stat */}
        <div />
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white relative z-10">
        <div className="w-full max-w-[380px]">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-12 lg:hidden justify-center">
            <Image
              src="/graft.svg"
              alt="Graft"
              width={32}
              height={32}
              className="h-8 w-auto"
            />
            <span
              className="font-bold text-lg tracking-tight text-gray-900"
              style={{ fontFamily: "var(--font-landing-heading)" }}
            >
              Graft
            </span>
          </div>

          <div className="mb-8 text-center lg:text-left">
            <h1
              className="text-3xl font-bold tracking-tight text-gray-900 mb-2"
              style={{ fontFamily: "var(--font-landing-heading)" }}
            >
              Create your account
            </h1>
            <p className="text-gray-500 text-sm">
              Free forever. No credit card required.
            </p>
          </div>

          {step === "error" && error && (
            <div className="mb-6 p-4 rounded-xl text-sm bg-red-50 text-red-600 border border-red-100 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Social Auth */}
          <div className="space-y-3 mb-8">
            <button
              type="button"
              disabled={loading || isGithubLoading || isGoogleLoading}
              onClick={async () => {
                setError("");
                setIsGithubLoading(true);
                const supabase = createClient();
                const { error: oauthError } =
                  await supabase.auth.signInWithOAuth({
                    provider: "github",
                    options: {
                      redirectTo: getAuthRedirectUrl(),
                      scopes: "repo read:org user:email",
                      queryParams: {
                        prompt: "select_account",
                      },
                    },
                  });
                if (oauthError) {
                  setError(oauthError.message);
                  setIsGithubLoading(false);
                }
              }}
              className="w-full flex items-center justify-center gap-3 py-3 rounded-full border border-gray-200 bg-white text-gray-900 font-medium text-sm hover:bg-gray-50 transition-colors shadow-sm"
            >
              {isGithubLoading ? (
                <div className="w-5 h-5 rounded-full border-2 border-gray-900/25 border-t-gray-900 animate-spin" />
              ) : (
                <>
                  <Github className="w-5 h-5" />
                  Continue with GitHub
                </>
              )}
            </button>

            <button
              type="button"
              disabled={loading || isGithubLoading || isGoogleLoading}
              onClick={async () => {
                setError("");
                setIsGoogleLoading(true);
                const supabase = createClient();
                const { error: oauthError } =
                  await supabase.auth.signInWithOAuth({
                    provider: "google",
                    options: {
                      redirectTo: getAuthRedirectUrl(),
                    },
                  });
                if (oauthError) {
                  setError(oauthError.message);
                  setIsGoogleLoading(false);
                }
              }}
              className="w-full flex items-center justify-center gap-3 py-3 rounded-full border border-gray-200 bg-white text-gray-900 font-medium text-sm hover:bg-gray-50 transition-colors shadow-sm"
            >
              {isGoogleLoading ? (
                <div className="w-5 h-5 rounded-full border-2 border-gray-900/25 border-t-gray-900 animate-spin" />
              ) : (
                <>
                  <GoogleIcon />
                  Continue with Google
                </>
              )}
            </button>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-4 mb-8">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
              or with email
            </span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3079FF]/20 focus:border-[#3079FF] transition-all bg-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3079FF]/20 focus:border-[#3079FF] transition-all bg-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="block w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#3079FF]/20 focus:border-[#3079FF] transition-all bg-white"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5" />
                  ) : (
                    <Eye className="h-5 w-5" />
                  )}
                </button>
              </div>

              {/* Password strength meter */}
              {password && (
                <div className="flex gap-1.5 mt-3">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`flex-1 h-1.5 rounded-full transition-all duration-300 ${
                        password.length >= i * 2
                          ? i <= 2
                            ? "bg-red-400"
                            : i === 3
                              ? "bg-yellow-400"
                              : "bg-green-500"
                          : "bg-gray-100"
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-full font-medium text-sm flex items-center justify-center gap-2 mt-2 transition-all duration-200 disabled:opacity-70 bg-[#111827] text-white hover:bg-black shadow-lg shadow-gray-900/10 hover:shadow-xl hover:shadow-gray-900/20 active:scale-[0.98]"
            >
              {loading ? (
                <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              ) : (
                <>
                  Create account
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <p className="text-center text-xs text-gray-500 mt-2 leading-relaxed">
              By signing up, you agree to our{" "}
              <Link href="/terms" className="text-gray-900 hover:underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-gray-900 hover:underline">
                Privacy Policy
              </Link>
            </p>
          </form>

          <p className="text-center text-sm mt-8 text-gray-500">
            Already have an account?{" "}
            <Link
              href="/auth/login"
              className="text-[#111827] font-semibold hover:underline"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
