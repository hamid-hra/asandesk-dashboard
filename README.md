# داشبورد مالک آسان‌دسک

پنل مدیریتی [آسان‌دسک](https://github.com/hamid-hra/asandesk) با **Next.js** (فرانت‌اند) و **Django** (بک‌اند)، کاملاً داکرایز.

| تب | وضعیت |
|---|---|
| سرور و منابع | ✅ منابع واقعی همین سرور (CPU، RAM، دیسک، پهنای باند، اتصال‌های TCP) + هشدارها |
| نسخه‌ها | ✅ انتشار نسخه با فایل نصب، تاریخچه، `latest.json` برای به‌روزرسانی خودکار، شمارش دانلود |
| کلاینت‌ها، تبلیغات، اطلاعیه‌ها، تنظیمات | 🕓 «به‌زودی» (فاز ۳) |

## راه‌اندازی روی سرور

```bash
git clone -b main https://github.com/hamid-hra/asandesk-dashboard.git
cd asandesk-dashboard
cp .env.example .env      # فقط POSTGRES_USER و POSTGRES_PASSWORD
nano .env                 # رمز دیتابیس را عوض کنید
docker compose up -d --build
```

**اولین ورود (ساخت حساب مالک):**

1. پنل را باز کنید: `http://<IP-سرور>:8080`. چون هنوز کاربری وجود ندارد، صفحهٔ «راه‌اندازی اولیه» نمایش داده می‌شود.
2. کد راه‌اندازی یک‌بارمصرف را از لاگ backend بردارید:
   ```bash
   docker compose logs backend | grep "SETUP CODE"
   # یا: docker compose exec backend python manage.py setup_code
   ```
3. کد را وارد کنید و نام کاربری و رمز عبور مالک را خودتان تعیین کنید.

بعد از ساخت حساب مالک، کد باطل می‌شود و این صفحه دیگر نمایش داده نمی‌شود. کد برای این است که اگر کسی زودتر از شما پنل را باز کرد، نتواند مالک شود.

**رازهای خودکار:** کلید Django و توکن agent در اولین اجرا به‌صورت تصادفی ساخته می‌شوند و در volumeهای `secrets` و `agent-token` می‌مانند. هیچ رازی جز رمز دیتابیس در `.env` نیست.

حدود ۳۰ ثانیه بعد از بالا آمدن، اولین داده‌های منابع سرور نمایش داده می‌شود.

### تنظیمات اختیاری

این مقادیر پیش‌فرض دارند. فقط در صورت نیاز آن‌ها را به `.env` اضافه کنید:

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `HTTP_PORT` | `8080` | پورت پنل روی سرور (مثلاً `80`) |
| `PUBLIC_BASE_URL` | آدرسی که پنل با آن باز شده | دامنهٔ لینک‌های دانلود در `latest.json`، مثلاً `https://panel.asandesk.ir` |
| `SECURE_COOKIES` | `0` | وقتی پنل پشت HTTPS است، `1` بگذارید |
| `AGENT_PORTS` | خالی (همه اتصال‌ها) | فقط اتصال‌های این پورت‌ها شمرده شود، مثلاً `21116,21117` |
| `AGENT_NET_CAPACITY_MBPS` | تشخیص خودکار یا ۱۰۰۰ | ظرفیت لینک شبکه |
| `AGENT_IP` | خالی | IP نمایش‌داده‌شده برای این سرور |
| `RELEASE_MAX_FILE_MB` | `500` | حداکثر حجم هر فایل نصب |

> برای ریست کامل (حذف دیتابیس، فایل‌ها و حساب مالک): `docker compose down -v`

### حالت توسعه (hot-reload)

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

کد `backend/` و `frontend/` داخل کانتینرها mount می‌شود و تغییرات فوراً اعمال می‌شود.

بدون داکر (برای فرانت‌اند): Django را روی پورت 8000 اجرا کنید و بعد
`cd frontend && BACKEND_URL=http://localhost:8000 npm run dev` (پنل روی پورت 3000).

## معماری

```
                 ┌──────────── nginx :8080 ────────────┐
 مرورگر  ───────►│ /           → frontend (Next.js)     │
                 │ /api, /admin → backend (Django)      │
                 │ /releases/latest.json → volume       │
                 └──────────────────────────────────────┘
 agent (pid: host) ──► backend /api/agent/ingest  ──► PostgreSQL
```

- **backend/**: Django 5 + DRF. اپ‌ها:
  - `accounts` کاربر و نقش‌ها
  - `monitoring` دریافت داده از agent، سری‌های زمانی و هشدارها
  - `releases` نسخه‌ها و فایل‌های نصب
- **frontend/**: Next.js 16 (App Router)، RTL و فارسی. تم لایت/دارک مطابق طرح است و نمودارها SVG سفارشی هستند.
- **agent/**: اسکریپت Python (psutil) که هر ۱۵ ثانیه منابع میزبان را گزارش می‌دهد. با `pid: host` شبکه و اتصال‌های میزبان را از `/proc/1/net` می‌خواند و دیسک را از `/hostfs`.
- **nginx/**: فایل‌های نصب فقط از مسیر `/api/releases/<version>/download/<platform>` و با `X-Accel-Redirect` سرو می‌شوند تا دانلودها شمرده شوند.

## نقش‌ها

| نقش | دسترسی |
|---|---|
| مالک (owner) | همه چیز، به‌علاوه مدیریت کاربران در `/admin` (منوی پروفایل ← «مدیریت کاربران و نقش‌ها») |
| مدیر (admin) | انتشار نسخه، بررسی هشدارها |
| ناظر (viewer) | فقط مشاهده |

حساب مالک در اولین ورود ساخته می‌شود (بخش بالا). کاربران بعدی را مالک از `/admin/accounts/user/` می‌سازد. فقط نقش مالک به پنل `/admin` دسترسی دارد.

اگر رمز مالک را فراموش کردید: `docker compose exec backend python manage.py changepassword <username>`

## به‌روزرسانی خودکار کلاینت

بعد از هر انتشار این دو فایل بازنویسی می‌شوند:

- `/releases/latest.json`: آخرین نسخه پایدار
- `/releases/latest-beta.json`: جدیدترین نسخه بتا یا پایدار

```json
{
  "version": "2.5.0", "channel": "stable", "date": "2026-10-01",
  "mandatory": false, "rollout": 100, "notes": ["..."],
  "assets": { "windows": { "url": ".../api/releases/2.5.0/download/windows", "size": 123, "sha256": "..." } }
}
```

در کلاینت، `ORG_UPDATE_URL` در `src/asandesk.rs` به همین فایل اشاره می‌کند (`https://asandesk.ir/releases/latest.json`). البته کلاینت هنوز از آن استفاده نمی‌کند، چون `do_check_software_update` هنوز API رسمی RustDesk را صدا می‌زند.

لینک‌های دانلود از آدرسی ساخته می‌شوند که پنل هنگام انتشار نسخه با آن باز شده بود. اگر پنل را با IP باز می‌کنید ولی کلاینت‌ها باید از دامنه دانلود کنند، `PUBLIC_BASE_URL` را تنظیم کنید.

## مانیتورینگ و هشدارها

قوانین هشدار در `backend/monitoring/alerts.py` تعریف شده‌اند:

| قانون | سطح |
|---|---|
| میانگین CPU بالای ۸۰٪ در ۱۰ دقیقه | بحرانی |
| RAM بالای ۹۰٪ | هشدار |
| دیسک بالای ۸۵٪ | هشدار (بالای ۹۵٪ بحرانی) |
| بیش از ۲ دقیقه بدون گزارش از سرور | بحرانی |

هشدارها با برگشت وضعیت به حالت عادی خودبه‌خود بسته می‌شوند. نمونه‌های قدیمی‌تر از `METRICS_RETENTION_DAYS` (پیش‌فرض ۹۰ روز) حذف می‌شوند.

داده‌هایی که فقط با سرور آسان‌دسک معنا دارند فعلاً «بدون داده» نمایش داده می‌شوند:
- اتصال‌های ناموفق
- کل نشست‌ها
- توزیع پلتفرم/منطقه
- توزیع نسخه‌ها بین کاربران

«کانکشن‌های همزمان» فعلاً تعداد اتصال‌های TCP برقرار روی سرور است. وقتی hbbs/hbbr روی سرور نصب شد، با `AGENT_PORTS=21116,21117` فقط اتصال‌های آسان‌دسک شمرده می‌شوند.

### افزودن سرور دیگر (مثلاً رله‌ها)

1. در `/admin/monitoring/server/add/` سرور را بسازید. توکن agent یک بار نمایش داده می‌شود.
2. روی آن سرور فقط agent را اجرا کنید:

```bash
docker build -t asandesk-agent ./agent
docker run -d --restart unless-stopped --pid host \
  -v /:/hostfs:ro -v /sys:/hostsys:ro \
  -e AGENT_URL=https://panel.example.com/api/agent/ingest \
  -e AGENT_TOKEN=<token> -e AGENT_DISK_PATH=/hostfs -e AGENT_SYS=/hostsys \
  asandesk-agent
```

> روی Docker Desktop (ویندوز/مک)، «میزبان» در واقع ماشین مجازی لینوکسی داکر است و منابع همان نمایش داده می‌شود. روی سرور لینوکسی منابع واقعی خود سرور نمایش داده می‌شود.

## تست‌ها

```bash
# بک‌اند (به PostgreSQL نیاز دارد)
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm backend pytest

# فرانت‌اند
cd frontend && npm ci && npm run lint && npm run typecheck && npm run build
```
