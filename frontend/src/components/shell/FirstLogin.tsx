"use client";

import { useState } from "react";

import s from "@/app/login/login.module.css";
import { PasswordPair } from "@/components/settings/PasswordTools";
import st from "@/components/settings/settings.module.css";
import { errText, fieldErrors } from "@/components/settings/ui";
import { api } from "@/lib/api";

import { Brand, Title } from "./AuthBits";
import { RecoveryCodes } from "./RecoveryCodes";

/**
 * First sign-in with a password someone else chose: the user sets their own, then sees the
 * recovery codes once. Nothing else in the panel works until this is done (the server refuses it too).
 */
export function FirstLogin({ username, displayName, logout, onDone }: { username: string; displayName: string; logout: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [errs, setErrs] = useState<{ current?: string; pw?: string; pw2?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errs = {};
    if (!current) next.current = "رمز موقتی که به شما داده‌اند را وارد کنید.";
    if (pw.length < 8) next.pw = "رمز تازه باید حداقل ۸ نویسه باشد.";
    else if (pw === current) next.pw = "رمز تازه باید با رمز موقت فرق داشته باشد.";
    if (pw !== pw2) next.pw2 = "تکرار رمز با رمز تازه یکسان نیست.";
    setErrs(next);
    setError("");
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      const res = await api<{ codes: string[] }>("/api/auth/password", { method: "POST", body: { current_password: current, new_password: pw, generate_codes: true } });
      setCodes(res.codes);
    } catch (err) {
      const fe = fieldErrors(err);
      if (fe.current_password || fe.new_password) setErrs({ current: fe.current_password, pw: fe.new_password });
      else setError(errText(err, "رمز عوض نشد."));
    } finally {
      setBusy(false);
    }
  };

  const brand = <Brand />;

  if (codes) {
    return (
      <div className={s.page}>
        <div className={s.card} style={{ maxWidth: 460 }}>
          {brand}
          <Title tip="این‌ها «کدهای بازیابی» شما هستند. اگر روزی رمز را فراموش کردید، فقط با یکی از این کدها می‌توانید رمز تازه بگذارید. همین حالا ذخیره‌شان کنید.">رمز شما عوض شد؛ کدهای بازیابی را ذخیره کنید</Title>
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
      <form className={s.card} onSubmit={submit} method="post" style={{ maxWidth: 460 }}>
        {brand}
        <Title tip={`${displayName}، رمزی که برایتان ساخته‌اند موقت است. برای ادامه یک رمز تازه انتخاب کنید؛ بعد از آن کدهای بازیابی‌تان را می‌بینید.`}>رمز عبور خودتان را بگذارید</Title>
        {/* برای اینکه مدیر رمز مرورگر رمز تازه را برای همین نام کاربری ذخیره کند */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <label className={st.field}>
          <span>رمز موقت</span>
          <input className={st.input} name="current-password" dir="ltr" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} autoFocus />
          {errs.current && <span className={st.err}>{errs.current}</span>}
        </label>
        <PasswordPair pw={pw} setPw={setPw} pw2={pw2} setPw2={setPw2} errs={{ pw: errs.pw, pw2: errs.pw2 }} />
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
