export default function AppLoading() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--obsidian)",
        color: "var(--text-secondary)",
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
            border: "2px solid var(--accent)",
            borderTopColor: "transparent",
          }}
        />
        <span style={{ fontSize: 13 }}>Loading ShipGuard AI...</span>
      </div>
    </main>
  );
}
