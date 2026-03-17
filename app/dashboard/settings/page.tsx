"use client";

import { useState, useCallback, useEffect } from "react";
import {
  User,
  Github,
  Bell,
  Shield,
  CreditCard,
  Key,
  Trash2,
  CheckCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import DashboardSidebar from "@/components/layout/DashboardSidebar";
import Link from "next/link";
import { createClient } from "@/lib/supabase";

function getAuthRedirectUrl() {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return `${process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"}/auth/callback`;
}

type Tab = "profile" | "integrations" | "notifications" | "billing" | "security";

const tabs: { id: Tab; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "integrations", label: "Integrations", icon: Github },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "security", label: "Security", icon: Shield },
];

interface UserData {
  email: string;
  name: string;
  plan: string;
  scans_used: number;
  scans_limit: number;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [saved, setSaved] = useState(false);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [loadingGithub, setLoadingGithub] = useState(false);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [profileForm, setProfileForm] = useState({ name: "", email: "" });
  const supabase = createClient();

  const fetchUserData = useCallback(async () => {
    setLoadingUser(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setLoadingUser(false);
        return;
      }

      const { data: userRecord } = await supabase
        .from("users")
        .select("plan, scans_used, scans_limit")
        .eq("id", user.id)
        .single();

      const userData: UserData = {
        email: user.email || "",
        name: user.user_metadata?.full_name || user.user_metadata?.name || "",
        plan: userRecord?.plan || "free",
        scans_used: userRecord?.scans_used || 0,
        scans_limit: userRecord?.scans_limit || 3,
      };

      setUserData(userData);
      setProfileForm({ name: userData.name, email: userData.email });
    } catch (error) {
      console.error("Error fetching user data:", error);
    }
    setLoadingUser(false);
  }, [supabase]);

  useEffect(() => {
    void fetchUserData();
  }, [fetchUserData]);

  const checkGithubStatus = useCallback(async () => {
    setLoadingGithub(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setGithubConnected(false);
        setLoadingGithub(false);
        return;
      }

      const identities = user.identities || [];
      const githubIdentity = identities.find(
        (id: { provider: string }) => id.provider === "github"
      );
      setGithubConnected(!!githubIdentity);
    } catch (error) {
      console.error("Error checking GitHub status:", error);
      setGithubConnected(false);
    }
    setLoadingGithub(false);
  }, [supabase]);

  const handleGithubConnect = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: getAuthRedirectUrl(),
        scopes: "repo read:org user:email",
      },
    });

    if (error) {
      console.error("GitHub OAuth error:", error);
    }
  };

  const handleSave = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.auth.updateUser({
        data: { full_name: profileForm.name }
      });

      if (error) {
        console.error("Error updating profile:", error);
        return;
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving profile:", error);
    }
  };

  const getPlanDisplayName = (plan: string) => {
    switch (plan) {
      case "pro": return "Pro";
      case "unlimited": return "Unlimited";
      case "lifetime": return "Lifetime";
      default: return "Free";
    }
  };

  const getPlanFeatures = (plan: string) => {
    switch (plan) {
      case "pro": return "30 scans / month";
      case "unlimited": return "Unlimited scans";
      case "lifetime": return "Unlimited scans (one-time)";
      default: return "3 scans / month";
    }
  };

  return (
    <div className="flex min-h-screen" style={{ background: "var(--obsidian)" }}>
      <DashboardSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <div className="h-16 flex items-center px-6 border-b flex-shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}>
          <h1 className="text-base font-semibold" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
            Settings
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6">
            <div className="flex gap-8">
              {/* Sidebar tabs */}
              <div className="w-48 flex-shrink-0">
                <nav className="flex flex-col gap-0.5">
                  {tabs.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          if (tab.id === "integrations") {
                            void checkGithubStatus();
                          }
                        }}
                        className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-all"
                        style={{
                          background: activeTab === tab.id ? "var(--accent-glow)" : "transparent",
                          color: activeTab === tab.id ? "var(--accent)" : "var(--text-secondary)",
                          border: activeTab === tab.id ? "1px solid var(--border-amber)" : "1px solid transparent",
                          fontFamily: "var(--font-label)",
                        }}>
                        <Icon size={15} />
                        {tab.label}
                      </button>
                    );
                  })}
                </nav>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {activeTab === "profile" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Profile Settings
                    </h2>
                    {loadingUser ? (
                      <div className="flex items-center justify-center p-12">
                        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-col gap-5 p-6 rounded-2xl mb-5"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          {/* Avatar */}
                          <div className="flex items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold"
                              style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)", color: "var(--accent)", fontFamily: "var(--font-ui)" }}>
                              {(profileForm.name || profileForm.email || "U").charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)" }}>Profile Picture</p>
                              <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                                Auto-generated from your initials
                              </p>
                            </div>
                          </div>

                          {/* Fields */}
                          <div>
                            <label className="block text-xs font-medium mb-1.5"
                              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                              Full Name
                            </label>
                            <input 
                              type="text" 
                              value={profileForm.name}
                              onChange={(e) => setProfileForm(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Your name" 
                              className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }} 
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium mb-1.5"
                              style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                              Email
                            </label>
                            <input 
                              type="email" 
                              value={profileForm.email}
                              disabled
                              className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm opacity-60"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }} 
                            />
                            <p style={{ fontSize: "11px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginTop: 4 }}>
                              Email cannot be changed
                            </p>
                          </div>
                        </div>

                        <button onClick={handleSave}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
                          style={{ background: saved ? "var(--guard-monetize-glow)" : "var(--accent)", color: saved ? "var(--guard-monetize)" : "var(--obsidian)", border: saved ? "1px solid rgba(64,200,122,0.3)" : "none", fontFamily: "var(--font-ui)" }}>
                          {saved ? <><CheckCircle size={14} /> Saved!</> : "Save Changes"}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {activeTab === "integrations" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Integrations
                    </h2>
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center justify-between p-5 rounded-2xl"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                            style={{ background: "var(--obsidian-3)", border: "1px solid var(--border)" }}>
                            <Github size={18} style={{ color: "var(--text-secondary)" }} />
                          </div>
                          <div>
                            <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)" }}>GitHub</p>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                              Connect your GitHub account to scan private repositories
                            </p>
                          </div>
                        </div>
                        {loadingGithub ? (
                          <div className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm"
                            style={{ background: "var(--surface-3)", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>
                            <Loader2 size={14} className="animate-spin" />
                            Checking...
                          </div>
                        ) : githubConnected ? (
                          <button
                            onClick={handleGithubConnect}
                            className="px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2"
                            style={{ background: "var(--guard-monetize-glow)", color: "var(--guard-monetize)", border: "1px solid rgba(64,200,122,0.3)", fontFamily: "var(--font-label)" }}
                          >
                            <CheckCircle size={14} />
                            Connected
                          </button>
                        ) : (
                          <button
                            onClick={handleGithubConnect}
                            className="px-4 py-2 rounded-lg text-sm font-medium transition-all"
                            style={{ background: "var(--surface-3)", color: "var(--text-primary)", border: "1px solid var(--border)", fontFamily: "var(--font-label)" }}
                          >
                            Connect
                          </button>
                        )}
                      </div>
                      {!githubConnected && (
                        <div className="p-4 rounded-xl" style={{ background: "var(--obsidian-1)", border: "1px solid var(--border)" }}>
                          <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                            <strong style={{ color: "var(--text-primary)" }}>Why connect GitHub?</strong>
                            <br />
                            • Scan private repositories
                            <br />
                            • Access repository metadata
                            <br />
                            • Enable auto-fix via GitHub PRs (coming soon)
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeTab === "billing" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Billing & Plan
                    </h2>

                    {loadingUser ? (
                      <div className="flex items-center justify-center p-12">
                        <Loader2 size={24} className="animate-spin" style={{ color: "var(--accent)" }} />
                      </div>
                    ) : userData ? (
                      <>
                        {/* Current plan */}
                        <div className="p-6 rounded-2xl mb-5"
                          style={{ background: "var(--accent-glow)", border: "1px solid var(--border-amber)" }}>
                          <div className="flex items-center justify-between">
                            <div>
                              <p style={{ fontSize: "12px", color: "var(--accent)", fontFamily: "var(--font-label)", marginBottom: 4 }}>Current Plan</p>
                              <p className="text-2xl" style={{ fontFamily: "var(--font-ui)", color: "var(--accent)" }}>{getPlanDisplayName(userData.plan)}</p>
                              <p style={{ fontSize: "13px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>{getPlanFeatures(userData.plan)}</p>
                            </div>
                            {userData.plan !== "unlimited" && userData.plan !== "lifetime" && (
                              <Link href="/pricing"
                                className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
                                style={{ background: "var(--accent)", color: "var(--obsidian)", fontFamily: "var(--font-ui)" }}>
                                Upgrade to Pro
                              </Link>
                            )}
                          </div>
                        </div>

                        <div className="p-5 rounded-2xl"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          <p className="text-sm font-medium mb-1" style={{ fontFamily: "var(--font-ui)" }}>Usage this month</p>
                          <div className="flex items-center gap-3 mt-3">
                            <div className="flex-1 h-2 rounded-full" style={{ background: "var(--obsidian-5)" }}>
                              <div style={{ 
                                width: userData.scans_limit === 999999 
                                  ? "100%" 
                                  : `${Math.min((userData.scans_used / userData.scans_limit) * 100, 100)}%`, 
                                height: "100%", 
                                background: userData.scans_used >= userData.scans_limit ? "var(--sev-critical)" : "var(--accent)", 
                                borderRadius: "9999px" 
                              }} />
                            </div>
                            <span style={{ fontSize: "12px", color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>
                              {userData.scans_limit === 999999 
                                ? "Unlimited" 
                                : `${userData.scans_used}/${userData.scans_limit} scans`
                              }
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="p-6 rounded-2xl"
                        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <p style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}>Unable to load billing info</p>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "security" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Security
                    </h2>

                    <div className="flex flex-col gap-4">
                      {/* Change password */}
                      <div className="p-5 rounded-2xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                        <p className="text-sm font-medium mb-4" style={{ fontFamily: "var(--font-ui)" }}>Change Password</p>
                        <div className="flex flex-col gap-3">
                          {["Current password", "New password", "Confirm new password"].map((f) => (
                            <input key={f} type="password" placeholder={f}
                              className="w-full px-4 py-3 rounded-lg bg-transparent outline-none text-sm"
                              style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }} />
                          ))}
                        </div>
                        <button className="mt-4 px-5 py-2 rounded-lg text-sm font-medium transition-all"
                          style={{ background: "var(--surface-3)", border: "1px solid var(--border)", color: "var(--text-primary)", fontFamily: "var(--font-label)" }}>
                          Update Password
                        </button>
                      </div>

                      {/* Danger zone */}
                      <div className="p-5 rounded-2xl" style={{ background: "rgba(232,64,64,0.04)", border: "1px solid rgba(232,64,64,0.2)" }}>
                        <p className="text-sm font-medium mb-1" style={{ fontFamily: "var(--font-ui)", color: "var(--sev-critical)" }}>Danger Zone</p>
                        <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)", marginBottom: 16 }}>
                          Permanently delete your account and all scan data.
                        </p>
                        <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                          style={{ background: "rgba(232,64,64,0.1)", border: "1px solid rgba(232,64,64,0.3)", color: "var(--sev-critical)", fontFamily: "var(--font-label)" }}>
                          <Trash2 size={13} />
                          Delete Account
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "notifications" && (
                  <div>
                    <h2 className="text-lg font-semibold mb-6" style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}>
                      Notification Preferences
                    </h2>
                    <div className="flex flex-col gap-3">
                      {[
                        { label: "Scan complete", desc: "Get notified when a scan finishes", enabled: true },
                        { label: "Critical issues found", desc: "Alert when critical severity issues are detected", enabled: true },
                        { label: "Weekly digest", desc: "Weekly summary of your scan history", enabled: false },
                        { label: "Product updates", desc: "New features and improvements", enabled: false },
                      ].map((notif) => (
                        <div key={notif.label} className="flex items-center justify-between p-4 rounded-xl"
                          style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                          <div>
                            <p className="text-sm font-medium" style={{ fontFamily: "var(--font-ui)" }}>{notif.label}</p>
                            <p style={{ fontSize: "12px", color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}>{notif.desc}</p>
                          </div>
                          <button
                            className="w-10 h-6 rounded-full relative transition-colors duration-200 flex-shrink-0"
                            style={{ background: notif.enabled ? "var(--accent)" : "var(--obsidian-5)" }}>
                            <span className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-200"
                              style={{ transform: notif.enabled ? "translateX(18px)" : "translateX(2px)", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
