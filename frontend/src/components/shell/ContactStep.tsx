"use client";

import { useState } from "react";
import { mutate } from "swr";

import s from "@/app/login/login.module.css";
import { fieldErrors, errText } from "@/components/settings/ui";
import { api } from "@/lib/api";
import { contactErrors, normalizePhone } from "@/lib/contact";
import type { User } from "@/lib/types";

import { Brand, Label, Title } from "./AuthBits";

/**
 * ورود کاربری که موبایل یا ایمیل ندارد (مالک حساب را بدون آن‌ها ساخته): تا هر دو را وارد نکند پنل باز نمی‌شود.
 * قالب هر دو و تکراری‌نبودنشان را سرور هم بررسی می‌کند.
 */
export function ContactStep({ user, logout, onDone }: { user: User; logout: () => void; onDone: () => void }) {
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [errs, setErrs] = useState<{ email?: string; phone?: string }>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = contactErrors(email, phone, true);
    setErrs(next);
    setError("");
    if (next.email || next.phone) return;
    setBusy(true);
    try {
      const me = await api<User>("/api/auth/profile", { method: "PATCH", body: { email: email.trim(), phone: normalizePhone(phone) } });
      await mutate("/api/auth/me", me, { revalidate: false });
      onDone();
    } catch (err) {
      const fe = fieldErrors(err);
      if (fe.email || fe.phone) setErrs({ email: fe.email, phone: fe.phone });
      else setError(errText(err, "ذخیره نشد."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <form className={s.card} onSubmit={submit} method="post" style={{ maxWidth: 440 }} noValidate>
        <Brand />
        <Title tip={`${user.display_name}، برای ادامه شمارهٔ موبایل و ایمیل خودتان را وارد کنید. مالک پنل برای پیگیری و اطلاع‌رسانی از آن‌ها استفاده می‌کند.`}>اطلاعات تماس</Title>
        <label className={s.field}>
          <Label tip="موبایل ایران (۰۹…) یا شمارهٔ خارجی با + و کد کشور">شمارهٔ موبایل</Label>
          <input
            name="tel"
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            placeholder="0912 345 6789"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone.trim() && setPhone(normalizePhone(phone))}
            aria-invalid={!!errs.phone}
            autoFocus
          />
          {errs.phone && <small className={s.fieldErr}>{errs.phone}</small>}
        </label>
        <label className={s.field}>
          <Label>ایمیل</Label>
          <input name="email" type="email" dir="ltr" inputMode="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errs.email} />
          {errs.email && <small className={s.fieldErr}>{errs.email}</small>}
        </label>
        {error && <div className={s.error}>{error}</div>}
        <button className={s.submit} disabled={busy}>
          {busy ? "در حال ذخیره…" : "ذخیره و ورود به پنل"}
        </button>
        <button type="button" className={s.link} onClick={logout}>
          خروج
        </button>
      </form>
    </div>
  );
}
