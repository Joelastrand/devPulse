# Team Skill Needs and Privacy-Thresholded Coverage (C2)

## Status
**Implemented** (closed out 2026-10-10; TASK-001–020 Done). Approved, revision 2 — planned 2026-10-05 against commit `ef206de` (C1 closed); revision 2
incorporates the product-owner decisions P1–P6 (2026-10-05). All six decisions are recorded below
and no unresolved material product or privacy question remains. This SPEC authorizes C2 only as
written; it changes nothing delivered by C1. Fifth step of *Team & Personal Development*
(F0 → A → B → C1 → **C2** → D1 → D2).

### Decision record (P1–P6)
| # | Decision | Result |
|---|---|---|
| P1 | Participation model | **Approved.** Explicit opt-in, per team, stored on the team membership; owner-controlled, revocable, versioned against the participation notice; destroyed with the membership; absent after rejoin. No separate consent collection (analysis in "Participation model" found the membership model supports every approved semantic). |
| P2 | Threshold | **Approved.** Fixed `k = 5`, not configurable by member, lead, app admin or team setting. **This deliberately supersedes the earlier planning direction "default 5, configurable 3–20"** (ROADMAP/C1 constraint 2). Reason: the threshold is part of the participation contract and must not be weakenable by aggregate consumers. |
| P3 | Output | **Approved with clarification.** Categorical only (`covered`, `gap`, `insufficient_data`); no counts, percentages, distributions, min/max, timestamps, identities or levels; the coverage endpoint accepts no query parameters and evaluates only the canonical persisted need. Categorical output does **not** prevent inference across repeated observations (BR-21). |
| P4 | Coverage access | **Approved.** Genuine current members of an **active** team only (ordinary members and leads, identical DTO). Non-member app admin may read needs, never coverage. An app admin who is genuinely a member is evaluated as a member. |
| P5 | Needs write policy | **Revised.** All genuine members may **read** needs; **only a genuine team lead of an active team may create, update or delete** them. Ordinary members and non-member app admins cannot. This is one deliberate, narrowly scoped new lead capability (BR-5). |
| P6 | Residual-risk contract | **Approved.** C2 v1 states, in the SPEC and to the user, what it does *not* provide (BR-21). |

## Problem
A team can record where it **is** (`skillProgress`) and what it **plans** (`roadmapItems`), and a
person can privately record their **own** level (C1 `skillProfiles`). A team cannot state what skill
coverage it **needs**, nor see — without exposing anyone — whether that need is currently met. The
obvious shortcut (a named employee × skill grid, or lead-readable profiles) is exactly the
manager-visible individual data the product prohibits.

## User outcome
A team lead records, per competency area, "at least *r* contributors at level *L* or higher". Each
person decides, per team and revocably, whether their self-assessments may count towards that team's
coverage. Team members see per need only a **categorical** state — covered, not covered yet, or not
enough data to show — never who, how many, or which levels.

## Scope
- `teamSkillNeeds` (team-owned desired coverage): read by members, managed by leads.
- Per-team, opt-in, revocable **skill contribution** (participation) on the membership.
- A server-derived, categorical **coverage state** per need, shown in a *Kompetansebehov og dekning*
  table (the "Team Skill Matrix") inside the existing team Oversikt.
- A deliberate, narrow C1 reader seam, guard edits, and a new C2 static guard.
- A required **copy-only** amendment of the C1 `/me/skills` privacy notice (BR-29).

## Out of scope
- Any individual-level output: named matrix, employee rows, per-person cells, drill-down, "who lacks
  the skill", per-person status or completeness. An employee-by-skill view is **not** a future
  extension of C2; it would be a separate product-policy decision and is not planned.
- Counts, percentages, distributions, min/max, averages, ranking, trends, history, snapshots.
- Configurable or per-team thresholds; caching; background jobs; notifications; exports.
- Automatic roadmap items/prefill, development goals, role expectations, check-ins (D1/D2). The
  historical D1/D2 naming ambiguity is **not** resolved here; C2 is independent of D.
- Demo Team data; account-deletion framework; rate limiting; monitoring; CI/deploy.
- Any change to C1 owner-only behaviour, `skillProfiles` shape or Firestore rules.

## Key concepts
Different facts about the same SkillTree (`treeId`); none may be converted into another:

| Concept | Source of truth | Meaning | Scale |
|---|---|---|---|
| **Team maturity** | `skillProgress/{teamId}__{treeId}` | Where the team's *practice* stands | SkillTree stage |
| **Team plan** | `roadmapItems/{teamId}__{treeId}` | Target stage/priority/dates the team plans towards | SkillTree stage |
| **Team need** (C2) | `teamSkillNeeds/{teamId}__{treeId}` | How many *contributors* the team wants at a personal level | Personal level 2–4 |
| **Personal level** (C1) | `skillProfiles/{uid}.levels[treeId]` | One person's own self-assessment | Personal level 1–4 |
| **Coverage state** (C2, derived) | computed per request | Categorical comparison of eligible contributors with a need | `covered` / `gap` / `insufficient_data` |

- **Kompetansebehov (need)**: "minst *r* bidragsytere på nivå *L* eller høyere". `L` is a personal
  level (C1 canonical scale, compared as an ordinal `>=`); `r` is a head-count. Not a stage, not an
  average, not "everyone", not a target for any person.
- **Bidrag (contribution/participation)**: a member's explicit permission, for one team, that their
  current levels be counted in that team's coverage derivation.
- **Bidragsyter (eligible contributor), per skill**: BR-12.
- **Terminology.** Team surface: *Kompetanseområder / Kompetansebehov*; personal surface:
  *Ferdigheter*. A personal level is never called a "stadium"; a need is never a "mål" or "krav" on a
  person. Output is called a **privacy-thresholded team coverage** / **privacy-protected team
  aggregate** — never "anonymous" without qualification (BR-21).

## Repository findings (verified, 2026-10-05)
1. `teamMemberships/{uid}__{teamId}` has **no status field**: a membership exists or is hard-deleted.
   "Inactive membership" does not exist; "inactive" applies only to the team (`active | disabled`).
2. `applyMembershipGrant` never overwrites an existing membership and writes a fresh record on a
   re-grant after removal, so a field stored on the membership is destroyed on removal and absent on
   rejoin without new cleanup code. (The Demo seed writes the presenter's membership with a
   full-replace `set`; a re-seed therefore resets role and contribution — fail-safe direction.)
3. `authorizeTeamAccess` returns `admin` for **any** app admin **before** it looks at membership, and
   `resolveTeamRole` wraps it and likewise returns `admin` first (even for an admin who holds a lead
   membership). Neither can by itself express "genuine member / genuine lead regardless of admin
   status"; BR-18 therefore defines an explicit genuine-membership check for coverage, writes and
   participation. Both existing functions stay untouched.
4. `resolveTeamRole` has no production caller yet; invariant 22 says lead grants nothing "unless a
   feature explicitly opts in". C2 opts in for exactly one capability (BR-5).
5. Roster/roadmap DTOs are built field by field; the admin member list is a separate uid-bearing,
   admin-only contract. Memberships are listed with single-field `where("teamId","==",…).limit(n)`
   (auto-indexed); the roster precedent is 500/501.
6. C1 guard (`skill-profiles-scope-guard.test.ts`): Dimension 1 = files naming `skillProfiles`
   (production: only `skill-profile-store.ts` and `domain/skill-profile.ts`,
   `delete-own-skill-profile.ts`); Dimension 2 = files outside the feature importing
   `skill-profiles/server/**` (only `app/api/me/skills/**`); admin/team route trees may not name the
   collection or import the feature; C1 production code may not contain the words `aggregate`,
   `threshold`, `consent`, `matrix`, `sharing`, `history`, `ranking`, `leaderboard`,
   `teamSkillNeeds`. Intra-feature imports are **not** checked by Dimension 2 (relevant to BR-31).
7. `listSkillTrees` is app-admin-only; C1's catalog read lives inside `skill-profiles/server`.
8. C1's `/me/skills` notice (BR-5) says other users, leads and admins cannot see the data; the page
   shows no team information and reads no memberships (C1 BR-20/BR-24).
9. No account-deletion flow exists; a membership/profile can outlive a deleted account (carried over
   from C1).
10. Disabled-team convention: members and admins keep **read** access to a disabled team's data
    through `authorizeTeamAccess`; writes require `active` (roadmap, skill report).

