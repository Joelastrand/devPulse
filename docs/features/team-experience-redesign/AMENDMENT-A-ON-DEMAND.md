# Amendment A (on-demand design): numeric Teamkompetanse, k = 3, rounded mean

**Status: draft for security and privacy review. Not applied.** Nothing here changes `docs/SECURITY.md`, the active
k = 5 enforcement, notice versions, consent records, Firestore rules or shared data. This document supersedes the
publication design in `AMENDMENT-A-DRAFT.md` (see §9 there, and §A.00). Amendment B stays separate
(`AMENDMENT-B-DRAFT.md`).

## 1. Approved product direction (owner, 2026-11-07)

- Automatic numeric team radar: one rounded arithmetic mean per team and competence area, from eligible members' valid
  self-assessment levels (BR-4 team-level exception).
- k = 3 eligible contributors per area. No team-size floor.
- Missing or suppressed values are unavailable, never zero.
- Member-controlled sharing (explicit opt-in, default off, per team, revocable).
- Teamadmin chooses automatic or collaborative mode. Collaborative values are entered by hand and never copied from
  private assessments.
- No individual ratings, identities or contributor counts in team responses.

## 2. Architecture

- **On-demand aggregation.** A team read computes the level at request time from the existing authorized path:
  genuine membership of an active team, then `readSkillLevelsBatch` (identity-free) for the eligible contributors only.
  The implementation is `getTeamSkillLevels` in `src/features/team-skills/server/get-team-skill-coverage.ts`, next to the
  existing coverage operation. The derivation is `deriveTeamLevel` in `src/features/team-skills/domain/team-level.ts`.
- **No persistence, no cache, no publisher, no epochs, no change flags.** Nothing derived from personal assessments is
  written. A withdrawal, a level change, a membership change or an area change is visible on the next read.
- **Aggregate rule.** `level = floor((2·sum + n) / (2·n))` over the eligible contributors' levels: integer arithmetic,
  exact half up, always 1–4. Fewer than k eligible contributors gives `insufficient_data`. Exhaustive tests compare this
  with an independent reference for every sequence of 3–5 levels.
- **Eligibility** (same definition for coverage and the numeric path): a genuine membership whose document id and stored
  `uid`/`teamId` match, an effective `skillContribution` (notice version current), and a valid stored level 1–4 for the
  area. Invalid stored levels fail the read closed; they are never treated as zero.
- **Collaborative mode.** A teamadmin (or superadmin) of an active team sets or clears one integer 1–4 per area in
  `teamCompetenceAreas.teamLevel`. Authorization runs before input validation (`decideCollaborativeLevelWrite`, in
  `src/features/team-skills/server/`). The collaborative path reads no `skillProfiles` and no `skillContribution`.
- **Response shape.** Per need: `treeId`, `areaName` (null only when unavailable), `targetLevel` (the need's target, shown
  as the dashed radar polygon), `state` (`value` with `level`, `insufficient_data`, `area_unavailable`). No `requiredCoverage`,
  count, sum, distribution, uid, name, memberRef or timestamp.

## 3. Member-controlled sharing and withdrawal

- Sharing is the existing `teamMemberships.skillContribution` opt-in (per team, versioned, off by default). Withdrawal
  removes it; the next team read excludes that member. There is no cached value to outlast it.
- A team admin cannot read or change any member's sharing (invariant 33, unchanged).

## 4. Required security-contract changes (proposed text, to be applied only after review)

- **Invariant 34.** `SKILL_COVERAGE_MIN_CONTRIBUTORS` is 3 (owned by `skill-coverage-policy.ts`). It may not be lowered
  below 3 or made configurable. No team-size floor.
- **Invariant 35 (replace).** Nothing derived from personal assessments is persisted or cached. The team level is computed
  per request from the eligible contributors via `readSkillLevelsBatch` and the aggregate rule above. The only permitted
  stored team datum is the collaborative integer entered by a teamadmin, which holds no member data.
