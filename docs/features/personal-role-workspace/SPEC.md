# Personal role workspace and conversation evidence

## Status
Draft — Phase 2A decisions recorded, security validation run, and first-increment blockers resolved in documentation (2026-11-10, second pass). **First increment: NO-GO until the approvals in SECURITY-REVIEW §11.8 are recorded. Assigned role (Phase 2B): NO-GO** (§10).

- **Product owner decisions (2026-11-10):** OD-1, OD-2, OD-3, OD-6 and OD-7 are approved as recorded in "Owner decisions of 2026-11-10" below. OD-4 and OD-5 remain provisionally approved.
- **OD-8 (2026-11-10): conditionally accepted for technical validation only.** The ten validation items were run against the repository. Result: conflicts C-1 to C-8 (SECURITY-REVIEW §10.2). Second pass: C-5 and C-8 resolved; C-6, C-7 and R-1 to R-4 prepared (§11). Acceptance is **not** approval to apply the amendments or to implement Firestore rules, routes or conversation sharing.
- **Not applied:** every security amendment in "Proposed security amendments" is still not in effect. `docs/SECURITY.md`, `docs/DATA-MODEL.md`, `firestore.rules` and application code are **not** changed by this document. `TASKS.md` is synchronized with the 2026-11-10 decisions (second pass).
- **Gate approvals (2026-11-10, product owner):** G1 (SECURITY-REVIEW §11.8: PR-SI-1, PR-SI-2, PR-SI-4, PR-SI-5, Amendments A, B, C2, D), G2 (R-1 to R-4 defaults) and G3 (erasure rows I-17, I-18, W-19 to W-21 and the account-erasure amendment) are **approved**. The first increment (TASK-001 to TASK-005) may proceed. Phase 2B (assigned role) stays NO-GO.
- **First-increment security blockers (2026-11-10, second pass):** C-5 (encryption failure handling) is an approved requirement. C-8 (import boundary) is reclassified as a static guard. C-6 (BR-51 `sharedEvidence` amendment), C-7 (first-increment erasure) and R-1 to R-4 are prepared in SECURITY-REVIEW §11 and await approval (§11.8, G1 to G3).
- No task has started. No Firestore rules, indexes, routes or UI are implemented by this document.

Feature-id: `personal-role-workspace`. Product language: Norwegian Bokmål. Working title for the workspace: **Min rolle og mine bidrag**.

## Problem

A person has no structured place to record what they are responsible for, or the concrete contributions they made, in a form they can bring to a development conversation. Today DevPulse has self-assessed skill levels (C1), personal goals (D1), a self-selected target role (role-profiles), and development conversations with goal snapshots (D2). None of these records responsibilities or achievements, and the conversation can only show goals.

## User outcome

An employee can:

1. See the formal role the company has assigned to them, if one exists, and clearly separate it from the target role they chose for their development.
2. Record their own responsibilities and achievements, privately.
3. Select a chosen set of those records as evidence for an owned development conversation. The invited participant sees only the selected copies, after acceptance.

The system never ranks, scores, approves or compares people with these records.

## Approved product direction

These are approved by the product owner on 2026-11-10. They are product decisions, not security decisions.

- **AD-1 Company role model (option A, long-term).** Three distinct concepts:
  - **Company role definition:** an employer-managed role title, description and optional expectations. Stored in the existing `roleDefinitions`.
  - **Assigned role:** the employee's formal role, assigned by an authorized administrator. Long-term only; **not** implemented in the first increment. Its exact contract is in "Assigned role contract (documented, deferred)".
  - **Target role:** the employee's self-selected development goal. Stored in the existing `userDevelopment/{uid}/roleTarget/current`. **A target role is never represented as an assigned role, in UI, copy, API or storage.**
- **AD-2 Conversation evidence.** Owner-selected responsibility and achievement snapshots may be shared in an owned development conversation. Stored under the existing `userDevelopment/{ownerUid}/conversations/{id}` structure. Encrypted consistently with CL-18. Requires the security amendments below before implementation.
- **AD-3 Relationship to role.** Keep the three labels `Innenfor rollen`, `Utover rollen`, `Ikke angitt`. They are self-reported. When no assigned role exists, the UI must not imply the classification was compared against an official role, and shows a short explanation (copy in "UX").
- **AD-4 Deletion.** Deleting a private responsibility or achievement does not erase a conversation snapshot already saved. Follows the BR-26 snapshot principle of D2. See "Deletion, removal and retention".

### Owner decisions of 2026-11-10

These supersede the earlier recommendations and the "Decisions requiring approval (historical)" table where they differ.

- **OD-1 (approved).** Authorized administrators for formal role assignments are users passing the existing `requireAppAdmin` gate. This grants **no** access to private personal development records (responsibilities, achievements, target role, goals, comparisons, conversations, evidence snapshots).
- **OD-2 (approved as a product requirement).** The deferred assigned-role feature keeps assignment history with effective start and end dates. The current assignment is shown by default. Not implemented. **The access rules for history are unresolved** (C-2) and must be decided before TASK-010.
- **OD-3 (approved).** Source responsibility and achievement content (`title`, `description`, `outcome`) is encrypted at rest with the existing AES-256-GCM helper (`src/lib/encryption`, CL-18). No new encryption mechanism. Structured fields (`status`, `relationToRole`, dates, id arrays, timestamps) stay plain. Supersedes the "not encrypted in the first increment" wording that was in earlier drafts.
- **OD-6 (approved).** After a conversation is `completed`, the only permitted evidence operation is clearing the entire shared evidence set. No partial removal, no addition, no editing. Verified against BR-27, BR-28, CL-26 and D2-SI-9: this is consistent with the shared-goals behavior.
- **OD-7 (approved).** The assigning administrator's identity must not be displayed to employees. Audit metadata may be kept server-side under the existing authorization and retention rules, and is never returned to an employee. The exact audit field, its retention and its erasure are open (C-3).

