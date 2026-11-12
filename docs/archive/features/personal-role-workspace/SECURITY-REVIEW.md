# Personal role workspace — security review packet

**Status (2026-11-10): OD-8 conditionally accepted for technical validation only. NOT APPROVED for application or implementation. Validation result: NO-GO for Phase 2B (§10). First-increment blockers (C-5 to C-8, R-1 to R-4) are resolved in documentation in §11; the first increment is NO-GO until the approvals in §11.8 are recorded.**

Nothing in this packet is in effect. `docs/SECURITY.md`, `docs/DATA-MODEL.md`, `firestore.rules`, and application code are unchanged. This packet proposes the replacement and addition text; the reviewer decides, and only an approved text is applied (TASK-001 and TASK-006 in `TASKS.md`).

Parent documents: [SPEC.md](./SPEC.md), [TASKS.md](./TASKS.md).

---

## 0. Access paths introduced

| # | Path | Actor | Data | Existing or new |
|---|---|---|---|---|
| P1 | Owner CRUD on responsibilities and achievements | Owner (verified uid) | Source records | New |
| P2 | Owner-initiated selection of evidence in a D2 conversation | Owner (verified uid), via D2 route | Reads own source records to copy fields | New read path into D2 |
| P3 | Participant read of evidence snapshots | Accepted participant | Encrypted snapshot copies only | New content in an existing D2 read |
| P4 | Account-erasure deletion of source records | Erasure runner | Source records of erased uid | New inventory rows |
| P5 | Assigned-role management (deferred) | Authorized role administrator (`requireAppAdmin`) | `roleAssignments/{uid}` | New, deferred |

No path reads source records for any actor other than P2 (owner-initiated, owner uid only). No path reads source records for a participant, admin, lead, team member or superadmin.

---

## 1. Personal record invariants

### PR-SI-1 — Personal records are owner-only

**1. Existing invariant or rule.** None for responsibilities or achievements. Closest: RP-SI-1 (owner-only target), RP-SI-3 (no other reader), D1 owner subtree `userDevelopment/{uid}/goals`.

**2. Exact proposed addition.**

> **PR-SI-1 (owner-only personal records).** Responsibilities at `userDevelopment/{uid}/responsibilities/{id}` and achievements at `userDevelopment/{uid}/achievements/{id}` are readable and writable only by the verified token uid through server routes using the Admin SDK. The only other read is the owner-initiated evidence selection in D2 (PR-SI-1a, below), which reads the owner's own records with the verified owner uid and copies only the fields in the evidence snapshot schema. No admin, lead, team, membership, superadmin, app-admin, participant or other user route, query, collection group or export reads these records. No uid, owner id or record id supplied in a body, query or path can select another person's record. Client Firestore access is denied.

> **PR-SI-1a (selection read is scoped).** The D2 selection read is an owner-scoped read of `userDevelopment/{verifiedOwnerUid}/…` only, for the duration of one selection request. It writes nothing to the source records and returns no source field to the caller.

**3. Reason for the change.** Responsibilities and achievements are the employee's private reflections. Their free text may mention colleagues, incidents or internal matters. They must not inherit access from roles, teams or conversations.

**4. New access paths.** P1 and P2 (read only for selection). No other new path.

**5. Potential privacy risks.**
- Scope creep: a later feature may add a read of the same collection for "convenience" (for example a team summary). Mitigated by PR-SI-2 and the static guard.
- The selection read touches the full record for copying. Mitigated by the field allow-list in the snapshot parser; the selection response returns only the snapshot shape.
- Erasure and retention are covered in SPEC "Account erasure".

**6. Required negative authorization tests.**
- Unauthenticated `GET/POST/PATCH/DELETE` on `/api/me/responsibilities` and `/api/me/achievements` → rejected (401).
- Employee B reads, edits and deletes employee A's responsibility by id → neutral `not_found`, no content, no write.
- A `uid` or `ownerUid` in body or query is rejected or ignored; the response never reflects it.
- Team admin, lead, member, superadmin and app admin each read and write their own records only; each other-user call returns the same neutral result (no difference in status or body that reveals existence).
- Firestore emulator: client SDK read and write of `userDevelopment/{uid}/responsibilities/*` and `…/achievements/*` denied for the owner and for others.
- Static guard: no `collectionGroup` query on these paths.
- Selection (P2): a foreign or unknown source id is rejected with no write and no content in the error.

**7. Compatibility with existing D2 behavior.** D2 already reads D1 goals for selection through the owner-scoped store (BR-24, CL-5). PR-SI-1a is the same pattern. D2's participant-facing rules are unchanged by PR-SI-1 (see Amendment B for the exact D2 change).

---

### PR-SI-2 — Personal records are never aggregated (corrected)

**1. Existing invariant or rule.** RP-SI-8 (no role data reaches D2, team skill needs, coverage, progress or roadmap). Team-analytics exclusions in SPEC §16.

**2. Exact proposed addition.**

> **PR-SI-2 (no aggregation; allow-listed importers).** No team, org, admin, survey, coverage, roadmap, skill-progress, role-comparison, ranking or analytics code reads or derives from responsibilities, achievements or evidence snapshots. The only modules permitted to import the personal-record stores are: the responsibility and achievement owner routes and their store; the D2 evidence-selection module (PR-SI-1a); and the account-erasure inventory adapter. A static scope guard fails the build if any other module imports those stores. **2026-11-10:** the guard is a change-detection review aid, not an access control, and it does not cover `scripts/` or non-literal imports (§10.2 item 10, conflict C-8).

*Correction note:* the SPEC's earlier wording ("no non-owner module imports the stores") conflicted with the D2 selection path (PR-SI-1a). This packet replaces it with an explicit allow-list.

**3. Reason for the change.** The original wording would have blocked the approved evidence feature. An explicit allow-list keeps the guard meaningful: any new importer is a visible, reviewed change.

**4. New access paths.** None. This states the boundary.

**5. Potential privacy risks.** A future aggregation feature that imports the store "for one count". Mitigated by the guard and by PR-SI-2's prohibition on derived output.

**6. Required negative authorization tests.**
- Static guard: fails when a non-allow-listed module imports either store (add a fixture file to prove the guard fails).
- Output test: no team, org or admin endpoint response contains a count, id or field derived from these records.

**7. Compatibility with existing D2 behavior.** Compatible: D2 selection is in the allow-list; D2 gains no output derived from the records beyond the snapshot.

---

### PR-SI-3 — Assigned roles are not personal development data (deferred)

**1. Existing invariant or rule.** RP-SI-3 (no other reader or assigner of targets), `requireAppAdmin` gate for `roleDefinitions` (RP-SI-4).

**2. Exact proposed addition.**

> **PR-SI-3 (assignments separate; admin scope limited to assignment).** An assigned role lives in top-level `roleAssignments/{uid}`, not under `userDevelopment`. It is written only by Admin SDK routes behind `requireAppAdmin`. It holds `roleId`, `assignedAt` and `updatedAt` only; it stores no actor uid. **Superseded in part on 2026-11-10 by Amendment E (§10.5): OD-2 adds history and OD-7 adds a server-only `assignedBy` (conflicts C-1, C-3).** Authorized role administrators (app admins, `requireAppAdmin`) may read and manage assignments for role management. This grants no read of responsibilities, achievements, goals, target roles, comparisons, conversations or evidence snapshots. The employee reads their own assignment's role title and description only.

**3. Reason for the change.** OD-1 approved administrator visibility of formal assignments for the deferred feature. The change keeps that approval from becoming a general read of personal records. The "authorized role administrators" wording is mapped to `requireAppAdmin` (see the decision register in SPEC.md, item OD-1, which requires this mapping to be confirmed).

**4. New access paths.** P5: admin read and write of `roleAssignments/{uid}`; employee read of own assignment.

**5. Potential privacy risks.**
- An admin can see which person holds which formal role, which is sensitive employment data. Accepted by OD-1 for the deferred feature.
- The assignment could be used to infer a team's role mix. Mitigated by PR-SI-2 (no aggregation).
- Without an actor uid there is no record of who assigned a role. Open: whether an audit field is needed (SPEC OD-2 / audit question).

**6. Required negative authorization tests** (when built).
- Non-admin employee attempts write → denied.
- App admin reads a person's responsibilities, achievements, goals, target role, comparison or conversations through any route → denied.
- Team admin, lead, member and superadmin read and write assignments → denied (unless they are also app admins).
- Client SDK read and write of `roleAssignments/*` → denied by emulator rules.
- Assignment to an archived or missing role → rejected with no write.

**7. Compatibility with existing D2 behavior.** No effect on D2. The assignment is never placed in a conversation.

---

### PR-SI-4 — Target role is never an assigned role

