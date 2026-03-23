export default function AppLoading() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--landing-bg)",
        color: "var(--landing-text-secondary)",
        fontFamily: "var(--font-label)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          className="animate-spin"
          style={{
            width: 14,
            height: 14,
            borderRadius: 999,
            border: "2px solid var(--landing-primary)",
            borderTopColor: "transparent",
          }}
        />
        <span style={{ fontSize: 13 }}>Loading Graft...</span>
      </div>
    </main>
  );
}
