"use client";

import { InfoTip } from "@/components/Tip";
import { fmt, pctText, toFa } from "@/lib/fa";
import type { Overview } from "@/lib/types";

import s from "./server.module.css";

/**
 * دستگاه‌های آنلاین الان به تفکیک پلتفرم. دستگاهِ کلاینت جدید پلتفرمش را خودش می‌گوید؛ دستگاه قدیمی فقط وقتی
 * ایجنت حالت شنود دارد آنلاین حساب می‌شود و چون سیستم‌عاملش از سرور معلوم نیست «نامشخص» می‌آید.
 */
export function BreakdownCard({ breakdown }: { breakdown: Overview["breakdown"] | undefined }) {
  const rows = breakdown?.platform ?? [];
  const total = breakdown?.total ?? 0;
  const mx = rows[0]?.[1] || 1;
  return (
    <div className="card" style={{ flex: "1 1 360px", minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div className="card-head" style={{ padding: "14px 22px" }}>
        <span className="card-title" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
          دستگاه‌های آنلاین به تفکیک پلتفرم
          <InfoTip text="دستگاهی آنلاین است که در یک دقیقهٔ اخیر به پنل گزارش داده باشد. دستگاه‌های قدیمی که به پنل گزارش نمی‌دهند فقط وقتی شمرده می‌شوند که ایجنت حالت شنود داشته باشد و چون سیستم‌عاملشان از سرور معلوم نیست «نامشخص» می‌آیند." />
        </span>
        {breakdown && <span style={{ fontSize: 13, color: "var(--muted)" }}>{fmt(total)} دستگاه</span>}
      </div>
      {rows.length ? (
        <div style={{ padding: "10px 22px 16px", display: "flex", flexDirection: "column" }}>
          {rows.map(([label, n]) => (
            <div key={label} className={s.bdRow}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--text-2)" }}>{label}</span>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{fmt(n)}</span>
                <span style={{ fontSize: 12, color: "var(--faint)", width: 36, textAlign: "left" }}>{pctText(total ? (n / total) * 100 : 0)}</span>
              </div>
              <div className="bar">
                <div style={{ width: `${(n / mx) * 100}%`, background: "var(--ok)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">در این لحظه دستگاهی آنلاین نیست.</div>
      )}
      {breakdown && breakdown.legacy > 0 && !breakdown.legacy_known && (
        <div style={{ padding: "0 22px 16px", fontSize: 12.5, color: "var(--faint)", lineHeight: 1.9, display: "flex", flexDirection: "column", gap: 6 }}>
          <span>وضعیت {toFa(breakdown.legacy)} دستگاه قدیمی (بدون API) نامشخص است و در این شمار نیست. برای دیدنشان، روی سرور hbbs (پوشه‌ای که ایجنت را clone کردید) این را بزنید؛ فقط کانتینر ایجنت تغییر می‌کند:</span>
          {breakdown.online_command && (
            <code dir="ltr" style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11.5, background: "var(--subtle)", borderRadius: 8, padding: "6px 8px", overflowWrap: "anywhere", color: "var(--text-2)" }}>
              {breakdown.online_command}
            </code>
          )}
        </div>
      )}
    </div>
  );
}
