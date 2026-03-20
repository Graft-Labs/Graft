"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { User, CreditCard, CheckCircle, Link2, AlertTriangle, LifeBuoy, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase";
import IntegrationsTab from "@/components/settings/IntegrationsTab";
import { getCached, setCached } from "@/lib/client-cache";
import Image from "next/image";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("profile");
  const [user, setUser] = useState<{ email?: string; user_metadata?: { full_name?: string; name?: string; avatar_url?: string; picture?: string } } | null>(null);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  // Profile Form State
  const [fullName, setFullName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function loadData() {
      const cached = getCached<{ user: typeof user; userData: any; fullName: string }>("settings:data");
      if (cached) {
        setUser(cached.user);
        setUserData(cached.userData);
        setFullName(cached.fullName);
        setLoading(false);
      }

      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      
      if (user) {
        const { data } = await supabase
          .from("users")
          .select("*")
          .eq("id", user.id)
          .single();
          
        setUserData(data);
        if (data?.name) setFullName(data.name);
        else if (user?.user_metadata?.full_name) setFullName(user.user_metadata.full_name);

        setCached("settings:data", {
          user,
          userData: data,
          fullName: data?.name || user?.user_metadata?.full_name || "",
        }, 60_000);
      }
      setLoading(false);
    }
    loadData();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        // Update auth metadata
        await supabase.auth.updateUser({
          data: { full_name: fullName }
        });
        
        // Update users table
        await supabase
          .from("users")
          .update({ name: fullName })
          .eq("id", user.id);
          
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      }
    } catch (error) {
      console.error("Error updating profile", error);
    } finally {
      setSaving(false);
    }
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    { id: "integrations", label: "Integrations", icon: Link2 },
    { id: "support", label: "Support", icon: LifeBuoy },
    { id: "billing", label: "Billing", icon: CreditCard },
    
  ];

  return (
    <div className="flex-1 p-4 sm:p-6 lg:p-10 max-w-5xl mx-auto w-full">
      <header className="mb-10">
        <h1 
          className="text-3xl font-bold tracking-tight text-gray-900 mb-2"
          style={{ fontFamily: "var(--font-landing-heading)" }}
        >
          Settings
        </h1>
        <p 
          className="text-gray-500 font-medium"
          style={{ fontFamily: "var(--font-landing-body)" }}
        >
          Manage your account settings and preferences.
        </p>
      </header>

      <div className="flex flex-col md:flex-row gap-6 lg:gap-8">
        {/* Sidebar Navigation */}
        <aside className="w-full md:w-64 shrink-0">
          <nav className="flex flex-col gap-1.5">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 text-left ${
                    isActive 
                      ? "bg-white shadow-sm ring-1 ring-gray-900/5 text-gray-900" 
                      : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                  }`}
                  style={{ fontFamily: "var(--font-landing-body)" }}
                >
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 2} className={isActive ? "text-[#3079FF]" : "text-gray-400"} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm">
              <div className="animate-pulse space-y-6">
                <div className="h-6 bg-gray-100 rounded w-1/4"></div>
                <div className="h-10 bg-gray-100 rounded w-full"></div>
                <div className="h-10 bg-gray-100 rounded w-full"></div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              
              {/* --- PROFILE TAB --- */}
              {activeTab === "profile" && (
                <div className="p-8">
                  <h2 className="text-xl font-bold text-gray-900 mb-6" style={{ fontFamily: "var(--font-landing-heading)" }}>
                    Profile Settings
                  </h2>
                  
                  {/* Avatar Section */}
                  <div className="flex items-center gap-6 mb-8 pb-8 border-b border-gray-100">
                    <div className="w-20 h-20 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-400 shrink-0 overflow-hidden">
                      {(userData?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture) ? (
                        <Image
                          src={userData?.avatar_url || user?.user_metadata?.avatar_url || user?.user_metadata?.picture}
                          alt="Avatar"
                          width={80}
                          height={80}
                          className="w-full h-full rounded-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <User size={32} />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-body)" }}>Profile Picture</p>
                      <p className="text-xs text-gray-500 font-medium mt-1" style={{ fontFamily: "var(--font-landing-body)" }}>Avatar is synced from your login provider.</p>
                    </div>
                  </div>

                  {/* Form */}
                  <form onSubmit={handleSaveProfile} className="space-y-6 max-w-md">
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2" style={{ fontFamily: "var(--font-landing-body)" }}>
                        Full Name
                      </label>
                      <input
                        type="text"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#3079FF] focus:border-transparent transition-shadow shadow-sm font-medium"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-900 mb-2" style={{ fontFamily: "var(--font-landing-body)" }}>
                        Email Address
                      </label>
                      <input
                        type="email"
                        value={user?.email || ""}
                        disabled
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 cursor-not-allowed font-medium"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      />
                      <p className="mt-2 text-xs text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                        Email cannot be changed directly. Contact support if you need to migrate your account.
                      </p>
                    </div>
                    <div className="pt-4">
                      <button
                        type="submit"
                        disabled={saving}
                        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-full text-sm font-semibold transition-all duration-200 shadow-sm ${
                          saved ? "bg-green-100 text-green-700" : "bg-black text-white hover:bg-gray-800 hover:-translate-y-0.5 hover:shadow-md"
                        }`}
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        {saving ? "Saving..." : saved ? <><CheckCircle size={16} /> Saved</> : "Save Changes"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* --- INTEGRATIONS TAB --- */}
              {activeTab === "integrations" && (
                <IntegrationsTab hasGithubToken={Boolean(userData?.github_token)} />
              )}

              {/* --- BILLING TAB --- */}
              {activeTab === "billing" && (
                <div className="p-8">
                  <h2 className="text-xl font-bold text-gray-900 mb-6" style={{ fontFamily: "var(--font-landing-heading)" }}>
                    Billing & Plan
                  </h2>
                  
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6 mb-8 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="text-lg font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                            {userData?.plan === 'pro' ? 'Pro Plan' : userData?.plan === 'unlimited' ? 'Unlimited Plan' : 'Free Plan'}
                          </h3>
                          <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-blue-100 text-blue-700 border border-blue-200">
                            Active
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                          You are currently on the {userData?.plan || 'free'} plan.
                        </p>
                      </div>
                      <Link
                        href="/#pricing"
                        className="inline-flex px-5 py-2.5 bg-black text-white rounded-full text-sm font-semibold hover:bg-gray-800 transition-colors shadow-sm"
                        style={{ fontFamily: "var(--font-landing-body)" }}
                      >
                        Upgrade Plan
                      </Link>
                    </div>

                    <div className="space-y-3">
                      <div className="flex justify-between text-sm font-bold text-gray-900 mb-2" style={{ fontFamily: "var(--font-landing-body)" }}>
                        <span>Scans Used</span>
                        <span>{userData?.scans_used || 0} / {userData?.scans_limit >= 999999 ? 'Unlimited' : (userData?.scans_limit || 3)}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                        <div 
                          className="h-full bg-[#3079FF] rounded-full transition-all duration-1000"
                          style={{ 
                            width: userData?.scans_limit >= 999999 ? '100%' : `${Math.min(100, ((userData?.scans_used || 0) / (userData?.scans_limit || 1)) * 100)}%` 
                          }}
                        />
                      </div>
                      {userData?.scans_limit < 999999 && (userData?.scans_used || 0) >= (userData?.scans_limit || 3) && (
                        <p className="text-xs text-red-600 font-bold flex items-center gap-1 mt-2">
                          <AlertTriangle size={12} />
                          You have reached your scan limit. Please upgrade to continue.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* --- SUPPORT TAB --- */}
              {activeTab === "support" && (
                <div className="p-8">
                  <h2 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: "var(--font-landing-heading)" }}>
                    Support
                  </h2>
                  <p className="text-sm text-gray-500 mb-6 font-medium" style={{ fontFamily: "var(--font-landing-body)" }}>
                    Need help or want to request a feature? Reach us directly through these forms.
                  </p>

                  <div className="grid md:grid-cols-2 gap-4">
                    <a
                      href={process.env.NEXT_PUBLIC_SUPPORT_FORM_URL || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                            Contact Support
                          </p>
                          <p className="text-sm text-gray-500 mt-1" style={{ fontFamily: "var(--font-landing-body)" }}>
                            Report bugs, account issues, billing questions, or scan failures.
                          </p>
                        </div>
                        <ExternalLink size={16} className="text-gray-400 mt-1" />
                      </div>
                    </a>

                    <a
                      href={process.env.NEXT_PUBLIC_FEATURE_REQUEST_FORM_URL || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-all"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-bold text-gray-900" style={{ fontFamily: "var(--font-landing-heading)" }}>
                            Request a Feature
                          </p>
                          <p className="text-sm text-gray-500 mt-1" style={{ fontFamily: "var(--font-landing-body)" }}>
                            Tell us what you want next in ShipGuard AI.
                          </p>
                        </div>
                        <ExternalLink size={16} className="text-gray-400 mt-1" />
                      </div>
                    </a>
                  </div>
                </div>
              )}

              </div>
          )}
        </main>
      </div>
    </div>
  );
}
