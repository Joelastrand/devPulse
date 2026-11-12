# D1 Option B — Security-contract amendment proposal (for review, NOT active)

> **Contract status (2026-11-07).** The **current, approved contract is k = 5** (SECURITY invariant 34; team-skill-needs
> SPEC P2). The owner has approved a **product requirement of k = 3** for automatic aggregation (§10g). That requirement
> is **not yet a security-contract amendment**; nothing is activated. Where an earlier section states k = 5 as the
> *proposed* value, §10g supersedes it (see the table in §10g.5). Where it states k = 5 as the *current* value, it is correct.

Status: **PROPOSAL. Not approved. Not implemented.** Nothing in this document activates default-on sharing, migrates
consent, bumps `SKILL_CONTRIBUTION_NOTICE_VERSION`, or changes Firestore rules. Those actions require the explicit
approvals listed in §8.

Revision: **2026-11-07 review.** Static code and document inspection only. No application code, tests, Firestore rules,
consent records, notice constants or shared data were changed. No Firebase or Firestore calls were made (quota exhausted).

Owner product direction (2026-11-07): new team memberships contribute private self-assessments to team-level aggregate
coverage by default; members can disable and re-enable; individual assessments stay private, including from team
admins; existing private assessments are not shared retroactively; team admins define which competencies members can
assess.