**1. Existing invariant or rule.** RP-SI-1–3 (target is owner-only, derived comparison). The product rule in SPEC AD-1.

**2. Exact proposed addition.**

> **PR-SI-4 (no conflation of target and assigned roles).** No API, DTO, copy string, UI label, stored field or log treats `userDevelopment/{uid}/roleTarget/current` as an assignment or a registered role. The company section reads only `roleAssignments/{uid}` (when built) and `roleDefinitions` for display text. Copy for a target role uses `Ditt utviklingsmål`. Copy for an assigned role uses `Din registrerte rolle`. The two are never interchanged.

**3. Reason for the change.** Confusing the two would present a self-chosen development goal as an employer's formal judgment, which AD-1 and PO-1 forbid.

**4. New access paths.** None.

**5. Potential privacy risks.** Misleading UI could be read as an employer statement about the employee. Mitigated by the copy rule and by a UI test.

**6. Required negative authorization tests and checks.**
- A test that the company-section component does not read `roleTarget/current`.
- A copy test that asserts the exact phrases above and forbids the other phrase in each context.
- An API test that a target-role response contains no `assigned` field.

**7. Compatibility with existing D2 behavior.** None.

---

## 2. D2 amendments

### Amendment A — D2-SI-5 and invariant 59

**1. Existing invariant or rule.**

> 59. Participants see only owner-selected goal snapshots. They never read D1 goals or goal ids. No C1 level, skill profile, C2 output, roadmap item or `skillProgress` enters D2, and D2 never writes them (D2-SI-5).

**2. Exact proposed replacement.**

> 59. Participants see only owner-selected snapshots: goal snapshots (BR-25) and evidence snapshots (responsibility and achievement copies with exactly the fields in the evidence snapshot schema). They never read D1 goals, personal responsibilities or personal achievements, nor any goal id, responsibility id or achievement id, nor the owner's target role, assigned role, comparison, C1 level, skill profile, C2 output, roadmap item or `skillProgress`. D2 never writes any of them (D2-SI-5, as amended).

**3. Reason for the change.** AD-2 approves owner-selected evidence sharing. The amendment widens participant content by exactly one kind of snapshot and excludes every identifier and every source.

**4. New access paths.** P3: accepted participant reads evidence snapshots inside the existing conversation read.

**5. Potential privacy risks.**
- The participant reads the owner's own descriptions and self-classifications (`Innenfor rollen` etc.). Their content is the owner's choice, but it may name colleagues or internal matters. Mitigation: explicit selection UI, a copy warning before selection, and the 5 + 5 limit.
- A snapshot might reveal the existence of source records. Mitigated: no ids, no source timestamps, no ordering key that maps to a source.
- Relationship classification might be read as an employer judgment. Mitigated by copy (AD-3).

**6. Required negative authorization tests.**
- Pending participant (before acceptance) reads a conversation with evidence → no evidence in response.
- Accepted participant reads → sees only the snapshots; response contains no id, goal link or source field (allow-list test).
- Accepted participant attempts to request a source record id directly (path or query) → `conversation_not_found`, neutral.
- Declined, withdrawn, removed and ineligible participants → no evidence, same neutral status as other D2 content.
- Owner removes an item → the next participant read no longer contains it.
- Team admin, lead, superadmin and app admin reading a conversation they do not own or are not bound to → `conversation_not_found`, no evidence.
- Response DTO key-set test against the evidence snapshot schema.

**7. Compatibility with existing D2 behavior.** Extends `sharedGoals`-style snapshot semantics (BR-25, BR-26, BR-27) to a second snapshot kind. Acceptance, invitation, participant limit (one), and the access-ending rules (BR-16, BR-17, D2-SI-8) are unchanged.

---

### Amendment B — D2-SI-16 and invariant 70

**1. Existing invariant or rule.**

> 70. D2 writes no `userDevelopment` goal, `skillProfiles`, `teamSkillNeeds`, `roadmapItems`, `skillProgress`, `userProfiles` or membership document. It reads membership only for the access and eligibility checks, and D1 goals only for snapshot selection (D2-SI-16).

**2. Exact proposed replacement.**

> 70. D2 writes no `userDevelopment` goal, responsibility or achievement document, nor `skillProfiles`, `teamSkillNeeds`, `roadmapItems`, `skillProgress`, `userProfiles`, `roleTarget`, `roleAssignments` or membership document. It reads membership only for the access and eligibility checks. It reads D1 goals, personal responsibilities and personal achievements only for the owner's snapshot selection, through the owner-scoped stores with the verified owner uid, and returns only the snapshot fields. It never reads target roles, assigned roles, C1 levels or skill profiles (D2-SI-16, as amended).

**3. Reason for the change.** Evidence selection needs an owner-scoped read of source records. The amendment names that read exactly and keeps every write prohibition.

**4. New access paths.** P2: D2 selection reads responsibilities and achievements of the verified owner.

**5. Potential privacy risks.** A selection bug could return a full source record instead of a snapshot. Mitigated by the parser and the response allow-list. A future feature could extend the read beyond selection; mitigated by the static guard allow-list (PR-SI-2).

**6. Required negative authorization tests.**
- Static guard: D2 modules may import the responsibility and achievement stores only from the selection module; no D2 module writes to those stores (a fixture proves the guard fails).
- Selection with a foreign or unknown id → `invalid_evidence_selection`, no write, no leak whether the id exists for another person.
- Selection request carrying an `ownerUid` or `uid` in the body → rejected or ignored.
- Emulator test: after a selection, the source record document is byte-identical to its state before (no write by D2).
- D2 selection cannot read `roleTarget/current` or `roleAssignments/*` (static guard).

**7. Compatibility with existing D2 behavior.** The existing D1 selection read (BR-24) remains. D2 still writes none of the listed collections. The one new read is owner-scoped and limited to selection.

---

### Amendment C — encrypted evidence storage (invariant 70 extension)

**1. Existing invariant or rule.** CL-18 and BR-51: named free-text fields are encrypted in the single `content` payload; plain fields are exactly sixteen keys.

**2. Exact proposed addition.**

> **Evidence storage (D2-SI-19, proposed).** Evidence snapshots are stored only as a field inside the encrypted `content` payload of the owner conversation document (`sharedEvidence`, an array), using the existing codec (CL-18, BR-51). They are never stored as plain fields, subcollections, separate documents or outside the encrypted payload. The BR-51 plain-field key set is unchanged. The `keyCheck` mechanism (CL-27) and failure classes are unchanged. An absent `sharedEvidence` reads as an empty list.

**3. Reason for the change.** Keeps the new free text under the same protection as goal snapshots and notes, without any new key, codec or plain field.

**4. New access paths.** None beyond P3.

**5. Potential privacy risks.** A future plain-field copy of evidence for a query would bypass encryption. Mitigated by a static test that the BR-51 plain-field key set has exactly sixteen keys.

**6. Required negative authorization tests.**
- Codec test: a stored document containing `sharedEvidence` as a plain field is rejected as malformed (delete-only recovery for the owner, invisible to participants).
- Encrypted round trip with the test key; tampered ciphertext → mapped failure.
- Wrong configured key → `persistence_failed` with no ciphertext, key id or decryption error in the response.
- BR-51 plain key-set test still passes with exactly sixteen keys.

**7. Compatibility with existing D2 behavior.** No change to BR-51 plain fields, CL-27 or existing documents. Existing conversations without `sharedEvidence` read as empty.

---

### Amendment D — completion (D2-SI-9, BR-27, BR-28)

**1. Existing invariant or rule.** D2-SI-9 (completion freezes content, never access). BR-27: after completion, `sharedGoalIds` may only be `[]`; a non-empty set returns `conversation_completed`. CL-26: clearing is allowed; adding and changing are not. BR-28: `sharedGoals` is clear only after completion.

**2. Exact proposed addition.**

> **Evidence after completion (D2-SI-9a, proposed).** After completion, `sharedEvidence` may only be cleared as a whole (set to empty). Any non-empty evidence set, and any partial removal, is rejected with `conversation_completed`. Evidence text is never edited by any operation; snapshots are immutable copies. Clearing evidence is a revocation of the participant's view, not a change to conversation content. Completion never deletes snapshots.

**3. Reason for the change.** Keeps the completed conversation's evidence the same as it was at completion, except for the owner's ability to withdraw it entirely. Matches BR-27 for goals and avoids a second, looser removal rule.

**4. New access paths.** None.

**5. Potential privacy risks.** The owner might clear evidence and the participant might have already seen it. Copy must say so (BR-73). A partial-removal request after completion is refused, so the owner must clear the whole set (a usability cost, accepted for consistency).

