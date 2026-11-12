# DevPulse — Data Model (Firestore, current implementation)

Source of truth: the repository code (`src/features/*/domain`, `src/features/*/server`), `firestore.rules`,
`firestore.indexes.json` and the erasure inventory `src/features/account-erasure/server/inventory.ts`. All collections are
accessed by the Admin SDK on the server. Client SDK access is denied for every collection (`firestore.rules`).

Notation: `{x}__{y}` is a deterministic composite document ID. "auto" means a Firestore auto-generated ID or a server-issued
UUID.

## 1. Identity, teams and membership

| Collection / path | Document ID | Owner feature | Key fields | Notes |
| --- | --- | --- | --- | --- |
| `userProfiles` | `{uid}` | profiles | `displayName` is sealed (`content`, see section 11). `createdAt`, `updatedAt` plaintext | Presentation only; no e-mail. Erased with the account |
| `teams` | `{teamId}` | teams | `name` is sealed (`content`, see section 11). `status` (`active` / disabled), `visibility` (`private` / `public`), `createdBy` plaintext (listing, authorization) | Team metadata. Visibility defaults to `private` |
| `teamMemberships` | `{uid}__{teamId}` | teams | `uid`, `teamId`, `createdAt`, `createdVia` (`invitation` / `access_request` / `admin_direct`), `grantedBy`, `memberRef`, `role` (`teamadmin`; absent = member), `roleUpdatedAt`, `roleUpdatedBy`, `skillContribution` (optional consent object) | A membership is the only team authorization evidence. `role` is written only by a superadmin |
| `teamInvitations` | `{teamId}__{emailIndex}` (HMAC blind index of the normalized e-mail) | teams | `teamId`, `emailIndex`, `invitedBy`, `resolvedUid`, `status`, timestamps plaintext; the e-mail is sealed (`content`) | Resolved server-side into a membership. No plaintext e-mail is stored |
| `teamAccessRequests` | `{uid}__{teamId}` | teams | `uid`, `teamId`, `resolvedBy` | Non-member request to join. Approve creates a membership; reject creates none |
| `superadmins` | `{uid}` | superadmins | `uid`, `active`, `grantedByUid`, `revokedByUid` | Authority for global administration. Revoked records are kept with `active: false` |
| `superadminRegistry` | `control` (fixed) | superadmins | `activeCount` | Serialization point for grant and revoke |
| `accountErasures` | `{uid}` | account-erasure | status, step, timestamps | Erasure fence. No personal content |

## 2. Team competence

| Collection / path | Document ID | Owner feature | Key fields | Notes |
| --- | --- | --- | --- | --- |
| `teamSkills` | auto-generated on create (`doc().id`), then fixed | team-owned-skills | name, criteria (four levels), `active`, `createdBy`, `updatedBy` | Canonical team competence catalog. Admin-managed |
| `teamSkillAssessments` | `{uid}__{skillId}` | team-owned-skills | `uid`, `skillId`, four-level rating, criteria version, timestamps | **Private** self-assessment. Never readable by team admins |
| `teamManualAssessments` | `{teamId}__{skillId}` | team-owned-skills | team-level agreed level, `updatedBy` | Collaborative level. Team-level value only |
| `teamSkillNeeds` | `{teamId}__{treeId}` | team-skills | `requiredLevel`, `requiredCoverage` are sealed (`content`). `teamId`, `treeId`, timestamps plaintext | Team requirement per skill-tree. No actor data |
| `teamCompetencePlans` | auto UUID | team-competence-plan | `teamId`, `title`, `treeId` (optional label, `null` on creation), `targetStage`, `priority`, `archived`, `milestones[]`, timestamps | Independent of any competence area. No uid, no rating. Writes by superadmin or `teamadmin` |

Consent is not a separate collection. It is the `skillContribution` field on `teamMemberships/{uid}__{teamId}`
(`SKILL_CONTRIBUTION_FIELD`). `version` must equal `SKILL_CONTRIBUTION_NOTICE_VERSION` (2) to be effective.

## 3. Skill trees, progress and roadmap

