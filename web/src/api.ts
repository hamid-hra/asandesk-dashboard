// تماس با backend داشبورد (/api/web/...)؛ ورود با کوکی HttpOnly که خود سرور می‌گذارد
export interface WebConfig {
  key: string;
  id_ws: string;
  relay_ws: string;
  relay_ws_map: Record<string, string>;
  gw_ws: string;
  rendezvous_host: string;
  download_url: string;
}

export interface Me {
  first_name: string;
  last_name: string;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  web_id: string;
  created_at: string;
}

export interface Device {
  peer_id: string;
  name: string;
  platform: string;
  favorite: boolean;
  last_connected_at: string;
}

export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  code: string;

  constructor(message: string, status: number, fields: Record<string, string> = {}, code = '') {
    super(message);
    this.status = status;
    this.fields = fields;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/web/${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'X-Asan-Web': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* بدنهٔ غیر JSON (مثلا صفحهٔ خطای nginx) */
  }
  if (!res.ok) {
    throw new ApiError(
      typeof data.error === 'string' ? data.error : `HTTP ${res.status}`,
      res.status,
      (data.fields as Record<string, string>) || {},
      typeof data.code === 'string' ? data.code : '',
    );
  }
  return data as T;
}

export const api = {
  config: () => call<WebConfig>('GET', 'config'),
  me: () => call<{ user: Me }>('GET', 'me').then((r) => r.user),
  login: (identifier: string, password: string, remember: boolean) =>
    call<{ user: Me }>('POST', 'auth/login', { identifier, password, remember }).then((r) => r.user),
  register: (data: Record<string, string>) => call<{ user: Me }>('POST', 'auth/register', data).then((r) => r.user),
  logout: () => call<object>('POST', 'auth/logout'),
  changePassword: (current: string, next: string) => call<object>('POST', 'me/password', { current, new: next }),
  peerKey: () => call<{ web_id: string; seed: string; pk: string }>('GET', 'me/peer-key'),
  devices: () => call<{ devices: Device[] }>('GET', 'devices').then((r) => r.devices),
  touchDevice: (peer_id: string, name = '', platform = '') =>
    call<{ device: Device }>('POST', 'devices', { peer_id, name, platform }).then((r) => r.device),
  updateDevice: (peer_id: string, patch: Partial<Pick<Device, 'favorite' | 'name'>>) =>
    call<{ device: Device }>('PATCH', `devices/${encodeURIComponent(peer_id)}`, patch).then((r) => r.device),
  removeDevice: (peer_id: string) => call<object>('DELETE', `devices/${encodeURIComponent(peer_id)}`),
  connectionStart: (direction: 'in' | 'out', peer_id: string, peer_name: string) =>
    call<{ id: number }>('POST', 'connections', { direction, peer_id, peer_name }).then((r) => r.id),
  connectionEnd: (id: number) => call<object>('POST', `connections/${id}/end`),
};