**6. Required negative authorization tests.**
- Completed conversation: adding one snapshot → `conversation_completed`, no write.
- Completed conversation: replacing the set with a non-empty set → `conversation_completed`, no write.
- Completed conversation: partial removal (non-empty result) → `conversation_completed`, no write.
- Completed conversation: whole clear → succeeds; the participant's next read has no evidence.
- Completed conversation: participant still sees non-evidence sections unchanged; participant leave still works (D2-SI-9).
- Source record edit or delete after completion → existing snapshot unchanged (BR-44).

**7. Compatibility with existing D2 behavior.** Exactly the BR-27 and CL-26 rule, applied to a second snapshot array.

---

## 3. Encryption decision (OD-3) — analysis and recommendation

### What the current model does

- D1 goal titles are stored **unencrypted** (D1-P7, accepted and documented, mitigated by copy, title-only minimisation and owner-only access).
- D2 owner text (`title`, `plannedFor`, `ownerNotes`, `nextSteps`, `sharedGoals`, `participantNotes`) is encrypted in the `content` payload (CL-18, BR-51).
- Responsibility and achievement fields proposed in the SPEC: `title`, `description`, `outcome` (free text); `status`, `relationToRole`, dates, link ids (structured).

### Sensitivity of the proposed free text

- `description` (up to 2000 characters) and `outcome` (up to 1000) are long, narrative fields. They are the fields most likely to contain other people's names, incidents, performance remarks about colleagues, security findings or unannounced company matters.
- Titles are short but can name people or projects.
- The records are never shown to anyone except the owner and, through explicit selection, the one invited participant as a snapshot. They are not shown to admins.

### Options

| Option | Protection | Cost |
|---|---|---|
| A. Unencrypted (D1 precedent) | Owner-only access rules, copy, minimisation | Text readable to anyone with database or operator access; no protection against a backup or export leak of free text |
| B. Encrypt `title`, `description`, `outcome` with the CL-18 codec | Free text is ciphertext at rest; same protection as conversation content | See consequences below |
| C. Encrypt `description` and `outcome` only; keep `title` plain | Long narrative protected; titles stay searchable | Titles remain exposed; mixed model |

### Recommendation: Option B

Encrypt the free-text fields of source records (`title`, `description`, `outcome`) with the existing CL-18 codec, and keep structured fields plain (`status`, `relationToRole`, dates, id arrays, timestamps). Reason: these records are a more concentrated form of sensitive information about colleagues and internal matters than a goal title, and the owner is already protected in D2 by encryption. Consistency with D2 matters more than consistency with D1.

### Consequences

- **Search:** no server-side text search or Firestore query on title, description or outcome. Client-side filtering after decryption is possible for owner lists of up to 100 and 200 records, but that is a UI decision with a bounded cost. Filtering by `status`, `relationToRole`, dates and link ids remains server-side and plain.
- **Filtering and sorting:** chronology (BR-23) uses plain date fields, so no change. Title sort happens after decryption.
- **Server processing:** every list read decrypts the bounded window. For 200 achievements at a few KB each the cost is small, but the implementation task must bound reads and fail neutrally on decrypt error.
- **Migration:** none for the first increment (new collection). A later move from D1-style plain goal titles to encrypted would need a migration; this proposal does not require it. Key rotation would require re-encryption of these records; the design must include `keyVersion` (as in the existing helper).
- **Failure and recovery:** a missing or wrong key makes source records unreadable for the owner. The owner sees a delete-only recovery item, as for D2 documents (D2-SI-13), and cannot repair. The key-check (CL-27) detects a wrong key before reads. This is the same operational dependency as D2, which already holds the owner's conversation content.
- **Erasure:** unchanged. Erasure deletes documents; it does not need the key.
- **Logs and errors:** no change; neither carries free text.
- **Persistence layer:** the codec is already in use; no new key or dependency.

### Decision needed

**Decided 2026-11-10: Option B approved (OD-3).** `title`, `description` and `outcome` are encrypted with the existing helper. TASK-002 and TASK-004 must gain the encryption step and the decrypt-failure test. The envelope and the wrong-key classification are not yet approved (conflict C-5, §10.4 and §10.5 Amendment G). The earlier Option A assumption no longer applies.

---

## 4. Limits (OD-4) and enforcement

- **Limits:** 100 responsibilities and 200 achievements per person (provisional).
- **Enforcement:** count-then-create, the D1 precedent (goal cap of 100). The count includes malformed stored documents so they cannot be used to bypass the cap (D1 precedent). A small overshoot under concurrent creates is accepted and documented (role-profiles BR-7 and D1 precedent). Lowering the cap is the only case that matters for existing data.
- **Existing data if a limit changes:**
  - Raising a limit needs no migration.
  - Lowering a limit never deletes, hides or blocks the owner from reading, editing, completing or deleting existing records. It only blocks new creation while the count is at or above the new limit.
  - Reads stay bounded; the owner can page through all records.
- **Where the limit lives:** a single named constant per record type in the domain module, with a test that asserts the value (so changes are deliberate).

---

## 5. Evidence limits (OD-5) and document size

- **Limits:** at most 5 responsibility snapshots and 5 achievement snapshots per conversation (10 total). Separate from `SHARED_GOALS_MAX = 5`.
- **Enforcement:** the selection request is validated as a whole. More than the limit → rejected with no write. The selection request carries only ids (≤10 short ids), far below the 32 KiB request cap (BR-40).
- **Document size estimate (worst case, UTF-8 bytes):**
  - Responsibility snapshot: title ≤120 code points ≈ 480 B; description ≤2000 code points ≈ 8 000 B; fields and keys ≈ 300 B. About 8.8 KB each.
  - Achievement snapshot: title ≈ 480 B; description ≈ 8 000 B; outcome ≤1000 code points ≈ 4 000 B; keys ≈ 300 B. About 12.8 KB each.
  - Evidence maximum: 5 × 8.8 + 5 × 12.8 ≈ 108 KB.
  - Existing payload maximum (D2 content, from the SPEC caps): title 400 B, notes 2 × 4 KB, next steps 10 × 800 B, goal snapshots 5 × about 0.5 KB, keys. About 20 KB.
  - Total plaintext worst case ≈ 130 KB. After AES-GCM (12 + 16 bytes) and base64 encoding, about 175 KB.
  - Firestore's documented per-document limit is 1 MiB (1 048 576 bytes). The worst case uses about 17% of it.
- **Test:** a boundary test with all fields at maximum length, asserting the stored document stays under 1 MiB with the encoded payload. (Fails if a future cap change pushes the document over.)
- **Caveat:** the estimate assumes the caps stay as proposed. A future increase to description length must re-run this estimate.

---

## 6. Completion (OD-6) — verified D2 contract and the proposed rule

Verified in `docs/features/development-conversations/SPEC.md`:
- BR-28: after completion, `title`, `plannedFor`, `ownerNotes`, `nextSteps` and participant identity are frozen (removal allowed, replacement and addition not). `sharedGoals` is clear-only.
- BR-27 and CL-26: after completion, `sharedGoalIds` may only be `[]`. A non-empty set returns `conversation_completed`. Clearing is revocation, not a content change.
- D2-SI-9: completion freezes content, never access. The owner can still remove the participant, clear snapshots and delete. The participant can still leave.

**Proposed rule for evidence (D2-SI-9a):** after completion, evidence may only be cleared as a whole. No addition, no partial removal, no edit. This is the BR-27 rule applied to evidence.

**Distinction the owner asked for:**
- **Revoking access** (participant removal, decline, withdrawal, ineligibility, owner clearing evidence) takes effect on the next read. It is allowed after completion, and it does not change what the conversation said.
- **Modifying historical content** (adding evidence, editing text, partial changes) is not allowed after completion. Snapshots are immutable copies.

**Resolved 2026-11-10 (OD-6 approved):** after completion, evidence may only be cleared as a whole set. Partial removal, addition and editing are rejected. Verified against BR-27, BR-28, CL-26 and D2-SI-9; the rule matches the shared-goals behavior. The stricter version in this packet is adopted.

---

## 7. Compatibility summary

| Item | Compatible? | Notes |
|---|---|---|
| Existing D2 invitation and acceptance | Yes | Unchanged |
| One-participant limit | Yes | Unchanged (D2-SI-4) |
| Goal snapshots (BR-24–27) | Yes | Unchanged; evidence is a parallel array |
| BR-51 plain-field key set (16 keys) | Yes | Evidence is inside the encrypted payload |
| CL-27 key check | Yes | Unchanged |
| D1 goal storage | Yes | Unchanged; D1-P7 still applies to goals |
| Role-profiles RP-SI | Yes | No target or assignment data reaches D2 |
| Account erasure | Requires new inventory rows | See SPEC "Account erasure" |

---

## 8. Account erasure requirements (for the security reviewer)

