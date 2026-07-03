import { ulid } from "ulid";
import { clsx, type ClassValue } from "clsx";

export function generateId(): string {
  return ulid();
}

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function now(): string {
  return new Date().toISOString();
}

export function parseJsonField<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function toJsonString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

export function relativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function calculateUrgency(dateStr: string): "overdue" | "imminent" | "upcoming" | "future" {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((date.getTime() - now.getTime()) / 86400000);

  if (diffDays < 0) return "overdue";
  if (diffDays <= 30) return "imminent";
  if (diffDays <= 90) return "upcoming";
  return "future";
}

export function mapCsvStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes("active")) return "in_force";
  if (s.includes("pending")) return "passed";
  if (s.includes("proposed")) return "proposed";
  if (s.includes("upcoming")) return "passed";
  if (s.includes("voluntary")) return "in_force";
  return "in_force";
}

export function mapCsvCategory(category: string): string {
  const map: Record<string, string> = {
    "data privacy": "Privacy & Data Protection",
    "electronic signatures": "Electronic Signatures & Transactions",
    "cybersecurity": "Data Security & Breach Notification",
    "ai/technology": "AI & Emerging Technology",
    "cybersecurity/criminal": "Data Security & Breach Notification",
  };
  return map[category.toLowerCase().trim()] || category;
}

export function mapCsvJurisdiction(country: string): string {
  const map: Record<string, string> = {
    "australia": "AU",
    "singapore": "SG",
    "japan": "JP",
    "new zealand": "NZ",
    "hong kong": "HK",
    "india": "IN",
    "philippines": "PH",
  };
  return map[country.toLowerCase().trim()] || country;
}

export function mapCsvImpact(relevance: string): number {
  const r = relevance.toLowerCase();
  if (r.startsWith("critical")) return 5;
  if (r.startsWith("high")) return 4;
  if (r.startsWith("medium-high")) return 4;
  if (r.startsWith("medium")) return 3;
  if (r.startsWith("low-medium")) return 2;
  if (r.startsWith("low")) return 2;
  return 3;
}