## Privacy model — decisions (the 20 mandatory questions)
| # | Question | Decision |
|---|---|---|
| 1 | Do C1 profiles participate by default? | **No.** A person's profile is read only while they have an effective opt-in for that team. |
| 2 | Explicit consent? | **Yes — opt-in**: an affirmative action after the notice; no default, no pre-ticked control (P1). |
| 3 | Team-specific or global? | **Per team** (per membership). |
| 4 | Participate in one team and not another? | **Yes**, independently. |
| 5 | Withdraw? | **Yes**, any time, one action; allowed even if the team is disabled. |
| 6 | What does withdrawal do to future aggregates? | The person is excluded from every later derivation; nothing is cached. The profile is untouched. |
| 7 | Historical aggregate retained? | **No.** Nothing derived is persisted. |
| 8 | Who sees aggregates? | Genuine current members of an active team (BR-18, P4). |
| 9 | Do leads differ? | **No** for coverage (same DTO). Leads differ only in managing needs (BR-5). |
| 10 | Do app admins differ? | A non-member admin sees needs, never coverage. A member-admin is a member. |
| 11 | Is any individual assessment ever exposed through C2? | **Never** (uid, e-mail, name, `memberRef`, level, completeness, "missing skill", contributor identity). |
| 12 | Minimum cohort | **k = 5** eligible contributors **for that skill** (BR-13, P2). |
| 13 | Behavior below the threshold | `insufficient_data`, a normal 200 state; no count, no reason. |
| 14 | Behavior at exactly the threshold | Evaluated (`>= 5`). |
| 15 | Can counts leak? | Yes — so **no count of any kind** is returned (BR-15). |
| 16 | Are level distributions safe? | No — **not returned**. |
| 17 | Are min/max safe? | No — **not returned**. |
| 18 | Small-cell suppression per skill/level? | Per **skill** (the cohort for that skill). No per-level cells exist because no per-level output exists. |
| 19 | Repeated observations / differencing? | **Bounded, not prevented.** Mitigated and residual items are separated in BR-21. |
| 20 | Can join/leave reveal an individual's value? | Joining/leaving **without** contributing changes nothing. A contribution/roster change can flip a state; residual risk is explicit (BR-21). |

### Fixed `k = 5` (supersession of configurable 3–20)
- One code constant `SKILL_COVERAGE_MIN_CONTRIBUTORS = 5`. No env var, no Firestore setting, no team
  or admin UI, no request parameter. Contributors consent under a notice that names the number; a
  threshold that a team, lead or admin could lower would silently weaken what they agreed to (and
  lowering would reveal previously suppressed results). Survey thresholds are immutable for the same
  reason (invariant 12).
- **Raising** the constant needs no consent change. **Lowering** it, or making it configurable,
  requires a new product decision, a `docs/SECURITY.md` revision, and a bump of
  `SKILL_CONTRIBUTION_NOTICE_VERSION` (BR-8), which lapses all existing participation. `k = 3` is
  not acceptable for this output shape.
