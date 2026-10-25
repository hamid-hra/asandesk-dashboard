// نصب آسان دسک وب روی دستگاه (Progressive Web App): manifest و service worker در public/ هستند.
// مرورگر رویداد beforeinstallprompt را زود می‌فرستد، پس از همان ابتدا نگهش می‌داریم تا منو «نصب» نشان دهد.
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPrompt | null = null;
const subs = new Set<(p: InstallPrompt | null) => void>();

function emit() {
  for (const s of subs) s(deferred);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
  // روی https (و localhost برای آزمون)؛ مرورگرها روی http ساده service worker نمی‌پذیرند
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    });
  }
}

export function installPromptNow(): InstallPrompt | null {
  return deferred;
}

export function onInstallPrompt(fn: (p: InstallPrompt | null) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export async function promptInstall(): Promise<boolean> {
  const p = deferred;
  if (!p) return false;
  await p.prompt();
  const choice = await p.userChoice;
  deferred = null;
  emit();
  return choice.outcome === 'accepted';
}
