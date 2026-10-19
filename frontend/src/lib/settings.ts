import { toFa } from "./fa";
import type { ChangelogEntry, Level, Perms } from "./types";

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
  must_change_password: boolean;
  email: string;
  phone: string;
  needs_contact: boolean;
}

export const SECTIONS: [string, string][] = [
  ["server", "سرور و منابع"],
  ["release", "نسخه‌ها"],
  ["clients", "کلاینت‌ها"],
  ["tickets", "بازخوردها"],
  ["ads", "تبلیغات"],
  ["users", "تنظیمات ← کاربران"],
  ["backup", "تنظیمات ← پشتیبان‌گیری"],
  ["ha", "سرورهای HA"],
  ["activity", "تنظیمات ← لاگ فعالیت"],
];

/** توضیح زیر نام بخش در ماتریس دسترسی، جایی که «مشاهده» و «ویرایش» معنای ویژه‌ای دارند */
export const SECTION_HINT: Record<string, string> = {
  backup: "«مشاهده» فقط فهرست را نشان می‌دهد؛ دانلود، ساخت و بازگردانی پشتیبان «ویرایش» می‌خواهد (پشتیبان = کپی کل دیتابیس)",
  users: "«مشاهده» فهرست کاربران؛ ساخت، تغییر رمز و حذف «ویرایش» می‌خواهد",
};

/** سطح‌هایی که یک بخش دارد (پیش‌فرض هر سه). «لاگ فعالیت» فقط مشاهده دارد */
export const SECTION_LEVELS: Record<string, Level[]> = { activity: ["none", "view"] };

export const LEVELS: [Level, string][] = [
  ["none", "بدون دسترسی"],
  ["view", "مشاهده"],
  ["edit", "ویرایش"],
];

/** باید با PRESETS در backend/accounts/models.py یکی باشد */
export const PRESET: Record<"owner" | "admin" | "viewer", Perms> = {
  owner: { server: "edit", release: "edit", clients: "edit", tickets: "edit", ads: "edit", users: "edit", backup: "edit", ha: "edit", activity: "edit", system: "edit" },
  admin: { server: "edit", release: "edit", clients: "edit", tickets: "edit", ads: "edit", users: "none", backup: "none", ha: "none", activity: "none", system: "none" },
  viewer: { server: "view", release: "view", clients: "view", tickets: "view", ads: "view", users: "none", backup: "none", ha: "none", activity: "none", system: "none" },
};

