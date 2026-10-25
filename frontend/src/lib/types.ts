export type Role = "owner" | "admin" | "viewer" | "custom";
export type Level = "none" | "view" | "edit";
export type Perms = Record<string, Level>;

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  role_label: string;
  can_manage: boolean;
  perms: Perms;
  /** رمز را کس دیگری گذاشته؛ پنل تا عوض‌کردنش فقط صفحهٔ «رمز تازه» را نشان می‌دهد */
  must_change_password: boolean;
  email: string;
  phone: string;
  /** ایمیل یا موبایل ندارد؛ پنل تا پرشدنشان فرم «اطلاعات تماس» را نشان می‌دهد */
  needs_contact: boolean;
}

export type NoticeKind = "info" | "update" | "warning";

export interface Notice {
  id: number;
  title: string;
  body: string;
  kind: NoticeKind;
  popup: boolean;
  /** فقط اعلان خودکار «پنل به‌روز شد» */
  version: string | null;
  /** تغییرات همان نسخه: [نوع، متن] */
  items: [ChangelogItem["type"], string][];
  created_at: string;
  expires_at: string | null;
  by: string;
  read: boolean;
}

export interface NoticeInbox {
  unread: number;
  results: Notice[];
}

export interface SentNotice extends Omit<Notice, "read"> {
  recipients: number[];
  recipient_names: string[];
  audience: number;
  reads: number;
  expired: boolean;
}

export interface SearchItem {
  id: string | number;
  title: string;
  sub: string;
  href: string;
  online?: boolean;
}

export interface SearchResult {
  q: string;
  groups: { id: string; label: string; items: SearchItem[] }[];
}

export type RangeId = "24h" | "7d" | "30d" | "90d";

export interface Point {
  t: string;
  cpu: number | null;
  ram: number | null;
  disk: number | null;
  net: number | null;
  conn: number | null;
  conn_max: number | null;
  /** درخواست‌های اتصالِ شروع‌شده در این بازه، و آن‌هایی که احراز نشدند (ناموفق یا لغو شده) */
  req: number;
  fail: number;
}

export type ServerStatus = "ok" | "high" | "maint" | "offline";

export interface ServerRow {
  id: number;
  name: string;
  region: string;
  ip: string;
  status: ServerStatus;
  online: boolean;
  cpu: number | null;
  ram: number | null;
  conns: number | null;
  latency_ms: number | null;
  last_seen: string | null;
}

/** شمار درخواست‌های اتصال در یک بازه؛ ناموفق و لغو شده فقط وقتی جدا می‌شوند که اپ علت را بفرستد، وگرنه در unknown هستند */
export interface RequestCounts {
  total: number;
  ok: number;
  pending: number;
  failed: number;
  cancelled: number;
  unknown: number;
  fail_rate: number | null;
}

export interface Overview {
  /** شناسهٔ سروری که نمودارها فقط برای آن است؛ null = همهٔ سرورهای پایش‌شده */
  server: number | null;
  range: RangeId;
  step_seconds: number;
  points: Point[];
  servers: ServerRow[];
  /** دستگاه‌های آنلاین الان به تفکیک پلتفرم؛ [نام، تعداد] */
  breakdown: { platform: [string, number][]; total: number; legacy: number; legacy_known: boolean; online_command?: string } | null;
  sessions_total: number | null;
  fail_rate: number | null;
  requests: { today: RequestCounts; range: RequestCounts };
}

export interface LiveAggregate {
  ts: string;
  cpu: number;
  cores: number;
  ram: number | null;
  ram_used: number;
  ram_total: number;
  disk: number | null;
  disk_used: number;
  disk_total: number;
  net_bps: number;
  net_capacity_bps: number;
  net: number;
  tcp_established: number;
  latency_ms: number | null;
  load1: number;
}

export interface Live {
  online: number;
  total: number;
  aggregate: LiveAggregate | null;
}

export interface Status {
  online: number;
  total: number;
  open_crit: number;
  unacked: number;
  uptime_30d: number | null;
  open_tickets: number;
}

export interface Alert {
  id: number;
  level: "crit" | "warn" | "info";
  kind: string;
  title: string;
  detail: string;
  server_name: string;
  opened_at: string;
  resolved_at: string | null;
}

export type Channel = "stable" | "beta";
export type Platform = "Windows" | "macOS" | "Linux" | "Android";

