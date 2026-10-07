"use client";

import { useState } from "react";
import useSWR from "swr";

import { api, ApiError, fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { Release } from "@/lib/types";

import s from "./releases.module.css";

function Switch({ on, onToggle, title, hint, disabled }: { on: boolean; onToggle: () => void; title: string; hint: string; disabled?: boolean }) {
  return (
    <button type="button" className={s.switch} role="switch" aria-checked={on} disabled={disabled} onClick={onToggle}>
      <span className={s.track}>
        <span />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--text)" }}>{title}</span>
        <span className={s.hint}>{hint}</span>
      </span>
    </button>
  );
}

/** ویرایش فیلدهای یک نسخه که در update.json می‌آیند، پیش‌نمایش و دانلود فایل */
function Editor({ release, onSaved }: { release: Release; onSaved: () => void }) {
  const { user } = useAuth();
  const flash = useToast();
  const [build, setBuild] = useState(String(release.build || ""));
  const [message, setMessage] = useState(release.message);
  const [mandatory, setMandatory] = useState(release.mandatory);
  const [maintenance, setMaintenance] = useState(release.maintenance);
  const [enabled, setEnabled] = useState(release.enabled);
  const [baleUrl, setBaleUrl] = useState(release.bale_url);
  const [baleId, setBaleId] = useState(release.bale_id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const url = `/api/releases/${encodeURIComponent(release.version)}/update.json`;
  const { data: preview, mutate } = useSWR<unknown>(url, fetcher);
  const text = preview ? JSON.stringify(preview, null, 2) : "";

  const save = async () => {
    if (build.trim() && !/^\d{1,9}$/.test(build.trim())) return setError("شماره بیلد باید عدد باشد.");
    setBusy(true);
    setError("");
    try {
      await api<Release>(`/api/releases/${encodeURIComponent(release.version)}`, {
        method: "PATCH",
        body: { build: Number(build.trim() || 0), message: message.trim(), mandatory, maintenance, enabled, bale_url: baleUrl.trim(), bale_id: baleId.trim() },
      });
      await mutate();
      onSaved();
      flash("تغییرها ذخیره شد");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "ذخیره نشد.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash("متن update.json کپی شد");
    } catch {
      flash("کپی نشد");
    }
  };

  const canEdit = user.can_manage;
  return (
    <div className={s.form}>
      <div className={s.two}>
        <label className={s.field}>
          <span className={s.label}>شماره بیلد</span>
          <input dir="ltr" inputMode="numeric" className={`${s.input} mono`} value={build} disabled={!canEdit} onChange={(e) => setBuild(e.target.value)} />
        </label>
        <label className={s.field}>
          <span className={s.label}>پیام به کاربران</span>
          <input className={s.input} value={message} maxLength={500} disabled={!canEdit} placeholder="خالی یعنی بدون پیام" onChange={(e) => setMessage(e.target.value)} />
        </label>
      </div>
      <div className={s.two}>
        <label className={s.field}>
          <span className={s.label}>لینک کانال بله</span>
          <input dir="ltr" className={`${s.input} mono`} value={baleUrl} maxLength={200} disabled={!canEdit} placeholder="https://ble.ir/join/…" onChange={(e) => setBaleUrl(e.target.value)} />
          <span className={s.hint}>در ارتباط با ما نمایش داده می‌شود و فقط روی ble.ir پذیرفته می‌شود</span>
        </label>
        <label className={s.field}>
          <span className={s.label}>آیدی بله</span>
          <input dir="ltr" className={`${s.input} mono`} value={baleId} maxLength={64} disabled={!canEdit} placeholder="اختیاری" onChange={(e) => setBaleId(e.target.value)} />
        </label>
      </div>
      <Switch on={mandatory} disabled={!canEdit} onToggle={() => setMandatory((v) => !v)} title="به‌روزرسانی اجباری" hint="در فایل force_update می‌شود و دکمهٔ اپلیکیشن قرمز می‌شود" />
      <Switch on={maintenance} disabled={!canEdit} onToggle={() => setMaintenance((v) => !v)} title="حالت تعمیر" hint="چیپ نارنجی سرویس در حال تعمیر است در اپلیکیشن" />
      <Switch on={enabled} disabled={!canEdit} onToggle={() => setEnabled((v) => !v)} title="فعال" hint="اگر خاموش باشد اپلیکیشن هیچ اعلانی از این فایل نشان نمی‌دهد" />

      {release.update_warnings.length > 0 && (
        <div className={s.error} style={{ lineHeight: 1.9 }}>
          {release.update_warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      {error && <div className={s.error}>{error}</div>}

      <pre
        dir="ltr"
        className="mono"
        style={{ margin: 0, padding: 14, borderRadius: 10, background: "var(--subtle)", fontSize: 12, lineHeight: 1.7, overflow: "auto", maxHeight: 340, textAlign: "left", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
      >
        {text || "در حال ساخت…"}
      </pre>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a className={s.primary} style={{ width: "auto", padding: "0 22px", display: "inline-flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }} href={url} download="update.json">
          دانلود update.json
        </a>
        <button type="button" className={s.secondary} onClick={copy} disabled={!text}>
          کپی متن
        </button>
        {canEdit && (
          <button type="button" className={s.secondary} onClick={save} disabled={busy}>
            {busy ? "در حال ذخیره…" : "ذخیره تغییرها"}
          </button>
        )}
      </div>
      <span className={s.hint}>
        فایل را روی CDN بگذارید، آدرس update.asandesk.ir/update.json. اول فایل‌های نصب را بالا بگذارید و آخر update.json را.
      </span>
    </div>
  );
}

export function UpdateJsonCard({ releases, onSaved }: { releases: Release[] | undefined; onSaved: () => void }) {
  const [picked, setPicked] = useState("");
  const list = releases ?? [];
  const version = list.some((r) => r.version === picked) ? picked : (list[0]?.version ?? "");
  const release = list.find((r) => r.version === version);

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card-head">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8zM14 3v5h5M9 13h6M9 17h6" />
        </svg>
        <span className="card-title" style={{ flex: 1 }}>
          فایل update.json
        </span>
        {list.length > 0 && (
          <select dir="ltr" className={`${s.input} mono`} style={{ width: "auto", height: 34 }} value={version} onChange={(e) => setPicked(e.target.value)}>
            {list.map((r) => (
              <option key={r.id} value={r.version}>
                {r.version}
              </option>
            ))}
          </select>
        )}
      </div>
      {release ? <Editor key={release.version} release={release} onSaved={onSaved} /> : <div className="empty">اول یک نسخه منتشر کنید تا فایلش ساخته شود.</div>}
    </div>
  );
}
