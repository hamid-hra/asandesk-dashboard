"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import { toFa } from "@/lib/fa";
import { jStamp, type UpdateJob } from "@/lib/settings";

import s from "./settings.module.css";
import { I, Modal } from "./ui";
import { UpdateBottle } from "./UpdateBottle";

/** پنل، کلاینت وب و ایجنت هر کدام کار به‌روزرسانی جدای خودشان را در control دارند (control/control.py) */
export type JobKind = "panel" | "web" | "agent";

// [کف درصد، سقف درصد، متن مرحله، نشانهٔ رسیدن به مرحله در لاگ]
type Step = [number, number, string, RegExp | null];
const REPLACE = /\b(Built|Recreate|Recreated|Creating|Created)\b/;
const START = /\bStart(ing|ed)\b/;

// job_script: [1/2] git pull، [2/2] docker compose up -d --build
const PANEL_STEPS: Step[] = [
  [2, 8, "آماده‌سازی…", null],
  [8, 15, "گرفتن کد جدید از GitHub…", /\[1\/2\]/],
  [15, 72, "ساختن سرویس‌ها (build)…", /\[2\/2\]/],
  [72, 86, "جایگزینی سرویس‌ها با نسخهٔ تازه…", REPLACE],
  [86, 97, "راه‌اندازی دوباره و بررسی سلامت سرویس‌ها…", START],
];
// web_job_script: [1/3] git fetch، [2/3] git pull، [3/3] ساختن web و webgw
const WEB_STEPS: Step[] = [
  [2, 6, "آماده‌سازی…", null],
  [6, 14, "بررسی تغییرات تازه در GitHub…", /\[1\/3\]/],
  [14, 20, "گرفتن کد جدید کلاینت وب…", /\[2\/3\]/],
  [20, 80, "ساختن کلاینت وب و درگاه (build)…", /\[3\/3\]/],
  [80, 90, "جایگزینی سرویس‌های web و webgw…", REPLACE],
  [90, 97, "راه‌اندازی دوباره…", START],
];

const KINDS: Record<JobKind, { steps: Step[]; tau: number; running: string; ok: string; failed: string }> = {
  // به‌روزرسانی پنل معمولاً ۳ تا ۶ دقیقه، کلاینت وب و ایجنت یکی دو دقیقه
  panel: { steps: PANEL_STEPS, tau: 140, running: "در حال به‌روزرسانی پنل…", ok: "پنل به‌روز شد", failed: "به‌روزرسانی پنل ناموفق بود" },
  web: { steps: WEB_STEPS, tau: 60, running: "در حال به‌روزرسانی کلاینت وب…", ok: "کلاینت وب به‌روز شد", failed: "به‌روزرسانی کلاینت وب ناموفق بود" },
  agent: { steps: PANEL_STEPS, tau: 50, running: "در حال به‌روزرسانی ایجنت…", ok: "ایجنت به‌روز شد", failed: "به‌روزرسانی ایجنت ناموفق بود" },
};

export function jobText(kind: JobKind, job: UpdateJob): string {
  const k = KINDS[kind];
  return job.state === "running" ? k.running : job.state === "ok" ? k.ok : k.failed;
}

/**
 * درصد تقریبی پیشرفت. مرحله از روی لاگ معلوم است؛ داخل هر مرحله زمان سپری‌شده جلو می‌برد ولی از سقف
 * همان مرحله رد نمی‌شود. `restarting` یعنی خود پنل در حال راه‌اندازی دوباره است (آخرین مرحله).
 */
export function jobProgress(kind: JobKind, job: UpdateJob, restarting = false): { pct: number; stage: string } {
  if (job.state === "ok") return { pct: 100, stage: "به‌روزرسانی تمام شد" };
  const { steps, tau } = KINDS[kind];
  const log = job.log ?? "";
  let i = 0;
  steps.forEach(([, , , re], n) => {
    if (re && re.test(log)) i = n;
  });
  if (restarting) i = steps.length - 1;
  const [floor, ceil, stage] = steps[i];
  const sec = job.started_at ? Math.max(0, (Date.now() - new Date(job.started_at).getTime()) / 1000) : 0;
  const pct = Math.max(floor, Math.min(ceil, 100 * (1 - Math.exp(-sec / tau))));
  return job.state === "failed" ? { pct: Math.max(pct, 30), stage: "به‌روزرسانی ناموفق بود" } : { pct, stage };
}

