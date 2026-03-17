"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Shield,
  PlusCircle,
  Settings,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/scan/new", label: "New Scan", icon: PlusCircle },
  { href: "/dashboard/history", label: "Scan History", icon: Shield },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

export default function DashboardSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [userData, setUserData] = useState<{ plan: string; scans_used: number; scans_limit: number } | null>(null);

  // Fetch user on load
  useEffect(() => {
    async function fetchUser() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);

      if (user) {
        const { data } = await supabase
          .from('users')
          .select('plan, scans_used, scans_limit')
          .eq('id', user.id)
          .single();
        setUserData(data);
      }
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
  const userEmail = user?.email || "user@example.com";
  const userName = user?.user_metadata?.full_name || user?.user_metadata?.name || userEmail.split("@")[0];
  const avatarUrl = user?.user_metadata?.avatar_url;

  // Plan display
  const plan = userData?.plan || 'free';
  const scansUsed = userData?.scans_used ?? 0;
  const scansLimit = userData?.scans_limit ?? 3;
  const planDisplay = plan === 'free' ? 'Free Plan' : plan === 'pro' ? 'Pro Plan' : plan === 'unlimited' ? 'Unlimited Plan' : plan === 'lifetime' ? 'Lifetime Plan' : 'Free Plan';
  const scansDisplay = scansLimit >= 999999 ? 'Unlimited scans' : `${scansUsed}/${scansLimit} scans used`;

  return (
    <aside
      className="hidden lg:flex flex-col w-60 h-screen sticky top-0 border-r"
      style={{
        background: "var(--obsidian-1)",
        borderColor: "var(--border)",
      }}
    >
      {/* Logo */}
      <div
        className="h-16 flex items-center px-6 border-b"
        style={{ borderColor: "var(--border)" }}
      >
        <Link href="/" className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold"
            style={{
              background: "var(--primary)",
              color: "var(--secondary)",
              fontFamily: "var(--font-ui)",
              fontSize: "14px",
            }}
          >
            SG
          </div>
          <span
            className="font-semibold text-sm"
            style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}
          >
            ShipGuard <span style={{ color: "var(--primary)" }}>AI</span>
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 flex flex-col gap-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150",
                isActive
                  ? "font-medium"
                  : "opacity-60 hover:opacity-80"
              )}
              style={{
                background: isActive ? "var(--primary-glow)" : "transparent",
                color: isActive ? "var(--primary)" : "var(--text-primary)",
                border: isActive ? "1px solid var(--border-amber)" : "1px solid transparent",
                fontFamily: "var(--font-label)",
              }}
            >
              <Icon size={16} strokeWidth={isActive ? 2 : 1.5} />
              {item.label}
              {item.label === "New Scan" && (
                <span
                  className="ml-auto text-xs px-1.5 py-0.5 rounded"
                  style={{
                    background: "var(--primary)",
                    color: "var(--secondary)",
                    fontFamily: "var(--font-label)",
                    fontSize: "10px",
                    fontWeight: 700,
                  }}
                >
                  +
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User / Bottom */}
      <div
        className="p-3 border-t"
        style={{ borderColor: "var(--border)" }}
      >
        {/* Plan badge */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg mb-2"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        >
          <div>
            <p
              className="text-xs font-medium"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
            >
              {planDisplay}
            </p>
            <p
              className="text-xs"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              {scansDisplay}
            </p>
          </div>
          {scansLimit < 999999 && (
          <Link
            href="/pricing"
            className="text-xs font-semibold px-2 py-1 rounded"
            style={{
              background: "var(--primary)",
              color: "var(--secondary)",
              fontFamily: "var(--font-label)",
            }}
          >
            Upgrade
          </Link>
          )}
        </div>

        {/* User */}
        <div className="flex items-center gap-3 px-3 py-2">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={userName}
              className="w-7 h-7 rounded-full flex-shrink-0"
            />
          ) : (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
              style={{ background: "var(--obsidian-4)", color: "var(--primary)", fontFamily: "var(--font-ui)" }}
            >
              {userName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p
              className="text-xs font-medium truncate"
              style={{ color: "var(--text-primary)", fontFamily: "var(--font-label)" }}
            >
              {userName}
            </p>
            <p
              className="text-xs truncate"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              {userEmail}
            </p>
          </div>
          <button
            className="opacity-40 hover:opacity-70 transition-opacity"
            title="Sign out"
            onClick={handleLogout}
          >
            <LogOut size={14} style={{ color: "var(--text-primary)" }} />
          </button>
        </div>
      </div>
    </aside>
  );
}
