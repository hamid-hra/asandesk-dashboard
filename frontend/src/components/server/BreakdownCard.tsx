"use client";

import { useState } from "react";

import { fmt, pctText } from "@/lib/fa";
import type { Overview } from "@/lib/types";

import s from "./server.module.css";

export function BreakdownCard({ breakdown, total }: { breakdown: Overview["breakdown"] | undefined; total: number }) {
  const [mode, setMode] = useState<"platform" | "region">("platform");
  const rows = breakdown?.[mode] ?? [];
  const mx = rows[0]?.[1] || 1;
  return (
    <div className="card" style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div className="card-head" style={{ padding: "14px 22px" }}>
        <span className="card-title" style={{ flex: 1 }}>
          توزیع کانکشن‌های فعال
        </span>
        <div className="seg">
          <button aria-pressed={mode === "platform"} onClick={() => setMode("platform")}>
            پلتفرم
          </button>
          <button aria-pressed={mode === "region"} onClick={() => setMode("region")}>
            منطقه
          </button>
        </div>
      </div>
      {rows.length ? (
        <div style={{ padding: "10px 22px 16px", display: "flex", flexDirection: "column" }}>
          {rows.map(([label, p]) => (
            <div key={label} className={s.bdRow}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--text-2)" }}>{label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{fmt(total * p)}</span>
                <span style={{ fontSize: 12, color: "var(--faint)", width: 36, textAlign: "left" }}>{pctText(p * 100)}</span>
              </div>
              <div className="bar">
                <div style={{ width: `${(p / mx) * 100}%`, background: "var(--ok)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">
          پس از راه‌اندازی آسان‌دسک روی این سرور،
          <br />
          توزیع کانکشن‌ها بر اساس {mode === "platform" ? "پلتفرم" : "منطقه"} اینجا نمایش داده می‌شود.
        </div>
      )}
    </div>
  );
}
