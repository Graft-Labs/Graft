"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app-error-boundary]", error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "#FAFAFA",
        color: "#111827",
        fontFamily: "var(--font-landing-body), system-ui, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: "100%",
          border: "1px solid #E5E7EB",
          borderRadius: 16,
          padding: 24,
          background: "#FFFFFF",
          boxShadow: "0 8px 24px rgba(17, 24, 39, 0.06)",
        }}
      >
        <p style={{ margin: 0, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#3079FF", fontWeight: 700 }}>
          Graft
        </p>
        <h2 style={{ marginTop: 10, marginBottom: 8, fontFamily: "var(--font-landing-heading), system-ui, sans-serif" }}>
          Something went wrong
        </h2>
        <p style={{ marginTop: 0, marginBottom: 16, color: "#4B5563", fontSize: 14, lineHeight: 1.6 }}>
          An unexpected error occurred. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            border: "1px solid #111827",
            borderRadius: 9999,
            background: "#111827",
            color: "#FFFFFF",
            padding: "10px 16px",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