Current contract that this would change: `docs/SECURITY.md` invariant 32 ("Participation is opt-in, per team,
revocable, destroyed with the membership, absent after a rejoin"), SPEC P1 and Q5 in
`docs/features/team-skill-needs-and-matrix/SPEC.md`, and TEAM-EXPERIENCE D1 (resolved 2026-11-06 as opt-in, default OFF)
in `docs/features/team-experience-redesign/SPEC.md`. The owner's 2026-11-07 direction supersedes the 2026-11-06 D1
record, but no approved amendment yet exists. **Until one is approved, the 2026-11-06 opt-in contract stays in force.**

---

## 0. Review summary (2026-11-07)

**Verdict:** the direction is coherent, but the proposal as written cannot be approved or implemented. Three points
block it:

1. **Default inclusion and notice acknowledgement contradict each other** (§2). The proposal says a member is not
   counted until the notice is acknowledged, but also writes the default state at grant time with no member action.
   Either the member is counted without having acknowledged anything, or acknowledgement is a member action, which makes
   it opt-in in substance.
2. **The default is written by a third party's action** (§2, §7). The grant runs when a team admin invites someone, when
   an invitation is accepted, or when an access request is approved by an admin (three callers). Writing the state there is a write about a person made by someone else, which the
   proposed invariant 32 wording itself forbids.
3. **Lawful basis is not established** (§8b). Default-on participation based on a pre-set state is structurally
   pre-ticked consent. P1 forbids that, and EU/EEA data-protection law generally requires consent to be a clear
   affirmative act. This is a flag for legal review, not a legal opinion.

**Verified privacy gap:** the current k=5 rule does not protect small teams. `deriveCoverageState`
(`src/features/team-skills/domain/skill-coverage.ts`) checks only `levels.length >= 5`. No team-size floor exists, and
SPEC BR-13 expressly excludes team size from k. In a 5-person team where all members contribute, any `covered` or
`gap` result reveals each member's band. The earlier draft's "already implied; verify" was wrong.

**Catalog duplication:** a team competence catalog already exists (`teamCompetenceAreas/{teamId}__{treeId}`, TASK-007,
statuses `active | inactive | archived`). The earlier §6 proposed a new `teamAssessableAreas` collection, which would
duplicate it.

**Team-admin creation is not supported today:** skill trees are created only through an app-admin operation
(`src/features/skill-trees/server/create-skill-tree.ts`, `requireAppAdmin`). Team admins can only assign existing global
trees. Team-admin creation of competencies needs a new product and data decision (§6.2).

### 0.1 Corrections to the earlier draft

| # | Earlier draft | Verified finding | Action |
| --- | --- | --- | --- |
| C-1 | Cites `docs/features/team-skill-needs/SPEC.md` | Folder is `team-skill-needs-and-matrix` | Corrected throughout. |
| C-2 | §2: not counted until notice acknowledged, and grant writes the default state | Acknowledgement is either a member action (= opt-in) or a grant-time write (not an acknowledgement) | Blocking. See §2 (options O-1/O-2/O-3). |
| C-3 | §4 R1: team-size floor "already implied; verify" | **False.** No team-size check. `deriveCoverageState` checks only `levels.length >= 5`. BR-13 excludes team size | A team-size floor is a required new rule (owner sets the value). |
| C-4 | §4 R4: default-on "slightly weakens the oracle" | **Reversed.** More eligible contributors means more skills pass k, so each lead probe yields more information | Corrected in §4. |
| C-5 | §4 R7: suppress when all contributors share a band | SPEC threat 5 explicitly rejected data-dependent suppression, because the suppression pattern itself leaks | Not adopted. Needs a SPEC revision if the owner overrides. |
| C-6 | §5: "Bumping the version lapses every existing opt-in" | Correct, but under default-on the lapse also removes default-included members, and the grant-time write has no re-acknowledgement path | Covered in §5. |
| C-7 | §6: new `teamAssessableAreas` collection | Duplicates `teamCompetenceAreas` (TASK-007) | Reuse it. See §6.3. |
| C-8 | §9.2: legacy presence-only objects stay readable | `readSkillContribution` accepts **only** the exact keys `noticeVersion` and `consentedAt`. Any added key, such as `state`, makes the object unreadable. The legacy rule is therefore a deliberate reader change with its own tests, not an additive change | Stated in §1 and §9. |
| C-9 | §4 R2: "suppress the first N days" | Any rule keyed to roster change is itself a signal. Stored timestamps conflict with invariant 35 and the "no timestamps" output rule | Options in §4 R2. |
| C-10 | (not covered) | BR-25 of team-experience names a fourth label, `Delvis dekket` (partly covered). It is not implemented. C2 produces only `covered`, `gap`, `insufficient_data` and `area_unavailable`. A partial band needs a second threshold, which is a new leak channel | Reject unless the owner approves a SPEC revision. |
| C-11 | (not covered) | Two parallel team lists: `teamSkillNeeds` (drives coverage; lead/teamadmin) and `teamCompetenceAreas` (drives plans; team admin). Neither the earlier draft nor the SPEC says which one defines "assessable" | Owner decision. See §6.3. |
| C-12 | (not covered) | Self-assessment (`set-own-skill-level`) accepts any valid global tree, with no team filter | Owner decision: restrict contribution only, or also input. See §6.3. |

---

## 1. What the current contract forbids

| Current rule | Source | Conflict with Option B |
| --- | --- | --- |
| Participation is **opt-in**; "no default, no pre-ticked control" | SECURITY inv. 32; team-skill-needs SPEC P1, Q5 | Default-on is a default state. |
| Presence of `teamMemberships.skillContribution` **is** the opt-in; no negative state (`enabled: false` is never persisted) | SPEC "Participation model"; `src/features/team-skills/domain/skill-contribution.ts` | A default needs either an auto-written record (pre-ticked consent) or a negative/included state. Both are forbidden today. |
| The reader accepts only the exact object `{noticeVersion, consentedAt}` | `skill-contribution.ts` (`CONTRIBUTION_KEYS`) | Any `state`/`stateSetBy` field makes the object unreadable (fail-closed). Adding a state model is a reader change with new tests, not an additive change. |
| The only writer is `setOwnSkillContribution` (caller's own uid, exact body) | `set-own-skill-contribution.ts` | Any default write from grant or admin code is a new writer. |
| The membership grant writes `{...record, memberRef}` with no contribution field | `src/features/teams/server/grant-team-membership.ts` (`applyMembershipGrant`) | A default write would sit in this shared transaction, called from invitation creation (`create-invitation.ts`), invitation acceptance (`resolve-invitations.ts`) and access-request approval (`approve-access-request.ts`). |
| A rejoin is **non-contributing** until a new opt-in | SECURITY inv. 32; SPEC BR-11 | Option B treats a rejoin as a new membership, so it would default on. Must be amended explicitly. |
| Notice version bump **lapses** all participation | SPEC BR-8; `SKILL_CONTRIBUTION_NOTICE_VERSION = 1` | Any notice change lapses existing opt-ins. Needs a transition decision (§5). |
| Withdrawal deletes the object; no confirmation dialog | SPEC UI section | Acceptable for revocation, but the state model changes under Option B. |
| Static guards pin the exact files that may name `skillContribution` | `team-skills-scope-guard.test.ts` (`SKILL_CONTRIBUTION_FIELD_FILES`), `participation-boundary.test.ts` | A default writer in `src/features/teams/server/` breaks the exact-set guard. The change must be deliberate. |

### 1a. Product intent versus authorized runtime behavior

| Topic | Owner intent (2026-11-07) | Authorized runtime today (verified) | Status |
| --- | --- | --- | --- |
| Default for new memberships | Included | Off. Only an explicit `PUT` with the current notice version opts in | **Blocked** (§2) |
| Withdrawal | Any time | `DELETE` removes the object; idempotent | Authorized |
| Re-enable | Member can re-enable | `PUT` with current `noticeVersion` | Authorized |
| Rejoin | Follows the new-membership default | Non-contributing until explicit opt-in | Requires amendment (§8d) |
| Visibility of individual state | Hidden from team admins | Hidden. Roster and admin DTOs never include `skillContribution` | Authorized; must stay |
| Who defines assessable competencies | Team admin | Team admin **assigns** existing global trees (`teamCompetenceAreas`). Needs are set by lead or teamadmin (`teamSkillNeeds`). Creating trees is app-admin only | Partly supported; creation not supported (§6) |
| Scope of member self-assessment | Team-defined competencies | Any valid global tree | Decision required (§6.3) |
| Teamkompetanse labels | Dekket / Delvis dekket / Behov for utvikling / Ikke nok grunnlag | Dekket / Behov for utvikling / Ikke nok grunnlag, plus `area_unavailable` for integrity. No "Delvis dekket" | SPEC BR-25 needs correction (C-10) |

---

## 2. Mechanism: the decision the owner has to make

The earlier draft recommended "B-1 included-by-default with notice and recorded state". Review shows this does not hold
together. Three options are possible:

**O-1. Explicit opt-in (current contract, P1).** Compatible with invariant 32 and the threat analysis. Does not deliver
the owner's default-on intent. The UI can be improved (clearer notice, "Du deltar" state), but nothing is counted
without a member action.

**O-2. Default-included, counted only after a member acknowledgement.** This is O-1 in substance. The default becomes a
pre-selected control, which P1 forbids and which the earlier draft rejected as B-2. Not recommended.

**O-3. Default-included without member action.** The state is set for new memberships, and the member is counted from
the default. This is the only option that matches the owner's stated intent. It requires:
- a lawful basis other than consent (for example legitimate interest with a documented balancing test and a right to
  object), which must be approved by the owner after legal review (§8b);
- replacing P1 and invariant 32 with a different privacy model;
- a rule for when the member is informed.

**Recommendation.** Do not implement O-3 until the lawful basis and a data-protection impact assessment are approved.
If the owner wants O-3, the technical design below is the least risky. If the owner does not accept the legal basis,
O-1 stays in force.

### 2a. Technical design under O-3

**Derived default, no write at grant (recommended).** Instead of writing a default state in the grant transaction:

- A membership with no `skillContribution` object is **not** contributing, as today. Legacy and explicit members are
  unchanged.
- For memberships created on or after an approved `defaultOnEffectiveAt`, the coverage derivation treats the member as
  included **unless** a withdrawal record exists. The inclusion is computed at read time from `createdAt`. Nothing is
  written on grant.
- Withdrawal writes a negative record, for example `skillContribution = { withdrawnAt, noticeVersion }`. This replaces
  the "no negative state" rule (P1, BR-7). Re-enable deletes it, which is the member's own write.
- Removal destroys the membership and the withdrawal record with it. A rejoin is a new membership, so the default
  applies again (§8d).

Why this is preferred: the grant transaction is unchanged, so no third party writes a person's state. This satisfies
the "never on another person's behalf" wording. It also keeps the static exact-writer guards intact, except for the
changes to the withdrawal writer and reader.

**Notice visibility.** The earlier "not counted until acknowledged" rule can still hold without making the default a
consent. The member records that they have *seen* the notice through a deliberate `POST` on their own page, for example
`noticeSeenVersion`. Counting starts only after that record exists. This record is informational, not consent, and it
is the member's own write, never a GET side effect. The codebase's rule that no GET writes a reference
(`memberRef`, invariant 27) is kept.

**Remaining gap.** Even with a seen-record, the team cannot prove that a member has read the notice before any coverage
read that includes them, because the seen-record is written after the member visits the page. The residual risk must
be stated to participants (§3, P6).

---

## 3. Required changes to `docs/SECURITY.md`

These apply only if the owner approves O-3 (§2). Under O-1 nothing changes except the owner's recorded decision.

1. **Invariant 32** — replace "opt-in ... no default" with: participation is included by default for memberships
   created on or after `defaultOnEffectiveAt`, is operative only after the member has seen the current notice, is
   withdrawable at any time, is recorded as the member's own state (withdrawal or seen record), and is never set by a
   lead, team admin or app admin on another person's behalf. Under the derived design, no grant writes it.
2. **Invariants 33 / 34 / 35** — roles still do not widen coverage; `k = 5` unchanged. Add a **team-size floor** (value
   set by owner, §8f) to invariant 34. Invariant 35 (no persisted aggregates) must be amended if any epoch-freeze or
   stored suppression timestamp is adopted (§4, R2).
3. **Invariant 27 / SPEC BR-11** — amend rejoin (decision §8d).
4. **Invariant 36** — C2 writes only the caller's own membership state (`skillContribution`, withdrawal or seen record)
   and `teamSkillNeeds`. The default is derived, so no other writer is added.
5. **Residual-risk statement (P6)** — add: default inclusion increases the number of contributors, so suppression is
   less frequent. It makes a join or withdrawal correlate with a coverage change (R2), and it lets a lead who adjusts needs
   learn more per probe (R4). Each of these must be stated to participants and explicitly signed off.

---

## 4. Privacy threat analysis: categorical aggregate coverage under default-on

Output stays categorical per need (`covered`, `gap`, `insufficient_data`, `area_unavailable`). No counts, averages,
percentages, rankings, radar values, per-person indicators or trends are added (D2 unchanged). The owner's requirement
that Teamkompetanse never reveal individual levels, identities, submission counts, percentages or distributions is met
by the current output shape, and must stay so.

| # | Risk | Effect of default-on | Verified status and mitigation |
| --- | --- | --- | --- |
| R1 | **Small-team inference** | More contributors, so `covered` or `gap` is more often shown. In a team of about 5, the cohort is the roster, which reveals each member's band. | **Verified gap.** The current code has no team-size rule (C-3). Add a team-size floor: no coverage at all when the team has fewer than a minimum of active members. The owner sets the value (§8f). This review proposes no number. A ratio rule (contributors / roster) is not recommended: any ratio exposes information. |
| R2 | **Join / leave correlation** | A new member is included at join (derived design), so a state flip coincides with a visible roster change. The strongest new risk. | Options, all requiring a decision: (a) **epoch freeze**: coverage changes only at fixed dates. This needs a stored snapshot, which invariant 35 forbids. (b) **Rolling suppression**: return `insufficient_data` for the whole team for N days after any roster or withdrawal change. The window can be computed from `createdAt` and withdrawal records without new aggregates, but the withdrawal timestamp is a stored consent record. Any roster-keyed rule is itself observable, so it must be stated. (c) Accept and disclose, which is the current SPEC position. |
| R3 | **Withdrawal as oracle** | A withdrawal flips the cohort. A lead watching the matrix can connect the flip to a known withdrawal. | Same family as R2. Withdrawal is visible only to the member. Suppression window (R2b) applies. Withdrawal must never be listed or counted in any response. |
| R4 | **Repeated queries / malicious lead** | **Corrected:** default-on does not weaken the oracle. More eligible contributors means more skills pass `k`, so each probe returns more information (C-4). | Existing: lead-only needs, fixed `k`, no query inputs. Add a **per-viewer rate limit** on coverage reads and need edits. This is a runtime control, not a persisted aggregate. Requires approval (§8m). |
| R5 | **Catalog change** | Archiving or changing a team competence area changes which needs exist and which members count. | No history is persisted (invariant 35). Archived areas show `area_unavailable` (§6.4). |
| R6 | **Comparison over time** | Coverage is recomputed, not stored, but an observer can record outputs. | Residual. Stated in the notice. Reduced only by R2(a), which needs an invariant 35 amendment. |
| R7 | **Homogeneous cohort** | Default inclusion makes a `covered` result more likely to reveal every contributor's band. | **Not adopted (C-5).** SPEC threat 5 rejected data-dependent suppression. Residual. Stated in the notice. |
| R8 | **Default counted before the member has seen the notice** | Under O-3 without a seen-record, a member could be counted before any notice. This is a consent defect, not only a privacy one. | Counting only after the seen-record (§2a). Residual gap stated in §2a. |
| R9 | **Team admin action affects a person's state** | Writing the default at grant or invitation time means someone else's action sets a person's state. | Avoided by the derived design (§2a). |

**Suppression rule (proposal):** if R1 (team-size floor) or R2(b) (rolling window, if chosen) applies, the team's
result is `insufficient_data` for every need. The response must have the same shape and not reveal the cause (SPEC
BR-17).

**Limits.** None of these mitigations makes the output anonymous. `k = 5` is a product threshold, not an anonymity
guarantee. Do not describe the output as anonymous in any copy, notice or review.

---

## 5. Notice version and existing-member transition

- **Existing members are not migrated.** No write to any existing `teamMemberships` document. Existing explicit
  opt-ins (presence of the object) remain as they are. Members without an object remain not included.
- **Eligibility for default inclusion** is decided by the membership's `createdAt` (derived design), compared with an
  approved `defaultOnEffectiveAt` in the constant module. It is not decided by a migration script or by a grant write.
- **Notice version:** a notice revision for default inclusion, withdrawal and admin non-visibility is required. Bumping
  `SKILL_CONTRIBUTION_NOTICE_VERSION` (currently `1`) lapses every existing opt-in, and under O-3 also every default
  inclusion, because the lapse is keyed to the version. Two choices, owner decision:
  - (i) bump, and every participant must act again before counting resumes. This is the simplest contract and produces
    churn; or
  - (ii) keep version 1 for explicit members and add a versioned addendum for default-included members. This needs two
    notice versions in force and more code paths.
  **Recommendation: (i)**, with an in-app message and no automatic re-inclusion of lapsed members.
- Under (i), the lapse is a visible state change for every team at once (R3). It must be communicated before activation.

---

## 6. Team-admin-managed assessable competencies

### 6.1 Current components (verified)

| Component | Behavior |
| --- | --- |
| `skillTrees/{treeId}` (global) | Created only through app-admin `requireAppAdmin` (`skill-trees/server/create-skill-tree.ts`). Team admins cannot create trees. |
| `teamCompetenceAreas/{teamId}__{treeId}` (TASK-007, Done) | Team assignment of an existing global tree. Fields: `teamId`, `treeId`, `status` (`active`, `inactive`, `archived`), `sortOrder`, timestamps. Extra keys fail validation (`competence-area.ts`). `archived` is terminal. Managed by team admins through `app/api/teams/[teamId]/competence-areas`. |
| `teamSkillNeeds` (C2) | Per-team need (`requiredLevel`, `requiredCoverage`) for a tree. Written by lead or teamadmin only (BR-5, TA-SI-4). Drives coverage. Does **not** read `teamCompetenceAreas`. |
| `set-own-skill-level` (C1) | Accepts any well-formed tree id and validates by reading that tree's own document. No team filter. |
| `get-team-skill-coverage` (C2) | Reads needs, then trees by id, then levels for the trees named by needs. Area names are read live from the global tree. No snapshot. |

### 6.2 Gaps

- **Team-admin creation** of competencies is not supported. A new team-owned entity would need its own SPEC. It would
  also change how C1 keys profiles (today by global `treeId`), which affects invariant 31 and erasure.
- **Two team-level lists are not reconciled.** `teamSkillNeeds` (drives coverage) and `teamCompetenceAreas` (drives
  plans) can disagree. An area can have a need but be archived, or have an active area with no need.
- **Self-assessment is not restricted** to the team catalog. This is compatible with "private self-assessment", but
  not with a reading of "team admins define which competencies members can assess" as an input restriction.

### 6.3 Recommended design (no schema change for the core)

1. **Single source of truth for "assessable".** The team's assessable set is the set of `active` rows in
   `teamCompetenceAreas`. Contribution (coverage) is limited to needs whose tree is in that set.
2. **Contribution-only restriction (recommended).** Self-assessment stays global, as in C1. A member can rate any tree
   privately. Only assessments on active team areas count toward team coverage. This keeps the C1 owner-only contract,
   avoids a C1 scope change and does not hide existing private data. The owner must confirm this reading (§8j).
   The alternative, an input restriction, is a C1 change that needs its own SPEC and would block private development
   on other trees.
3. **Need validation.** `upsert-skill-need.ts` accepts a need only for an `active` team area. The check reads the area
   document in the same transaction. A need for an area that is later archived is not deleted. Its coverage state
   becomes `area_unavailable` (§6.4). No new persisted field.
4. **Authorization.** Area and need writes use team-administration authority (`canAdministerTeam`, teamadmin role,
   TA-SI-4), as the existing competence-area routes already do. No member or lead write path. App-admin status grants
   nothing new.
5. **Data contract.** Member-visible area responses contain only `treeId`, display name, `status` and `sortOrder`. No
   actor field and no uid. The existing `isValidCompetenceArea` rule is kept.
6. **Coverage reads `teamCompetenceAreas`.** This is a new collection read for C2. It requires a deliberate change to
   `ALLOWED_COLLECTIONS` in `team-skills-scope-guard.test.ts` and a test for each new read path. It is non-personal data.

### 6.4 Safe handling of renamed, archived and inactive competencies

- **Rename.** Area names come from the global tree and are read live. A team cannot rename a global area. Team-specific
  names would be a new field and a decision (§8i). No team-level snapshot of names is stored.
- **Archived.** The need keeps its reference. Coverage for the need returns `area_unavailable` (computed at read time from
  the area status). Kompetanseplan shows the area as archived, as the team-experience edge case already specifies. The
  SPEC does not define Oversikt behavior for archived areas; that is an open item. The archived area's assessments stay private and stop counting.
- **Inactive.** Decision (§8k). Recommended: inactive areas are hidden from the self-assessment picker for contribution
  purposes and count as `area_unavailable` for coverage. The state is reversible.
- **Creation of new competencies by team admins.** Options (§8i): **(A)** not supported in this phase; a team admin
  asks an app admin to create a global tree (no new risk); **(B)** team-owned competencies, which needs its own SPEC,
  a new collection, C1 profile-keying changes, and erasure rows. **Recommendation: A** for this phase.

### 6.5 Tests (for this section, when approved)

- Area validation: unchanged `competence-area.test.ts`, plus a case for a need on an inactive or archived area.
- `upsert-skill-need`: rejects a need for a non-active area in the same transaction; team-admin authority only.
- Coverage: archived or inactive area → `area_unavailable`; no counts; no area-status leak to ordinary members beyond the
  area list.
- C1: self-assessment on a non-team tree still succeeds and stays owner-only (regression).
- Routes: competence-area routes unchanged in shape; member DTO allow-list.
- Scope guard: the new `teamCompetenceAreas` read is an explicit, reviewed allow-list change.

---

## 7. Authorization and Firestore implications

- All reads and writes of `skillContribution` stay server-side (Admin SDK). Client rules continue to deny
  `teamMemberships` and `skillProfiles`.
- **Under the derived design (§2a), the membership grant transaction is unchanged.** No default is written on grant or
  invitation acceptance. If the owner instead chooses a write-at-grant design, the change goes inside the existing grant
  transaction, the writer guard must be changed deliberately, and invariant 32's "never on another person's behalf" must
  be reworded to permit it (not recommended, R9).
- No lead, team admin or app admin may write `skillContribution` for another person (invariant 33). Add a test that no
  request body can set a withdrawal, seen or default value for another uid.
- No rules deployment in this proposal. If the deny-only rules need changes, they are a separate explicit step.
- **Account erasure:** a withdrawal record and a seen record are membership fields and are destroyed with the membership.
  Verify the inventory allow-list (`src/features/account-erasure/server/inventory.ts`, the `teamMemberships` entry lists
  `skillContribution` as a plain field). Any new collection (for example team-owned competencies, §6.4B) needs its own
  inventory row.

---

## 8. Approvals required before activation

Nothing below is approved. Each item is a decision the owner must record before implementation.

a. **Product direction:** O-1 (current explicit opt-in) or O-3 (default-included, no member action). O-2 is O-1 in substance.
b. **Lawful basis and data-protection impact assessment** for O-3. Legal review is required. This document gives no
   legal opinion. Nothing is implemented until the owner has the review.
c. **Mechanism for O-3:** derived default with withdrawal record (recommended, §2a), or write at grant (not recommended).
d. **Rejoin:** default inclusion on rejoin, or non-contributing until explicit action.
e. **Inclusion timing and R2 mechanism:** (a) epoch freeze (requires invariant 35 amendment), (b) rolling suppression
   window with its length, or (c) accept and disclose.
f. **Team-size floor value** (R1). No number is proposed by this review.
g. **Notice transition:** (i) bump with re-action (recommended) or (ii) addendum (§5).
h. **Seen record:** whether a `noticeSeenVersion` (informational, member-written) is recorded (§2a).
i. **Team-admin creation of competencies:** (A) app-admin creates trees (recommended for this phase) or (B) team-owned
   competencies in a separate SPEC.
j. **Self-assessment scope:** contribution-only restriction (recommended) or input restriction (C1 change).
k. **Inactive and archived competencies:** `area_unavailable` behavior and whether a need on an inactive area is allowed.
l. **Rejection of two earlier proposals:** "Delvis dekket" (C-10) and data-dependent suppression of homogeneous cohorts
   (C-5, R7). Confirm both are rejected, or approve a SPEC revision with its own privacy review.
m. **Per-viewer rate limit** on coverage reads and need edits (R4): yes or no.
n. **Security and privacy sign-off** on §4 and the residual-risk statement (P6).
o. **Supersession record:** a new owner decision record that supersedes the 2026-11-06 D1 record, SPEC BR-24,
   OD-6 (team-experience SPEC), and P1/Q5/BR-7/BR-8/BR-11 (team-skill-needs SPEC). Until then those stay in force.

---

## 9. Phased implementation sequence with acceptance criteria

Each phase is independently reviewable. No phase activates default-on sharing. Phases P2 onward require the approvals
in §8 for their scope.

**P0 — Decisions and legal review (owner).** Items §8a–§8o recorded.
- Acceptance: the decision record exists. Legal review for O-3 is recorded or O-1 is confirmed.

**P1 — Document amendment only.** Update `SECURITY.md` (invariants 27, 32, 34, 35 if needed, P6), the team-skill-needs
SPEC (P1, Q5, BR-7, BR-8, BR-11, BR-13), the team-experience SPEC (D1 record, BR-24, BR-25 labels, OD-6, acceptance
criteria) and `DATA-MODEL.md`.
- Acceptance: documents are consistent with the decision record. No code changed. Each conflict between documents is
  resolved or listed as open.

**P2 — Domain model and reader (behind an inactive constant).** Add the withdrawal and seen record shapes to
`skill-contribution.ts`. Keep the legacy exact-shape reader for explicit objects. Add `defaultOnEffectiveAt` as `null`
(inactive). Add the derived-inclusion function with no caller.
- Acceptance: unit tests for legacy objects (unchanged), new shapes, malformed objects (fail closed), and derived
  inclusion when the constant is `null` (always false). No runtime behavior change.

**P3 — Team competence catalog alignment.** Need validation against active areas (§6.3.3); `area_unavailable` for
archived and inactive areas (§6.4); coverage reads `teamCompetenceAreas` with the guard change.
- Acceptance: tests in §6.5 pass; scope-guard allow-list change reviewed; no member-visible actor field.

**P4 — Coverage hardening.** Team-size floor (§8f); R2 mechanism (§8e); per-viewer rate limit if approved (§8m).
- Acceptance: below-floor teams return `insufficient_data` for all needs with the same shape; suppression causes are
  indistinguishable; no timestamp, count or identity in any response; invariant 35 test updated only if approved.

**P5 — Withdrawal and re-enable (explicit opt-in still in force).** Replace the object delete with the withdrawal record
only if O-3 is approved; otherwise keep today's behavior.
- Acceptance: withdraw and re-enable are immediate for the next coverage read; withdrawal record destroyed on removal;
  no GET writes.

**P6 — `/me/skills` control and notice (copy and UI).** Show state ("Du deltar" / "Du deltar ikke"), the notice, the seen
action and withdraw/re-enable. Keyboard operable. No pre-ticked checkbox semantics.
- Acceptance: component tests; notice copy reviewed for the ten notice points (BR-25); no "anonym" claims. Browser checks
  are deferred until Firestore quota is restored.

**P7 — Activation (owner-only).** Set `defaultOnEffectiveAt`, bump the notice version per §8g, and communicate the lapse.
- Acceptance: post-activation tests for new memberships (counted after seen record), rejoin (§8d), existing members
  (not counted), and withdrawal. Rollback path: set `defaultOnEffectiveAt` to `null` and bump the version back is **not**
  available without a notice decision, so the rollback plan must be approved in P0.

---

## 10. Required tests (before activation)

- **Grant:** the grant transaction is unchanged under the derived design. Test that no `skillContribution` field is
  written on invitation creation, invitation acceptance or access-request approval (regression in
  `grant-team-membership`, `create-invitation`, `resolve-invitations` and `approve-access-request`).
- **Derived inclusion:** default-included only for memberships at or after `defaultOnEffectiveAt`, never for existing
  members, never for a rejoin unless §8d allows it, and never while the seen record is missing.
- **Withdrawal and re-enable:** immediate effect on the next coverage read; re-enable is the member's own write; no
  team-admin or lead path can write either.
- **Writers:** no caller can set a withdrawal, seen or default value for another uid (route and gateway tests). The
  exact-writer guard in `team-skills-scope-guard.test.ts` is updated deliberately.
- **Coverage:** derived-included member counted only after seen record; below `k` → `insufficient_data`; below team-size
  floor → `insufficient_data` for all needs; archived or inactive area → `area_unavailable`; team inactive →
  `team_disabled`.
- **Non-exposure:** no uid, e-mail, membership id, state history, withdrawal time or contributor count in any response
  (extend `participation-non-exposure.test.ts` and the roster and membership DTO tests).
- **Reader:** legacy exact-shape objects still read; new shapes read; any unknown key fails closed.
- **Erasure:** membership removal destroys the withdrawal and seen records; inventory allow-list updated.
- **Static guards:** C2 participation boundary and C1 scope guards updated deliberately, not exempted broadly.
- **Browser (deferred):** keyboard path to withdraw and re-enable; notice visible before counting; axe.

---

## 10a. Investigation: existing Teamkompetanse privacy gap (2026-11-07)

This section concerns the **current, approved** C2 implementation, not Option B. It is the highest-priority item.
No code, tests, rules, data or notices were changed. The attacks were reproduced with the real domain function
`deriveCoverageState` (`src/features/team-skills/domain/skill-coverage.ts`) in a temporary test file that was then
deleted. Output (recorded in the session scratchpad):

```
S1 with me      [4,4,4,4,4]  L4 r1: covered
S1 without me   [4,4,4,4]    L4 r1: insufficient_data
S2 team [1,2,4,4,3]  count(>=2)=4  count(>=3)=3  count(>=4)=2   => distribution {1:1, 2:1, 3:1, 4:2} recovered exactly
S3 [4,4,4,4,4]  L4 r5: covered   (every contributor is at level 4 or above)
S4 [4,4,4,4]    L4 r1: insufficient_data
```

### 10a.1 What the API returns, and what the UI shows

- `GET /api/teams/[teamId]/skill-coverage` (`app/api/teams/[teamId]/skill-coverage/route.ts`) returns, per need:
  `treeId`, `areaName`, `requiredLevel`, `requiredCoverage`, `state`, plus `availability`. It takes no query, body or
  level input.
- The Teamkompetanse component (`src/features/team-skills/components/TeamCompetenceCoverage.tsx`) renders the area name,
  "nivå X eller høyere", the state label and the state explanation. It does **not** render `requiredCoverage` or
  `treeId`.
- `requiredCoverage` is rendered elsewhere: the needs table (`TeamSkillNeedsSection.tsx`, `needDescription`) is rendered
  for every member on the team page (`TeamDetail.tsx`). So the value is visible to members through the needs read, not
  only through the API. This is not a hidden value.
- No export route exists for coverage. The team routes are `skill-contribution`, `skill-coverage`, `skill-needs` and
  `skills`.
- Logs: the privacy test asserts that nothing is logged (`get-team-skill-coverage-privacy.test.ts`, "logs nothing").

### 10a.2 Attack scenarios (affected code in brackets)

**A1. Contributor self-toggle reveals the exact cohort size of 5.** [`set-own-skill-contribution.ts`,
`withdraw-own-skill-contribution.ts`, `get-team-skill-coverage.ts` → `deriveCoverageState`]
- Precondition: the attacker is a genuine member, has an effective opt-in, has a valid level for the tree, and the
  team has a need for that tree.
- Steps: read coverage; `DELETE` own contribution; read coverage again; `PUT` to restore.
- Result: if the output was `covered` or `gap` and becomes `insufficient_data` after withdrawal, the cohort with the
  attacker is **exactly 5**. The attacker needs no knowledge of anyone else. The existing test
  `withdrawal and stale consent flip the state` encodes this flip.
- Why it matters: this reveals a contributor count, which the owner's requirement forbids. SPEC threat 7 only
  considers an observer who "knows who opted in/out". A member toggling their own state always has that knowledge.
- Not fixable inside the approved contract without changing an approved behavior (see §10a.4, D-2).

**A2. Lead probing recovers the full level distribution of a small cohort.** [`upsert-skill-need.ts` (lead or
teamadmin writes), `skill-need.ts` (`REQUIRED_LEVELS` 2–4, `requiredCoverage` 1–20), `get-team-skill-coverage.ts`]
- Precondition: a lead or team admin. The team has n ≥ 5 contributors for one tree.
- Steps: for each `requiredLevel` L ∈ {2,3,4}, PUT the need with r = 1, 2, … and observe the state flip from `covered`
  to `gap`. The flip point is count(level ≥ L). For n = 5 this takes at most 5 writes per level.
- Result (S2): the exact count at or above each level, hence the full distribution of levels (level 1 = n − count(≥2)).
  Individuals are not named, but in a team of 5 the distribution is close to individual information, and any extreme
  result (for example all at 4, S3) gives each person's band directly.
- Lead-set need writes carry no actor field (`SKILL_NEED_PERSISTED_KEYS`) and no history, so the probing leaves no
  audit trail. There is no rate limit in `src/features/team-skills` or `app/api/teams`.
- Why it matters: the owner's requirement is "never distributions, and only categorical coverage". This output is
  categorical, but a lead can convert it into distributions. The literal invariant 32 wording holds; the owner's
  stated requirement does not. SPEC P6 and threat 2 accept this as residual, for teams of any size.

**A3. Small-team cohort equals the roster (no team-size rule).** [`skill-coverage.ts` `deriveCoverageState`;
`get-team-skill-coverage.ts`]
- The only rule is `levels.length >= 5`. There is no roster size check. Team size is visible to members in the team
  header (member counts), so the absence of a floor is observable.
- In a 5-member team where all five have opted in and assessed the tree, every `covered` or `gap` describes all five
  people. Combined with A2 (distribution) and with a known member's own level, the others' bands follow directly.
  Combined with A1, a contributor learns the cohort is the whole team.
- The earlier draft claimed this was "already implied; verify". Verified false. BR-13 explicitly excludes team size.

**A4. Join or opt-in differencing, including by team admins.** [`grant-team-membership.ts`, `approve-access-request.ts`,
`create-invitation.ts`, `resolve-invitations.ts`, `set-own-skill-contribution.ts`]
- A team admin or lead who knows that a specific person joined or opted in observes the state of each need before and
  after. When the cohort crosses 5, the first evaluated output describes the whole cohort with that person included.
- This is the SPEC's residual "roster / participation differencing" (threat 6–7). It is cheapest when the observer
  controls the join, because the join time is known.

**A5. Repeated queries without limit.** [`app/api/teams/[teamId]/skill-coverage/route.ts`]
- Each GET recomputes (no cache, `Cache-Control: no-store`, invariant 35 respected). There is no per-viewer rate limit.
- Repeated reads let an observer catch a state change that happens during a join, a withdrawal or a need edit. Combined
  with A1 and A4, each event is a bit of information.
- The reads are not one transaction: needs, memberships, tree documents and profiles are read separately. A change
  during a request can produce a result that mixes two states. SPEC threat notes accept this as racing, but it adds
  noise that an observer can average over repeated reads.

**A6. Subgroup filtering.** Not present. The coverage route ignores query strings and bodies, and no code path selects a
subset of members. Subgroups can only be created by changing membership (A4) or by withdrawal (A1). Keep the existing
test that query parameters cannot change the result, and add one that a body cannot either.

### 10a.3 Does the current implementation satisfy SECURITY.md?

| Invariant | Status | Basis |
| --- | --- | --- |
| 32 (categorical only; no count, ratio, distribution, timestamp, contributor identity) | Met literally. Not met in the owner's stronger sense: A1 and A2 yield counts and distributions | `TeamCompetenceCoverage` and the route allow-list; A1, A2 |
| 32 (participation per team, revocable, destroyed with membership) | Met | `set-own-skill-contribution.ts`, `withdraw-own-skill-contribution.ts`, `grant-team-membership.ts` (no write) |
| 33 (roles do not widen coverage; lead writes needs only) | Met | `upsert-skill-need.ts`, `authorizeTeamAccess` |
| 34 (k = 5 is a fixed constant; no query input) | Met. Fixed constant, no query input. The cut-points come from lead-set needs (A2) | `skill-coverage-policy.ts` |
| 35 (nothing derived is persisted or cached) | Met. A rate limit or a suppression rule keyed to a timestamp would need checking | Route `no-store`; no cache found |
| SPEC BR-13 (team size is not part of k) | Met as written. This is the gap: BR-13 itself excludes the protection the owner needs (A3) | `skill-coverage.ts` |
| SPEC P6 / residual statement | Accurate. A1–A5 are the residual risks it already names, except that A1 is stronger than threat 7 states | SPEC threat model |

**Conclusion.** The implementation matches the approved text, but the owner's requirement is not met for small teams
(A3) or for leads (A2), and A1 reveals a contributor count to any member. A1 is a case that the approved text permits
and the owner forbids.

### 10a.4 Safe correction design

Defense in depth. Layers are listed by whether they stay within the approved contract.

**Layer 1: within the approved contract, no product decision needed (tightening only).**
- **L1-a. Remove `requiredCoverage` from the coverage DTO.** The Teamkompetanse UI does not show it, and it is returned
  only so the component could compute text. Needs-table visibility is a separate decision (D-5). Limited value, since
  the needs table shows it anyway. Changes BR-15's allow-list text.
- **L1-b. Rate limit coverage reads and need writes per viewer and per team.** A runtime control; no persisted data.
  It does not stop A2 but raises its cost. Storage choice matters (D-4): an in-process limiter does not work across
  serverless instances; a Firestore counter adds a write per read.
- **L1-c. Need-change restrictions.** Per need, limit edits to one change per period (for example per day), or allow
  `requiredCoverage` only from a fixed menu. A fixed menu (for example {1, 3, 5, 10}) reduces resolution but does not
  remove the distribution leak. This is a product constraint on leads (D-3).
- **L1-d. Tests.** Query parameters and bodies cannot change coverage; the response DTO is an exact allow-list;
  `requiredCoverage` absence/presence as decided.

**Layer 2: a team-size floor, independent of k (requires owner choice of value; SPEC BR-13 must be clarified).**
- Rule: no coverage (`insufficient_data` for all needs, same shape as other suppression) when the team has fewer than F
  active members. The count of members with a valid level is still k = 5 per skill.
- Privacy reasoning: the floor prevents a cohort from being most of the roster. In a team of 5, any evaluated output
  describes everyone. It does **not** stop A1 or A2, because these work at any team size.
- Value: the owner decides F. Starting point, not a recommendation of a specific number: F = 2k = 10 is the smallest
  roster where k contributors and k non-contributors can both exist. Below it, every evaluated output describes a
  majority of the team. Any F is a judgment, and the chosen number should be stated in the notice (copy change, which
  is a notice-contract question under SPEC BR-8).
- Does it count as within the contract? A floor is an extra suppression, not a lowering of k, so invariant 34 is not
  broken. BR-13's wording ("does not apply to team size") must be amended first. Whether the notice text needs a
  version bump is for the owner to decide (D-1).

**Layer 3: A1 self-toggle. Cannot be closed inside the current contract.**
- Any threshold t creates a boundary where one member's toggle flips the output (n = t gives insufficient_data without
  that member). Raising t moves the boundary, it does not remove it (raising to 6 makes n = 6 the boundary). Raising k
  changes the notice text ("minst 5"), so it is a notice change.
- The only structural fix found is to make a member's own withdrawal take effect at a later evaluation point (for
  example a fixed period), so that the toggle output is not visible at once. This conflicts with an approved behavior:
  team-experience BR-22 and its acceptance criterion require that turning sharing off removes the contribution from the
  next team read, and SPEC BR-9/BR-11 say "effective on the next derivation". It needs an owner decision (D-2).