| Collection / path | Document ID | Owner feature | Key fields | Notes |
| --- | --- | --- | --- | --- |
| `skillTrees` | `{treeId}` | skill-trees | `name` and node `label`s are sealed (`content`). Node `nodeId` and `order`, `createdBy`, `updatedBy` plaintext | Org-wide capability progressions. Used by personal skills, `/admin/skills` and roadmap references |
| `skillProgress` | `{teamId}__{treeId}` | skill-trees | `currentNodeId` is sealed (`content`). `teamId`, `treeId`, `updatedAt`, `updatedBy` plaintext | One team's progress on one tree |
| `roadmapItems` | `{teamId}__{treeId}` | roadmap | `targetNodeId`, `priority`, `status`, dates, `completedAt` and `ownerRef` are sealed (`content`). `ownerRefIndex` (keyed index), `teamId`, `treeId`, audit and archive fields plaintext | One plan per team and competency area. The ID is a uniqueness key, not authorization |
| `teamProjects` | auto | team-projects | project name, lifecycle (`planned` / `completed`), archive fields | Team delivery projects |
| `teamProjectParticipations` | auto | team-projects | `teamId`, `projectId`, `memberRef`, planned interval | Planned member-to-project intervals. Referenced by `memberRef`, not uid |
| `teamSystems` | `{systemId}` | team-systems | `teamId`, `name`, `description`, `backstageUrl`, seven attributes (`availability`, `deployability`, `maintainability`, `observability`, `reliability`, `security`, `testability`), each `{value, note, assessedAt, assessedBy}`, `knowledgeMemberRefs[]` | Attributes default to `ikke_vurdert`. `assessedBy` is stored for audit and never returned to clients |

## 4. Surveys and anonymous feedback

| Collection / path | Document ID | Owner feature | Key fields | Notes |
| --- | --- | --- | --- | --- |
| `surveys` | auto or `{surveyId}` | surveys | `title`, `description`, `questions` are sealed (`content`). `teamId`, `accessMode`, `minimumResponses` (mandatory), lifecycle timestamps, `createdBy` plaintext | Per-survey result threshold |
| `teamSurveyState` | `{teamId}` | surveys | open-survey marker | Enforces at most one genuinely open survey per team. Written only in transactions |
| `surveyResponses` | auto | surveys | `surveyId`, `teamId`, `ciphertext`, `iv`, `authTag`, `keyVersion`, `keyId`, `submittedAt` | **No identity field in either access mode.** Encrypted answers |
| `surveyParticipations` | `{uid}__{surveyId}` | surveys | `uid`, `surveyId` | Only for `authenticated` mode. Minimal by design: no timestamp, not joined to a response |
| `challenges` | auto | challenges | `teamId`, `ciphertext`, `iv`, `authTag`, `keyVersion`, `keyId`, `submittedAt`, admin-only `resolvedAt`/`resolvedBy`/`archivedAt`/`archivedBy` | Anonymous, encrypted free text. No submitter identity |
| `forumThreads` | auto | forum | `teamId`, `authorUid`, `ciphertext`, `iv`, `authTag`, `keyVersion`, `keyId`, `createdAt` | Attributed, encrypted. Deleted as a real document |
| `forumReplies` | auto | forum | `teamId`, `threadId`, `authorUid`, encrypted body, `createdAt`; tombstone `deletedAt`, `deletedBy` | A single deleted reply leaves a content-free tombstone to keep its position |

## 5. Personal development (owner-only)

All personal records live under `userDevelopment/{uid}/...`. No parent document is needed. Only the owner's
server-side operations write them. Client access is denied for all paths.

| Path | Owner feature | Notes |
| --- | --- | --- |
| `skillProfiles/{uid}` | skill-profiles | Personal skill self-assessment (levels per skill). Not encrypted |
| `userDevelopment/{uid}/goals/{goalId}` | personal-goals | Lifecycle plaintext (`status`, `createdAt`, `updatedAt`, `completedAt`). Business content (title, `treeId`, `targetDate`) is inside the v2 `content` envelope, bound to `goal:<uid>:<goalId>` |
| `userDevelopment/{uid}/responsibilities/{id}` | personal-role-workspace | `title`, `description`, `outcome` encrypted |
| `userDevelopment/{uid}/achievements/{id}` | personal-role-workspace | Same encryption model as responsibilities |
| `userDevelopment/{uid}/conversations/{conversationId}` | development-conversations | Owner conversation (ID generated by the store); named free text encrypted |
| `userDevelopment/{uid}/conversationParticipations/{conversationId}` | development-conversations | Participant-side index of conversations the person participates in (`PARTICIPATION_INDEX_SUBCOLLECTION`) |

