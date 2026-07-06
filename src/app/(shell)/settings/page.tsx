"use client";

import { useEffect, useState } from "react";
import { useProfile, saveProfile } from "@/hooks/use-profile";
import { JURISDICTIONS } from "@/lib/constants";
import { CheckCircle, Save, Settings as SettingsIcon, Sparkles } from "lucide-react";
import { CompanyContextEditor } from "@/components/settings/company-context-editor";

type Tab = "profile" | "export";

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");

  return (
    <div className="anim-enter">
      <div className="relative grid-pattern py-4 mb-6">
        <div className="flex items-center gap-2.5 relative z-10">
          <SettingsIcon className="w-5 h-5" style={{ color: "var(--fg-2)" }} />
          <h1 className="text-gradient text-[28px] font-bold tracking-[-0.02em]">
            Settings
          </h1>
        </div>
        <p className="text-[14px] text-fg-3 mt-1.5 relative z-10">
          Your profile shapes every output. Export gives you everything back as data.
        </p>
      </div>

      <div className="flex gap-6 mb-8 border-b border-border">
        <Tab active={tab === "profile"} onClick={() => setTab("profile")} label="Profile" />
        <Tab active={tab === "export"} onClick={() => setTab("export")} label="Export" />
      </div>

      {tab === "profile" && <ProfileTab />}
      {tab === "export" && <ExportTab />}
    </div>
  );
}

