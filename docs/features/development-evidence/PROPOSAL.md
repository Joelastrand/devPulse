# Development evidence (Phase 2 of My Development): design proposal

## Status

**Proposal, not approved.** Written 2026-11-10 from the repository state at commit `570cc27` plus the uncommitted
Phase 1 working tree. Nothing here is implemented. No migration, schema change, rule change, `SPEC.md` or `TASKS.md`
exists yet. This document recommends a design and lists the product-owner decisions (section 13) that must be
resolved before `/split-tasks`. Items marked **Owner decision** are not ours to settle.

Phase 1 status, as reported by the owner and not re-verified here: navigation, goals and conversations UX are built.
Still open: browser verification, the `/me/skills` consistency pass, and unsaved-navigation handling. Phase 2
implementation should not start until those are closed or explicitly waived (section 12, gate G0).

## 1. Repository findings that shape the design

| # | Finding | Source | Consequence |
|---|---|---|---|
| F1 | A company role model already exists: `roleDefinitions/{roleId}` (name, description, 0–20 expectations keyed to `treeId`, archive/restore), built 2026-10-28. | `docs/features/role-profiles/SPEC.md`, `docs/DATA-MODEL.md` "Role profiles" | Extend it. Do not add a second role collection. |
| F2 | The approved role-profiles model **blocks** a role with zero expectations from selection (BR-3, BR-8, PG-2). A title-and-description-only role is therefore unusable as a target today. | role-profiles BR-3, BR-8 | Phase 2's "must work with only a title and description" requires a deliberate amendment (decision D2). |
| F3 | PO-1 (approved) excludes any current or primary role. Phase 2 asks for "existing role assignments" and an "optional relationship to a company role" on responsibilities. | role-profiles PO-1, BR-24, BR-25 | Linking a responsibility to a role is a current-role-adjacent fact. It needs an explicit owner decision (D1). |
| F4 | RP-SI-8 and the role-profiles D2 guard forbid any role data in D2. Phase 2 needs evidence to reach D2. | `docs/SECURITY.md` RP-SI-8; role-profiles "D2 interaction" | Amend RP-SI-8 narrowly, for responsibilities and achievements only. Role data stays out of D2 (decision D3). |
| F5 | D2 already has an encrypted, embedded, capped snapshot pattern: `sharedGoals` (≤5), captured at selection, never updated, stored inside the encrypted content payload (CL-18). | `docs/features/development-conversations/SPEC.md` (goal snapshots), `content-payload.ts` | Reuse this pattern for evidence snapshots. Do not invent a new sharing mechanism. |
| F6 | The content payload has a strict key allow-list (`CONTENT_PAYLOAD_KEYS`, BR-51 "exactly sixteen plain keys"). The encryption helper has no key-version dispatch and no AAD. | `content-payload.ts`, `src/lib/encryption/encryption.ts` | New payload keys need an explicit codec change and a backward-compatibility rule for legacy documents (section 8). |
| F7 | Personal data is `userDevelopment/{uid}/…`, deny-only client rules. D1 goals are unencrypted (SI-48); D2 free text is encrypted (CL-18). | `firestore.rules` L289, SECURITY 48 | New collections go under the same namespace. Free-text encryption is decision D6. |
| F8 | Account erasure has an inventory with explicit `userDevelopment` subtree entries (I-3 goals, I-4 roleTarget, I-5 conversations). | `src/features/account-erasure/server/inventory.ts` L81–83 | New subtrees need new inventory entries, or erasure is incomplete. |
| F9 | D1 goals are read through an approved importer allow-list (CL-5, `personal-goals-scope-guard.test.ts`). | D2 SPEC L161 | Achievement → goal links need a guard-allow-list edit. This is a known pattern, not a blocker. |
| F10 | `ENCRYPTION_KEY` rotation is deferred (ARCHITECTURE). Losing or rotating the key makes encrypted records unreadable. | D2 SPEC repository finding 10 | Encrypting achievement text adds real operational risk. It must be stated as an accepted risk (D6). |
| F11 | Working tree has about 96 uncommitted modifications spanning Phase 1 and docs. | `git status` | Checkpoint Phase 1 before Phase 2 tasks start (gate G0). This proposal does not commit anything. |

