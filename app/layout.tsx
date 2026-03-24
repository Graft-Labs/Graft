import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Graft — Production-Readiness Scanner for AI Apps",
  description:
    "The one-click production-readiness scanner that turns AI prototypes into $1k+/mo businesses. Scan your GitHub repo for security holes, scalability issues, monetization gaps, and distribution failures.",
  keywords: ["production readiness", "AI apps", "security scanner", "SaaS", "indie hacker"],
  openGraph: {
    title: "Graft",
    description: "Production-readiness scanner for AI-built indie apps",
    type: "website",
  },
  icons: {
    icon: "/graft.svg",
    apple: "/graft.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" >
      <body
        className={`${geist.variable} ${geistMono.variable} antialiased`}
        style={{ fontFamily: "var(--font-geist), system-ui, sans-serif" }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