Other personal collections:

| Collection / path | Document ID | Owner feature | Notes |
| --- | --- | --- | --- |
| `roleDefinitions` | auto | role-profiles | `name` and `description` are sealed (`content`). Archive and audit fields plaintext | Organizational roles. No skill data; grants no application permission |
| `roleAssignments` | `{uid}` | role-profiles | One formal role per person. Grants no application permission |

Development conversations are keyed by the owner. Participation is an index under the participant and is never a team
collection. The conversation-level eligibility check uses `teamMemberships`.

## 6. Relationships

- Membership links an account to a team. Every team read or write joins through `teamMemberships/{uid}__{teamId}`.
- A `memberRef` is a team-scoped, opaque handle to a membership. Roadmap owners, project participations, system knowledge
  references and conversation participant views refer to people through `memberRef`. A `memberRef` never authorizes access.
- `teamSkillAssessments` (private) feed the consent-gated aggregate in `team-owned-skills`. Only the aggregate and the
  collaborative level leave the server.
- `skillTrees` are referenced by `skillProgress`, `roadmapItems`, `teamSkillNeeds` and personal skills.
- Anonymous collections (`surveyResponses`, `challenges`) have no relation to any person. `surveyParticipations` holds
  identity only for duplicate prevention.

## 7. Validation

- Every stored document is re-validated when read (`parseStored…`, `isValid…For`). A malformed document is treated as absent
  or refused, never repaired or echoed. Examples: `teamMemberships` must match its own uid and team
  (`isValidMembershipFor`), a competence plan id must be a UUID (`isWellFormedPlanId`).
- Document IDs are checked against their own content. A mismatched `teamId` or `uid` makes a document ignored.

## 8. Indexes

`firestore.indexes.json` defines the composite indexes the queries require. Review it with any query change. It has no
client-facing role.

## 9. Retention and deletion

- No automatic retention job exists in the repository. Data stays until deleted by a user, an admin action or an erasure.
- **Account erasure** (`src/features/account-erasure/server/inventory.ts`): each uid-bearing row is DELETE, ANONYMIZE,
  DETACH, PRESERVE (anonymous or other-person content), TRANSIENT (`accountErasures`) or DISCOVERY (for example
  `conversations` collection-group discovery). The inventory guard test rejects unlisted paths.
- Operational erasure is held (see [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md)).

## 10. Scripts that write data

- `scripts/seed-demoteam-conversations.ts`: synthetic owner conversations for the `demo-team` team. Hardcoded to the
  legacy project id and requires it explicitly; it is not a general-purpose seeder. Writes only with `--write` and `--confirm`.
- `scripts/bootstrap-superadmin.ts`: one-time owner bootstrap (see `docs/operations/superadmin-bootstrap.md`).
- Retired (removed from the repository): the legacy demo seed `seed-demoteam.mjs` (superseded by `pnpm seed:demo-team`),
  the one-off migration `migrate-competence-plans-independent.mjs`, the one-off cleanup `cleanup-role-expectations.mjs`,
  and `reset-disposable-app-data.mjs` (destructive; it targeted the retired project only). Their history stays in git.

## 11. Encryption coverage matrix (current implementation)

This matrix lists every active collection that stores company business content, what is encrypted in it, what stays
plaintext and why, the envelope version and the AAD context, and the tests that cover the persisted shape. It replaces the
earlier partial matrix. It is **not** a claim of universal encryption: section 11.2 lists every remaining plaintext exception
and gap.

**Envelope legend:**
- `v2 content` = one envelope in the document field `content`, holding the sealed business fields as JSON. Implemented in
  `src/lib/encryption/record-envelope.ts` with an HKDF-derived AES-256-GCM subkey and the context as additional authenticated
  data (AAD).
- `v2 top-level` = the envelope fields (`ciphertext`, `iv`, `authTag`, `keyVersion`, `keyId`) stored directly on the document,
  one envelope per sealed value.
- Blind indexes use `src/lib/encryption/blind-index.ts` (HKDF-derived HMAC-SHA-256, one key per purpose).