- New inventory rows: `userDevelopment/{uid}/responsibilities/*`, `userDevelopment/{uid}/achievements/*` (DELETE, owner subtree, paged). `roleAssignments/{uid}` when built (DELETE).
- Evidence snapshots are removed with the owner conversation (existing I-5).
- An erased participant loses binding and access through the existing participant erasure (I-7, I-8 and the neutral participant block). No snapshot is copied to the participant's data.
- Inventory guard fails if a new personal collection has no row.

---

## 9. Items for the reviewer to decide

1. Approve or reject PR-SI-1 through PR-SI-4, including the corrected PR-SI-1a and PR-SI-2 allow-list.
2. Approve or reject Amendments A–D, including D2-SI-19 (evidence storage) and D2-SI-9a (completion).
3. Choose the encryption option for source records (OD-3): recommended B.
4. Confirm the limits (OD-4, OD-5) and the 1 MiB estimate method.
5. Confirm that "authorized role administrators" (OD-1) means `requireAppAdmin` holders.
6. Confirm the completion rule (OD-6).

No amendment is applied until the reviewer records an explicit approval in SPEC.md.

**2026-11-10 status of §9:** item 3 decided (Option B, OD-3); item 5 approved (OD-1, `requireAppAdmin`), with the RP-SI-3 amendment still required (C-4); item 6 approved (OD-6). Items 1, 2 and 4 remain open and are covered by §10.

---

## 10. Phase 2A final validation (2026-11-10)

**Verdict: NO-GO for Phase 2B.** The product decisions are recorded in SPEC.md. The security packet is not yet internally consistent, and item 10 of the owner's validation list cannot be met as written. Nothing in this section is applied. `docs/SECURITY.md`, `docs/DATA-MODEL.md`, `firestore.rules`, `TASKS.md` and application code are unchanged.

### 10.1 Decisions recorded

- **Approved:** OD-1, OD-2 (history contract; reader open), OD-3, OD-6, OD-7. See SPEC "Owner decisions of 2026-11-10".
- **Conditionally accepted for technical validation only:** OD-8. Acceptance does not authorize applying amendments or implementing Firestore rules, routes or sharing.
- **Unchanged:** OD-4 and OD-5 (provisionally approved).

### 10.2 Validation results (owner items 1–10)

