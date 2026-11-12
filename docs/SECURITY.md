# DevPulse — Security and Privacy (current implementation)

Status: rewritten 2026-11-11 from the code. The previous invariant-by-invariant text is archived verbatim at
[`docs/archive/SECURITY-2026-11-11.md`](archive/SECURITY-2026-11-11.md). Invariant numbers are kept where the code cites
them (`SECURITY.md invariant 34`, `SI-…`, `AE-SI-…`, `RP-SI-…`, `PR-SI-…`).

Verification scope: each control below was checked against the code, rules and tests named next to it during the
2026-11-11 audit. Items marked **unverified** are carried forward from the archive and were not re-traced in this pass.

## 1. Authentication

- Sign-in and sign-up use the Firebase Auth client SDK (`src/features/auth/`). Email verification is required for
  app-admin status and for starting an account erasure.
- Every protected API call sends `Authorization: Bearer <Firebase ID token>`. The server verifies it in
  `src/features/auth/server/verify-identity.ts` with `checkRevoked: true`, so a revoked session is refused.
- Verification fails closed: a missing or invalid token is `invalid_token` (401). An unreachable Auth or erasure-fence read
  is `auth_unavailable` (503). Neither is ever treated as a valid identity.
- The identity used for authorization is the verified token's `uid` and `email_verified`. Client-supplied uids, emails and
  role flags are never trusted.

## 2. Authorization model

Three separate concepts. They must not be conflated.

| Concept | Where it lives | What it grants |
| --- | --- | --- |
| **Superadmin** (app admin) | `superadmins/{uid}`; control document `superadminRegistry/control` | Global administration: admin pages, team creation, the superadmin registry, and team-admin rights on every team |
| **Team role** | `teamMemberships/{uid}__{teamId}.role` (`"teamadmin"`; absent means member) | Administration of that one team. Written only by a superadmin |
| **Formal organizational role** | `roleDefinitions`, `roleAssignments/{uid}` | Nothing. Reference and profile data only (RP-SI-4) |

- **Superadmin status** is read from the Admin SDK on every privileged request (`readSuperadminActive`). It is never cached,
  never taken from a token claim, cookie, client flag or email. A registry read error fails closed.
  `APP_ADMIN_EMAILS` is no longer read (`src/features/teams/domain/app-admin.ts`).
- **Registry integrity:** every grant and revoke reads and writes `superadminRegistry/control` (`activeCount`) in the same
  transaction, so concurrent requests cannot revoke the last active superadmin
  (`src/features/superadmins/domain/superadmin-registry.ts`). The owner is bootstrapped by hand only
  (`docs/operations/superadmin-bootstrap.md`).
- **Team membership** is required for team data reads. The gate is `requireGenuineMemberWith`
  (`src/features/teams/domain/genuine-membership.ts`): the team must exist and be active, and the membership document must
  match the exact `(uid, teamId)` pair. A malformed membership document counts as no membership.
- **Team administration** = superadmin, or a genuine `teamadmin` of an active team (`team-authority.ts`,
  `canAdministerTeam`). A legacy `role: "lead"` grants nothing.
- **Route handlers are thin.** Authorization decisions live in the feature's server operation, not in the route file.
  (A repository-wide automated guard for this is **unverified**.)

## 3. Data access boundary

- **All Firestore access is server-side through the Firebase Admin SDK** (`src/lib/firebase/`). The client SDK is used only
  for Auth.
- `firestore.rules` denies every collection to client SDK reads and writes, including for superadmins. The explicit deny
  blocks are defence in depth; a catch-all `match /{document=**}` denies everything else.
- Consequence: a client sees only what an API route returns. Route DTOs are explicit allow-lists. For example,
  `team-systems` builds each `AssessmentView` field by field and never returns `assessedBy`
  (`src/features/team-systems/server/list-team-systems.ts`).

## 4. Team competence privacy (unified team competence)

Source of truth: `src/features/team-skills/domain/skill-coverage-policy.ts` and `src/features/team-owned-skills/`.

- **Individual self-assessments** (`teamSkillAssessments/{uid}__{skillId}`) are private to the person. No team
  administrator, lead or superadmin reads them through any client path. No admin reader exists in
  `team-owned-skills/server/`.
- **Voluntary sharing (consent).** A member opts in per team by writing a `skillContribution` field on their own
  `teamMemberships` document (`SKILL_CONTRIBUTION_FIELD`). A valid object means opt-in. No persisted `false` exists.
  Consent counts only when its version equals `SKILL_CONTRIBUTION_NOTICE_VERSION` = **2**. Version 1 (threshold 5) has
  lapsed, so members must re-consent.
