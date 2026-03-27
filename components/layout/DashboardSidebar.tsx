"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  LayoutDashboard,
  Shield,
  PlusCircle,
  Settings,
  LogOut,
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";
import { getCached, setCached, clearCacheByPrefix } from "@/lib/client-cache";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/scan/new", label: "New Scan", icon: PlusCircle },
  { href: "/dashboard/history", label: "Scan History", icon: Shield },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{
    email?: string | null;
    user_metadata?: {
      full_name?: string;
      name?: string;
      avatar_url?: string;
      picture?: string;
    };
  } | null>(null);
  const [userData, setUserData] = useState<{
    plan: string;
    scans_used: number;
    scans_limit: number;
    name?: string | null;
    email?: string | null;
    avatar_url?: string | null;
  } | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Fetch user on load
  useEffect(() => {
    async function fetchUser() {
      // Clear stale cache before fetching to ensure fresh plan data
      clearCacheByPrefix("sidebar:");

      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        try {
          const response = await fetch("/api/subscription/status", {
            credentials: "include",
          });
          const statusData = await response.json();
          
          const { data } = await supabase
            .from("users")
            .select(
              "plan, scans_used, scans_limit, name, email, avatar_url, github_token",
            )
            .eq("id", user.id)
            .single();
          
          const freshPlan = statusData?.plan || data?.plan || "free";
          const freshScansLimit = statusData?.scansLimit ?? data?.scans_limit ?? 3;
          
          const mergedData = {
            plan: freshPlan,
            scans_used: data?.scans_used ?? 0,
            scans_limit: freshScansLimit,
            name: data?.name ?? null,
            email: data?.email ?? null,
            avatar_url: data?.avatar_url ?? null,
            github_token: data?.github_token ?? null,
          };
          
          setUserData(mergedData);
          setCached("sidebar:user", { user, userData: mergedData }, 60_000);
        } catch (error) {
          console.error("Failed to fetch subscription status:", error);
          const { data } = await supabase
            .from("users")
            .select(
              "plan, scans_used, scans_limit, name, email, avatar_url, github_token",
            )
            .eq("id", user.id)
            .single();
          setUserData(data);
          setCached("sidebar:user", { user, userData: data }, 60_000);
        }
      }

      setLoadingUser(false);
    }
    fetchUser();
  }, []);

  // Function to handle logout
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  // Get user info from GitHub metadata or email
  const userEmail = userData?.email || user?.email || "";
  const userName =
    userData?.name ||
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    (userEmail ? userEmail.split("@")[0] : "");
  const avatarUrl =
    userData?.avatar_url ||
    user?.user_metadata?.avatar_url ||
    user?.user_metadata?.picture ||
    null;

  // Plan display
  const plan = userData?.plan || "free";
  const scansUsed = userData?.scans_used ?? 0;
  const scansLimit = userData?.scans_limit ?? 3;
  const planDisplay =
    plan === "free"
      ? "Free Plan"
      : plan === "pro"
        ? "Pro Plan"
        : plan === "unlimited"
          ? "Unlimited Plan"
          : plan === "lifetime"
            ? "Lifetime Plan"
            : "Free Plan";
  const scansDisplay =
    scansLimit >= 999999
      ? "Unlimited scans"
      : `${scansUsed}/${scansLimit} scans used`;

  // Sidebar content (reusable for both desktop and mobile)
  const sidebarContent = (
    <>
      {/* Logo */}
      <div
        className="h-16 flex items-center px-6 border-b"
        style={{ borderColor: "var(--landing-border)", background: "#FFFFFF" }}
      >
        <Link href="/" className="flex items-center gap-2 group">
          <Image
            src="/graft.svg"
            alt="Graft"
            width={32}
            height={32}
            className="h-8 w-auto transition-transform group-hover:scale-105"
          />
          <span
            className="font-bold text-lg text-gray-900 tracking-tight"
            style={{ fontFamily: "var(--font-landing-heading)" }}
          >
            Graft
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 flex flex-col gap-1.5 overflow-y-auto">
        <div
          className="mb-2 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider"
          style={{ fontFamily: "var(--font-landing-body)" }}
        >
          Menu
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileMenuOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                isActive
                  ? "font-semibold bg-white shadow-sm ring-1 ring-gray-900/5 text-gray-900"
                  : "font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100",
              )}
              style={{
                fontFamily: "var(--font-landing-body)",
              }}
            >
              <Icon
                size={18}
                strokeWidth={isActive ? 2.5 : 2}
                className={isActive ? "text-[#3079FF]" : "text-gray-400"}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User / Bottom */}
      <div
        className="p-4 border-t bg-white"
        style={{ borderColor: "var(--landing-border)" }}
      >
        {/* Plan badge */}
        {loadingUser ? (
          <div className="flex items-center justify-between p-3 rounded-xl mb-3 animate-pulse" style={{ background: "#F9FAFB", border: "1px solid var(--landing-border)" }}>
            <div className="space-y-1.5">
              <div className="h-4 w-20 bg-gray-200 rounded" />
              <div className="h-3 w-24 bg-gray-200 rounded" />
            </div>
            <div className="h-6 w-14 bg-gray-200 rounded-full" />
          </div>
        ) : (
          <div
            className="flex items-center justify-between p-3 rounded-xl mb-3 shadow-sm"
            style={{
              background: "#F9FAFB",
              border: "1px solid var(--landing-border)",
            }}
          >
            <div>
              <p
                className="text-sm font-semibold text-gray-900"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                {planDisplay}
              </p>
              <p
                className="text-xs text-gray-500 font-medium mt-0.5"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                {scansDisplay}
              </p>
            </div>
            {scansLimit < 999999 && (
              <Link
                href="/dashboard/settings?tab=billing"
                onClick={() => setMobileMenuOpen(false)}
                className="text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm hover:-translate-y-0.5 transition-transform"
                style={{
                  background: "var(--landing-primary)",
                  color: "#FFFFFF",
                  fontFamily: "var(--font-landing-body)",
                }}
              >
                Upgrade
              </Link>
            )}
          </div>
        )}

        {/* User */}
        <div className="flex items-center gap-3 px-2 py-1.5">
          {loadingUser ? (
            <div className="w-9 h-9 rounded-full flex-shrink-0 animate-pulse bg-gray-200" />
          ) : avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName || "User avatar"}
              className="w-9 h-9 rounded-full flex-shrink-0 shadow-sm border border-gray-200"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm border border-gray-200"
              style={{
                background: "#F3F4F6",
                color: "var(--landing-primary)",
                fontFamily: "var(--font-landing-heading)",
              }}
            >
              {(userName || "U").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p
              className="text-sm font-semibold truncate text-gray-900"
              style={{ fontFamily: "var(--font-landing-body)" }}
            >
              {loadingUser ? "Loading..." : userName || "Account"}
            </p>
            {userEmail && (
              <p
                className="text-xs text-gray-500 truncate"
                style={{ fontFamily: "var(--font-landing-body)" }}
              >
                {userEmail}
              </p>
            )}
          </div>
          <button
            className="p-2 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-900 transition-colors"
            title="Sign out"
            onClick={handleLogout}
          >
            <LogOut size={16} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileMenuOpen(true)}
        className="lg:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-white border shadow-sm"
        aria-label="Open menu"
      >
        <Menu size={24} className="text-gray-700" />
      </button>

      {/* Mobile drawer overlay */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <aside
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out",
          mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ background: "#FFFFFF" }}
      >
        <div className="flex flex-col h-full">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="absolute top-4 right-4 p-2 rounded-lg hover:bg-gray-100"
            aria-label="Close menu"
          >
            <X size={20} className="text-gray-500" />
          </button>
          {sidebarContent}
        </div>
      </aside>

      {/* Desktop sidebar */}
      <aside
        className="hidden lg:flex flex-col w-64 h-[calc(100vh-3rem)] sticky top-6 rounded-2xl border shadow-sm z-10 overflow-hidden"
        style={{
          background: "#FFFFFF",
          borderColor: "var(--landing-border)",
        }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
