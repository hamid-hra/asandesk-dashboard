"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect } from "react";
import useSWR from "swr";

import { api, fetcher } from "./api";
import type { User } from "./types";

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

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--faint)", fontSize: 14 }}>
        در حال بارگذاری…
      </div>
    );
  }
  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}
