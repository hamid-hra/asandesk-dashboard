/** ترتیب جدول کلاینت‌ها؛ هر ستون با کلیک روی عنوانش یکی از این‌ها را می‌گذارد */
export type SortKey = "recent" | "mins" | "sessions" | "tickets" | "name" | "version";
export type SortDir = "asc" | "desc";
export interface SortState {
  key: SortKey;
  dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: "recent", dir: "desc" };

export const SORT_LABEL: Record<SortKey, [asc: string, desc: string]> = {
  name: ["نام (الف ← ی)", "نام (ی ← الف)"],
  recent: ["قدیمی‌ترین فعالیت", "جدیدترین فعالیت"],
  mins: ["کمترین مدت اتصال", "بیشترین مدت اتصال"],
  sessions: ["کمترین نشست", "بیشترین نشست"],
  tickets: ["کمترین بازخورد جدید", "بیشترین بازخورد جدید"],
  version: ["قدیمی‌ترین نسخه", "جدیدترین نسخه"],
};

export const sortText = (s: SortState) => SORT_LABEL[s.key][s.dir === "asc" ? 0 : 1];
export const isDefaultSort = (s: SortState) => s.key === DEFAULT_SORT.key && s.dir === DEFAULT_SORT.dir;

export interface ClientFilters {
  status: "" | "online" | "offline";
  account: "" | "logged" | "guest";
  /** فقط کلاینت‌های دارای بازخورد جدید */
  tickets: boolean;
  blocked: boolean;
  /** «only» = فقط قدیمی‌ها (دستگاه‌هایی که فقط از سرور شناسه شناخته شده‌اند)، «exclude» = فقط دستگاه‌هایی که به API گزارش می‌دهند */
  legacy: "" | "only" | "exclude";
  /** «p:Windows» = همهٔ ویندوزها، «o:Windows 11 Pro» = دقیقاً همین سیستم‌عامل */
  os: string;
  version: string;
  seen: string;
  old: boolean;
  newOnly: boolean;
}

export const NO_FILTERS: ClientFilters = { status: "", account: "", tickets: false, blocked: false, legacy: "", os: "", version: "", seen: "", old: false, newOnly: false };

export const STATUS_LABEL = { online: "آنلاین", offline: "آفلاین" } as const;
export const ACCOUNT_LABEL = { logged: "وارد شده", guest: "مهمان" } as const;
export const LEGACY_LABEL = { only: "قدیمی (بدون API)", exclude: "فقط دارای API" } as const;

export const SEEN: [string, string][] = [
  ["", "هر زمان"],
  ["24h", "۲۴ ساعت اخیر"],
  ["7d", "۷ روز اخیر"],
  ["30d", "۳۰ روز اخیر"],
  ["inactive", "غیرفعال بیش از ۳۰ روز"],
];

/** پارامترهای API از روی ترتیب و فیلترها */
export function queryParams(sort: SortState, f: ClientFilters, q: string, page: number, pageSize: number): URLSearchParams {
  const p = new URLSearchParams({ sort: sort.key, dir: sort.dir, q, page: String(page), page_size: String(pageSize) });
  if (f.status) p.set("status", f.status);
  if (f.account) p.set("account", f.account);
  if (f.tickets) p.set("tickets", "1");
  if (f.blocked) p.set("blocked", "1");
  if (f.legacy) p.set("legacy", f.legacy);
  if (f.os.startsWith("p:")) p.set("platform", f.os.slice(2));
  else if (f.os.startsWith("o:")) p.set("os", f.os.slice(2));
  if (f.version) p.set("version", f.version);
  if (f.seen) p.set("seen", f.seen);
  if (f.old) p.set("old", "1");
  if (f.newOnly) p.set("new", "1");
  return p;
}

/** شمار فیلترهای روشن (ترتیب جزو آن نیست) */
export const activeCount = (f: ClientFilters) =>
  [f.status, f.account, f.legacy, f.os, f.version, f.seen].filter(Boolean).length + [f.tickets, f.blocked, f.old, f.newOnly].filter(Boolean).length;

export interface Chip {
  key: string;
  label: string;
  /** با برداشتن این چیپ چه چیزی خاموش شود */
  clear: Partial<ClientFilters>;
}

/** هر فیلتر روشن یک چیپ؛ برای نوار «فیلترهای فعال» */
export function chips(f: ClientFilters): Chip[] {
  const out: Chip[] = [];
  if (f.status) out.push({ key: "status", label: `وضعیت: ${STATUS_LABEL[f.status]}`, clear: { status: "" } });
  if (f.seen) out.push({ key: "seen", label: `آخرین فعالیت: ${SEEN.find(([v]) => v === f.seen)?.[1] ?? f.seen}`, clear: { seen: "" } });
  if (f.account) out.push({ key: "account", label: `حساب: ${ACCOUNT_LABEL[f.account]}`, clear: { account: "" } });
  if (f.os) out.push({ key: "os", label: `سیستم‌عامل: ${f.os.slice(2)}`, clear: { os: "" } });
  if (f.version) out.push({ key: "version", label: `نسخه: ${f.version}`, clear: { version: "" } });
  if (f.old) out.push({ key: "old", label: "فقط نسخهٔ قدیمی", clear: { old: false } });
  if (f.newOnly) out.push({ key: "new", label: "نصب تازه · ۷ روز", clear: { newOnly: false } });
  if (f.legacy) out.push({ key: "legacy", label: `نوع: ${LEGACY_LABEL[f.legacy]}`, clear: { legacy: "" } });
  if (f.tickets) out.push({ key: "tickets", label: "دارای بازخورد جدید", clear: { tickets: false } });
  if (f.blocked) out.push({ key: "blocked", label: "مسدود", clear: { blocked: false } });
  return out;
}

/** گزینه‌ای که انتخاب شده ولی دیگر در شمارش‌ها نیست (۰ نتیجه) هم در فهرست بماند */
export function withSelected(list: [string, number][], selected: string): [string, number][] {
  return !selected || list.some(([v]) => v === selected) ? list : [[selected, 0], ...list];
}
