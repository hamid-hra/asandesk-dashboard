"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { api, ApiError } from "@/lib/api";

import s from "./login.module.css";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return setError("نام کاربری و رمز عبور را وارد کنید.");
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: { username, password } });
      const next = params.get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/server");
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "تعداد تلاش‌ها زیاد است؛ یک دقیقه دیگر دوباره امتحان کنید."
          : err instanceof Error
            ? err.message
            : "ورود ناموفق بود.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={s.card} onSubmit={submit}>
      <div className={s.brand}>
        <div className={s.logo}>آ</div>
        <div>
          <div className={s.brandName}>آسان‌دسک</div>
          <div className={s.brandSub}>پنل مالک</div>
        </div>
      </div>
      <div>
        <div className={s.title}>ورود به پنل</div>
        <div className={s.sub}>برای مدیریت سرورها و نسخه‌ها وارد شوید.</div>
      </div>
      <label className={s.field}>
        <span>نام کاربری</span>
        <input dir="ltr" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
      </label>
      <label className={s.field}>
        <span>رمز عبور</span>
        <input dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <div className={s.error}>{error}</div>}
      <button className={s.submit} disabled={busy}>
        {busy ? "در حال ورود…" : "ورود"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className={s.page}>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
