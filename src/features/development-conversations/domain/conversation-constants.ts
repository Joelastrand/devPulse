/**
 * D2 limits (docs/features/development-conversations/SPEC.md — "Code constants"). Code constants only:
 * never configurable by request, setting or environment variable.
 */
export const CONVERSATION_LIMIT = 100;
export const PARTICIPATION_LIMIT = 100;
/** Items per bounded list; each list reads `READ_WINDOW + 1` raw documents to detect truncation (BR-33, BR-34). */
export const READ_WINDOW = 100;
export const TITLE_MAX_CODE_POINTS = 100;
export const TITLE_MAX_BYTES = 400;
/** UTF-8 byte cap for `ownerNotes` and `participantNotes` (BR-39). */
export const NOTE_MAX_BYTES = 4096;
export const NEXT_STEPS_MAX_ITEMS = 10;
export const NEXT_STEP_MAX_CODE_POINTS = 200;
export const NEXT_STEP_MAX_BYTES = 800;
export const SHARED_GOALS_MAX = 5;
/** Streamed request-body cap for every conversation route (BR-40). Enforced by the route layer in TASK-023. */
export const CONVERSATION_BODY_MAX_BYTES = 32768;