export const ROLE_CARDS: { id: "admin" | "viewer" | "custom"; label: string; desc: string }[] = [
  { id: "admin", label: "مدیر", desc: "انتشار نسخه، مدیریت کلاینت‌ها و بازخوردها." },
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

/** کپی در کلیپ‌بورد. روی http (مثل http://IP:پورت) مرورگر navigator.clipboard را نمی‌دهد، پس راه قدیمی execCommand هم امتحان می‌شود. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // به راه قدیمی می‌رویم
  }
  try {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(box);
    return ok;
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
  /** وضعیت پروسه‌های hbbs/hbbr از agent؛ null = agent گزارش نمی‌دهد */
  services: Record<string, HAService> | null;
}
export interface HAService {
  up: boolean;
  uptime_s: number;
  /** درصد از کل CPU میزبان */
  cpu: number;
  /** بایت */
  ram: number;
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

// ---------- لاگ فعالیت ----------
export interface ActivityRow {
  id: number;
  ts: string;
  username: string;
  display_name: string;
  action: string;
  category: string;
  text: string;
  ok: boolean;
  ip: string;
}
export interface ActivityPerson {
  username: string;
  display_name: string;
  count: number;
  last: string;
  exists: boolean;
}
export interface ActivityPage {
  rows: ActivityRow[];
  next: number | null;
  people?: ActivityPerson[];
}
/** برچسب و رنگ هر بخش در لاگ فعالیت: [متن، پس‌زمینه، رنگ متن] */
export const ACTIVITY_CATEGORY: Record<string, [string, string, string]> = {
  auth: ["ورود", "var(--info-soft)", "var(--info-text)"],
  users: ["کاربران", "var(--warn-soft)", "var(--warn-text)"],
  release: ["نسخه‌ها", "var(--accent-soft)", "var(--accent-strong)"],
  clients: ["کلاینت‌ها", "var(--info-soft)", "var(--info-text)"],
  tickets: ["بازخوردها", "var(--beta-soft)", "var(--beta-text)"],
  backup: ["پشتیبان‌گیری", "var(--subtle)", "var(--text-2)"],
  ha: ["HA", "var(--beta-soft)", "var(--beta-text)"],
  server: ["سرور", "var(--subtle)", "var(--text-2)"],
  system: ["سیستم", "var(--danger-soft)", "var(--danger-text)"],
  notices: ["اعلان‌ها", "var(--accent-soft)", "var(--accent-strong)"],
  other: ["سایر", "var(--subtle)", "var(--muted)"],
};

// ---------- به‌روزرسانی پنل و لاگ داکر (فقط مالک) ----------
export interface UpdateCommit {
  sha: string;
  author: string;
  date: string;
  subject: string;
}
export interface UpdateCheck {
  checked_at: string;
  branch: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  commits: UpdateCommit[];
  remote_version: string | null;
  disk_version: string | null;
  pending_build: boolean;
  available: boolean;
  new_entries: ChangelogEntry[];
}
export interface UpdateJob {
  state: "none" | "running" | "ok" | "failed";
  exit_code?: number | null;
  started_at?: string;
  finished_at?: string | null;
  log?: string;
}
export interface UpdateInfo {
  version: string;
  control: { online: boolean; error?: string };
  job: UpdateJob | null;
  check: UpdateCheck | null;
  check_error: string;
}
export interface DockerService {
  service: string;
  container: string;
  state: string;
  status: string;
}
export interface DockerLogLine {
  ts: string;
  stream: "out" | "err";
  text: string;
  /** فقط در نمای «همهٔ سرویس‌ها» */
  service?: string;
}
export interface DockerLogs {
  service: string;
  container: string;
  state: string;
  lines: DockerLogLine[];
  /** نمای «همه»: سرویس‌هایی که لاگشان خوانده نشد */
  failed?: string[];
}

// ---------- فایل «اطلاعات ورود» کاربر تازه ----------
/** متن فایلی که مالک برای کاربر تازه می‌فرستد؛ فقط در مرورگر ساخته می‌شود و جایی ذخیره نمی‌شود */
export function loginFileText(p: { url: string; username: string; password: string; name: string; hasKey: boolean }): string {
  const lines = [
    "آسان‌دسک — اطلاعات ورود به پنل",
    "================================",
    "",
    `سلام ${p.name}،`,
    "حساب شما در پنل آسان‌دسک ساخته شد.",
    "",
    `آدرس پنل: ${p.url}`,
    `نام کاربری: ${p.username}`,
    `رمز عبور موقت: ${p.password}`,
    "",
    "طرز ورود:",
    "۱) آدرس بالا را در مرورگر باز کنید.",
    "۲) با نام کاربری و رمز موقت وارد شوید.",
    "۳) پنل از شما یک رمز عبور تازه می‌خواهد؛ رمزی قوی بگذارید.",
    "۴) بعدش «کدهای بازیابی» را می‌بینید؛ فایلشان را دانلود کنید و نگه دارید (برای وقتی که رمز را فراموش کردید).",
    "",
    "نکته‌ها:",
    "- رمز بالا فقط برای اولین ورود است و بعد از آن دیگر کار نمی‌کند.",
    "- بعد از ورود، این فایل را پاک کنید و برای کسی نفرستید.",
  ];
  if (p.hasKey) lines.push("- آدرس بالا یک کلید دسترسی دارد (بخش آخرش). فقط بار اول لازم است؛ آن را با کسی در میان نگذارید.");
  // BOM: نوت‌پد قدیمی هم فارسی را درست نشان بدهد؛ CRLF: همان‌طور که ویندوز انتظار دارد
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function downloadTextFile(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
