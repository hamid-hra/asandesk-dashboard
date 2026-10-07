"use client";

import { useState } from "react";

import { Icon } from "@/components/Icon";
import { errText, I, Modal } from "@/components/settings/ui";
import st from "@/components/settings/settings.module.css";
import { api } from "@/lib/api";
import { faDate, fmt, toFa } from "@/lib/fa";
import type { Channel, Release } from "@/lib/types";

import s from "./releases.module.css";

export function ReleaseHistory({
  releases,
  current,
  canDelete = false,
  onDeleted,
}: {
  releases: Release[] | undefined;
  current: string | null;
  canDelete?: boolean;
  onDeleted?: (version: string) => void;
}) {
  const [filter, setFilter] = useState<"all" | Channel>("all");
  const [del, setDel] = useState<Release | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const remove = async () => {
    if (!del) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/releases/${encodeURIComponent(del.version)}`, { method: "DELETE" });
      onDeleted?.(del.version);
      setDel(null);
    } catch (e) {
      setError(errText(e, "حذف نسخه انجام نشد."));
    } finally {
      setBusy(false);
    }
  };

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
                {r.maintenance && (
                  <span className={s.badge} style={{ background: "var(--warn-soft)", color: "var(--warn-text)" }}>
                    تعمیر
                  </span>
                )}
                {!r.enabled && (
                  <span className={s.badge} style={{ background: "var(--subtle)", color: "var(--muted)" }}>
                    غیرفعال
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
                <a className={s.plat} href={`/api/releases/${r.version}/update.json`} download="update.json" title="فایل update.json همین نسخه برای بارگذاری روی CDN">
                  ↓ update.json
                </a>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>{fmt(r.downloads)}</span>
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>دانلود</span>
              {canDelete && (
                <button
                  type="button"
                  className={st.iconBtn}
                  title={`حذف نسخه ${r.version}`}
                  aria-label={`حذف نسخه ${r.version}`}
                  style={{ marginTop: 6, color: "var(--danger-text)" }}
                  onClick={() => {
                    setError("");
                    setDel(r);
                  }}
                >
                  <Icon d={I.trash} size={16} />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {releases && !rows.length && <div className="empty">هنوز نسخه‌ای منتشر نشده است.</div>}
      {del && (
        <Modal
          title="حذف نسخه"
          onClose={() => setDel(null)}
          busy={busy}
          footer={
            <>
              <button className={st.btnGhost} onClick={() => setDel(null)} disabled={busy}>
                انصراف
              </button>
              <button className={st.btnDanger} onClick={remove} disabled={busy}>
                {busy ? "در حال حذف…" : "حذف نسخه"}
              </button>
            </>
          }
        >
          <div className={st.note} data-tone="danger">
            <Icon d={I.alert} size={18} />
            <span>
              <b>
                نسخهٔ <span dir="ltr">{del.version}</span> برای همیشه حذف می‌شود.
              </b>
              فایل‌های نصبی که داشبورد نگه داشته و شمارندهٔ دانلودهایش پاک می‌شود و قابل بازگشت نیست.
              {del.version === current && " این نسخهٔ فعلی است؛ بعد از حذف، کاربران نسخهٔ پایدار قبلی را به‌عنوان آخرین نسخه می‌بینند."}
              {" "}
              اگر update.json این نسخه را روی CDN گذاشته‌اید، آن را هم جایگزین یا پاک کنید.
            </span>
          </div>
          {error && <div className={st.err}>{error}</div>}
        </Modal>
      )}
    </div>
  );
}
