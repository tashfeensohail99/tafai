import { IsUUID } from 'class-validator';

/** Enroll one face sample for an employee from an uploaded photo (multipart:
 *  field `employeeId` + file `photo`). The 512-d embedding is computed
 *  server-side by the face-worker, so no descriptor is sent from the client. */
export class EnrollFaceImageDto {
  @IsUUID()
  employeeId!: string;
}