function ProfileTab() {
  const { data, mutate, isLoading } = useProfile();
  const profile = data?.profile;

  const [form, setForm] = useState({
    companyName: "",
    companyDescription: "",
    productsServices: "",
    sectors: "",
    jurisdictionsOfInterest: "",
    role: "",
    focusAreas: "",
    freeText: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (profile && !loaded) {
      setForm({
        companyName: profile.companyName || "",
        companyDescription: profile.companyDescription || "",
        productsServices: profile.productsServices || "",
        sectors: (profile.sectors || []).join(", "),
        jurisdictionsOfInterest: (profile.jurisdictionsOfInterest || []).join(", "),
        role: profile.role || "",
        focusAreas: (profile.focusAreas || []).join(", "),
        freeText: profile.freeText || "",
      });
      setLoaded(true);
    }
  }, [profile, loaded]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const toArray = (s: string) => s.split(",").map((v) => v.trim()).filter(Boolean);
      await saveProfile({
        companyName: form.companyName || null,
        companyDescription: form.companyDescription || null,
        productsServices: form.productsServices || null,
        sectors: toArray(form.sectors).length ? toArray(form.sectors) : null,
        jurisdictionsOfInterest: toArray(form.jurisdictionsOfInterest).length
          ? toArray(form.jurisdictionsOfInterest)
          : null,
        role: form.role || null,
        focusAreas: toArray(form.focusAreas).length ? toArray(form.focusAreas) : null,
        freeText: form.freeText || null,
      });
      mutate();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      alert("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const isEmpty =
    !profile?.companyName &&
    !profile?.companyDescription &&
    !profile?.role &&
    !(profile?.sectors && profile.sectors.length) &&
    !(profile?.jurisdictionsOfInterest && profile.jurisdictionsOfInterest.length) &&
    !(profile?.focusAreas && profile.focusAreas.length);

  return (
    <div>
      <CompanyContextEditor />

      {!isLoading && !isEmpty && profile && <ProfileSummary profile={profile} />}

      {!isLoading && isEmpty && (
        <div
          className="mb-8 rounded-xl border p-5"
          style={{ background: "var(--accent-bg)", borderColor: "var(--accent-border)" }}
        >
          <div className="flex items-start gap-3">
            <Sparkles
              className="w-4 h-4 mt-0.5 flex-shrink-0"
              style={{ color: "var(--accent)" }}
            />
            <div>
              <p className="text-[13px] font-semibold text-fg mb-1">
                Teach Sentinel about you
              </p>
              <p className="text-[13px] text-fg-2 leading-relaxed">
                Fill in the fields below so Sentinel can tailor what it surfaces. Without
                a profile, intelligence is generic; with one, every output reflects your
                company, role, and focus.
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5 max-w-xl">
        <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">
          {isEmpty ? "Set up your profile" : "Update your profile"}
        </h2>

        {saved && (
          <div
            className="flex items-center gap-2 p-3 rounded-xl text-[13px] font-medium"
            style={{ background: "var(--green-bg)", color: "var(--green)" }}
          >
            <CheckCircle className="w-4 h-4" /> Profile saved
          </div>
        )}

        <F label="Company Name">
          <input
            value={form.companyName}
            onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            placeholder="e.g. DocuSign"
            className="field"
          />
        </F>
        <F label="Company Description">
          <textarea
            value={form.companyDescription}
            onChange={(e) => setForm({ ...form, companyDescription: e.target.value })}
            rows={3}
            placeholder="What does the company do? What markets does it operate in?"
            className="field resize-y"
          />
        </F>
        <F label="Products & Services">
          <input
            value={form.productsServices}
            onChange={(e) => setForm({ ...form, productsServices: e.target.value })}
            placeholder="e.g. e-signatures, CLM, identity verification"
            className="field"
          />
        </F>
        <F label="Your Role">
          <input
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            placeholder="e.g. Legal Counsel, Head of Compliance"
            className="field"
          />
        </F>
        <F label="Sectors (comma-separated)">
          <input
            value={form.sectors}
            onChange={(e) => setForm({ ...form, sectors: e.target.value })}
            placeholder="e.g. Technology, Financial Services, Government"
            className="field"
          />
        </F>
        <F label="Jurisdictions of Interest (comma-separated)">
          <input
            value={form.jurisdictionsOfInterest}
            onChange={(e) =>
              setForm({ ...form, jurisdictionsOfInterest: e.target.value })
            }
            placeholder="e.g. AU, SG, JP, IN, NZ, HK, PH"
            className="field"
          />
        </F>
        <F label="Focus Areas (comma-separated)">
          <input
            value={form.focusAreas}
            onChange={(e) => setForm({ ...form, focusAreas: e.target.value })}
            placeholder="e.g. Privacy, AI governance, e-signatures, data sovereignty"
            className="field"
          />
        </F>
        <F label="Additional Context">
          <textarea
            value={form.freeText}
            onChange={(e) => setForm({ ...form, freeText: e.target.value })}
            rows={4}
            placeholder="Any other context that helps Sentinel understand what matters to you..."
            className="field resize-y"
          />
        </F>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-accent hover:bg-accent-2 text-white font-mono text-[11px] tracking-[0.04em] uppercase font-medium rounded-xl transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-m)] disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </form>

      <section className="mt-12 max-w-xl">
        <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono mb-3">
          How your profile shapes intelligence
        </h2>
        <ul className="space-y-2 text-[13px] text-fg-2 leading-relaxed">
          <Shape label="Digest">
            Story relevance is ranked against your sectors, products, and focus areas.
          </Shape>
          <Shape label="Signals">
            Cross-jurisdictional trends carry a &ldquo;why for you&rdquo; line derived
            from your context.
          </Shape>
          <Shape label="Briefings">
            Executive memos lead with your jurisdictions and frame implications for your
            role.
          </Shape>
          <Shape label="Ask">
            Answers are scoped to your profile and cite the entries most relevant to
            your company.
          </Shape>
          <Shape label="Capture">
            New tracker entries are extracted and framed for your business context.
          </Shape>
        </ul>
      </section>

      <style jsx>{`
        .field {
          width: 100%;
          padding: 0.625rem 0.875rem;
          background: var(--bg-surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          font-size: 0.875rem;
          color: var(--fg);
          transition: all 0.2s;
        }
        .field:focus {
          outline: none;
          box-shadow: var(--shadow-m);
          border-color: var(--border-hover);
          background: var(--bg-surface);
        }
        .field::placeholder {
          color: var(--fg-3);
        }
      `}</style>
    </div>
  );
}

function ExportTab() {
  const handleExport = async (format: string) => {
    const res = await fetch(`/api/tracker/export?format=${format}`);
    const blob =
      format === "csv"
        ? await res.blob()
        : new Blob([JSON.stringify(await res.json(), null, 2)], {
            type: "application/json",
          });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sentinel-export.${format}`;
    a.click();
  };

  return (
    <div className="max-w-xl space-y-4 anim-enter">
      <p className="text-[14px] text-fg-2">Download all entries as JSON or CSV.</p>
      <div className="flex gap-3">
        <button
          onClick={() => handleExport("json")}
          className="px-5 py-2.5 bg-accent hover:bg-accent-2 text-white font-mono text-[11px] tracking-[0.04em] uppercase font-medium rounded-xl transition-all duration-150 hover:-translate-y-px hover:shadow-[var(--shadow-m)]"
        >
          JSON
        </button>
        <button
          onClick={() => handleExport("csv")}
          className="px-5 py-2.5 bg-surface border border-border text-fg-2 font-mono text-[11px] tracking-[0.04em] uppercase font-medium rounded-xl hover:bg-hover transition-all duration-150 hover:-translate-y-px"
        >
          CSV
        </button>
      </div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-2.5 font-mono text-[11px] tracking-[0.04em] uppercase font-medium border-b-2 -mb-px transition-colors ${
        active ? "border-accent text-accent" : "border-transparent text-fg-3 hover:text-fg-2"
      }`}
    >
      {label}
    </button>
  );
}

function ProfileSummary({
  profile,
}: {
  profile: {
    companyName: string | null;
    companyDescription: string | null;
    productsServices: string | null;
    sectors: string[] | null;
    jurisdictionsOfInterest: string[] | null;
    role: string | null;
    focusAreas: string[] | null;
    freeText: string | null;
  };
}) {
  const jurisdictionList =
    profile.jurisdictionsOfInterest?.map((code) => {
      const j = JURISDICTIONS.find((x) => x.code === code.toUpperCase());
      return j ? `${j.flag} ${j.code}` : code;
    }) || [];

  return (
    <section className="mb-10 rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[13px] font-semibold text-fg uppercase tracking-[0.04em] font-mono">
          What Sentinel knows about you
        </h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        {profile.companyName && (
          <SummaryRow label="Company" value={profile.companyName} />
        )}
        {profile.role && <SummaryRow label="Role" value={profile.role} />}
        {profile.productsServices && (
          <SummaryRow label="Products &amp; Services" value={profile.productsServices} />
        )}
        {profile.sectors && profile.sectors.length > 0 && (
          <SummaryRow label="Sectors" value={profile.sectors.join(", ")} />
        )}
        {jurisdictionList.length > 0 && (
          <SummaryRow
            label="Jurisdictions"
            value={jurisdictionList.join("  ")}
            mono
          />
        )}
        {profile.focusAreas && profile.focusAreas.length > 0 && (
          <SummaryRow label="Focus areas" value={profile.focusAreas.join(", ")} />
        )}
      </div>

      {profile.companyDescription && (
        <div className="mt-5 pt-4 border-t border-border">
          <div className="label-mono mb-1.5">About</div>
          <p className="text-[13px] text-fg-2 leading-relaxed">
            {profile.companyDescription}
          </p>
        </div>
      )}

      {profile.freeText && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="label-mono mb-1.5">Additional context</div>
          <p className="text-[13px] text-fg-2 leading-relaxed">{profile.freeText}</p>
        </div>
      )}
    </section>
  );
}

function SummaryRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="label-mono mb-1">{label}</div>
      <div
        className={`text-[13px] text-fg ${mono ? "font-mono tracking-[0.04em]" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function Shape({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="font-mono text-[10px] tracking-[0.04em] uppercase text-fg-3 w-20 flex-shrink-0 pt-1">
        {label}
      </span>
      <span className="flex-1">{children}</span>
    </li>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block label-mono mb-1.5">{label}</label>
      {children}
    </div>
  );
}
