"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { api, fetcher } from "@/lib/api";
import { toFa } from "@/lib/fa";
import { whenText } from "@/lib/people";
import { jStamp, type UpdateInfo, type UpdateJob } from "@/lib/settings";
import { useToast } from "@/lib/toast";

import s from "./settings.module.css";
import { ErrorState, errText, I, Modal, Skeleton } from "./ui";
import { AgentUpdates } from "./AgentUpdates";
import { UpdateBottle } from "./UpdateBottle";

const KIND: Record<string, string> = { new: "جدید", change: "تغییر", fix: "رفع اشکال" };
const JOB_TEXT: Record<string, string> = { running: "در حال به‌روزرسانی…", ok: "به‌روزرسانی انجام شد", failed: "به‌روزرسانی ناموفق بود" };

/** شمارهٔ نسخه همیشه لاتین و چپ‌به‌راست (ارقام فارسی «۱٫۷٫۰» خوانا نیست) */
function Ver({ v }: { v: string }) {
  return <span dir="ltr" className="mono">{v}</span>;
}

// مراحل کار به‌روزرسانی از روی لاگ (control/control.py → job_script): [کف، سقف درصد، متن]
const STAGES: [number, number, string][] = [
  [2, 8, "آماده‌سازی…"],
  [8, 15, "گرفتن کد جدید از GitHub…"],
  [15, 72, "ساختن سرویس‌ها (build)…"],
  [72, 86, "جایگزینی سرویس‌ها با نسخهٔ تازه…"],
  [86, 97, "راه‌اندازی دوباره و بررسی سلامت سرویس‌ها…"],
];

/**
 * درصد تقریبی پیشرفت. مرحله از روی لاگ معلوم است؛ داخل هر مرحله زمان سپری‌شده جلو می‌برد
 * (به‌روزرسانی معمولاً ۳ تا ۶ دقیقه طول می‌کشد) ولی از سقف همان مرحله رد نمی‌شود.
 */
function progressOf(job: UpdateJob, restarting: boolean): { pct: number; stage: string } {
  if (job.state === "ok") return { pct: 100, stage: "به‌روزرسانی تمام شد" };
  const log = job.log ?? "";
  let i = 0;
  if (log.includes("[1/2]")) i = 1;
  if (log.includes("[2/2]")) i = 2;
  if (/\b(Built|Recreate|Recreated|Creating|Created)\b/.test(log)) i = 3;
  if (/\bStart(ing|ed)\b/.test(log) || restarting) i = 4;
  const [floor, ceil, stage] = STAGES[i];
  const sec = job.started_at ? Math.max(0, (Date.now() - new Date(job.started_at).getTime()) / 1000) : 0;
  const byTime = 100 * (1 - Math.exp(-sec / 140));
  const pct = Math.max(floor, Math.min(ceil, byTime));
  return { pct: job.state === "failed" ? Math.max(pct, 30) : pct, stage: job.state === "failed" ? "به‌روزرسانی ناموفق بود" : stage };
}

function elapsed(job: UpdateJob): string {
  if (!job.started_at) return "";
  const end = job.finished_at && !job.finished_at.startsWith("0001") ? new Date(job.finished_at).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - new Date(job.started_at).getTime()) / 1000));
  return `${toFa(Math.floor(sec / 60))}:${toFa(String(sec % 60).padStart(2, "0"))}`;
}

