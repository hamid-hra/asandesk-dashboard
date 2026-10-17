"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";

import { Icon } from "@/components/Icon";
import { Logo } from "@/components/Logo";
import { Tip } from "@/components/Tip";
import { fetcher } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { dfToday, pctText, toFa } from "@/lib/fa";
import { canSee, levelOf, TABS, tabFor } from "@/lib/nav";
import type { RecoveryStatus, Status } from "@/lib/types";

import { GlobalSearch } from "./GlobalSearch";
import { NoticeBell, NoticePopup } from "./Notices";
import { RECOVERY_KEY } from "./RecoveryDialog";
import { ThemeToggle } from "./ThemeToggle";
import { VersionBadge } from "./VersionBadge";
import s from "./Shell.module.css";

const ROLE_EN = { owner: "Owner", admin: "Admin", viewer: "Viewer", custom: "Custom" } as const;

/** منوی کناری جمع‌شده (فقط آیکون‌ها) در همین مرورگر یادآوری می‌شود */
const COLLAPSE_KEY = "ad_nav_collapsed";

function NavItem({ tab, active, onClick, badge, collapsed }: { tab: (typeof TABS)[number]; active: boolean; onClick: () => void; badge?: number; collapsed: boolean }) {
  const tip = badge ? `${tab.label} — ${toFa(badge)} مورد جدید` : tab.label;
  return (
    <Tip content={tip} side="left" disabled={!collapsed} block>
      <Link href={tab.href} className={s.navItem} aria-current={active ? "page" : undefined} onClick={onClick} aria-label={collapsed ? tip : undefined}>
        <Icon d={tab.icon} />
        <span className={s.navLabel}>{tab.label}</span>
        {tab.soon && <span className={s.soonBadge}>به‌زودی</span>}
        {!!badge && <span className={s.countBadge} title={`${toFa(badge)} مورد جدید`}>{toFa(badge)}</span>}
      </Link>
    </Tip>
  );
}

function statusOf(data: Status | undefined) {
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
  return { tone, label: data ? label : "در حال بررسی…" };
}