export interface Release {
  id: number;
  version: string;
  channel: Channel;
  date: string;
  published_on: string;
  platforms: Platform[];
  notes: string[];
  mandatory: boolean;
  rollout: number;
  downloads: number;
  /** کلاینت‌های فعال ۳۰ روز اخیر که همین نسخه را گزارش داده‌اند */
  devices: number;
  /** فیلدهای فایل update.json که اپلیکیشن می‌خواند */
  build: number;
  message: string;
  /** متن روی چیپ نارنجی اپلیکیشن در حالت تعمیر؛ خالی یعنی متن پیش‌فرض */
  notice_title: string;
  maintenance: boolean;
  enabled: boolean;
  /** کانال پشتیبانی در بله (بخش support در update.json) */
  bale_url: string;
  bale_id: string;
  /** چیزهایی که باعث می‌شود اپلیکیشن پیشنهاد دانلود را نشان ندهد */
  update_warnings: string[];
  assets: { platform: Platform; filename: string; size: number; sha256: string; source_url: string }[];
  created_at: string;
}

export interface ReleaseStats {
  latest_stable: string | null;
  latest_beta: string | null;
  /** فقط دانلودهایی که از خود پنل شده؛ با فایل روی CDN صفر می‌ماند */
  downloads_30d: number;
  /** دستگاه‌هایی که اولین درخواستشان در ۳۰ روز اخیر به API رسیده */
  installs_30d: number;
  users_on_current: number | null;
  /** «versions» فقط در ردیف «سایر نسخه‌ها»: چند نسخه در آن جمع شده */
  distribution: { version: string; share: number; count: number; versions?: number; legacy?: boolean }[] | null;
  /** مخرج سهم‌ها: کلاینت‌های فعال ۳۰ روز اخیر + دستگاه‌های قدیمی (فقط-hbbs) */
  active_devices: number;
  /** از active_devices چند تا قدیمی‌اند */
  legacy_devices: number;
}

export type Plan = "free" | "pro";

export interface ClientRow {
  id: string;
  display: string;
  hostname: string;
  email: string;
  logged: boolean;
  plan: Plan;
  online: boolean;
  last_seen: string | null;
  os: string;
  platform: string;
  version: string;
  version_old: boolean;
  ip: string;
  mins_30d: number;
  sessions_30d: number;
  tickets_open: number;
  tickets_total: number;
  blocked: boolean;
  /** فقط از دیتابیس hbbs شناخته شده و به API گزارش نمی‌دهد (نسخهٔ قدیمی) */
  legacy: boolean;
  /** آنلاین/آفلاین بودنش معلوم است؟ دستگاه قدیمی فقط وقتی ایجنت حالت شنود دارد */
  status_known: boolean;
}

export interface ClientList {
  count: number;
  page: number;
  pages: number;
  page_size: number;
  results: ClientRow[];
  /** تعداد هر گزینهٔ فیلتر با فیلترهای دیگرِ فعلی: [نام، تعداد] */
  facets?: { platforms: [string, number][]; os: [string, number][]; versions: [string, number][] };
}

export interface ClientStats {
  total: number;
  legacy: number;
  /** وضعیت آنلاین دستگاه‌های قدیمی معلوم است (ایجنت با حالت شنود تازه گزارش می‌دهد)؟ */
  legacy_status_known: boolean;
  online_legacy: number;
  new_7d: number;
  online: number;
  active_30d: number;
  logged_share: number | null;
  avg_daily_minutes: number | null;
  sessions_30d: number;
  with_open_tickets: number;
  platforms: [string, number][];
}

export type TicketStatus = "open" | "closed";
export type Priority = "urgent" | "high" | "normal" | "low";

export interface ClientDetail {
  id: string;
  display: string;
  hostname: string;
  os_user: string;
  email: string;
  logged: boolean;
  plan: Plan;
  online: boolean;
  blocked: boolean;
  legacy: boolean;
  status_known: boolean;
  /** اولین باری که دستگاهِ مسدود گزارش داد اطلاعات سرور را از روی خودش برداشته است؛ null = هنوز گزارش نداده */
  revoked_at: string | null;
  last_seen: string | null;
  first_seen: string;
  os: string;
  platform: string;
  cpu: string;
  memory: string;
  version: string;
  version_old: boolean;
  ip: string;
  devices: number;
  mins_30d: number;
  sessions_30d: number;
  daily: number[];
  sessions: { peer: string; peer_name: string; outgoing: boolean; type: number | null; minutes: number; active: boolean; at: string }[];
  tickets: { id: number; code: string; subject: string; status: TicketStatus }[];
}