- **Threshold k = 3.** `SKILL_COVERAGE_MIN_CONTRIBUTORS = 3` is a fixed constant, not configurable. It applies to the
  automatic team-owned aggregate and the categorical coverage view. The historical k = 5 is not current policy.
- **Automatic aggregate** (`get-team-owned-skill-aggregate.ts`): reads opted-in members, reads each contributor's rating for
  the active skills, and suppresses a skill when any rating is suspect or fewer than k contributors exist. It returns only
  a level 1–4 or `insufficient_data`. No count, uid or per-person value is returned. Exceeding the read budget or the
  membership-scan bound yields `incomplete` with no rows.
- **Collaborative (agreed) level** is stored once per skill in `teamManualAssessments/{teamId}__{skillId}`. A team
  administrator writes it and members read it. It is a team-level value, not a person's data.
- **Categorical coverage view (`/api/teams/[teamId]/skill-coverage`, `src/features/team-skills/`):** the threshold, consent,
  membership and suppression controls are enforced. The residual differencing risks A1–A4 are **accepted residual risk**
  under the product owner's final decision (see §12). They are not fixed, and this view must not be described as protected
  against inference over time.
- **Retired:** the `teamCompetenceAreas` system, numeric skill-level routes and the old collaborative profile APIs are not
  active. Its only remaining reference was a deletion entry in the since-retired `scripts/reset-disposable-app-data.mjs`.

## 5. Survey and challenge privacy

- **Surveys** (`surveys/{surveyId}`) carry a mandatory per-survey `minimumResponses`, validated and fixed at creation. No
  global threshold exists.
- **Survey responses** (`surveyResponses`) are AES-256-GCM encrypted on the server and contain no identity field in either
  access mode. Results below `minimumResponses` return no mean and no count, only the configured threshold
  (`src/features/results/domain/aggregation.ts`, `src/features/surveys/domain/question-statistics.ts`).
- **Authenticated-mode participation** is recorded as `surveyParticipations/{uid}__{surveyId}` (`{uid, surveyId}` only), to
  block a second accepted submission. It is never joined to a response document (BR-18, per the rules comment).
- **Challenges** (`challenges`) are anonymous, encrypted free text with no submitter identity field.
- **Forum** threads and replies are attributed to `authorUid` and encrypted. Forum visibility is a UI-only feature flag
  (`FEATURE_FORUM_ENABLED`). The forum API routes and their authorization stay active regardless of the flag.

## 6. Encryption

- Algorithm: AES-256-GCM with a random 12-byte IV per value. The record envelope v2 (`src/lib/encryption/record-envelope.ts`)
  is the only envelope for new writes; `keyVersion: "v2"`, `keyId: "k1"`. The v1 helper (`src/lib/encryption/encryption.ts`) now
  provides only the key accessor used by the v2 envelope and the key check.
- Key: `ENCRYPTION_KEY`, read at call time, must decode to 32 bytes. It has no `NEXT_PUBLIC_` counterpart and never reaches
  the browser. A missing or unusable key throws. There is no plaintext fallback.
- **Encrypted (v2 record envelope, `src/lib/encryption/record-envelope.ts`):** personal goal business content (title,
  skill-tree reference, target date) in `userDevelopment/{uid}/goals/{goalId}.content`. The v2 envelope uses an HKDF-SHA-256
  subkey of `ENCRYPTION_KEY` labelled with a key id (`k1`), AES-256-GCM with a fresh 12-byte IV, and binds the record
  context (`goal:<uid>:<goalId>`) as additional authenticated data. A ciphertext moved to another record fails
  authentication.
- **Encrypted (v2 record envelope, `src/lib/encryption/record-envelope.ts`), converted in the 2026-11-11 encryption pass:**
  personal goal content; personal skill levels (`skillProfiles/{uid}.levels.<treeId>`); private team-skill ratings
  (`teamSkillAssessments.level`); the collaborative team level and note (`teamManualAssessments`); team skill content
  (`teamSkills`: name, description, category, guidance); competence plan title and milestones (`teamCompetencePlans`);
  team project titles (`teamProjects`); project participation notes (`teamProjectParticipations`); team system name,
  description and attribute notes (`teamSystems`). Each value is sealed with its own record context (feature, owner or team,
  record id and nested item), so a ciphertext moved to another person, team, record or field fails authentication.
  Codecs live beside each store (`*-codec.ts`). A plaintext or unopenable value is refused, never accepted (no fallback).
  Coverage and the remaining plaintext fields are listed in [`DATA-MODEL.md`](DATA-MODEL.md) §11.