- The earlier direction (ROADMAP and C1 "Constraints C2 must honour" #2) is superseded by this SPEC;
  those documents are reconciled at closeout.

### Participation model (P1)
Persisted on the membership document `teamMemberships/{uid}__{teamId}` as one optional object:

```
skillContribution: { noticeVersion: <integer>, consentedAt: <Timestamp> }
```

- **Presence is the opt-in.** There is **no `enabled` field**: `enabled: false` is never persisted, so
  no negative or ambiguous state exists. Withdrawal **deletes the whole object**
  (`FieldValue.delete()`); no consent history, no previous notice versions, no revocation timestamp.
  An object with any other key set, an `enabled`-style key, a non-integer version, a missing/invalid
  timestamp, or a `noticeVersion` different from the current constant is **not effective** (fail
  closed). A re-opt-in overwrites the object with the current version and a new `consentedAt`.
- `consentedAt` is never returned to anyone and is not used for any decision; it only evidences when
  the current opt-in was given.
- Removal deletes the membership document, hence the object; a rejoin creates a fresh membership
  without it. A re-grant of an existing membership is a no-op (finding 2) and leaves it as it was.
- `memberRef` has **no role** in participation and is never used.
- Why the membership model is sufficient (no separate collection): automatic destruction on removal
  and absence on rejoin come from the existing grant/remove behaviour; eligibility is found with the
  one membership query the aggregation needs anyway; the member write is a single-field transaction.
  Accepted cost: a **member-originated write to `teamMemberships`** (only this field; BR-9), so every
  membership-derived DTO must be shown not to expose it (BR-10).
- Rejected: a field on `skillProfiles` (team-couples person-owned data and breaks C1's persisted key
  set); a separate consent collection (survives removal unless cleaned; rejoin could silently resume;
  new identity-bearing collection); a global flag.

## Actors and access (authorization matrix)
Read need, write need and read coverage are **three separate permissions**; there is no combined
`canEdit`. "Genuine member" = a valid `teamMemberships/{uid}__{teamId}` for the caller, regardless of
app-admin status.

| Actor | READ needs | WRITE needs | READ coverage | Set own participation |
|---|---|---|---|---|
| Genuine **lead** (stored `role: "lead"`) of an `active` team | yes | **yes** | yes | yes |
| Genuine **ordinary member** of an `active` team | yes | **no** | yes | yes |
| Genuine member/lead of a **`disabled`** team | yes (read-only) | no | **no** (`team_disabled`) | withdraw only |
| App admin who is **not** a member | yes (read-only) | **no** | **no** | no |
| App admin who **is** a genuine member | as that membership | as that membership (a genuine lead may write; a genuine ordinary member may not) | as that membership | own |
| Signed-in non-member, non-admin | no | no | no | no |
| Removed member | no | no | no | no (state gone) |
| Signed-out | 401 | 401 | 401 | 401 |

- App-admin status **never** grants need mutation, coverage read or participation, and never removes
  a genuine membership's capability. A non-existent team or one with an unrecognized status is
  denied for everyone (existing convention).
- **Authorization primitives (normative):**
  - *Needs read:* `authorizeTeamAccess` (`member` or `admin` pass; `denied` ⇒ 403; failed read ⇒ 500
    `read_failed`). Disabled teams are readable (finding 10).
  - *Coverage read, needs write, participation:* BR-18's genuine-membership check, never
    `authorizeTeamAccess`'s admin result and never `resolveTeamRole`'s role result.
- Identity is only the verified token. `teamId`/`treeId` are route context. A client never supplies
  a uid, role, consent state, owner or threshold. Server-derived viewer hints (`viewer.*` in the API
  table) only hide controls and are never authority.

## User stories
1. As a team lead, I want to record how many contributors we need at which level in a competency
   area, so the team can plan skills.
2. As a team member, I want to see the team's needs and whether they are covered, without learning
   who has what.
3. As a person, I want to choose per team whether my self-assessments count towards coverage and to
   stop whenever I want.
4. As a person, I want a plain explanation — and an honest statement of the limits — before I opt in.
5. As a lead or admin, I want coverage only as a member and no individual insight.
6. As an app admin, I want to read a team's stated needs without reading personal data.
7. As a keyboard, screen-reader or phone user, I want the table, states and controls fully usable
   without colour.

## Behavioral requirements

### Team skill needs
- **BR-1 Identity and fields.** One need per team + SkillTree: `teamSkillNeeds/{teamId}__{treeId}`
  (deterministic id: a uniqueness device only, never parsed apart, never authorization). Persisted
  fields exactly: `teamId`, `treeId`, `requiredLevel`, `requiredCoverage`, `createdAt`, `updatedAt`.
  **No actor identity** (no `createdBy`/`updatedBy`), no priority, dates, owner, status, notes, archive
  marker, derived coverage/gap or aggregate value. A document is **valid** only if the stored `teamId`
  and `treeId` are well-formed strings whose composite equals the actual document id, the two numeric
  fields satisfy BR-2 and both timestamps are valid; anything else is **skipped** on read (never
  repaired, never coerced, never shown) and replaced wholesale by a later valid `PUT`.
- **BR-2 Domain.** `requiredLevel` ∈ `{2,3,4}` (C1 personal-scale integers, compared `>=`).
  `requiredLevel = 1` is rejected: "≥ 1" would mean "has assessed at all" and make the state an
  oracle for the number of contributors. `requiredCoverage` is an integer in `[1,20]`. Other values or
  types ⇒ `400 invalid_input`; wrong envelope/extra keys ⇒ `400 invalid_request`. The stored need is
  the **only** source of `requiredLevel`/`requiredCoverage` for any derivation.
- **BR-3 Semantics.** A need means exactly: "at least `requiredCoverage` eligible contributors have a
  valid level `>= requiredLevel`". No average, "everyone", percentage, target for a person, or
  desired stage. A need never reads or writes `skillProgress` or `roadmapItems` and does not require
  the team to track the area.
- **BR-4 Need read.** `GET /api/teams/[teamId]/skill-needs` is authorized by `authorizeTeamAccess`
  (member or admin; `denied` ⇒ 403). It returns the valid needs, a member-readable `catalog`
  (`{treeId,name}` of valid trees for the add-need picker; raw-window rule of C1 BR-11, 500/501, with a
  `catalogTruncated` flag), `needsTruncated` (the needs query is limited to 501 and 501 ⇒ `true`), and
  server-derived hints `viewer: { canManageNeeds, canReadCoverage }` (BR-5/BR-18 conditions, evaluated
  separately and never merged). Reads work for disabled teams. A need whose tree is missing or invalid
  is returned as `areaAvailable:false` with `areaName: null` and may only be deleted.
- **BR-5 Need write (the one new lead capability).**
  `PUT` upserts and `DELETE` hard-deletes a need. Both run in one transaction that checks, with fresh
  reads and **in this order**: (1) verified token; (2) team exists with a valid status; (3) the caller
  holds a genuine membership (BR-18 steps) — else `403 forbidden`; (4) the membership's role is
  exactly `"lead"` (`membershipRoleOf`) — else `403 forbidden` (ordinary member, non-member admin);
  (5) team status is `active` — else `409 team_disabled`; (6) for `PUT`, the target tree is read
  directly and valid — else `404 skill_unavailable`. `createdAt` is set once; `updatedAt` on every
  `PUT`; replacement is last-write-wins; `DELETE` is idempotent, needs no valid tree, writes nothing
  if absent, and leaves no tombstone or archive.
  - **Documented policy change.** F0 established that a lead grants no implicit permissions. C2
    **deliberately** introduces exactly one lead capability: *management of canonical
    `teamSkillNeeds`*. It does **not** give access to any `skillProfiles`, does **not** give richer
    coverage output than any member, does **not** create a generic "lead = manager/admin" rule, and
    does **not** change `authorizeTeamAccess`, `resolveTeamRole`, roadmap/skill-report write rules or
    invariant 22 for any other feature. Any future lead capability needs its own specification.
  - A stored lead on a **disabled** team may **not** write (step 5); the role stays dormant. A removed
    or demoted lead loses the capability on the next call. Several leads are allowed; a team with no
    lead has no way to create needs until an app admin assigns one (F0) — the UI says so neutrally.
  - A lead who is also an app admin keeps the lead capability (decided by membership, step 4); an
    admin without a lead membership has none.
- **BR-6 Lifecycle.** Disabled team: needs readable, never writable, never deleted by disablement.
  SkillTree: cannot be deleted; a renamed tree shows its new name; a missing/invalid tree ⇒ BR-4.
  Needs survive membership and role changes (they are team data, not tied to who set them).

### Participation
- **BR-7 Model.** Participation is the optional `skillContribution` object defined in "Participation
  model": exactly `{ noticeVersion, consentedAt }`, presence = opt-in, deleted on withdrawal, no
  history, never read by anything except the owner's own state and the coverage derivation.
- **BR-8 Notice version.** `SKILL_CONTRIBUTION_NOTICE_VERSION = 1`. Effective participation requires
  the stored `noticeVersion` to equal the current constant. The version is bumped when the **notice
  contract** changes materially — i.e. any of the ten notice points in BR-25 changes meaning, `k` is
  lowered, or the set of people who can see coverage widens. Editorial rewording does not bump it. A
  bump silently lapses all participation (fail closed); the UI shows "not contributing" and the new
  notice. A lapsed object is inert until withdrawn, overwritten by a new opt-in, or destroyed by
  removal.
- **BR-9 Participation API.** `GET /api/teams/[teamId]/skill-contribution` ⇒ `{ contributing:
  boolean, canOptIn: boolean }` (own state only). `PUT` body exactly `{ "noticeVersion": <integer> }`
  opts in; a version different from the current one ⇒ `409 notice_outdated`. `DELETE` withdraws
  (idempotent; body ignored). Opt-in requires a genuine membership (BR-18 steps 1–3) **and** an
  `active` team (else `409 team_disabled`); withdrawal requires only the genuine membership
  (any team status). The subject is the token's uid; the transaction re-reads the membership and writes
  **only** `skillContribution` (never `role`, `memberRef`, `createdAt`, or any other field).
  Non-members including app admins ⇒ `403 forbidden`.
- **BR-10 Non-exposure.** No API returns another member's participation state, a list of
  contributors, or `consentedAt`. The roster, assignable members, admin member list, members list,
  access-request and every other membership-derived response never include `skillContribution`
  (regression-tested with a membership fixture carrying it). Logs never carry it.
- **BR-11 Lifecycle.**

  | Event | Effect |
  |---|---|
  | Member opts in / withdraws | object written / deleted; effective on the next derivation |
  | Membership removed | document and participation destroyed; no residue |
  | Same person rejoins | new membership, **not** contributing until an explicit opt-in |
  | Admin re-grant of an existing membership | no-op; participation unchanged |
  | Team disabled | stored participation inert; resumes on reactivation without a new opt-in (stated in the UI) |
  | Notice version bumped | all participation lapses (BR-8) |
  | Role change, lead assignment, `memberRef` preparation | no effect on participation |
  | Person belongs to several teams | each membership independent; the same levels count only where opted in |
  | C1 reset-all / clear a skill / malformed profile | levels vanish or are unusable ⇒ no contribution; participation object stays (inert for those skills) |

### Eligibility, threshold and derivation
- **BR-12 Eligible contributor (per skill).** For one need (`treeId`), a person is an eligible
  contributor iff **all** hold: (a) the team is `active`; (b) the person holds a genuine current
  membership of the team; (c) that membership carries an effective `skillContribution` (BR-7/8);
  (d) `skillProfiles/{uid}` is readable (C1 BR-10); (e) it contains a **valid** level (integer 1–4)
  for exactly that `treeId`. A consenting member with no level for that skill is **not** a contributor
  for it and is invisible: not a zero, not in any denominator. An unreadable profile is **excluded**,
  never interpreted as unassessed. No count of exclusions or their reasons is ever disclosed.
- **BR-13 Threshold.** `k = 5` applies **per skill** to the number of eligible contributors for that
  skill. It does **not** apply to team size, total members, or the number of members who opted in
  across skills. `n < 5` ⇒ `insufficient_data` (no count returned); `n = 5` and `n > 5` ⇒ evaluated.
  The constant is fixed (see "Fixed `k = 5`") and no consumer, request or setting can change it.
- **BR-14 Derivation (pure).** Let `n` = eligible contributors for the skill and `c` = those with
  level `>= requiredLevel`. `n < 5` ⇒ `insufficient_data`; else `c >= requiredCoverage` ⇒ `covered`;
  else ⇒ `gap`. If `requiredCoverage > n` (with `n >= 5`) the need cannot be met ⇒ `gap`, without
  returning either count. A need whose tree is missing/invalid ⇒ `area_unavailable` (a status that
  involves no personal data). The derivation function takes only a list of plain integers for one
  tree plus the need's two numbers — no uid, no profile object, no identity. There is no hidden or
  overall score, no ranking of areas, no "overall" state.
- **BR-15 Output allow-list.** Each coverage row contains exactly `treeId`, `areaName`,
  `requiredLevel`, `requiredCoverage`, `state` (`covered | gap | insufficient_data |
  area_unavailable`). The response additionally has `availability` (`available | incomplete`). It
  contains **no**: contributor count, exact count at/above target, ratio/percentage, distribution,
  min/max, excluded/unreadable/consenting counts, timestamp or "computed at", team size, viewer's own
  contribution status, identity, or per-person field. `Cache-Control: no-store`.
- **BR-16 No query-time inputs.** `GET /api/teams/[teamId]/skill-coverage` accepts no query
  parameters, no body and no headers that influence the result; unknown parameters are ignored and
  never change output. Needs levels/coverage come only from the persisted need (BR-1); `k` is the
  constant. Therefore the only way to alter the cut-point is to mutate a persisted need (BR-5).
- **BR-17 Indistinguishable suppression.** `n < 5`, no consenting members, unassessed members,
  unreadable profiles, lapsed participation and a recent withdrawal all yield the identical
  `insufficient_data` row. Neither server nor UI states a number or a cause (forbidden example: "kun 2
  har vurdert").
- **BR-18 Coverage authorization (genuine-membership check).** Used for coverage, need writes (BR-5)
  and participation (BR-9). Ordering, with fresh reads on every call: (1) verify the token — `401`;
  (2) read `teams/{teamId}`: missing or invalid status ⇒ `403 forbidden` for everyone, including app
  admins; (3) read the caller's `teamMemberships/{uid}__{teamId}` and require `isValidMembershipFor`
  — else `403 forbidden` **without consulting app-admin status**; (4) team status must be exactly
  `active` — else `409 team_disabled` (only a proven member learns this); then the operation-specific
  checks. Failed reads ⇒ `500 read_failed`, never `forbidden`. A non-member app admin therefore gets
  `403` for coverage; a genuine member who is also an admin is evaluated purely as that membership.
  `authorizeTeamAccess` and `resolveTeamRole` are not modified and are not used for these paths.
- **BR-19 Completeness.** Any failed required read ⇒ `500 read_failed` with no partial result. If the
  membership scan returns more than `TEAM_SKILL_COHORT_SCAN_MAX = 500` documents (probe 501), the
  response is `200 { availability: "incomplete", rows: [] }` — an unknowable cohort is never
  aggregated. 500 is a defensive read bound, not a team-size limit or a product claim. If the team has
  no valid needs the response is `available` with empty `rows` and **no profile is read**.
- **BR-20 No persistence.** Nothing derived is persisted or cached: no aggregate, coverage/gap score,
  matrix snapshot, contribution record, history or trend. Every request recomputes from canonical
  sources (`teamSkillNeeds`, `teamMemberships`, `skillProfiles`, `skillTrees`).
- **BR-21 Privacy contract (what C2 v1 does and does not provide).** The output is a
  **privacy-thresholded team coverage**. It is **not** anonymous in any formal sense.
  *C2 v1 does NOT provide:* differential privacy; protection against all differencing; protection
  against colluding contributors; protection against self-subtraction in every scenario; protection
  against a lead who deliberately probes the aggregate boundary by repeatedly changing canonical needs.
  Categorical output does **not** prevent inference across repeated observations.

  | MITIGATED | RESIDUAL |
  |---|---|
  | Ordinary members cannot change the cut-point (need writes are lead-only, BR-5) | A **lead can deliberately mutate canonical needs and compare the categorical responses over time** (the persisted-need mutation oracle): by varying `requiredLevel`/`requiredCoverage` a lead learns whether `c >= r` for chosen values, hence — once `n >= 5` — roughly the count at or above each level and, with `requiredLevel = 2`, roughly `n`. Several leads and app-admin-assigned leads widen this; an app admin can grant membership and a lead role (admin-level trust, existing `grantedBy`/`roleUpdatedBy` audit fields) |
  | Response is categorical only; no counts/distributions/min/max/timestamps | **Roster/participation changes can correlate with state flips**: a flip observed together with a visible join/leave, or with a known opt-in/out, can reveal a broad band property of that person |
  | No query-time levels/thresholds accepted (BR-16); `requiredLevel = 1` excluded (BR-2) | **Homogeneous cohorts** reveal a broad band property of every contributor (e.g. all below the level) — data-dependent suppression was rejected because it would hide the legitimate "everyone is covered" case and leak through its own pattern |
  | `k = 5` fixed (BR-13); per-skill cohort | **Collusion and self-knowledge** reduce uncertainty: a contributor knows their own level, colluders know several, at the margins of a cohort of 5 |
  | Explicit opt-in per team (BR-7/9); participation destroyed on removal | `k = 5` is a product privacy threshold, **not a mathematical anonymity guarantee** |
  | Suppression causes are indistinguishable (BR-17); no history/snapshot (BR-20) | Operators with Firestore Admin credentials can read raw data (not a product entitlement, as C1) |

### Writes and boundaries
- **BR-22 Response construction.** Every C2 response is built field by field from allow-lists; never
  a `uid`, e-mail, display name, `memberRef`, membership id, audit field, `consentedAt`, or a spread
  or raw document.
- **BR-23 Write boundary and no C1 mutation.** C2 writes only: `teamSkillNeeds` (BR-5 routes) and the
  `skillContribution` field of the caller's own membership (BR-9 routes). C2 **may read** eligible C1
  profiles server-side for the approved derivation (BR-12) and **may never**: set or clear an
  individual's level, reset a profile, repair a malformed profile, write consent or any C2 data into
  `skillProfiles`, or write `userProfiles`, `skillProgress`, `roadmapItems`. Consent belongs to the
  membership; assessment remains person-owned. The batch reader (BR-31) exposes read functionality
  only; the store seam used by C1 owner operations is unchanged.
- **BR-24 No automatic action; independence.** A `gap` (or any state) creates no assignment,
  notification, personal goal, roadmap item, roadmap-target change, `skillProgress` change,
  recommendation, or "who" list, and notifies no individual. *skillProgress*: no read, write or derived
  link. *roadmapItems*: no integration in v1 — no prefill, no link-by-data, no auto-creation (the
  earlier ROADMAP remark "C2 may prefill a plan from a team gap" is **not** delivered); roadmap
  `ownerRef` is never joined to needs or coverage. No combined figure across the concepts is rendered.
  C2 output is team planning information only.

### UI
- **BR-25 Participation panel and notice.** Lives on `/teams/[teamId]` Oversikt in the new section
  (not on `/me/skills`, which shows no team information). It names the team, states the current state
  ("Du bidrar ikke" / "Du bidrar"), and offers one control ("Bidra til teamets kompetanseoversikt" /
  "Slutt å bidra"). Opt-in is never pre-selected, never nagged, never required to view coverage.
  Withdrawal needs no confirmation dialog. For a disabled team the opt-in control is absent with a
  one-line reason; withdrawal remains. The notice has two layers; both are versioned content (BR-8).
  - **Primary notice (concise; always visible next to the control; proposed Norwegian wording):**
    **«Bidra til teamets kompetanseoversikt?»**
    • «Valgfritt – du bestemmer selv, team for team.»
    • «Hvis du bidrar, kan egenvurderingene dine telle med når DevPulse beregner om «{teamnavn}» dekker
    sine kompetansebehov. Teamet ser aldri nivåene du har satt.»
    • «Teamet får bare en grov status per behov (dekket / ikke dekket ennå), og først når minst 5
    bidragsytere har vurdert området.»
    • «Dette er ikke full anonymitet. Når noen blir med, forlater teamet eller slutter å bidra, kan
    statusene i noen tilfeller gi grov informasjon om gruppen.»
    • «Du kan slutte når som helst. Forlater du teamet, fjernes deltakelsen din; blir du med igjen, må du
    velge på nytt.»
  - **Optional explanation — a collapsed «Slik fungerer personvernet» disclosure (`<details>`),
    proposed wording:** «Bare nivåene du selv har satt, slik de er nå, brukes – og bare for
    kompetanseområder du har vurdert. • Alle medlemmer i teamet, også teamledere, ser den samme grove
    statusen; administratorer som ikke er medlem ser den ikke. • Ingen ser hvem som bidrar, hvor mange
    som bidrar, eller hvilke nivåer som er satt. • Hvert område vises først når minst 5 bidragsytere har
    vurdert det; før det vises «Ikke nok data». • Teamledere kan endre kompetansebehovene. Ved å endre
    dem over tid og sammenligne statusene kan en teamleder i noen tilfeller utlede grov informasjon om
    gruppen. Det samme gjelder hvis alle bidragsytere ligger på samme side av et nivå, eller hvis
    kolleger som kjenner hverandres nivåer samarbeider. • Hvis du slutter å bidra, telles du ikke med
    neste gang statusen vises; egenvurderingen din slettes ikke. • Det lagres ingen historikk over
    statuser. • Dette er ikke en vurdering av deg og brukes ikke til å sammenligne eller rangere
    personer.»
  - **Coverage of the ten notice points:** optional (1) · per team (2) · exact levels not shown (3) ·
    only thresholded categorical coverage (4) · at least five contributors per skill (5) · not absolute
    anonymity (6) · inference after membership/participation changes (7) · withdrawal (8) · removal
    removes the team's participation (9) · rejoin needs a new opt-in (10) — all present in the primary
    notice or its disclosure; the primary notice carries 1–6, 8–10 and the inference caveat (7) briefly.
    Normal UI carries no threat-model prose beyond this.
- **BR-26 Needs and matrix.** One new section **«Kompetansebehov og dekning»** on Oversikt after
  *Kompetanseområder*; no new route, no navigation change (`Oversikt · Roadmap` unchanged). It contains
  the participation panel, one `<table>` with `<caption>`, `<th scope="col|row">`: columns
  *Kompetanseområde*, *Behov* («Minst {r} bidragsytere på nivå «{nivånavn}» eller høyere»), *Dekning*
  (text label), and a management-actions column only when `viewer.canManageNeeds`. **Rows = needs;
  there are no employee rows, no named-person cells and no per-person levels; areas without a need are
  not rows.** Below `sm` each row is a stacked card (`dl`) with the same text. Level names reuse the C1
  labels; offered levels are 2–4. Lead-only management: add (picker over `catalog` excluding areas that
  already have a need), edit, delete (explicit confirmation, hard delete). Ordinary members and
  non-member admins see no editing controls; for them a neutral line explains that team leads manage
  needs. A team without needs shows the empty state, and a team without a lead adds "Teamledere
  registrerer behov".
- **BR-27 States (all text, none colour-only).** *No need yet*: empty state; `insufficient_data`: «Ikke
  nok data til å vise dekning ennå.» with the generic line «Dekningen vises når nok bidragsytere har
  vurdert området.» (never a number or cause); `covered`: «Behovet er dekket»; `gap`: «Behovet er ikke
  dekket ennå»; `area_unavailable`: «Kompetanseområdet er ikke lenger tilgjengelig» (delete only);
  `incomplete`: «Dekningen kan ikke vises for dette teamet akkurat nå.»; read failure: alert with retry;
  read-only (non-lead member, disabled team): controls absent plus a one-line reason; **non-member app
  admin**: needs table without the coverage column's values and the line «Dekning vises bare for
  teamets medlemmer.»; **disabled team**: needs readable, coverage replaced by «Dekning vises ikke for
  deaktiverte team.» Status icons, if any, are `aria-hidden` and duplicate the text. Forbidden copy:
  counts, "kun/bare N", evaluative words ("svak", "sterk", "kritisk"), rank/score/percent, "mangler
  [person]", performance language, and unqualified "anonym".
- **BR-28 Accessibility.** Table semantics as above; every control has a visible `<label>`; the need
  editor is a keyboard-operable form (area `Select`, level `Select`, coverage number input with min/max);
  saves announce via a polite live region and errors via `role="alert"`; focus returns to a sensible
  control after create/delete; no horizontal page scroll at phone width; no meaning by colour alone;
  participation state is stated in text; the disclosure is keyboard-operable.
- **BR-29 C1 notice amendment (copy-only, required, deliberate).** The C1 notice (C1 BR-5: "Andre
  brukere, teamledere og administratorer kan ikke se den i DevPulse") would mislead once C2 exists. C2
  amends only `skill-profiles/copy.ts` and the test that pins it. It must preserve that assessments are
  person-owned, that teammates do not receive exact individual levels, that C2 participation is
  optional and that participating allows privacy-thresholded team-level use — and must avoid absolute
  wording such as "nobody can see/use this". Proposed: «Egenvurderingen din er din egen. Teamkolleger,
  teamledere og administratorer kan ikke se nivåene du setter. Du kan velge, team for team, at den skal
  telle med i en personvernbeskyttet teamoversikt der teamet bare ser en grov status per
  kompetansebehov.» No other C1 behaviour changes; the page still shows no team list or membership
  data and has no new control, link target or flag; owner-only APIs are untouched. The C1 Norwegian
  copy must stay free of the English tokens in the C1 forbidden-identifier list.

### C1 static-guard design
- **BR-30 Dimension 1 (collection references).** **No new production file may name `skillProfiles`.**
  The only addition is one new exported function `readSkillProfilesBatch(uids)` inside the already
  approved `skill-profile-store.ts` (chunked `getAll` by document id; returns raw documents). It is
  **not** added to the `SkillProfileStore` interface, the default store object, or the in-memory fake
  used by C1 owner operations, so those operations cannot call it. The Dimension 1 allow-list gains
  nothing except, if needed, a new test file that names the collection.
- **BR-31 The single reader module.** A new module
  `src/features/skill-profiles/server/read-skill-levels-batch.ts` exports exactly one function,
  `readSkillLevelsBatch(uids, treeIds)`. It imports `readSkillProfilesBatch`, validates each profile
  with C1's `readSkillProfileRecord` and `isSelfAssessedLevel`, skips unreadable profiles and invalid
  entries silently (no count), and returns **only** `{ ok: true, levelsByTree }` where `levelsByTree`
  maps each requested `treeId` to a **sorted ascending array of plain integers 1–4 with no uid,
  document, ordering or per-person association**, or `{ ok: false }` on any read failure or when inputs
  exceed the bound (`uids ≤ 500`, `treeIds ≤ 500`). It never writes and has no other export. The
  module and its identifiers avoid the C1 forbidden words (`aggregate`, `consent`, `threshold`,
  `matrix`, `sharing`, `history`, …); the C1 forbidden-identifier list is **not** edited.
- **BR-32 Why only the approved module can invoke it (importer maps).** The guard gains
  **module-level** importer maps in addition to the existing directory-level check:
  - `skill-profile-store.ts` may be imported only by the existing C1 owner operation files (an
    explicit list) and by `read-skill-levels-batch.ts` (and tests);
  - `read-skill-levels-batch.ts` may be imported only by
    `src/features/team-skills/server/get-team-skill-coverage.ts` and its sibling test;
  - `APPROVED_SERVER_IMPORTERS` (outside-feature importers of `skill-profiles/server/**`) gains
    **exactly** `src/features/team-skills/server/get-team-skill-coverage.ts` (+ its sibling test), and
    nothing is allowed by directory;
  - an **identifier scan** fails any file outside those approved files that contains `readSkillProfilesBatch`
    or `readSkillLevelsBatch` (catches renamed re-exports such as `export { readSkillLevelsBatch as x }
    from …`), and a **re-export scan** fails any file outside the feature that contains `export * from`
    or `export { … } from` resolving into `skill-profiles/server/**`; the approved coverage module is
    asserted to contain no `export … from` and to export only `getTeamSkillCoverage` and its types;
    `import * as` namespace imports are covered by the importer map because the importer's path is
    checked;
  - the existing rule stays: `app/api/admin/**` and `app/api/teams/**` may not name the collection or
    import the C1 feature — the coverage route imports `team-skills` only;
  - a **call-site test** with fakes asserts `get-team-skill-coverage` calls `readSkillLevelsBatch` with
    **exactly** the uids of members whose membership is genuine and carries effective participation for
    the authorized, active team, and **never** when the caller is unauthorized, the team is disabled,
    there are no needs, or no member participates.

  Why this is not trivially bypassable by indirect importing: the batch function is not on the seam C1
  uses, so importing the store (an approved C1 file) yields no bulk read; importing the batch module
  from anywhere new, importing its function under another name, or re-exporting it, each fails the
  guard; the only approved caller returns only a categorical DTO and re-exports nothing. **What the
  guard still does not prove** (stated in the test, as in C1): dynamic or computed import paths,
  path aliases other than `@/`, code outside `src/` and `app/`, runtime misuse by the approved module
  itself (a wrong uid list is excluded by the call-site test and review, not provable statically), and
  Admin-credential access. The guard is change-detection evidence, not the security boundary.
- **BR-33 Negative fixtures stay meaningful.** The existing virtual fixtures (an unapproved C2-style
  reader naming `skillProfiles`; admin/team routes naming or importing the feature) are kept and still
  fail. New virtual fixtures must fail for: a second `team-skills` module importing the batch module; a
  route importing it; a file importing the store directly; a renamed re-export; `export *` through an
  intermediate; and a C1 owner operation calling the batch function.
- **BR-34 New C2 guard** (`team-skills-scope-guard.test.ts`, change-detection only, states what it does
  not prove): (1) no file under `team-skills/` or the C2 routes names `skillProfiles`; (2) exactly one
  importer of the batch module; (3) the coverage DTO key set equals BR-15 and contains none of
  `uid|email|displayName|memberRef|count|average|rank|score|percent`; (4) files naming `teamSkillNeeds`
  and files naming `skillContribution` form two **exact** sets (the only writers); (5) no Firebase
  client SDK import in `team-skills`; (6) `team-skills` imports no roadmap or `skillProgress` server
  modules; (7) the lead-only write check is present in both need-write operations and no write
  operation imports `resolveTeamRole`/`authorizeTeamAccess` for its decision; (8) copy
  anti-surveillance token scan (no counts, rank, score, "anonym" without qualification); (9) no
  persisted derived collection or cache.

### Infrastructure
- **BR-35 Rules and indexes.** `firestore.rules` gains an explicit deny-only block for
  `/teamSkillNeeds/{document=**}` before the catch-all (behaviour-neutral, per convention) with a pin
  in `firestore-deployment-config.test.ts` and a "no composite index" assertion. No change to the
  `skillProfiles` or `teamMemberships` rules (already server-only/deny). No index: needs query is
  `where("teamId","==",…).limit(501)`; memberships use the existing single-field query; profiles via
  `getAll` by id; trees by direct get. Rules deployment remains a separate explicit step not performed by
  implementation.

## Demo Team
**Decision (approved): no C2 aggregate fixture expansion in v1; no personal presenter assessments are
seeded.** The Demo presenter's membership is an ordinary membership (the seed writes no role), so by
default the Demo shows the needs read-only empty state and, with no contributors, would show
`insufficient_data` for any need. Seeing a need requires an app admin to assign the lead role (F0) and a
lead to create one; a Demo re-seed (full-replace membership write) resets role and participation. This is
**intentional, not a broken demo**: the available (`covered`/`gap`) states cannot be demonstrated in
Demo, and C1 BR-35 (no synthetic or fixed-uid personal data) stands.

## Edge cases and failure behaviour
- Cohort sizes for a skill: 0–4 ⇒ `insufficient_data`; 5 ⇒ evaluated; 6 ⇒ evaluated. Large team with a
  sparse skill (40 members, 3 assessed *X*) ⇒ `insufficient_data` for *X* (the cohort is per skill).
- `requiredCoverage` larger than the cohort with `n >= 5` ⇒ `gap` (BR-14), no counts returned.
- A contributor withdraws or leaves: the next derivation excludes them; a drop from 6 to 4 flips to
  `insufficient_data` exactly as "never enough".
- C1 reset-all, unreadable profile, an invalid entry for the tree: no contribution, no error.
- Concurrent need edits: last-write-wins; concurrent participation toggles: transactional, idempotent.
- A withdrawal racing an in-flight computation: that result may include the person once; the next never.
- 501 memberships ⇒ `incomplete`; needs > 500 ⇒ `needsTruncated` notice and no coverage for unseen needs.
- Lead demoted or team disabled between page load and save: next write ⇒ `403`/`409`; the UI refreshes
  `viewer` hints.
- Account deleted but membership/profile orphaned (no deletion flow): may still contribute until the
  membership is removed — carried-over C1 limitation.
- The Demo seed or admin tooling replacing a membership with a full-replace `set` drops role and
  participation (fail-safe direction); implementation must verify no other code touches the field.

## Security and privacy (feature-specific; the policy itself is not restated)
Touches: authorization (incl. one new lead capability), personal data, a new reader of person-owned
data, team isolation, Firestore Admin access, logging, retention, aggregation threshold, differencing.
Not touched: survey encryption, survey anonymity machinery.
- **Proposed new SECURITY.md invariants (drafted at closeout; they satisfy invariant 31's "future
  reader" conditions together with this SPEC, the review, the guard edits, the notice and the opt-in):**
  (32) C2 reads a person's profile only for a person with an effective, per-team, versioned
  participation on a genuine membership of an active team, and returns only a categorical per-need state
  — never uid/e-mail/name/memberRef/level/count/distribution/completeness/contributor identity; (33)
  roles do not widen coverage or profile access, others' participation is never readable, and the single
  lead capability is limited to managing `teamSkillNeeds`; (34) `k` is a code constant, never
  configurable or lowerable without a SECURITY revision and notice-version bump; (35) nothing derived is
  persisted or cached; (36) C2 never writes `skillProfiles`.
- Logs carry only generic failure categories — never levels, tree ids, names, needs or participation.
- Retention: needs = current state only; participation object deleted on withdrawal/removal; no history.
- Checklist additions: a reader outside the single approved module; any count/distribution in a team
  response; any path exposing who contributes; a widened need-mutation oracle (allowing
  `requiredLevel = 1`, non-lead writes, query parameters on coverage, snapshots, timestamps); a lead
  capability beyond needs; app-admin status used for coverage, writes or participation.

## Threat model
| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| 1 | **Ordinary-member probing** (changing needs to read the boundary) | Ordinary members cannot write needs (BR-5); coverage accepts no parameters (BR-16) | A member who colludes with a lead; a member who becomes lead |
| 2 | **Malicious-lead probing** (mutating canonical needs, comparing categorical results over time) | Fixed `k`; categorical only; `requiredLevel ≥ 2`, `requiredCoverage ≤ 20`; no timestamps/history in responses; disclosed in the notice | **Residual:** lead can learn `c >= r` for chosen values ⇒ approximate count at/above each level and, with level 2, roughly `n`; several leads widen it; not eliminated |
| 3 | Small cohort (1–4 contributors) | `n < 5` ⇒ `insufficient_data`, no cause | None beyond the choice of `k` |
| 4 | Sparse skill in a large team | Cohort is per skill (BR-13) | None |
| 5 | **Homogeneous cohort** | None (data-dependent suppression rejected) | Reveals a broad band property of every contributor |
| 6 | **Roster differencing** (join/leave alongside a state flip) | Join/leave without participation changes nothing; no participation roster; no snapshots | A flip coinciding with a visible roster change can reveal a broad band property of that person |
| 7 | **Opt-in/out differencing** | Identical `insufficient_data` for all causes; no timestamps | Same as 6 for someone who knows who opted in/out |
| 8 | **Self-subtraction** | No counts/distributions; one binary state | A contributor's own level narrows others at the margins of a cohort of 5 |
| 9 | **Collusion** among contributors/leads | None at this `k` | Colluders can recover more; stated limit (BR-21) |
| 10 | Malformed profile | Excluded, never coerced; indistinguishable | Cohort silently smaller, visible only as `insufficient_data` |
| 11 | Reset/delete of profile | Levels vanish ⇒ no contribution; participation inert | None |
| 12 | **Team removal / rejoin** | Participation destroyed with the membership; rejoin non-contributing | None |
| 13 | Team deactivation | Coverage `team_disabled`; no coverage inferred; opt-in blocked; withdrawal allowed; need writes blocked even for a stored lead | Participation resumes on reactivation (stated in UI) |
| 14 | Multiple teams | Per-membership participation; no cross-team query/output | The same levels count in every team the person opted into |
| 15 | **Non-member app admin** | No coverage; needs read-only; admin status never grants write/participation | An admin can grant membership and a lead role (admin-level trust, audited by existing `grantedBy`/`roleUpdatedBy`); operator Firestore access (not a product entitlement) |
| 16 | **Unauthorized new server reader** | Module-level importer maps, identifier and re-export scans, single approved caller, call-site test (BR-32/33) | Guard is change-detection: dynamic paths, aliases, code outside `src/app`, Admin-credential access |
| 17 | **Accidental client Firestore access** | Admin SDK only; deny-only rules (explicit `teamSkillNeeds`; `skillProfiles`/`teamMemberships` unchanged); no client SDK in C2 (BR-34 #5) | None new |
| 18 | Participation exposed through membership DTOs | Field-by-field DTOs; non-exposure regression (BR-10) | Admin Firestore console access |
| 19 | Stale lead capability | Fresh reads every call; role dormant on disabled team; removal destroys it | None |

## Residual privacy risks (summary)
Malicious-lead need-mutation oracle; homogeneous cohorts; roster/participation differencing; collusion
and self-knowledge; `k = 5` is a product threshold, not an anonymity guarantee; orphaned data without an
account-deletion flow; operator access. All are stated in BR-21 and, in plain language, in the
participation notice (BR-25).

## Architecture decisions
- **Sources of truth:** ORG `skillTrees/{treeId}`; TEAM `teamSkillNeeds/{teamId}__{treeId}`; PERSON
  `skillProfiles/{uid}` (unchanged); PARTICIPATION `teamMemberships/{uid}__{teamId}.skillContribution`;
  DERIVED coverage state (never stored). The candidate model from planning is approved with this
  addition.
- **Slice `src/features/team-skills/`:** `domain/` (need record + validation, level semantics, pure
  `deriveCoverageState`, participation rule, constants `SKILL_COVERAGE_MIN_CONTRIBUTORS`,
  `SKILL_CONTRIBUTION_NOTICE_VERSION`, `TEAM_SKILL_COHORT_SCAN_MAX`), `server/` (genuine-membership
  check; needs list/upsert/delete; participation get/set/withdraw; `get-team-skill-coverage` = the only
  reader), `client/` (gateways), `components/`, `copy.ts`. Thin routes under
  `app/api/teams/[teamId]/skill-needs[/[treeId]]`, `.../skill-coverage`, `.../skill-contribution`.
  Dependency direction: `team-skills → skill-trees/domain, teams/domain, skill-profiles (level domain
  and the one batch module)`; never the reverse.
- **Aggregation order (coverage):** BR-18 check → list needs (≤501) → if none, return empty `available`
  without reading profiles → list memberships (≤501; 501 ⇒ `incomplete`) → keep those with a valid
  membership shape and effective participation → `readSkillLevelsBatch(uids, needTreeIds)` → direct-read
  needed trees (valid ⇒ name; invalid ⇒ `area_unavailable`) → derive states → build the DTO. Reads per
  call ≈ 1 team + 1 own membership + ≤501 memberships + ≤(participants) profiles + ≤(needs) trees + ≤501
  needs; no N+1, no index, no cache. Any read failure ⇒ `read_failed`.
- **Catalog** for names/picker: a member-readable bounded catalog read, either a behaviour-preserving
  extraction from `listSkillTrees`' query or a minimal duplicate (a `/split-tasks` choice);
  `listSkillTrees`' authorization must not move; C1's catalog module is not imported.
- **Conventions** mirror Feature A/C1: Admin SDK, `server-only`, injectable store seams, Firestore
  transactions for membership/team/role checks, strict allow-listed bodies (`400 invalid_request` for
  the envelope, `400 invalid_input` for values), errors `{ "error": code }`, `GET` never writes.

## API contracts
| Method & path | Authorization | Request | Success | Errors |
|---|---|---|---|---|
| `GET /api/teams/[teamId]/skill-needs` | `authorizeTeamAccess` (member or admin; disabled readable) | — | `200 { needs:[{treeId,areaName\|null,areaAvailable,requiredLevel,requiredCoverage}], catalog:[{treeId,name}], catalogTruncated, needsTruncated, viewer:{canManageNeeds,canReadCoverage} }` | 401, 403, 500 `read_failed` |
| `PUT /api/teams/[teamId]/skill-needs/[treeId]` | genuine **lead**, `active` team (BR-5) | `{requiredLevel,requiredCoverage}` | `200 { need }` | 400, 401, 403, 404 `skill_unavailable`, 409 `team_disabled`, 500 `persistence_failed` |
| `DELETE /api/teams/[teamId]/skill-needs/[treeId]` | genuine **lead**, `active` team (BR-5) | none (body ignored) | `200 { ok:true }` | 401, 403, 409 `team_disabled`, 500 |
| `GET /api/teams/[teamId]/skill-coverage` | genuine member, `active` team (BR-18) | none; no query parameters | `200 { availability:"available", rows:[{treeId,areaName,requiredLevel,requiredCoverage,state}] }` or `200 { availability:"incomplete", rows:[] }` | 401, 403, 409 `team_disabled`, 500 `read_failed` |
| `GET /api/teams/[teamId]/skill-contribution` | genuine member (BR-18 steps 1–3) | — | `200 { contributing, canOptIn }` | 401, 403, 500 |
| `PUT /api/teams/[teamId]/skill-contribution` | genuine member, `active` team | `{noticeVersion}` | `200 { contributing:true }` | 400, 401, 403, 409 `notice_outdated`/`team_disabled`, 500 |
| `DELETE /api/teams/[teamId]/skill-contribution` | genuine member (any team status) | none | `200 { contributing:false }` | 401, 403, 500 |

No other methods are routed. `teamId` and `treeId` are route context and never trusted without the
server checks above; the C1 `/api/me/skills*` routes are unchanged.

## Relationship to other features
- **skillProgress** and **roadmapItems**: independent (BR-3, BR-24). Different scales and meanings;
  neither is read, written, defaulted or constrained by C2.
- **C1**: reads eligible profiles through the single batch reader only; mutates nothing (BR-23); owner-only
  C1 APIs and the rules block are unchanged; the only C1 edits are the copy amendment (BR-29) and the
  guard edits (BR-30–BR-33).
- **D1/D2**: independent. A future role expectation must not reuse `teamSkillNeeds` or read coverage as
  individual evidence; any consumer of C2 output needs its own SPEC. The D1/D2 naming ambiguity in
  `docs/ROADMAP.md` is not resolved here.

## Test boundaries
| Boundary | Covers |
|---|---|
| Domain: need validation (level ∈ {2,3,4}, coverage ∈ [1,20], types, document-id vs stored `teamId`/`treeId`); `deriveCoverageState` for n = 0, 1, 4, 5, 6 and for `requiredCoverage` above/below/equal the cohort; participation rule (exact key set, version equality, timestamp validity, `enabled`-style/extra keys not effective); the derivation takes only integers | BR-1, 2, 3, 7, 8, 13, 14 |
| Privacy (coverage operation, fakes): below k / exactly k / above k; sparse skill in a large team; join/leave; withdrawal effective next call; identical response for every suppression cause; unreadable profile excluded not zeroed; no uid/e-mail/name/memberRef/count/level/distribution/timestamp in the DTO (deep key scan); `no-store`; query parameters and headers do not change output; role neutrality (lead = member; non-member admin ⇒ 403; member-admin = member) | BR-12–17, 18, 22 |
| Authorization matrix (needs read / needs write / coverage read / participation) for: lead, ordinary member, member-admin as lead, member-admin as ordinary member, non-member admin, unrelated user, removed member, signed-out, disabled team (needs readable; writes `team_disabled` even for a stored lead; coverage `team_disabled`; withdraw allowed), non-existent team; ordering of 401/403/409; transaction re-verifies membership and role | BR-4, 5, 9, 18, Actors |
| Persistence: deterministic id/uniqueness, per-team isolation, upsert `createdAt`/`updatedAt`, no actor field, hard delete idempotent without tombstone, last-write-wins, malformed documents skipped, only `teamSkillNeeds` / `skillContribution` written, participation writes touch no other membership field, concurrent toggles | BR-1, 5, 9, 23 |
| Participation lifecycle: opt-in, withdraw (object deleted, no negative state), stale notice 409, removal destroys, rejoin non-contributing, re-grant no-op, role change/memberRef prepare leave it untouched, version bump lapses it, **non-exposure** in roster, assignable members, members list, admin member list, access requests | BR-7–11 |
| C1 regression: owner-only APIs unchanged; C2 cannot write `skillProfiles` (batch module read-only; store seam/fake unchanged; no new method reachable by C1 operations); guard allow-lists changed exactly as BR-30–33; new negative fixtures fail; C1 notice test updated deliberately and C1 forbidden-identifier list unchanged | BR-23, 29–33 |
| New C2 static guard | BR-34 (all nine checks) |
| Firestore config: explicit `teamSkillNeeds` deny block pinned before the catch-all, no composite index, `firestore.indexes.json` unchanged | BR-35 |
| Limits: 501 memberships ⇒ `incomplete` with no rows; no needs ⇒ no profile read; needs/catalog truncation notices; any failed read ⇒ 500 without partial data | BR-4, 19 |
| UI: states of BR-27 (no need, insufficient, covered, gap, unavailable area, incomplete, error, read-only, non-member admin, disabled team); lead-only controls (member/admin see none); participation panel text and controls, no pre-selection; disclosure keyboard-operable; table semantics; text-not-colour; narrow-viewport card structure; forbidden-copy scan | BR-25–28 |
| Independence: need and participation writes leave `skillProgress`, `roadmapItems`, `skillProfiles`, `userProfiles` fakes untouched | BR-23, 24 |

## Acceptance criteria
- [ ] No C2 response contains uid, e-mail, display name, `memberRef`, a per-person level/status, any
      count, ratio, distribution, min/max, or timestamp (BR-15, BR-22).
- [ ] A person's levels are read only while they have an effective per-team participation on a genuine
      membership of an active team, for exactly the needed `treeId` (BR-12).
- [ ] Participation is opt-in, per team, revocable, versioned; stored as exactly `{noticeVersion,
      consentedAt}` with no negative state; removal destroys it; rejoin starts non-contributing
      (BR-7–11).
- [ ] `k = 5` is a fixed constant applied per skill; below 5 ⇒ `insufficient_data`; 5 and above ⇒
      evaluated; every suppression cause is indistinguishable (BR-13, 14, 17).
- [ ] Output is exactly `covered | gap | insufficient_data` (plus `area_unavailable` for an unusable tree);
      `requiredCoverage` above the cohort ⇒ `gap` without counts (BR-14, BR-15).
- [ ] Coverage accepts no query parameters and uses only the persisted need (BR-16).
- [ ] Need read: any genuine member and any app admin (disabled teams too); need write: only a genuine lead of
      an active team; ordinary members, non-member admins and non-members are rejected; stored lead on a
      disabled team rejected (BR-4, BR-5).
- [ ] Coverage read: only genuine members of an active team; non-member admins ⇒ 403; app-admin status never
      consulted (BR-18).
- [ ] Lead gains no access to any profile or richer output; no other lead capability exists (BR-5, BR-21).
- [ ] 501 memberships ⇒ `incomplete`, no rows; any read failure ⇒ 500 (BR-19). Nothing derived is stored or
      cached (BR-20).
- [ ] C2 writes only `teamSkillNeeds` and the caller's own `skillContribution`; no C1 data is mutated (BR-23).
- [ ] The batch reader is the single, read-only path; guard importer maps, identifier/re-export scans,
      call-site test and negative fixtures are in place; no new production file names `skillProfiles`
      (BR-30–34).
- [ ] C1 notice amended per BR-29 with its test updated; C1 owner-only behaviour unchanged.
- [ ] Table has caption/scope headers, text states, keyboard-operable controls, stacked narrow layout;
      notice carries the ten points; no unqualified "anonym", counts or evaluative wording (BR-25–28).
- [ ] No Demo change; no new env var, dependency or index; `teamSkillNeeds` deny block pinned (BR-35).
- [ ] Implementation-time verification: `pnpm typecheck`, `pnpm lint`, `pnpm test` pass and the
      `git diff` is inspected.

## Terminology (proposed Norwegian copy direction)
Kompetansebehov · «Minst {r} bidragsytere på nivå «{navn}» eller høyere» (C1 level labels *Grunnleggende
kjennskap / Kan med støtte / Kan selvstendig / Avansert*; levels 2–4 only) · Bidra til teamets
kompetanseoversikt / Slutt å bidra · Dekning: *Behovet er dekket* / *Behovet er ikke dekket ennå* / *Ikke
nok data til å vise dekning ennå*. Avoid: gap-score, mangler, svak, kritisk, rangering, prestasjon, «x av
y», and unqualified «anonym».

## Documentation impact (at implementation closeout, not now)
`PRODUCT.md` (delivered entry; non-goals clarification extended to the team-level aggregate and the lead
capability), `ROADMAP.md` (mark C2; reconcile "configurable 3–20" and "may prefill a plan from a gap"),
`ARCHITECTURE.md` (C2 section; single-reader rule; guard edits; genuine-membership ordering),
`DATA-MODEL.md` (`TeamSkillNeed`; `TeamMembership.skillContribution`; derived coverage), `UI-UX.md`
(section, table, panel, states), `SECURITY.md` (invariants 32–36, checklist; update invariant 22 and 31
text), a dated *C2 amendment* note in the C1 SPEC (no history rewrite), a note in
`member-identity-and-team-roles/SPEC.md` that the membership field is never exposed and that C2 adds
one lead capability. `AGENTS.md`/`CLAUDE.md` unchanged.

## Migrations / dependencies / config
None. An absent `skillContribution` means not contributing; an absent need document means no need; no
backfill. No new dependency, environment variable, index, background job, cache or infrastructure.

## Open questions
None. P1–P6 are approved and incorporated. Implementation choices left to `/split-tasks`: extraction vs
duplication of the member-readable catalog read; exact component split.

## Recommended implementation sequence (for `/split-tasks`, not tasks)
1. Domain + `teamSkillNeeds` persistence, rules block + pins, genuine-membership check, needs API
   (lead-only writes), needs section UI (coverage column shows "not available yet").
2. Participation: membership field, API, panel, non-exposure regressions, C1 notice amendment (must
   precede any reader).
3. SECURITY.md invariants 32–36 drafted and reviewed; the batch reader, guard edits and new C2 guard;
   coverage operation/API; matrix table UI.
4. Closeout: documentation sync and security review.

## Decision index (Q1–Q40)
| Q | Answer (as approved/revised) | Where |
|---|---|---|
| Q1 What is a `teamSkillNeed`? | "At least *r* eligible contributors at personal level ≥ *L*", one per team + tree | Key concepts, BR-1–3 |
| Q2 Persisted fields | `teamId`, `treeId`, `requiredLevel`, `requiredCoverage`, `createdAt`, `updatedAt`; no actor, no archive | BR-1 |
| Q3 Who creates/edits/deletes? | **Only a genuine lead of an `active` team**; ordinary members, non-member admins, non-members cannot | BR-5, Actors |
| Q4 Who reads needs? | Any genuine member, lead, and any app admin (read-only), disabled teams included; unrelated users no | BR-4, Actors |
| Q5 Default or explicit participation? | Explicit opt-in only; no default | Privacy model #1–2, BR-7 |
| Q6 Persisted consent model | `skillContribution: { noticeVersion, consentedAt }` on the membership; presence = opt-in; no `enabled`, no negative state | "Participation model", BR-7 |
| Q7 Per team? | Yes | #3, BR-9, BR-11 |
| Q8 Revocable? | Yes; deletes the object; no history | BR-9, BR-11 |
| Q9 Removal/rejoin | Removal destroys it; rejoin non-contributing until a new opt-in | BR-11 |
| Q10 Eligible contributors | Per skill, all five conditions | BR-12 |
| Q11 Unassessed counts toward the cohort? | No; not a contributor for that skill, invisible | BR-12 |
| Q12 Unreadable profile counts? | No; excluded, never treated as unassessed | BR-12 |
| Q13 What is k? | 5 | BR-13 |
| Q14 What must meet k? | Eligible contributors for that specific skill | BR-13 |
| Q15 Is k configurable? | No (supersedes configurable 3–20) | "Fixed `k = 5`", BR-13 |
| Q16 Who can configure k? | Nobody (member, lead, admin, team setting) | BR-13 |
| Q17 Allowed range | Not applicable — fixed at 5 | BR-13 |
| Q18 Can lowering k reveal suppressed information? | Yes — hence k is fixed; lowering needs a new decision, SECURITY revision and notice-version bump | "Fixed `k = 5`", BR-8 |
| Q19 Aggregate fields | `treeId`, `areaName`, `requiredLevel`, `requiredCoverage`, `state`; `availability` | BR-15 |
| Q20 Exact counts? | No | BR-15 |
| Q21 Percentages? | No | BR-15 |
| Q22 Level distributions? | No | BR-15 |
| Q23 Differencing risk limited how? | Mitigated: lead-only need mutation, categorical output, no query inputs, fixed k, opt-in. Residual: lead probing, roster/participation correlation, homogeneity, collusion | BR-21, Threat model |
| Q24 Who reads aggregate output? | Genuine members (incl. leads) of an active team | BR-18, Actors |
| Q25 Does lead gain authority? | Yes, exactly one: managing `teamSkillNeeds`; nothing else (no profile access, no richer output) | BR-5 |
| Q26 Does app admin gain authority? | No; read-only needs, no coverage; a member-admin is evaluated as a member | Actors, BR-18 |
| Q27 What does "gap" mean? | `n ≥ 5` and `c < requiredCoverage`, categorical | BR-14 |
| Q28 What is the "matrix"? | A table of needs × need definition + categorical status; no employee rows | BR-26 |
| Q29 Any aggregate persisted? | No | BR-20 |
| Q30 Any history persisted? | No | BR-20, BR-7 |
| Q31 Incomplete/truncated computation | `incomplete` with no rows (>500 memberships); read failure ⇒ 500, no partial | BR-19 |
| Q32 SkillTree disappears/malformed | `area_unavailable` row, delete-only; no personal data involved | BR-4, BR-14 |
| Q33 Inactive team | Needs readable; no writes; no coverage; opt-in blocked; withdrawal allowed | Actors, BR-5, BR-9, BR-18 |
| Q34 Integration with `roadmapItems`? | None in v1 | BR-24 |
| Q35 Integration with `skillProgress`? | None | BR-3, BR-24 |
| Q36 Where does the team UI live? | New section «Kompetansebehov og dekning» on Oversikt; no new route | BR-26 |
| Q37 Where does participation UI live? | The same section, on the team page (not `/me/skills`) | BR-25 |
| Q38 Privacy notice | Primary notice + «Slik fungerer personvernet» disclosure; versioned | BR-25, BR-8 |
| Q39 Suppression copy | «Ikke nok data til å vise dekning ennå.» + generic line; no number or cause | BR-27 |
| Q40 Static-guard changes | No new production file naming the collection; batch reader module; module-level importer maps; exactly one new approved importer; identifier/re-export scans; call-site test; new C2 guard | BR-30–34 |
