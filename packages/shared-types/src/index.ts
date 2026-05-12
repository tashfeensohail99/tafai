/**
 * @tashfeen/shared-types
 * Root barrel — re-exports everything from every sub-module.
 *
 * Usage:
 *   import { LeadStatus, LeadSummary, PaginatedResponse } from '@tashfeen/shared-types';
 *   import { PortalCaseSummary } from '@tashfeen/shared-types/portal';
 *   import { LeadStatus } from '@tashfeen/shared-types/enums';
 */

export * from './enums';
export * from './entities';
export * from './portal';
export * from './api';