- **Encrypted (v2 record envelope), converted in the same pass:** challenges (`challenges/{id}`, AAD `challenge:<teamId>:<id>`);
  forum threads and replies (`forum-thread:<teamId>:<id>`, `forum-reply:<teamId>:<threadId>:<id>`); survey responses
  (`survey-response:<teamId>:<surveyId>:<id>`); development-conversation content (`dev-conversation:<ownerUid>:<id>`); and
  personal responsibilities and achievements (`personal-record:<ownerUid>:<collection>:<id>`). Their document ids are reserved
  before sealing, because the id is part of the AAD. No migration exists or is needed: there is no legacy business data.
- **Key check (PR-SI-5, CL-27):** records that must tell a wrong key from tampering store a `keyCheck` next to the envelope
  (`recordKeyCheck()` in `record-envelope.ts`: HMAC-SHA-256 over a fixed label, keyed with the record subkey). A wrong key is
  reported as `key_mismatch` before any decryption. Tampering with a matching key is `payload_unauthenticated`. Authenticated
  bytes that do not parse are `malformed`. Only `malformed` may ever be a deletable item. The keyCheck identifies the key but
  does not reveal it, and it is never a DTO field.
- **Encrypted, final structured-data and definition pass:** survey definitions (`surveys`: title, description, questions;
  `survey:<teamId>:<surveyId>`); skill-tree names and node labels (`skillTrees`; `skill-tree:<treeId>`); team names (`teams`;
  `team:<teamId>`); role titles and descriptions (`roleDefinitions`; `role:<roleId>`); user display names (`userProfiles`;
  `user-profile:<uid>`); team invitation e-mail addresses (`teamInvitations.content`; `team-invitation:<teamId>:<emailIndex>`);
  the team's tracked stage (`skillProgress.content`; `skill-progress:<teamId>:<treeId>`); the team's skill requirement
  (`teamSkillNeeds.content`; `team-skill-need:<teamId>:<treeId>`); and the roadmap plan's target, priority, status, dates,
  completion and owner (`roadmapItems.content`; `roadmap-item:<teamId>:<treeId>`).
- **Keyed blind indexes (HMAC, not hashes):** a value that must be matched without being stored in the clear uses a keyed
  index from `src/lib/encryption/blind-index.ts`: an HKDF-SHA-256 subkey of `ENCRYPTION_KEY` per purpose
  (`devpulse/blind-index/v1/<purpose>`), HMAC-SHA-256 hex. Purposes: `team-invitation-email` (`teamInvitations.emailIndex`) and
  `roadmap-owner-ref` (`roadmapItems.ownerRefIndex`, scoped to the team). No unkeyed hash and no deterministic encryption of
  an e-mail or an owner handle is stored.