- **Invariant 36 (replace).** Members write only their own sharing and levels. Teamadmins and superadmins write only their
  team's needs, mode and collaborative area values. No team-administration capability reads `skillProfiles` or
  `skillContribution`. The only personal-data reader for team purposes is the approved coverage module.
- **Residual statement (replace).** The team profile is privacy-thresholded and **not anonymous**. `k = 3` is a product
  threshold, not an anonymity guarantee. With exactly three contributors, a contributor who knows their own level can narrow
  the others' combined level. Repeated reads over time and cross-team comparison can narrow it further. These are accepted
  residual risks. Operators with Firestore Admin credentials can read raw data.

## 5. Accepted residual risks (documented, not release blockers)

- **Small-team inference.** Three-contributor aggregates allow partial inference about individuals, especially for a
  contributor who knows their own level. Owner accepted this. The notice must say so.
- **Repeated observation.** Repeated reads across time, and changes made by other members, can narrow the others' levels.
  The on-demand design has no suppression period, so this is not bounded in time. Accepted.
- **Cross-team intersection.** A member in two teams can compare two aggregates over overlapping cohorts. Accepted.
- **Collusion.** A colluding member or lead can narrow others further. Accepted.

No residual above is described as anonymity.

## 6. Approvals still required for activation

Activation is the step that changes `k` and exposes numeric output. It must not happen until all are recorded:

1. **G1 security review** of §2 to §4 (this document). The reviewer decides whether the residuals in §5 are acceptable.
2. **G2 privacy and legal review** of the three-contributor disclosure, the residual statement and the notice. Owner
   approval does not replace this.
3. **G5 notice version bump**, with an owner decision on the transition. The bump lapses current participation.
4. **G4 Norwegian copy** review and **G3 UI-UX** amendment (radar exception, table alternative, `recharts`).
5. **SECURITY.md amendment** of invariants 34–36 and the residual statement, applied only after items 1 and 2.
6. **Scope-guard allow-list entries** for the numeric operation (see §7).
7. **Firestore rules**, if a new collection is introduced (for example `teamProfileSettings`). Deny-only, a separate approved step.
8. **K3-7 code change**: remove `requiredCoverage` from member DTOs in `get-team-skill-coverage.ts` and
   `list-skill-needs.ts`, and assert it in the DTO tests.
9. **G7 decision record** retiring the old A3 test and recording the three-contributor residual.

## 7. Scope guard state (what the guard enforces and what needs a decision)

The C1 guard fixes the set of personal-data readers. The numeric operation lives in the approved coverage module, so no new
reader exists. Its only remaining guard item is that the approved coverage module's **runtime export set** is closed to
`getTeamSkillCoverage` and `createGetTeamSkillCoverage`. The numeric factory `createGetTeamSkillLevels` is exported so that
its tests can inject fakes. Adding it to the approved set is a reviewer decision; it has not been added.

Collaborative code is in `team-skills` (C2 owns teamadmin authorization for team-profile writes), so no cross-feature import
exists for it.

## 8. Test coverage for the on-demand path (implemented)

- Arithmetic: exhaustive reference comparison, order independence, rounding cases, k = 2/3 boundaries, invalid input throws
  (`team-level.test.ts`, 31 tests).
- Numeric operation (in `get-team-skill-coverage.test.ts`): authorization, eligibility (non-contributors and stale notice
  version excluded), opt-out visible on the next read, threshold, response shape, incomplete cohort, read failures.
- Collaborative decision (`src/features/team-skills/server/decide-collaborative-level-write.test.ts`, 23 tests): teamadmin and superadmin accepted,
  member/non-member/disabled team refused, invalid values rejected, read failure reported.

## 9. Not in this design

- Periodic publication snapshots, 30-day epochs, change flags, a boundary publisher, edit-once-per-period rules.
  These were abandoned by owner decision.
- Default-on sharing (Amendment B).
- Any claim of anonymity.
