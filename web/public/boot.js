// تم ذخیره‌شده پیش از اولین رسم صفحه، تا لودینگ آغازین (index.html) همان رنگ برنامه را داشته باشد.
// فایل جدا چون CSP اسکریپت درون‌خطی را نمی‌پذیرد؛ theme.ts بعداً همین را دوباره اعمال می‌کند.
(function () {
  var t = null;
  try {
    t = localStorage.getItem('asw_theme');
  } catch (e) {
    /* حافظهٔ مرورگر در دسترس نیست */
  }
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', t);
})();
