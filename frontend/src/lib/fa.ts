// قالب‌بندی فارسی — همان توابع طرح
const FA = "۰۱۲۳۴۵۶۷۸۹";

export const toFa = (s: string | number) => String(s).replace(/\d/g, (d) => FA[+d]).replace(/\./g, "٫");

export const fmt = (n: number) => toFa(Math.round(n).toLocaleString("en-US"));

export const pctText = (v: number, digits = 0) => toFa(v.toFixed(digits)) + "٪";

export const deltaText = (v: number) => `${v >= 0 ? "+" : "−"}${toFa(Math.abs(v).toFixed(1))}٪`;

export const dfDay = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { day: "numeric", month: "long" });
export const dfFull = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { weekday: "long", day: "numeric", month: "long" });
export const dfToday = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});
const dfJalali = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit" });

/** امروز به صورت «۱۴۰۵/۰۷/۰۹» */
export const jalaliToday = () => dfJalali.format(new Date());

/** «1405/07/09» → «۱۴۰۵/۰۷/۰۹» */
export const faDate = (s: string) => s.replace(/\d/g, (d) => FA[+d]);

export const hourLabel = (d: Date) => `${toFa(String(d.getHours()).padStart(2, "0"))}:${toFa(String(d.getMinutes()).padStart(2, "0"))}`;

const GB = 1024 ** 3;

/** حجم به گیگابایت/ترابایت به‌صورت فارسی */
export function sizeText(bytes: number): { value: string; unit: string } {
  if (bytes >= 1024 * GB) return { value: toFa((bytes / (1024 * GB)).toFixed(1)), unit: "ترابایت" };
  if (bytes >= GB) return { value: toFa(Math.round(bytes / GB)), unit: "گیگابایت" };
  return { value: toFa(Math.round(bytes / 1024 ** 2)), unit: "مگابایت" };
}

/** «۷۱۵ از ۱۶ گیگابایت» با واحد مشترک */
export function usedOfTotal(used: number, total: number): string {
  const t = sizeText(total);
  const div = t.unit === "ترابایت" ? 1024 * GB : t.unit === "گیگابایت" ? GB : 1024 ** 2;
  const u = used / div;
  const usedStr = toFa(t.unit === "ترابایت" || u < 10 ? u.toFixed(1) : Math.round(u).toString());
  return `${usedStr} از ${t.value} ${t.unit}`;
}

export const mbText = (bytes: number) => toFa((bytes / 1048576).toFixed(1)) + " مگابایت";

/** مدت به فارسی: ثانیه → «۲ ساعت و ۵ دقیقه» یا «۲۶ دقیقه» یا «۴۰ ثانیه» */
export function durationText(seconds: number): string {
  if (seconds < 60) return `${toFa(seconds)} ثانیه`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${toFa(m)} دقیقه`;
  if (m === 0) return `${toFa(h)} ساعت`;
  return `${toFa(h)} ساعت و ${toFa(m)} دقیقه`;
}

/** مدت کوتاه برای ردیف نشست: «۳۳ دقیقه» / «۱ ساعت» */
export function durationShort(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${toFa(Math.max(1, m))} دقیقه`;
  return m === 0 ? `${toFa(h)} ساعت` : `${toFa(h)}:${toFa(String(m).padStart(2, "0"))}`;
}

/** جمع ساعت برای KPI: «۴۷٫۷ ساعت» */
export const hoursText = (seconds: number) => `${toFa((seconds / 3600).toFixed(1))} ساعت`;

/** نرخ بیت با واحد لاتین (مثل طرح: «۴٫۲ Gbps») */
export function bpsText(bps: number): string {
  const units = ["bps", "Kbps", "Mbps", "Gbps", "Tbps"];
  let v = bps;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${toFa(v >= 100 || i === 0 ? Math.round(v).toString() : v.toFixed(1))} ${units[i]}`;
}

/** زمان رویداد: امروز → ساعت، دیروز → «دیروز»، قبل‌تر → تاریخ */
export function eventTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return hourLabel(d);
  if (diff === 1) return "دیروز";
  return dfDay.format(d);
}
