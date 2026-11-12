# G1 technical pre-review: Amendment A (numeric team radar, k = 3)

> **Superseding note (2026-11-07).** The selected design is on-demand aggregation, not publication. The publication
> architecture reviewed below was abandoned. Findings **F1, F2, F3 and F5** (change flags, publisher race, flag
> signalling, numeric bit budget for publication) **no longer apply**: nothing is persisted, there are no periods and no
> publisher. Findings **F4** (cross-team intersection), the repeated-observation residual in §3.3 and the three-contributor
> disclosure remain as **documented residual risks**, not release blockers, per the owner's simplification. **F6**
> (one eligibility definition, including team `active` status) and **F7** (remove `requiredCoverage` from member DTOs)
> still apply to the on-demand path, and `deriveTeamLevel` plus the internal aggregation path follow F6. **F8** and **F9**
> are unchanged. See `AMENDMENT-A-DRAFT.md` §A.00.

**Status: technical pre-review only. Not a G1 approval. Nothing is activated.**
Prepared 2026-11-07 against `G1-REVIEW-BRIEF.md` and `AMENDMENT-A-DRAFT.md`. Read-only: no Firebase calls, no rule,
SECURITY.md, consent or notice change, no commit. Synthetic arithmetic checks run in a scratch script outside the repo.

## 1. Validation results

### 1.1 Aggregate rule (invariant 35)

- `level = floor((2·sum + n) / (2·n))` was compared against an independent reference (largest integer `m` with
  `m − 1/2 ≤ sum/n`, computed without division) for every multiset of levels 1–4 with n = 1…5. **0 mismatches.**
  Output is always in 1…4.
- Half-up is confirmed: n = 2, (1,2) → 2; (3,4) → 4.
- For n = 3 the fractional part of the mean is 0, 1/3 or 2/3, so the half rule never fires. The draft's remark is correct.
- k = 2 and k = 3: the draft gives `insufficient_data` below 3, and no team-size floor. Nothing in the rule depends on
  roster size. Correct as written.

### 1.2 Inference table (§A.13)

Brute force over all 16 `(y, z)` pairs for each own level `x` and published `m`: **all 12 non-empty rows match the draft
exactly** (pair counts and `y+z` ranges). Unique determination occurs in 2 of 12 cases: (x=2, m=1) and (x=3, m=4). The
draft's arithmetic is correct. The disclosure it describes is real.

### 1.3 Code state (current repository)

- `src/features/team-skills/domain/skill-coverage-policy.ts`: `SKILL_COVERAGE_MIN_CONTRIBUTORS = 5`. Matches the active
  contract; the k = 3 change has not been made (correct).
- `src/features/team-skills/domain/skill-coverage.ts`: categorical `covered`/`gap`/`insufficient_data`, with
  `requiredCoverage` as input. The numeric rule does not exist yet.
- No `teamLevel` write path, `teamCoverageChange`, publication collection, `teamProfileSettings`, boundary publisher or
  `competence-profile` route exists on the server. (Grep: `teamLevel` is read in `team-competence-profile/domain`, never
  written server-side.) Consistent with BLK-1.

## 2. Confirmed protections (technical)

1. **Client denial.** `firestore.rules` denies client read and write on `skillProfiles`, `teamSkillNeeds`,
   `teamCompetenceAreas`, `teamCompetencePlans`, `userProfiles`, `superadmins`, `superadminRegistry`, and the final
   catch-all. Admin SDK bypasses rules, so the real boundary is server code (as the draft notes).
2. **Batch reader is identity-free.** `readSkillLevelsBatch` (`src/features/skill-profiles/server/read-skill-levels-batch.ts`)
   returns per-tree sorted integer arrays only. It dedupes uids, skips invalid entries silently, and fails closed on read
   error or bound overflow. Eligibility is delegated to the caller.
3. **Coverage eligibility is checked.** `eligibleUids` (`get-team-skill-coverage.ts`) requires a stored `uid` and `teamId`
   that match, a document id equal to `membershipDocId(uid, teamId)`, and `isEffectiveSkillContribution`. A read failure
   returns `read_failed` with no partial result.
4. **Coverage response has no identity.** The row type is field-by-field; no uid, count or level is returned.
5. **Write stamps and erasure fence exist** on the C1 write path (`set-own-skill-level.ts` runs in a transaction that
   re-reads the document; the erasure fence is tested).