## 2. Product objective, restated as testable rules

1. A person can see the company's role for their own development, even if it has only a title and a short description.
2. A person can record responsibilities (ongoing or completed, inside or outside the formal role) and achievements (work,
   outcome, date).
3. A person can choose which of those records to share as evidence in a development conversation.
4. Everything is private by default. Shared evidence is visible only to the conversation's owner and its one accepted,
   eligible participant (D2 rules).
5. No team lead, teammate, team admin, or superadmin can read any person's responsibilities, achievements, evidence
   selections or comparisons. No score, rating, rank or readiness is computed.

## 3. Recommended user journeys and page placement

Phase 1 placed `Ferdigheter · Mål · Samtaler` in personal navigation. Phase 2 adds one area for records and keeps
evidence selection inside the existing conversation.

| Journey | Recommended placement |
|---|---|
| Read the company's role definitions | `/roles` (existing, role-profiles). No change. |
| Pick or clear the target role; see comparison | `/me/skills`, existing role section. No change, except the zero-expectation rule (D2). |
| Create or edit a responsibility, with optional role tag | New `/me/work` page, section "Ansvar". |
| Record an achievement, link it to responsibilities, goals and role expectations | `/me/work`, section "Resultater". |
| Choose evidence for a conversation | Conversation detail, owner view: new "Dokumentasjon" section next to "Mål" (mirrors the shared-goals picker). |
| View received evidence | Participant view of the same conversation, read-only. |

Recommendation: `/me/work` (Norwegian label to be approved, for example "Arbeid"). One page with two sections keeps
personal navigation at four entries (Ferdigheter, Mål, Samtaler, Arbeid). The alternative, two top-level entries, is
noisier and gives no extra privacy. Copy and labels are subject to the existing copy-approval practice.

Journeys (owner view):

- **J1 Read role.** Person opens `/me/skills`, sees the target-role section with title, description and expectations
  when present. Role without expectations shows the description only, and a neutral "no expectations listed" notice.
- **J2 Record responsibility.** `/me/work` → "Nytt ansvar": title, optional description, start date, optional end date
  (active or completed derived from the end date, see section 5), optional role tag (any active role, D1).
- **J3 Record achievement.** `/me/work` → "Ny resultat": description of work, optional outcome, date or period,
  optional links (0–5 each) to responsibilities, own goals, and role expectations (role + skill area).
- **J4 Share evidence.** Conversation owner → "Dokumentasjon" → select up to 5 responsibilities and 5 achievements.
  Each selection is a snapshot (section 6). Copy states the consequences before confirming.
- **J5 Withdraw.** Owner removes a shared item at any time while open (and after completion, D4). The participant loses it.
- **J6 Receive.** Accepted participant sees the evidence as read-only snapshots in the conversation. They cannot edit
  or re-share them.

## 4. Company-defined roles (extension of role-profiles)

Decision: **extend `roleDefinitions` in place.** Do not create a parallel model.

- `name` (required), `description` (optional, ≤500, plain text): unchanged.
- `expectations`: remains optional, 0–20, numeric `expectedLevel` 2–4 keyed to `treeId`. No new requirement. The
  product objective does not require numeric expectations; they stay available when a company wants them.
- **Change (D2):** a role is selectable when it is active. Zero expectations is allowed. The comparison (BR-9)
  appears only when at least one expectation resolves. Otherwise the target view shows the description and a neutral
  notice.
- Optional, deferred: a free-text `expectationText` list (for example "Leder kodegjennomganger") with no levels. It
  would widen the role model and needs its own review. Not recommended for the first slice; ask only if the owner
  wants text-only expectations (D2b).
