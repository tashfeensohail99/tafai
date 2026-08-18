import { JrMatterStage } from '@prisma/client';

/**
 * The JR matter stage machine (§6.1). Deliberately thin — eleven stages;
 * everything procedural lives on dated fields and artifacts. This is a pure
 * module (no NestJS): the allowed-transition map and the terminal set, frozen
 * verbatim from the architecture. The per-transition GATES (§6.2) live in
 * `JudicialReviewService.changeMatterStage`, not here.
 *
 * `CLIENT_UNRESPONSIVE` bypasses the map (like Processing's CANCELLED/JUNK):
 * `markUnresponsive()` stamps `previousStage` + `unresponsiveSinceAt`;
 * `resumeFromUnresponsive()` restores it. `CLOSED` is terminal — reopening is a
 * NEW matter with `priorMatterId` set.
 */
export const JR_ALLOWED_TRANSITIONS: Partial<Record<JrMatterStage, JrMatterStage[]>> = Object.freeze({
  INTAKE:                     ['ROUTE_DETERMINED', 'CLOSED'],
  ROUTE_DETERMINED:           ['MERITS_REVIEW', 'CLOSED'],
  MERITS_REVIEW:              ['RETAINED', 'COUNSEL_DECLINED', 'CLOSED'],
  COUNSEL_DECLINED:           ['MERITS_REVIEW', 'CLOSED'],          // re-refer to firm #2
  RETAINED:                   ['FILED', 'REQUIRES_EXTENSION_REQUEST', 'CLOSED'],
  REQUIRES_EXTENSION_REQUEST: ['FILED', 'CLOSED'],
  FILED:                      ['LEAVE_GRANTED', 'REDETERMINATION', 'CLOSED'],
  LEAVE_GRANTED:              ['REDETERMINATION', 'CLOSED'],
  REDETERMINATION:            ['CLOSED'],
  CLIENT_UNRESPONSIVE:        [],   // handled by resumeFromUnresponsive(), not the map
  CLOSED:                     [],
});

export const JR_TERMINAL_STAGES = new Set<JrMatterStage>(['CLOSED']);
