export type Role = "owner" | "admin" | "viewer";

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  role_label: string;
  can_manage: boolean;
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
  assets: { platform: Platform; filename: string; size: number; sha256: string }[];
  created_at: string;
}

export interface ReleaseStats {
  latest_stable: string | null;
  latest_beta: string | null;
  downloads_30d: number;
  users_on_current: number | null;
  distribution: { version: string; share: number }[] | null;
}
