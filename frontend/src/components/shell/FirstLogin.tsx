"use client";

import { useState } from "react";

import s from "@/app/login/login.module.css";
import { Logo } from "@/components/Logo";
import { errText, fieldErrors } from "@/components/settings/ui";
import { api } from "@/lib/api";
import { strength, STRENGTH } from "@/lib/settings";

import { RecoveryCodes } from "./RecoveryCodes";

/**
 * First sign-in with a password someone else chose: the user sets their own, then sees the
 * recovery codes once. Nothing else in the panel works until this is done (the server refuses it too).
 */
export function FirstLogin({ username, displayName, logout, onDone }: { username: string; displayName: string; logout: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const st = strength(pw);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!current) return setError("رمز موقتی که به شما داده‌اند را وارد کنید.");
    if (pw.length < 8) return setError("رمز تازه باید حداقل ۸ نویسه باشد.");
    if (pw === current) return setError("رمز تازه باید با رمز موقت فرق داشته باشد.");
    if (pw !== pw2) return setError("تکرار رمز با رمز تازه یکسان نیست.");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ codes: string[] }>("/api/auth/password", { method: "POST", body: { current_password: current, new_password: pw, generate_codes: true } });
      setCodes(res.codes);
    } catch (err) {
      const fe = fieldErrors(err);
      setError(fe.current_password || fe.new_password || errText(err, "رمز عوض نشد."));
    } finally {
      setBusy(false);
    }
  };

  const brand = (
    <div className={s.brand}>
      <Logo size={40} />
      <div>
        <div className={s.brandName}>آسان‌دسک</div>
        <div className={s.brandSub}>پنل مالک</div>
      </div>
    </div>
  );

  if (codes) {
    return (
      <div className={s.page}>
        <div className={s.card} style={{ maxWidth: 460 }}>
          {brand}
          <div>
            <div className={s.title}>رمز شما عوض شد</div>
            <div className={s.sub}>این‌ها «کدهای بازیابی» شما هستند. اگر روزی رمز را فراموش کردید، فقط با یکی از این کدها می‌توانید رمز تازه بگذارید. همین حالا ذخیره‌شان کنید.</div>
          </div>
          <RecoveryCodes codes={codes} username={username} />
          <label className={s.remember}>
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>کدها را ذخیره کردم</span>
          </label>
          <button className={s.submit} disabled={!saved} onClick={onDone} style={saved ? undefined : { opacity: 0.5, cursor: "not-allowed" }}>
            ورود به پنل
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <form className={s.card} onSubmit={submit} method="post" style={{ maxWidth: 440 }}>
        {brand}
        <div>
          <div className={s.title}>رمز عبور خودتان را بگذارید</div>
          <div className={s.sub}>{displayName}، رمزی که برایتان ساخته‌اند موقت است. برای ادامه یک رمز تازه انتخاب کنید؛ بعد از آن کدهای بازیابی‌تان را می‌بینید.</div>
        </div>
        {/* برای اینکه مدیر رمز مرورگر رمز تازه را برای همین نام کاربری ذخیره کند */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <label className={s.field}>
          <span>رمز موقت</span>
          <input name="current-password" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
        </label>
        <label className={s.field}>
          <span>رمز تازه</span>
          <input name="new-password" dir="ltr" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          {pw && <small style={{ color: STRENGTH[st][1], fontSize: 12 }}>قدرت رمز: {STRENGTH[st][0]}</small>}
        </label>
        <label className={s.field}>
          <span>تکرار رمز تازه</span>
          <input name="new-password-confirm" dir="ltr" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {error && <div className={s.error}>{error}</div>}
        <button className={s.submit} disabled={busy}>
          {busy ? "در حال ذخیره…" : "ذخیرهٔ رمز تازه"}
        </button>
        <button type="button" className={s.link} onClick={logout}>
          خروج
        </button>
      </form>
    </div>
  );
}