- Until D-2 is decided, A1 must be recorded as a known residual that **contradicts the owner's requirement**. It must be
  stated to the owner and in the notice, and must not be presented as anonymity.

**Layer 4: lead probing (A2).**
- The only structural limit is on the lead's write surface (D-3): a fixed menu, a per-period change limit, or a freeze
  after the need is created. None removes the leak entirely, because the lead can still learn counts at the menu values.
- Detection: an audit record of need changes (actor uid, treeId, before/after parameters) visible only to app admins.
  This is a new persisted record. `teamSkillNeeds` is deliberately actor-free (SPEC), so this is a decision (D-3), not
  a tightening. It is not derived from assessments, so invariant 35 is not obviously breached, but this needs review.

**Layer 5: join and opt-in differencing (A4) and repeated reads (A5).**
- The team-size floor (Layer 2) and the rate limit (L1-b) reduce, but do not remove, A4 and A5.
- Freeze-epoch publication (coverage recomputed only at fixed dates) removes the join-time signal but needs a stored
  snapshot, which invariant 35 forbids (D-2 family).

**Consistency with invariant 35.** Layers 1 and 2 keep nothing derived. Layer 1-b must avoid storing per-viewer
results. Layer 5 freeze needs an invariant 35 amendment and is not recommended in this step.

**Subgroup filtering.** No change needed beyond the regression test in L1-d.

**Homogeneous cohorts.** Not re-introduced. S3 is shown only to illustrate A2. Suppression based on data patterns stays
rejected (SPEC threat 5, D1 proposal R7).

### 10a.5 Required tests

Existing tests to keep: `get-team-skill-coverage-privacy.test.ts` (k=5 behavior, flips, areas, non-leakage),
`participation-non-exposure.test.ts`, `participation-boundary.test.ts`, `team-skills-scope-guard.test.ts`.

New tests, depending on the decision:
- **T-1 (known-risk, must be recorded):** a contributor's own withdrawal from a cohort of exactly 5 yields
  `insufficient_data`. This test currently documents the flip; it must be renamed or annotated as the accepted
  residual A1 until D-2 is decided. Once D-2 is decided, a deferred-effect test replaces it.
- **T-2 (known-risk):** lead probing returns exact counts at or above each level for n = 5 (S2 reproduced as a test). This
  documents A2 and must be re-run after any D-3 change.
- **T-3 (team-size floor, if approved):** a team below F active members returns `insufficient_data` for every need, with
  the same shape as the k-suppression.
- **T-4 (floor boundary):** a team at exactly F with 5 contributors is evaluated; at F − 1 it is not.
- **T-5 (rate limit, if approved):** exceeding the limit returns a generic status with no data.
- **T-6 (DTO):** the coverage DTO has exactly the approved keys (no `requiredCoverage` if D-5 removes it).
- **T-7 (query and body ignored):** coverage reads with query strings or bodies return the same result.
- **T-8 (need writes):** a lead cannot create a need that violates the approved menu or change frequency (if approved).
- **T-9 (BR-13 wording):** the scope-guard or doc test asserts the floor is named as a separate constant.

### 10a.6 Product and security decisions needed before implementation

- **D-1. Team-size floor F** (value, and whether the notice text changes; BR-13 wording). Recommended starting point
  F = 2k = 10, to be confirmed by the owner. No value is chosen here.
- **D-2. Self-toggle (A1) and join timing (A4).** Either (a) accept A1 and A4 as residual, disclosed as contradicting the
  owner's "no count" requirement, or (b) a deferred effect for withdrawal and joins, which changes BR-9, BR-11 and
  team-experience BR-22. Option (b) needs an approved change to a stated acceptance criterion.
- **D-3. Lead probing (A2).** Choose any of: fixed menu for `requiredCoverage`; per-period edit limit; need freeze after
  creation; an admin-only audit record of need changes (new persisted record; SPEC currently forbids actor fields on
  needs). If the owner's rule "no distributions, even to leads" is absolute, no lead-writable parameter can satisfy it.
  That is a product question about who may set needs.
- **D-4. Rate-limit storage.** In-process versus Firestore counter (adds writes per read). Needs deployment review.
- **D-5. `requiredCoverage` visibility.** Remove from the coverage DTO only, or also from the needs table (members see it
  there today).
- **D-6. Legal and privacy basis (separate).** Unchanged from §8b. The current opt-in contract and the owner's
  default-on direction both need the owner's legal review before any D1 change.

### 10a.7 Minimal ordered implementation plan (after approvals only)

1. **Now, no approval needed:** nothing in this section changes code. This document records the findings. (Done.)
2. **After D-1 and D-5 are decided (Layer 1-a/1-d, Layer 2):** update BR-13 and BR-15 wording in
   `docs/features/team-skill-needs-and-matrix/SPEC.md`; add the floor constant next to `SKILL_COVERAGE_MIN_CONTRIBUTORS`
   in `skill-coverage-policy.ts`; add `deriveCoverageState` input check or a separate `coverageRosterFloor` check in
   `get-team-skill-coverage.ts`; add T-3, T-4, T-6, T-7, T-9. Run the scoped tests for `team-skills`.
3. **After D-4 is decided (L1-b):** add a rate-limit seam to `get-team-skill-coverage.ts` and the route; add T-5.
4. **After D-3 is decided (Layer 4):** implement the chosen lead-write constraint in `upsert-skill-need.ts` and the need
   routes; add T-8; update the scope guard if an audit collection is added.
5. **After D-2 is decided (Layer 3, A1, A4):** either annotate T-1 and T-2 as accepted residuals (option a), or implement
   the deferred effect in `set-own-skill-contribution.ts`, `withdraw-own-skill-contribution.ts` and the coverage read,
   then update SPEC BR-9/BR-11 and team-experience BR-22 (option b).
6. **Documentation:** update SECURITY.md invariants 32 and 34 and the P6 residual text to match the decided layers; state
   A1 and A2 explicitly in the notice copy if they remain (copy review by the owner).
7. **Verification:** run the scoped team-skills tests and the scope guards. Browser checks for the Teamkompetanse view
   stay deferred until Firestore quota returns.

Nothing in §10a is implemented. The owner must approve the decisions above before steps 2 to 6.

## 10b. Team-admin management of assessable competencies: smallest authorization extension

**Current state (verified):**
- Global skill trees: created only through `requireAppAdmin` (`src/features/skill-trees/server/create-skill-tree.ts`).
  Team admins cannot create or change them. This stays as it is.
- Team competence areas (`teamCompetenceAreas/{teamId}__{treeId}`, TASK-007): assign, status change and reorder are
  allowed for `canAdministerTeam` (`src/features/teams/domain/team-authority.ts`): a superadmin, or a genuine membership
  with role exactly `teamadmin`. Implemented in `src/features/team-competence-catalog/server/manage-competence-areas.ts`.
  Already in place; no new collection is needed.
- Needs (`teamSkillNeeds`): written by `upsertSkillNeed` through `requireTeamAdministrator` (`teamadmin` or superadmin,
  TA-SI-4), in `src/features/team-skills/server/upsert-skill-need.ts`.
- Member self-assessment (C1, `set-own-skill-level.ts`): owner-only. No team admin read path exists.

**Gap (verified by grep):** `src/features/team-skills` never reads `teamCompetenceAreas`. Consequences:
- A need can be set for any valid global tree, including trees the team has not assigned or has archived.
- Coverage ignores area status. An archived area still produces `covered` or `gap`.

**Smallest extension (recommended; needs approval, see D-7):**
1. **Need write.** In `upsertSkillNeed`, inside the existing transaction, read `teamCompetenceAreas/{teamId}__{treeId}`
   and require `status === "active"`. Otherwise return an existing error code (for example `skill_unavailable`). No new
   field, no new collection, no change to who may write.
2. **Coverage.** In `getTeamSkillCoverage`, read the area document for each need tree, the same way it already reads
   trees. If the area is missing, `inactive` or `archived`, return `area_unavailable`. No personal data is involved.
   Add `teamCompetenceAreas` to `ALLOWED_COLLECTIONS` in `team-skills-scope-guard.test.ts` as a deliberate, reviewed
   change.
3. **Authorization is unchanged.** Team admins keep area and need writes via the existing rules. App admins keep global
   tree ownership. Team admins get no path to any `skillProfiles` document. C1 remains owner-only.
4. **Member DTO.** Member-visible area responses keep only `treeId`, display name, `status` and `sortOrder`. The
   existing `isValidCompetenceArea` rule rejects extra keys, so no actor field appears.

**Tests:**
- `upsert-skill-need` rejects a need for a missing, inactive or archived area in the same transaction; accepts an active
  area; team admin and superadmin are accepted; an ordinary member or lead (not `teamadmin`) is refused.
- Coverage returns `area_unavailable` for a missing, inactive or archived area and makes no profile read for it.
- A team admin's area or need write does not change any `skillProfiles` document (static and runtime).
- Scope guard: the new read is in `ALLOWED_COLLECTIONS` only, and the change is listed.

**Decision D-7 (required before implementation):** existing persisted needs for trees that are not currently assigned
to the team. Options: (a) they show `area_unavailable` until a team admin assigns the area (no data migration, visible
change for existing teams); (b) a one-off assignment migration by app admin (changes shared data; not allowed without an
explicit request). Recommended: (a), announced to team admins.

**Not recommended in this step:** team-owned competence creation (a new team-scoped tree, team-keyed profiles). That
would change C1 keying, invariant 31 and erasure, and needs its own SPEC.

## 10c. Regression tests and remediation decision (2026-11-07)

Scope: the current approved C2 coverage. Nothing here activates D1, changes consent, notice versions, historical
assessments, Firebase data, rules or superadmin permissions. No code path that serves production responses was changed.
No Firebase calls were made.

### 10c.1 Permanent regression tests

File: `src/features/team-skills/server/teamkompetanse-leak-regression.test.ts` (new). Synthetic data only; Firebase is
mocked to throw. The test calls the production operation `createGetTeamSkillCoverage` with injected fakes, and the
level reader is a fake that follows the documented `ReadSkillLevels` contract. It does not import the production batch
adapter, because the team-skills scope guard pins that import to listed files.

| Case | Test | Current result (verified) | Required safe property |
| --- | --- | --- | --- |
| Fixture sanity | five consenting level-4 members → `covered`; four → `insufficient_data`; pure derivation | Passes | Proves the fixtures reach the states the vulnerability cases depend on |
| A1 | `it.fails`: one contributor's withdrawal from five does not change the published state | Fails on the assertion: `insufficient_data` vs `covered` | A single member's withdrawal does not flip between an evaluated state and suppression |
| A2 | `it.fails`: a requiredCoverage sweep for each level does not recover the exact count at or above each level | Fails on the assertion: recovered `{2:4, 3:3, 4:2}` equals the true cohort | Threshold sweeps do not reconstruct the distribution |
| A3 | `it.fails`: a five-member team with all contributing is not published as `covered` or `gap` | Fails on the assertion: `covered` | No evaluated state for a roster this small (floor F ≥ 6; the case is valid for every F ≥ 6) |
| A4 | `it.fails`: one opt-in that completes a cohort of five does not change the state on the next read | Fails on the assertion: state changes | A single opt-in does not change the published state immediately |

Expected-to-fail convention: `it.fails` passes while the vulnerability exists. When a remediation is implemented, the
case starts failing. At that point change `it.fails` to `it` and keep the assertion. Do not delete it. Checked by
temporarily swapping `it.fails` to `it` and confirming each case fails on the stated assertion (scratch file removed).

Results: `vitest run src/features/team-skills`: 28 files, 675 passed, 4 expected-to-fail. `tsc --noEmit`: 0 errors. ESLint
on the new file: clean. The existing privacy tests (`get-team-skill-coverage-privacy.test.ts`) and scope guards were
not weakened or edited.

Note on the first draft of the file: the scope guard failed because the file imported the batch adapter and named the
`skillContribution` field. The fix was to inject the reader and use the existing `SKILL_CONTRIBUTION_FIELD` constant.
The guard allow-lists were not changed.

Clock: the cases have no time dependency today. Any time-based mitigation (§10c.3) requires an injected `now` in the
operation. Without it the cases cannot be made deterministic.

### 10c.2 Affected files and API paths (verified)

| Surface | File | Exposes | Status |
| --- | --- | --- | --- |
| `GET /api/teams/[teamId]/skill-coverage` | `app/api/teams/[teamId]/skill-coverage/route.ts` → `get-team-skill-coverage.ts` | `treeId`, `areaName`, `requiredLevel`, `requiredCoverage`, `state`, `availability`. No query, body or level input. `Cache-Control: no-store` | Only coverage route. The DTO is an explicit allow-list. `requiredCoverage` is not rendered on the Teamkompetanse page |
| Teamkompetanse UI | `src/features/team-skills/components/TeamCompetenceCoverage.tsx` (page `app/(app)/teams/[teamId]/competence/page.tsx`) | Area name, "nivå X eller høyere", state label and explanation. The explanation text states the threshold of five | Hiding is a UI decision only; the server is the control |
| `GET /api/teams/[teamId]/skill-needs` | `src/features/team-skills/server/list-skill-needs.ts` | Needs including `requiredCoverage` for any genuine member. Rendered in `TeamSkillNeedsSection` for every member on the team page | Needs are readable by members by design (BR-4). This is the baseline a probe uses |
| `PUT/DELETE /api/teams/[teamId]/skill-needs/[treeId]` | `upsert-skill-need.ts`, `delete-skill-need.ts` (`requireTeamAdministrator`) | Writes only. No actor field, no history, no rate limit | Source of A2 |
| `PUT/DELETE/GET /api/teams/[teamId]/skill-contribution` | `set-own-skill-contribution.ts`, `withdraw-own-skill-contribution.ts`, `get-own-skill-contribution.ts` | Own state only | Source of A1 and A4 |
| `GET /api/teams/[teamId]/skills` | `src/features/skill-trees/server/get-team-skill-progress.ts` | Team skill progress from `skillProgress`. No coverage call; no count or coverage field found by grep | Not an additional coverage surface |
| Logs | Asserted empty by the privacy test ("logs nothing") | None | Keep |
| Exports, debug routes | No export route for coverage. No debug route under `app/api/teams` | None | Keep |
| Membership DTOs | `grant-team-membership.ts` and roster routes | No `skillContribution` (SPEC BR-10, `participation-non-exposure.test.ts`) | Keep |

Server-side only: every mitigation below is in `get-team-skill-coverage.ts`, `upsert-skill-need.ts` or the
`skill-coverage` route. None relies on hiding a value in React.

### 10c.3 Attacks and recommended mitigations

**A2 (priority). Threshold sweep reveals the rating distribution.**

- **M2-1 Edit-settle suppression (recommended first step).** A need whose `updatedAt` (existing persisted field) is
  within a window W returns `insufficient_data`, with the same shape as other suppression. Each sweep step is an edit,
  so every read taken during a sweep is suppressed and the sweep recovers nothing. The lead can still sweep, but only
  one observation per need per W. Computed at read time; no new field; no snapshot. Consistent with invariant 35.
  Costs: after any edit the team sees "Ikke nok grunnlag" for W. Needs decisions on W and copy (D-1).
- **M2-2 Fixed requiredCoverage menu** (for example {1, 3, 5, 10}). Reduces resolution, so a sweep learns fewer
  distinct counts. It does not remove the distribution leak, because the menu values still reveal counts at those
  values. Supporting, not sufficient (D-5).
- **M2-3 Per-period edit limit.** Largely subsumed by M2-1. Use only if W is rejected.
- **M2-4 Separate editable requirements from published results.** The only complete separation is a stored published
  snapshot that changes on a schedule. This conflicts with invariant 35 ("nothing derived is persisted") and needs an
  explicit amendment (D-3). Recommended to decide, because M2-1 bounds the rate but not the eventual exact recovery.
- **Restriction on team admins.** Team admins and superadmins write needs under the same rule. Restricting them
  structurally means changing who may set needs (product decision, D-5). Audit of need changes is a new persisted
  record and is decided separately (D-5).

**A1. Self-toggle reveals the exact contributor threshold.**

- **Suppression near the threshold does not fix A1.** Any fixed boundary n = t is revealed when a member at the boundary
  toggles, because the state flips between evaluated and suppressed. A band (suppress for n ∈ [k, k+m]) only moves the
  flip to the band's upper edge. Raising k to 6 moves the boundary and changes the notice text ("minst 5"), which is a
  notice-contract change (SPEC BR-8).
- **Deferred withdrawal effect (the only structural fix found).** A withdrawal keeps counting until the next
  publication point (§10c.3 A4). This needs a stored withdrawal marker (negative state), which conflicts with SPEC P1
  ("no negative state") and invariant 32, and with team-experience BR-22's acceptance criterion ("turning sharing off
  removes the contribution from the next team read"). Owner decision (D-2).
- **Until D-2 is decided:** A1 is an accepted, documented violation of the owner's requirement. It must not be presented
  as anonymity, and the expected-to-fail case stays.

**A3. Five-member team exposes whole-team coverage.**

- **Team-size floor F, independent of k.** The operation already scans memberships (`listMembershipsForCoverage`), so
  the roster size is available without a new read. Rule: fewer than F active members → `insufficient_data` for every
  need, with the same shape as k-suppression.
- **Why it works:** a cohort that is most of the roster describes almost everyone, so the floor stops evaluated
  states for small rosters. The regression case uses a roster of five, which is below any F ≥ 6.
- **Limit:** the floor does not stop A1 or A2 at any roster size. Roster size is already visible to members (team header
  counts), so the floor's existence is observable. Its value is an owner decision (D-4). The rationale for F = 2k = 10
  (k contributors and k non-contributors can both exist) is a starting point, not a decision.

**A4. Join or opt-in changes the published state immediately.**

- **Stable publication by computed epochs.** Publish the state as of the last epoch boundary of period P: an opt-in or
  join counts only when its timestamp is before the current epoch start. Inputs are existing fields: membership
  `createdAt` and contribution `consentedAt`. No snapshot is stored; the rule is computed at read time. Within an epoch,
  joins and opt-ins are invisible; the output changes only at boundaries.
- **Why it works:** a single join or opt-in cannot change the published state on the next read, which is what the A4
  case asserts. It requires an injected `now`.
