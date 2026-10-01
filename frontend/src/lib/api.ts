export class ApiError extends Error {
  constructor(
    public status: number,
    public data: unknown,
  ) {
    super(firstError(data) || `HTTP ${status}`);
  }
}

/** اولین پیام خطا از پاسخ DRF (به ترتیب فیلدها) */
export function firstError(data: unknown): string {
  if (!data) return "";
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return firstError(data[0]);
  if (typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    for (const v of Object.values(obj)) {
      const msg = firstError(v);
      if (msg) return msg;
    }
  }
  return "";
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function ensureCsrf() {
  if (!csrfToken()) await fetch("/api/auth/csrf", { credentials: "same-origin" });
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method || "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: BodyInit | undefined;
  if (method !== "GET") {
    await ensureCsrf();
    headers["X-CSRFToken"] = csrfToken();
    if (init.body instanceof FormData) body = init.body;
    else if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
  }
  const res = await fetch(path, { method, headers, body, credentials: "same-origin" });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // پاسخ غیر JSON (مثلاً خطای nginx)
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export const fetcher = <T>(path: string) => api<T>(path);

/** ارسال فرم چندبخشی با گزارش درصد بارگذاری (برای فایل‌های نصب حجیم) */
export async function upload<T>(path: string, form: FormData, onProgress: (pct: number) => void): Promise<T> {
  await ensureCsrf();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRFToken", csrfToken());
    xhr.setRequestHeader("Accept", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: unknown = xhr.responseText;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else if (xhr.status === 413) reject(new ApiError(413, "حجم فایل بیشتر از حد مجاز سرور است."));
      else reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, "ارتباط با سرور برقرار نشد."));
    xhr.send(form);
  });
}
