/**
 * @tashfeen/shared-types — entities/user.types.ts
 * User, Employee, Partner, Role, Permission entity shapes as returned by the API.
 */

import { UserStatus, Gender } from '../enums/user.enums';
import { AttendanceStatus, PartnerStatus, PresenceStatus } from '../enums/misc.enums';

export interface UserSummary {
  id: string;
  email: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: string[];
  permissions: string[];
  createdAt: string;
}

export interface EmployeeSummary {
  id: string;
  userId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  gender: Gender | null;
  nationality: string | null;
  designation: string | null;
  departmentId: string | null;
  departmentName: string | null;
  branchId: string | null;
  branchName: string | null;
  isActive: boolean;
  joiningDate: string | null;
  presenceStatus: PresenceStatus;
  createdAt: string;
}

export interface PartnerSummary {
  id: string;
  name: string;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  status: PartnerStatus;
  commissionPercent: number | null;
  createdAt: string;
}

export interface RoleSummary {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionSummary[];
  createdAt: string;
}

export interface PermissionSummary {
  id: string;
  key: string;
  module: string;
  description: string | null;
}

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: AttendanceStatus;
  overriddenByUserId: string | null;
  notes: string | null;
}