/** وضعیت سرویس‌ها پایین سایدبار؛ در حالت جمع‌شده فقط یک نقطه که با بردن نشانگر جزئیات را نشان می‌دهد */
function StatusBox({ data, collapsed }: { data: Status | undefined; collapsed: boolean }) {
  const { tone, label } = statusOf(data);
  const uptime = data?.uptime_30d;
  const sub = `آپتایم ۳۰ روز: ${uptime == null ? "—" : pctText(uptime, 2)}`;
  const details = (
    <div className={s.statusPop} data-tone={tone}>
      <div className={s.statusPopHead}>
        <span className={s.statusDot} />
        <b>{label}</b>
      </div>
      <dl>
        <div><dt>سرورهای آنلاین</dt><dd>{data ? `${toFa(data.online)} از ${toFa(data.total)}` : "—"}</dd></div>
        <div><dt>آپتایم ۳۰ روز</dt><dd>{uptime == null ? "—" : pctText(uptime, 2)}</dd></div>
        <div><dt>هشدارهای تأییدنشده</dt><dd>{data ? toFa(data.unacked) : "—"}</dd></div>
      </dl>
      <Link href="/server" className={s.statusPopLink}>مشاهدهٔ سرور و منابع ←</Link>
    </div>
  );
  return (
    <Tip content={details} side="left" disabled={!collapsed} interactive block className={s.statusTip}>
      <Link href="/server" className={s.status} data-tone={tone} aria-label={`${label} — ${sub}`}>
        <div className={s.statusLabel}>
          <span className={s.statusDot} />
          <span className={s.statusText}>{label}</span>
        </div>
        <div className={s.statusSub}>{sub}</div>
      </Link>
    </Tip>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: recovery } = useSWR<RecoveryStatus>(RECOVERY_KEY, fetcher);
  const noCodes = recovery?.remaining === 0;
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
      <button className={s.user} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" title={noCodes ? "کد بازیابی ندارید؛ از تنظیمات ← حساب من بسازید" : undefined}>
        <div className={s.avatar}>
          {user.display_name.trim().charAt(0).toUpperCase() || "م"}
          {noCodes && <span className={s.avatarDot} />}
        </div>
        <div className={s.userText}>
          <div className={s.userName}>{user.display_name}</div>
          <div className={s.userRole}>{ROLE_EN[user.role]}</div>
        </div>
      </button>
      {open && (
        <div className={s.menu} role="menu">
          <div className={s.menuHead}>
            <b>{user.display_name}</b>
            <span dir="ltr">{user.email || user.username}</span>
          </div>
          <Link href="/settings?tab=account" className={s.menuItem} role="menuitem" onClick={() => setOpen(false)}>
            حساب من
            {noCodes && <span className={s.menuDot} />}
          </Link>
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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1");
      } catch {
        // حافظهٔ مرورگر بسته است؛ فقط برای همین بازدید جمع می‌شود
      }
      return !v;
    });
  const { user } = useAuth();
  const seesServer = levelOf(user.perms, "server") !== "none";
  const { data: status } = useSWR<Status>(seesServer ? "/api/monitoring/status" : null, fetcher, { refreshInterval: 30000 });
  const visible = TABS.filter((t) => canSee(t, user.perms));
  const allowed = !tab || canSee(tab, user.perms);
  // صفحهٔ اصلی = اولین بخشی که کاربر می‌بیند (برای مالک «سرور و منابع»)
  const home = visible.find((t) => !t.soon)?.href ?? "/settings";
  // Shell فقط سمت کلاینت (بعد از احراز هویت) رندر می‌شود
  const today = dfToday.format(new Date());

  const close = () => setNavOpen(false);
  const toggleLabel = collapsed ? "باز کردن منو" : "جمع کردن منو";

  return (
    <div className={s.root}>
      <div className={s.asideWrap} data-collapsed={collapsed}>
        <aside className={s.aside} data-open={navOpen} data-collapsed={collapsed}>
          <Tip content="صفحهٔ اصلی داشبورد" side="left" disabled={!collapsed} block>
            <Link href={home} className={s.brand} onClick={close} aria-label="آسان‌دسک — صفحهٔ اصلی">
              <Logo size={36} />
              <span className={s.brandName}>آسان‌دسک</span>
            </Link>
          </Tip>
          <div className={s.section}><span className={s.sectionText}>مدیریت</span></div>
          <nav className={s.nav}>
            {visible.filter((t) => !t.soon).map((t) => (
              <NavItem key={t.href} tab={t} active={t === tab} onClick={close} badge={t.href === "/tickets" ? status?.open_tickets : 0} collapsed={collapsed} />
            ))}
          </nav>
          {visible.some((t) => t.soon) && (
            <>
              <div className={s.section} style={{ padding: "18px 10px 6px", display: "flex", alignItems: "center", gap: 6 }}>
                <span className={s.sectionText} style={{ whiteSpace: "nowrap" }}>فاز ۳</span>
                <span className={s.rule} />
              </div>
              <nav className={s.nav}>
                {visible.filter((t) => t.soon).map((t) => (
                  <NavItem key={t.href} tab={t} active={t === tab} onClick={close} collapsed={collapsed} />
                ))}
              </nav>
            </>
          )}
          <div className={s.asideFoot}>
            {seesServer && <StatusBox data={status} collapsed={collapsed} />}
            <VersionBadge collapsed={collapsed} />
          </div>
        </aside>
        {/* دستهٔ باز و بسته کردن روی لبهٔ داخلی سایدبار؛ فلش به سمتی است که لبه حرکت می‌کند */}
        <Tip content={toggleLabel} side="left" className={s.collapseTip}>
          <button className={s.collapseBtn} onClick={toggleCollapsed} aria-label={toggleLabel} aria-expanded={!collapsed}>
            <Icon d={collapsed ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} size={14} stroke={2.2} />
          </button>
        </Tip>
      </div>
      {navOpen && <div className={s.backdrop} onClick={close} />}

      <main className={s.main}>
        <header className={s.header}>
          <button className={s.menuBtn} onClick={() => setNavOpen(true)} aria-label="منو">
            <Icon d="M4 7h16M4 12h16M4 17h16" />
          </button>
          <div className={s.today}>{today}</div>
          <div style={{ flex: 1 }} />
          <GlobalSearch />
          <ThemeToggle />
          <NoticeBell alerts={seesServer ? status?.unacked ?? 0 : 0} />
          <UserMenu />
        </header>
        <div className={s.content} key={pathname}>
          {allowed ? (
            children
          ) : (
            <div className="card empty">دسترسی شما به این بخش بسته است. برای دریافت دسترسی با مالک پنل تماس بگیرید.</div>
          )}
        </div>
      </main>
      <NoticePopup />
    </div>
  );
}
