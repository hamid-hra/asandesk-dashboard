"use client";

import { useState } from "react";

import { faDate, fmt, toFa } from "@/lib/fa";
import type { Channel, Release } from "@/lib/types";

import s from "./releases.module.css";

export function ReleaseHistory({ releases, current }: { releases: Release[] | undefined; current: string | null }) {
  const [filter, setFilter] = useState<"all" | Channel>("all");
  const rows = (releases ?? []).filter((r) => filter === "all" || r.channel === filter);
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div className="card-head" style={{ padding: "14px 22px" }}>
        <span className="card-title" style={{ flex: 1 }}>
          تاریخچه انتشار
        </span>
        <div className="seg">
          {(
            [
              ["all", "همه"],
              ["stable", "پایدار"],
              ["beta", "بتا"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.map((r) => {
        const beta = r.channel === "beta";
        const assets = new Map(r.assets.map((a) => [a.platform, a]));
        return (
          <div key={r.id} className={s.hist} style={{ background: r.downloads === 0 ? "var(--row-new)" : undefined }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span dir="ltr" className="mono" style={{ fontWeight: 600, fontSize: 16, lineHeight: 1.2, textAlign: "right" }}>
                v{r.version}
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span
                  className={s.badge}
                  style={{ background: beta ? "var(--beta-soft)" : "var(--accent-soft)", color: beta ? "var(--beta-text)" : "var(--accent-strong)" }}
                >
                  {beta ? "بتا" : "پایدار"}
                </span>
                {r.version === current && (
                  <span className={s.badge} style={{ background: "var(--brand)", color: "#fff" }}>
                    فعلی
                  </span>
                )}
                {r.rollout < 100 && (
                  <span className={s.badge} style={{ background: "var(--warn-soft)", color: "var(--warn-text)" }}>
                    تدریجی {toFa(r.rollout)}٪
                  </span>
                )}
                {r.mandatory && (
                  <span className={s.badge} style={{ background: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                    اجباری
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{faDate(r.date)}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <ul className={s.notes}>
                {r.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              <div dir="ltr" style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {r.platforms.map((p) => {
                  const a = assets.get(p);
                  return a ? (
                    <a key={p} className={s.plat} href={`/api/releases/${r.version}/download/${p.toLowerCase()}`} title={`دانلود ${a.filename}`}>
                      ↓ {p}
                    </a>
                  ) : (
                    <span key={p} className={s.plat}>
                      {p}
                    </span>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{fmt(r.downloads)}</span>
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>دانلود</span>
            </div>
          </div>
        );
      })}
      {releases && !rows.length && <div className="empty">هنوز نسخه‌ای منتشر نشده است.</div>}
    </div>
  );
}
