/**
 * @tashfeen/shared-types — entities/client.types.ts
 * Client entity shapes as returned by the API.
 */

import { ClientStatus } from '../enums/client.enums';
import { Gender } from '../enums/user.enums';

export interface ClientSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  nationality: string | null;
  cnic: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  targetCountry: string | null;
  serviceType: string | null;
  status: ClientStatus;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  sourceLeadId: string | null;
  branchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDetail extends ClientSummary {
  address: string | null;
  city: string | null;
  country: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  notes: string | null;
}