| # | Check | Result | Evidence in the repository | Action |
|---|---|---|---|---|
| 1 | Invariants are mutually consistent | **FAIL** | Conflicts C-1 to C-4 and C-6 | Amend and decide |
| 2 | Source encryption follows the key-management rules | **CONDITIONAL** | `src/lib/encryption/encryption.ts` reads `ENCRYPTION_KEY` per call, fails closed, and writes `keyVersion` `v1`. Server-only (invariants 4, 5). The D2 codec adds a `keyCheck` (CL-27) and fixed failure classes; source records need the same wrong-key rule. | C-5, §10.4 |
| 3 | The owner-scoped D2 selection path cannot read another user's records | **PASS (design)** | Precedent `src/features/development-conversations/server/read-owned-goal-snapshots.ts`: the owner uid comes only from the owner operation and never from a request. The packet does not yet state an addressable-id rule for responsibility and achievement ids (D2 uses `^[A-Za-z0-9_-]{1,128}$` and rejects `__`). | R-3 |
| 4 | Participant DTOs contain only explicitly selected snapshot fields | **PASS (requirement)** | Invariant 68 and D2 allow-list; BR-43. Requires the DTO key-set test in §10.6. | Test |
| 5 | Existing goal snapshots stay backward compatible | **CONDITIONAL** | `sharedGoals` is unchanged. But BR-51 fixes the encrypted payload at exactly five keys, and the codec serializes "the exact D2 content fields". An absent `sharedEvidence` must read as `[]`. Code that predates `sharedEvidence` would classify a document that contains it as malformed (delete-only for the owner). | C-6 |
| 6 | Completed conversations permit only the whole-set clear | **PASS** | BR-27, BR-28, CL-26 and D2-SI-9 apply to goals. OD-6 applies the same rule to evidence. Precedence (validate first) is mirrored in SPEC BR-48. | None |
| 7 | Account erasure covers all new collections and encrypted snapshots | **FAIL (gap)** | Evidence snapshots are inside the owner conversation, covered by I-5 (**PASS**). Responsibilities and achievements have proposed rows (§8). Missing: `roleAssignments/{uid}/history/*`, the `assignedBy` actor row (AE-SI-7), and W rows for the new write routes. | C-7 |
| 8 | Firestore document size and payload limits are enforced safely | **CONDITIONAL** | Arithmetic checked: evidence plaintext worst case about 108 KB; with existing D2 content about 130 KB; after AES-GCM and base64 about 175 KB, under the 1 MiB limit. Source records are small (achievement worst case about 13 KB plaintext, about 17 KB encoded). Gaps: no body cap for the source-record write routes (only D2's 32 KiB, BR-40); the size check must apply to the encrypted envelope before the write. | R-1, R-2 |
| 9 | Negative authorization tests exist for every new access path | **CONDITIONAL** | P1, P2, P3 and P5 are covered in §1–§6. Missing: P4 erasure negative tests; wrong-key and tamper tests for source records; history read tests (depend on C-2); `assignedBy` non-leak tests (C-3); body-cap tests; DTO key-set tests for the source-record routes. | §10.6 |
| 10 | The import allow-list cannot be bypassed by alternate server modules | **FAIL as written** | `personal-goals-scope-guard.test.ts` walks only `src/` and `app/` (`walk("src")`, `walk("app")`). It resolves literal relative, re-export, dynamic and `require` specifiers. Its own header says it does not cover non-literal specifiers, aliases other than `@/`, or code outside `src/` and `app/`, and that it is lexical and not a security boundary. RP-SI-12 says the same. `tsconfig.json` defines only `@/*` today. Tracked files outside the scanned roots already reference `userDevelopment`: `scripts/seed-demoteam-conversations.ts` and `scripts/seed-demoteam.mjs` (seed scripts, not scanned). | C-8 |

### 10.3 Unresolved conflicts

**C-1 — OD-2 history vs the PR-SI-3 data contract.** PR-SI-3 says the assignment holds `roleId`, `assignedAt` and `updatedAt` only, with no history. OD-2 approves history with effective dates. The approved decision governs, and the invariant must be amended (Amendment E). Blocks TASK-010 only.

**C-2 — Who may read assignment history is not decided.** OD-2 says the current assignment is shown by default. It does not say who may read history: the employee, role management, or both. The packet does not invent this. Recommendation: the employee reads their own history, and role management reads history for the people it manages. No other role reads it. **Owner decision needed.** Blocks TASK-010 only.

**C-3 — OD-7 audit metadata vs "stores no actor uid".** OD-7 keeps audit metadata, which needs a stored administrator uid. PR-SI-3 forbids that. Amendment E stores `assignedBy` server-side only, never in any response, and nulls it when that administrator is erased. Blocks TASK-010 only.

**C-4 — RP-SI-3 vs app-admin assignment access.** RP-SI-3 states that app-admin status "grants administration of role definitions only". PR-SI-3 extends app-admin status to assignment reads and writes. A durable invariant must not be extended silently. Amendment F states the change explicitly. It is a change to SECURITY.md, so it needs approval and TASK-001 or TASK-010 must apply it. Blocks TASK-010.

**C-5 — A wrong key on encrypted source records.** Under OD-3, source documents are ciphertext. Without a rule, a missing or wrong `ENCRYPTION_KEY` would fail decryption. The D2 malformed-document pattern (D2-SI-13) would then show every owner a delete-only item for each record. That invites deletion of data because of a configuration fault. Amendment G adds a plain `keyCheck` and separates key failures from malformed content. Blocks TASK-002 and TASK-004.

**C-6 — BR-51 and the rollback rule for `sharedEvidence`.** Amendment C says "BR-51 unchanged". It is not: BR-51 fixes the encrypted payload at exactly five keys, and the D2 codec serializes fixed fields. Amendment C must amend the payload key set, define "absent reads as `[]`", and state the rollback rule. Blocks TASK-006 and TASK-007.

**C-7 — Erasure gaps.** Add: the `roleAssignments/{uid}/history/*` owner-subtree row (DELETE); an actor row for `assignedBy` (ANONYMIZE, AE-SI-7); and W rows for each new write route, as the erasure write-path audit requires. Blocks TASK-010 (history and `assignedBy`) and the erasure verification of TASK-002 and TASK-004.

**C-8 — "Cannot be bypassed" is not true for the import allow-list.** The guard is change-detection (item 10, RP-SI-12). The real owner-only guarantee comes from verified-uid server routes, the Firestore deny-all rule for client access, the actor × operation authorization matrix, and code review. Options: **(a)** accept the guard as a review aid and say so in PR-SI-2 (recommended; see Amendment I); **(b)** also extend it to `scripts/`, `browser/` and tsconfig path aliases, and reject non-literal specifiers. Option (b) reduces risk but cannot make the guard a complete control. **Decision needed.**

### 10.4 Implementation requirements (not conflicts, but binding on TASK-002, TASK-004 and TASK-007)

- **R-1 Body cap.** Responsibility and achievement write routes use a streamed body cap, as BR-40 does. Proposed: **16 KiB**. The largest achievement plaintext is about 12.8 KB, so this leaves room for JSON overhead. Reviewer to confirm the value.
- **R-2 Envelope size.** The size check applies to the encrypted envelope, after base64 encoding and before the write. A document over the limit fails with a neutral error and writes nothing.
- **R-3 Ids as path segments.** Responsibility and achievement ids follow D2's addressable-id rule (`^[A-Za-z0-9_-]{1,128}$`, no `__`). Ids are never trimmed or repaired.
- **R-4 Codec location.** The D2 codec lives under `development-conversations/server`. Importing it from the personal-records module changes an importer allow-list. Put the shared envelope logic in a neutral module with its own guard entry, or add an exact file-name entry. Decide in TASK-002.

### 10.5 Exact amendments ready for approval

Nothing below is in effect until approved and applied to `SECURITY.md` (and to `DATA-MODEL.md` where a shape is named).

**Superseded in part by §11 (2026-11-10):** Amendment C is replaced by C2 (§11.2); Amendment G is replaced by the revised PR-SI-5 (§11.1); Amendment I is replaced by §11.4. Amendments E, F, D and H stand, subject to §11.8.

**Amendment E — PR-SI-3 (revised, deferred).**

> **PR-SI-3 (assignments separate; history; server-only audit).** An assigned role lives in top-level `roleAssignments/{uid}`, not under `userDevelopment`. History lives at `roleAssignments/{uid}/history/{id}`. Both are written only by Admin SDK routes behind `requireAppAdmin`. The current document holds `roleId`, `assignedAt`, `updatedAt` and `assignedBy`. A history row holds `roleId`, `startDate`, `endDate` (effective dates, `YYYY-MM-DD`) and `assignedBy`. `assignedBy` is the assigning administrator's verified uid. It is server-only, appears in no response, and is nulled by the erasure ANONYMIZE step when that administrator's account is erased (never replaced by anything derived from the uid). Neither collection stores personal records, target roles, comparisons or conversation data. Reader of history: **[pending C-2]**.

**Amendment F — RP-SI-3 (revised; explicit change to a durable invariant).**

> **RP-SI-3 (no other reader or assigner).** No admin, lead, team, member or app-admin route reads or writes any person's target, comparison, responsibility, achievement, goal or conversation. App-admin status grants administration of role definitions (RP-SI-4) and management of assignments in `roleAssignments` (PR-SI-3). It grants nothing else.

**Amendment G — PR-SI-5 (source records encrypted, OD-3; new).**

> **PR-SI-5 (source records encrypted).** The `title`, `description` and `outcome` of responsibilities and achievements are stored only inside one payload encrypted with the existing AES-256-GCM helper (`src/lib/encryption`). The stored envelope is `{ ciphertext, iv, authTag, keyVersion, keyCheck }`, where `keyCheck` is the CL-27 derivation over the same configured key. Plain fields are the structured fields in SPEC "Data shapes" plus the envelope. A missing key, a `keyCheck` mismatch or an authentication failure returns `persistence_failed`, with no ciphertext, key identifier or decryption error. It is never classified as a malformed record. Only a structurally invalid plaintext that passed authentication is a malformed record, and it is shown to the owner as a delete-only `{ id }`. Deletion needs no key.

**Amendment C (corrected) — D2-SI-19 (evidence storage) and BR-51.**

> **D2-SI-19 (proposed, corrected).** Evidence snapshots are stored only in the `sharedEvidence` array inside the encrypted `content` payload. The BR-51 encrypted payload key set becomes `{ title, ownerNotes, nextSteps, participantNotes, sharedGoals, sharedEvidence }`. An absent `sharedEvidence` reads as `[]`. The sixteen plain-field keys and CL-27 are unchanged. Rollback: code that predates `sharedEvidence` treats a document that contains it as malformed. Before any rollback of the evidence feature, all evidence must be cleared through the whole-set operation (OD-6).

**Amendment D (unchanged in substance; OD-6 approved).**

> **D2-SI-9a.** After completion, `sharedEvidence` may only be cleared as a whole set. A non-empty selection is validated first (BR-48). A non-empty result, a partial removal, an addition or an edit returns `conversation_completed` and writes nothing. Snapshots are never edited. Completion never deletes snapshots.

**Amendment H — erasure inventory (C-7).** Proposed rows: `roleAssignments/{uid}/history/*` (DELETE, owner subtree, paged, when built); `assignedBy` on `roleAssignments/*` and history rows (ANONYMIZE, actor row, when built). Responsibilities and achievements keep the rows in §8. Each new write route gets a W row with a verification step.

**Amendment I — PR-SI-2 (corrected wording, option C-8(a)).**

> **PR-SI-2 (no aggregation; allow-listed importers).** Unchanged in scope. The import allow-list is a change-detection review aid. It is not an access control. Access control for personal records is the verified-uid server routes, the Firestore deny-all rule for client access, and the authorization matrix (RP-SI-12).

### 10.6 Tests required before implementation can be considered complete

- **Negative, foreign and unknown ids:** every read, write, delete and selection with another person's or an unknown responsibility, achievement, goal or history id returns the same neutral result with no write. No error reveals existence.
- **Negative, client-supplied identity:** `uid` and `ownerUid` in body, query or path are rejected or ignored, and never reflected.
- **Negative, admin reads:** app admin, team admin, lead, member and superadmin each fail to read responsibilities, achievements, goals, target role, comparison and conversations through every route.
- **Negative, assignments:** the employee's response never contains `assignedBy`; team roles and superadmin cannot read or write `roleAssignments`; app admin can only manage assignments.
- **Encryption:** wrong key → `persistence_failed`, not `malformed`; missing key → `persistence_failed`; tampered ciphertext → mapped failure; deletion works with a wrong key; ciphertext contains no plaintext substring.
- **Body and size:** a body over 16 KiB → `payload_too_large` before parsing; an encrypted envelope over the cap → neutral failure, no write; a maximum-length record stays under 1 MiB (boundary test).
- **Completion (D2):** add one snapshot after completion → `conversation_completed`; partial removal → `conversation_completed`; whole clear → succeeds; a source edit or delete leaves the snapshot unchanged.
- **Visibility:** pending, declined, withdrawn, removed and ineligible participants receive no `sharedEvidence`. DTO key-set tests for the participant read, the employee assignment read, and the source-record routes.
- **Codec:** absent `sharedEvidence` → `[]`; `sharedEvidence` present as a plain field → malformed; the BR-51 encrypted key set is six keys; the plain key set is sixteen.
- **Erasure:** the inventory guard fails for a new collection without a row; erasing an administrator nulls `assignedBy` in current and history rows; erasing a person leaves no responsibility, achievement, snapshot or history row for that uid (emulator).
- **Static guards:** the allow-list fixture proves the guard fails for a non-allow-listed importer; no `collectionGroup` query on the new paths.
- **Emulator rules:** client read and write are denied for `userDevelopment/*/responsibilities`, `…/achievements`, `roleAssignments/*` and its history.
- **Copy (PR-SI-4):** the target-role and assigned-role phrases are never interchanged.

### 10.7 GO / NO-GO for Phase 2B

**NO-GO.** Phase 2B is not authorized. Reasons:

1. C-1, C-3 and C-4: assignment-related invariants conflict with the approved OD-2 and OD-7 decisions and with RP-SI-3.
2. C-5 and C-6: the encryption envelope and the payload contract are incomplete.
3. C-7: erasure does not yet cover the assignment history or the actor field.
4. C-8: the import allow-list cannot be presented as a bypass-proof control.
5. R-1 to R-4 are not yet in the implementation tasks.

**Conditions for GO:**

- Amendments C (corrected), E, F, G, H and I are approved and applied to `SECURITY.md` in the approved form (TASK-001 and TASK-006).
- C-5, C-6 and C-8 are decided, and R-1 to R-4 are accepted into `TASKS.md`.
- C-2 is decided, or history read access is deferred. The assigned-role task (TASK-010) stays deferred until C-1 to C-4 and C-7 (history rows) are approved.
- `TASKS.md` is updated for OD-3 (TASK-002, TASK-004), OD-6 (TASK-006, TASK-009) and the OD-2, OD-7 blockers (TASK-010). It is out of scope for this validation.
- This validation is run again on the approved text.

**Partial path.** The first increment (TASK-002 to TASK-009) does not depend on C-1 to C-4, C-2 or the history rows of C-7. The first-increment path is now set out in §11.8. TASK-010 stays NO-GO until its conflicts are resolved.

---

## 11. First-increment blockers (second pass, 2026-11-10)

**Status: documentation only. Not in effect.** Nothing here changes `docs/SECURITY.md`, `docs/DATA-MODEL.md`, `firestore.rules`, the account-erasure SPEC or application code. Those changes happen in the tasks named in `TASKS.md` after the approvals in §11.8. Assigned-role implementation and its permissions are not changed by this section.

### 11.0 Approval status of this section

| Item | Status after this pass |
|---|---|
| C-5 encryption failure handling (§11.1) | **Approved requirement** (product owner, 2026-11-10) |
| C-8 import boundary wording and guard scope (§11.4) | **Adopted** as the owner directed on 2026-11-10 (static guard; enforceable boundaries listed) |
| C-6 BR-51 amendment for `sharedEvidence` (§11.2) | **Prepared, not approved** |
| C-7 first-increment erasure rows, order and tests (§11.3) | **Prepared, not approved** |
| R-1 to R-4 (§11.5) | **Proposed defaults, not approved** |

### 11.1 C-5 — Encryption failure handling

**Requirement (approved).** A wrong or unavailable encryption key must not cause encrypted source records to be classified as malformed user data. Authentication failures, encryption configuration or decryption failures, schema failures and missing records are distinct outcomes. The system fails closed. It never deletes, overwrites or exposes a record because decryption failed.

**Failure classes.**

| Class | Detected by | Result to the caller | Owner can delete it? | Written? |
|---|---|---|---|---|
| A. Authentication or authorization | Verified token; owner scope | `401`, `403`, or neutral `not_found` (existing) | Not applicable | No |
| B. Encryption configuration unavailable or invalid (`ENCRYPTION_KEY` missing, or not 32 bytes base64) | Key accessor | `persistence_failed` for the whole request, no items | No | No |
| C. Key mismatch (`keyCheck` differs from the configured key) | `keyCheck` compare, before decrypt | `persistence_failed` for the whole request, no items, no ids | No | No |
| D. Authenticated decryption failure (GCM tag fails although `keyCheck` matched: corruption or tampering) | GCM `final()` | Record-level `unavailable` entry with no id, no content and no delete action | No, by product rule | No, for that record |
| E. Schema failure after successful authenticated decryption (plaintext outside the allow-list) | Parser | `malformed` entry with `{ id }` only, delete-only (D1 and D2 pattern) | Yes, delete-only | No repair |
| F. Missing record | Path read | Neutral `not_found` | Not applicable | No |

**Rules.**

1. Every read or write of an encrypted record runs the checks in order: key valid, then `keyCheck`, then authenticated decrypt, then schema parse. A failure at one step stops the sequence. A later class cannot be reached after an earlier failure.
2. Only class E may produce a deletable item. Classes B, C and D never produce `malformed`.
3. Class D is not deletable in the product. Deleting it could destroy the only copy when the cause is a key-rotation error or a transient fault. Recovery is an operator matter outside the product. Account erasure still removes such a record by path (§11.3).
4. Deletion by explicit owner action on a known id does not decrypt and does not depend on the key. It is never a consequence of a decryption failure. Path-based erasure works the same way.
5. Create checks classes B and C first. It reads only plain `keyCheck` fields of the owner's existing records (bounded). On mismatch it refuses with `persistence_failed` and writes nothing. Update decrypts the current record first. Any class B to D failure refuses the update, and the stored document stays byte-identical. An update is never built from partial data.
6. List: a class B or C failure returns `persistence_failed` for the whole list, with no items. A class D failure returns an `unavailable` entry with no id.
7. Logs and errors carry only the error code. They never carry ciphertext, `keyCheck`, key identifiers, auth-tag errors, titles, descriptions or outcomes (invariant 5, AE-SI-12).
8. No fallback key, no retry that writes, and no automatic repair.

**Tests (C5-tests; all required before TASK-002 and TASK-004 are complete).**

- C5-1 Wrong key: list returns `persistence_failed`, zero items, no id, no `malformed` entry.
- C5-2 Missing key and invalid key length: the same result. The error body contains no key bytes or key length detail.
- C5-3 Tampered ciphertext with matching `keyCheck`: `unavailable` entry, no id, no delete action.
- C5-4 Valid ciphertext whose plaintext fails the schema: `malformed` entry carrying only `{ id }`; delete works; no repair write occurs.
- C5-5 Create under a mismatched `keyCheck`: refused, no write.
- C5-6 Update of a record in class B, C or D: refused, stored document byte-identical.
- C5-7 Delete under a wrong key: succeeds by path; the decrypt function is not called (spy).
- C5-8 Erasure under a wrong key deletes the subtree and reports a neutral status (§11.3, E-4).
- C5-9 Failure injection across classes B to D: a `malformed` item never appears (property test).
- C5-10 Log and response capture: no ciphertext, `keyCheck`, key identifier, auth-tag text or plaintext substring appears.
- C5-11 The stored document contains no plaintext substring of `title`, `description` or `outcome`.

### 11.2 C-6 — Amendment C2: BR-51 for `sharedEvidence` (prepared, not approved)

This replaces Amendment C in §10.5. It does not modify the production codec. The codec change lands in TASK-007 under the rules below.

> **BR-51 (amended for evidence, D2-SI-19).** The encrypted `content` payload has one of two exact key sets:
> - **Payload v1 (existing, unchanged):** `{ title, ownerNotes, nextSteps, participantNotes, sharedGoals }`.
> - **Payload v2:** `{ title, ownerNotes, nextSteps, participantNotes, sharedGoals, sharedEvidence }`.
>
> The plain fields remain exactly the sixteen keys of BR-51. No plain field carries evidence or any part of it.

**Version handling.**

- No new plain key is added. The content version is inferred from key presence. The stored envelope's `keyVersion` (`v1`, the helper's encryption key version) is a different concept and does not change.
- The decoder accepts exactly the v1 or the v2 key set. Any other key, any extra key, and any non-array `sharedEvidence` (including `null`) is `malformed_payload`.
- After the v2 codec is deployed, each successful write serializes v2, with `sharedEvidence` present and possibly `[]`. A read never writes. A v1 document becomes v2 only through a write that is already allowed.