- Existing role assignments: the only personal role state is `userDevelopment/{uid}/roleTarget/current` (role-profiles
  AD-2). It remains owner-only and unchanged. Archiving a role keeps stored responsibility and achievement tags intact,
  displayed as "arkivert rolle" (archived role), exactly as the target-role archived state works today (BR-5).
- Compatibility: existing roles keep their current documents. Roles with zero expectations that were created as drafts
  become selectable after the change. No data migration is needed (the change is a read-rule change).

## 5. Personal responsibilities

Collection: `userDevelopment/{uid}/responsibilities/{responsibilityId}` (new subcollection, owner-only, Admin SDK).

| Field | Type | Notes |
|---|---|---|
| `title` | string, encrypted (D6) | 1–100 code points |
| `description` | string, encrypted, optional | ≤4096 UTF-8 bytes (same as D2 notes) |
| `roleId` | string \| null | Optional tag to a `roleDefinitions` document. Never a current-role field (D1). |
| `startDate` | `YYYY-MM-DD` | Real calendar date, 2020–2100 (D1/D2 rule) |
| `endDate` | `YYYY-MM-DD` \| null | Must not precede `startDate`. Null means ongoing. |
| `createdAt`, `updatedAt` | Timestamp | |
| content envelope | `ciphertext`, `iv`, `authTag`, `keyVersion` | Same envelope as D2 content |

- Status is derived, not stored: `completed` when `endDate` is set and in the past, otherwise `active`. Deriving avoids a
  stale flag. An explicit "end today" action sets `endDate`.
- Cap: 50 per person, count-then-create (D1 precedent). Read window 100, `orderBy createdAt`, malformed documents
  counted and not shown.
- Delete: owner hard delete. Snapshots already shared are handled by decision D5.
- No skill levels, no score, no team field, no `teamId`.

## 6. Personal achievements

Collection: `userDevelopment/{uid}/achievements/{achievementId}` (new subcollection, owner-only).

| Field | Type | Notes |
|---|---|---|
| `description` | string, encrypted | Work performed, ≤4096 bytes, required |
| `outcome` | string, encrypted, optional | Impact in the person's words, ≤2048 bytes |
| `periodStart` | `YYYY-MM-DD` | Required. A single date is `periodStart = periodEnd`. |
| `periodEnd` | `YYYY-MM-DD` | Not before `periodStart`. Full dates only, no quarter labels, to keep one rule. |
| `responsibilityIds` | string[] | 0–5, each must exist and be owned by the caller |
| `goalIds` | string[] | 0–5, each must be an existing owner goal (read through the D1 store, CL-5) |
| `expectationLinks` | `{roleId, treeId}[]` | 0–5, each `roleId` must exist and `treeId` must be one of that role's expectations |
| `createdAt`, `updatedAt` | Timestamp | |

- **No automatic scoring, rating, rank, or "impact" number.** Outcome text is shown as written.
- Expectation links are a tag for the person's own record. They do not create a comparison, a goal, or a status.
- Cap: 200 per person (count-then-create, read window 100). Achievement counts are not shown anywhere as a metric.
- Link validation: links are checked at write time. A link to a deleted responsibility or goal is removed on the next
  owner edit and is never shown as an error that reveals the other record (D2-SI-15 style neutral errors).
  Shared snapshots never contain link identifiers (section 6.2).

### 6.1 Relationship to goals

Goals (D1) stay a plan: "what I intend to develop". Achievements are a record: "what I did". Achievements may reference
goals, and conversations can already snapshot goals. Phase 2 does not change D1 and does not turn goals into
achievements. This avoids duplicating goal functionality (product requirement).

### 6.2 Evidence snapshots in conversations (D2 change)

- Two new arrays inside the encrypted D2 content payload, mirroring `sharedGoals`:
  `sharedResponsibilities` (≤5) and `sharedAchievements` (≤5).
- Each snapshot is a frozen copy taken when the owner selects it:
  - responsibility: `{ title, description | null, startDate, endDate | null, capturedAt }`
  - achievement: `{ description, outcome | null, periodStart, periodEnd, capturedAt }`
