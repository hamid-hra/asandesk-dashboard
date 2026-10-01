"use client";

import { useState } from "react";

import s from "./Shell.module.css";

type Theme = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  const apply = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `theme=${t}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className={s.themeToggle} role="group" aria-label="تم">
      <button aria-pressed={theme === "light"} title="تم روشن" onClick={() => apply("light")}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        لایت
      </button>
      <button aria-pressed={theme === "dark"} title="تم تیره" onClick={() => apply("dark")}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />
        </svg>
        دارک
      </button>
    </div>
  );
}
