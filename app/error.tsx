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
    <html>
      <body style={{ background: "#0f0e0c", color: "#f4f0e6", margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }}>
          <div style={{ maxWidth: 520, width: "100%", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14, padding: 24, background: "rgba(255,255,255,0.03)" }}>
            <p style={{ margin: 0, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "#ffdc61" }}>ShipGuard AI</p>
            <h2 style={{ marginTop: 10, marginBottom: 8 }}>Something went wrong</h2>
            <p style={{ marginTop: 0, marginBottom: 16, color: "#c7c2b8", fontSize: 14, lineHeight: 1.6 }}>
              An unexpected error occurred. Please try again.
            </p>
            <button
              onClick={reset}
              style={{
                border: "none",
                borderRadius: 10,
                background: "#ffdc61",
                color: "#403718",
                padding: "10px 14px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
