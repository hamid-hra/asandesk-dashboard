"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { whenText } from "@/lib/people";
import { type WebClientInfo } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { errText, I } from "./ui";
import { JobStatusRow, UpdateProgressDialog } from "./UpdateProgress";

const KIND: Record<string, string> = { new: "جدید", change: "تغییر", fix: "رفع اشکال" };
const Ver = ({ v }: { v: string | null | undefined }) => (v ? <span dir="ltr" className="mono">{v}</span> : <span>—</span>);

/**
 * کلاینت وب آسان دسک (سرویس‌های web و webgw همین پنل) جدا از خود پنل به‌روز می‌شود: control فقط وقتی تغییرات
 * تازه در GitHub فقط پوشه‌های web/ و webgw/ را عوض کرده باشد git pull می‌زند و همین دو سرویس را دوباره می‌سازد؛
 * پنل در این مدت بی‌وقفه کار می‌کند. اگر نسخهٔ تازه به تغییر پنل هم نیاز دارد، از «به‌روزرسانی پنل» (که کلاینت
 * وب را هم می‌سازد) استفاده می‌شود.
 */
export function WebClientUpdates() {
  const flash = useToast();
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const refreshInterval = useCallback((latest?: WebClientInfo) => (latest?.job?.state === "running" ? 2000 : 30000), []);
  const { data, mutate } = useSWR<WebClientInfo>("/api/settings/system/update/web", fetcher, { refreshInterval, keepPreviousData: true });

  if (!data || !data.control.online) return null;
  const check = data.check;
  const job = data.job && data.job.state !== "none" ? data.job : null;
  const running = job?.state === "running";

  const runCheck = async () => {
    setChecking(true);
    try {
      await mutate(await api<WebClientInfo>("/api/settings/system/update/web/check", { method: "POST" }), { revalidate: false });
    } catch (e) {
      flash(errText(e));
    } finally {
      setChecking(false);
    }
  };
  const start = async () => {
    setStarting(true);
    try {
      await mutate(await api<WebClientInfo>("/api/settings/system/update/web/start", { method: "POST" }), { revalidate: false });
      setProgressOpen(true);
    } catch (e) {
      flash(errText(e));
    } finally {
      setStarting(false);
      setConfirm(false);
    }
  };

  return (
    <div className={`card ${s.cardPad}`}>
      <div className={s.cardHead}>
        <div>
          <b>به‌روزرسانی کلاینت وب آسان دسک</b>
          <small>
            web.asandesk.ir · نسخهٔ در حال اجرا <Ver v={data.running?.version} />
            {check?.checked_at && <> · بررسی: {whenText(check.checked_at)}</>}
          </small>
        </div>
        <button className={s.btnGhost} onClick={runCheck} disabled={checking || running}>
          <Icon d={I.refresh} size={15} /> {checking ? "در حال بررسی…" : "بررسی نسخهٔ جدید"}
        </button>
      </div>

      {!data.running && (
        <div className={s.note} data-tone="warn">
          <Icon d={I.alert} size={18} />
          <span>
            <b>سرویس web جواب نمی‌دهد</b>
            کلاینت وب هنوز ساخته نشده یا بالا نیست. «به‌روزرسانی کلاینت وب» آن را دوباره می‌سازد.
          </span>
        </div>
      )}

      {data.check_error && (
        <div className={s.note} data-tone="danger">
          <Icon d={I.alert} size={18} />
          <span><b>بررسی انجام نشد</b>{data.check_error}</span>
        </div>
      )}
      {!data.check_error && !check && <div className={s.sub}>هنوز بررسی نشده؛ «بررسی نسخهٔ جدید» را بزنید.</div>}

      {check && !check.available && (
        <div className={s.note} data-tone="ok">
          <Icon d={I.check} size={18} />
          <span><b>کلاینت وب به‌روز است</b>نسخهٔ <Ver v={data.running?.version ?? check.disk_version} /> آخرین نسخهٔ شاخهٔ <span dir="ltr" className="mono">{check.branch}</span> است.</span>
        </div>
      )}

      {check?.available && (
        <>
          <div className={s.note} data-tone={check.needs_panel ? "warn" : "info"}>
            <Icon d={check.needs_panel ? I.alert : I.cloud} size={18} />
            <span>
              <b>
                {check.needs_panel ? "این نسخه به تغییر پنل هم نیاز دارد" : check.pending_build && !check.commits.length ? "کد نسخهٔ جدید روی سرور هست ولی هنوز ساخته نشده" : "نسخهٔ جدید کلاینت وب آماده است"}
                {check.remote_version && check.remote_version !== data.running?.version && <> — <Ver v={check.remote_version} /></>}
              </b>
              {check.needs_panel
                ? "از بخش «به‌روزرسانی پنل» بالا به‌روز کنید؛ آن به‌روزرسانی کلاینت وب را هم می‌سازد."
                : `${check.commits.length ? `${toFa(check.commits.length)} تغییر جدید برای کلاینت وب. ` : ""}فقط سرویس‌های web و webgw دوباره ساخته می‌شوند و پنل بی‌وقفه کار می‌کند؛ کاربرانی که صفحه را باز دارند چند ثانیه قطع و دوباره وصل می‌شوند.`}
            </span>
          </div>

          {check.new_entries.length > 0 && (
            <div className={s.changes}>
              {check.new_entries.map((e) => (
                <section key={e.version}>
                  <header>
                    <span dir="ltr" className="mono">{e.version}</span>
                    <b>{e.title}</b>
                    <small>{e.date}</small>
                  </header>
                  <ul>
                    {e.items.map((it, i) => (
                      <li key={i}>
                        <span className={s.kind} data-kind={it.type}>{KIND[it.type] ?? it.type}</span>
                        <span>{it.text}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          {check.commits.length > 0 && (
            <details className={s.commits}>
              <summary>{toFa(check.commits.length)} commit جدید کلاینت وب</summary>
              {check.commits.map((c) => (
                <div key={c.sha}>
                  <span dir="ltr" className="mono">{c.sha.slice(0, 7)}</span> {c.subject} <small>· {c.author}</small>
                </div>
              ))}
            </details>
          )}

          {!check.needs_panel && (
            <div className={s.row2}>
              {confirm ? (
                <>
                  <span className={s.sub}>کلاینت وب از GitHub گرفته و دوباره ساخته شود؟ (حدود یک تا سه دقیقه)</span>
                  <span style={{ display: "flex", gap: 8 }}>
                    <button className={s.btnGhost} onClick={() => setConfirm(false)} disabled={starting}>انصراف</button>
                    <button className={s.btnPrimary} onClick={start} disabled={starting || running}>
                      <Icon d={I.cloud} size={16} /> {starting ? "در حال شروع…" : "شروع به‌روزرسانی"}
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className={s.sub}>{check.dirty && "روی سرور فایل‌های تغییرکرده هست؛ اگر تداخل داشته باشند git pull خطا می‌دهد."}</span>
                  <button className={s.btnPrimary} onClick={() => setConfirm(true)} disabled={running}>
                    <Icon d={I.cloud} size={16} /> به‌روزرسانی کلاینت وب
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}

      {job && <JobStatusRow kind="web" job={job} onOpen={() => setProgressOpen(true)} />}

      {job && progressOpen && (
        <UpdateProgressDialog kind="web" title="به‌روزرسانی کلاینت وب آسان دسک" job={job} onClose={() => setProgressOpen(false)}>
          {job.state === "ok" && (
            <div className={s.note} data-tone="ok">
              <Icon d={I.check} size={18} />
              <span><b>کلاینت وب به‌روز شد</b>کاربرانی که صفحه را باز دارند با بارگذاری دوباره نسخهٔ تازه را می‌گیرند.</span>
            </div>
          )}
          {job.state === "failed" && (
            <div className={s.note} data-tone="danger">
              <Icon d={I.alert} size={18} />
              <span><b>مرحله‌ای خطا داد</b>لاگ زیر علتش را نشان می‌دهد؛ کلاینت وب فعلی معمولاً همان‌طور که بود کار می‌کند.</span>
            </div>
          )}
        </UpdateProgressDialog>
      )}
    </div>
  );
}
