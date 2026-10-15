"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { Avatar } from "@/components/clients/Avatar";
import s from "@/components/clients/clients.module.css";
import { Seg } from "@/components/clients/SearchBox";
import { api, ApiError, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { agoText, bytesText, categoryText, TICKET_STATUS, timeOnly, whenText } from "@/lib/people";
import { toFa } from "@/lib/fa";
import { copyText } from "@/lib/settings";
import { useToast } from "@/lib/toast";
import type { TicketDetail, TicketStatus } from "@/lib/types";

const STATUSES: [TicketStatus, string][] = (["open", "closed"] as TicketStatus[]).map((k) => [k, TICKET_STATUS[k][0]]);

/** شماره‌ای که می‌شود با آن تماس گرفت (۷ تا ۱۵ رقم، با + و فاصله و خط تیره)؛ ایمیل و آیدی نه */
const phoneOf = (contact: string) => {
  const digits = contact.replace(/[\s\-()]/g, "");
  return /^\+?\d{7,15}$/.test(digits) ? digits : null;
};

export function TicketView({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { user } = useAuth();
  const flash = useToast();
  const { data: t, error, mutate } = useSWR<TicketDetail>(`/api/tickets/${id}`, fetcher, { refreshInterval: 20000 });
  const [busy, setBusy] = useState(false);

  const setStatus = async (st: TicketStatus) => {
    setBusy(true);
    try {
      const next = await api<TicketDetail>(`/api/tickets/${id}`, { method: "PATCH", body: { status: st } });
      mutate(next, { revalidate: false });
      onChanged();
      flash(`وضعیت: ${TICKET_STATUS[st][0]}`);
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "انجام نشد.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className={`card ${s.tDetail}`}>
        <div className="empty">این بازخورد پیدا نشد.</div>
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

  const c = t.client;
  const phone = phoneOf(t.contact);
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
              {t.category && (
                <span className={s.chip} style={{ background: "var(--seg-track)", color: "var(--muted)" }}>
                  {categoryText(t.category)}
                </span>
              )}
            </div>
          </div>
          {user.can_manage ? (
            <Seg options={STATUSES} value={t.status} onChange={(st) => st !== t.status && !busy && setStatus(st)} />
          ) : (
            <span className={s.chip} style={{ background: "var(--seg-track)", color: "var(--text-2)", fontSize: 12.5 }}>
              {TICKET_STATUS[t.status][0]}
            </span>
          )}
        </div>

        {t.contact ? (
          <div className={s.callCard}>
            <div className={s.callText}>
              <span>کاربر راه تماس گذاشته است؛ با او تماس بگیرید</span>
              <b dir="ltr" className="mono">
                {t.contact}
              </b>
            </div>
            {phone && (
              <a className={s.btnGhost} style={{ height: 34, padding: "0 14px", fontSize: 12.5, display: "inline-flex", alignItems: "center" }} href={`tel:${phone}`}>
                تماس
              </a>
            )}
            <button
              className={s.btnGhost}
              style={{ height: 34, padding: "0 14px", fontSize: 12.5 }}
              onClick={async () => flash((await copyText(t.contact)) ? "کپی شد" : "کپی نشد")}
            >
              کپی
            </button>
          </div>
        ) : (
          <div className={s.noCall}>کاربر راه تماس نگذاشته است؛ پاسخی به او فرستاده نمی‌شود.</div>
        )}

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
          {t.log && (
            <div className={s.diag}>
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                لاگ برنامه · {bytesText(t.log.size)}
                {t.log.files.length ? ` · ${toFa(t.log.files.length)} فایل` : ""}
              </span>
              <a className={s.btnGhost} style={{ height: 34, padding: "0 14px", fontSize: 12.5, display: "inline-flex", alignItems: "center" }} href={`/api/tickets/${id}/log`} download>
                دانلود لاگ
              </a>
            </div>
          )}
        </div>
        {t.images.length > 0 && (
          <div className={s.shots}>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>تصویرهای پیوست · {toFa(t.images.length)} (برای دیدن اندازهٔ اصلی بزنید)</span>
            <div className={s.shotRow}>
              {t.images.map((im, i) => (
                <a key={im.id} className={s.shot} href={`/api/tickets/${id}/images/${im.id}`} target="_blank" rel="noopener noreferrer" title={bytesText(im.size)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- تصویر کاربر از API پنل با نشست لاگین؛ بهینه‌سازی next/image لازم نیست */}
                  <img src={`/api/tickets/${id}/images/${im.id}`} alt={`تصویر پیوست ${toFa(i + 1)}`} loading="lazy" />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className={s.msgs}>
        {t.messages.map((m) => (
          <div key={m.id} className={s.msg}>
            <span>
              {c.display} · {timeOnly(m.created_at)}
            </span>
            <div dir="auto" style={{ background: "var(--subtle)" }}>
              {m.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
