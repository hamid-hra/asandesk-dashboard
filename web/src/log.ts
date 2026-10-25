// لاگ برنامهٔ وب از لحظهٔ باز شدن صفحه؛ مثل لاگ برنامهٔ دسکتاپ همراه «ارسال بازخورد» می‌رود. رمزها ثبت نمی‌شوند.
const MAX_LINES = 3000;
const lines: string[] = [];

function stamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

export function alog(...parts: unknown[]) {
  const text = parts.map((p) => (typeof p === 'string' ? p : p instanceof Error ? `${p.name}: ${p.message}` : JSON.stringify(p))).join(' ');
  lines.push(`${stamp()} ${text}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

export function logText(): string {
  return `${lines.join('\n')}\n`;
}

// آزمون‌ها (test/e2e.test.ts) یک window ساختگی بی‌رویداد دارند
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  alog('start', navigator.userAgent);
  window.addEventListener('error', (e) => alog('error', e.message, `${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => alog('unhandled', e.reason instanceof Error ? e.reason : String(e.reason)));
}
