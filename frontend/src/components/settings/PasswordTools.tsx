"use client";

import { useState } from "react";

import { Icon } from "@/components/Icon";
import { copyText, randomPassword, strength, STRENGTH } from "@/lib/settings";

import s from "./settings.module.css";
import { I } from "./ui";

/** Four bars and a word («ضعیف» … «قوی») for how strong a password is. */
export function StrengthMeter({ pw }: { pw: string }) {
  const st = strength(pw);
  return (
    <div className={s.meter}>
      <div dir="ltr">
        {[1, 2, 3, 4].map((i) => (
          <i key={i} style={{ background: i <= st ? STRENGTH[st][1] : undefined }} />
        ))}
      </div>
      <span style={{ color: STRENGTH[st][1], fontSize: 12, minWidth: 40 }}>{STRENGTH[st][0]}</span>
    </div>
  );
}

/**
 * The new-password field and its repeat, the same as in the add-user dialog: show/copy buttons, the
 * strength bars and «ساخت رمز تصادفی». Used by the first-login screen and by «حساب من».
 */
export function PasswordPair({ pw, setPw, pw2, setPw2, errs = {}, label = "رمز تازه" }: { pw: string; setPw: (v: string) => void; pw2: string; setPw2: (v: string) => void; errs?: { pw?: string; pw2?: string }; label?: string }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);

  const copy = async () => {
    setCopied((await copyText(pw)) ? "yes" : "no");
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <>
      <div className={s.field}>
        <span>{label}</span>
        <div className={s.pwRow}>
          <input className={s.input} name="new-password" dir="ltr" type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          <button type="button" className={s.btnGhost} style={{ padding: "0 10px" }} onClick={() => setShow(!show)} title="نمایش رمز" aria-label="نمایش رمز" aria-pressed={show}>
            <Icon d={I.eye} size={16} />
          </button>
          <button type="button" className={s.btnGhost} style={{ padding: "0 10px" }} onClick={copy} title="کپی رمز" aria-label="کپی رمز" disabled={!pw}>
            <Icon d={copied === "yes" ? I.check : I.copy} size={16} />
          </button>
        </div>
        {copied && <span className={copied === "yes" ? s.ok : s.err}>{copied === "yes" ? "✓ رمز کپی شد" : "کپی نشد؛ رمز را با دست انتخاب و کپی کنید"}</span>}
        <StrengthMeter pw={pw} />
        <button
          type="button"
          className={s.linkBtn}
          onClick={() => {
            const p = randomPassword();
            setPw(p);
            setPw2(p);
            setShow(true);
          }}
        >
          <Icon d={I.refresh} size={14} /> ساخت رمز تصادفی
        </button>
        {errs.pw && <span className={s.err}>{errs.pw}</span>}
      </div>
      <label className={s.field}>
        <span>تکرار {label}</span>
        <input className={s.input} name="new-password-confirm" dir="ltr" type={show ? "text" : "password"} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        {errs.pw2 && <span className={s.err}>{errs.pw2}</span>}
        {!errs.pw2 && pw2 && pw === pw2 && <span className={s.ok}>✓ رمزها یکسان‌اند</span>}
      </label>
    </>
  );
}
