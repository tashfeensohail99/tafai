import { apiFetch } from '@/lib/api-client';

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface HrEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string | null;
  isActive: boolean;
  pbxExtension: string | null;
  whatsappInboxMember: boolean;
  joiningDate: string | null;
  user: {
    email: string; phone: string | null; status: string;
    userRoles?: { role: { name: string; displayName: string } }[];
  } | null;
  department: { id: string; name: string } | null;
  branch: { id: string; name: string } | null;
  designation: { id: string; name: string } | null;
}

export interface UpdateEmployeePayload {
  firstName?: string;
  lastName?: string;
  departmentId?: string | null;
  branchId?: string | null;
  designationId?: string | null;
  phone?: string | null;
  pbxExtension?: string | null;
  whatsappInboxMember?: boolean;
  roleNames?: string[];
}

export const updateEmployee = (id: string, payload: UpdateEmployeePayload) =>
  apiFetch<{ id: string; updated: boolean }>(`/hr/employee/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

export interface OnboardPayload {
  firstName: string;
  lastName: string;
  generateBusinessEmail: boolean;
  email?: string;
  phone?: string;
  roleNames?: string[];
  departmentId?: string;
  branchId?: string;
  designationId?: string;
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
  dateOfBirth?: string;
  nationalId?: string;
  passportNumber?: string;
  nationality?: string;
  joiningDate?: string;
  whatsappInboxMember?: boolean;
  pbxExtension?: string;
}

export interface OnboardResult {
  employeeId: string;
  employeeCode: string | null;
  name: string;
  email: string;
  password: string;
  mailboxCreated: boolean;
}

export interface NamedRecord { id: string; name: string }
export interface RoleRecord { id: string; name: string; displayName: string }

export const getHrConfig = () =>
  apiFetch<{ mailConfigured: boolean }>('/hr/config', { cache: 'no-store' });

export const getHrDirectory = (search?: string) =>
  apiFetch<HrEmployee[]>(`/hr/employees${search ? `?search=${encodeURIComponent(search)}` : ''}`, {
    cache: 'no-store',
  });

export const suggestEmail = (firstName: string) =>
  apiFetch<{ email: string; localPart: string }>(
    `/hr/email-suggestion?firstName=${encodeURIComponent(firstName)}`,
    { cache: 'no-store' },
  );

export const onboardEmployee = (payload: OnboardPayload) =>
  apiFetch<OnboardResult>('/hr/onboard', json(payload));

export const offboardEmployee = (employeeId: string, deleteMailbox: boolean) =>
  apiFetch<{ employeeId: string; deactivated: boolean; mailboxDeleted: boolean }>(
    '/hr/offboard',
    json({ employeeId, deleteMailbox }),
  );

export interface EmailAccountRow {
  employeeId: string;
  name: string;
  branch: string | null;
  loginEmail: string | null;
  status: 'linked' | 'unlinked' | 'missing';
  mailbox: string | null;
  suggestion: string | null;
}
export interface EmailAccountsResult {
  domain: string;
  configured: boolean;
  counts: { linked: number; unlinked: number; missing: number };
  rows: EmailAccountRow[];
}
export interface ProvisionResult {
  employeeId: string | null;
  email: string;
  password: string | null;
  action: 'created' | 'reset' | 'linked';
  loginUpdated: boolean;
}
export interface ProvisionOpts {
  employeeId?: string;
  localPart?: string;
  setAsLogin?: boolean;
  resetPassword?: boolean;
}

export const getEmailAccounts = () =>
  apiFetch<EmailAccountsResult>('/hr/email-accounts', { cache: 'no-store' });

export const provisionMailbox = (opts: ProvisionOpts) =>
  apiFetch<ProvisionResult>('/hr/provision-mailbox', json(opts));

// Dropdown sources (list endpoints accept hr.view).
export const getDepartments = () => apiFetch<NamedRecord[]>('/departments', { cache: 'no-store' });
export const getBranches = () => apiFetch<NamedRecord[]>('/branches', { cache: 'no-store' });
export const getDesignations = () => apiFetch<NamedRecord[]>('/designations', { cache: 'no-store' });
export const getRoles = () => apiFetch<RoleRecord[]>('/roles', { cache: 'no-store' });