### 11.1 Converted collections

| Collection / path | Encrypted fields | Plaintext metadata (reason) | Envelope | AAD context | Storage-boundary and binding tests |
| --- | --- | --- | --- | --- | --- |
| `teams/{teamId}` | `name` | `status`, `visibility`, `createdBy`, `createdAt`, `visibilityUpdatedAt` (authorization, listing, lifecycle) | v2 `content` | `team:<teamId>` | `teams/domain/team-content-codec.test.ts`, `teams/server/get-public-team.test.ts`, `get-teams-overview.test.ts`, `create-team.test.ts` |
| `teamInvitations/{teamId}__{emailIndex}` | `email` (normalized, in `content`) | `teamId` (scope), `emailIndex` (keyed blind index, the only searchable value), `status`, `invitedBy`, `resolvedUid`, timestamps | v2 `content` | `team-invitation:<teamId>:<emailIndex>` | `teams/domain/team-invitation-content-codec.test.ts` (no plaintext email, index, tamper, substitution, missing key, malformed index); `create-invitation.test.ts`, `cancel-invitation.test.ts`, `resolve-invitations.test.ts`, `list-team-invitations.test.ts`; erasure: `invitations-erasure.test.ts`, `invitation-match.test.ts`, `erasure-adapters-team.test.ts` |
| `skillTrees/{treeId}` | `name`, node `label`s (in `content`) | node `nodeId` and `order` (hierarchy, referenced by progress, roadmap and needs), `createdBy`, `updatedBy`, timestamps | v2 `content` | `skill-tree:<treeId>` | `skill-trees/domain/skill-tree-content-codec.test.ts`; `update-skill-tree.test.ts`, `create-skill-tree.test.ts`, `list-skill-trees.test.ts` |
| `skillProgress/{teamId}__{treeId}` | `currentNodeId` (in `content`, nullable) | `teamId`, `treeId` (team listing and document identity), `updatedAt`, `updatedBy` (accountability; nulled by account erasure A-6) | v2 `content` | `skill-progress:<teamId>:<treeId>` | `skill-trees/server/skill-progress-content-codec.test.ts`; `report-team-skill-progress.test.ts`, `update-team-skill-progress.test.ts`, `start-team-skill-tracking.test.ts`, `team-skill-tracking-lifecycle.test.ts`, `progress-writer-fence.test.ts`, `team-skill-progress-br35-regression.test.ts` |
| `roadmapItems/{teamId}__{treeId}` | `targetNodeId`, `priority`, `status`, `startDate`, `targetDate`, `completedAt`, `ownerRef` (in `content`) | `teamId`, `treeId`; `createdAt`, `updatedAt`, `archivedAt` (timestamps); `createdBy`, `updatedBy`, `archivedBy` (accountability and the erasure sweeps that match these uids); `ownerRefIndex` (keyed index of the owner handle, see 11.2) | v2 `content` | `roadmap-item:<teamId>:<treeId>`; owner index purpose `roadmap-owner-ref` | `roadmap/domain/roadmap-item-content-codec.test.ts` (no plaintext target, priority, status, dates or owner; owner index; detach re-seals; tamper, substitution, missing key); roadmap server suites; erasure: `erasure-adapters-team.test.ts`, `erasure-adapters-sweep.test.ts`, `erasure-end-to-end.test.ts` |
| `teamSkillNeeds/{teamId}__{treeId}` | `requiredLevel`, `requiredCoverage` (in `content`) | `teamId`, `treeId` (team listing and identity), `createdAt`, `updatedAt` | v2 `content` | `team-skill-need:<teamId>:<treeId>` | `team-skills/server/skill-need-content-codec.test.ts`; `skill-needs-write-store.test.ts` (no plaintext values in the persisted payload), `skill-needs-store.test.ts`, `list-skill-needs.test.ts` |
| `surveys/{surveyId}` | `title`, `description`, `questions` (in `content`) | `teamId`, `accessMode`, `minimumResponses` (threshold), `questionSetVersion`, lifecycle timestamps (`openedAt`, `closedAt`, `archivedAt`), `createdAt`, `createdBy` | v2 `content` | `survey:<teamId>:<surveyId>` | `surveys/server/survey-content-codec.test.ts` (no plaintext, tamper, substitution, missing key, plaintext refusal); `create-survey.test.ts`, `update-survey-draft` via `survey-builder.test.ts`, `open-survey.test.ts`, `close-survey.test.ts`, `list-team-surveys.test.ts`, `get-current-team-survey.test.ts`, `admin-stamp-fence.test.ts`, demo `preflight.test.ts` |
| `surveyResponses/{id}` | answers (one `v2 top-level` envelope) | `surveyId`, `teamId`, `submittedAt`; no identity field in either access mode | v2 top-level | `survey-response:<teamId>:<surveyId>:<id>` (see `surveys/domain/response-context.ts`) | `forum/domain/forum-content-storage.test.ts` (survey response binding: moved-response and tamper refusal, missing key); `submit-survey-response.test.ts`, `get-team-survey-results.test.ts`, `aggregation.test.ts` |
| `challenges/{id}` | free text (one `v2 top-level` envelope) | `teamId`, timestamps, admin-only `resolvedAt`/`resolvedBy`/`archivedAt`/`archivedBy` (no submitter identity) | v2 top-level | `challenge:<teamId>:<id>` | `submit-challenge.test.ts`, `list-team-challenges.test.ts` (AAD substitution), `challenge.test.ts` |
| `forumThreads/{id}` | `title`, `body` (one `v2 top-level` envelope) | `teamId`, `authorUid`, timestamps | v2 top-level | `forum-thread:<teamId>:<id>` | `forum/domain/forum-content-storage.test.ts` (no plaintext, moved-thread and tamper refusal, missing key); `create-thread.test.ts`, `get-thread-with-replies.test.ts`, `list-team-threads.test.ts` |
| `forumReplies/{id}` | reply body (one `v2 top-level` envelope) | `teamId`, `threadId`, `authorUid`, `createdAt`; tombstone `deletedAt`, `deletedBy` | v2 top-level | `forum-reply:<teamId>:<threadId>:<id>` | `forum/domain/forum-content-storage.test.ts` (moved-reply refusal); `create-reply.test.ts`, `delete-reply.test.ts` |
| `roleDefinitions/{id}` | `name`, `description` (in `content`) | `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `archivedAt`, `archivedBy` (lifecycle and accountability; a formal role grants no permission) | v2 `content` | `role:<roleId>` | `role-profiles/domain/role-content-codec.test.ts`; `role-profiles/server/role-store.storage.test.ts` (transactional read-modify-reseal, lifecycle-only change leaves the content untouched, refusal when the content cannot be opened, substitution, missing key) |
| `userProfiles/{uid}` | `displayName` (in `content`) | `createdAt`, `updatedAt` | v2 `content` | `user-profile:<uid>` | `profiles/domain/user-profile-content-codec.test.ts`; `profiles/server/get-display-names.test.ts`, `teams/server/list-team-roster.test.ts` |
| `teamSkillAssessments/{uid}__{skillId}` | `level` | `uid`, `teamId`, `skillId`, `criteriaVersion`, timestamps | v2 `content`-style envelope per value | `team-skill-assessment:<uid>:<teamId>:<skillId>` | `team-owned-skills/server/assessment-level-codec.test.ts`, `team-skill-store.storage.test.ts` |
| `teamManualAssessments/{teamId}__{skillId}` | `level`, `note` (separate envelopes) | `teamId`, `skillId`, `criteriaVersion`, `updatedAt`, `updatedBy` | v2 | `team-manual-assessment:{level,note}:<teamId>:<skillId>` | `manual-assessment-codec.test.ts`, `team-skill-store.storage.test.ts` |
| `teamSkills/{skillId}` | `content` (name, description, category, guidance) | `teamId`, `criteriaVersion`, `active`, `sortOrder`, timestamps, actor ids | v2 `content` | `team-skill:<teamId>:<skillId>` | `team-skill-store.storage.test.ts` |
| `teamCompetencePlans/{planId}` | `content` (title, milestones) | `teamId`, `treeId` (organisational label), `targetStage`, `priority`, `archived`, timestamps | v2 `content` | `competence-plan:<teamId>:<planId>` | `competence-plan-codec.test.ts` |
| `teamProjects/{projectId}` | `title` (in `content`) | `teamId`, dates, lifecycle, priority, archive fields | v2 `content` | `team-project:<teamId>:<projectId>` | `team-project-codec.test.ts` |
| `teamProjectParticipations/{id}` | `note` | `teamId`, `projectId`, `memberRef`, dates, `archived` | v2 | `team-project-participation:<teamId>:<id>` | `team-project-codec.test.ts` |
| `teamSystems/{systemId}` | `content` (name, description); each attribute `note` | `teamId`, attribute `value`, `assessedAt`, `assessedBy` (never returned), `backstageUrl`, `knowledgeMemberRefs` | v2 | `team-system:<teamId>:<systemId>`; `team-system-note:<teamId>:<systemId>:<attribute>` | `team-system-codec.test.ts` |
| `skillProfiles/{uid}` | each `levels.<treeId>` | tree-id map keys, `createdAt`, `updatedAt` | v2 | `skill-profile:<uid>:<treeId>` | `skill-level-codec.test.ts`, `collection-independence.test.ts`, `skill-profile-batch-read.test.ts` |
| `userDevelopment/{uid}/goals/{goalId}` | `content` (title, treeId, targetDate) | lifecycle (`status`, timestamps) | v2 `content` | `goal:<uid>:<goalId>` | `goal-store.test.ts`, personal-goals suites |
| `userDevelopment/{uid}/responsibilities`, `achievements` | title, description, outcome | ids, timestamps | v2 `content` + `keyCheck` | `personal-record:<ownerUid>:<collection>:<id>` | `source-record-codec.test.ts`, `record-operations.test.ts`, `owned-evidence-source.test.ts` |
| `userDevelopment/{uid}/conversations/*` | named free text | owner, participation, timestamps | v2 `content` + `keyCheck` | `dev-conversation:<ownerUid>:<id>` | `content-codec.test.ts`, `stored-owner-conversation.test.ts`, `conversation-store*.test.ts` |

### 11.2 Remaining plaintext and gaps

Each entry is a deliberate plaintext field, or a known gap. Nothing here is unreviewed.

**Plaintext exceptions (required metadata):**

- Identifiers and document keys (`teamId`, `treeId`, `surveyId`, `uid`, `memberRef`, `treeId` in competence plans). They are the query keys of the listings and the identity the document ids are built from. They are opaque handles, not content.
- Authorization metadata: `teamMemberships` (`uid`, `teamId`, `role`, `createdVia`, `grantedBy`, the `skillContribution` consent object), `superadmins`, `accountErasures`, `teams.status` and `teams.visibility`. Access decisions read them, so they cannot be sealed without changing authorization.
- Accountability and erasure metadata: `createdBy`, `updatedBy`, `archivedBy`, `resolvedBy`, `invitedBy`, `resolvedUid`. The erasure sweeps match these uids; the content they describe is sealed where it is business content.
- Lifecycle and audit timestamps throughout.
- Threshold and access mode of a survey (`minimumResponses`, `accessMode`): enforced on every read before aggregation, and never derived from content.
- Lookup indexes, which are keyed blind indexes and not plaintext: `teamInvitations.emailIndex` (purpose `team-invitation-email`) and `roadmapItems.ownerRefIndex` (purpose `roadmap-owner-ref`, scoped to the team). They make lookup possible without storing the address or the owner handle.
- `surveyParticipations/{uid}__{surveyId}` (identity for duplicate prevention in authenticated mode, minimal by design) and `surveyResponses` without identity fields (answers are sealed).
- `roleAssignments/{uid}`: one formal role reference per person. It grants no application permission. Business content of the role itself is sealed in `roleDefinitions`.

**Known gaps (not yet satisfied):**

- Invitation expiration is not implemented in the codebase, so there is no expiration behaviour to test. See `KNOWN-LIMITATIONS.md`.
- The erasure sweeps and the account-erasure inventory still name the sweep keys `roadmapItems|perMembership|ownerRef` and `teamInvitations|docIdEndsWith|normalizedEmail`. These are sweep identifiers; the stored values they match are the keyed indexes described above.
- The roadmap owner detach (A-5) and the membership erasure write a full re-sealed plan. A plan whose content cannot be opened makes the erasure step fail closed rather than skipping it.
- Browser verification of the product flows is not covered by these tests (see `TESTING.md`).
