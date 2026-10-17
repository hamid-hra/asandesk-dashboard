// بررسی موبایل و ایمیل کاربران پنل؛ همان قواعد backend/accounts/contact.py (سرور هم دوباره بررسی می‌کند)

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizePhone(raw: string): string {
  let s = raw.replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
  s = s.replace(/[\s\-().]/g, "");
  if (s.startsWith("+98")) s = `0${s.slice(3)}`;
  else if (s.startsWith("0098")) s = `0${s.slice(4)}`;
  else if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (s.startsWith("98") && s.length === 12) s = `0${s.slice(2)}`;
  else if (s.startsWith("9") && s.length === 10) s = `0${s}`;
  return s;
}

export const PHONE_BAD = "شمارهٔ موبایل درست نیست؛ مثل ۰۹۱۲۳۴۵۶۷۸۹ وارد کنید.";
export const EMAIL_BAD = "ایمیل درست نیست؛ مثل name@example.com وارد کنید.";

export const phoneOk = (raw: string) => {
  const p = normalizePhone(raw);
  return /^09\d{9}$/.test(p) || /^\+(?!98)[1-9]\d{7,13}$/.test(p);
};

export const emailOk = (raw: string) => /^[^\s@]+@[^\s@]+\.[^\s@.]{2,}$/.test(raw.trim());

/** خطای هر فیلد؛ با `required` خالی بودن هم خطاست */
export function contactErrors(email: string, phone: string, required: boolean): { email?: string; phone?: string } {
  const out: { email?: string; phone?: string } = {};
  if (email.trim()) {
    if (!emailOk(email)) out.email = EMAIL_BAD;
  } else if (required) out.email = "ایمیل را وارد کنید.";
  if (phone.trim()) {
    if (!phoneOk(phone)) out.phone = PHONE_BAD;
  } else if (required) out.phone = "شمارهٔ موبایل را وارد کنید.";
  return out;
}

/** «09123456789» → «0912 345 6789» برای نمایش */
export const phoneText = (p: string) => (/^09\d{9}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p);
