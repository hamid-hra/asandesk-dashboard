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
  fail: number | null;
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

export interface Overview {
  range: RangeId;
  step_seconds: number;
  points: Point[];
  servers: ServerRow[];
  breakdown: { platform: [string, number][]; region: [string, number][] } | null;
  sessions_total: number | null;
  fail_rate: number | null;
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
  /** فیلدهای فایل update.json که اپلیکیشن می‌خواند */
  build: number;
  message: string;
  maintenance: boolean;
  enabled: boolean;
  /** چیزهایی که باعث می‌شود اپلیکیشن پیشنهاد دانلود را نشان ندهد */
  update_warnings: string[];
  assets: { platform: Platform; filename: string; size: number; sha256: string; source_url: string }[];
  created_at: string;
}

export interface ReleaseStats {
  latest_stable: string | null;
  latest_beta: string | null;
  downloads_30d: number;
  users_on_current: number | null;
  distribution: { version: string; share: number }[] | null;
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
}

export interface ClientList {
  count: number;
  results: ClientRow[];
}

export interface ClientStats {
  total: number;
  new_7d: number;
  online: number;
  active_30d: number;
  logged_share: number | null;
  avg_daily_minutes: number | null;
  sessions_30d: number;
  with_open_tickets: number;
  platforms: [string, number][];
}

export type TicketStatus = "open" | "pending" | "closed";
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
  /** لاگ برنامه همراه این بازخورد فرستاده شده */
  has_log: boolean;
  client: ClientBrief;
}

export interface TicketDetail extends TicketRow {
  diag: string;
  contact: string;
  log: { size: number; files: string[] } | null;
  messages: { id: number; from_client: boolean; author: string; text: string; created_at: string }[];
}

export interface TicketStats {
  open: number;
  pending: number;
  closed: number;
  first_response_min: number | null;
  first_response_prev_min: number | null;
  resolved_7d: number;
  resolved_fast_share: number | null;
  satisfaction: number | null;
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
