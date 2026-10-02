import { toFa } from "./fa";
import type { Level, Perms } from "./types";

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: "owner" | "admin" | "viewer" | "custom";
  role_label: string;
  active: boolean;
  last_login: string | null;
  created: string;
  perms: Perms | null;
  me: boolean;
  locked: boolean;
}

export const SECTIONS: [string, string][] = [
  ["server", "سرور و منابع"],
  ["release", "نسخه‌ها"],
  ["clients", "کلاینت‌ها"],
  ["tickets", "تیکت‌ها"],
  ["ads", "تبلیغات"],
  ["announce", "اطلاعیه‌ها"],
  ["users", "تنظیمات ← کاربران"],
  ["backup", "تنظیمات ← پشتیبان‌گیری"],
  ["ha", "تنظیمات ← HA"],
];

export const LEVELS: [Level, string][] = [
  ["none", "بدون دسترسی"],
  ["view", "مشاهده"],
  ["edit", "ویرایش"],
];

/** باید با PRESETS در backend/accounts/models.py یکی باشد */
export const PRESET: Record<"owner" | "admin" | "viewer", Perms> = {
  owner: { server: "edit", release: "edit", clients: "edit", tickets: "edit", ads: "edit", announce: "edit", users: "edit", backup: "edit", ha: "edit" },
  admin: { server: "edit", release: "edit", clients: "edit", tickets: "edit", ads: "edit", announce: "edit", users: "none", backup: "view", ha: "view" },
  viewer: { server: "view", release: "view", clients: "view", tickets: "view", ads: "view", announce: "view", users: "none", backup: "view", ha: "view" },
};

export const ROLE_CARDS: { id: "admin" | "viewer" | "custom"; label: string; desc: string }[] = [
  { id: "admin", label: "مدیر", desc: "انتشار نسخه، مدیریت کلاینت‌ها و تیکت‌ها." },
  { id: "viewer", label: "ناظر", desc: "فقط مشاهده؛ هیچ تغییری نمی‌تواند بدهد." },
  { id: "custom", label: "سفارشی", desc: "دسترسی هر بخش جداگانه تعیین می‌شود." },
];

export const ROLE_TONE: Record<string, { bg: string; color: string }> = {
  owner: { bg: "var(--accent-strong)", color: "#fff" },
  admin: { bg: "var(--info-soft)", color: "var(--info-text)" },
  viewer: { bg: "var(--subtle)", color: "var(--text-2)" },
  custom: { bg: "var(--warn-soft)", color: "var(--warn-text)" },
};

export const RO_TIP = "دسترسی ویرایش ندارید";

const dfDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit" });
const dfTime = new Intl.DateTimeFormat("fa-IR", { hour: "2-digit", minute: "2-digit", hour12: false });

/** «۱۴۰۵/۰۷/۱۰» */
export const jDate = (iso: string) => dfDate.format(new Date(iso));
/** «۰۹:۴۲» */
export const jTime = (iso: string) => dfTime.format(new Date(iso));
/** «۱۴۰۵/۰۷/۱۰ — ۰۹:۴۲» */
export const jStamp = (iso: string) => `${jDate(iso)} — ${jTime(iso)}`;

export function agoText(iso: string | null): string {
  if (!iso) return "—";
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 10) return "همین حالا";
  if (sec < 60) return `${toFa(Math.round(sec))} ثانیه پیش`;
  if (sec < 3600) return `${toFa(Math.round(sec / 60))} دقیقه پیش`;
  if (sec < 86400) return `${toFa(Math.round(sec / 3600))} ساعت پیش`;
  return jStamp(iso);
}

export function mmss(sec: number): string {
  return toFa(`${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`);
}

export function bytesFa(n: number): string {
  if (n >= 1024 ** 3) return `${toFa((n / 1024 ** 3).toFixed(2))} گیگابایت`;
  return `${toFa((n / 1024 ** 2).toFixed(1))} مگابایت`;
}

/** قدرت رمز: ۰ تا ۴ */
export function strength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return Math.max(1, s);
}

export const STRENGTH: [string, string][] = [
  ["", "var(--faint)"],
  ["ضعیف", "var(--danger)"],
  ["متوسط", "var(--warn)"],
  ["خوب", "var(--info)"],
  ["قوی", "var(--ok)"],
];

export function randomPassword(len = 16): string {
  const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%^&*-_"];
  const all = sets.join("");
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  const chars = Array.from(buf, (v, i) => (i < sets.length ? sets[i][v % sets[i].length] : all[v % all.length]));
  // جابه‌جایی تصادفی تا چهار نویسهٔ اول جای ثابت نداشته باشند
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------- پشتیبان‌گیری ----------
export interface BackupRow {
  id: number;
  kind: "auto" | "manual" | "safety" | "uploaded";
  created_at: string;
  size: number;
  include_files: boolean;
  ok: boolean;
  error: string;
  by: string;
  expiring: boolean;
}
export interface OpLog {
  t: string;
  txt: string;
  lvl: "info" | "ok" | "warn" | "err";
}
export interface Operation {
  id: number;
  kind: "backup" | "restore";
  trigger: string;
  status: "queued" | "running" | "ok" | "failed" | "cancelled";
  pct: number;
  stage: string;
  logs: OpLog[];
  cancellable: boolean;
  message: string;
  backup_id: number | null;
  by: string;
  elapsed: number;
}
export interface BackupOverview {
  settings: { enabled: boolean; run_time: string; keep_days: number; include_files: boolean };
  backups: BackupRow[];
  op: Operation | null;
  next_run: string | null;
  files_size: number;
  scheduler_alive: boolean;
  confirm_word: string;
}
export const KIND_LABEL: Record<string, string> = { auto: "خودکار", manual: "دستی", safety: "ایمنی", uploaded: "بارگذاری‌شده" };

// ---------- HA ----------
export interface HAServerRow {
  id: number;
  name: string;
  address: string;
  role: "primary" | "backup";
  priority: number;
  id_port: number;
  relay_port: number;
  maintenance: boolean;
  status: "ok" | "slow" | "down" | "unknown" | "maintenance";
  latency_ms: number | null;
  serving: boolean;
  ports: { label: string; ok: boolean | null; tip: string }[];
  key_state: "ok" | "bad" | "unknown";
  last_check: string | null;
  history: (number | null)[];
  agent_online: boolean;
}
export interface HAEventRow {
  id: number;
  ts: string;
  kind: "ok" | "warn" | "err" | "edit" | "add";
  title: string;
  by: string;
}
export interface HAOverview {
  config: { domain: string; method: "dns" | "vip"; interval: number; fails: number; failback: boolean };
  servers: HAServerRow[];
  events: HAEventRow[];
  serving: string | null;
  healthy: number;
  total: number;
  ip: string;
  last_failover: HAEventRow | null;
}
