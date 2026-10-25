// نسخهٔ آسان دسک وب از اولین ردیف changelog.json می‌آید (مثل نسخهٔ پنل در backend/config/version.py)؛
// پنل («تنظیمات ← به‌روزرسانی ← کلاینت وب») همین فایل را در GitHub با نسخهٔ نصب‌شده مقایسه می‌کند.
import changelog from '../changelog.json';

export const WEB_VERSION: string = changelog[0].version;
