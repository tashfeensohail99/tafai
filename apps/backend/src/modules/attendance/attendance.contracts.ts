/**
 * Wire contracts for the Summit Attendance Cloud API (the camera-attendance
 * system) and for our own outbound employee-directory feed.
 *
 * Verified live against https://attendance-cloud-production.up.railway.app:
 *   POST /auth/login  → { token, email, role }
 *   GET  /employees   → AttendanceEmployee[]
 *   GET  /daily?date= → AttendanceDaily[]
 *   GET  /policy      → AttendancePolicy
 *   GET  /export?date_from=&date_to=&format=
 */

/** Shape of an employee row from the camera system's GET /employees. */
export interface AttendanceEmployee {
  emp_code: string;
  name: string;
  email: string; // present in the API today but blank until populated/synced
  active: boolean;
  thumbs?: number; // count of enrolled face templates
}

/** One employee's computed attendance for one day (GET /daily, /export rows). */
export interface AttendanceDaily {
  date: string; // 'YYYY-MM-DD'
  emp_code: string;
  name: string;
  first_in: string | null; // 'HH:MM'
  last_out: string | null; // 'HH:MM'
  gross_presence_min: number;
  lunch_min: number;
  personal_min: number;
  personal_over_min: number;
  unscheduled_exits: number;
  overtime_min: number;
  late_min: number;
  advisory_net_min: number;
  flags: string[] | string;
  status: string; // 'present' | 'absent' | ...
}

/**
 * A raw face-detection event from the camera (GET /events). Each crossing the
 * camera registers one event. `emp_code` is our Employee.id (UUID) when the
 * person was enrolled correctly; `similarity` is the face-match confidence
 * (0..1) — often low (~0.4–0.6) on the sub-stream, which is why the camera's
 * own /daily rollup discards them. The events bridge reads these directly.
 */
export interface AttendanceEvent {
  id: number;
  ts: string; // UTC ISO timestamp
  emp_code: string;
  name: string;
  office?: number;
  direction?: string; // 'in' | 'out'
  similarity?: number; // 0..1 face-match confidence
  has_photo?: boolean;
}

/** The camera system's attendance policy (GET /policy). */
export interface AttendancePolicy {
  work_start: string;
  work_close: string;
  lateness_grace_min: number;
  lunch_start: string;
  lunch_end: string;
  lunch_max_min: number;
  lunch_paid: boolean;
  transit_grace_min: number;
  personal_allowance_min: number;
  overtime_min_block: number;
  day_cutoff_hour: number;
  weekend_days: string;
  single_office_mode?: boolean;
}

export interface AttendanceLoginResponse {
  token: string;
  email?: string;
  role?: string;
}

/**
 * A row in OUR outbound directory feed (GET /integrations/attendance/employees)
 * that the camera system polls. `id` is the stable key the camera must store as
 * its emp_code and echo back in attendance data — that is what links the two
 * systems with zero name/email matching.
 */
export interface DirectoryEmployee {
  id: string;
  code: string | null;
  name: string;
  email: string | null;
  active: boolean;
}
