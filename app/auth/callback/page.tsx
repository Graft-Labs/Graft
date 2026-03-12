"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const [status, setStatus] = useState("Verifying...");

  useEffect(() => {
    async function handleCallback() {
      const supabase = createClient();
      const search =
        typeof window !== "undefined" ? window.location.search : "";
      const code = new URLSearchParams(search).get("code");

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setStatus("Error: " + error.message);
          return;
        }
      }

      const { data, error } = await supabase.auth.getSession();

      // Check for errors OR no session (user denied/cancelled)
      if (error || !data.session) {
        setStatus("Error: " + (error?.message || "Authentication failed"));
        return;
      }

      // If successful, redirect to dashboard
      router.push("/dashboard");
    }

    handleCallback();
  }, [router]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--obsidian)" }}
    >
      <div className="text-center">
        <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto mb-4" />
        <p style={{ color: "var(--text-secondary)", fontFamily: "var(--font-ui)" }}>
          {status}
        </p>
      </div>
    </div>
  );
}
