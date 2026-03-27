import Link from "next/link";
import Image from "next/image";

export default function LandingFooter() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 mt-auto">
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link href="/" className="flex items-center gap-3 mb-6">
              <Image src="/graft.svg" alt="Graft" width={140} height={32} className="h-8 w-auto" />
            </Link>
            <p className="text-sm leading-relaxed text-gray-600" style={{ fontFamily: "var(--font-landing-body)" }}>
              Turn your AI prototype into a production-grade business. <br />
              Ship with confidence.
            </p>
          </div>

          {/* Guards */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-6" style={{ fontFamily: "var(--font-landing-body)" }}>
              Guards
            </h4>
            <ul className="flex flex-col gap-4">
              {[
                "Security",
                "Scalability",
                "Monetization",
                "Distribution",
              ].map((guard) => (
                <li key={guard}>
                  <span
                    className="text-sm text-gray-600"
                    style={{ fontFamily: "var(--font-landing-body)" }}
                  >
                    {guard}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 mb-6" style={{ fontFamily: "var(--font-landing-body)" }}>
              Legal
            </h4>
            <ul className="flex flex-col gap-4">
              {[
                { href: "/privacy", label: "Privacy Policy" },
                { href: "/terms", label: "Terms of Service" },
              ].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-gray-600 hover:text-[#0000EE] transition-colors"
                    style={{ fontFamily: "var(--font-landing-body)" }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-8 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500" style={{ fontFamily: "var(--font-landing-body)" }}>
            Built for indie hackers shipping with AI
          </p>
        </div>
      </div>
    </footer>
  );
}
