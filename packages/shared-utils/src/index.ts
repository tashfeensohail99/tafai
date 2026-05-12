/**
 * @tashfeen/shared-utils
 * Root barrel — re-exports everything from every sub-module.
 *
 * Usage:
 *   import { getStatusConfig, fmtDate, buildQueryString } from '@tashfeen/shared-utils';
 *   import { fmtDate } from '@tashfeen/shared-utils/format';
 *   import { getStatusConfig } from '@tashfeen/shared-utils/status';
 */

export * from './status';
export * from './format';
export * from './pagination';
export * from './validation';
