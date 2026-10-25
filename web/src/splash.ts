// لودینگ آغازین آسان دسک (index.html) پیش از رسیدن فایل‌های برنامه دیده می‌شود و تا وقتی صفحه آماده نشده
// می‌ماند (App و HomePage hideSplash را صدا می‌زنند)؛ بعد محو و حذف می‌شود.
let hidden = false;

export function hideSplash() {
  if (hidden) return;
  hidden = true;
  const el = document.getElementById('splash');
  if (!el) return;
  el.classList.add('sp-gone');
  setTimeout(() => el.remove(), 400);
}

// اگر چیزی گیر کرد، کاربر پشت لودینگ نماند
setTimeout(hideSplash, 15_000);