**Missing-field behavior for old conversations.**

- Absent `sharedEvidence` reads as `[]`. It is not `null` and it is not an error.
- Existing `sharedGoals` bytes, the BR-25 snapshot shape and the goal parser are unchanged.
- A participant of an old conversation sees no evidence.

**Encryption and decryption rules.**

- The whole payload, including `sharedEvidence`, is encrypted and decrypted by the existing `encodeContent` and `decodeContent` path (CL-18, CL-27, AD-5). There is no second envelope and no second key.
- Serialization uses a fixed key order. Each evidence item is serialized with exactly its allow-listed keys (schema in the SPEC "Evidence snapshot schema").
- Decoding follows the D2 order: key bytes, `keyCheck`, authenticated decrypt, parse. A malformed evidence item makes the whole document malformed (owner delete-only). It is never repaired (§11.1 class E).
- The evidence plaintext counts toward the document size cap (about 175 KB worst case, §5).

**Rollback behavior.**

- Deployment order is mandatory. (1) Ship the v2 codec, which reads v1 and v2 and preserves `sharedEvidence` on every write, with no evidence routes. (2) Ship the evidence routes. A rollback then disables the routes only. The codec stays.
- Forbidden: deploying code that predates v2 while any conversation document contains `sharedEvidence`. Such code would classify those documents as malformed (delete-only for the owner). On write it would also drop the field, which silently removes owner-selected evidence.
- If the feature must be withdrawn entirely, first run an owner-approved data step that clears `sharedEvidence` in every conversation. The step is bounded, scripted and recorded. It decrypts first and follows §11.1, so a class B to D failure stops the step and is reported. Only when a count of documents containing `sharedEvidence` is zero may pre-v2 code be deployed.

**Participant-facing field allow-lists (DTO).**

- Responsibility snapshot: `kind`, `title`, `description`, `status`, `relationToRole`, `period` (`start`, `end`), `capturedAt`.
- Achievement snapshot: `kind`, `title`, `description`, `outcome`, `period` (`start`, `end`), `relationToRole`, `capturedAt`.
- Never returned: `id`, `goalIds`, `responsibilityIds`, owner uid, `createdAt`, `updatedAt`, member refs, role target, assigned role, comparison, C1, skill or D1 fields. A response carries no array index that maps to a source record.
- The owner's read of `sharedEvidence` uses the same snapshot DTO. The owner's selection list uses a separate DTO with source ids and is never sent to the participant.