- Snapshots never contain `roleId`, `treeId`, `goalIds`, `responsibilityIds`, the source document ID, or any role name
  (D3). The snapshot does not update when the source changes.
- Selection is by the source IDs in one request. The server reads the source, copies the fields, and writes the
  conversation in one transaction, following `set-shared-goals.ts`. The request never carries title or description text.
- Allowed only while the conversation is `open` by default (D4 may change this).
- Caps: `EVIDENCE_SHARED_MAX = 5` per kind, constants, not configurable.

## 7. Role and permission matrix

Rows are actors; columns are operations. "—" means no access and no route.

| Actor | Read own records | Write own records | Pick evidence | Read a shared snapshot | See role comparison |
|---|---|---|---|---|---|
| Owner (verified uid) | Yes | Yes | Yes, open conversations | Yes (own conversation) | Yes (own) |
| Accepted, eligible participant | — | — | — | Yes, read-only, in that conversation | — |
| Accepted, ineligible participant (BR-21 failed) | — | — | — | — (access ended; owner content retained, D2-SI-8) | — |
| Pending invitee | — | — | — | — (pending DTO only, no evidence) | — |
| Team lead (any role value) | — | — | — | — | — |
| Teamadmin / team member | — | — | — | — | — |
| App admin (`requireAppAdmin`) | — | — | — | — | — (role definitions only) |
| Superadmin | — | — | — | — | — (no support or recovery route, D2-SI-18) |
| Unauthenticated | — | — | — | — | — (401) |

Authorization is re-derived per request. The uid comes from the verified token only. Admin and team roles grant nothing
here. The superadmin and teamadmin rows follow the explicit TA-SI and SR-SI decisions: not assumed, not granted.

## 8. Privacy, sharing, withdrawal and snapshot behaviour

- **Private by default.** A new responsibility or achievement is visible only to its owner. Sharing is an explicit,
  per-item action inside one conversation.
- **Source vs. snapshot.** Source records are the owner's private records. Snapshots are copies inside one conversation.
  The UI labels them "delt kopi" (shared copy) and states that the source is unchanged.
- **Withdrawal.** The owner removes one snapshot from a conversation. The participant loses it at once. Withdrawal does
  not change the source.
- **What withdrawal cannot do.** It cannot undo what the participant has already read. The copy and the
  pre-confirmation text must say so.
- **Leave and removal.** A participant who leaves or is removed loses access. The owner's shared evidence stays in the
  owner's conversation, consistent with D2 (CL-21). The participant's own notes are removed as today.
- **Completion.** Completion freezes evidence snapshots as it freezes all D2 content (D4 may amend this).
- **Deleting a source record.** See decision D5.
- **Logs and errors.** No title, description, outcome, role name, skill-area name, or goal title in logs or errors
  (role-profiles BR-23 pattern). Neutral error codes.
- **Exports.** None. No aggregation across records, conversations or people. No "evidence count" for any audience.
- **Notifications.** None (D2 CL-24).

## 9. API and validation design