- **Limits:** boundaries are predictable and an admin who knows the join date sees the flip at the next boundary, so the
  timing correlation is delayed, not removed. Withdrawals need the same treatment, which is D-2. `consentedAt` is
  documented as "never used for any decision" (SPEC), so this needs a SPEC amendment.

**Compatibility with invariant 35 (no persisted derived data, no cache).**

| Mitigation | Persists nothing derived | Note |
| --- | --- | --- |
| M2-1 edit-settle suppression | Yes | Uses `updatedAt` |
| Team-size floor F | Yes | Uses the existing membership scan |
| Epoch-based publication (joins, opt-ins) | Yes | Uses `createdAt`, `consentedAt`; no snapshot |
| Deferred withdrawal (A1) | No, not by itself | Stores a withdrawal marker (consent state). Amends invariant 32's "no negative state" and P1 |
| Published snapshot (M2-4) | No | Conflicts with invariant 35; requires amendment |
| Per-viewer rate limit | Depends on storage | In-process limiter is compatible but not effective across instances; a Firestore counter is a new write per read and needs review |
| Need-change audit | No | Persisted record of lead actions; SPEC BR-1 forbids actor fields on needs; a separate audit collection needs review |

### 10c.4 Minimal implementation sequence (each step needs the approval shown)

1. **Injected clock.** Add an optional `now` dependency to `createGetTeamSkillCoverage`. No behavior change. Needed for
   every time-based case. Approval: owner confirms the non-behavioral refactor.
2. **M2-1 edit-settle suppression.** Approval D-1 (window W, copy). Add a test that a sweep of edits returns only
   suppressed results; the A2 case is re-run with an advancing clock. Expected result: A2 still asserts non-exact recovery.
3. **Team-size floor.** Approval D-4 (value F, BR-13 wording). Add tests T-3 and T-4 from the proposal. A3 case is
   switched to `it` once the floor exists.
4. **Epoch publication for joins and opt-ins (A4).** Approval D-2 (period P) and a SPEC amendment for `consentedAt`. A4
   case is switched to `it`.
5. **Deferred withdrawal (A1).** Approval D-2 (negative state; amends invariant 32, P1, BR-9/BR-11, team-experience
   BR-22). A1 case is switched to `it` only after the change is approved.
6. **Lead write constraints (A2 supporting).** Approval D-5 (menu, audit). Changes `upsert-skill-need.ts` and the need
   routes; scope guard updated deliberately.
7. **Rate limit.** Approval D-6 (storage). Adds a seam to the coverage route.
8. **DTO.** Approval D-7 (remove `requiredCoverage` from the coverage response). Changes BR-15 wording.
9. **Documentation.** Update SECURITY.md invariants 32, 34, 35 and the P6 residual text; SPEC BR-9, BR-11, BR-13, BR-15,
   BR-22; DATA-MODEL. Notice text changes follow SPEC BR-8.

Nothing in §10c.4 is implemented. Each step is blocked on its approval.

### 10c.5 Approvals required

- **D-1.** Window W for edit-settle suppression (M2-1), and the user-facing copy.
- **D-2.** Withdrawal and join timing: period P; whether withdrawals become a negative state with a deferred effect
  (amends invariant 32, P1, BR-9, BR-11, team-experience BR-22); whether A1 and A4 are accepted residuals instead.
- **D-3.** Whether a published snapshot may be stored (amends invariant 35). Recommended to decide, because it is the only
  full separation of editable requirements from published results.
- **D-4.** Team-size floor F, and the BR-13 wording change ("does not apply to team size").
- **D-5.** Lead write constraints: fixed menu for `requiredCoverage`, need-change audit (new persisted record), and whether
  team admins keep write rights unchanged.
- **D-6.** Rate-limit storage and deployment review.
- **D-7.** Remove `requiredCoverage` from the coverage response.
- **D-8.** Legal and privacy basis for default-on participation (unchanged from §8b, separate).

## 10d. Final publication architecture (2026-11-07). Recommendation; nothing implemented, nothing amended

Owner constraints applied: (1) withdrawal of private contribution is immediate; (2) no immediate categorical change caused
by a join, opt-in, withdrawal, requiredCoverage edit or cohort crossing of k; (3) D1 Option B stays inactive; (4) invariant 35
is not amended yet, but the amendment needed is stated exactly.

### 10d.1 Three things that must be kept apart

| Thing | Immediate or delayed | Rule |
| --- | --- | --- |
| **Contribution** (a member's private assessment counting toward a team) | **Immediate.** Withdrawal deletes the membership's `skillContribution` object in the same request | Excluded from every computation that runs after the request. No deferred withdrawal |
| **Publication** (what a team member sees as a categorical state per need) | **Delayed to the next publication epoch**, and only if the publication inputs did not change in the epoch | Changes only at epoch boundaries |
| **Previously published state** | Replaced at the next boundary, not at the event | Replaced by `insufficient_data` when inputs changed in the epoch; by a fresh categorical state otherwise |

This split satisfies constraint 1 exactly: the private assessment is removed from new computations at once. The
publication is the only thing that waits.

**Why an immediate snapshot invalidation is not offered.** Invalidating a displayed state at the moment of withdrawal
is itself an immediate categorical change, which reveals the event. The only way to avoid revealing the event while
invalidating immediately is to change the display for everyone at once, which is not possible without a change at a
predictable time. So invalidation is tied to the boundary. The residual is in §10d.5 (R1). This is an owner decision
(O-1 below); it is not hidden.

### 10d.2 Recommended publication architecture

**Epoch.** A fixed, server-defined grid of length P (owner decision, §10d.6). Epoch index = `floor((now − origin) / P)`.
The index is internal and never returned to clients.

**Publication inputs.** Anything that can change a categorical state: memberships (join, leave, contribution, opt-in,
withdrawal), member self-assessment levels for trees that have needs, team need records (create, edit, delete), and
team competence area status (`teamCompetenceAreas`).

**Change flag.** Each publication input write sets a per-team flag `changedInEpoch = E` (or per need, for a need edit).
The flag is written in the same transaction as the input change. It stores only the epoch index: no member identity,
no count, no level and no timestamp.

**Publication step (at each boundary).**
1. For each team with a need, read the flag for the closing epoch.
2. If the flag is set, the published state of every need in that team becomes `insufficient_data`. (For a need-only
   edit, only that need is set.) No cohort is read and no count is computed.
3. If the flag is not set, compute each need's state from the canonical sources using the current k = 5, the team-size
   floor F and the current cut-points, and store only the categorical state.
4. Clear the flag. Overwrite the previous published state. Keep no history.

**Read path.** `GET skill-coverage` serves the stored publication. It does not recompute. A team that has never been
published returns `insufficient_data` for each need.

**Why this shape.** Withdrawal can stay immediate because the withdrawn assessment is removed from the next computation,
and nothing is computed between boundaries. The displayed state cannot change between boundaries, so no event is visible
at its own time. Any input change in the epoch produces the same outcome (suppression), so the outcome does not depend on
the size of the change.

**Publisher.** The boundary step should run as a scheduled server job. A lazy compute on the first read after a boundary
is possible but lets the first reader choose the instant of computation within the epoch. That gives a member a small
control over timing. Scheduling is deployment infrastructure and needs an explicit request.

### 10d.3 How each attack is blocked (and what each test asserts)

**A1. Self-toggle reveals the exact threshold.**
- Mechanism: the member's withdrawal sets the epoch flag. At the boundary the team is suppressed whatever the cohort
  size, so the suppressed state carries no count. The cohort size at the boundary is never read after a change.
- Remaining: the member and any observer learn that **some input changed** in the epoch (R2). They do not learn which
  input, by whom, or the cohort size.
- Test status: the existing expected-to-fail case A1 becomes passing once implemented (displayed state unchanged on the
  next read). It must be paired with a boundary test (below) so it cannot pass vacuously.

**A2. Repeated requiredCoverage changes reveal the distribution.**
- Mechanism (three layers):
  1. Publication happens only at a boundary: the displayed state for a need is fixed for the whole epoch, so a sweep
     within one epoch observes one value.
  2. A need edit sets the need's flag, so the boundary after an edit publishes `insufficient_data` for that need. A sweep
     therefore cannot read a state for the value it just wrote.
  3. At most one change per need per epoch, enforced server-side from the existing `updatedAt` compared with the current
     epoch start. A second edit in the same epoch is refused.
- Bits budget: each published state is at most one observation. For a cohort of 5 with three cut-points, the count at or
  above each cut-point takes six values, so recovering the exact distribution needs at least 3 × log2(6) ≈ 7.75, so 8
  observations. Because an edit epoch publishes nothing for that need, one observation needs at least two epochs, so
  exact recovery takes at least 16 epochs, with membership changes expected to blur it.
- Remaining: the distribution is recoverable over time (R4). This is a time bound, not an elimination.
- Test status: the existing A2 case passes once implemented, because a single-epoch sweep yields one state. It must be
  paired with a sanity case that a boundary publication happens after a quiet epoch.

**A3. Five-member team exposes whole-team coverage.**
- Mechanism: a team-size floor F applied to the roster (all active members), not to contributors. The roster is not
  changed by a withdrawal, so the floor does not create a new self-toggle signal. Below F the publication is
  `insufficient_data` for all needs.
- Remaining: a roster at or above F can still be most of a small team. Per-member influence on counts is 1/n, and F
  limits how often n is near the threshold (§10d.4).
- Test status: the existing A3 case (roster 5) passes for any F ≥ 6.

**A4. Join or opt-in changes the published state immediately.**
- Mechanism: the join or opt-in sets the epoch flag. Its effect on categories is never visible before the boundary, and
  at the boundary the team is suppressed rather than evaluated. The cohort crossing k is therefore never shown as a
  categorical change; a crossing can only appear in an epoch with no inputs changed.
- Remaining: a boundary suppression reveals that some input changed in that epoch (R2). Compare the current position: a
  crossing is directly visible.
- Test status: the existing A4 case passes once implemented (next-read state unchanged).

### 10d.4 Choosing W and F (defensible method)

- **W (edit-settle window) is not a separate parameter.** Edits take effect only at the next boundary and suppress that
  boundary. The effective settle time is one to two epochs. Choose P, not W.
- **P (epoch length) method.** Let H be the owner's acceptable horizon for exact recovery of a distribution (for example
  12 months). Each cohort of size n needs at least B = 3 × log2(n + 1) observations, with at least two epochs per
  observation (at least 16 epochs for n = 5). Choose P ≥ H / (2B). For H = 12 months (365 days) and n = 5, B ≈ 7.75, so P ≥ 365 / 15.5 ≈ 23.5 days; P = 30 days
  gives about 16 months at n = 5 and is the natural round value. The method is explicit, so the owner can change H.
- **F (roster floor) method.** Two requirements: (a) at least k contributors can exist, so F ≥ k; (b) at least k
  members can be non-contributors, so that a non-contributing majority is always possible, so F ≥ 2k. Hence **F = 2k = 10
  is the minimum that the method supports**. A higher F reduces how often a cohort is most of the roster. The owner
  chooses the value; F is not derived from any real team data (none is used).
- **k stays at 5.** Raising k alone does not solve A1 to A4 (the boundary moves). Changing k is a notice change (SPEC BR-8).

### 10d.5 Residual inference (not eliminated)

- **R1. Stale publication.** The published state reflects a withdrawn assessment until the boundary (at most P). A
  reader who records the state can see that influence once.
- **R2. Change-presence bit.** Each team and epoch reveals whether any publication input changed. It reveals no member,
  count, level or cohort size. A member who knows their own action learns nothing new from it. Members who did not act
  learn only that someone in the team acted.
- **R3. Erasure.** Account erasure removes data that feeds publication. Either it sets the flag (same as withdrawal, R1
  and R2 apply) or it forces an immediate change, which reveals erasure. The choice is an owner decision (O-6).
- **R4. Admin distribution probing.** Bounded in time (§10d.3, A2): at least 16 epochs for n = 5 with no membership
  change. Not eliminated.
- **R5. Collusion and self-knowledge.** A contributor who knows their own level, plus a colluder, narrows others at the
  margins of the cohort. Accepted in SPEC BR-21; not affected by this design.
- **R6. Homogeneous cohorts.** Revealed by any categorical result (SPEC threat 5). Data-dependent suppression stays
  rejected.
- **R7. Predictable boundaries.** Boundaries are fixed and public. A team can plan changes around them, which reduces
  the protection of the change flag for a deliberate actor. Mitigation is limited to the epoch length.
- **R8. Operator access.** Admin access to Firestore is not a product entitlement and is not changed by this design.

### 10d.6 Invariant 35: compatibility and the amendment required

**Current wording (quoted from `docs/SECURITY.md`):** "Nothing derived from personal assessments is persisted or cached:
no aggregate, coverage/gap score, matrix snapshot, contribution record, history or trend. Every coverage request
recomputes from the canonical sources. ..."

**Mechanism by mechanism:**

| Proposed item | Stores private assessment data? | Stores contributor identity or counts? | Stores categorical publication state? | Computed on demand? | Conflict with inv. 35 |
| --- | --- | --- | --- | --- | --- |
| Withdrawal deletes the contribution object (immediate) | No | No | No | n/a | None (already current behavior) |
| Edit-settle and roster floor, computed at read time | No | No | No | Yes | None |
| Epoch grid (computed index) | No | No | No | Yes | None |
| Stored publication per (team, need) | No | No | **Yes** (a "matrix snapshot", "coverage state") | No | **Yes**: literally forbidden, and "every request recomputes" fails |
| Per-team change flag per epoch | No | No (no member identity) | Records a "contribution record" event | No | **Yes**: "contribution record" forbidden |
| Previous publication kept after overwrite | — | — | — | — | Forbidden ("history") and not needed; do not keep |

**Why an amendment is unavoidable.** Immediate withdrawal together with a stable display cannot both hold without state
that survives between boundaries. If the display is recomputed on demand, it changes at the withdrawal (A1). If it is
stored, invariant 35 must allow it. So the choice is: amend, or accept an immediate display change on withdrawal.

**Smallest amendment that preserves the owner's requirements.** Replace the invariant 35 wording with:

> 35. Nothing derived from personal assessments is persisted, except (a) one current categorical publication state per
> team and assigned need, written only by the server at a publication boundary, which holds only the categories
> `covered`, `gap`, `insufficient_data` and `area_unavailable` and no count, ratio, level, identity, timestamp or history,
> and is overwritten at each boundary; and (b) one per-team flag holding only the index of the last epoch in which a
> publication input changed, with no member, count or level. No previous publication is retained. Reads serve the
> current publication; they do not expose the epoch index or any timestamp. A cohort that cannot be read completely
> yields `incomplete` with no rows, and any read failure yields an error with no partial result.

Also amend SPEC BR-20 and the threat-model text that refers to "no history/snapshot" accordingly, and SPEC BR-9/BR-11 only
where an inclusion timing is stated. **Do not amend until the owner approves (O-2).**

### 10d.7 Required authorization and API changes (server-side)

| Surface | Change | Authority |
| --- | --- | --- |
| `GET /api/teams/[teamId]/skill-coverage` | Serve the stored publication. Remove `requiredCoverage` from the DTO. No epoch index, no timestamp. Keep `no-store` and the query-free contract | Unchanged (`authorizeTeamAccess`, genuine active member) |
| `GET /api/teams/[teamId]/skill-needs` (member view) | Remove `requiredCoverage` from the member DTO; keep `treeId`, `areaName`, `requiredLevel`. The lead or teamadmin view keeps it | Unchanged |
| `PUT/DELETE /api/teams/[teamId]/skill-needs/[treeId]` | Refuse a second change to the same need in the same epoch. Set the need's flag in the same transaction. Enforce the cut-point menu if chosen | `requireTeamAdministrator` (unchanged) |
| `POST/PUT/DELETE` competence areas (`teamCompetenceAreas`) | Set the team flag when an area status changes for a tree with a need. Refuse nothing new | `canAdministerTeam` (unchanged) |
| `PUT/DELETE /api/teams/[teamId]/skill-contribution` | Set the team flag in the same transaction. The object is still deleted immediately | Own membership only (unchanged) |
| Membership grant, removal, access approval (`grant-team-membership.ts`, `approve-access-request.ts`, `resolve-invitations.ts`, removal path) | Set the team flag in the same transaction. Shared transaction: scope-guard change required | Unchanged |
| C1 `set-own-skill-level`, `clear-own-skill-level`, `delete-own-skill-profile` | Set the team flag for each team with a need that uses the tree. **New cross-feature write from C1 into a C2 flag.** Requires a scope-guard change and a review of invariant 31 and 36 | Owner's own data only (unchanged) |
| Boundary publisher (new server job) | Reads canonical sources at the boundary, writes the publication and clears the flag. Writes nothing else | Server only; no client path |
| Rate limit (optional) | Per-viewer limit on coverage reads. Storage decision | Unchanged |

Authorization invariants that must hold after the change: team admins never gain a read path to `skillProfiles`; C1
remains owner-only; no client Firestore access is added; the publication is written only by the server; the change flag
carries no identity.

### 10d.8 Acceptance criteria (measurable)

Protected behavior, public API, UI, timing, tests and residual risk for each case.

**A1.**
- Protected: a single member's withdrawal does not change any displayed state before the next boundary, and after the
  boundary the state is `insufficient_data` regardless of cohort size.
- API: `DELETE skill-contribution` → 200 immediately; the member's contribution is excluded from every later publication
  (verified by a fake reader that records uids). `GET skill-coverage` before the boundary returns the same rows as before
  the withdrawal.
- UI: the Teamkompetanse table is unchanged until the boundary; then it shows the suppressed text for all needs.
- Timing: the flag is set in the same transaction as the withdrawal; the publication runs at the boundary.
- Tests: existing expected-to-fail A1 → `it` (next-read assertion). New: boundary suppression is identical for cohorts of
  4 and 5 contributors (same rows and states); the withdrawn uid never appears in a later read; `DELETE` is immediate.
- Residual: R1 (up to P), R2 (change-presence bit).

**A2.**
- Protected: a sweep of `requiredCoverage` values within one epoch yields one observed state per need; a second edit in an
  epoch is refused; the exact distribution is not recoverable in fewer than 16 epochs for n = 5 with no membership change.
- API: second `PUT` in the same epoch → 409 with a generic code (no state, no count). `GET skill-coverage` has no
  `requiredCoverage` key (exact allow-list test).
- UI: after an edit, the need shows `insufficient_data` until the next quiet boundary.
- Timing: edits take effect at the next boundary; the flag is set in the same transaction as the edit.
- Tests: existing expected-to-fail A2 → `it`. New: second edit in one epoch refused; after a quiet boundary the state is
  published; DTO allow-list has no `requiredCoverage`; member needs DTO has no `requiredCoverage`; a sweep across all
  cut-points within one epoch returns one distinct state.
- Residual: R4 (time-bounded distribution recovery); R7.

**A3.**
- Protected: a roster below F is never published as `covered` or `gap`.
- API: `GET skill-coverage` → rows with `insufficient_data`, identical shape to the k-suppressed rows.
- UI: the same suppressed text as k-suppression; no hint that the cause is roster size (SPEC BR-17).
- Timing: applied at the boundary; a roster change sets the flag, so the change is never shown at once.
- Tests: existing expected-to-fail A3 → `it`. New: roster F − 1 and F with five contributors (F − 1 suppressed, F
  evaluated only in a quiet epoch); both rows have the same shape.
- Residual: R5, R6; a roster at F can still be most of a small team.

**A4.**
- Protected: a single join or opt-in does not change any displayed state on the next read, and never produces an
  evaluated state at the boundary of the epoch in which it happened.
- API: `PUT skill-contribution` → 200 immediately; `GET skill-coverage` unchanged until the boundary.
- UI: unchanged until the boundary.
- Timing: the flag is set in the same transaction; the boundary suppresses.
- Tests: existing expected-to-fail A4 → `it`. New: opt-in in an epoch → boundary publishes `insufficient_data`, not an
  evaluated state; a quiet epoch after it publishes the evaluated state.