**Negative authorization tests (evidence).**

- N-E1 Pending participant: no `sharedEvidence` key in the response.
- N-E2 Accepted participant with evidence: the response DTO key set equals the allow-list exactly, and a deep scan finds no `id`, `goalIds` or `responsibilityIds` key.
- N-E3 Declined, withdrawn, removed or ineligible participant: no evidence, and the same neutral `conversation_not_found` as other D2 content.
- N-E4 Participant sends a source id in path, query or body: `conversation_not_found`, and no source record is read.
- N-E5 Team admin, lead, superadmin and app admin reading a conversation they do not own or are not bound to: `conversation_not_found`, with no evidence.
- N-E6 Owner selection with a foreign or unknown id: `invalid_evidence_selection`, no write, no existence leak.
- N-E7 Selection body carrying `uid` or `ownerUid`: rejected.
- N-E8 Completed conversation: adding one item, a partial removal or a non-empty replacement returns `conversation_completed` and leaves the stored document byte-identical. A whole clear succeeds, and the participant's next read has no evidence.
- N-E9 A document with `sharedEvidence` as a plain field: rejected as malformed (owner delete-only; participant sees nothing).
- N-E10 A v1 document (no key) reads `[]`, and its `sharedGoals` are unchanged.
- N-E11 An extra payload key, or `sharedEvidence: null`: malformed.
- N-E12 A v1 document updated for a non-evidence field is written as v2 with `sharedEvidence: []`, and the `sharedGoals` bytes are unchanged (round trip).
- N-E13 Release gate: the number of documents containing `sharedEvidence` is recorded as zero before any deployment of pre-v2 code.

### 11.3 C-7 — First-increment account erasure

**Proposed inventory rows.** These are added to the account-erasure SPEC inventory by a dated amendment in TASK-002. They are not applied here.

| # | Source | Linkage | Class | Step |
|---|---|---|---|---|
| I-17 | `userDevelopment/{uid}/responsibilities/*` | Owner responsibilities (encrypted `title`, `description`) | DELETE, owner subtree, paged | `personal_data` |
| I-18 | `userDevelopment/{uid}/achievements/*` | Owner achievements (encrypted `title`, `description`, `outcome`) | DELETE, owner subtree, paged | `personal_data` |
| I-5 (existing; test added) | `userDevelopment/{uid}/conversations/*`, including `sharedEvidence` | Owner evidence snapshots | DELETE with the conversation | `conversations_owned` (no new row) |
| I-7 (existing; rule added) | Participant binding in others' conversations: re-encrypts the payload without `participantNotes` | Must preserve `sharedEvidence` byte-for-byte (v2), and fail closed on a class B to D error | DETACH and DELETE (content) | `participant_bindings` |
| — | Evidence held by a participant | None exists. The participant never receives a copy | — | None |
| — | Actor fields on responsibilities or achievements | None. The records have no actor field | — | None |

**Explicitly blocked (not in the first increment).** `roleAssignments/{uid}`, `roleAssignments/{uid}/history/*`, and the `assignedBy` actor row (ANONYMIZE). These stay blocked until: C-1 to C-4 are approved; the history access rule (C-2) is decided; the audit-field design (C-3) is decided; a retention policy for history and `assignedBy` is approved; and an erasure policy is approved for an erased administrator's `assignedBy` values, which are nulled rather than replaced (AE-SI-7). TASK-010 cannot start before these are approved.

**Write-fence rows (proposed, added to the write-surface enumeration).**

- W-19 `POST`, `PATCH` and `DELETE /api/me/responsibilities*` on `userDevelopment/*/responsibilities`. Each write reads `accountErasures/{uid}` in the same transaction and refuses with `erasure_in_progress` if the record exists.
- W-20 The same for `/api/me/achievements*` and `userDevelopment/*/achievements`.
- W-21 Evidence selection and clear inside `PATCH /api/me/conversations/[id]` (`sharedEvidence`). It reads the fence in the same transaction, as W-6 requires for conversation writes.

**Deletion order and procedure (first increment).**

- Order: within `personal_data`, after I-1 to I-4, delete I-17 and then I-18. These records have no dependency on conversation steps, because snapshots are copies and need no source record. I-5 removes evidence with its conversation in `conversations_owned`. `participant_bindings` must not require evidence.
- Procedure per subtree: (1) list up to 100 documents under the subtree, in document-id order, with no collection group and no index; (2) delete them in one batch, within the Firestore batch limit; no decryption and no reading of titles; (3) repeat until the list is empty.
- Idempotency: deleting an absent document is success. Re-running the step after partial progress is safe, because the list re-derives the remaining state. Progress is persisted as the step id only.
- Failure handling: a transient batch error leaves `personal_data` open with an error code from the existing fixed enum, and the runner retries. A permanent failure leaves the status non-completed and operator-visible. Auth deletion does not run before the subtree is verified empty (AE-SI-4). Logs carry no title, description or id (AE-SI-12).
- Verification: `verify_data` re-runs the subtree lists (D-VERIFY-BACK). A residual document triggers a cleanup re-run, and the step cannot advance while residue exists.
- Key independence: I-17 and I-18 need no `ENCRYPTION_KEY`. Erasure must not depend on a working key for deletion. Residual dependency, stated explicitly: `participant_bindings` (I-7) re-encrypts another owner's payload and therefore needs a working key. When the key is unavailable, that step fails closed. It is not skipped, the erasure does not reach `completed`, and the step may not delete owner content as a workaround.

**Erasure tests (E-tests; required before TASK-002, TASK-004 and TASK-009 are complete).**

- E-1 Fake store: erasure removes every I-17 and I-18 document for the uid and nothing for another uid (cross-user negative test).
- E-2 Emulator with real rules: after the run both subtrees are empty; client access stays denied.
- E-3 Idempotency: a second run is a no-op. Injected failure after page 1 resumes and completes.
- E-4 Key independence: with `ENCRYPTION_KEY` unset, I-17 and I-18 are still deleted. The I-7 step fails closed, the erasure is not completed, and no owner content is deleted by that failure.
- E-5 Owner erasure removes owned conversations, including `sharedEvidence`. A scan of the emulator finds no remaining uid.
- E-6 Participant erasure: the owner's `sharedEvidence` is unchanged. The I-7 re-encryption round trip preserves the decrypted `sharedEvidence` array exactly.
- E-7 Fence race: a write in flight when the erasure record is created is refused with `erasure_in_progress` and produces no document. Covered by a unit test and by the manual emulator commit-order run (the existing erasure verification requirement).
- E-8 `verify_data`: a residual document injected after deletion triggers a cleanup re-run, and the step does not advance.
- E-9 No residue: a scan of responsibilities, achievements and conversations finds zero documents for the erased uid.
- E-10 Erasure responses and logs contain no title, description, outcome or id list.
- E-11 Inventory guard: a new collection under `userDevelopment/{uid}/` without an inventory row fails the guard (fixture).
- E-12 Demo tooling refuses to create responsibilities or achievements for a presenter uid that has an erasure record or no Auth user (AE-SI-13).

### 11.4 C-8 — Import boundary: a static guard, not an access control

**Replacement wording** (replaces the PR-SI-2 correction in §1 and Amendment I in §10.5):

> **PR-SI-2 (no aggregation; static import guard).** No team, org, admin, survey, coverage, roadmap, skill-progress, role-comparison, ranking or analytics code reads or derives from personal responsibilities, achievements or evidence snapshots. The personal-record import allow-list is a **static architecture and regression guard**. It detects an unexpected importer or writer in the scanned source tree at build time. It is not runtime authorization. It does not authorize any request and does not prove that no other path exists.
>
> The enforceable security boundaries are: (1) the verified authenticated owner identity, taken from the token on every route; (2) server-side authorization on every request, re-derived from fresh state; (3) strict owner-scoped data access, in which every read and write path uses the verified uid and no request supplies a uid; (4) Firestore rules that deny client access to `userDevelopment` and `roleAssignments`; (5) minimal response DTOs with explicit allow-lists; and (6) negative cross-user access tests (§11.6). The tests are the authorization evidence. The guard is a review aid that helps keep (2) and (3) true.

**Inventory of potential import and write paths (as of 2026-11-10).**