## 3. Unresolved vulnerabilities and privacy risks (technical)

### F1. Withdrawal, membership removal, area change and team deletion do not set the change flag (high)

The draft sets the per-need flag only on a **level write** (§A.3.1) and a **need edit/delete** (§A.5.3). The brief lists
withdrawal, membership changes, area changes and team deletion as required review points. None of them sets a flag.

- `withdraw-own-skill-contribution.ts` already exists and removes an input. Under the draft, when n ≥ 4 the next
  boundary publishes a **new value without suppression**. A withdrawing member knows their own level `x`, so a viewer who
  compares the before and after values learns a change in the others' combined sum. This is the §A.13 residual, but
  without the one-period suppression the draft relies on. The draft's "A1 is suppressed" claim holds only at n = 3 → 2.
- Attack trace (n = 4): publication `m₁` over {W,A,B,C}; W withdraws; boundary publishes `m₂` over {A,B,C}. No flag, so
  no suppression. A reader sees `m₁`, then `m₂`, one period apart. W, with level `x`, learns the others' combined change.
- Same shape for membership removal (`teamMemberships` delete), area changes (`manage-competence-areas.ts`) and team
  deletion.

**Required correction:** every path that changes the eligible set or the eligible levels for a (team, need) must set that
need's flag in the same transaction, or the draft must state why it does not need to. The list is: opt-in, withdrawal,
membership add and remove, teamAdmin area or need change, team deactivation and deletion, erasure.

### F2. Publisher race: flag clear is not tied to the inputs it read (high)

Invariant 35(b) says the flag is "cleared only by the boundary publisher, in the same transaction". It does not say the
publisher must read the flag inside that transaction, nor that it clears only if the flag is unchanged since its inputs
were read. Without that:

Trace: publisher reads inputs (level `x` old), then a level write sets the flag and commits, then the publisher commits
and clears the flag. The publication contains the old input, and the change is not suppressed.

**Required correction:** the publisher reads the inputs, the flag and the `teamSkillNeeds` document in one transaction
(or uses a version/epoch that the C1 write increments), and writes the publication and clears the flag only if all are
unchanged. Otherwise it retries.

### F3. Flag is set only for contributors: its absence is a signal to the editor (medium)

§A.3.1 step 2 sets the flag only for teams where the caller is an effective contributor. A non-contributor's edit sets
nothing. So the next publication for that need is unchanged for them, and changed for a contributor. This reveals, to the
editing member, whether they count toward a team's need, and it reveals this to the team viewers through suppression. The
draft's residual statement covers "some input changed", not "this member is a contributor to this need". A member already
knows their own participation, so the leak is small, but it should be stated, because a non-contributor's edit that
produces no suppression is distinguishable from a contributor's edit that does.

