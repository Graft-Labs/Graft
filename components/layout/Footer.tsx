import Link from "next/link";

export default function Footer() {
  return (
    <footer
      className="border-t mt-auto"
      style={{ borderColor: "var(--border)", background: "var(--obsidian-1)" }}
    >
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-3 mb-4">
              <div
                className="w-8 h-8 rounded flex items-center justify-center text-xs font-bold"
                style={{
                  background: "var(--accent)",
                  color: "var(--obsidian)",
                  fontFamily: "var(--font-ui)",
                  
                  fontSize: "16px",
                }}
              >
                SG
              </div>
              <span
                className="font-semibold"
                style={{ fontFamily: "var(--font-ui)", letterSpacing: "-0.02em" }}
              >
                ShipGuard <span style={{ color: "var(--accent)" }}>AI</span>
              </span>
            </Link>
            <p
              className="text-sm leading-relaxed"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              Turn your AI prototype into a production-grade business.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              Product
            </h4>
            <ul className="flex flex-col gap-3">
              {[
                { href: "/", label: "Home" },
                { href: "/pricing", label: "Pricing" },
                { href: "/auth/signup", label: "Start Free" },
                { href: "/dashboard", label: "Dashboard" },
              ].map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm transition-colors hover:opacity-100"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Guards */}
          <div>
            <h4
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              Guards
            </h4>
            <ul className="flex flex-col gap-3">
              {[
                "Security Guard",
                "Scalability Guard",
                "Monetization Guard",
                "Distribution Guard",
              ].map((guard) => (
                <li key={guard}>
                  <span
                    className="text-sm"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
                  >
                    {guard}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              Legal
            </h4>
            <ul className="flex flex-col gap-3">
              {[
                { href: "/privacy", label: "Privacy Policy" },
                { href: "/terms", label: "Terms of Service" },
                { href: "#", label: "Cookie Policy" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm transition-colors hover:opacity-100"
                    style={{ color: "var(--text-secondary)", fontFamily: "var(--font-label)" }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div
          className="pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4"
          style={{ borderColor: "var(--border)" }}
        >
          <p
            className="text-xs"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
          >
            © 2026 ShipGuard AI. All rights reserved.
          </p>
          <p
            className="text-xs"
            style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
          >
            Built for indie hackers shipping with AI
          </p>
        </div>
      </div>
    </footer>
  );
}
