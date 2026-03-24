import Navbar from "@/components/layout/LandingNavbar";
import Footer from "@/components/layout/LandingFooter";

const sections = [
  {
    title: "Information We Collect",
    body: "We collect account details (email and authentication identifiers), scan metadata (repository URL, branch, timestamps, scores, and issue summaries), and billing records required to process subscriptions. We do not store full repository source code after scan completion.",
  },
  {
    title: "How We Use Data",
    body: "We use your data to provide scans, improve detection quality, prevent abuse, and support billing and customer support. We do not sell your personal information.",
  },
  {
    title: "Repository and Security Data",
    body: "Repository contents are cloned temporarily for analysis and then removed after processing. Scan findings and derived metadata are retained so you can view history and remediation guidance.",
  },
  {
    title: "Third-Party Services",
    body: "Graft uses third-party infrastructure and analytics providers (such as Supabase, Trigger.dev, and PostHog) to deliver product functionality. Data processing is limited to service delivery and platform security.",
  },
  {
    title: "Data Retention",
    body: "We retain account and scan metadata while your account is active. You can request account deletion, after which personal data and associated scan metadata are removed unless legally required to retain records.",
  },
  {
    title: "Your Rights",
    body: "You may request access, correction, or deletion of your personal data by contacting support. Where applicable, you may object to processing or request data portability.",
  },
  {
    title: "Contact",
    body: "For privacy requests or questions, contact us through our support form: https://tally.so/r/lbRzX5",
  },
];

export default function PrivacyPage() {
  const updated = "March 18, 2026";

  return (
    <div className="min-h-screen" style={{ background: "var(--landing-bg)" }}>
      <div className="noise-overlay" />
      <Navbar />

      <main className="relative pt-32 pb-20">
        <div className="max-w-4xl mx-auto px-6">
          <div
            className="rounded-2xl p-8 md:p-10 mb-8"
            style={{
              background: "#FFFFFF",
              border: "1px solid var(--landing-border)",
            }}
          >
            <p
              className="text-xs font-semibold uppercase tracking-widest mb-4"
              style={{ color: "var(--landing-primary)", fontFamily: "var(--font-label)" }}
            >
              Legal
            </p>
            <h1
              className="text-4xl md:text-5xl mb-3"
              style={{ fontFamily: "var(--font-ui)" }}
            >
              Privacy Policy
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--landing-text-secondary)", fontFamily: "var(--font-label)" }}
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
                  background: "#FFFFFF",
                  border: "1px solid var(--landing-border)",
                }}
              >
                <h2
                  className="text-lg mb-2"
                  style={{ fontFamily: "var(--font-ui)", color: "var(--landing-text)" }}
                >
                  {section.title}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-label)",
                    color: "var(--landing-text-secondary)",
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