- Residual: R2 (change-presence bit).

**Sanity cases required with every flip.** Each expected-to-fail case must be paired with a positive assertion that a
quiet boundary publishes a state, so that the stable display cannot pass vacuously. The fixtures need an injected clock
(§10c.1). A test that does not inject the clock is not valid for these cases.

### 10d.9 Minimal implementation sequence (blocked on the approvals in §10d.10)

1. Injected clock and epoch index in `get-team-skill-coverage.ts` (no behavior change).
2. Change flag and per-need flag in the same transactions as each publication input write (§10d.7 rows, one at a time,
   each with a test). This is the largest step and touches shared transactions.
3. Publication store and boundary publisher; read path changed to serve the stored publication. Needs O-2 (invariant 35
   amendment) first.
4. Team-size floor F (O-4) and the k check, computed at the boundary.
5. Edit-once-per-epoch rule and `requiredCoverage` removal from the member DTOs (O-5, O-7).
6. Flip the four expected-to-fail cases to `it` and add the sanity cases.
7. Docs: SECURITY.md invariant 35 (after O-2), SPEC BR-20, BR-9/BR-11 timing text, team-experience BR-22 acceptance
   criterion (changed to "next publication"), notice copy if the user-facing text changes (SPEC BR-8).

Nothing in §10d.9 is implemented.

### 10d.10 Owner decisions

- **O-1. Previously published state.** Replace at the next boundary (recommended), or invalidate immediately (reveals the
  withdrawal event as a categorical change; not recommended). Accept R1.
- **O-2. Invariant 35 amendment** (wording in §10d.6). Required for any stable publication. Recommended, because the
  alternative is an immediate display change on withdrawal.
- **O-3. Epoch length P** (method in §10d.4; recommended 30 days with horizon 12 months at n = 5).
- **O-4. Team-size floor F** (method in §10d.4; minimum 10 = 2k). Also confirm that F counts the roster, not contributors.
- **O-5. Edit limit** (one change per need per epoch, recommended) and whether the cut-point menu is fixed.
- **O-6. Erasure** (sets the flag, recommended; or immediate change, which reveals the erasure).
- **O-7. Member DTOs.** Remove `requiredCoverage` from the member needs view and the coverage DTO (recommended).
- **O-8. C1 writes set a C2 flag.** Accept this cross-feature write (requires scope-guard change, and invariants 31 and
  36 to be restated), or accept that a self-assessment edit is not an input and leave that as residual.
- **O-9. Scheduler.** Approve a scheduled server job for the boundary publisher (deployment: explicit request), or accept
  lazy compute with its timing residual.
- **O-10. Legal and privacy basis for D1 default-on** (unchanged, §8b). Blocks activation regardless of the above.

## 10e. Teamkompetanse radar (kompetanseprofil) for teams of three or more (2026-11-07)

**Status: design only. Nothing implemented. Blocked on decisions R-1 to R-3 below.** The owner's new direction is
recorded here as a requested change. It has not been approved as an amendment to D2, OD-1 or invariants 32–35.

### 10e.1 What the owner's direction changes, and what it conflicts with

| Requested | Conflicts with (recorded decision) | Consequence |
| --- | --- | --- |
| Teams of three or more supported; radar for small teams, not permanently suppressed | Invariant 34: `k = 5` is a fixed constant; lowering it needs a SECURITY revision and a notice-version bump (which lapses all participation). Team-experience D2: "No team radar coordinates, numeric averages or trends" | A three-member team can never reach k = 5. Showing a per-axis value needs either a lower k (security change) or a non-personal source (no k needed) |
| Green polygon = summarized team competence per axis | Invariant 35 (no derived aggregate persisted or cached) and BR-25/BR-26 (categorical coverage only) | A polygon of levels is a per-area level, not a categorical coverage state. It is a new output class |
| No individual ratings, counts, averages, decimals or distributions in API or UI | Consistent with invariants 32–35. Requires that the summary is not derived from individual ratings at small n | See §10e.2: no individual-derived summary is defensible at n = 3 |
| Dashed target from role or competence expectation | Target values already exist: `teamSkillNeeds.requiredLevel` (lead-set, readable by members) | Reuse; no new data |
| Reuse `teamCompetenceAreas` | Consistent (TASK-007) | Extend, do not duplicate |

### 10e.2 Privacy test: can any aggregation of three individual ratings be published?

Method (synthetic, exhaustive, no real data): all 4³ = 64 rating triples (levels 1–4) for three members. The observer is
member X with a known rating x; the published value v = f(x, y, z) is what the observer sees. For each candidate f the
test counts (a) how often another member's exact level is determined, and (b) the mean number of levels left possible for
another member (of 4). Uniform priors are assumed; real priors are not uniform, so these are lower bounds on leakage for
skewed teams.

| Candidate f (published per axis) | Exact level of another member determined | Mean candidate levels left (of 4) | Narrowed to ≤ 2 levels |
| --- | --- | --- | --- |
| Median of three | **9 %** (6/64) | 3.19 | 28 % |
| Second-highest bucket | **9 %** (6/64) | 3.19 | 28 % |
| Maximum | 2 % (1/64) | 3.44 | 13 % |
| Minimum | 2 % (1/64) | 3.44 | 13 % |
| Mean in 3 buckets (<2, 2–3, >3) | 3 % (2/64) | 3.44 | 13 % |
| Count at or above level 3 | 0 % | 3.00 | **50 %** |
| Covered if any ≥ 4 (L4, r1) | 0 % | 3.58 | 0 % |
| Covered if ≥ 2 at ≥ 3 (L3, r2) | 0 % | 3.50 | 25 % |
| Covered if ≥ 2 at ≥ 2 (L2, r2) | 5 % (3/64) | 3.72 | 5 % |

**Conclusions.**
1. **Median and second-highest publish an individual rating.** The median of three is one member's rating, so it is
   exact by construction. It must be rejected outright.
2. **No candidate is safe against an observer with self-knowledge.** Each has exact-disclosure cases (except the
   threshold rules, which have none in this measure but still narrow). The threshold rules narrow to a few levels in
   some cases; the count rule narrows to ≤ 2 levels in half of all cases.
3. **Bucketing does not solve it at n = 3.** Coarser buckets reduce the narrowing but do not remove it, because one
   other member's rating is still bounded by the bucket and the observer's own rating.
4. **Repeated publications compound.** Each new publication, or each change of requirement or membership, removes more
   possibilities. The §10d architecture bounds repetition for k-based publications; a team-level model has no such
   channel (§10e.4).
5. **Not a mathematical guarantee for any individual-derived output at n = 3.** The owner's rule "do not derive a
   published rating from one or two contributors" is satisfied at n = 3 only in the sense that three are used. It does
   not prevent inference.

**Answer to the owner's question:** a three-member, individual-derived per-axis summary cannot be guaranteed to protect
private ratings. The conclusion holds for any aggregation of three individual values, with or without bucketing. A
binary per-area coverage rule (the last rows) leaks least in the measure, but it still narrows, and it needs a threshold
below k = 5 and therefore a SECURITY revision and notice bump.

### 10e.3 Recommended model: team-level competence, not derived from individual ratings

**Model B-1.** Each assigned competence area (`teamCompetenceAreas`, active) carries one optional team-level value set
by a team admin: `teamLevel ∈ {1, 2, 3, 4}`, or absent ("ikke satt"). The green polygon is `teamLevel`. The dashed
polygon is the existing `teamSkillNeeds.requiredLevel` for the area, when a need exists.

Why it meets the owner's requirements:
- No individual rating, count or average enters the chart. The chart therefore has no inference channel from private
  data. Withdrawal, opt-in, join and leave do not change it. A1–A4 (§10c) do not apply to this chart.
- Works for three or more members, since there is no contributor threshold. Not "permanently suppressed".
- Reuses `teamCompetenceAreas` and the existing need model. No new collection.
- Team admins still cannot read private ratings (invariants 31, 33 unchanged).
- Non-personal data: a team-level value is not an assessment of a person. It is not personal data under the current
  inventory, so no erasure row is needed (confirm in R-2).

Limit to disclose in the UI and notice: the team-level value is the admin's judgement of the team. The system does not
compute it from members' ratings. It can still reflect what the admin knows about individuals. The product must not
describe it as "summarized from members' ratings".

**Model B-2 (not recommended).** Individual-derived per-axis summary at min three contributors. Blocked by §10e.2. Only
the binary covered/gap form is even considered, and it requires a SECURITY revision (k), a notice bump and §10d's
publication architecture, because the repetition channel is the same.

### 10e.4 Data, API and authorization (model B-1)

| Item | Design |
| --- | --- |
| Storage | `teamCompetenceAreas/{teamId}__{treeId}` gains optional `teamLevel` (integer 1–4). Absent = not set. `isValidCompetenceArea` accepts the key only when valid; other extra keys remain rejected. No migration: existing documents stay valid |
| Write | `PUT /api/teams/[teamId]/competence-areas/[treeId]/team-level`, body exactly `{ "teamLevel": 1–4 \| null }`. Authority `canAdministerTeam` (teamadmin or superadmin), same as area writes. Area must be `active` (else 409). Write is a single-field transaction; no actor field, consistent with the area document (decide, R-2) |
| Read (composed) | `GET /api/teams/[teamId]/competence-profile` returns `{ axes: [{ treeId, label, teamLevel, targetLevel }] }`. `label` is the global skill-tree name. `targetLevel` is `requiredLevel` of the team need or `null`. No counts, no uid, no member data, no timestamps, no epoch. Only active areas appear |
| Read authority | Genuine active member of the team (same gate as coverage). Disabled team: `team_disabled` (same as coverage) |
| Scope guard | New module reads `teamCompetenceAreas`, `teamSkillNeeds` and `skillTrees` (global, read only). Add the collection to `ALLOWED_COLLECTIONS` deliberately. It must not import the batch profile adapter or any `skill-profiles` server module |
| Caching | None. Non-personal data, so invariant 35 does not apply to it; keep `no-store` anyway |
| Global trees | Unchanged. Only app admins create or change trees (`requireAppAdmin`) |
| Member-facing `skill-needs` | Unchanged. `requiredLevel` is already shown; `requiredCoverage` is not needed for the chart |

### 10e.5 Visual design (implementation-ready)

**Placement.** Teamkompetanse tab (`app/(app)/teams/[teamId]/competence/page.tsx`). Title **«Kompetanseprofil»** (the owner's
term, used as the section heading). Keep the existing categorical table below it as the detailed view.

**Chart.** Inline SVG, radar with one axis per active area with a `teamLevel` or `targetLevel`.
- Axes: 3 to 8. Below 3 areas: no polygon, message «Legg til minst tre kompetanseområder for å se profilen.» Above 8:
  show the table only, with message «Profilen vises for opptil åtte områder.» These limits keep labels legible.
- Scale: 0 at centre to 4 at the rim; rings at 1, 2, 3, 4. Radius scale labels: the four existing level names from
  `SELF_ASSESSED_LEVEL_COPY` on the outermost ring only at ≥ 768 px.
- Green filled polygon = `teamLevel` (solid stroke 2 px, fill with 25 % opacity). Axes with no `teamLevel` break the
  polygon at that axis and carry the label «Ikke satt».
- Dashed neutral polygon = `targetLevel` (stroke 1.5 px, dash 4 3, neutral text colour). Axes without a target do not
  contribute.
- Legend below the chart: «Teamets nivå» (green swatch, solid) and «Forventet nivå» (dashed swatch). Both swatches carry
  text, so the legend is not colour-only.

**Text alternative (required).** The SVG has `role="img"`, an `aria-labelledby` pointing to the title, and an
`aria-describedby` summary: «Teamets nivå er satt for X av Y områder.» Next to it, a visually-visible table (not
hidden; collapsed on mobile behind a `<details>`) with columns «Kompetanseområde», «Teamets nivå», «Forventet nivå», where
an unset value reads «Ikke satt» or «Ikke angitt». The table is the same data as the chart, from the same DTO.

**Responsive, at 320, 360, 768, 1024 and 1440 px.**
- 320 and 360 px: chart full width of the container (16 px gutters), minimum 260 px, labels 12 px, labels wrap at most
  two lines; table in `<details>`. No horizontal page scroll.
- 768 px: chart and legend in one row, chart max 360 px; table below.
- 1024 and 1440 px: chart max 420 px, table beside it.
- Acceptance: at every width, the document has no horizontal scroll, and the table is reachable by keyboard.

**Light and dark.** Use the existing semantic colour tokens (names confirmed at implementation; no hard-coded hex). Green
fill and stroke, neutral dashed stroke and grid lines each meet WCAG 1.4.11 (≥ 3:1 against the surface) in both modes.
The chart background is transparent so the page surface shows through.

**Interaction.** Read-only. No interactive element inside the SVG. Keyboard reaches the table only.

**Empty and error states.** No area with a value: «Ingen nivåer er satt ennå.» Loading and error states follow the
existing coverage component pattern. No demo or hard-coded values in production; the component renders only from the DTO.

**Dataviz.** Before writing chart code, load the `dataviz` skill (required by the session rules).

### 10e.6 Tests (implementation acceptance)

- **Domain (pure):** axis-to-polygon mapping; breaks at unset axes; 3–8 axis limits; target-only and value-only axes;
  the four levels map to rings 1–4 and never to decimals.
- **Server:** composed DTO allow-list (exact keys; no uid, e-mail, member id, count, timestamp); write authority (teamadmin
  and superadmin allowed; member, lead and app-admin-only refused; disabled team refused; archived area refused; invalid
  level refused); non-member refused; no profile read happens (collection-level spy on `skillProfiles`).
- **Scope guard:** the new module does not import `skill-profiles` server code and names no `skillContribution`.
- **Privacy regression (permanent):** the §10e.2 enumeration as a test. It asserts that median and second-highest
  publish an exact level for some triples, so that no one can choose them later without a failing test.
- **Component:** the SVG and the table present the same numbers; aria labels; the legend has text; axes with no value
  are announced; below 3 and above 8 axes show the correct message.
- **Browser (deferred until Firestore quota returns):** the five widths above, dark and light mode, axe, no horizontal
  scroll.

### 10e.7 Acceptance criteria

1. A three-member team sees the chart once a team admin has set at least one `teamLevel` (no contributor threshold).
2. Changing membership, opt-in or withdrawal does not change the chart (the DTO has no contribution input).
3. The API response contains no counts, averages, decimals, distributions, uids or member data.
4. The chart and its text alternative show the same values; the text alternative is always present.
5. Team admins can set and clear team levels; members can only read; app admins cannot write team levels unless they are
   superadmin (existing rule).

### 10e.8 Remaining owner decisions (only those that are truly necessary)