function elapsed(job: UpdateJob): string {
  if (!job.started_at) return "";
  const end = job.finished_at && !job.finished_at.startsWith("0001") ? new Date(job.finished_at).getTime() : Date.now();
  const sec = Math.max(0, Math.round((end - new Date(job.started_at).getTime()) / 1000));
  return `${toFa(Math.floor(sec / 60))}:${toFa(String(sec % 60).padStart(2, "0"))}`;
}

/** هر ثانیه دوباره رندر می‌شود تا درصد زمان‌محور جلو برود */
function useTick(active: boolean) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

const tone = (job: UpdateJob) => (job.state === "running" ? "running" : job.state === "ok" ? "ok" : "failed");

/**
 * پنجرهٔ وسط صفحه برای هر به‌روزرسانی: نشان آسان‌دسک که پر می‌شود، درصد و مرحله، و زیرش لاگ زنده.
 * بستنش کار را متوقف نمی‌کند؛ کارت همان بخش وضعیت را نشان می‌دهد و دوباره بازش می‌کند.
 */
export function UpdateProgressDialog({
  kind, title, job, restarting = false, onClose, children, actions,
}: {
  kind: JobKind;
  title: string;
  job: UpdateJob;
  restarting?: boolean;
  onClose: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const running = job.state === "running";
  useTick(running);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job.log]);
  const { pct, stage } = jobProgress(kind, job, restarting);
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={680}
      footer={
        <>
          {running && <span className={s.sub} style={{ marginInlineEnd: "auto" }}>با بستن این پنجره به‌روزرسانی ادامه پیدا می‌کند.</span>}
          {actions}
          <button className={s.btnGhost} onClick={onClose}>{running ? "پنهان کردن" : "بستن"}</button>
        </>
      }
    >
      <div className={s.progHero} data-state={job.state}>
        <UpdateBottle pct={pct} tone={tone(job)} size={running ? 176 : 132} />
        <span className={s.status}>
          <span className="dot" style={{ background: job.state === "ok" ? "var(--ok)" : job.state === "failed" ? "var(--danger)" : "var(--warn)" }} />
          {running ? "در جریان" : job.state === "ok" ? "موفق" : "ناموفق"}
        </span>
        <b className={s.jobTitle}>{jobText(kind, job)}</b>
        {running && <span className={s.jobPct}>{toFa(Math.round(pct))}٪</span>}
        <span className={s.jobStage}>{stage}</span>
        <small className={s.sub}>
          {job.started_at && <>شروع: {jStamp(job.started_at)} · </>}
          مدت: {elapsed(job)}
        </small>
      </div>
      {children}
      <div className={s.jobLog} dir="ltr" role="log" aria-label="لاگ به‌روزرسانی" ref={logRef}>
        <pre>{job.log || "…"}</pre>
      </div>
    </Modal>
  );
}

/** وضعیت کوتاه کار داخل کارت همان بخش، با دکمه‌ای که پنجرهٔ پیشرفت را دوباره باز می‌کند */
export function JobStatusRow({ kind, job, restarting = false, onOpen }: { kind: JobKind; job: UpdateJob; restarting?: boolean; onOpen: () => void }) {
  const running = job.state === "running";
  useTick(running);
  const { pct, stage } = jobProgress(kind, job, restarting);
  return (
    <div className={s.note} data-tone={job.state === "failed" ? "danger" : job.state === "ok" ? "ok" : "info"} style={{ alignItems: "center" }}>
      <UpdateBottle pct={pct} tone={tone(job)} size={36} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{jobText(kind, job)}</b>
        {running ? <>{toFa(Math.round(pct))}٪ · {stage}</> : job.started_at && <>شروع: {jStamp(job.started_at)} · مدت: {elapsed(job)}</>}
      </span>
      <button className={s.btnGhost} onClick={onOpen}>
        <Icon d={I.terminal} size={15} /> {running ? "نمایش پیشرفت" : "جزئیات و لاگ"}
      </button>
    </div>
  );
}
