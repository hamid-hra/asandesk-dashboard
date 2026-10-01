"use client";

import { useRef, useState } from "react";

import { upload } from "@/lib/api";
import { jalaliToday, mbText, toFa } from "@/lib/fa";
import type { Channel, Platform, Release } from "@/lib/types";

import s from "./releases.module.css";

const PLATFORMS: Platform[] = ["Windows", "macOS", "Linux", "Android"];
const VERSION_RE = /^\d+\.\d+\.\d+(-[a-z]+\.?\d*)?$/i;
const EXT: [RegExp, Platform][] = [
  [/\.(exe|msi)$/i, "Windows"],
  [/\.(dmg|pkg)$/i, "macOS"],
  [/\.(deb|rpm|appimage)$/i, "Linux"],
  [/\.apk$/i, "Android"],
];
const platformOf = (name: string) => EXT.find(([re]) => re.test(name))?.[1];

export function ReleaseForm({ existing, onPublished }: { existing: string[]; onPublished: (r: Release) => void }) {
  const [version, setVersion] = useState("");
  const [date, setDate] = useState(jalaliToday);
  const [channel, setChannel] = useState<Channel>("stable");
  const [platforms, setPlatforms] = useState<Platform[]>(["Windows", "macOS", "Linux"]);
  const [rollout, setRollout] = useState(100);
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [mandatory, setMandatory] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reset = () => {
    setVersion("");
    setNotes("");
    setFiles([]);
    setMandatory(false);
    setError("");
    setRollout(100);
    if (fileInput.current) fileInput.current.value = "";
  };

  const pickFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? []);
    setFiles(picked);
    setError("");
    // پلتفرم فایل‌ها خودکار انتخاب می‌شود
    const ps = picked.map((f) => platformOf(f.name)).filter((p): p is Platform => !!p);
    if (ps.length) setPlatforms((cur) => Array.from(new Set([...cur, ...ps])));
  };

  const validate = () => {
    const v = version.trim();
    if (!VERSION_RE.test(v)) return "شماره نسخه معتبر نیست (مثال: 2.5.0 یا 2.5.0-beta.3)";
    if (existing.includes(v)) return "این شماره نسخه قبلاً منتشر شده است.";
    if (!platforms.length) return "حداقل یک پلتفرم انتخاب کنید.";
    if (!notes.split("\n").some((x) => x.trim())) return "توضیحات تغییرات را وارد کنید.";
    for (const f of files) {
      const p = platformOf(f.name);
      if (!p) return `نوع فایل ${f.name} پشتیبانی نمی‌شود.`;
      if (f.size > 500 * 1048576) return `حجم فایل ${f.name} بیشتر از ۵۰۰ مگابایت است.`;
    }
    const ps = files.map((f) => platformOf(f.name));
    if (new Set(ps).size !== ps.length) return "برای هر پلتفرم فقط یک فایل می‌توانید بارگذاری کنید.";
    return "";
  };

  const publish = async () => {
    const err = validate();
    if (err) return setError(err);
    const form = new FormData();
    form.append("version", version.trim());
    form.append("date", date);
    form.append("channel", channel);
    platforms.forEach((p) => form.append("platforms", p));
    form.append("notes", notes);
    form.append("mandatory", String(mandatory));
    form.append("rollout", String(rollout));
    files.forEach((f) => form.append("files", f));
    setProgress(0);
    try {
      const release = await upload<Release>("/api/releases", form, setProgress);
      reset();
      onPublished(release);
    } catch (e) {
      setError(e instanceof Error ? e.message : "انتشار ناموفق بود.");
    } finally {
      setProgress(null);
    }
  };

  const totalSize = files.reduce((a, f) => a + f.size, 0);
  const busy = progress != null;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="card-title">انتشار نسخه جدید</span>
      </div>
      <div className={s.form}>
        <div className={s.two}>
          <label className={s.field}>
            <span className={s.label}>شماره نسخه</span>
            <input
              dir="ltr"
              className={`${s.input} mono`}
              style={{ fontWeight: 500 }}
              value={version}
              placeholder="2.5.0"
              onChange={(e) => {
                setVersion(e.target.value);
                setError("");
              }}
            />
          </label>
          <label className={s.field}>
            <span className={s.label}>تاریخ انتشار</span>
            <input className={s.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <div className={s.field}>
          <span className={s.label}>کانال انتشار</span>
          <div className={s.bigSeg} style={{ gridTemplateColumns: "1fr 1fr" }}>
            {(
              [
                ["stable", "پایدار"],
                ["beta", "بتا"],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={channel === id} onClick={() => setChannel(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={s.field}>
          <span className={s.label}>پلتفرم‌ها</span>
          <div className={s.platforms}>
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPlatforms((cur) => (on ? cur.filter((x) => x !== p) : [...cur, p]));
                    setError("");
                  }}
                >
                  <span className={s.check}>{on ? "✓" : ""}</span>
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div className={s.field}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={s.label} style={{ flex: 1 }}>
              انتشار تدریجی
            </span>
            <span style={{ fontSize: 12, color: "var(--faint)" }}>{rollout === 100 ? "همه کاربران" : `${toFa(rollout)}٪ کاربران در ابتدا`}</span>
          </div>
          <div className={s.bigSeg} style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
            {[10, 25, 50, 100].map((v) => (
              <button key={v} type="button" aria-pressed={rollout === v} onClick={() => setRollout(v)} style={{ height: 32, fontSize: 13 }}>
                {toFa(v)}٪
              </button>
            ))}
          </div>
        </div>

        <label className={s.field}>
          <span className={s.label}>توضیحات تغییرات</span>
          <textarea
            className={s.textarea}
            rows={5}
            placeholder="هر تغییر در یک خط…"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setError("");
            }}
          />
          <span className={s.hint}>هر خط به‌صورت یک مورد در تاریخچه نمایش داده می‌شود.</span>
        </label>

        <label className={s.file} data-has={files.length > 0}>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".exe,.msi,.dmg,.pkg,.deb,.rpm,.AppImage,.apk"
            style={{ display: "none" }}
            onChange={(e) => pickFiles(e.target.files)}
          />
          <div className={s.fileIcon}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
            </svg>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {files.length ? `${files.map((f) => f.name).join("، ")} · ${mbText(totalSize)}` : "بارگذاری فایل نصب"}
            </span>
            <span className={s.hint}>
              {files.length ? "برای تغییر کلیک کنید" : "exe، dmg، deb یا apk · حداکثر ۵۰۰ مگابایت · یک فایل برای هر پلتفرم"}
            </span>
          </div>
        </label>

        <button type="button" className={s.switch} role="switch" aria-checked={mandatory} onClick={() => setMandatory((v) => !v)}>
          <span className={s.track}>
            <span />
          </span>
          <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>به‌روزرسانی اجباری</span>
            <span className={s.hint}>کاربران تا نصب این نسخه نمی‌توانند متصل شوند</span>
          </span>
        </button>

        {error && <div className={s.error}>{error}</div>}

        <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
          <button type="button" className={s.primary} onClick={publish} disabled={busy}>
            {busy && <span className={s.progress} style={{ width: `${progress}%` }} />}
            <span style={{ position: "relative" }}>
              {busy ? (progress! < 100 ? `در حال بارگذاری… ${toFa(progress!)}٪` : "در حال ثبت…") : "انتشار نسخه"}
            </span>
          </button>
          <button type="button" className={s.secondary} onClick={reset} disabled={busy}>
            پاک کردن
          </button>
        </div>
      </div>
    </div>
  );
}
