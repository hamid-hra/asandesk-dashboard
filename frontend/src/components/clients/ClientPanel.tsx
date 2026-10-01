"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { api, ApiError, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dfDay, toFa } from "@/lib/fa";
import { agoText, durationText, formatId, minutesText, TICKET_STATUS, whenText } from "@/lib/people";
import { useToast } from "@/lib/toast";
import type { ClientDetail } from "@/lib/types";

import { Avatar } from "./Avatar";
import s from "./clients.module.css";

const CONN_TYPE: Record<number, string> = { 0: "ریموت", 1: "انتقال فایل", 2: "انتقال پورت", 3: "دوربین", 4: "ترمینال" };

function Badges({ c }: { c: ClientDetail }) {
  const items: [string, string, string][] = [
    c.online ? ["آنلاین", "var(--accent-soft)", "var(--accent-strong)"] : [`آفلاین · ${agoText(c.last_seen)}`, "var(--seg-track)", "var(--muted)"],
    c.logged ? ["وارد حساب شده", "var(--accent-soft)", "var(--accent-strong)"] : ["مهمان · بدون ورود", "var(--warn-soft)", "var(--warn-text)"],
    c.plan === "pro" ? ["حرفه‌ای", "var(--beta-soft)", "var(--beta-text)"] : ["رایگان", "var(--seg-track)", "var(--muted)"],
  ];
  if (c.version_old) items.push(["نسخه قدیمی", "var(--warn-soft)", "var(--warn-text)"]);
  if (c.version.includes("-")) items.push(["تست‌کننده بتا", "var(--info-soft)", "var(--info-text)"]);
  if (c.blocked) items.push(["مسدود", "var(--danger-soft)", "var(--danger-strong)"]);
  return (
    <div className={s.badges}>
      {items.map(([label, bg, color]) => (
        <span key={label} style={{ background: bg, color }}>
          {label}
        </span>
      ))}
    </div>
  );
}

function Daily({ daily }: { daily: number[] }) {
  const mx = Math.max(...daily, 1);
  return (
    <div dir="ltr" className={s.dailyBars}>
      {daily.map((v, i) => (
        <span
          key={i}
          title={`${Math.round(v)} min`}
          style={{ height: Math.max(3, (v / mx) * 72), background: i === daily.length - 1 ? "var(--ok)" : v ? "var(--bar-mid)" : "var(--track)" }}
        />
      ))}
    </div>
  );
}

function MessageComposer({ id, onSent, onCancel }: { id: string; onSent: (ticketId: number) => void; onCancel: () => void }) {
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const t = await api<{ id: number }>(`/api/clients/${id}/message`, { method: "POST", body: { subject, text } });
      onSent(t.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ارسال نشد.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.composer}>
      <input className={s.input} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="موضوع" />
      <textarea className={s.textarea} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="متن پیام…" />
      {error && <div style={{ fontSize: 12.5, color: "var(--danger-text)" }}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className={s.btnPrimary} style={{ flex: 1 }} disabled={busy || !subject.trim() || !text.trim()} onClick={send}>
          ارسال پیام
        </button>
        <button className={s.btnGhost} onClick={onCancel}>
          انصراف
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--faint)", lineHeight: 1.8 }}>پیام به‌صورت تیکت پشتیبانی برای کاربر ثبت می‌شود و در بخش تیکت‌ها پیگیری می‌شود.</div>
    </div>
  );
}

