import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatScore(score: number): string {
  return score.toFixed(0);
}

export function getScoreColor(score: number): string {
  if (score >= 80) return "var(--guard-monetize)";
  if (score >= 60) return "var(--accent)";
  if (score >= 40) return "var(--sev-medium)";
  return "var(--guard-security)";
}

export function getScoreLabel(score: number): string {
  if (score >= 80) return "Production Ready";
  if (score >= 60) return "Needs Work";
  if (score >= 40) return "At Risk";
  return "Critical Issues";
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(date));
}

export function formatRelativeTime(date: string | Date): string {
  const now = new Date();
  const d = new Date(date);
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
}
