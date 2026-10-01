"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { Avatar } from "@/components/clients/Avatar";
import s from "@/components/clients/clients.module.css";
import { Seg } from "@/components/clients/SearchBox";
import { api, ApiError, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { agoText, PRIORITY, TICKET_STATUS, timeOnly, whenText } from "@/lib/people";
import { useToast } from "@/lib/toast";
import type { TicketDetail, TicketStatus } from "@/lib/types";

function quickReplies(latest: string | null): [string, string][] {
  return [
    ["درخواست لاگ", "لطفاً از منوی راهنما ← ارسال گزارش، لاگ برنامه را برای ما بفرستید."],
    [
      "به‌روزرسانی",
      `لطفاً برنامه را به آخرین نسخه${latest ? ` (${latest})` : ""} به‌روزرسانی کنید و دوباره امتحان کنید.`,
    ],
    ["رفع شد", "مشکل بررسی و برطرف شد. لطفاً دوباره امتحان کنید و نتیجه را اطلاع دهید."],
  ];
}

const STATUSES: [TicketStatus, string][] = (["open", "pending", "closed"] as TicketStatus[]).map((k) => [k, TICKET_STATUS[k][0]]);

export function TicketView({ id, latest, onChanged }: { id: number; latest: string | null; onChanged: () => void }) {
  const { user } = useAuth();
  const flash = useToast();
  const { data: t, error, mutate } = useSWR<TicketDetail>(`/api/tickets/${id}`, fetcher, { refreshInterval: 20000 });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<TicketDetail>, msg: string) => {
    setBusy(true);
    try {
      const next = await fn();
      mutate(next, { revalidate: false });
      onChanged();
      flash(msg);
      return true;
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "انجام نشد.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async (close: boolean) => {
    const text = reply.trim();
    if (!text) return;
    const ok = await run(
      () => api<TicketDetail>(`/api/tickets/${id}/reply`, { method: "POST", body: { text, close } }),
      close ? "پاسخ ارسال و تیکت بسته شد" : "پاسخ ارسال شد",
    );
    if (ok) setReply("");
  };

  if (error) {
    return (
      <div className={`card ${s.tDetail}`}>
        <div className="empty">این تیکت پیدا نشد.</div>
      </div>
    );
  }
  if (!t) {
    return (
      <div className={`card ${s.tDetail}`}>
        <div className="empty">در حال بارگذاری…</div>
      </div>
    );
  }

  const [prLabel, prBg, prColor] = PRIORITY[t.priority];
  const c = t.client;
  return (
    <div className={`card ${s.tDetail}`}>
      <div className={s.tHead}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.6 }}>{t.subject}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 12, color: "var(--faint)" }}>
              <span dir="ltr" className="mono" style={{ whiteSpace: "nowrap" }}>
                {t.code}
              </span>
              <span>·</span>
              <span style={{ whiteSpace: "nowrap" }}>{whenText(t.created_at)}</span>
              <span className={s.chip} style={{ fontWeight: 600, background: prBg, color: prColor }}>
                {prLabel}
              </span>
              {t.category && (
                <span className={s.chip} style={{ background: "var(--seg-track)", color: "var(--muted)" }}>
                  {t.category}
                </span>
              )}
            </div>
          </div>
          {user.can_manage ? (
            <Seg
              options={STATUSES}
              value={t.status}
              onChange={(st) =>
                st !== t.status &&
                run(() => api<TicketDetail>(`/api/tickets/${id}`, { method: "PATCH", body: { status: st } }), `وضعیت: ${TICKET_STATUS[st][0]}`)
              }
            />
          ) : (
            <span className={s.chip} style={{ background: "var(--seg-track)", color: "var(--text-2)", fontSize: 12.5 }}>
              {TICKET_STATUS[t.status][0]}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href={`/clients?id=${encodeURIComponent(c.id)}`} className={s.linkRow} style={{ flex: "1 1 240px", padding: "10px 12px", borderRadius: 11 }}>
            <Avatar id={c.id} name={c.display} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className={s.name} style={{ fontSize: 13.5 }}>
                {c.display}
              </span>
              <span style={{ fontSize: 11.5, color: "var(--faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.logged ? "وارد شده" : "مهمان"} · {c.plan === "pro" ? "حرفه‌ای" : "رایگان"} · {c.online ? "آنلاین" : agoText(c.last_seen)}
              </span>
            </div>
            <span style={{ fontSize: 12, color: "var(--accent)", fontWeight: 600, whiteSpace: "nowrap" }}>مشاهده کلاینت ←</span>
          </Link>
          <div className={s.diag}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>اطلاعات پیوست‌شده خودکار</span>
            <span dir="ltr" className="mono" style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-2)", textAlign: "right" }}>
              {t.diag || "—"}
            </span>
          </div>
        </div>
      </div>

      <div className={s.msgs}>
        {t.messages.map((m) => (
          <div key={m.id} className={s.msg} style={{ alignSelf: m.from_client ? "flex-start" : "flex-end" }}>
            <span>
              {m.from_client ? c.display : m.author ? `پشتیبانی · ${m.author}` : "پشتیبانی آسان‌دسک"} · {timeOnly(m.created_at)}
            </span>
            <div dir="auto" style={{ background: m.from_client ? "var(--subtle)" : "var(--accent-soft)" }}>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      {user.can_manage && (
        <div className={s.reply}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {quickReplies(latest).map(([label, text]) => (
              <button key={label} className={s.quick} onClick={() => setReply(text)}>
                {label}
              </button>
            ))}
          </div>
          <textarea className={s.textarea} rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="پاسخ به کاربر…" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className={s.btnPrimary} style={{ height: 40, padding: "0 20px", fontSize: 13.5, fontWeight: 700 }} disabled={busy || !reply.trim()} onClick={() => send(false)}>
              ارسال پاسخ
            </button>
            <button className={s.btnGhost} style={{ height: 40, padding: "0 16px", fontSize: 13.5 }} disabled={busy || !reply.trim()} onClick={() => send(true)}>
              ارسال و بستن تیکت
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
