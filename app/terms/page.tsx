import Navbar from "@/components/layout/LandingNavbar";
import Footer from "@/components/layout/LandingFooter";

const sections = [
  {
    title: "Acceptance of Terms",
    body: "By accessing or using ShipGuard AI, you agree to these Terms of Service. If you do not agree, do not use the platform.",
  },
  {
    title: "Service Description",
    body: "ShipGuard AI provides automated repository analysis and readiness guidance. Outputs are advisory and should be reviewed before production changes.",
  },
  {
    title: "Account Responsibilities",
    body: "You are responsible for account security, access credentials, and all activities under your account. You must have authorization to scan repositories you submit.",
  },
  {
    title: "Usage Restrictions",
    body: "You may not use ShipGuard AI for unlawful activity, unauthorized security testing, abuse of third-party services, or attempts to disrupt platform availability.",
  },
  {
    title: "Billing and Subscriptions",
    body: "Paid plans are billed according to the selected subscription. Fees are non-refundable unless required by law. We may update pricing with reasonable notice.",
  },
  {
    title: "Intellectual Property",
    body: "ShipGuard AI, including software, branding, and platform content, is protected by applicable intellectual property laws. You retain ownership of your repositories and code.",
  },
  {
    title: "Disclaimer and Limitation of Liability",
    body: "The service is provided on an 'as is' basis without warranties. To the maximum extent permitted by law, ShipGuard AI is not liable for indirect, incidental, or consequential damages.",
  },
  {
    title: "Contact",
    body: "For legal questions, contact support@shipguard.ai.",
  },
];

export default function TermsPage() {
  const updated = "March 18, 2026";

  return (
    <div className="min-h-screen" style={{ background: "var(--obsidian)" }}>
      <div className="noise-overlay" />
      <Navbar />

      <main className="relative pt-32 pb-20">
        <div className="max-w-4xl mx-auto px-6">
          <div
            className="rounded-2xl p-8 md:p-10 mb-8"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: "var(--accent)", fontFamily: "var(--font-label)" }}
            >
              Legal
            </p>
            <h1
              className="text-4xl md:text-5xl mb-3"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Terms of Service
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--text-tertiary)", fontFamily: "var(--font-label)" }}
            >
              Last updated: {updated}
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <section
                key={section.title}
                className="rounded-xl p-6"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                }}
              >
                <h2
                  className="text-lg mb-2"
                  style={{ fontFamily: "var(--font-ui)", color: "var(--text-primary)" }}
                >
                  {section.title}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-label)",
                    color: "var(--text-secondary)",
                    fontSize: "14px",
                    lineHeight: "1.7",
                  }}
                >
                  {section.body}
                </p>
              </section>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
