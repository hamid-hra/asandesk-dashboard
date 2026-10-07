// قالب‌بندی مشترک تب‌های «کلاینت‌ها» و «بازخوردها»
import { dfDay, toFa } from "./fa";
import type { Priority, TicketStatus } from "./types";

/** «482913557» → «482 913 557» (شناسه‌های عددی RustDesk) */
export const formatId = (id: string) => (/^\d{7,}$/.test(id) ? id.replace(/\B(?=(\d{3})+$)/g, " ") : id);

const AVATARS: [string, string][] = [
  ["var(--accent-soft)", "var(--accent-strong)"],
  ["var(--info-soft)", "var(--info-text)"],
  ["var(--warn-soft)", "var(--warn-text)"],
  ["var(--beta-soft)", "var(--beta-text)"],
  ["var(--danger-soft)", "var(--danger-strong)"],
];

export function avatarOf(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

export const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || "؟";

/** «هم‌اکنون»، «۴۰ دقیقه پیش»، «۲ ساعت پیش»، «دیروز»، «۱۲ روز پیش» */
export function agoText(iso: string | null): string {
  if (!iso) return "هرگز";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 2) return "هم‌اکنون";
  if (min < 60) return `${toFa(min)} دقیقه پیش`;
  if (min < 24 * 60) return `${toFa(Math.round(min / 60))} ساعت پیش`;
  const days = Math.round(min / 1440);
  return days === 1 ? "دیروز" : `${toFa(days)} روز پیش`;
}

/** «۴۵ دقیقه» یا «۳٫۲ ساعت» */
export const minutesText = (m: number) => (m < 60 ? `${toFa(Math.round(m))} دقیقه` : `${toFa((m / 60).toFixed(1))} ساعت`);

/** «۱ ساعت و ۵ دقیقه» */
export function durationText(m: number) {
  if (m < 60) return `${toFa(Math.round(m))} دقیقه`;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return `${toFa(h)} ساعت${r ? ` و ${toFa(r)} دقیقه` : ""}`;
}

const pad = (n: number) => toFa(String(n).padStart(2, "0"));

/** «امروز ۱۰:۲۴»، «دیروز ۱۸:۳۰»، «۷ مهر» */
export function whenText(iso: string, withTime = true): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86400000);
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 0) return withTime ? `امروز ${time}` : "امروز";
  if (diff === 1) return withTime ? `دیروز ${time}` : "دیروز";
  return dfDay.format(d) + (withTime ? ` ${time}` : "");
}

export const timeOnly = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const PRIORITY: Record<Priority, [string, string, string]> = {
  urgent: ["فوری", "var(--danger-soft)", "var(--danger-strong)"],
  high: ["بالا", "var(--warn-soft)", "var(--warn-text)"],
  normal: ["عادی", "var(--info-soft)", "var(--info-text)"],
  low: ["کم", "var(--subtle)", "var(--muted)"],
};

// بازخوردهای اپلیکیشن هم‌ساختار تیکت‌اند؛ فقط نام‌ها «بازخورد» است
export const TICKET_STATUS: Record<TicketStatus, [string, string]> = {
  open: ["جدید", "var(--danger)"],
  pending: ["پاسخ داده شد", "var(--warn)"],
  closed: ["بسته", "var(--older)"],
};

/** دستهٔ بازخورد اپلیکیشن (bug|idea|other)؛ تیکت‌های قدیمی دسته‌شان متن آزاد است */
export const FEEDBACK_CATEGORY: Record<string, string> = { bug: "مشکل", idea: "پیشنهاد", other: "سایر" };
export const categoryText = (c: string) => FEEDBACK_CATEGORY[c] ?? c;

/** «۱۲۰ کیلوبایت»، «۲٫۱ مگابایت» */
export function bytesText(n: number): string {
  if (n < 1024) return `${toFa(n)} بایت`;
  if (n < 1024 * 1024) return `${toFa(Math.round(n / 1024))} کیلوبایت`;
  return `${toFa((n / 1024 / 1024).toFixed(1))} مگابایت`;
}
