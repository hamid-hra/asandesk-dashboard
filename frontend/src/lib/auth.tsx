"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import useSWR from "swr";

import { AsanLoader } from "@/components/AsanLoader";

import { api, fetcher } from "./api";
import type { User } from "./types";

/** کلید sessionStorage و مدت نمایش لوگوی ورود (یک چرخهٔ کامل انیمیشن) */
export const INTRO_KEY = "ad_intro";
export const INTRO_MS = 2400;

interface AuthValue {
  user: User;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

/** محافظ مسیرهای داشبورد: بدون نشست معتبر به /login هدایت می‌کند */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: user, error, mutate } = useSWR<User>("/api/auth/me", fetcher, {
    shouldRetryOnError: false,
    revalidateOnFocus: true,
  });
  // اولین بازشدن پنل در هر نشست مرورگر: لوگوی متحرک حداقل یک چرخه دیده شود (بعد از ورود دوباره تکرار نمی‌شود)
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    const seen = sessionStorage.getItem(INTRO_KEY) === "1";
    const t = setTimeout(() => {
      sessionStorage.setItem(INTRO_KEY, "1");
      setIntroDone(true);
    }, seen ? 0 : INTRO_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (error) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [error, router, pathname]);

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } finally {
      await mutate(undefined, { revalidate: false });
      router.replace("/login");
    }
  }, [mutate, router]);

  if (!user || !introDone) return <AsanLoader full label="در حال اتصال" />;
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}
