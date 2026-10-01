"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dfToday, pctText, toFa } from "@/lib/fa";
import { TABS, tabFor } from "@/lib/nav";
import type { Status } from "@/lib/types";

import { ThemeToggle } from "./ThemeToggle";
import s from "./Shell.module.css";

const ROLE_EN = { owner: "Owner", admin: "Admin", viewer: "Viewer" } as const;

function NavItem({ tab, active, onClick }: { tab: (typeof TABS)[number]; active: boolean; onClick: () => void }) {
  return (
    <Link href={tab.href} className={s.navItem} aria-current={active ? "page" : undefined} onClick={onClick}>
      <Icon d={tab.icon} />
      <span style={{ flex: 1 }}>{tab.label}</span>
      {tab.soon && <span className={s.soonBadge}>به‌زودی</span>}
    </Link>
  );
}

function StatusBox() {
  const { data } = useSWR<Status>("/api/monitoring/status", fetcher, { refreshInterval: 30000 });
  let tone: "ok" | "bad" = "ok";
  let label = "همه سرویس‌ها عملیاتی";
  if (data) {
    if (data.total === 0) label = "هنوز سروری گزارش نداده";
    else if (data.online < data.total) {
      tone = "bad";
      label = `${toFa(data.total - data.online)} سرور قطع است`;
    } else if (data.open_crit > 0) {
      tone = "bad";
      label = "هشدار بحرانی فعال";
    }
  }
  const uptime = data?.uptime_30d;
  return (
    <div className={s.status} data-tone={tone}>
      <div className={s.statusLabel}>
        <span className={s.statusDot} />
        {data ? label : "در حال بررسی…"}
      </div>
      <div className={s.statusSub}>آپتایم ۳۰ روز: {uptime == null ? "—" : pctText(uptime, 2)}</div>
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div className={s.userWrap} ref={ref}>
      <button className={s.user} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        <div className={s.avatar}>{user.display_name.trim().charAt(0).toUpperCase() || "م"}</div>
        <div className={s.userText}>
          <div className={s.userName}>{user.display_name}</div>
          <div className={s.userRole}>{ROLE_EN[user.role]}</div>
        </div>
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <div className={s.menuHead}>نقش: {user.role_label}</div>
          {user.role === "owner" && (
            <a className={s.menuItem} href="/admin/accounts/user/" target="_blank" rel="noreferrer" role="menuitem">
              مدیریت کاربران و نقش‌ها
            </a>
          )}
          <button className={s.menuItem} onClick={logout} role="menuitem">
            خروج
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const tab = tabFor(pathname);
  const [navOpen, setNavOpen] = useState(false);
  const { data: status } = useSWR<Status>("/api/monitoring/status", fetcher, { refreshInterval: 30000 });
  // Shell فقط سمت کلاینت (بعد از احراز هویت) رندر می‌شود
  const today = dfToday.format(new Date());

  const pageTitle = tab?.soon ? tab.label : "داشبورد مالک";
  const close = () => setNavOpen(false);

  return (
    <div className={s.root}>
      <aside className={s.aside} data-open={navOpen}>
        <div className={s.brand}>
          <div className={s.logo}>آ</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div className={s.brandName}>آسان‌دسک</div>
            <div className={s.brandSub}>پنل مالک</div>
          </div>
        </div>
        <div className={s.section}>مدیریت</div>
        <nav className={s.nav}>
          {TABS.filter((t) => !t.soon).map((t) => (
            <NavItem key={t.href} tab={t} active={t === tab} onClick={close} />
          ))}
        </nav>
        <div className={s.section} style={{ padding: "18px 10px 6px", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ whiteSpace: "nowrap" }}>فاز ۳</span>
          <span className={s.rule} />
        </div>
        <nav className={s.nav}>
          {TABS.filter((t) => t.soon).map((t) => (
            <NavItem key={t.href} tab={t} active={t === tab} onClick={close} />
          ))}
        </nav>
        <StatusBox />
      </aside>
      {navOpen && <div className={s.backdrop} onClick={close} />}

      <main className={s.main}>
        <header className={s.header}>
          <button className={s.menuBtn} onClick={() => setNavOpen(true)} aria-label="منو">
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
          <div className={s.pageTitle}>{pageTitle}</div>
          <div className={s.today}>{today}</div>
          <div style={{ flex: 1 }} />
          <div className={s.search} title="به‌زودی">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            جستجو…
          </div>
          <ThemeToggle />
          <Link href="/server#alerts" className={s.bell} aria-label="هشدارها">
            <Icon d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
            {!!status?.unacked && <span className={s.bellDot} />}
          </Link>
          <UserMenu />
        </header>
        <div className={s.content}>{children}</div>
      </main>
    </div>
  );
}