All routes are under `app/api/me/`, owner-only, Admin SDK, verified token, field allow-list responses, bounded bodies
(streamed cap like `goal-request-body.ts`).

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /api/me/work/responsibilities` | List own (bounded window) | Malformed rows counted, not returned |
| `POST /api/me/work/responsibilities` | Create | Count-then-create cap 50 |
| `PATCH /api/me/work/responsibilities/[id]` | Edit | Validated fields only; `roleId` must be an existing role (archived allowed) |
| `DELETE /api/me/work/responsibilities/[id]` | Delete | Triggers D5 behaviour |
| `GET /api/me/work/achievements` | List own | Window 100 |
| `POST /api/me/work/achievements` | Create | Cap 200; validates `responsibilityIds`, `goalIds`, `expectationLinks` |
| `PATCH /api/me/work/achievements/[id]` | Edit | Same validation |
| `DELETE /api/me/work/achievements/[id]` | Delete | |
| `PATCH /api/me/conversations/[id]` (evidence part) | Set `sharedResponsibilities`, `sharedAchievements` by source IDs | Mirrors shared-goals; open-only by default; one transaction |

Validation rules: strict JSON, unknown keys rejected, trimmed text, Unicode code-point and UTF-8 byte limits, real
calendar dates, ID format checks, no client-supplied `uid`, `ownerUid`, `createdBy`, or `keyVersion`. Responses never
include `uid`, e-mail, `memberRef`, `teamId` (except where D2 already returns it), or internal timestamps beyond
`createdAt`/`updatedAt`.

Error codes: `invalid_input`, `not_found` (neutral for foreign or missing IDs), `limit_reached`, `conversation_completed`,
`conversation_not_found`, `persistence_failed`. No code reveals whether a foreign ID exists.

## 10. Migration and backward compatibility

- **No data migration.** New subcollections start empty. Existing conversations have no evidence keys.
- **Legacy payloads.** Content decoding treats missing `sharedResponsibilities` and `sharedAchievements` as `[]`. The
  payload parser accepts both shapes, and a test pins that. This is a codec change, so it needs its own review, since
  the current parser rejects unknown keys.
- **Rollback.** A deployment with the new keys cannot be rolled back to code that rejects unknown payload keys. Either
  roll forward, or ship a read-tolerant release first (recommended: a first slice that only reads unknown keys as
  empty).
- **Role change.** Zero-expectation roles become selectable. Existing comparisons and targets are unchanged.
- **Indexes.** Expected: none. Ordered reads use `createdAt` only, like `roleDefinitions` and D1 goals. Confirm during
  implementation.
- **Demo Team.** No seeded records (role-profiles PO-3 precedent). Explicitly out of scope.

## 11. Security and regression test plan

Static and scope guards (the repository pattern: change detection, not authorization, RP-SI-12):

- New guard for `src/features/development-evidence/` (or the chosen module name): no `collectionGroup`, no uid-parameterised
  reader, no role or team imports except the approved role read, no logging of content.
- Update the role-profiles D2 guard and the D2 guard for the new snapshot keys only. Role identifiers and role names must
  still be absent from the D2 module.
- Update the D1 importer allow-list (CL-5) for achievement → goal existence checks.

Authorization matrix (`*-authz-matrix.test.ts` pattern), one row per actor × operation in section 7. Include: teamadmin,
superadmin, app admin, team lead, ordinary member, accepted participant, pending invitee, ineligible participant,
unauthenticated, foreign uid in body and query, and cross-owner IDs.

Behaviour tests:

- Create, edit, delete, cap and window (including malformed rows counted and hidden) for both collections.
- Date rules: real dates, `endDate` ≥ `startDate`, derived status.
- Link validation: a deleted goal or responsibility link is cleared, not echoed. A `roleId` that is archived is allowed.
- Snapshot semantics: frozen after source edit; no `roleId`, `treeId`, source ID or role name present in the stored payload;
  caps of 5 per kind; open-only (or D4 rule); completion freeze.
- Withdrawal: snapshot removed; source unchanged; participant loses the item at once.
- Participant read: read-only snapshots only, no source IDs; ineligible participant sees nothing new.
- Codec: encrypt/decrypt round trip; tampered payload fails closed; legacy payload without new keys decodes to empty.
- Erasure: inventory entries for both subtrees (I-x), and a test that every `userDevelopment` subcollection is listed.
- Firestore rules emulator: client read/write denied on both new subcollections.
- Logs and errors contain no sensitive text (grep-based test pattern used by D1 and role-profiles).
- Accessibility and copy: Norwegian copy reviewed; phone width with no horizontal scroll; labelled controls; "delt kopi"
  notice reachable by keyboard.
- Regression: Phase 1 `/me/goals`, `/me/conversations` and role-profiles suites continue to pass.

Security review: run `/security-review` after the evidence slice and before closeout. Expected new invariants (PD-SI-1…n, with
the next free prefix) are listed in section 14.

## 12. Implementation phases (dependency order)

Each phase is one or more tasks. Each ends with the repository's checks and an independent review. No task starts before its
gate.

- **G0 (gate): Phase 1 closeout.** Browser verification, `/me/skills` consistency pass, unsaved-navigation handling, and a
  checkpoint commit of the working tree (owner decision). Phase 2 tasks do not start before this.
- **P0 (docs only, no code).** Owner decisions recorded. Amend: role-profiles BR-3, BR-8, BR-9, PG-2 and RP-SI-8 (scoped);
  D2 SPEC out-of-scope and D2-SI-16 (scoped to the two new arrays); `docs/SECURITY.md` new `PD-SI` section; `DATA-MODEL.md`
  rows; `ROADMAP.md`; `UI-UX.md`. Create `SPEC.md` and `TASKS.md` through `/plan-feature` and `/split-tasks`. Approval is
  required before P1.
- **P1 Company roles.** Relax zero-expectation selectability; comparison and target view copy for description-only roles;
  admin form notice. Smallest slice, touches only role-profiles. Tests: BR-8/BR-9 changes, authz matrix unchanged.
- **P2 Responsibilities.** Store, Admin-SDK routes, encryption, `/me/work` section, erasure inventory, rules deny-test,
  static guard. No evidence yet.
- **P3 Achievements.** Store, routes, validation of responsibility, goal and expectation links, D1 importer allow-list edit,
  `/me/work` section.
- **P4 Evidence in conversations.** Payload extension and legacy-tolerant codec, set-evidence operation, owner picker,
  participant read-only view, withdrawal and D5/D4 behaviour, D2 guard update, D2 tests.
- **P5 Verification and closeout.** Emulator rules, authz matrix, browser verification of journeys J1–J6 on desktop and
  phone width, security review, documentation sync, closeout record. Each phase has its own review; P4 needs an explicit
  privacy review.

Dependency: P1 is independent. P2 before P3. P2 and P3 before P4. P5 last.

Estimate (relative, not a commitment): P0 small, P1 small, P2 medium, P3 medium, P4 large (privacy-sensitive), P5 medium.

## 13. Owner decisions required (must be resolved before `/split-tasks`)

Recommendation first in each. Nothing below is decided by this proposal.

- **D1 Relationship to a company role (PO-1).** The requirement asks for an "optional relationship to a company role" on
  responsibilities and "existing role assignments". PO-1 excludes any current role.
  - (a) **Recommended:** responsibilities and achievements may carry an optional role **tag**. No current-role field, no
    primary role, no assignment, no comparison from tags. Owner confirms this is not a current role under PO-1.
  - (b) No role link at all. Simplest, but the requirement is not met.
  - (c) Reopen PO-1 for a self-declared current role. Needs separate product and privacy approval (PO-1 Option B).
- **D2 Title-and-description-only roles.** Make active roles selectable without expectations (amends role-profiles BR-3,
  BR-8, PG-2).
  - (a) **Recommended:** yes. Comparison appears only when expectations exist.
  - (b) Keep the current rule and require at least one expectation. Conflicts with the stated objective.
  - (c) Also add text-only expectations (D2b). Recommended only if the owner wants them now.
- **D3 Sharing into conversations (amends RP-SI-8 and D2 scope).**
  - (a) **Recommended:** responsibilities and achievements may be shared as snapshots. Role data never reaches D2. Snapshots
    contain no role identifier or role name.
  - (b) Share with the role name included. Rejected by default: it implies a job-title fact is shared.
  - (c) No sharing. Conflicts with the objective.
- **D4 Changes after completion.** Snapshots freeze at completion, as D2 freezes all content.
  - (a) **Recommended:** the owner may still withdraw an individual evidence item after completion, the same narrow exception
    D2 already allows for participant removal (BR-16). Freezing without withdrawal would make the privacy promise weaker
    than the rest of D2.
  - (b) Strict freeze, no withdrawal after completion. Simpler, but the owner cannot withdraw.
- **D5 Deleting a source record that was shared.**
  - (a) **Recommended:** deleting a responsibility or achievement removes its snapshots from every conversation of the owner,
    open and completed. This is an owner-only, same-transaction-per-conversation cascade. The UI says so before confirming.
  - (b) Snapshots are independent. Delete the source only; copies remain and the UI warns. Simpler, weaker privacy.
- **D6 Encryption of achievement and responsibility free text.**
  - (a) **Recommended:** encrypt title, description and outcome with the existing AES-256-GCM helper (CL-18). No search, no
    server-side filtering on text. Accept and record the `ENCRYPTION_KEY` rotation and loss risk (F10).
  - (b) Store plaintext, like D1 goal titles (SI-48). Consistent with D1, weaker for salary-relevant text.
- **D7 Navigation and copy.** Single `/me/work` page with two sections, label "Arbeid" (to approve), personal navigation becomes
  four entries. Norwegian copy must be approved before implementation.
- **D8 Caps.** Recommended: responsibilities 50, achievements 200, evidence per kind per conversation 5 (matches
  `SHARED_GOALS_MAX`). Owner confirms or changes.
- **D9 Erasure.** Recommended: responsibilities and achievements are erased with the owner's account, like goals and
  conversations (new inventory entries). Confirm.
- **D10 Team and leadership visibility.** Recommended and assumed: none, now or in v1, consistent with D2 and role-profiles.
  Any future team or manager view needs its own SPEC and privacy approval. Confirm.
- **D11 Achievement links to goals and role expectations.** Recommended: allowed as tags on the owner's own record only.
  They do not create comparisons, goals or statuses. Confirm.

## 14. Documentation and invariant impact (for P0)

- `docs/SECURITY.md`: new `PD-SI-*` section (next free prefix; the numbered invariants run to 72 and are not renumbered).
  Expected content: owner-only records, no role data in D2 (scoped amendment of RP-SI-8), snapshot content rules,
  withdrawal semantics, neutral errors, no collectionGroup, erasure coverage.
- `docs/features/role-profiles/SPEC.md`: amend BR-3, BR-8, BR-9 and PG-2 (D2), and RP-SI-8 (D3), with dated amendment notes.
- `docs/features/development-conversations/SPEC.md`: amend out-of-scope and D2-SI-16 (D3, D4, D5), dated.
- `docs/DATA-MODEL.md`: rows for `responsibilities` and `achievements`; conversation payload keys; role-profiles status note.
- `docs/PRODUCT.md` and `docs/ROADMAP.md`: Phase 2 wording, replacing any "role expectations are unscheduled" language.
- `docs/UI-UX.md`: `/me/work`, "delt kopi" pattern.
- `docs/ARCHITECTURE.md`: no new boundary; note the new encrypted collections.

## 15. Trade-offs of the recommended design

- **Extend, do not replace, role-profiles.** Fewer concepts and no duplicated role system. Cost: two approved specs must be
  amended, and the zero-expectation rule is a visible behavioural change.
- **Snapshots, not live links.** Reuses the D2 pattern and gives the participant a stable record. Cost: copies can go stale,
  and withdrawal cannot undo a read (disclosed).
- **Encrypted free text.** Better protection for salary-relevant text. Cost: no search, and key-management risk (F10).
- **Tags, not a current role.** Keeps PO-1 intact. Cost: the relationship is weaker than a real current role, and that is
  the intent.
- **Per-item, owner-controlled sharing.** Strongest privacy default. Cost: more UI steps for the owner.

## 16. Next steps

1. Owner decides D1–D11 (section 13). Recommended answers can be approved as a batch.
2. Confirm gate G0 (Phase 1 closeout or an explicit waiver, and a checkpoint of the working tree).
3. Run `/plan-feature` to produce `SPEC.md` from this proposal once decisions are recorded. Then `/split-tasks`.
4. Start with P0 (docs) and P1 (company roles). Do not start migrations or code before the decisions are approved.