export function ClientPanel({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { user } = useAuth();
  const flash = useToast();
  const { data: c, error, mutate } = useSWR<ClientDetail>(`/api/clients/${encodeURIComponent(id)}`, fetcher, { refreshInterval: 30000 });
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (path: string, body: unknown, msg: string) => {
    setBusy(true);
    try {
      await api(`/api/clients/${encodeURIComponent(id)}/${path}`, { method: "POST", body });
      await mutate();
      onChanged();
      flash(msg);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "انجام نشد.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className={`card ${s.panel}`}>
        <div className="empty">این کلاینت پیدا نشد.</div>
      </div>
    );
  }
  if (!c) {
    return (
      <div className={`card ${s.panel}`}>
        <div className="empty">در حال بارگذاری…</div>
      </div>
    );
  }

  const openT = c.tickets.filter((t) => t.status !== "closed").length;
  const info: [string, string][] = [
    ["سیستم‌عامل", c.os || "—"],
    ["نسخه برنامه", c.version || "—"],
    ["IP", c.ip || "—"],
    ["نام دستگاه", c.hostname ? `${c.hostname}${c.os_user ? ` · ${c.os_user}` : ""}` : "—"],
    ["سخت‌افزار", [c.cpu, c.memory].filter(Boolean).join(" · ") || "—"],
    ["دستگاه‌های متصل به حساب", c.logged ? toFa(c.devices) : "—"],
    ["اولین تماس", dfDay.format(new Date(c.first_seen))],
    ["آخرین فعالیت", c.online ? "هم‌اکنون" : agoText(c.last_seen)],
  ];

  return (
    <div className={`card ${s.panel}`}>
      <div className={s.panelHead}>
        <Avatar id={c.id} name={c.display} size={48} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>{c.display}</span>
          <span dir="ltr" className="mono" style={{ fontSize: 12, color: "var(--faint)", textAlign: "right", overflowWrap: "anywhere" }}>
            {formatId(c.id)} · {c.email || "بدون حساب"}
          </span>
        </div>
        <button className={s.iconBtn} onClick={onClose} title="بستن" aria-label="بستن">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <Badges c={c} />
      <div className={s.miniStats}>
        <div className={s.miniStat}>
          <span>مدت اتصال</span>
          <span>{c.mins_30d ? minutesText(c.mins_30d) : "—"}</span>
          <span>۳۰ روز اخیر</span>
        </div>
        <div className={s.miniStat}>
          <span>تعداد نشست</span>
          <span>{toFa(c.sessions_30d)}</span>
          <span>{c.sessions_30d ? `میانگین ${toFa(Math.round(c.mins_30d / c.sessions_30d))} دقیقه` : "۳۰ روز اخیر"}</span>
        </div>
        <div className={s.miniStat}>
          <span>پلتفرم</span>
          <span>{c.platform || "—"}</span>
          <span>{c.memory || " "}</span>
        </div>
        <div className={s.miniStat}>
          <span>تیکت‌ها</span>
          <span>{toFa(c.tickets.length)}</span>
          <span>{openT ? `${toFa(openT)} باز` : "بدون تیکت باز"}</span>
        </div>
      </div>

      <div className={s.section} style={{ gap: 10 }}>
        <div className={s.sectionHead}>
          <span>مدت اتصال روزانه</span>
          <span>۱۴ روز اخیر</span>
        </div>
        <Daily daily={c.daily} />
      </div>

      <div className={s.section} style={{ padding: "6px 20px 12px", gap: 0 }}>
        {info.map(([k, v]) => (
          <div key={k} className={s.info}>
            <span>{k}</span>
            <span dir="auto">{v}</span>
          </div>
        ))}
      </div>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <span>آخرین نشست‌ها</span>
          <span />
        </div>
        {c.sessions.map((x) => (
          <div key={x.at + x.peer} className={s.sess}>
            <span className={s.sessIcon}>{x.outgoing ? "↗" : "↙"}</span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ color: "var(--text-2)" }}>
                {x.outgoing ? "اتصال به" : "اتصال از"}{" "}
                <b dir="ltr" className="mono" style={{ fontSize: 11.5 }}>
                  {formatId(x.peer)}
                </b>
                {x.type != null && x.type !== 0 && <span style={{ color: "var(--faint)" }}> · {CONN_TYPE[x.type] ?? ""}</span>}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--faint)" }}>{whenText(x.at)}</span>
            </div>
            <span style={{ fontWeight: 600, whiteSpace: "nowrap", color: x.active ? "var(--accent-strong)" : undefined }}>
              {x.active ? "در حال اتصال" : durationText(x.minutes)}
            </span>
          </div>
        ))}
        {!c.sessions.length && <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "4px 0" }}>هنوز نشستی گزارش نشده است.</div>}
      </div>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <span>تیکت‌ها و گزارش مشکل</span>
          <span>{c.tickets.length ? `${toFa(c.tickets.length)} تیکت · ${toFa(openT)} باز` : ""}</span>
        </div>
        {c.tickets.map((t) => (
          <Link key={t.id} href={`/tickets?id=${t.id}`} className={s.linkRow}>
            <span className="dot" style={{ background: TICKET_STATUS[t.status][1] }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</span>
            <span style={{ fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap" }}>{TICKET_STATUS[t.status][0]}</span>
          </Link>
        ))}
        {!c.tickets.length && <div style={{ fontSize: 12.5, color: "var(--faint)", padding: "4px 0" }}>این کاربر تیکتی ثبت نکرده و مشکلی گزارش نداده است.</div>}
      </div>

      {user.can_manage && (
        <div className={s.actions}>
          {composing ? (
            <MessageComposer
              id={c.id}
              onCancel={() => setComposing(false)}
              onSent={() => {
                setComposing(false);
                mutate();
                onChanged();
                flash(`پیام برای ${c.display} ارسال شد`);
              }}
            />
          ) : (
            <>
              <button className={s.btnPrimary} style={{ flex: "1 1 auto" }} onClick={() => setComposing(true)}>
                ارسال پیام
              </button>
              {c.logged && (
                <button className={s.btnGhost} disabled={busy} onClick={() => act("logout", undefined, "کاربر از حساب خارج شد")}>
                  خروج اجباری
                </button>
              )}
              <button
                className={`${s.btnGhost} ${c.blocked ? "" : s.btnDanger}`}
                disabled={busy}
                onClick={() => act("block", { blocked: !c.blocked }, c.blocked ? "مسدودیت برداشته شد" : "کلاینت مسدود شد")}
              >
                {c.blocked ? "رفع مسدودیت" : "مسدودسازی"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
