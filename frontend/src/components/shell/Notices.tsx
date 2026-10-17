"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { agoText } from "@/lib/people";
import type { Notice, NoticeInbox, NoticeKind } from "@/lib/types";

import s from "./Notices.module.css";

export const INBOX_KEY = "/api/notices";

const KIND_LABEL: Record<NoticeKind, string> = { info: "اطلاعیه", update: "به‌روزرسانی پنل", warning: "هشدار" };
const ITEM_KIND: Record<string, string> = { new: "جدید", change: "تغییر", fix: "رفع اشکال" };
const KIND_ICON: Record<NoticeKind, string> = {
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 100-18 9 9 0 000 18z",
  update: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  warning: "M12 3l10 18H2zM12 10v5M12 18h.01",
};
const BELL = "M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0";

function useInbox() {
  return useSWR<NoticeInbox>(INBOX_KEY, fetcher, { refreshInterval: 60000, shouldRetryOnError: false });
}

async function markRead(id: number) {
  try {
    await api(`/api/notices/${id}/read`, { method: "POST" });
  } catch {
    // دفعهٔ بعد دوباره نشان داده می‌شود
  }
}

/** متن و فهرست تغییرات یک اعلان (در پنجره و در منوی زنگوله) */
export function NoticeBody({ n, compact }: { n: Notice; compact?: boolean }) {
  return (
    <>
      {n.body && <p className={s.body}>{n.body}</p>}
      {n.items.length > 0 && (
        <ul className={s.items} data-compact={compact}>
          {(compact ? n.items.slice(0, 3) : n.items).map(([kind, text], i) => (
            <li key={i}>
              <span className={s.itemKind} data-kind={kind}>{ITEM_KIND[kind] ?? kind}</span>
              <span>{text}</span>
            </li>
          ))}
          {compact && n.items.length > 3 && <li className={s.more}>و {toFa(n.items.length - 3)} مورد دیگر…</li>}
        </ul>
      )}
    </>
  );
}

/**
 * پنجرهٔ اعلان‌های خوانده‌نشده با «نمایش در ورود» (مثل «پنل به‌روز شد»): یکی‌یکی، تا کاربر «متوجه شدم» بزند.
 * در هر بار باز شدن پنل فقط اعلان‌هایی که هنوز رد نشده‌اند می‌آیند.
 */
export function NoticePopup() {
  const { data, mutate } = useInbox();
  const [dismissed, setDismissed] = useState<number[]>([]);
  const queue = (data?.results ?? []).filter((n) => n.popup && !n.read && !dismissed.includes(n.id)).reverse(); // قدیمی‌تر اول
  const n = queue[0];
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    ok.current?.focus();
  }, [n?.id]);
  if (!n) return null;

  const dismiss = async () => {
    setDismissed((d) => [...d, n.id]);
    await markRead(n.id);
    void mutate();
  };

  return (
    <div className={s.overlay}>
      <div className={s.dialog} role="dialog" aria-modal="true" aria-labelledby={`notice-${n.id}`} data-kind={n.kind}>
        <div className={s.dlgHead}>
          <span className={s.kindIcon} data-kind={n.kind}>
            <Icon d={KIND_ICON[n.kind]} size={20} />
          </span>
          <div className={s.dlgTitle}>
            <small>
              {KIND_LABEL[n.kind]}
              {n.by && ` · از طرف ${n.by}`} · {agoText(n.created_at)}
            </small>
            <b id={`notice-${n.id}`}>{n.title}</b>
          </div>
          {queue.length > 1 && <span className={s.counter}>{toFa(1)} از {toFa(queue.length)}</span>}
        </div>
        <div className={s.dlgBody}>
          <NoticeBody n={n} />
        </div>
        <div className={s.dlgFoot}>
          <button ref={ok} className={s.okBtn} onClick={dismiss} onKeyDown={(e) => e.key === "Escape" && dismiss()}>
            {queue.length > 1 ? "متوجه شدم، بعدی" : "متوجه شدم"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** زنگولهٔ نوار بالا: اعلان‌های پنل و میان‌بر هشدارهای تأییدنشدهٔ سرور */
export function NoticeBell({ alerts }: { alerts: number }) {
  const { data, mutate } = useInbox();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const unread = data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const readAll = async () => {
    try {
      await api("/api/notices/read-all", { method: "POST" });
    } finally {
      void mutate();
    }
  };

  const toggle = async (n: Notice) => {
    setExpanded((x) => (x === n.id ? null : n.id));
    if (!n.read) {
      await markRead(n.id);
      void mutate();
    }
  };

  const label = unread ? `اعلان‌ها — ${toFa(unread)} خوانده‌نشده` : "اعلان‌ها";
  return (
    <div className={s.bellWrap} ref={ref}>
      <button className={s.bell} onClick={() => setOpen((v) => !v)} aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog">
        <Icon d={BELL} />
        {unread > 0 ? <span className={s.count}>{unread > 9 ? "۹+" : toFa(unread)}</span> : alerts > 0 && <span className={s.dot} />}
      </button>
      {open && (
        <div className={s.panel} role="dialog" aria-label="اعلان‌ها">
          <div className={s.panelHead}>
            <b>اعلان‌ها</b>
            {unread > 0 && (
              <button className={s.linkBtn} onClick={readAll}>
                همه خوانده شد
              </button>
            )}
          </div>
          {alerts > 0 && (
            <Link href="/server#alerts" className={s.alertRow} onClick={() => setOpen(false)}>
              <Icon d={KIND_ICON.warning} size={16} />
              <span>{toFa(alerts)} هشدار سرور تأیید نشده</span>
              <span className={s.arrow}>←</span>
            </Link>
          )}
          <div className={s.list}>
            {!data && <div className={s.empty}>در حال بارگذاری…</div>}
            {data && data.results.length === 0 && <div className={s.empty}>اعلانی ندارید.</div>}
            {data?.results.map((n) => (
              <div key={n.id} className={s.item} data-unread={!n.read}>
                <button className={s.itemHead} aria-expanded={expanded === n.id} onClick={() => toggle(n)}>
                  <span className={s.kindIcon} data-kind={n.kind} data-small>
                    <Icon d={KIND_ICON[n.kind]} size={15} />
                  </span>
                  <span className={s.itemText}>
                    <b>{n.title}</b>
                    <small>
                      {KIND_LABEL[n.kind]} · {agoText(n.created_at)}
                      {n.by && ` · ${n.by}`}
                    </small>
                  </span>
                  {!n.read && <span className={s.unreadDot} aria-label="خوانده‌نشده" />}
                </button>
                {expanded === n.id && (n.body || n.items.length > 0) && (
                  <div className={s.itemBody}>
                    <NoticeBody n={n} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