| Path | What it does with personal-record code or data | Covered by the guard today | Disposition |
|---|---|---|---|
| `src/**/*.ts`, `src/**/*.tsx`, `app/**/*.ts(x)` | Literal imports, including re-exports, dynamic `import()` and `require()` | Yes | Enforced |
| `src/**/*.mjs`, `src/**/*.js` (for example `src/features/demo-team/register-ts-resolver.mjs`) | Imports `node:module` only. No personal-store import | **No** (the walker reads only `.ts`/`.tsx`) | Extend the guard to `.js` and `.mjs` under `src` and `app` |
| `scripts/seed-demoteam-conversations.ts` | Imports the D2 content codec and D2 domain modules from `src`. Writes `userDevelopment/*/conversations` through the Admin SDK | **No** (`scripts/` is not scanned) | **Documented exception**, file-exact: may import only the D2 codec and domain modules listed in the guard. It must not import any personal-record store |
| `scripts/seed-demoteam.mjs` | Writes `userDevelopment` goals, role target and conversations through literal path strings. No `src` import | **No** | **Documented exception**, file-exact: may write only the paths it already writes. It must not write responsibilities, achievements, evidence or `roleAssignments` (AE-SI-13, E-12) |
| `scripts/bootstrap-superadmin.ts` | Admin SDK only. No `src` import, no personal path | No | Out of scope; no personal data path |
| `test/*.ts` (`erasure-fence-default.ts`, `server-only-mock.ts`) | Erasure fence helper and a `server-only` mock. No store import | No | Extend the guard to `test/` for store imports |
| `browser/**/*.ts`, `browser/emulator/*.mjs` | Playwright specs and the emulator seed. No store import found by search | No | Add a path-string check for `userDevelopment/*/responsibilities`, `…/achievements`, `roleAssignments` |
| Dynamic or non-literal import specifiers in `src` and `app` | None found by search on 2026-11-10 | Partly | Guard rejects non-literal specifiers in scanned files |
| `tsconfig.json` path aliases | Only `@/*` | Not checked | Guard fails if an alias other than `@/*` is added |

**Required guard changes** (in TASK-001 and TASK-002, each with a fixture test proving that a violation fails): extend the scan to `.js` and `.mjs` under `src` and `app`, to `scripts/`, to `test/` and to `browser/`; reject non-literal `import()` and `require()` specifiers; fail on any path alias other than `@/*`; add the file-exact exceptions above; add a path-string check for personal collections in scanned non-TypeScript files.

**Limits, stated plainly.** The guard is lexical. It works on comment-stripped text, it cannot follow string-built paths, and a determined author can evade it. Those limits are why the enforceable boundaries above are the security boundary, and why code review is part of the control. Nothing in `SECURITY.md`, the SPEC or the tasks may describe the guard as bypass-proof or as authorization.

### 11.5 R-1 to R-4 — Proposed defaults (approval needed)

- **R-1 Body cap.** Responsibility and achievement write routes read the request body with a streamed cap, as BR-40 does. Proposed: **16 KiB**. The largest achievement plaintext is about 12.8 KB. Over the cap, the route returns `payload_too_large` before parsing.
- **R-2 Encrypted envelope cap.** The encrypted envelope of one source record, after base64 encoding and before the write, must be at most **32 KiB**. A larger envelope returns `payload_too_large` and writes nothing. The worst-case achievement envelope is about 17 KB. The margin is for future field growth.
- **R-3 Ids as path segments.** Responsibility and achievement ids follow D2's addressable-id rule: `^[A-Za-z0-9_-]{1,128}$`, and no `__`. An id that fails the rule is rejected before any read. Ids are never trimmed or repaired.
- **R-4 Source-record codec location.** Recommendation: a new module, `src/features/personal-role-workspace/server/source-record-codec.ts`. It uses `src/lib/encryption` `encrypt` and `decrypt`, and it derives `keyCheck` with the same CL-27 construction as the D2 codec. A test pins equality against a fixed vector taken from the D2 codec, read in a test file. The D2 codec is not changed in TASK-002. This keeps the change to D2 limited to TASK-007, and it adds no guard exception for D2 modules.

### 11.6 Required negative security tests (consolidated)

Every new access path needs at least one test from each group that applies. Test names use the identifiers in this section.

- **Foreign and unknown ids:** every read, write, delete and selection with another person's or an unknown responsibility, achievement or goal id returns the same neutral result, with no write and no existence leak.
- **Client-supplied identity:** `uid` and `ownerUid` in path, query or body are rejected or ignored, and never reflected in a response.
- **Cross-role reads:** app admin, team admin, lead, member and superadmin each fail to read responsibilities, achievements, goals, target role, comparisons and conversations through every route.
- **Assignments (for the record, not in the first increment):** the employee response never contains `assignedBy`; no role other than the one permitted by PR-SI-3 can read or write `roleAssignments`.
- **Encryption:** C5-1 to C5-11 (§11.1).
- **Size:** R-1 and R-2 boundary tests. A maximum-length record stays under R-2 and under the 1 MiB document limit.
- **Evidence:** N-E1 to N-E13 (§11.2).
- **Erasure:** E-1 to E-12 (§11.3).
- **Static guard:** each rule in §11.4 has a fixture that fails it. No `collectionGroup` query is used on the new paths.
- **Client rules:** the emulator denies client read and write on `userDevelopment/*/responsibilities`, `…/achievements`, `roleAssignments/*` and its history.
- **Copy:** the target-role and assigned-role phrases are never interchanged (PR-SI-4).

### 11.7 Dependency-ordered implementation plan (first increment, after approvals in §11.8)

1. **Approvals.** Record them in SPEC.md (§11.8, G1 to G3).
2. **TASK-001.** Apply PR-SI-1, PR-SI-2 (§11.4 wording), PR-SI-4 and the revised PR-SI-5 (§11.1) to `SECURITY.md`. Update the `DATA-MODEL.md` shapes as proposed. Extend the guard to the scanned paths in §11.4, with fixtures.
3. **TASK-002.** Source-record codec and its tests (C5-1 to C5-11, R-2, R-3). Responsibility store and routes, owner-scoped and with the fence (W-19). Erasure rows I-17 and the account-erasure SPEC dated note. Erasure tests E-1 to E-4, E-9 to E-11 for responsibilities.
4. **TASK-003.** Workspace and responsibilities UI (no server change).
5. **TASK-004.** Achievement store and routes on the same codec (W-20, I-18), with R-3 for responsibility ids. Tests as TASK-002.
6. **TASK-005.** Achievements UI (no server change).
7. **TASK-006.** Documentation only: Amendments A, B, C2 and D into `SECURITY.md`, the D2 SPEC and `DATA-MODEL.md`.
8. **TASK-007.** First the v2 codec (N-E9 to N-E12), with no route, and the release gate N-E13. Then the evidence routes (W-21), with N-E1 to N-E8, E-6, and the wrong-key tests for evidence (C5-5, C5-6 on the D2 path).
9. **TASK-008.** Evidence UI and participant view (no server change).
10. **TASK-009.** Lifecycle tests, erasure E-5, E-6, E-8, and the evidence scope guards.
11. **TASK-011.** Final verification and documentation sync.

TASK-010 (assigned role) is not part of this plan.

### 11.8 GO / NO-GO for the first increment

**Assessment: NO-GO until the approvals below are recorded. No technical conflict remains in the first-increment scope.**

Resolved in this pass:

- C-5 is approved, with its tests (§11.1).
- C-8 is reclassified as a static guard, with its enforceable boundaries and documented exceptions (§11.4).
- C-6 and C-7 are prepared as exact text, and the rollback and the erasure order are specified.
- R-1 to R-4 have proposed defaults.
- TASKS.md is synchronized with the approved decisions (see TASKS.md, Status and Blockers).

Required approvals before TASK-001 or TASK-002 starts:

- **G1 — Security text (OD-8).** Owner approval of PR-SI-1, PR-SI-2 (§11.4), PR-SI-4, the revised PR-SI-5 (§11.1), Amendments A, B, D, and C2 (§11.2).
- **G2 — Proposed defaults.** Approval of R-1 (16 KiB body), R-2 (32 KiB envelope), R-3 (D2-style id rule) and R-4 (separate source codec, no D2 change in TASK-002).
- **G3 — Erasure.** Approval of rows I-17 and I-18, the write-fence rows W-19 to W-21, and the dated amendment to the account-erasure SPEC.

Not gates for the first increment (assigned role, deferred): C-1 to C-4, the history access rule (C-2), the audit-field design (C-3), and the history and `assignedBy` erasure rows (C-7). They block TASK-010 only.

Residual risks, accepted in the design and listed so they are not forgotten:

- Erasure of another owner's conversation in which the erased person is a participant depends on a working encryption key for the I-7 re-encryption step. Without the key the erasure stays open, and that is by design.
- Class D records (authenticated decryption failure) stay in place until erasure or an operator action. The product never deletes them.
- The import guard is lexical. Code review and the negative tests are part of the control.
- Rolling back the evidence feature requires the data step in §11.2 and the release gate N-E13.

This section is a documentation proposal. It does not record an approval, and it does not authorize implementation.