/** تنظیمات ← به‌روزرسانی پنل (فقط مالک): نسخهٔ جدید را در GitHub می‌بیند و با یک دکمه نصب می‌کند. */
export function UpdateTab() {
  const flash = useToast();
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // نسخهٔ پنل لحظهٔ شروع؛ تا وقتی پر است یعنی همین صفحه به‌روزرسانی را شروع کرده و باید منتظر برگشتن پنل بماند
  const [startedFrom, setStartedFrom] = useState<string | null>(null);
  const autoChecked = useRef(false);
  const logEnd = useRef<HTMLDivElement>(null);
  // لاگ کار به‌روزرسانی فقط با دکمهٔ «مشاهدهٔ لاگ‌ها»؛ اگر خطا داد خودش باز می‌شود
  const [showLog, setShowLog] = useState<boolean | null>(null);

  // هنگام به‌روزرسانی هر ۲ ثانیه؛ وگرنه هر ۳۰ ثانیه. وقتی سرویس‌ها دوباره بالا می‌آیند درخواست‌ها چند بار شکست می‌خورد و SWR دوباره تلاش می‌کند
  // تابع ثابت: SWR با هر تابع تازه تایمرش را از نو می‌سازد، پس با هر رندر نظرسنجی عقب می‌افتاد
  const refreshInterval = useCallback((latest?: UpdateInfo) => (latest?.job?.state === "running" || startedFrom !== null ? 2000 : 30000), [startedFrom]);
  const { data, error, mutate } = useSWR<UpdateInfo>("/api/settings/system/update", fetcher, { refreshInterval, keepPreviousData: true });

  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await api<UpdateInfo>("/api/settings/system/update/check", { method: "POST" });
      await mutate(r, { revalidate: false });
    } catch (e) {
      flash(errText(e));
    } finally {
      setChecking(false);
    }
  };

  // اولین باز شدن: اگر هنوز بررسی نشده، همین حالا بررسی کن
  useEffect(() => {
    if (autoChecked.current || !data || !data.control.online || data.check || data.check_error || data.job?.state === "running") return;
    autoChecked.current = true;
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const job = data?.job && data.job.state !== "none" ? data.job : null;
  const finishedHere = startedFrom !== null && job?.state === "ok";
  useEffect(() => {
    if (!finishedHere) return;
    const t = setTimeout(() => window.location.reload(), 4000); // صفحهٔ باز، فایل‌های نسخهٔ قبلی را دارد
    return () => clearTimeout(t);
  }, [finishedHere]);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
  }, [job?.log, showLog]);


  if (!data) return error ? <ErrorState onRetry={() => mutate()} /> : <Skeleton rows={3} />;

  const check = data.check;
  const running = job?.state === "running";
  const restarting = startedFrom !== null && !!error; // پنل خودش در حال راه‌اندازی دوباره است

  const start = async () => {
    setStarting(true);
    try {
      const r = await api<UpdateInfo>("/api/settings/system/update/start", { method: "POST" });
      setStartedFrom(data.version);
      await mutate(r, { revalidate: false });
    } catch (e) {
      flash(errText(e));
    } finally {
      setStarting(false);
      setConfirm(false);
    }
  };

  if (!data.control.online) {
    return (
      <div className={`card ${s.cardPad}`}>
        <div className={s.note} data-tone="warn">
          <Icon d={I.alert} size={18} />
          <span>
            <b>سرویس control روی سرور بالا نیست</b>
            {data.control.error}
          </span>
        </div>
        <div className={s.sub}>این سرویس تازه اضافه شده است. یک بار روی سرور، داخل پوشهٔ پروژه، این دستور را بزنید؛ از آن به بعد همهٔ به‌روزرسانی‌ها از همین صفحه انجام می‌شود:</div>
        <div className={s.cmd}>
          <code>git pull && docker compose up -d --build</code>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`card ${s.cardPad}`}>
        <div className={s.cardHead}>
          <div>
            <b>نسخهٔ پنل</b>
            <small>
              در حال اجرا: <span dir="ltr" className="mono">{data.version}</span>
              {check && <> · آخرین بررسی: {whenText(check.checked_at)}</>}
            </small>
          </div>
          <button className={s.btnGhost} onClick={runCheck} disabled={checking || running}>
            <Icon d={I.refresh} size={15} /> {checking ? "در حال بررسی…" : "بررسی نسخهٔ جدید"}
          </button>
        </div>

        {data.check_error && (
          <div className={s.note} data-tone="danger">
            <Icon d={I.alert} size={18} />
            <span><b>بررسی انجام نشد</b>{data.check_error}</span>
          </div>
        )}

        {check && !check.available && !data.check_error && (
          <div className={s.note} data-tone="ok">
            <Icon d={I.check} size={18} />
            <span><b>پنل به‌روز است</b>نسخهٔ <Ver v={data.version} /> آخرین نسخهٔ شاخهٔ <span dir="ltr" className="mono">{check.branch}</span> است.</span>
          </div>
        )}

        {check?.available && (
          <>
            <div className={s.note} data-tone="info">
              <Icon d={I.cloud} size={18} />
              <span>
                <b>{check.pending_build && check.behind === 0 ? "کد نسخهٔ جدید روی سرور هست ولی هنوز بیلد نشده" : "نسخهٔ جدید آماده است"}{check.remote_version && check.remote_version !== data.version && <> — <Ver v={check.remote_version} /></>}</b>
                {check.behind > 0 ? `${toFa(check.behind)} تغییر جدید در GitHub (شاخهٔ ${check.branch}).` : "با دکمهٔ زیر بیلد و راه‌اندازی می‌شود."}
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
                <summary>{toFa(check.commits.length)} commit جدید</summary>
                {check.commits.map((c) => (
                  <div key={c.sha}>
                    <span dir="ltr" className="mono">{c.sha.slice(0, 7)}</span>
                    <span>{c.subject}</span>
                    <small>{c.author}</small>
                  </div>
                ))}
              </details>
            )}

            {check.dirty && (
              <div className={s.note} data-tone="warn">
                <Icon d={I.alert} size={18} />
                <span><b>روی سرور فایل‌های تغییرکرده‌ای هست</b>اگر با تغییرات تازه تداخل داشته باشند git pull خطا می‌دهد و چیزی عوض نمی‌شود.</span>
              </div>
            )}

            <div className={s.row2}>
              <span className={s.sub}>قبل از شروع، بهتر است یک <Link href="/settings?tab=backup" style={{ color: "var(--accent)" }}>پشتیبان</Link> بگیرید.</span>
              <button className={s.btnPrimary} onClick={() => setConfirm(true)} disabled={running || starting}>
                <Icon d={I.cloud} size={16} /> به‌روزرسانی{check.remote_version && check.remote_version !== data.version && <> به <Ver v={check.remote_version} /></>}
              </button>
            </div>
          </>
        )}
      </div>

      {restarting && (
        <div className={s.note} data-tone="info">
          <span className={s.spin} />
          <span><b>پنل در حال راه‌اندازی دوباره است</b>چند ثانیه قطع می‌شود و خودکار برمی‌گردد؛ صفحه را نبندید.</span>
        </div>
      )}

      {job && (() => {
        const logOpen = showLog ?? job.state === "failed";
        return (
          <div className={`card ${s.cardPad}`}>
            <JobHero job={job} restarting={restarting} logOpen={logOpen} onToggleLog={() => setShowLog(!logOpen)} finishedHere={finishedHere} />
            {finishedHere && (
              <div className={s.note} data-tone="ok">
                <Icon d={I.check} size={18} />
                <span><b>پنل به‌روز شد</b>چند ثانیهٔ دیگر صفحه دوباره بارگذاری می‌شود تا نسخهٔ تازه را ببینید.</span>
              </div>
            )}
            {job.state === "failed" && (
              <div className={s.note} data-tone="danger">
                <Icon d={I.alert} size={18} />
                <span><b>مرحله‌ای خطا داد</b>لاگ زیر علتش را نشان می‌دهد. اگر خطا در بیلد بوده، سرویس‌های فعلی معمولاً همان‌طور که بودند کار می‌کنند. بعد از رفع علت، دوباره «بررسی» و «به‌روزرسانی» را بزنید.</span>
              </div>
            )}
            {logOpen && (
              <div className={s.jobLog} dir="ltr" role="log" aria-label="لاگ به‌روزرسانی">
                <pre>{job.log || "…"}</pre>
                <div ref={logEnd} />
              </div>
            )}
          </div>
        );
      })()}

      <AgentUpdates />

      {confirm && (
        <Modal
          title="به‌روزرسانی پنل"
          onClose={() => setConfirm(false)}
          busy={starting}
          footer={
            <>
              <button className={s.btnGhost} onClick={() => setConfirm(false)} disabled={starting}>انصراف</button>
              <button className={`${s.btnPrimary} primary`} onClick={start} disabled={starting}>{starting ? "در حال شروع…" : "شروع به‌روزرسانی"}</button>
            </>
          }
        >
          <div className={s.note} data-tone="warn">
            <Icon d={I.alert} size={18} />
            <span>
              <b>این کار پنل را چند دقیقه مشغول می‌کند</b>
              ابتدا کد جدید از GitHub گرفته می‌شود، بعد سرویس‌ها دوباره بیلد و راه‌اندازی می‌شوند. موقع جابه‌جایی سرویس‌ها پنل حدود ۱۰ تا ۳۰ ثانیه قطع است و بعد خودش برمی‌گردد. اگر بیلد خطا بدهد، سرویس‌های فعلی معمولاً دست‌نخورده می‌مانند.
            </span>
          </div>
          <div className={s.kv}>
            <div><span>نسخهٔ فعلی</span><span dir="ltr" className="mono">{data.version}</span></div>
            <div><span>نسخهٔ جدید</span><span dir="ltr" className="mono">{check?.remote_version ?? "—"}</span></div>
            <div><span>تغییرات جدید</span><span>{toFa(check?.behind ?? 0)} commit</span></div>
          </div>
        </Modal>
      )}
    </>
  );
}