export interface ClientBrief {
  id: string;
  display: string;
  logged: boolean;
  plan: Plan;
  online: boolean;
  last_seen: string | null;
}

export interface TicketRow {
  id: number;
  code: string;
  subject: string;
  category: string;
  priority: Priority;
  status: TicketStatus;
  created_at: string;
  updated_at: string;
  /** راه تماسی که کاربر نوشته (معمولاً شماره موبایل)؛ خالی = نخواسته تماس بگیریم */
  contact: string;
  /** لاگ برنامه همراه این بازخورد فرستاده شده */
  has_log: boolean;
  /** تعداد تصویرهای پیوست (حداکثر ۳) */
  image_count: number;
  client: ClientBrief;
}

export interface TicketDetail extends TicketRow {
  diag: string;
  log: { size: number; files: string[] } | null;
  /** تصویرها از /api/tickets/{id}/images/{image.id} نمایش داده می‌شوند */
  images: { id: number; mime: string; size: number }[];
  messages: { id: number; from_client: boolean; text: string; created_at: string }[];
}

export interface TicketStats {
  open: number;
  closed: number;
  /** جدیدهایی که شماره تماس دارند؛ باید با آن‌ها تماس گرفت */
  open_with_contact: number;
  last_7d: number;
}

export interface ChangelogItem {
  type: "new" | "change" | "fix";
  text: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  items: ChangelogItem[];
}

export interface VersionInfo {
  version: string;
  changelog: ChangelogEntry[];
}

export interface RecoveryStatus {
  remaining: number;
  total: number;
}

export interface ChartPlatform {
  platform: string;
  installs: number;
  active_30d: number;
  online: number;
  new_30d: number;
  logged: number;
  on_latest: number;
  share: number;
}

export interface ChartVersion {
  version: string;
  installs: number;
  active_30d: number;
  platforms: Record<string, number>;
  platforms_active: Record<string, number>;
  share: number;
  latest: boolean;
  old: boolean;
}

export interface ChartDay {
  date: string;
  new: number;
  total: number;
  platforms: Record<string, number>;
  /** مجموع نصب‌ها تا پایان همین روز، به تفکیک پلتفرم */
  platform_totals: Record<string, number>;
}

/** پاسخ /api/clients/charts */
export interface ClientCharts {
  latest: string | null;
  totals: {
    installs: number;
    active_30d: number;
    online: number;
    new_30d: number;
    logged: number;
    /** دستگاه‌های قدیمی که فقط از سرور شناسه شناخته شده‌اند (در «installs» هم هستند) */
    legacy: number;
    /** فعال ۳۰ روز روی آخرین نسخه */
    on_latest: number;
    /** همهٔ دستگاه‌ها (حتی غیرفعال) روی آخرین نسخه */
    on_latest_all: number;
    /** سهم از همهٔ دستگاه‌ها، قدیمی‌ها هم در مخرج */
    on_latest_share: number | null;
    /** سهم فقط از فعال‌های ۳۰ روز */
    on_latest_share_active: number | null;
  };
  platforms: ChartPlatform[];
  versions: ChartVersion[];
  daily: ChartDay[];
  failures: ConnFailures;
}

/** Whose side a failed connection is on (CONN_FAILURE_GROUPS in backend/clients/models.py) */
export type FailureGroup = "server" | "user" | "peer" | "network" | "other";

export interface FailureDay {
  date: string;
  total: number;
  groups: Partial<Record<FailureGroup, number>>;
}

export interface FailureReason {
  reason: string;
  group: FailureGroup;
  count: number;
  devices: number;
  peers: number;
}

export interface FailureRow {
  at: string;
  device: string;
  device_name: string;
  peer: string;
  reason: string;
  group: FailureGroup;
  detail: string;
  type: string;
  version: string;
}

/** Failed connection attempts the apps reported, «failures» in /api/clients/charts */
export interface ConnFailures {
  days: number;
  total: number;
  last_24h: number;
  devices: number;
  /** sessions that did start in the same window (reported by the controlled side) */
  sessions: number;
  groups: Partial<Record<FailureGroup, number>>;
  reasons: FailureReason[];
  daily: FailureDay[];
  recent: FailureRow[];
}
