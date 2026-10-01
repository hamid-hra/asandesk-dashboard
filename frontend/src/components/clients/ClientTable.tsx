import { toFa } from "@/lib/fa";
import { agoText, formatId, minutesText } from "@/lib/people";
import type { ClientRow } from "@/lib/types";

import { Avatar } from "./Avatar";
import s from "./clients.module.css";

function Row({ c, selected, onSelect }: { c: ClientRow; selected: boolean; onSelect: () => void }) {
  const tLabel = c.tickets_open ? `${toFa(c.tickets_open)} باز` : c.tickets_total ? `${toFa(c.tickets_total)} بسته` : "ندارد";
  return (
    <button className={`${s.tr} ${s.row}`} aria-current={selected} onClick={onSelect}>
      <div className={s.who}>
        <Avatar id={c.id} name={c.display} />
        <div className={s.whoText}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span className={s.name}>{c.display}</span>
            {c.blocked && (
              <span className={s.tag} style={{ background: "var(--danger-soft)", color: "var(--danger-strong)" }}>
                مسدود
              </span>
            )}
          </div>
          <span dir="ltr" className={s.idText}>
            {formatId(c.id)}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
        <span className="dot" style={{ background: c.online ? "var(--ok)" : "var(--off)" }} />
        <span style={{ color: c.online ? "var(--accent-strong)" : "var(--muted)" }}>{c.online ? "آنلاین" : agoText(c.last_seen)}</span>
      </div>
      <span
        className={s.pill}
        style={c.logged ? { background: "var(--accent-soft)", color: "var(--accent-strong)" } : { background: "var(--warn-soft)", color: "var(--warn-text)" }}
      >
        {c.logged ? "وارد شده" : "مهمان"}
      </span>
      <div className={s.stack}>
        <span>{c.mins_30d ? minutesText(c.mins_30d) : "—"}</span>
        <span>{toFa(c.sessions_30d)} نشست</span>
      </div>
      <div className={s.stack}>
        <span>{c.platform || "—"}</span>
        <span dir="ltr" style={{ textAlign: "right" }} title={c.os}>
          {c.os || c.ip}
        </span>
      </div>
      <span
        className={s.pill}
        style={c.tickets_open ? { background: "var(--danger-soft)", color: "var(--danger-strong)" } : { background: "var(--seg-track)", color: "var(--muted)" }}
      >
        {tLabel}
      </span>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 3 }}>
        <span dir="ltr" className="mono" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
          {c.version || "—"}
        </span>
        {c.version_old && (
          <span className={s.tag} style={{ fontWeight: 600, background: "var(--warn-soft)", color: "var(--warn-text)" }}>
            قدیمی
          </span>
        )}
      </div>
    </button>
  );
}

export function ClientTable({ rows, selected, onSelect, empty }: { rows: ClientRow[] | undefined; selected: string | null; onSelect: (id: string) => void; empty: string }) {
  return (
    <div className={s.tableScroll}>
      <div className={s.table}>
        <div className={`${s.tr} ${s.th}`}>
          <span>کلاینت</span>
          <span>وضعیت</span>
          <span>حساب</span>
          <span>مدت اتصال · ۳۰ روز</span>
          <span>سیستم‌عامل</span>
          <span>تیکت</span>
          <span>نسخه</span>
        </div>
        {rows?.map((c) => <Row key={c.id} c={c} selected={c.id === selected} onSelect={() => onSelect(c.id)} />)}
        {rows && !rows.length && <div className="empty">{empty}</div>}
        {!rows && <div className="empty">در حال بارگذاری…</div>}
      </div>
    </div>
  );
}