## Scope

First increment (Phase 2B–2E, without assigned roles):

- Private responsibilities: create, edit, complete, reopen, link to own goals, delete.
- Private achievements: create, edit, link to own goals and responsibilities, delete.
- Workspace at the existing `/me/skills` route, with the view previously labelled `Rollesammenligning` renamed to `Min rolle og mine bidrag`. The route query identifier stays for compatibility.
- Company role section that shows the employer role definition only when one exists. In the first increment no assignment exists, so it shows the "no assigned role" state.
- The existing target-role comparison kept as a secondary, clearly labelled section.
- Owner-selected responsibility and achievement snapshots in owned development conversations, subject to the security amendments.
- Account-erasure coverage for every new record and snapshot.

## Out of scope

- Formal assignment of roles to employees in the first increment (AD-1). The assigned-role contract is documented but not built.
- Manager or admin reading of responsibilities, achievements, target roles, comparisons or snapshots outside the owner's conversation.
- Manager approval, verification, attachments, external integrations, AI evaluation, scoring, ranking, salary or promotion signals.
- Team analytics, team coverage or any aggregation of personal records.
- Multiple conversation participants (D2 keeps one invited participant).
- Changes to C1 self-assessment, C2 team coverage, `roadmapItems`, `skillProgress`, or team membership semantics.
- Any new top-level navigation item (the existing `Ferdigheter`, `Mål`, `Samtaler` stay).
- Data migration of existing records (none exist; see "Backward compatibility").

## Key concepts

- **Company role definition:** a `roleDefinitions` document. Org reference data, not an employee record.
- **Assigned role:** an employee's formal role, assigned by an authorized administrator. Deferred (see below).
- **Target role:** the single optional role a person develops towards. Owner-only. Already built.
- **Responsibility:** a self-reported, ongoing or historical area of ownership or contribution.
- **Achievement:** a specific self-reported contribution or result, with an optional outcome.
- **Relationship to role:** the self-reported classification `within` / `beyond` / `unspecified`, shown as `Innenfor rollen` / `Utover rollen` / `Ikke angitt`. It does not claim comparison with an assigned role.
- **Evidence snapshot:** an owner-selected copy of selected responsibility or achievement fields, stored inside the owner's conversation. It is not a link to the source record.
- **Source record:** the private responsibility or achievement. Visible only to its owner.

## Actors and access

| Actor | Responsibilities / achievements | Target role | Assigned role | Conversation evidence |
|---|---|---|---|---|
| Employee (owner) | Read, write, delete own | Read, write own | Read own (deferred) | Select, remove, read own conversation |
| Invited participant (accepted) | No access | No access | No access | Read snapshots in the conversation only |
| Invited participant (pending or unaccepted) | No access | No access | No access | No access before acceptance |
| Team admin, lead, member | No access | No access | No access | No access |
| App admin / superadmin | No access to personal records | No access | Write assignment (deferred); see below | No access |

`N/A` for any actor is not used. Every cell is an explicit decision.

## User stories

1. As an employee, I want to see my assigned role and my target role separately, so that I understand which is the company's view and which is my own development choice.
2. As an employee, I want to record my responsibilities privately, so that I can remember and describe what I own.
3. As an employee, I want to record achievements with outcomes and link them to my goals and responsibilities, so that I can explain my contributions.
4. As an employee, I want to classify each responsibility or achievement as within or beyond my role, so that I can describe how it relates to my work.
5. As an employee preparing a conversation, I want to select specific responsibilities and achievements as evidence, so that my participant sees exactly what I chose.
6. As an invited participant, I want to see only the evidence the owner selected after I accepted, so that I know what is being discussed without access to the owner's private records.
7. As an employee, I want to remove evidence from a conversation, so that the participant no longer sees it.
8. As an employee, I want to delete a private record, so that it is no longer in my workspace, without silently changing conversations already saved.
9. As an employee without an assigned role, I want the workspace to explain that no role is registered, so that I do not think a comparison was made.

## Behavioral requirements

### Workspace and copy

