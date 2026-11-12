import type { ApprovedContext, ApprovedDynamicFieldPath, ApprovedDynamicKey } from "./inventory-guard";

/**
 * Names the guard accepts without a registry row (TASK-006). Every entry needs a reason. The guard test also fails
 * when an entry no longer occurs in the scanned source, so this list cannot go stale silently.
 *
 * Adding an entry is a review decision: it must show the name is never a stored personal field. A name that is
 * persisted belongs in `inventory.ts`, not here.
 */

/** Uid-bearing names that are not stored field names, with the reason each is safe to leave unregistered. */
export const ALLOWED_UNREGISTERED_NAMES: Readonly<Record<string, string>> = {
  email:
    "Verified identity or input e-mail in code (Firebase Auth identity, sign-in and invitation forms). No collection stores " +
    "it as a plaintext field: teamInvitations keeps only the sealed address and the blind index `emailIndex` " +
    "(teams/domain/team-invitation-content-codec.ts), which is registered on I-11.",
  presenterUid:
    "Demo-team operator input (config.ts). Persisted only through the registered `uid` field of the fixture " +
    "documents. TASK-036 (W-18) refuses a presenter that has an erasure record.",
  callerUid:
    "Function parameter naming the verified caller. Stored only as a document-path segment (I-6 subtree), never as a field name.",
  viewerUid: "Read-model input parameter naming the viewer. Not a stored field name.",
  subjectUid: "Read-model input parameter naming the subject person. Not a stored field name.",
  candidateUid: "Parameter naming an invitee candidate for validation. Not a stored field name.",
  hasMemberRef: "Dependency-object key naming a membership check function. Not stored.",
  clientEmail:
    "Firebase service-account client e-mail in the demo-team credential config. A service identity, not a person's e-mail.",
  regionRef: "UI DOM reference name in a dialog component. Not stored.",
  feedbackRef: "UI DOM reference name for a feedback region. Not stored.",
  invalidEmail: "UI validation message key in an admin component. Not stored.",
  actorUid: "Function parameter naming the verified superadmin caller in the superadmin registry operations. Stored only through the registered grantedByUid/revokedByUid fields (A-16), never as a field name of its own.",
  targetUid: "Function parameter naming the superadmin registry target. Stored only as the superadmins/{uid} document id (I-16).",
  lookupAuthUserByEmail: "Dependency function that resolves an Auth account by a typed email for a grant. The email is a lookup input only and is never stored (superadmin-operations.ts).",
};

/**
 * Names allowed only as a member read (`x.name`), never as a key, quoted literal or type member. Empty: the injected
 * teams dependencies are named neutrally (TASK-006 rename), so no member-read exemption is needed.
 */
export const ALLOWED_MEMBER_ACCESS_NAMES: Readonly<Record<string, string>> = {};

/** Collection names that are not person-owned and need no registry row (none at TASK-006). */
export const ALLOWED_UNREGISTERED_COLLECTIONS: Readonly<Record<string, string>> = {
  superadminRegistry:
    "Superadmin registry control document (superadmin-registry.ts): one activeCount and a timestamp. No uid, actor or memberRef field, so there is no person-linked data to erase. Do not add an actor field without a registry row.",
  teamProjects:
    "Team-scoped delivery planning (title, dates, lifecycle, priority). Stores no uid-bearing field: TASK-003 writes no " +
    "createdBy/updatedBy/archivedBy and no memberRef, so there is no person-linked data to erase. Do not add an actor field " +
    "without a registry row.",
  teamCompetencePlans:
    "A team's competence development plan, independent of any competence area (document id is a random plan UUID): teamId, " +
    "title, an optional treeId catalog label (null for new plans), a target stage (a goal, not a rating), priority, archived " +
    "flag, embedded milestones (id, title, optional target date, status) and timestamps. " +
    "No uid-bearing field, no actor and no memberRef and no member assessment is copied in, so there is no person-linked data " +
    "to erase. Do not add an actor field without a registry row.",
};

/**
 * The exact structure of the C1 skill-profile transaction (`getDefaultSkillProfileStore` returns the object whose
 * `runTransaction` passes `{ setLevel, removeLevel, … }` to `work`). Both approved shapes bind to it, so a same-named method
 * elsewhere, in this file or another, does not receive an exception.
 */
export const SKILL_PROFILE_TRANSACTION_CONTEXT: ApprovedContext = {
  factoryFunction: "getDefaultSkillProfileStore",
  transactionMethod: "runTransaction",
  workCall: "work",
};

/**
 * Approved dynamic-key write shapes (C1 persistence model, TASK-006). Each is one exact structure, not a file or a name
 * exemption. The guard matches the whole shape (see `ApprovedDynamicKey` in inventory-guard.ts), so an unrelated dynamic
 * key in the same file, or the same shape in another file, still fails. Not a stored identity field: the key is a SkillTree
 * id, and the persisted `levels` model is unchanged by this exception.
 */
export const APPROVED_DYNAMIC_KEYS: readonly ApprovedDynamicKey[] = [
  {
    path: "src/features/skill-profiles/server/skill-profile-store.ts",
    writeCall: "set",
    receiver: "tx",
    parentProperty: "levels",
    keyIdentifier: "treeId",
    enclosingMethod: "setLevel",
    context: SKILL_PROFILE_TRANSACTION_CONTEXT,
    reason:
      "C1 persistence model: `levels` is keyed by a SkillTree id (`treeId`). The write is a merge-set of `levels.<treeId>` " +
      "only. It is approved as the C1 persistence-model exception recorded in VERIFICATION.md (TASK-006).",
  },
];

/**
 * Approved dynamic FieldPath delete (TASK-006, C1 `removeLevel`). It deletes exactly `levels.<treeId>` inside the existing
 * `removeLevel` operation. It is not a general permission for dynamic FieldPath segments under `levels`.
 */
export const APPROVED_DYNAMIC_FIELD_PATHS: readonly ApprovedDynamicFieldPath[] = [
  {
    path: "src/features/skill-profiles/server/skill-profile-store.ts",
    receiver: "tx",
    firstSegment: "levels",
    keyIdentifier: "treeId",
    enclosingMethod: "removeLevel",
    context: SKILL_PROFILE_TRANSACTION_CONTEXT,
    reason:
      "C1 persistence model: the `removeLevel` operation deletes `levels.<treeId>` (`treeId` is a SkillTree id) with " +
      "`FieldValue.delete()` inside the transaction. The approved set shape is `APPROVED_DYNAMIC_KEYS`; this is the " +
      "delete-side equivalent (TASK-006, option (i), approved 2026-10-28).",
  },
];