- **Remaining plaintext business content:** none is known in the converted collections. The legacy scripts that once wrote
  plaintext (`seed-demoteam.mjs`, `migrate-competence-plans-independent.mjs`) have been retired from the repository. The exceptions are identifiers,
  authorization and accountability metadata, lifecycle timestamps and the keyed indexes listed in
  [`DATA-MODEL.md`](DATA-MODEL.md) §11.2, each with its reason. Gaps are listed in [`KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md) §1.2a.

## 7. Personal data

- **Personal goals** (`userDevelopment/{uid}/goals/{goalId}`) are owner-only through the Admin SDK. No uid-parameterised
  reader exists. Team roles and superadmin status do not widen access (invariants 37–54).
- **Development conversations** (invariants 55–72): readable only by the owner, or by a participant after an explicit
  accept. Access ends on the next request after decline, leave, removal or completion freeze.
- **Personal role workspace** (PR-SI-1…5): owner-only responsibilities and achievements. A static import guard
  (`personal-role-workspace-repo-guard.test.ts`) keeps personal records out of team and aggregate code.
- **Skill profile** (`skillProfiles/{uid}`) is owner-only. Team coverage reads it only through the consent-gated aggregate
  (invariants 31–36).
- **Display names** (`userProfiles/{uid}`) are presentation only and are never an authorization key (invariant 21).

## 8. Team member references

- Client-visible references to a teammate are `teamMemberships.memberRef`: team-scoped, opaque, and never authentication or
  authorization evidence. A reference is valid only with its own `teamId` (invariants 20, 24–27). The CSPRNG generation of
  references is **unverified** in this pass.
- Roadmap owner references (`roadmapItems.ownerRef`) hold a `memberRef`, not a uid.

## 9. Account erasure

Full design: [`docs/archive/features/account-erasure/SPEC.md`](archive/features/account-erasure/SPEC.md). Operator runbook:
[`docs/operations/account-erasure-runbook.md`](operations/account-erasure-runbook.md).

- **Self-only.** Only the verified person starts or resumes their own erasure (`AE-SI-1`). Starting requires a verified
  email and a recent sign-in: `auth_time` within **300 seconds** (`RECENT_AUTH_WINDOW_SECONDS`, `AE-SI-10`).
- **Fence.** `accountErasures/{uid}` is read inside every person-owned write transaction. While it exists, person-owned writes
  for that uid are refused with `erasure_in_progress` (`AE-SI-3`). The fence record is server-only.
- **Inventory.** Each collection and field that can hold a person is listed once in
  `src/features/account-erasure/server/inventory.ts`, with a class: DELETE, ANONYMIZE, DETACH, PRESERVE, TRANSIENT or
  DISCOVERY. An inventory guard test fails on unlisted uid-bearing paths.
- **Preserved by design:** anonymous survey responses and challenge content (`AE-SI-8`), and other people's content
  (`AE-SI-9`).
- **Logs** carry status, step and error code only (`AE-SI-12`).
- **Code status:** `PRODUCTION_HANDLERS_READY = true` in `production-erasure.ts`. **Operational status:** the runbook records
  deployment as **held** pending an operator gate (TASK-045). Do not treat erasure as deployed.

## 10. Logging, fixtures and tooling

- Logs must not contain uids, e-mail addresses, content, role titles or free text (`AE-SI-12`, `RP-SI-7`). Whether every
  module follows this is **unverified**.
- Test and demo fixtures are synthetic. The demo seed is dry-run by default and refuses unsafe or non-demo projects
  (`assertAdminEmulatorSafe` in `src/lib/firebase/admin.ts`). Real wellbeing data must never be used (invariant 15).
- The destructive reset script `reset-disposable-app-data.mjs` has been retired from the repository. No script in the
  repository deletes application data.

## 11. Known gaps

See [`docs/KNOWN-LIMITATIONS.md`](KNOWN-LIMITATIONS.md). In particular: operator and Admin-SDK access to fields that are
plaintext by design is an accepted residual risk; account erasure is not yet operationally deployed; and the archived
invariants 1–72 were not all re-traced line by line in this rewrite.

## 12. Accepted residual risk vs implemented guarantees

Two categories are kept apart. Nothing in §12.1 is a guarantee.

### 12.1 Accepted residual risk (product-owner decision, final for the current scope)

The product owner has explicitly accepted the residual privacy risk of team competence aggregation at **k = 3**. This is a
final product decision for the current application scope. It is not a fixed defect, and no redesign is planned.

- **A1–A4** (categorical coverage view, `src/features/team-skills/server/teamkompetanse-leak-regression.test.ts`, the four
  `it.fails` cases): differencing and threshold effects over time, including withdrawal from a cohort of exactly three, a
  threshold sweep over `requiredCoverage`, a five-member all-contribute team, and an opt-in completing a cohort of three.
  Kept as documented, expected-fail tests. They are not deleted and not disguised as passing guarantees.
- The decision does not add differencing protections, cohort-stability mechanisms or stricter thresholds. It does not
  authorize exposing raw individual assessments, and it does not bypass consent or access controls.
- `skill-coverage` remains in use. Its usefulness is evaluated separately, and it is not retired because of A1–A4.

### 12.2 Implemented guarantees (enforced and covered by code or tests)

- Team competence aggregation applies k = 3 (`SKILL_COVERAGE_MIN_CONTRIBUTORS`), suppresses any skill with fewer than three
  eligible contributors, and returns only a level or `insufficient_data` (the automatic profile).
- Participation requires the current consent notice version (2). Opt-in is voluntary and stored on the member's own
  membership document.
- Membership and team status are checked server-side on every read, and only the verified token's uid is trusted.
- Criteria-version validation rejects malformed or mismatched ratings. Suspect ratings suppress a skill.
- Individual self-assessments are readable only by their owner through the server.
- Encryption, anonymous response shapes and erasure controls as described in §§5–9.