**Required correction:** either set the flag for every team with that need (the contributor check moves out of the
flag condition, so flag setting is independent of the caller's participation), or record the residual explicitly.

### F4. Cross-team intersection is not analysed (medium)

A member who contributes to two teams sees, for the same area, two publications over overlapping cohorts. Intersecting
them can narrow other members' levels beyond the single-team table in §A.13. The draft analyses one team only.

**Required:** an analysis of two-team intersection, or a rule that limits one member's visible area across teams.

### F5. Bit budget not recomputed for numeric output (medium, owner-approved gate item 8)

§A.5.5 (3 × log₂4 = 6 observations, 12 periods) is categorical. The brief requires a recomputation. Numeric output carries
up to 2 bits per need per period. The 12-period horizon at P = 30 days is therefore not established for numeric output.
**Not computed in this review;** it needs the owner and a reviewer (G6).

### F6. Aggregate eligibility definition differs between documents (low)

- Aggregate rule (invariant 35) defines eligible as: genuine membership, effective `skillContribution`, valid level 1–4.
- §A.3.1 additionally requires `teams/{teamId}` to be `active`.
- The current `eligibleUids` does not check team status (the reader does, via `requireGenuineMember`).

**Required:** the boundary publisher must use the same definition, including team status, and the draft must state it.

### F7. Member DTO still exposes `requiredCoverage` (low, planned fix K3-7)

`get-team-skill-coverage.ts` (`SkillCoverageRow`) includes `requiredCoverage` in the member response. `list-skill-needs.ts`
(around line 98) includes it in each `SkillNeedView` for any authorized caller, with no role gate in the mapper I read.
This is the cut-point lever K3-7 targets. Removal is required before activation, and the draft's A2 test must assert it.

### F8. Cohort-size side channel in `incomplete` (low)

When a team has more than 500 memberships, `availability: "incomplete"` is returned to any member. That reveals a size
threshold, not a value. Acceptable, but it should be listed in the residual.

### F9. Rules hygiene (low)

`teamCoverageChange`, publication documents and `teamProfileSettings` have no explicit deny block. The catch-all covers
them. The draft already lists this as gate item 9. No exposure at present.

## 4. Exact files and write paths requiring change before activation

| Path | Change |
| --- | --- |
| `src/features/skill-profiles/server/set-own-skill-level.ts`, `clear-own-skill-level.ts`, `delete-own-skill-profile.ts` | Add flag writes in the same transaction (F3, F1 for delete) |
| `src/features/team-skills/server/withdraw-own-skill-contribution.ts` | Set flags for the team's needs (F1) |
| `src/features/team-skills/server/set-own-skill-contribution.ts` | Set flags for join and opt-in (F1, §A.3.1 completeness argument) |
| `src/features/team-skills/server/skill-needs-store.ts`, `upsert-skill-need.ts`, `delete-skill-need.ts` | Flag on need change (already in draft §A.5.3) |
| `src/features/team-competence-catalog/server/manage-competence-areas.ts` | Flag on area change or removal (F1) |
| Teams membership removal path and team deletion or deactivation | Flag on removal (F1), not yet located in this review |
| `src/features/team-skills/domain/skill-coverage-policy.ts` | `k` 5 → 3 at activation only |
| `src/features/team-skills/domain/skill-coverage.ts` | Numeric derivation replaces categorical (new) |
| `src/features/team-skills/server/get-team-skill-coverage.ts` | Remove `requiredCoverage` (F7) |
| `src/features/team-skills/server/list-skill-needs.ts` | Member DTO without `requiredCoverage` (F7) |
| Boundary publisher (not yet written) | Transactional read and conditional flag clear (F2); one eligibility definition (F6) |
| `firestore.rules` | Explicit deny blocks (F9). Separate approved step |

## 5. Required corrections to the draft invariants

1. **Invariant 35(b):** the flag is set by every path that changes an eligible input (list in F1), independent of the
   caller's participation (F3), and cleared only by a publisher transaction that verifies its inputs (F2).
2. **Invariant 35 aggregate rule:** add the team `active` status to "eligible", or state that it is excluded and why (F6).
3. **Invariant 36(c):** the wording "cleared only by the boundary publisher" must add "in a transaction that re-validates
   the flag's version" (F2).
4. **Residual statement:** add cross-team intersection (F4) and the editor-contributor signal (F3).
5. **§A.5.5 bit budget:** replace the categorical budget with a numeric one (F5), or mark it as not established.

## 6. Questions requiring independent security-reviewer decisions

1. Is the residual in §A.13 acceptable as written, given F1 (no suppression for n ≥ 4 on withdrawal) and F4?
2. Should the flag be set independently of the caller's contributor status (F3), or is the signal acceptable?
3. Is P = 30 days acceptable once the numeric bit budget is recomputed (F5, gate G6)?
4. Is a separate server-only audit record needed for mode changes (K3-9)?
5. Is the single-route inventory (§A.5.6) complete, given that membership removal and team deletion have no inventory entry?

## 7. Technical findings distinct from G2 decisions

Technical (this report): F1, F2, F3, F4, F6, F7, F8, F9, and the bit budget computation (F5).

Reserved for G2 (privacy and legal): whether "not anonymous" with a three-contributor numeric aggregate and the
disclosure in §A.6 is lawful. Whether the notice's "ingen ser hvem som deler" claim holds given F3. Whether F4 and F1
change the disclosure text. Retention and erasure classification of the flag document (`teamCoverageChange` holds no person
data, but must be classified). Owner acceptance of inference risk does not replace these.

## 8. Is the architecture ready to submit for G1?

**Not yet.** The invariant set is internally consistent for the paths it names, and the arithmetic is verified. But F1 and
F2 are design gaps in the write-path coverage and publisher atomicity, and F4 and F5 are unanalysed. The draft should be
revised for F1 to F5 before the G1 submission. Otherwise the reviewer would be asked to approve a flag rule that does not
cover withdrawal or publisher races.

G1 is not passed. The security contract is not self-approved.