- **R-1. Source of the green polygon.** Either **B-1** (team-admin-set team-level competence, recommended; no
  individual-derived data, no security change, but the chart does not reflect members' self-assessments), or keep
  categorical coverage only (D2 stays in force, no radar). B-2 (individual-derived) is not recommended and would need a
  SECURITY revision of invariant 34 and a notice bump. The owner's three-member requirement is met by B-1 only.
- **R-2. Team-level data classification and audit.** Confirm that `teamLevel` is not personal data (recommended), so it
  needs no erasure row. Decide whether writes record an actor (recommended: no, consistent with area documents) or
  `updatedAt` only.
- **R-3. Supersession record.** D2 ("no team radar coordinates") and OD-1 (no radar on `/me/skills`, unchanged by this
  section) need a dated owner decision record. The radar on Teamkompetanse under B-1 is a new decision, not an amendment of
  the privacy contract. Record it as such.

Not required, and not decided here: the default-on participation decision (O-10 in §10d), which remains blocked on legal
and privacy review and on security-contract approval.

## 10f. Final product model: two independent controls (2026-11-07). Design only; default-on blocked

### 10f.1 The two controls, and what each may and may not touch

| | Teamadmin: visualization mode | Member: sharing preference |
| --- | --- | --- |
| Where | Teaminnstillinger → Kompetanseprofil (**new**; no team settings page exists today) | Mine ferdigheter (`/me/skills`), replacing the current control "Del kompetanse med teamet" (`OwnCompetenceSharing.tsx`) with the label "Del mine ferdighetsvurderinger med teamprofilen" |
| Stored in | New `teamProfileSettings/{teamId}` (`mode`, `updatedAt`). Not on the team document (team status is app-admin owned) | Existing `teamMemberships.skillContribution` (C2, OD-6). **No second store** |
| Values | `automatic` (default) or `collaborative` | Participating (object present, current notice version) or not (object absent) |
| Who writes | Teamadmin or superadmin of an active team (`canAdministerTeam`) | The member only, through the owner-only endpoint |
| Effect on the other control | None. Switching mode never reads or writes the member's preference | None. Preference never reads or writes the mode |
| Teamadmin override | **Not possible.** No admin route writes `skillContribution` (verified: the scope guard pins its writers to the member's own routes) | Not applicable |

The two controls are independent in code, in storage, in authorization and in the UI copy. Neither implies the other.

### 10f.2 Mode semantics

**Automatic kompetanseprofil (default).** Inputs: members whose `skillContribution` is effective (current notice version)
and whose profile has a valid level for the tree. Output per axis: the §10d categorical publication, mapped to a radar
value:
- `covered` → value = `requiredLevel` of the need (target radius)
- `gap` → value = 0
- `insufficient_data`, `area_unavailable`, or no need → no value (the axis is marked «Ikke nok grunnlag» or «Ikke satt»,
  and no vertex is drawn)

This keeps the automatic radar categorical. It does not add a per-axis level, which would be a new output class with new
inference risk (§10e.2). The green polygon then shows coverage at the target radius, not a measured level.

**Felles kompetanseprofil (collaborative).** Inputs: `teamCompetenceAreas.teamLevel` (1–4 or unset), entered by the
teamadmin as a jointly agreed team assessment (§10e). **Never reads `skillContribution`, `skillProfiles` or any member
data.** Rules: no value is prefilled from automatic results or from a member's rating; the admin enters values by hand.

**Mode change timing.** A mode change is a publication event. It takes effect at the next publication boundary (§10d),
not immediately. The UI states the date. This prevents an observer from using a mode switch to see the automatic result
at a chosen moment.

### 10f.3 Member withdrawal, re-enablement and rejoin

- **Disable.** Existing behaviour: `DELETE skill-contribution` deletes the object in the same request. The member's
  assessment is excluded from every computation that runs afterwards (immediate). The already-published automatic state
  is replaced at the next boundary, with suppression if inputs changed (§10d, R1 and R2). Collaborative mode is unaffected.
- **Re-enable.** `PUT skill-contribution` with the current notice version. Takes effect at the next computation.
- **Mode change.** No effect on the member's preference (see 10f.1).
- **Leave the team.** Membership removal deletes the object (existing rule, SPEC BR-11).
- **Rejoin, the open conflict.** The owner requires that a previous opt-out survives rejoining. The current contract says
  the opposite: participation is destroyed with the membership, and a rejoin starts non-contributing (SPEC BR-11;
  invariant 32; invariant 27 for `memberRef`). Preserving the opt-out needs a record that outlives the membership:
  - Option R-A (recommended if the requirement is confirmed): `teamSharingWithdrawals/{uid}__{teamId}` with the single
    field `withdrawnAt`. Written only by the member's own withdraw action. Deleted by the member's own re-enable action.
    Survives membership removal. Read only by the grant path, to decide the rejoin state. Covered by a new account-erasure
    inventory row. Owner-only; never returned to any other person.
  - This is a persisted negative state about a person and a team after they left. It needs legal and privacy review (§10f.7)
    and an amendment of invariant 32 and SPEC P1/BR-11 ("no negative state", "destroyed with the membership").
  - Without R-A, a rejoining member with an earlier opt-out would be treated as having no preference, which under the
    pending default-on policy would mean default-on. That contradicts the owner's requirement, so R-A or an equivalent is
    required before default-on.
- **Default for new members (pending).** Today: not participating (affirmative opt-in). Under the owner's intended
  policy: participating by default. **Not implemented.** The grant transaction stays unchanged until approval (§10d.7,
  §8b). The default-on mechanism itself is the subject of §10d and of the legal review in §10f.7.

### 10f.4 UI changes

| Surface | Change | Status |
| --- | --- | --- |
| Teaminnstillinger → Kompetanseprofil (new) | Mode control (two options, Norwegian labels: «Automatisk kompetanseprofil», «Felles kompetanseprofil»), short description of each, effective date after a change, notice that the mode does not change any member's choice | New. Teamadmin only. Hidden from members |
| Mine ferdigheter | Control labelled «Del mine ferdighetsvurderinger med teamprofilen», OFF unless the member has opted in (current contract), explanation dialog (what is shared, who sees the result, what stays private, what happens on withdrawal, leaving, rejoining), withdraw and re-enable | Replaces «Del kompetanse med teamet». Copy change is a notice-contract change (review, §10f.7) |
| Teamkompetanse (team tab) | Kompetanseprofil radar (§10e, one component for both modes). Caption states the mode in use. Shows «Ikke nok grunnlag» per axis in automatic mode when suppressed. Shows «Teamets vurdering» in collaborative mode | New component; same props in both modes |
| Teams with fewer than 3 members | Profile hidden with a one-line reason | New |
| Automatic mode, team with 3–4 members | Message: the automatic profile needs at least five contributors per area; a teamadmin can choose collaborative mode | New |

Copy must never say the chart is anonymous, and must never show a count of members who share.

### 10f.5 API, data model and authorization

| Endpoint or record | Purpose | Authority |
| --- | --- | --- |
| `GET /api/teams/[teamId]/competence-profile/mode` | Current mode and pending effective date | Genuine active member |
| `PUT /api/teams/[teamId]/competence-profile/mode` body `{ "mode": "automatic" \| "collaborative" }` | Set mode; effective at next boundary | `canAdministerTeam`; team active |
| `GET /api/teams/[teamId]/competence-profile` | Composed radar DTO: `{ mode, axes: [{ treeId, label, value: 0–4 \| null, target: 2–4 \| null, state: "shown" \| "insufficient" \| "unset" }] }`. No counts, uids, member data or timestamps | Genuine active member |
| `PUT /api/teams/[teamId]/competence-areas/[treeId]/team-level` body `{ "teamLevel": 1–4 \| null }` | Collaborative values | `canAdministerTeam`; area active |
| `PUT/DELETE/GET /api/teams/[teamId]/skill-contribution` | Member preference (existing) | Own membership only (unchanged) |
| `teamSharingWithdrawals/{uid}__{teamId}` (R-A only) | Preserves opt-out across rejoin | Server only; owner-only semantics; erasure row |

Authorization rules that must hold, and that the tests check:
1. Teamadmin writes only `teamProfileSettings` and `teamCompetenceAreas.teamLevel` (for their team).
2. Teamadmin has no route that writes or reads `skillContribution` or `skillProfiles` per person.
3. Members write only their own `skillContribution` (and the R-A record, if approved).
4. Collaborative DTOs never include an input from member data (static test of the module imports).
5. Automatic DTOs are built only from the §10d publication (no read of profiles in the request path).
6. App-admin status grants none of the above, except the existing superadmin rule in `canAdministerTeam`.
7. No client Firestore access; all writes server-side.

### 10f.6 Tests for both controls

**Teamadmin control (mode).**
- Teamadmin, superadmin: may set mode on an active team; member, lead-only, app-admin-only and non-member: refused.
- Mode write does not change any `skillContribution` (before/after comparison on fixtures, including a withdrawn member).
- Mode switch takes effect at the next boundary; the DTO before the boundary is unchanged.
- Collaborative DTO built without reading `skillProfiles` (spy on the store seam: zero calls).
- Automatic DTO maps `covered` → target, `gap` → 0, suppressed → `null`, and the same suppression shape for k and F causes.
- Teamadmin cannot write a value for an archived or inactive area (409).
- Team levels are never copied from automatic values or member data (static test on the write path).

**Member control (sharing).**
- Default: a new member is not participating under the current contract (regression test, until approval). When the default-on policy is later approved, the test flips to the approved default (test named so the flip is explicit).
- Opt-in requires the current notice version (409 otherwise). Withdraw is immediate for the next computation (fake reader records uids).
- Re-enable is the member's own write; no admin route can write it (route and scope-guard tests).
- Withdrawal survives a mode change (before/after comparison).
- Rejoin (R-A only): an earlier withdrawal is preserved; a rejoining member without a record is not participating under the current contract.
- Leaving the team removes `skillContribution`; with R-A, removal keeps only `teamSharingWithdrawals`; erasure removes both.
- The member DTO and the roster never include the preference of another member (existing non-exposure tests extended).

**Shared.**
- The same radar component renders both modes (component test with fixtures from each DTO).
- Insufficient automatic axes render «Ikke nok grunnlag» with no vertex and no value; the text alternative matches the chart.
- Teams below 3 members show the reason and no profile.

**Existing expected-to-fail A1–A4 regression cases stay unchanged** and are re-run after §10d is approved.

### 10f.7 Changes that need legal and privacy review before default-on

1. **Default sharing for new memberships.** The grant default, or a read-time default (§10d, §2a), and the lawful basis under
   EU/EEA data-protection law. Pre-set participation is not affirmative consent (GDPR Art. 4(11), Art. 7). Legal basis
   and any DPIA must be decided by the owner; no legal opinion is given here.
2. **Default mode.** Automatic is the default, so the owner's default-on policy would make automatic aggregates visible
   for every new member's inclusion. Review what a member is told about the mode and its effect.
3. **Rejoin preservation (R-A).** A persisted record of a withdrawal that outlives the membership: purpose, retention,
   erasure, and the contradiction with "destroyed with the membership" (SPEC BR-11, invariant 32).
4. **Notice text.** New copy for «Del mine ferdighetsvurderinger med teamprofilen», the mode explanation, admin
   non-visibility, withdrawal and rejoin behaviour, and the residuals of §10d (R1, R2) and of the automatic k-threshold.
   A material change of the notice contract requires a version bump (SPEC BR-8), which lapses existing opt-ins.
   Transition: decision (i) or (ii) in §5.
5. **Residual statements shown to participants.** Not anonymous; k = 5 is a product threshold; changes in the team can be
   observed as a change-presence bit (§10d R2); collaborative values reflect the admin's judgement.
6. **Teamadmin mode control.** Not a privacy change by itself, but a change of who may alter what the team sees. Review
   with the owner.

### 10f.8 Implementation plan (ordered; each step needs the approval shown)

1. **Team profile mode (collaborative only), no private data.** Storage, mode endpoints, collaborative DTO, radar
   component, Teaminnstillinger section. Needs: decision on mode storage (R-4), and R-1 (B-1) from §10e. Does not depend on
   default-on or on §10d.
2. **Member control relabel and explanation dialog.** Copy and component only; behaviour unchanged. Needs: notice-copy
   review (10f.7.4). Changing the notice text without the version bump is only allowed for editorial rewording (SPEC BR-8).
3. **Automatic mode, publication path.** Requires §10d approval (O-1–O-9), and the k-threshold decision for 3–4 member
   teams (10f.9, D-A). Adds the boundary publisher and the mode-to-publication mapping.
4. **R-A rejoin record.** Requires legal review (10f.7.3), SPEC/SECURITY amendment of invariant 32 and BR-11, erasure row.
5. **Default-on.** Requires all of the above plus the legal basis (10f.7.1), the notice version decision, and the owner's
   explicit approval. Not in this plan's scope to implement.

### 10f.9 Owner decisions

- **D-A. Automatic mode for 3–4 member teams.** Recommended: the per-area k = 5 threshold stays. Automatic mode shows
  suppressed axes for these teams and the UI points to collaborative mode. The owner's "three or more members" is then
  met by collaborative mode, and automatic mode meets it only from five contributors per area. Lowering k for automatic
  mode is a SECURITY and notice change, and §10e shows it cannot be guaranteed for three.
- **D-B. Rejoin preservation.** Confirm the requirement, and choose R-A (persisted withdrawal record) or accept that
  rejoin resets the preference (which conflicts with the stated requirement).
- **D-C. Mode change timing.** Next boundary (recommended), or immediate (reveals the mode switch as a visible event).
- **D-D. Mode storage.** Separate `teamProfileSettings` (recommended) or a field on the team document (requires moving
  team-status authority or a new write path on the team document).
- **D-E. Default mode.** Automatic (the owner's stated default), which for teams below five contributors per area shows
  only suppressed axes. Confirm this is acceptable, or default to collaborative.
- **D-F. Collaborative values.** Confirm the team admin enters values by hand, with no prefill (recommended, and required to
  avoid copying a member's rating).
- **D-G.** Remaining §10d decisions O-1 to O-9, and the legal basis O-10 for default-on.

## 10g. Owner decision 2026-11-07: minimum three contributors (k = 3), proposed contract

Status: **product requirement approved; security contract NOT amended; production aggregation NOT changed.** This section
is the authoritative statement of the proposed k = 3 contract. It does not authorize bypassing the current k = 5 contract.

### 10g.1 Rules (proposed)

| Rule | Proposed behaviour |
| --- | --- |
| R1 Threshold | Per need and per area: eligible contributors **n ≥ 3** → evaluated coverage (`covered` / `gap`). **n ≤ 2** → `insufficient_data`, same response shape as every other suppression, no reason given |
| R2 Eligibility | Unchanged from SPEC BR-12: genuine active member, effective opt-in, valid level for the tree. Collaborative values never count |
| R3 Team-size floor | **None.** Teams of 5 or 10 are not required. A three-member team is supported |
| R4 Automatic chart | Radar values are categorical: `covered` → target level, `gap` → 0, suppressed → no vertex. No per-axis level is published (§10e) |
| R5 Collaborative mode | Not subject to k. Available to any team of three or more members. Never reads member data (§10f) |
| R6 No redirect | A team with three or four members is **not** redirected to collaborative mode. Automatic mode is shown when its rule is met |
| R7 Publication | §10d applies in full: publication only at epoch boundaries, change-flag suppression, one edit per need per epoch. These are the only protections against repetition and are **a prerequisite of k = 3** (§10g.7) |
| R8 Immediate withdrawal | Unchanged: withdrawal removes the contribution from new computations at once (§10d.1) |
| R9 Not anonymity | The notice, the UI and this document must say that three contributors do not guarantee anonymity |

### 10g.2 What changes and what does not

**Changes (on approval):** the constant `SKILL_COVERAGE_MIN_CONTRIBUTORS` (5 → 3); the derivation boundary; the notice text
and explanatory copy (generated from the constant, plus the literal "minst 5" in the SPEC notice wording); the notice
version (`SKILL_CONTRIBUTION_NOTICE_VERSION` = 1; a lowered k is a notice-contract change under SPEC BR-8, so it is bumped and
existing opt-ins lapse); the tests listed in §10g.6; SECURITY invariants 32 and 34; the SPEC text in §10g.5.

**Does not change:** the survey threshold `minimumResponses` (SECURITY invariant 12, default 5, per survey). It is a
**different rule** and must not be edited under this decision. Likewise the per-survey result thresholds, the heatmap rules
for surveys, and the `teams`/`skillProfiles` access rules.

### 10g.3 Residual risk at k = 3 (stated, not hidden)

- **A3 is accepted as a consequence.** In a three-member team, every evaluated coverage describes all three members. The
  team-size floor (F) recommended in §10c and §10d is withdrawn by this decision. The A3 regression case must be replaced
  (§10g.6) only after the amendment is approved; until then it stays as an expected-to-fail case.
- **A1 becomes a count disclosure without §10d.** With k = 3, a contributor who withdraws from exactly three contributors
  makes the team's state flip to `insufficient_data` in one request, revealing that the cohort was exactly three. With the
  §10d change flag, suppression at the boundary does not depend on the count, so this disclosure is removed. **k = 3 must
  not be activated before §10d is implemented.**
- **Distribution probing at n = 3** (§10e.2 method). Three thresholds with four possible counts each give
  3 × log₂ 4 = 6 observations, and each observation takes two epochs under §10d. The exact distribution is recoverable in
  at least 12 epochs with no membership change. The epoch length must be chosen by the method in §10d.4 with B = 6, so
  P ≥ H / 12. For a 12-month horizon, P ≥ 30 days. This is a time bound, not an elimination.
- **Narrowing of another member.** The §10e.2 measure shows that level-based outputs at n = 3 can determine another
  member's exact level. Per-need categorical coverage does not do so in that measure, but still narrows, and repeated
  observation compounds this. Automatic mode therefore publishes categories only, never levels.
- **Collusion and self-knowledge.** One member who knows their own state and one who knows another's narrows the third
  member. Stated in the notice; not preventable at this size.
- **Not anonymity.** The protection is a product threshold. It is not a mathematical guarantee.

### 10g.4 The API must not expose

No individual names, raw ratings, contributor counts, participation counts, distributions or per-member state, in the
team API, the UI, exports, logs or debug responses. The coverage and profile responses carry categories and the radar
values defined in §10e.4 and §10f.5 only.

### 10g.5 Inventory: every place that enforces or describes k = 5

**Code (production).**

| Location | Enforces or describes k = 5 | Change at k = 3 |
| --- | --- | --- |
| `src/features/team-skills/domain/skill-coverage-policy.ts:7` | `SKILL_COVERAGE_MIN_CONTRIBUTORS = 5` (sole owner) | Value 3, after approval |
| `src/features/team-skills/domain/skill-coverage-policy.ts:8` | `SKILL_CONTRIBUTION_NOTICE_VERSION = 1` | Bump (notice-contract change) |
| `src/features/team-skills/domain/skill-coverage.ts:38` | `levels.length < SKILL_COVERAGE_MIN_CONTRIBUTORS` → `insufficient_data` | None (reads the constant) |
| `src/features/team-skills/copy.ts:132` and `:141` | Notice and explanation text interpolate the constant | Automatic on the constant; wording review |
| `src/features/team-skills/components/TeamCompetenceCoverage.tsx:9, :28, :72` | Explanation text interpolates the constant | Automatic; wording review |
| `src/features/team-skills/client/team-skills-gateway.ts:233` | Comment only ("the fixed threshold") | Comment only |
| `src/features/team-skills/server/get-team-skill-coverage.ts` | Uses `deriveCoverageState`; no literal | None |
| `src/features/team-skills/components/TeamSkillNeedsSection.tsx:44` | Comment only | None |

**Tests (pin 5 by value or by fixture).**

| Location | What it pins |
| --- | --- |
| `domain/skill-coverage-policy.test.ts:4, :9, :10` | The constant's value |
| `domain/skill-coverage.test.ts` (fixtures `cohort(5)`, the "fewer than 5" cases, around line 40) | Boundary at 5 |
| `server/get-team-skill-coverage.test.ts:179, :180, :187, :203` | "k is 5: 0, 1 and 4 contributors are insufficient_data" |
| `server/get-team-skill-coverage-privacy.test.ts` (fixtures of five members; "5 and 6 ⇒ categorical"; "withdrawal flips"; "differencing"; "excluded profiles") | Boundary at 5 and five-member fixtures |
| `components/TeamCompetenceCoverage.test.tsx:55`, `components/SkillContributionPanel.test.tsx:22, :85` | Copy text "minst 5" |
| `team-skills-cross-cutting.test.ts` (4 matches) | Generated copy "minst 5 bidragsytere" |
| `team-skills-scope-guard.test.ts:961` | A virtual fixture `= 5` used to test the guard (a fixture; update consistently) |
| `server/teamkompetanse-leak-regression.test.ts` (this review) | Fixtures of five and four members (sanity, A1, A3, A4) |

**Documents (contract and specifications).**

| Document | Location | Current wording | Change at k = 3 |
| --- | --- | --- | --- |
| `docs/SECURITY.md` | Invariant 32 (around line 181) | "fixed threshold of 5 eligible contributors per skill" | Amend (§10g.8) |
| `docs/SECURITY.md` | Invariant 34 (lines 197–202) | `k = 5` fixed; lowering needs a product decision, SECURITY revision and notice bump | Amend (§10g.8) |
| `docs/SECURITY.md` | Residual statement for 32–36 (around line 222) | "k = 5 is a product threshold" | Amend to k = 3 with the §10g.3 residuals |
| `docs/features/team-skill-needs-and-matrix/SPEC.md` | P2 (line 22), Q12 (line 128), section "Fixed `k = 5`" (lines 138–146), BR-8 (k lowered triggers notice bump), BR-13 (315–318), threat table (369–370), residual (612), constants list (622), notice text BR-25 (404, 414), acceptance (689), Q15 (764), Q18 (767) | k = 5 | Amend |
| `docs/features/team-skill-needs-and-matrix/TASKS.md` | Lines 29, 181, 235, 256, 274, 281, 707, 914, 1166, 1195 | Describe k = 5 and tests | Update with the SPEC |
| `docs/features/team-experience-redesign/SPEC.md` | Line 109 (edge case below k = 5), line 116 (security section), line 165 (acceptance criterion) | k = 5 | Amend |
| `docs/features/team-experience-redesign/TASKS.md` | Lines 367, 372 | k = 5 | Update |
| `docs/features/team-experience-redesign/VERIFICATION.md` | Lines 266, 403 | Records of past review | **Do not rewrite a record**; add a dated note |
| `docs/features/individual-skill-self-assessment/SPEC.md` | Line 916 | Historical decision note (k = 5) | Historical; note only |
| `docs/features/product-experience/SPEC.md` | Lines 26, 50, 343 | Change-control gate that names the coverage k; heatmap rule "k=5" (survey context) | Review the gate wording; **do not** alter survey rules |
| `docs/features/teamadmin-and-team-visibility/SPEC.md` | Line 74 | Refers to k = 5 (invariant 34) | Update reference |
| `docs/features/visual-redesign/SPEC.md`, `visual-fidelity-and-ui-fixes/SPEC.md` | Lines 55, 63 | Change-control gates naming the coverage k | Review wording |
| `docs/ROADMAP.md` | Lines 366, 374 | "Fixed threshold of 5" | Update |
| `docs/ARCHITECTURE.md` | Line 335 | `SKILL_COVERAGE_MIN_CONTRIBUTORS = 5` | Update |
| `docs/UI-UX.md` | Not reviewed line by line in this pass | Unknown | Check before approval |
| `docs/features/managed-surveys/SPEC.md` | Lines 773, 816 | **Survey** threshold `minimumResponses` (invariant 12) | **Not affected** |

Survey thresholds are a separate rule. Any search for "5" in the survey code or specs must not be used to change the
coverage threshold.

### 10g.6 Tests: parameterize, do not hard-code

- Before approval (no behaviour change): tests import `SKILL_COVERAGE_MIN_CONTRIBUTORS` and build fixtures at `k − 1`,
  `k` and `k + 1`. Literal fixtures of five and four are kept only where they test the current contract.
- At approval (k = 3): the **boundary cases become 2 → `insufficient_data`, 3 → evaluated**. The sanity case "four → insufficient"
  becomes "two → insufficient". The A1 case becomes withdrawal from three to two (currently it withdraws from five to four,
  which would no longer flip, so the current expected-to-fail assertion would pass for the wrong reason). The A4 case becomes
  the crossing from two to three. The A2 case is unchanged in structure.
- **A3 is retired only by an approved decision record.** Its replacement is a documentation test of the accepted residual
  (`R-k3-A3`): a three-member team's evaluated coverage describes all three members. Until then A3 stays expected-to-fail.
- New tests at approval: boundary at 2/3 for every need; the copy shows "minst 3" from the constant; the notice version
  is bumped and the old version's opt-ins are inert; no team-size floor exists (a three-member team is evaluated).
- Every flipped expected-to-fail case must be paired with a positive sanity assertion (§10d.8).

### 10g.7 Implementation plan (ordered)

0. **Approvals (no code).** Legal basis and DPIA where any default is involved (O-10); amendments to invariants 32, 34 and
   35 (§10g.8); SPEC P2, Q15, Q18, BR-8, BR-13; notice text and version decision (K3-2); epoch length (K3-3).
1. **§10d publication architecture** (epochs, change flags, edit limit, read path, boundary publisher). Implemented
   **while k = 5**, so the current contract is never weakened during the transition. Approval: O-1–O-9.
2. **Parameterize tests** on the constant (no behaviour change).
3. **k = 3 switch:** constant, boundary tests, copy, notice version bump with the transition chosen in K3-2, the
   re-expressed A1, A3 (retired by decision record only), A4 and sanity cases, SPEC and SECURITY text.
4. **Collaborative mode** (§10f.8 step 1) may ship independently of k, for teams of three or more.
5. **Automatic radar** (§10e, §10f) after step 3.
6. **Member control relabel** (§10f.8 step 2), notice review.
7. **R-A rejoin record** and **default-on** remain blocked (§10f.8 steps 4–5, §10f.7).

No step is implemented in this review.

### 10g.8 Proposed security-contract amendments (drafts; not applied)

**Invariant 32 (proposed replacement of the threshold sentence).** "The cohort is judged per skill with a fixed threshold
of three eligible contributors; below it the result is `insufficient_data`, and every suppression cause is
indistinguishable. A result is never published from fewer than three contributors. No team-size floor applies. Three
contributors do not provide anonymity, and the participation notice says so."

**Invariant 34 (proposed).** "The coverage threshold `k = 3` is the code constant `SKILL_COVERAGE_MIN_CONTRIBUTORS`. It is
never configurable by a request, setting, environment variable, team, lead or app admin. It may not be lowered below three
or raised without a revision of this document and a bump of the notice version, which lapses all participation."

**Invariant 35 (proposed).** As in §10d.6: one current categorical publication per team and need, overwritten at each
publication boundary, plus one per-team change flag. No counts, identities, levels, timestamps or history. Reads serve the
current publication.

**Invariant 33 (addition).** "The team profile mode is a team setting written by team administrators. It selects the source
of the team profile. It never changes any member's sharing preference, and collaborative values are never derived from
member data."

**Residual statement (replacement for the 32–36 residual).** Adds the §10g.3 residuals: whole-team description in
three-member teams; repetition bounded in time, not eliminated; collusion and self-knowledge; not anonymity; operators with
Firestore Admin access.

**Survey invariant 12 is not amended.**

### 10g.9 Owner decisions still needed (only those that are necessary)

- **K3-1.** Approve k = 3 as the contract, with the §10g.3 residuals, and the amendments in §10g.8.
- **K3-2.** Notice transition: (i) bump the notice version, so every participant must act again (recommended), or (ii) a
  versioned addendum. Also approve the notice wording, which must include the three-contributor caveat.
- **K3-3.** Epoch length P for n = 3, computed as P ≥ H / 12, with the horizon H chosen by the owner (for example
  H = 12 months gives P = 30 days).
- **K3-4.** Confirm that no team-size floor applies (this withdraws F from §10c and §10d).
- **K3-5.** Confirm that §10d is implemented before k = 3 is activated.
- **K3-6.** Confirm collaborative mode for teams of three or more, with values entered by hand and no prefill.
- **Still open, unchanged:** the legal basis for default-on (O-10) and the rejoin record (D-B / R-A).

## 12. k = 3 implementation approval package (2026-11-07)

**Nothing in this section is applied.** The drafts below are for approval. They are not in `docs/SECURITY.md`, not in any
SPEC, not in production code, not in notices, not in Firestore rules, and not in shared data.

### 12.0 Status of each element

| Element | Owner product direction (approved) | Authorized for activation now |
| --- | --- | --- |
| Automatic aggregation at ≥ 3 eligible contributors (k = 3) | Yes | **No.** Needs Amendment A (§12.1), legal/privacy review (§12.6) and the §10d publication architecture first |
| No team-size floor | Yes | No (depends on Amendment A) |
| Automatic radar as intended default | Yes | **No.** Requires Amendment A and the default decision |
| Teamadmin mode control (automatic / collaborative) | Yes | Only after Phase 3 gates (§12.4). Collaborative mode reads no member data |
| Member sharing control on Mine ferdigheter | Yes (label and explanation) | Relabel and explanation only after notice approval. Behaviour stays opt-in, off by default |
| Default-on sharing for new members | Yes (future) | **No.** Amendment B (§12.1.B) and legal basis (§12.6). Blocked |
| Rejoin preservation of an opt-out (R-A) | Yes (requirement) | **No.** Needs a record that outlives membership; blocked on §12.6 item L3 and Amendment B |
| Existing opt-in contract (affirmative consent) | In force | **Unchanged** by this package |

### 12.1 Proposed amendments to `docs/SECURITY.md`

Two separate amendments. They are kept apart so that the k = 3 change can be approved without approving default-on.

**Amendment A (k = 3, publication, modes): proposed for approval.**
**Amendment B (default-on sharing and rejoin record): drafted for information only. Not proposed for approval now.**

#### Invariant 32 — Amendment A (replace the whole invariant)

> 32. **Team skill coverage (C2) reads a person's `skillProfiles` only through the single batch module
> (`readSkillLevelsBatch`), only for a person who holds an effective, per-team, versioned participation
> (`teamMemberships.skillContribution`) on a genuine membership of an `active` team, and only for the `treeId`s of the
> team's assignable competence areas that have a need.** Participation remains an affirmative, per-team, revocable opt-in
> and is never set by a lead, team admin or app admin on another person's behalf. Coverage returns, for each need, only a
> categorical state (`covered`, `gap`, `insufficient_data`, `area_unavailable`) and never a `uid`, e-mail, name,
> `memberRef`, level, count, ratio, distribution, timestamp, completeness or contributor identity. A need is evaluated
> only when at least **three** eligible contributors hold a valid level for its area (`k = 3`, invariant 34); with one or
> two, the state is `insufficient_data`, and every suppression cause is indistinguishable. Automatic team profile values
> derive only from the publication under invariant 35. Three contributors do not provide anonymity, and the participation
> notice says so.

#### Invariant 33 — Amendment A (add two sentences)

> 33. … *Team profile mode:* only a genuine `teamadmin` of an active team (or a superadmin) may read or write the team's
> profile mode and collaborative area values. Neither may write, read or infer any member's participation or private
> assessment. No team-administration capability reads `skillProfiles`.

#### Invariant 34 — Amendment A (replace the sentence that fixes k)

> 34. The coverage threshold `k = 3` is the code constant `SKILL_COVERAGE_MIN_CONTRIBUTORS`, owned by
> `src/features/team-skills/domain/skill-coverage-policy.ts`. It is never configurable by a request, setting,
> environment variable, team, lead or app admin. **There is no team-size floor.** It may not be lowered below three, or
> raised, without a revision of this document and a bump of `SKILL_CONTRIBUTION_NOTICE_VERSION`, which lapses all
> participation. The coverage endpoint accepts no query-time inputs.

#### Invariant 35 — Amendment A (replace the whole invariant)

> 35. Nothing derived from personal assessments is persisted or cached, **except** the following, which the server alone
> writes and which hold no personal data:
> (a) one current categorical publication per team and assigned need, holding only `covered`, `gap`,
> `insufficient_data` or `area_unavailable`, overwritten at each publication boundary and not retained as history;
> (b) one per-team boolean that records whether a publication input changed since the last publication, cleared when a
> publication is written.
> No count, ratio, level, identity, timestamp, epoch index or history is stored. Coverage reads serve the current
> publication and do not expose when it was computed. Each computation reads the canonical sources only at a publication
> boundary. A cohort that cannot be read completely (more than 500 memberships) yields `incomplete` with no rows, and any
> read failure yields an error with no partial result.

*Drafting note on (b).* A boolean is used instead of an epoch index. It needs no time value at all.

#### Invariant 12 — not amended

The survey threshold `minimumResponses` (default 5, per survey) is a separate rule. It is not changed by this package.

#### Residual statement for 32–36 (Amendment A, replacement)

> The team profile is privacy-thresholded and categorical. It is **not anonymous** in any formal sense, and `k = 3` is a
> product threshold, not an anonymity guarantee. In a team of three contributors every evaluated result describes all
> three. Repeated observation over time narrows what can be inferred; publication only at boundaries and one edit per
> need per period bound, but do not eliminate, that inference. A contributor who knows their own state, or a colluding
> member or lead, can narrow the others further. Operators with Firestore Admin credentials can read raw data.

#### Amendment B (information only; not proposed for approval)

- **Invariant 32, default clause:** "Participation is included by default for memberships created on or after
  `defaultOnEffectiveAt`, is operative only after the member has seen the current notice, is withdrawable at any time,
  and is recorded as the member's own state. No lead, team admin or app admin writes it for another person." Requires §12.6.
- **Invariant 27 and SPEC BR-11 (rejoin):** the owner's requirement that an opt-out survives rejoining requires the
  record `teamSharingWithdrawals/{uid}__{teamId}` (single field `withdrawnAt`). That record outlives membership and needs a
  new erasure row. It is a persisted negative state, which P1 and invariant 32 currently forbid.
- **Invariant 36:** unchanged in substance; the new record is written only by the member's own action.

### 12.2 Proposed SPEC and acceptance-criteria changes

**`docs/features/team-skill-needs-and-matrix/SPEC.md`** (lowering k is a notice-contract change under BR-8):

| Location | Current | Proposed (Amendment A) |
| --- | --- | --- |
| P2 (line 22) | Fixed `k = 5` | Fixed `k = 3`, no team-size floor. Supersedes k = 5 by owner decision 2026-11-07 |
| Q12 (line 128) | k = 5 eligible contributors | k = 3 |
| "Fixed `k = 5`" section (138–146) | Constant `= 5` | Constant `= 3`; explicit "no team-size floor" |
| BR-8 (276–279) | Bump when `k` is lowered | Unchanged rule; applies to 5 → 3 |
| BR-13 (315–318) | `n < 5` ⇒ insufficient; "does not apply to team size" | `n < 3` ⇒ insufficient. Team size is not a condition |
| BR-14 (derivation) | n < 5 | n < 3 |
| BR-15 (output allow-list) | Includes `requiredCoverage` | Remove `requiredCoverage` (decision K3-7) |
| BR-20 (no persistence) | Nothing derived persisted | Replace with Amendment A invariant 35 wording (publication and boolean only) |
| BR-22 (response construction) | Field by field | Unchanged, plus the mode DTO (§12.5) |
| BR-25 (notice, lines 399–426) | "minst 5 bidragsytere" | "minst tre bidragsytere" (generated from the constant) and the notice text in §12.3 |
| Threat 3 (small cohort, "1–4") | `n < 5` ⇒ insufficient | "1–2" ⇒ insufficient; three contributors describe the whole team (accepted residual) |
| Residual section (612) and BR-21 | k = 5 is a product threshold | k = 3; residual per §12.1 |
| Acceptance (689) | "below 5 ⇒ insufficient; 5 and above ⇒ evaluated" | "below 3 ⇒ insufficient; 3 and above ⇒ evaluated; no team-size condition" |
| Q15, Q18 (764, 767) | k fixed at 5 | k fixed at 3; lowering/raising still needs revision and bump |

**`docs/features/team-experience-redesign/SPEC.md`:**

| Location | Current | Proposed |
| --- | --- | --- |
| Edge case (109) | Below k = 5 ⇒ `Ikke nok grunnlag` | Below k = 3 ⇒ `Ikke nok grunnlag` |
| Security section (116) | "k = 5 not configurable" | "k = 3 not configurable" |
| BR-22 (89) and its acceptance criterion (167) | Turning sharing off removes the contribution from the next team read | Withdrawal removes the contribution from every new computation immediately. The published team state changes at the next publication boundary (§10d). Withdrawal is not deferred |
| BR-24 (91) | Defaults set by D1 (blocked) | Unchanged: opt-in and off by default until Amendment B |
| BR-25 (94) | Categories `Dekket`, `Delvis dekket`, `Behov for utvikling`, `Ikke nok grunnlag` | Categories as implemented: `Dekket`, `Behov for utvikling`, `Ikke nok grunnlag`. Remove "Delvis dekket" (no backing state) |
| BR-26 (95) | No radar coordinates (D2) | Superseded for the automatic and collaborative radar by owner decision 2026-11-07 (§10e, §10f). Record as a new decision, R-3 |
| New BR-31 | — | Kompetanseprofil radar, both modes, with the values in §10f.2 |
| New BR-32 | — | Teamadmin mode control: `automatic` (default) or `collaborative`; takes effect at the next boundary; no effect on any member's preference |
| New BR-33 | — | Member control «Del mine ferdighetsvurderinger med teamprofilen»: opt-in, off by default (until Amendment B), immediate withdrawal, re-enable by the member only |
| Acceptance (165) | Teamkompetanse shows only categorical coverage with k = 5 | k = 3 (categorical coverage and the radar of §10f.2) |
| Acceptance (169) | Existing competence records remain readable | Unchanged |
| Acceptance (new) | — | Criteria in §12.7 |

**`docs/features/team-experience-redesign/TASKS.md`** (lines 367, 372): update to k = 3 at implementation time. No task
status changes in this package.

### 12.3 Member-facing notice (Norwegian), draft for legal and privacy review

Draft status: **not approved.** The text below needs review by a Norwegian-speaking privacy and legal reviewer before use.
It is written to state the small-team inference risk rather than to reassure. It must not say that the team profile is
anonymous.

**Primary notice (shown next to the control on Mine ferdigheter):**

**«Del mine ferdighetsvurderinger med teamprofilen?»**

- «Deling er av til du velger å slå den på. Du bestemmer selv, team for team.»
- «Hvis du deler, brukes nivåene du har satt i egenvurderingene dine til å beregne teamets kompetanseprofil. Teamet ser
  aldri nivåene dine, og ingen ser hvem som deler.»
- «Teamprofilen viser bare en grov status per kompetanseområde: dekket, ikke dekket ennå, eller ikke nok grunnlag. Et
  område vises først når minst tre bidragsytere har vurdert det.»
- «**Dette er ikke anonymt.** Med få bidragsytere kan en grov status gjøre det mulig å utlede enkeltpersoners nivåer,
  særlig hvis noen i teamet kjenner egne eller andres vurderinger. Når teamet er tre personer, gjelder den grove statusen
  hele teamet.»
- «Du kan slutte å dele når som helst. Dine vurderinger tas da ut av nye beregninger med én gang. Teamprofilen endres
  først ved neste faste oppdatering, så en tidligere status kan fortsatt vises en kort stund.»
- «Forlater du teamet, fjernes delingen din. Blir du med igjen, må du velge på nytt.»
- «Teamadmin kan velge om teamprofilen skal bygges automatisk fra delte vurderinger, eller om teamet skal sette en felles
  profil. Teamadmin kan ikke se hvem som deler eller dine vurderinger, og kan ikke endre din deling.»

**Expanded disclosure («Slik fungerer personvernet»), collapsed by default:**

- «Bare nivåene du selv har satt, og bare for områder du har vurdert.»
- «Teamet ser ingen tall: ikke hvor mange som deler, ikke gjennomsnitt og ikke fordeling av nivåer.»
- «Teamadmin kan endre hvilke kompetanseområder som er aktive og hvilke behov teamet har. Hvis noen endrer dem og følger
  statusen over tid, kan de i noen tilfeller utlede grov informasjon om gruppen. Det samme gjelder når noen i teamet
  slutter å dele eller blir med, og når alle bidragsytere ligger på samme nivå.»
- «Statusen oppdateres på faste tidspunkter, ikke med én gang. Endringer i teamet kan derfor vise seg som at statusen
  er «Ikke nok grunnlag» en periode.»
- «Det lagres ingen historikk over statuser.»
- «Dette er ikke en vurdering av deg, og det brukes ikke til å sammenligne eller rangere personer.»
- «Kollegaer som kjenner hverandres vurderinger, kan sammen utlede mer enn det som vises.»

**Mode explanation (on Teaminnstillinger → Kompetanseprofil, for teamadmin):**

- «Automatisk: teamprofilen beregnes fra medlemmenes delte egenvurderinger. Med få bidragsytere vises ofte «Ikke nok
  grunnlag».»
- «Felles: teamadmin registrerer en felles vurdering av teamets nivå per område. Verdiene hentes ikke fra
  medlemmenes vurderinger.»
- «Modusen endrer ikke noen medlems deling.»

**Wording rules.** No unqualified «anonym». No count of sharing members. No default wording such as «delt som standard».

### 12.4 Production files and tests (Amendment A)

**Production (modified):**

| File | Change |
| --- | --- |
| `src/features/team-skills/domain/skill-coverage-policy.ts` | `SKILL_COVERAGE_MIN_CONTRIBUTORS` 5 → 3; `SKILL_CONTRIBUTION_NOTICE_VERSION` 1 → 2 (at activation only) |
| `src/features/team-skills/domain/skill-coverage.ts` | No literal; add the boundary tests only |
| `src/features/team-skills/copy.ts` (lines 132, 141, notice) | Notice and explanation text, §12.3 |
| `src/features/team-skills/components/TeamCompetenceCoverage.tsx` | Explanation text; radar mounting; mode caption |
| `src/features/team-skills/components/OwnCompetenceSharing.tsx` | Label «Del mine ferdighetsvurderinger med teamprofilen»; behaviour unchanged |
| `src/features/team-skills/components/SharingExplanationDialog.tsx` | Disclosure text, §12.3 |
| `src/features/team-skills/components/SkillContributionPanel.tsx` | Copy only |
| `src/features/team-skills/server/get-team-skill-coverage.ts` | Read the stored publication; no recompute; DTO without `requiredCoverage` |
| `src/features/team-skills/server/list-skill-needs.ts` | Member DTO without `requiredCoverage`; lead DTO unchanged |
| `src/features/team-skills/server/upsert-skill-need.ts` | One edit per need per period (computed from `updatedAt` and the period grid); set the team boolean; require an active area |
| `src/features/team-skills/server/delete-skill-need.ts` | Set the team boolean |
| `src/features/team-skills/server/set-own-skill-contribution.ts` | Set the team boolean in the same transaction |
| `src/features/team-skills/server/withdraw-own-skill-contribution.ts` | Set the team boolean in the same transaction; deletion stays immediate |
| `src/features/teams/server/grant-team-membership.ts`, `approve-access-request.ts`, `resolve-invitations.ts`, `create-invitation.ts` | Set the team boolean in the same grant transaction (shared transactions; scope-guard change) |
| membership removal path (team-membership removal module, to be located) | Set the team boolean |
| `src/features/skill-profiles/server/set-own-skill-level.ts`, `clear-own-skill-level.ts`, `delete-own-skill-profile.ts` | Set the team boolean for teams with a need on the tree. **C1 writes a C2 flag (decision K3-8)** |
| `src/features/team-competence-catalog/server/manage-competence-areas.ts` | Set the team boolean on status change; add the collaborative team-level write |
| `src/features/team-competence-catalog/domain/competence-area.ts` | Validate `teamLevel` (1–4 or absent); other extra keys still rejected |
| `src/features/account-erasure/server/inventory.ts` | Classify `teamProfileSettings`, the publication and boolean documents (non-personal, allow-listed with a reason); add the R-A row only under Amendment B |
| `app/api/teams/[teamId]/skill-coverage/route.ts` | DTO without `requiredCoverage` |

**Production (new):**

| File | Purpose |
| --- | --- |
| `src/features/team-skills/server/coverage-publication-store.ts` | Read and overwrite the current categorical publication; no history |
| `src/features/team-skills/server/publish-team-coverage.ts` | Boundary publisher: if the boolean is set, publish `insufficient_data` for the team; else compute and overwrite; clear the boolean |
| `src/features/team-skills/domain/publication-period.ts` | Period grid (`P`), edit-once check. Pure |
| `src/features/team-competence-profile/domain/radar-values.ts` | Maps coverage states and collaborative levels to radar values. Pure |
| `src/features/team-competence-profile/server/get-team-competence-profile.ts` | Composed read, mode-dependent source; no `skillProfiles` read in collaborative mode |
| `src/features/team-competence-profile/server/team-profile-mode-store.ts` | `teamProfileSettings/{teamId}` read and write |
| `src/features/team-competence-profile/server/set-team-profile-mode.ts` | Mode write under `canAdministerTeam` |
| `src/features/team-competence-profile/components/KompetanseprofilRadar.tsx` | Single radar component, both modes |
| `app/api/teams/[teamId]/competence-profile/route.ts` | `GET` composed DTO |
| `app/api/teams/[teamId]/competence-profile/mode/route.ts` | `GET`, `PUT` mode |
| `app/api/teams/[teamId]/competence-areas/[treeId]/team-level/route.ts` | `PUT` collaborative value |
| `app/(app)/teams/[teamId]/settings/...` (Teaminnstillinger → Kompetanseprofil) | Teamadmin-only page section; location confirmed at implementation |

**Not modified in this package:** `firestore.rules` (any deny-only block for the new collections is a separate explicit
step); shared Firebase data; consent records; `SKILL_CONTRIBUTION_NOTICE_VERSION` before activation.

**Tests (modified):**

| Test file | Change |
| --- | --- |
| `src/features/team-skills/domain/skill-coverage-policy.test.ts` | Pin 3; the notice version at activation |
| `src/features/team-skills/domain/skill-coverage.test.ts` | Boundary 2 / 3 (parameterized on the constant) |
| `src/features/team-skills/server/get-team-skill-coverage.test.ts` | "k is 3: 0, 1, 2 insufficient; 3 evaluated"; no `requiredCoverage` key |
| `src/features/team-skills/server/get-team-skill-coverage-privacy.test.ts` | Fixtures parameterized; withdrawal and differencing re-expressed at 3 |
| `src/features/team-skills/server/teamkompetanse-leak-regression.test.ts` | A1 from 3 to 2; A4 crossing 2 to 3; sanity "two insufficient"; A2 unchanged; **A3 retired only by a decision record**, replaced by the residual test `R-k3-A3` |
| `src/features/team-skills/components/TeamCompetenceCoverage.test.tsx` | Copy "minst tre" from the constant |
| `src/features/team-skills/components/OwnCompetenceSharing.test.tsx`, `SharingExplanationDialog.test.tsx`, `SkillContributionPanel.test.tsx` | Label, disclosure text, OFF by default, immediate withdrawal |
| `src/features/team-skills/team-skills-cross-cutting.test.ts` | Generated copy |
| `src/features/team-skills/team-skills-scope-guard.test.ts` | `ALLOWED_COLLECTIONS` (publication, boolean, `teamProfileSettings`, `teamCompetenceAreas`); exact sets for the boolean writers; the C1 writer exception only if K3-8 is approved; no `skill-profiles` import from the profile module |
| `src/features/team-skills/server/participation-boundary.test.ts`, `participation-non-exposure.test.ts` | Writers of the boolean; no member DTO exposes it |
| `app/api/teams/[teamId]/skill-coverage/route.test.ts` | DTO allow-list without `requiredCoverage` |
| `app/api/teams/[teamId]/skill-needs/route.test.ts` | Member DTO without `requiredCoverage`; lead DTO with it |
| `app/api/teams/[teamId]/skill-contribution/route.test.ts` | Unchanged behaviour; the boolean is set |
| `src/features/team-competence-catalog/domain/competence-area.test.ts` | `teamLevel` validation |
| `src/features/account-erasure/server/*` inventory tests | New classifications |

**Tests (new):** publication store and boundary publisher; period grid and edit-once; boolean lifecycle; competence-profile
DTO allow-list; mode authority (teamadmin, superadmin accepted; member, lead, app admin, non-member refused); collaborative
profile reads no `skillProfiles` (spy); automatic profile maps `covered`, `gap` and suppressed states; radar component
(text alternative, legend text, no-value axes, 3 to 8 axes); mode endpoints; team-level endpoint.

### 12.5 Data model and authorization for the two independent controls

**Data model (Amendment A):**

| Record | Fields | Written by | Personal data |
| --- | --- | --- | --- |
| `teamProfileSettings/{teamId}` | `mode` (`automatic` \| `collaborative`), `updatedAt` | Teamadmin or superadmin via `canAdministerTeam` | No |
| `teamCompetenceAreas/{teamId}__{treeId}` | existing fields + optional `teamLevel` (1–4) | Teamadmin or superadmin (team-level write); existing area writes | No |
| `teamCoveragePublication/{teamId}__{treeId}` | `state` (categorical only) | Server publisher only, at the boundary | No (categorical; invariant 35(a)) |
| `teamCoverageChange/{teamId}` | `changed` (boolean) | Server, in the same transaction as each input write | No (invariant 35(b)) |
| `teamMemberships/{uid}__{teamId}.skillContribution` | existing `{noticeVersion, consentedAt}` | Member only (unchanged) | Yes (existing) |
| `teamSharingWithdrawals/{uid}__{teamId}` | `withdrawnAt` | Member only; **Amendment B only** | Yes |

Decision K3-9 (recommended): store no actor field on `teamProfileSettings`, consistent with the area and need documents.

**Authorization (server-side, each rule tested):**

| Action | Allowed | Refused |
| --- | --- | --- |
| Read mode, read team profile | Genuine active member | Non-member (including app admin); disabled team: `team_disabled` |
| Write mode | Teamadmin of an active team; superadmin (existing rule) | Member, lead without teamadmin role, app admin without membership, non-member; disabled team |
| Write collaborative team level | Teamadmin or superadmin; area `active` | Member; archived or inactive area (409) |
| Write own sharing | The member, own membership | Any other person, including teamadmin, lead, app admin |
| Read any member's sharing | Nobody (not in any DTO) | — |
| Write publication or boolean | Server publisher and input transactions only | Any HTTP route |
| Read `skillProfiles` for a team profile | Automatic mode: the publication only, never in the request path | Collaborative mode: never |

Invariants that must remain true after the change: teamadmin has no path to a member's `skillContribution` or
`skillProfiles`; mode changes never write `skillContribution`; sharing changes never write `teamProfileSettings`; no
client-side Firestore access is added.

### 12.6 Decisions requiring legal or privacy approval (before any activation)

- **L1. Lawful basis for default-on.** A pre-set state is generally not affirmative consent (GDPR Art. 4(11) and Art. 7).
  The owner must choose a basis and document it. If legitimate interests (Art. 6(1)(f)) are chosen, a balancing test and
  a right-to-object process are needed. Norwegian employment-data rules must also be checked. **No legal opinion is given
  here.**
- **L2. Data protection impact assessment** for automatic aggregation at three contributors, including the accepted residuals
  (§12.1, residual statement).
- **L3. Rejoin record (`teamSharingWithdrawals`).** Purpose, retention, erasure, and the change from "destroyed with the
  membership" (SPEC BR-11, invariant 32).
- **L4. Notice approval and transition.** Review of §12.3 (Norwegian wording by a native reviewer). Transition for existing
  participants: (i) version bump, so every opt-in lapses and must be renewed (recommended), or (ii) addendum for existing
  participants.
- **L5. Collaborative values.** Confirm that team-level values are not personal data, and that they must not contain names
  or individual assessments (a rule enforced in the input validation and the UI).
- **L6. Whole-team description in three-member teams.** The residual is accepted by the owner. Legal review must confirm that
  this is acceptable to disclose to members in the notice.
- **L7. Default mode.** Automatic is the owner's default. Confirm that showing automatic results to all members, who may not
  have opted in, is acceptable (the answer depends on L1).

Security and product decisions still open (not legal): **K3-1** approve Amendment A; **K3-3** epoch length
(P ≥ H / 12); **K3-4** no team-size floor (confirmed by the owner, recorded); **K3-5** §10d before k = 3; **K3-6**
collaborative values entered by hand; **K3-7** remove `requiredCoverage` from member DTOs (recommended); **K3-8** whether
C1 self-assessment writes set the team boolean (recommended: yes, otherwise a self-assessment change is a residual
that is not suppressed); **K3-9** no actor on `teamProfileSettings` (recommended).

### 12.7 Phased plan with test gates

**Phase 0. Approvals (no code).** L1–L7; K3-1, K3-3, K3-5, K3-7 to K3-9; Amendment A reviewed and signed.
*Gate:* signed approval record. Amendment B is not signed.

**Phase 1. Publication architecture at k = 5 (no contract change).** Items in §12.4 for `publish-team-coverage.ts`, the
store, the boolean, the period grid and the edit-once rule. Input writes set the boolean.
*Gate:* the full team-skills suite passes at k = 5; the expected-to-fail cases **A1, A2 and A4 become `it`** and pass
(withdrawal and opt-in do not change the displayed state; a sweep within one period observes one state; a second edit in a
period is refused); A3 stays expected-to-fail at k = 5; new publication and boolean tests pass; no literal fixture of
`three` appears yet.

**Phase 2. Parameterize tests (no behaviour change).** Replace literal 5s with the constant (except the survey tests).
*Gate:* no behaviour change; suite green; grep for literal `5` in team-skills tests returns only survey-unrelated matches.

**Phase 3. Collaborative mode and radar (no private data).** Mode endpoints, team-level write, competence-profile DTO in
collaborative mode, radar component, Teaminnstillinger section. Works for teams of three or more.
*Gate:* mode authority tests; collaborative DTO spy (zero `skillProfiles` reads); DTO allow-list (no uid, count, timestamp);
scope guard; component tests for the 3 to 8 axis rule and the text alternative; no change to any member's preference
(before/after test).

**Phase 4. Member control relabel and explanation (behaviour unchanged).** New label and disclosure text, with the notice
approved (L4). OFF by default; opt-in unchanged.
*Gate:* component tests (default OFF, immediate withdrawal, re-enable by the member only); copy review; no notice version
bump for editorial-only changes.

**Phase 5. k = 3 activation (blocked until Phases 0–4 and the approvals in §12.6).** Constant 3; no team-size floor;
`SKILL_CONTRIBUTION_NOTICE_VERSION` bump with the chosen transition (L4); automatic radar mapping; copy from the constant.
*Gate:* boundary tests at 2 and 3 for every need; the copy shows "minst tre"; the A1 case re-expressed from three to two,
and A4 from two to three, and both now pass; sanity cases ("two insufficient", "three evaluated") pass; the old version's
opt-ins are inert; no team-size condition exists in any test. **A3 is replaced by `R-k3-A3` (documentation of the accepted
residual) only when the decision record is signed.**

**Phase 6. Browser verification (deferred until Firestore quota returns).** Widths 320, 360, 768, 1024, 1440; light and dark
mode; axe; no horizontal scroll; keyboard reaches the table and the controls.
*Gate:* all browser checks recorded in VERIFICATION.md. Existing TASK-006 and TASK-008 checks remain as they are.

**Phase 7. Amendment B and default-on.** Separate package. Blocked on L1, L3, L4 and Amendment B approval.
*Gate:* not part of this approval.

### 12.8 Acceptance criteria for the k = 3 release

1. A team with three eligible contributors for a need shows `covered` or `gap` for that need after a publication boundary.
2. A team with one or two eligible contributors shows `insufficient_data` for that need, with the same response shape as
   any other suppression.
3. A team of three or more members with no eligible contributors shows the empty radar with «Ikke nok grunnlag» per
   axis, and no vertex.
4. No team-size condition exists: a three-member team is evaluated under the same rule as a larger team.
5. No API response, UI, log or export contains a name, raw rating, contributor count, participation count, distribution or
   per-member state.
6. A withdrawal removes the contribution from every new computation at once; the published state changes only at the next
   boundary, and no withdrawn assessment appears in any later publication.
7. A mode change takes effect at the next boundary and does not change any member's preference.
8. Collaborative mode reads no `skillProfiles` and no `skillContribution` in any request.
9. A team admin cannot read or write any member's preference or assessment through any route (route and scope-guard tests).
10. A second need edit in the same period is refused; a need edit suppresses the team's next publication.
11. The notice states that three contributors do not provide anonymity, and no copy in the product calls the team profile
    anonymous.
12. The expected-to-fail regression cases A1, A2 and A4 pass, A3 is replaced by its residual documentation test, and no
    regression case is deleted.

## 13. Approval package (current): index, checks and sequence (2026-11-07)

The approval package is now split into two drafts. §12 above is superseded by them where they differ.

| Document | Status | Content |
| --- | --- | --- |
| `AMENDMENT-A-DRAFT.md` (same folder) | Draft for approval. Not applied | k = 3, radar publication, anti-probing, K3-8 transaction, notice contract, A3 replacement, radar verification for 3, 4 and 5 members, gates G0–G7 |
| `AMENDMENT-B-DRAFT.md` (same folder) | **Inactive.** Not proposed for approval now | Default-on, rejoin record (R-A), lawful basis, erasure, gates B-G0–B-G8 |

### 13.1 Remaining documentation checks (results)

**Teaminnstillinger location.** No settings route exists. The team routes are `teams/[teamId]` (Oversikt), `competence`,
`competence-plan`, `results`, `roadmap`, `systems`, `forum`. Proposed: `app/(app)/teams/[teamId]/settings/page.tsx`, reached
from the team header through an action shown only when the server says the viewer can administer the team (the same
server-derived flag the other pages use; a hint, not authorization). The section is **Kompetanseprofil**. It is not one of
the five team tabs (team-experience BR-30), so the tab set does not change.

**`docs/UI-UX.md` constraints that apply.**
- Charts: one chart library across the application. The project already depends on `recharts` (^3.10.1). The radar uses it.
  A second, hand-written SVG approach is not allowed.
- Charts never encode a suppressed value as zero (`null` is not `0`).
- Charts render only what the server returned; the client computes no values (the mapping lives server-side).
- Team skill-progress section: never an SVG diagram. That rule covers the skill-progress section only, not the coverage radar.
- Forbidden UI on personal skill pages (`/me/skills`, `/me/goals`): no chart. Unchanged.
- Theme: tokens in `app/globals.css`, switched by `data-theme`; dark mode follows `data-theme`, not the OS query.
- Accessibility: no meaning by colour alone; labels for every control; keyboard-operable controls; visible focus.
- Responsive: no page-level horizontal scroll; a chart may scroll inside its own container if it must.
- Gate G3 (Amendment A §A.9): UI-UX must record the team radar exception and the `recharts` choice. Not yet applied.

**Norwegian labels and notice wording.** The strings are fixed in Amendment A §A.6. The current code uses «Området kan ikke vises»
(short) and «Delvis dekket» appears in the old SPEC only. Both must be made consistent when Amendment A is implemented.

**Radar reference and responsive requirement.**
- The team-competence reference is `docs/design/references/21-system-overview-team-competense.png.png`. It shows the five-axis
  radar, the tab set, and the header counts.
- **The reference also shows elements the owner has excluded and that must not be built:** «Teamets nivå (gjennomsnitt)» (an
  average), «3,6 / 4,0 samlet kompetansenivå» (an average), «12 medlemmer har bidratt» (a contributor count), per-area numeric
  bars with goal values, a status donut (a distribution), and a trend line of averages. Under OD-1 and the written requirement,
  the written requirement takes precedence over the illustration.
- The legend must read «Teamets nivå» (no «gjennomsnitt») and show coverage states, not averages.
- Requirements document, line 221: the privacy threshold must be explicitly decided and documented before implementation, and a
  coarse-status threshold does not by itself permit radar plots. **The k = 3 decision must be recorded in the requirements
  document as well** (owner action). The requirements document is not edited in this pass.

### 13.2 Preparatory work that is safe under the existing contract

These items change no security behaviour and may proceed without Amendment A:

1. **Parameterize the team-skills tests on `SKILL_COVERAGE_MIN_CONTRIBUTORS`** (§12.7 Phase 2). Test-only; no behaviour change.
2. **Pure modules with no caller** (not wired into any route): `publication-period.ts` (period grid and edit-once check),
   `radar-values.ts` (mapping of coverage states and team levels to radar values, §A.4). Unit-tested. Not imported by any
   route until Amendment A is approved.
3. **Copy strings** in one module (the §A.6 strings), with a copy test that forbids «anonym» unless negated and forbids
   «Delvis dekket». Copy only; the old strings stay in use until Amendment A.
4. **Competence-profile DTO allow-list tests** written against the composed DTO shape of §12.4, with the route left unwired.

Not safe under the existing contract, so **not** included: the boundary publisher, the change-boolean writes, the edit limit,
the `teamLevel` write, the Teaminnstillinger route, the radar component wired into a page, any change to `requiredCoverage` in
an existing DTO. Each changes production behaviour or the data model, and each waits for its gate.

### 13.3 Minimal ordered sequence

1. **Now (no approval):** §13.2 items 1–4.
2. **Gate G0–G1 (owner and security review of Amendment A).** Then:
   **Publication architecture at k = 5** (§12.7 Phase 1): boundary publisher, per-need change booleans, the K3-8 transaction
   in the C1 write path, edit-once-per-period, the coverage DTO without `requiredCoverage`. Gate: A1, A2 and A4 pass (become
   `it`); A3 stays expected-to-fail at k = 5; no team-size floor exists.
3. **Gates G3–G4 (UI-UX amendment, Norwegian copy):** Teaminnstillinger section and the collaborative mode (no member data).
   Gate: mode authority tests, collaborative DTO spy (zero `skillProfiles` reads), DTO allow-list.
4. **Gates G2, G5, G6 (privacy review, notice transition, period length P):** radar in automatic mode at k = 5 is **not**
   shipped. Only the collaborative radar ships at this stage.
5. **Gate G7 and the k = 3 activation step (Amendment A §A.10):** constant to 3; notice version bump with the chosen
   transition; A1 and A4 re-expressed; A3 replaced by the decision record and tests A3-1 to A3-5; radar verification (§A.11)
   for 3, 4 and 5 members.
6. **Radar verification for teams of 3, 4 and 5 members:** the table in Amendment A §A.11, in unit, API and component tests,
   then browser checks at 320, 360, 768, 1024 and 1440 px in light and dark mode. Browser checks are deferred until Firestore
   quota returns.
7. **Amendment B (separately gated, inactive):** B-G0 to B-G8. Not started. Blocked on L1 (lawful basis), L2 (DPIA) and L3
   (rejoin record).

### 13.4 Approval gates (Amendment A), summarized

G0 owner approves the exact wording · G1 security review (publication, K3-8 transaction, anti-probing, availability cost) ·
G2 privacy and legal review of the three-contributor disclosure and residual · G3 UI-UX amendment · G4 native Norwegian
review · G5 notice transition chosen · G6 period length P chosen · G7 decision record retiring old A3.

No amendment is applied. No SECURITY.md, SPEC, production code, notice version, Firestore rule, consent record or shared data
was changed in this pass.

## 11. Status and validation

**Complete (current contract, unchanged):** team-level opt-in sharing, withdrawal, categorical coverage (TASK-010,
TASK-011), team competence catalog (TASK-007).

**Pending D1 security-contract change:** everything in §§2–10. Not started and not activated. Stop point: the owner must
record the §8 decisions before any step in §9 after P1.

**Validation performed 2026-11-07:**
- Static inspection of: this document; `docs/SECURITY.md` invariants 19–36; `docs/features/team-skill-needs-and-matrix/SPEC.md`
  (P1, Q5, BR-7 to BR-25, threat model); `docs/features/team-experience-redesign/SPEC.md` (D1, D2, D8, BR-20 to BR-25,
  OD-1 to OD-6); `src/features/team-skills/` (domain and server); `src/features/skill-profiles/server/read-skill-levels-batch.ts`;
  `src/features/teams/server/grant-team-membership.ts`; `src/features/team-competence-catalog/`; `src/features/skill-trees/server/create-skill-tree.ts`.
- No application code, tests, Firestore rules, consent records, notice constants or shared data were changed.
- No Firebase or Firestore calls were made. No authenticated browser checks were run.
- No test suite was run, because no application code changed. The claims in §0 and §4 are based on reading the code, not
  on test output.

**Pending UI work (unchanged):** TASK-006 and TASK-008 remain `In Progress` with their final browser acceptance checks
outstanding. Their completed UI implementation and the list of missing viewport checks are untouched. TASK-009 and TASK-010
are not changed by this review.
