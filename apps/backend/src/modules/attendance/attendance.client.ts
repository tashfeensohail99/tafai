import { Injectable, Logger } from '@nestjs/common';
import {
  AttendanceDaily,
  AttendanceEmployee,
  AttendanceEvent,
  AttendanceLoginResponse,
  AttendancePolicy,
} from './attendance.contracts';

/**
 * Read-only HTTP client for the Summit Attendance Cloud API.
 *
 * Config via env (mirrors the document-parser client pattern):
 *   ATTENDANCE_API_URL       e.g. https://attendance-cloud-production.up.railway.app
 *   ATTENDANCE_API_EMAIL     login for a dedicated READ-ONLY service account
 *   ATTENDANCE_API_PASSWORD
 *   ATTENDANCE_API_TIMEOUT_MS (default 20000)
 *
 * Auth: POST /auth/login → { token }; the token is sent as `Authorization:
 * Bearer`. We cache it in memory and transparently re-login once on a 401 (the
 * token's exact lifetime isn't published, so we don't rely on it). This client
 * only ever performs GET reads (employees / daily / export / policy) plus the
 * login POST — it never mutates the camera system.
 */
@Injectable()
export class AttendanceClient {
  private readonly log = new Logger(AttendanceClient.name);
  private readonly baseUrl = (process.env.ATTENDANCE_API_URL ?? '').replace(/\/+$/, '');
  private readonly email = process.env.ATTENDANCE_API_EMAIL ?? '';
  private readonly password = process.env.ATTENDANCE_API_PASSWORD ?? '';
  private readonly timeoutMs = parseInt(process.env.ATTENDANCE_API_TIMEOUT_MS ?? '20000', 10);

  private token: string | null = null;

  get configured(): boolean {
    return Boolean(this.baseUrl && this.email && this.password);
  }

  async getEmployees(): Promise<AttendanceEmployee[]> {
    return this.get<AttendanceEmployee[]>('/employees');
  }

  /** Daily computed attendance for a single date (YYYY-MM-DD). */
  async getDaily(date: string): Promise<AttendanceDaily[]> {
    return this.get<AttendanceDaily[]>(`/daily?date=${encodeURIComponent(date)}`);
  }

  /**
   * Raw face-detection events for a single date. We pass a high limit because a
   * busy day can produce thousands of crossings; the camera returns the newest
   * `limit` events, so this covers a full working day comfortably.
   */
  async getEvents(date: string, limit = 10000): Promise<AttendanceEvent[]> {
    return this.get<AttendanceEvent[]>(
      `/events?date=${encodeURIComponent(date)}&limit=${limit}`,
    );
  }

  /** Bulk export for a date range. `format` defaults to json. */
  async getExport(dateFrom: string, dateTo: string, format = 'json'): Promise<unknown> {
    const qs = `date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}&format=${encodeURIComponent(format)}`;
    return this.get<unknown>(`/export?${qs}`);
  }

  async getPolicy(): Promise<AttendancePolicy> {
    return this.get<AttendancePolicy>('/policy');
  }

  /** Connectivity probe — confirms login + reads the employee count. */
  async ping(): Promise<{ ok: boolean; employeeCount?: number; error?: string }> {
    if (!this.configured) return { ok: false, error: 'not configured' };
    try {
      const emps = await this.getEmployees();
      return { ok: true, employeeCount: Array.isArray(emps) ? emps.length : 0 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async login(): Promise<string> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`attendance login failed ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as AttendanceLoginResponse;
    if (!data?.token) throw new Error('attendance login: no token in response');
    this.token = data.token;
    return data.token;
  }

  private async get<T>(path: string): Promise<T> {
    if (!this.configured) {
      throw new Error('Attendance API not configured (ATTENDANCE_API_URL / EMAIL / PASSWORD)');
    }
    if (!this.token) await this.login();

    let res = await this.authedGet(path);
    if (res.status === 401) {
      // token likely expired — re-login once and retry
      this.token = null;
      await this.login();
      res = await this.authedGet(path);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`attendance GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private authedGet(path: string): Promise<Response> {
    return this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
    });
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