- **BR-1 Title and description.** The workspace shows the title `Min rolle og mine bidrag` and the description `Se hva rollen din innebærer, og dokumenter ansvar og resultater du ønsker å ta med i utviklingssamtaler.` The route and query identifier are unchanged.
- **BR-2 Three distinct role sections.** The workspace shows, as separate labelled sections: the company role (definition, or the no-assigned-role state), the target role (labelled as the employee's own development choice), and the responsibilities and achievements. The target role is never labelled "rolle", "tildelt rolle" or "din rolle" without the qualifier "utviklingsmål".
- **BR-3 No assigned role state.** With no assigned role, the company section shows `Du har ingen registrert rolle ennå.` and a short explanation: the role is registered by the company, and the self-selected target role does not count as a registered role. It does not show a comparison.
- **BR-4 No numeric requirement.** The workspace works without expectations. Expected skill levels from a company role definition, when present, appear only in a secondary expandable section. Empty expectations show no comparison table.
- **BR-5 Empty states.** Each section has an actionable empty state (add a responsibility, add an achievement, go to goals) and never an empty comparison table.

### Private responsibilities

- **BR-10 Create.** The owner creates a responsibility with a title (required) and optional description, start date, end date, `relationToRole`, and up to five owned goal ids.
- **BR-11 Edit.** The owner edits title, description, dates, relationship and goal links. Owner id and timestamps are never client-controlled.
- **BR-12 Status.** A responsibility is `active` or `completed`. Completing and reopening are explicit actions. Active items are listed first.
- **BR-13 Dates.** `endDate` must not be before `startDate`. Dates are optional.
- **BR-14 Delete.** Delete requires confirmation. It removes only the source record and its own goal links. It does not change any conversation snapshot (BR-70) and does not change goals.
- **BR-15 Relationship classification.** The owner may set `within`, `beyond` or `unspecified` (`Ikke angitt`, the default). The label copy never implies approval, verification or comparison.
- **BR-16 Filtering.** The owner filters the list by status (`active`, `completed`, all). Completed items remain accessible through filtering.

### Private achievements

- **BR-20 Create.** The owner creates an achievement with a title and description (both required), optional outcome, optional date or period, `relationToRole`, up to five linked own goal ids and up to five linked own responsibility ids.
- **BR-21 Edit and delete.** As for BR-11 and BR-14. Deleting an achievement does not change goals or responsibilities.
- **BR-22 Links.** Links reference only the owner's own existing records. A link to a missing record is ignored in the UI and shown as `Koblet element er ikke lenger tilgjengelig`. It is not an error that blocks the page.
- **BR-23 Chronology.** Achievements are shown chronologically (by date or period when given, then by creation time). No score, rating, ranking or sorting by "impact".
- **BR-24 Filtering.** The owner filters by period (from/to on the date) and by `relationToRole`.

### Assigned role (documented, deferred)

- **BR-30 Deferred.** No assignment is created, read or written in the first increment. BR-3 is the only behavior for the company section in that increment.
- **BR-31 Contract.** The contract for assigned roles is in "Assigned role contract (documented, deferred)". Its implementation requires a separate approval.

### Conversation evidence

- **BR-40 Selection is owner-only and explicit.** Only the owner, while the conversation is `open`, selects evidence. Nothing is shared automatically when a participant is invited, accepts, or a goal is linked.
- **BR-41 Source selection.** The owner selects from their own responsibilities and achievements. The server validates each selected id against the owner's own records (BR-60).
- **BR-42 Limits.** At most **5** responsibility snapshots and **5** achievement snapshots per conversation (AD-2: "existing participant limits" preserved; these are new limits modelled on `SHARED_GOALS_MAX = 5`). A selection that exceeds a limit is rejected as a whole. Provisionally approved (OD-5).
- **BR-43 Snapshot content.** Each selected record is copied into exactly the allow-listed fields in "Evidence snapshot schema" (no ids, no goal links, no ownership metadata, no timestamps other than `capturedAt`).
- **BR-44 Snapshot semantics.** A snapshot is a copy taken at selection time. It does not change when the source is edited, completed, reopened or deleted (BR-26 of D2, applied to evidence).
- **BR-45 Replacement.** While `open`, the owner's selection replaces the whole evidence set atomically. Removing an item removes its snapshot from the next read for both parties. No history is kept.
- **BR-46 Visibility.** Both parties see snapshots only after the participant's acceptance, as for goal snapshots (D2-SI-3, D2-SI-6). Pending, declined, withdrawn, removed or ineligible participants see no evidence.
- **BR-47 Participant read.** The participant reads snapshots only through the existing conversation read. The participant never receives source ids, source existence, or a read of the owner's private records.
- **BR-48 Completion (OD-6, approved 2026-11-10).** After a conversation is `completed`, selection of new evidence is rejected. Existing evidence may be cleared only as a whole set: no partial removal, no addition, no editing (SECURITY-REVIEW Amendment D, D2-SI-9a). Precedence as in BR-27: a non-empty selection is validated first (an invalid selection returns its validation error), then a valid one returns `conversation_completed`. Clearing is revocation, not a content change. Completion never deletes snapshots.
- **BR-49 Revocation.** Removing the participant, declining, withdrawing or ineligibility ends access to snapshots on the next request, as for all D2 content (D2-SI-8). Snapshots are not deleted by revocation; they are not readable by the participant.
- **BR-50 Deletion of the conversation.** Owner deletion of the conversation deletes its snapshots with it (existing D2 delete semantics).

### Deletion, removal and retention

- **BR-70 Source deletion does not erase snapshots.** Deleting a responsibility or achievement leaves every existing snapshot unchanged (AD-4, BR-26 of D2).
- **BR-71 Snapshot removal is separate.** Removing evidence from a conversation is an explicit owner action that removes the snapshot only.
- **BR-72 Revocation is separate.** Revoking access (removal of the participant, withdrawal, decline) keeps the snapshots stored but unreadable by that participant.
- **BR-73 Viewed copies.** The product does not promise that information already viewed or exported by a participant can be erased. The UI copy for removal states that the participant may already have seen the content.
- **BR-74 Retention.** Source records and snapshots have no TTL and no automatic expiry. They are removed by owner action or by account erasure (see "Account erasure").

### Verification of links and privacy

- **BR-60 Owner-scoped references.** Every goal, responsibility and achievement id in a request is checked against the verified owner's records. An unknown or foreign id rejects the request with a neutral `invalid_reference` error that does not reveal which record exists.
- **BR-61 No hidden sharing through goals.** An achievement linked to a goal does not cause the goal, its title or its id to appear in any conversation. Snapshots of achievements contain no goal link.
- **BR-62 No aggregation.** No team, org, admin or cross-user view, count, summary or ranking uses responsibilities, achievements, role assignments or snapshots.

## Edge cases and failure behavior

- **E-1 Concurrent edits.** Last write wins for source records (owner-only, low concurrency). Evidence selection is a single write; a concurrent conversation change returns `conversation_changed` and writes nothing. Implemented as a required `expectedUpdatedAt` precondition checked in the write transaction (D2 SPEC, Amendment 2026-11-11, "Version precondition").
- **E-2 Deleted goal referenced by an achievement.** Ignored in the UI (BR-22). The achievement is not deleted.
- **E-3 Deleted responsibility referenced by an achievement.** Ignored in the UI (BR-22).
- **E-4 Malformed stored record.** Visible to its owner only as a delete-only recovery item with no content, following the D1 and D2 pattern (D2-SI-13). Never repaired on read.
- **E-5 Encryption key missing or wrong.** Evidence reads and source-record reads return the existing `persistence_failed` path, with no ciphertext, key identifier or decryption error. A wrong or missing key is **never** classified as a malformed record and never produces a delete-only recovery item for owner content (the D2-SI-13 rule). Source-record deletion does not need the key. The classification table, the check order and the tests are in SECURITY-REVIEW §11.1 (C-5, approved 2026-11-10). They are applied in TASK-002, TASK-004 and TASK-007.
- **E-6 Size cap.** Each source text field has a maximum length (see schema). A selection that would exceed the body or payload cap is rejected with a neutral error and writes nothing.
- **E-7 Role definition archived.** Not reachable in the first increment. The deferred assigned-role contract covers this case.
- **E-8 Participant ineligible.** Snapshots are hidden on the next request. They are not deleted (D2-SI-8, CL-21).

## Security and privacy

Authoritative policy is `docs/SECURITY.md`. The following are feature-specific implications; the amendments are proposed in the next section.

- Source records are private to the owner. No admin, lead, team, superadmin or app-admin route reads them.
- Snapshots are readable only through the existing D2 access check and only after acceptance.
- The personal-record import allow-list is a static architecture and regression guard. It is not runtime authorization. The enforceable boundaries are the verified owner identity, server-side authorization, strict owner-scoped access, Firestore client denial, minimal DTOs and negative cross-user tests (SECURITY-REVIEW §11.4).
- Evidence snapshots are encrypted at rest with the existing AES-256-GCM helper (CL-18).
- Source records are encrypted at rest (OD-3, approved 2026-11-10): `title`, `description` and `outcome` are stored only inside an encrypted payload, using the existing AES-256-GCM helper. The UI and copy still discourage sensitive detail about colleagues.
- Assigned-role data (deferred) is separate from personal records and readable by the employee and by app admins who manage it only, with the access limit in "Assigned role contract".
- Logs and errors carry no title, description, outcome, id, level, role name or snapshot content (BR-23 pattern from role-profiles).
- Firestore client access is denied for all new paths (existing `userDevelopment` deny-all rule covers responsibilities and achievements; the assigned-role collection needs its own deny-all rule when built).

## Proposed security amendments

**Status: proposed. Not in effect. Not applied to `docs/SECURITY.md`. Requires security review and explicit approval before implementation.**

### PR-SI-1 — Personal records are owner-only (new)

Responsibilities and achievements live at `userDevelopment/{uid}/responsibilities/{id}` and `userDevelopment/{uid}/achievements/{id}`. Only the verified token uid reads or writes them through server routes using the Admin SDK. No admin, lead, team, membership, superadmin or app-admin route, query, collection group or export reads them. No uid, owner id or record id in a body or query can select another person's record.

### PR-SI-2 — Personal records are never aggregated (new)

No aggregate, count, team summary, coverage, roadmap, skill progress, survey result or ranking uses responsibilities or achievements. A static scope guard fails the build if any module outside an explicit importer allow-list imports the personal-record stores. The allow-list is the owner routes, the D2 evidence-selection module and the erasure adapter (corrected PR-SI-2, SECURITY-REVIEW §1).

### PR-SI-3 — Assigned roles are not personal development data (new, deferred)

When built, an assignment lives in a separate top-level collection `roleAssignments/{uid}`, not in `userDevelopment`. It is written only through Admin SDK routes behind `requireAppAdmin`. **Revised 2026-11-10 (OD-2, OD-7; pending approval, SECURITY-REVIEW §10.3 C-1, C-3, C-4):** the assignment carries history as an owner subtree (`roleAssignments/{uid}/history/{id}`, with effective start and end dates), and a server-only `assignedBy` audit field (the assigning administrator's uid). `assignedBy` is never returned to the employee or to any non-admin response. Its document never contains personal records, target roles, comparisons or conversation data. App-admin status allows assignment writes and assignment reads for role management, and grants no read of responsibilities, achievements, target roles, comparisons, snapshots or conversations. This needs an explicit amendment of RP-SI-3, which currently says app-admin status grants administration of role definitions only.

### PR-SI-4 — Target role is never an assigned role (new)

No API, DTO, copy string, UI label or stored field treats `roleTarget/current` as an assignment or a registered role. The company section reads only `roleAssignments/{uid}` (deferred) and `roleDefinitions` for the displayed role text.

### Amendment A — D2-SI-5 and invariant 59

**Current:** participants see only owner-selected goal snapshots; they never read D1 goals or goal ids; no C1, skill profile, C2, roadmap or `skillProgress` enters D2.

**Proposed:** participants see only owner-selected goal snapshots **and owner-selected evidence snapshots** (responsibility and achievement copies as defined by "Evidence snapshot schema"). They never read the source records, source ids, goal ids, responsibility ids, achievement ids, target role, assigned role or any other personal record. Evidence snapshots are the only addition to D2's content.

### Amendment B — D2-SI-16 and invariant 70

**Current:** D2 writes no `userDevelopment` goal, `skillProfiles`, `teamSkillNeeds`, `roadmapItems`, `skillProgress`, `userProfiles` or membership document, and reads D1 goals only for snapshot selection.

**Proposed:** D2 writes no `userDevelopment` responsibility or achievement document (source records), and reads them only for snapshot selection, through the owner-scoped store, with the verified owner uid. D2 still never writes personal source records, and still never reads target roles, assigned roles, C1 levels or skill profiles.

### Amendment C — invariant 70 extension for conversation evidence storage

**Proposed:** evidence snapshots are stored only inside an encrypted field of the owner conversation document (`sharedEvidence`), using the same mechanism as `sharedGoals` (CL-18). They are never stored in plaintext fields, subcollections or separate documents.

### Amendment D — D2-SI-9 and completion

**Proposed:** completion freezes evidence selection. After completion, evidence may only be cleared as a whole set (OD-6, approved 2026-11-10); partial removal, addition and editing are rejected. This is stated explicitly so that no completed conversation changes its evidence set except by removal.

## Architecture decisions

| ID | Decision | Status |
|---|---|---|
| AR-1 | Responsibilities at `userDevelopment/{uid}/responsibilities/{id}` and achievements at `userDevelopment/{uid}/achievements/{id}`, following the D1 owner-subtree pattern of `userDevelopment/{uid}/goals`. | Proposed |
| AR-2 | Evidence snapshots as an encrypted `sharedEvidence` array in the owner conversation document, mirroring `sharedGoals` (CL-18). Payload v2 per SECURITY-REVIEW §11.2. | Proposed (C2 pending approval) |
| AR-3 | Assigned roles, when built, at top-level `roleAssignments/{uid}`, separate from `userDevelopment`, written only by Admin SDK routes behind `requireAppAdmin`. | Proposed, deferred and blocked (C-1 to C-4) |
| AR-4 | Company role definitions stay in `roleDefinitions` (unchanged). | Approved (AD-1) |
| AR-5 | Target role stays at `userDevelopment/{uid}/roleTarget/current` (unchanged). | Approved (AD-1) |
| AR-6 | No Firestore composite index for the first increment; reads are owner-subtree lists with bounded limits. | Proposed |
| AR-7 | No TTL on source records or snapshots. | Proposed (BR-74) |

## Data shapes

**Encrypted fields (OD-3, approved 2026-11-10).** Responsibility `title`, `description`, and achievement `title`, `description`, `outcome` are stored only inside one encrypted payload, using the existing AES-256-GCM helper. The length and format rules below are validated on the plaintext before encryption and never repaired on read. The envelope fields (`ciphertext`, `iv`, `authTag`, `keyVersion`) and a configured-key check (`keyCheck`) are required. The failure classification is approved (SECURITY-REVIEW §11.1, C-5). The envelope size cap (R-2, 32 KiB) and the request body cap (R-1, 16 KiB) are proposed defaults (§11.5). Structured fields stay plain.

### Responsibility (`userDevelopment/{uid}/responsibilities/{id}`)

| Field | Required | Rule |
|---|---|---|
| `title` | yes | 1–120 characters, trimmed, no control characters |
| `description` | no | ≤ 2000 characters |
| `status` | yes | `active` \| `completed` |
| `relationToRole` | yes | `within` \| `beyond` \| `unspecified` (default `unspecified`) |
| `startDate` | no | `YYYY-MM-DD`, valid calendar date |
| `endDate` | no | `YYYY-MM-DD`, ≥ `startDate` when both set |
| `goalIds` | yes (may be empty) | ≤ 5 unique owned goal ids |
| `createdAt`, `updatedAt` | yes | server timestamps |

### Achievement (`userDevelopment/{uid}/achievements/{id}`)

| Field | Required | Rule |
|---|---|---|
| `title` | yes | 1–120 characters |
| `description` | yes | 1–2000 characters |
| `outcome` | no | ≤ 1000 characters |
| `periodStart` | no | `YYYY-MM-DD` |
| `periodEnd` | no | `YYYY-MM-DD`, ≥ `periodStart` when both set |
| `relationToRole` | yes | `within` \| `beyond` \| `unspecified` (default `unspecified`) |
| `goalIds` | yes (may be empty) | ≤ 5 unique owned goal ids |
| `responsibilityIds` | yes (may be empty) | ≤ 5 unique owned responsibility ids |
| `createdAt`, `updatedAt` | yes | server timestamps |

Per-person caps (OD-4 proposed): 100 responsibilities and 200 achievements. Caps are enforced count-then-create, with a small overshoot under concurrency accepted (as for goals, BR-7 of role-profiles).

Unknown fields are rejected. Client-supplied `uid`, `ownerUid`, `createdAt` and `updatedAt` are rejected or ignored, never stored.

### Evidence snapshot schema (inside encrypted `sharedEvidence`)

Responsibility snapshot:

`{ kind: "responsibility", title, description | null, status, relationToRole, period: { start: string | null, end: string | null }, capturedAt }`

Achievement snapshot:

`{ kind: "achievement", title, description, outcome | null, period: { start: string | null, end: string | null }, relationToRole, capturedAt }`

No `id`, no `goalIds`, no `responsibilityIds`, no owner uid, no `createdAt` or `updatedAt`. `capturedAt` is server time. The parser rejects extra fields and never repairs a value (the D2 snapshot pattern).

### Owner conversation document

Adds one encrypted field `sharedEvidence` (array, ≤ 10 items total: ≤ 5 `responsibility`, ≤ 5 `achievement`). An absent field reads as an empty list (backward compatible).

## Firestore access and validation

- **Paths:** `userDevelopment/{uid}/responsibilities/*`, `userDevelopment/{uid}/achievements/*`, and the encrypted field on `userDevelopment/{ownerUid}/conversations/*`. `roleAssignments/*` when built.
- **Client access:** denied. The existing `userDevelopment` deny-all rule covers the first two. `roleAssignments` needs its own deny-all rule when built. Firestore rules are **not** changed by this document.
- **Writes:** server routes only (Admin SDK), with the verified token uid. Strict allow-lists on body fields. Maximum lengths and counts as in the schemas. Server timestamps. No owner reassignment. Every cross-reference is checked against the owner's records (BR-60).
- **Reads:** owner-scoped, bounded (page size and maximum window set in the implementation task), no `collectionGroup`.
- **Errors:** neutral; no record content, id, title or ciphertext in errors or logs.
- **Indexes:** none needed for the first increment (AR-6).

## Account erasure

Account erasure is defined in `docs/features/account-erasure/SPEC.md`. This feature requires:

1. **New inventory rows.** First increment (proposed, SECURITY-REVIEW §11.3; added by a dated amendment to the account-erasure SPEC in TASK-002):
   - `userDevelopment/{uid}/responsibilities/*` (I-17) — owner subtree, DELETE, paged, step `personal_data`, no key needed.
   - `userDevelopment/{uid}/achievements/*` (I-18) — owner subtree, DELETE, paged, step `personal_data`, no key needed.
   - Evidence snapshots: covered by existing I-5 (test required; no new row).
   - Blocked, not in the first increment: `roleAssignments/{uid}`, its history, and the `assignedBy` actor row (§11.3).
   - `roleAssignments/{uid}` — when built, DELETE, one document.
   - `roleAssignments/{uid}/history/*` — when built (OD-2), DELETE, owner subtree, paged.
   - `assignedBy` on `roleAssignments/*` and history rows — when built (OD-7), ANONYMIZE: nulled for an erased administrator, never replaced with anything derived from the uid (AE-SI-7). This needs an actor-audit row (A-row) in the erasure inventory.
2. **Evidence snapshots** are inside the owner conversation document and are removed by the existing I-5 owner-conversation erasure. No separate erasure step is added for them.
3. **Participant side:** an erased owner's snapshots disappear with the erased owner's conversation. An erased participant loses access to snapshots through the existing participant-binding erasure (I-7/I-8 and the neutral participant block). No snapshot content is copied to the participant's own records. The I-7 re-encryption must preserve `sharedEvidence` byte-for-byte and fail closed on a key error (SECURITY-REVIEW §11.3).
4. **Write-path rows:** every new route (responsibilities, achievements, evidence selection) is added to the erasure write-path audit (W rows), with a verification step.
5. **Static guards:** the inventory guard fails if a new personal collection exists without an inventory row.

Erasure must leave no responsibility, achievement, evidence snapshot or assigned-role record for an erased uid.

## Backward compatibility and migration

- No data migration. No existing responsibility, achievement, evidence or assignment exists.
- The existing target role (`roleTarget/current`), role definitions, goals and conversations are unchanged. Existing conversation documents without `sharedEvidence` read as empty evidence.
- The route `/me/skills` and its query identifiers are unchanged. Only the displayed label of the view changes to `Min rolle og mine bidrag`. Existing tests that assert the old label are updated in the same task.
- Demo Team persists no responsibilities, achievements, assignments or evidence (same posture as role-profiles PO-3). Demo fixtures must not synthesize personal records.
- Existing documentation statements about `Rollesammenligning` are updated only by the documentation task after approval.

## Test boundaries

| Boundary | Covers |
|---|---|
| Server route contract (HTTP/handler with fake store) | BR-10–16, BR-20–24, BR-40–50, BR-60–62, E-1–E-6 |
| Firebase Firestore emulator with rules | PR-SI-1, owner-only access, deny-all client, `roleAssignments` deny (later) |
| Domain validators (pure) | Field allow-lists, lengths, dates, enums, counts, snapshot parser |
| Encryption round trip and failure classification (emulator-free, test key) | Amendment C2, E-5, C-5 (SECURITY-REVIEW §11.1) |
| Static scope guards | PR-SI-2, Amendment A/B import boundaries, no assigned-role use in target code (PR-SI-4) |
| Erasure inventory and guards | Account-erasure rows, W rows |
| UI component tests (React Testing Library) | BR-1–5, BR-16, BR-24, BR-23 ordering, no-assigned-role copy, evidence selection and removal copy |
| Browser checks (`pnpm verify:browser` and manual isolated emulator) | Responsive widths 320, 360, 390, 768, 1024, 1440; light and dark themes; keyboard and accessibility |

## Acceptance criteria

- [ ] An employee sees the workspace with the title, description, three distinct role sections and the no-assigned-role explanation when no assignment exists.
- [ ] The target role is never labelled as an assigned or registered role anywhere in UI copy or API response.
- [ ] An employee can create, edit, complete, reopen and delete responsibilities; invalid dates and oversized fields are rejected with no write.
- [ ] An employee can create, edit and delete achievements; links to own goals and responsibilities are validated; links to missing records do not break the page.
- [ ] No request can read or write another person's responsibility or achievement, including via linked ids (BR-60).
- [ ] No admin, lead, team, superadmin or app-admin route reads responsibilities or achievements.
- [ ] Evidence selection is owner-only, open-only, explicit, limited to 5 + 5 items, and atomic.
- [ ] Accepted participants see only selected evidence snapshots; pending, declined, withdrawn, removed and ineligible participants see none.
- [ ] Snapshots contain no source ids, goal ids or ownership metadata (BR-43).
- [ ] Editing or deleting a source does not change an existing snapshot (BR-70).
- [ ] Removing a snapshot hides it from the next read for both parties.
- [ ] Completed conversations reject new evidence selection; the only evidence change after completion is clearing the whole set (OD-6, approved 2026-11-10).
- [ ] Evidence snapshots are stored only in the encrypted `sharedEvidence` field (Amendment C).
- [ ] Account erasure removes responsibilities, achievements and owner conversations (including snapshots) for an erased uid, verified by the inventory guard.
- [ ] A wrong, missing or unavailable encryption key never makes a source record a deletable `malformed` item, and never causes a write or deletion as a result of decryption failure (SECURITY-REVIEW §11.1, C5 tests).
- [ ] Old conversations without `sharedEvidence` read as empty, and `sharedGoals` is unchanged (SECURITY-REVIEW §11.2, N-E10).
- [ ] No existing D1, D2, C1, C2, role-profiles or team behavior changes except the documented label change.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and the emulator security tests pass for each task that touches them, and their results are reported as run.
- [ ] `docs/SECURITY.md`, `docs/DATA-MODEL.md` and `docs/UI-UX.md` are updated only after their amendments are approved.

## Decision register (review of 2026-11-10)

The table below is the current status. The earlier "Decisions requiring approval" table that follows it is kept for history; where they differ, this register governs. Nothing here is applied to `SECURITY.md`, `DATA-MODEL.md`, Firestore rules or code. Analysis and proposed text: [SECURITY-REVIEW.md](./SECURITY-REVIEW.md).

| ID | Decision | Status | Notes |
|---|---|---|---|
| AD-1 | Company role model (definition, assigned, target) | Approved (product direction) | Assigned-role feature deferred |
| AD-2 | Owner-selected evidence snapshots, stored in `userDevelopment/{ownerUid}/conversations/{id}` | Approved (product direction) | Requires Amendments A–D, which are not approved |
| AD-3 | Relationship labels kept; self-reported; no comparison claim without an assigned role | Approved (product direction) | |
| AD-4 | Source deletion does not erase saved snapshots | Approved (product direction) | |
| OD-1 | Authorized role administrators (`requireAppAdmin`) may manage formal assignments; no access to personal records | **Approved 2026-11-10** | Mapping confirmed. Needs the RP-SI-3 amendment for assignment access (SECURITY-REVIEW §10.3, C-4) |
| OD-2 | Assignment history with effective start and end dates; current shown by default | **Approved 2026-11-10** | Not implemented. **Who may read history: open** (C-2). Needs the PR-SI-3 amendment (C-1) |
| OD-3 | Encrypt source `title`, `description`, `outcome` with the existing AES-256-GCM helper | **Approved 2026-11-10** | Supersedes the earlier "unencrypted" assumption in TASK-002 and TASK-004. Failure handling approved (C-5, SECURITY-REVIEW §11.1); envelope and size caps proposed (§11.5) |
| OD-4 | 100 responsibilities; 200 achievements per person | **Provisionally approved** | Count-then-create; lowering a limit never removes data (SECURITY-REVIEW §4) |
| OD-5 | 5 responsibility + 5 achievement snapshots per conversation | **Provisionally approved** | Separate from `SHARED_GOALS_MAX`. Worst-case document ≈ 175 KB, under the 1 MiB Firestore limit (SECURITY-REVIEW §5) |
| OD-6 | After completion: whole-set clear only; no partial removal, addition or editing | **Approved 2026-11-10** | Verified consistent with BR-27, BR-28, CL-26 and D2-SI-9 (SECURITY-REVIEW §6, §10.2 item 6) |
| OD-7 | Assigning admin's name not shown to the employee; audit metadata kept server-side | **Approved 2026-11-10** | Exact audit field, erasure row and retention are open (C-3, SECURITY-REVIEW §10.3) |
| OD-8 | Security amendments PR-SI-1–4, Amendments A–D | **Conditionally accepted for technical validation (2026-11-10). Not approved for application or implementation.** | Validation found conflicts C-1 to C-8 (SECURITY-REVIEW §10). Phase 2B: **NO-GO** |

**Corrections made during this review:**
- BR-48 and TASK-009: post-completion evidence removal is whole-set clear only (was "BR-27 unless OD-6 decides otherwise").
- PR-SI-2: the static guard uses an explicit importer allow-list, because the D2 selection path (PR-SI-1a) must read the source records. The earlier "no non-owner module" wording conflicted with that path.

## Decisions requiring approval (historical — see register above)

| ID | Question | Recommendation |
|---|---|---|
| OD-1 | Does a team admin, lead or app admin see the **assigned role** of an employee? (Deferred, but needed for the contract.) | Admins who manage roles may see assignments as role-management data. Nothing else of the person is visible. Approve before the deferred task. |
| OD-2 | Assignment history: keep previous assignments? | No history in v1; the current assignment only. Approve. |
| OD-3 | Are source responsibility and achievement texts encrypted at rest? | Not in the first increment, consistent with D1 goal titles (unencrypted, D1-P7). Encrypted evidence snapshots only. Approve, or require encryption of source records. |
| OD-4 | Per-person caps: 100 responsibilities, 200 achievements. | Approve. |
| OD-5 | Evidence limits: 5 responsibility and 5 achievement snapshots per conversation. | Approve (modelled on the goal limit of 5). |
| OD-6 | After completion, may the owner remove evidence snapshots? | Yes, clear-only, identical to BR-27 for goals, so that completion never blocks correcting a mistake. The owner must approve this reading of "completed-conversation immutability". |
| OD-7 | Assigned role visibility to the employee: may they see the assigning admin's name? | No. Show the role title and description only. Approve. |
| OD-8 | Approve Amendments A–D and PR-SI-1–4 as drafted, including the security review date. | Pending the security review. |

Items OD-1, OD-2 and OD-7 block only the deferred assigned-role task. OD-4, OD-5 and OD-8 block the first implementation increment as listed in `TASKS.md`. OD-3 and C-5 are approved. TASK-002 and TASK-004 remain blocked until the approvals G1 to G3 (SECURITY-REVIEW §11.8) are recorded. OD-6 is approved and blocks nothing further.

## Assigned role contract (documented, deferred)

Not implemented in the first increment (AD-1). **Blocked for implementation** until C-1 to C-4, the history access rule (C-2), the audit-field design (C-3) and a retention and erasure policy for history and `assignedBy` are approved (SECURITY-REVIEW §11.3).

- **Ownership:** the authorized app admin manages assignments. The employee cannot edit it.
- **Data:** `roleAssignments/{uid}` with `roleId` (existing `roleDefinitions` id), `assignedAt`, `updatedAt`. OD-2 adds history rows at `roleAssignments/{uid}/history/{id}` with `roleId`, `startDate`, `endDate` (effective dates, plain `YYYY-MM-DD`). OD-7 adds a server-only `assignedBy` audit field (admin uid) on assignment and history rows. The exact field set is a PR-SI-3 amendment, pending approval (SECURITY-REVIEW §10.3).
- **Assignment permission:** `requireAppAdmin`, the existing gate for `roleDefinitions`. App-admin status grants writes to assignments and reads of assignments for role management only (PR-SI-3). It grants no read of personal records (RP-SI-3 extended).
- **Visibility:** the employee reads their own current assignment (role title and description). Who may read the history is **open** (C-2): the employee, role management, or both. The assigning admin sees assignments through role management (OD-1). `assignedBy` is never shown to the employee (OD-7). Team admins, leads, members and superadmins see nothing new.
- **Lifecycle:** assign (one active assignment per person), replace, unassign. OD-2 keeps history: replace or unassign closes the current row with an `endDate` and does not delete it. Assignment to an archived role is rejected. If a role is archived after assignment, the employee sees the role with the note that the role is archived, and the company section still shows it.
- **Erasure:** `roleAssignments/{uid}` and `roleAssignments/{uid}/history/*` are deleted with the account (owner-subtree inventory rows). An erased administrator's `assignedBy` values on other people's assignments and history are nulled (ANONYMIZE, see "Account erasure").
- **Copy:** `Din registrerte rolle` for assigned roles; `Ditt utviklingsmål` for target roles. These phrases are never interchanged.

## Remaining open questions

Open after 2026-11-10, second pass (full detail in SECURITY-REVIEW §10 and §11):

- **C-1** Assignment history contract (OD-2) must be amended into PR-SI-3 before TASK-010. Deferred.
- **C-2** Who may read assignment history (OD-2): employee, role management, or both. Product decision, not decided. Deferred (TASK-010 only).
- **C-3** Exact `assignedBy` audit field, its retention and its erasure (OD-7). Deferred (TASK-010 only).
- **C-4** RP-SI-3 amendment for app-admin assignment access. Deferred (TASK-010 only).
- **C-5** Encryption failure handling: **approved** (SECURITY-REVIEW §11.1). Applied in TASK-002, TASK-004 and TASK-007.
- **C-6** BR-51 amendment for `sharedEvidence` (Amendment C2, §11.2): **prepared, awaiting approval**. Blocks TASK-006 and TASK-007.
- **C-7** First-increment erasure rows I-17, I-18 and write-fence rows W-19 to W-21 (§11.3): **prepared, awaiting approval**. Blocks TASK-002, TASK-004 and TASK-009. History and `assignedBy` erasure rows remain blocked (TASK-010).
- **C-8** Import boundary: **reclassified** as a static guard with documented exceptions (§11.4). The claim of bypass-proofing is withdrawn.
- **R-1 to R-4** (§11.5): proposed defaults awaiting approval. Block TASK-002 and TASK-004.

Implementation details (exact page sizes, file names, copy strings) are decided during implementation and do not need product approval unless they change behavior.
