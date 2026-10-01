export const ICONS = {
  server: "M4 4h16v7H4zM4 13h16v7H4zM8 7.5h.01M8 16.5h.01M12 7.5h4M12 16.5h4",
  release: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5",
  clients:
    "M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 20v-1a4 4 0 00-3-3.87M16 4.13a3.5 3.5 0 010 6.75",
  ads: "M3 11v2a1 1 0 001 1h2l5 4V6L6 10H4a1 1 0 00-1 1zM15 8.5a5 5 0 010 7M18 6a8.5 8.5 0 010 12",
  announce: "M4 5h16v11H8l-4 4zM8 9h8M8 12h5",
  ticket:
    "M4 7a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4zM14 5v2M14 11v2M14 17v2",
  settings:
    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z",
};

export interface Tab {
  href: string;
  label: string;
  icon: string;
  soon?: string;
}

export const TABS: Tab[] = [
  { href: "/server", label: "سرور و منابع", icon: ICONS.server },
  { href: "/releases", label: "نسخه‌ها", icon: ICONS.release },
  { href: "/clients", label: "کلاینت‌ها", icon: ICONS.clients },
  { href: "/tickets", label: "تیکت‌ها", icon: ICONS.ticket },
  {
    href: "/ads",
    label: "تبلیغات",
    icon: ICONS.ads,
    soon: "تعریف کمپین و بنر برای نمایش در صفحه اصلی اپلیکیشن، زمان‌بندی و گزارش کلیک.",
  },
  {
    href: "/announcements",
    label: "اطلاعیه‌ها",
    icon: ICONS.announce,
    soon: "ارسال پیام و اطلاعیه به همه کاربران یا گروه‌های مشخص، درون اپ و از طریق اعلان.",
  },
  {
    href: "/settings",
    label: "تنظیمات",
    icon: ICONS.settings,
    soon: "پیکربندی سرورها، محدودیت‌ها، کلیدهای API و دسترسی اعضای تیم مدیریت.",
  },
];

export const tabFor = (pathname: string) => TABS.find((t) => pathname.startsWith(t.href));