/** بطری و درصد کار به‌روزرسانی؛ هر ثانیه خودش دوباره رندر می‌شود تا درصد زمان‌محور جلو برود (نه کل صفحه) */
function JobHero({ job, restarting, logOpen, onToggleLog, finishedHere }: { job: UpdateJob; restarting: boolean; logOpen: boolean; onToggleLog: () => void; finishedHere: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (job.state !== "running") return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [job.state]);
  const { pct, stage } = progressOf(job, restarting);
  const tone = job.state === "running" ? "running" : job.state === "ok" ? "ok" : "failed";
  return (
    <div className={s.jobHero} data-state={job.state}>
      <UpdateBottle pct={pct} tone={tone} size={job.state === "running" ? 168 : 112} />
      <div className={s.jobInfo}>
        <span className={s.status}>
          <span className="dot" style={{ background: job.state === "ok" ? "var(--ok)" : job.state === "failed" ? "var(--danger)" : "var(--warn)" }} />
          {job.state === "running" ? "در جریان" : job.state === "ok" ? "موفق" : "ناموفق"}
        </span>
        <b className={s.jobTitle}>{JOB_TEXT[job.state]}</b>
        {job.state === "running" && <span className={s.jobPct}>{toFa(Math.round(pct))}٪</span>}
        <span className={s.jobStage}>{stage}</span>
        <small className={s.sub}>
          {job.started_at && <>شروع: {jStamp(job.started_at)} · </>}
          مدت: {elapsed(job)}
        </small>
        <div className={s.jobActions}>
          <button className={s.btnGhost} onClick={onToggleLog} aria-expanded={logOpen} data-active={logOpen}>
            <Icon d={I.terminal} size={16} /> {logOpen ? "بستن لاگ‌ها" : "مشاهدهٔ لاگ‌ها"}
          </button>
          {finishedHere && (
            <button className={s.btnPrimary} onClick={() => window.location.reload()}>بارگذاری نسخهٔ تازه</button>
          )}
        </div>
      </div>
    </div>
  );
}
