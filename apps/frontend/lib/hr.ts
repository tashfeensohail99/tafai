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
  user: { email: string; phone: string | null; status: string } | null;
  department: { name: string } | null;
  branch: { name: string } | null;
  designation: { name: string } | null;
}

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
  employeeId: string;
  email: string;
  password: string;
  action: 'created' | 'reset';
  loginUpdated: boolean;
}

export const getEmailAccounts = () =>
  apiFetch<EmailAccountsResult>('/hr/email-accounts', { cache: 'no-store' });

export const provisionMailbox = (employeeId: string, setAsLogin: boolean) =>
  apiFetch<ProvisionResult>('/hr/provision-mailbox', json({ employeeId, setAsLogin }));

// Dropdown sources (list endpoints accept hr.view).
export const getDepartments = () => apiFetch<NamedRecord[]>('/departments', { cache: 'no-store' });
export const getBranches = () => apiFetch<NamedRecord[]>('/branches', { cache: 'no-store' });
export const getDesignations = () => apiFetch<NamedRecord[]>('/designations', { cache: 'no-store' });
export const getRoles = () => apiFetch<RoleRecord[]>('/roles', { cache: 'no-store' });
