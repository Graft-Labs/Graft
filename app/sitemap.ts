import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://graft.vercel.app";
  const now = new Date();

  return [
    { url: `${appUrl}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${appUrl}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${appUrl}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${appUrl}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
    { url: `${appUrl}/auth/login`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${appUrl}/auth/signup`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];
}
