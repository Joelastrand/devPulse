# Amendment A — k = 3 automatic Teamkompetanse, radar publication and anti-probing (DRAFT, NOT APPLIED)

**Status: draft for approval. Not applied** to `docs/SECURITY.md`, to any SPEC, to production code, to notices, to
Firestore rules, to consent records or to shared data. The current approved contract is **k = 5** (SECURITY invariant 34).
Nothing in this draft is active until every gate in §A.9 is passed and recorded.

**Product update (owner, 2026-11-07):** the k = 3 minimum (R-2) and the radar (R-1) are approved product requirements. This draft is updated to the approved k = 3 requirement: 3 or more eligible contributors permit automatic aggregation when the approved publication safeguards allow it; 1–2 gives `insufficient_data`; no team-size floor. The security approvals G0–G7 in §A.9 are **still required**. The current enforceable contract remains k = 5 (SECURITY invariant 34) until §A.10 is applied. Nothing in this draft is applied.

Source decisions: owner, 2026-11-07 (product)
team-size floor; automatic radar as the intended default; individual sharing control on Mine ferdigheter; teamadmin-controlled
automatic or collaborative mode; no individual ratings or contributor counts shown. Owner, this request: K3-8 resolved as
described in §A.3; A3 test expectation replaced once Amendment A is approved (§A.7).

Amendment B (default-on, rejoin preservation) is a **separate document**: `AMENDMENT-B-DRAFT.md`. Nothing here depends on it.

---

## A.00 Selected design: on-demand aggregation (2026-11-07, supersedes the publication design)

**Owner decision:** simplify the architecture. The publication design (periodic boundary snapshots, 30-day epochs,
per-need change flags, the K3-8 cross-feature transaction, the boundary publisher and the one-edit-per-period rule) is
**abandoned**. Sections A.2 (invariant 35 publication text), A.3 (K3-8 transaction), A.5.2–A.5.5 (period and flag
anti-probing), A.8 (flag and publication tests), A.13 (cross-period tracking, bit budget) and A.15 (publication-based
protections) describe that abandoned design and **no longer apply**. The rest of this draft is unchanged unless noted
below.

**Current, complete design document: `AMENDMENT-A-ON-DEMAND.md`.** It replaces the publication text in this draft for
G1 review. The sections of this draft that describe publication are kept only as the record of the abandoned design.

**Selected design:**

- The team level is computed **on demand** at read time, from the existing authorized path: `readSkillLevelsBatch` over
  the eligible contributors (genuine member, effective `skillContribution`, valid level 1–4), exactly as coverage does
  today. Nothing is persisted or cached. A withdrawal, a level change or a membership change is visible on the next read.
- Rule: `level = floor((2·sum + n) / (2·n))`, integer arithmetic, half up. `deriveTeamLevel` in
  `src/features/team-skills/domain/team-level.ts` implements it. Fewer than `k` eligible contributors gives
  `insufficient_data`. Never zero.
- `k = 3`, no team-size floor. The enforced constant is still 5 until the activation gate (§A.9–§A.10) is recorded.
- Invariant 35 becomes: **no derived personal data is persisted or cached.** That is simpler and stronger than the
  publication text, and it removes the need for a publisher.
- Member DTO: no `requiredCoverage`, no uid, no count, no contributor data (K3-7 retained).
- Collaborative mode: a teamadmin enters one integer per area by hand (`teamCompetenceAreas.teamLevel`), never copied
  from private assessments. Authorization: genuine teamadmin or superadmin of an active team
  (`decideCollaborativeLevelWrite`). No route is built; the write is approval-gated.

**Accepted residual risks (documented, not release blockers):** cross-team intersection; repeated-observation
inference over time; small-team inference (the owner accepts that three-contributor aggregates are not anonymous). The
notice must say so (§A.6). Do not describe the aggregate as anonymous.

**Still required before activation** (unchanged in substance): G2 privacy and legal review of the three-contributor
disclosure; G4 Norwegian copy; G3 UI-UX radar exception; G5 notice version bump, which lapses participation and needs
an owner decision on the transition; SECURITY.md invariants 34, 35, 36 and the residual, applied only after those are
recorded; explicit Firestore deny blocks for any new collection (a separate approved rules step).

**BR-4 conflict: resolved in the SPEC.** SPEC BR-4 and decision D2 in
`docs/features/individual-skill-self-assessment/SPEC.md` now permit one rounded arithmetic mean per team and area for
the automatic radar, and keep individual levels unmodified. The module comment in
`src/features/skill-profiles/domain/self-assessed-level.ts` still says "nothing may average", which is stale. It is not
changed in this step.

**Scope guards:** the team-skills change-detection guard (`team-skills-scope-guard.test.ts`) and the participation
boundary test list exact files that may read personal data. The new internal path
the numeric operation's runtime export is not yet on the approved-export list, so one C1 guard assertion fails on purpose (see AMENDMENT-A-ON-DEMAND.md §7). Adding
them is a deliberate, reviewed allow-list edit, not something to do silently.

---

## A.0 G0 decision record (owner, 2026-11-07)

**Status: G0 closed with amendments (owner, 2026-11-07).** This records the design direction for security review. It is **not** authorization to activate anything. Nothing here is applied: SECURITY.md, the k = 5 constant, notice versions, consent records, Firestore rules and shared Firebase data are unchanged. Numeric publication is an **approved product direction**, not an activated security change.

**Accepted at G0:**
- **Radar (R-1), numeric direction (owner, 2026-11-07):** automatic mode shows one numeric aggregated team level per competence area, as a green polygon, with a neutral dashed target polygon. Missing or suppressed values are shown as unavailable, never as zero.
- **k = 3** eligible contributors per competence area, with **no additional team-size floor**. A team of exactly three participating members is supported.
- **Aggregation rule (proposed, subject to security and privacy review):** the rounded arithmetic mean of the eligible members' valid levels, with the exact convention in §A.2 (invariant 35).
- **Owner acceptance of inference risk:** the owner accepts that three-contributor aggregates may permit inference about individual ratings. This acceptance does **not** replace the security and privacy review. These aggregates are **not described as anonymous**.
- **K3-3:** 30-day publication period, provisional for security review.
- **K3-6:** collaborative assessments are entered manually and are **never prefilled** from member-derived results.
- **K3-7:** `requiredCoverage` is removed from member-facing DTOs, subject to security review.
- **K3-8:** a self-assessment edit sets the per-need publication change flag **in the same transaction** as the level write. If the flag write fails, the level write fails (fail closed).
- **K3-9:** no actor field in `teamProfileSettings`. Security review decides whether a separate, server-only, authorized audit record is needed.
- **Invariants 32–36:** accepted as **draft review text**, not final production wording (§A.2).

**Still required before any numeric publication is implemented:** see §A.14. Security review (G1), privacy and legal review (G2, L2, L6), the notice transition (G5), the UI-UX amendment (G3) and Norwegian copy review (G4) are all still open.

### A.0.1 Radar semantics: Alternative B approved as product direction

Alternative A (categorical only) was rejected for automatic mode by the owner. Alternative B (numeric team level) is the approved product direction. Under B, the publication stores one integer per team and need, which is a new persisted datum derived from personal assessments. Its disclosure, the inference risk for three contributors and the approvals it needs are in §A.13 and §A.14. Collaborative mode is unchanged: a teamadmin-entered integer per area, with no member data.

Categorical `covered` and `gap` states are no longer stored. The coverage table derives `covered` at read time from the stored integer and the need's target, using only those two values. No new data is stored for it.


## A.1 Scope

| In Amendment A | Not in Amendment A |
| --- | --- |
| k = 3 for automatic coverage and radar values | Default-on sharing for new members |
| Radar publication (automatic and collaborative) | Preservation of opt-out across rejoining (`teamSharingWithdrawals`) |
| Publication architecture: boundaries, change flags, edit limits | Any change to the existing opt-in contract (affirmative, off by default) |
| Teamadmin mode control and collaborative values | Lawful-basis, retention and erasure changes for default-on |
| Server-side anti-probing and DTO allow-lists | Firestore rules changes (separate explicit step) |
| Notice text, limited to the k = 3 contract | Notice text for default-on (Amendment B) |

## A.2 SECURITY.md — proposed exact text (replace the whole invariant unless marked "add")

### Invariant 32

> 32. **Team skill coverage (C2) reads a person's `skillProfiles` only through the single batch module
> (`readSkillLevelsBatch`).** It reads only for a person who holds an effective, per-team, versioned participation
> (`teamMemberships.skillContribution`) on a genuine membership of an `active` team, and only for the `treeId`s of
> the team's competence areas that have a need. Participation remains an affirmative, per-team, revocable opt-in,
> and is never set by a lead, team admin or app admin on another person's behalf. Coverage returns, for each need,
> only the team publication state under invariant 35 (an integer team level from 1 to 4, `insufficient_data` or `area_unavailable`) and never a `uid`, e-mail,
> name, `memberRef`, level, count, ratio, distribution, timestamp, completeness or contributor identity. A need is
> evaluated only when at least **three** eligible contributors hold a valid level for its area (invariant 34). With
> one or two, the state is `insufficient_data`, and every suppression cause is indistinguishable. Automatic radar
> values derive only from the publication under invariant 35. Three contributors do not provide anonymity, and the
> participation notice says so.

### Invariant 33 (add two sentences at the end)

> *Team profile mode:* only a genuine `teamadmin` of an `active` team, or a superadmin, may read or write the team's
> profile mode and its collaborative area values. No team-administration capability reads or writes any member's
> participation or assessment, and none reads `skillProfiles`.

### Invariant 34 (replace)

> 34. The coverage threshold `k = 3` is the code constant `SKILL_COVERAGE_MIN_CONTRIBUTORS`, owned by
> `src/features/team-skills/domain/skill-coverage-policy.ts`. It is never configurable by a request, setting,
> environment variable, team, lead or app admin. **There is no team-size floor.** It may not be lowered below three,
> or raised, without a revision of this document and a bump of `SKILL_CONTRIBUTION_NOTICE_VERSION`, which lapses all
> participation. The coverage and profile endpoints accept no query-time inputs.

### Invariant 35 (replace; draft review text for security review, not final wording)

> 35. Nothing derived from personal assessments is persisted or cached, **except** the following. Only the server writes
> them, and they hold no personal data beyond one aggregate level per team and need.
> (a) **One current publication per team and assigned need.** It holds either one integer team level from 1 to 4
> (the aggregate under the rule below), or one of the states `insufficient_data` or `area_unavailable`. It is overwritten at
> each publication boundary and never kept as history. It holds no count, sum, minimum, maximum, median, distribution,
> contributor list, identity, timestamp or epoch index.
> (b) **One boolean per team and assigned need** (`teamCoverageChange/{teamId}__{treeId}`, field `changed`). It is set to
> `true` by the authorized C1 level-write transaction when a publication input for that need changes (K3-8), and cleared
> only when that need's publication is written.
> **Aggregate rule (exact).** Let `n` be the number of eligible contributors for the area at the boundary, where eligible
> means: a genuine membership, an effective `skillContribution` for the team, and a valid stored level 1–4 for the area.
> If `n` is below 3, the publication is `insufficient_data`. Otherwise the level is
> `level = floor((2 × sum + n) / (2 × n))`, where `sum` is the sum of the eligible levels. This is the arithmetic mean
> rounded to the nearest integer, with an exact half rounding up. It uses integer arithmetic only. The result is always
> 1 to 4. For `n = 3` the mean's fractional part is 0, 1/3 or 2/3, so the half rule never applies.
> Reads serve the current publication and do not expose when it was computed. A cohort that cannot be read completely
> (more than 500 memberships) yields `incomplete` with no rows. Any read failure yields an error with no partial result.

*Drafting note.* Version 2 of invariant 35 replaces the categorical publication (version 1) with an integer level, because
the owner's approved radar needs an assessed level. The categorical coverage table derives its `covered` state at read
time from the stored integer and the need's target. No additional value is stored for it. Per-need flags are kept
(§A.3), so a change to one area suppresses only that area.

### Residual statement for invariants 32–36 (replace; draft review text)

> The team profile is privacy-thresholded. It is **not anonymous** in any formal sense. `k = 3` is a product threshold, not
> an anonymity guarantee. The automatic team level is a rounded arithmetic mean of three or more contributors. With exactly
> three contributors, a contributor who knows their own level can narrow the other two contributors' combined level to a
> small range from one published value. Repeated periods and visible input changes can narrow this further (§A.13). Boundary
> publication and one edit per need per period bound this in time. They do not eliminate it. A colluding member or lead, or
> a lead who is also a contributor, can narrow the others further. Operators with Firestore Admin credentials can read raw
> data. The participation notice states all of this (§A.6).

### Invariant 36 (replace; revised draft for security review, not final wording)

> 36. **Write authority.** Each collection below is written only by the server through the Firebase Admin SDK. The client
> SDK is denied read and write on every one of them.
> (a) **Member.** A member writes only their own sharing preference (`teamMemberships.skillContribution`, per team, through
> the owner-only endpoint) and their own skill levels in `skillProfiles`, through the authorized C1 paths. A member never
> writes a team's needs, profile mode, collaborative area values, publication, or change flag.
> (b) **Teamadmin and superadmin.** A genuine `teamadmin` of an `active` team, or a superadmin under the superadmin registry
> (SR-SI-1), writes only `teamSkillNeeds` of that team, `teamProfileSettings` of that team, and `teamCompetenceAreas.teamLevel`
> of that team, under invariant 33. No teamadmin capability writes any person's `skillContribution`, `skillProfiles`,
> `userProfiles`, `skillProgress` or `roadmapItems`.
> (c) **Server-controlled publication.** A publication document (invariant 35(a)) is written only by the boundary publisher. A
> change flag (invariant 35(b)) is set only inside the authorized C1 level-write transaction (K3-8) and cleared only by the
> boundary publisher. No request, client SDK, teamadmin capability, lead or administrative endpoint writes either directly.
> (d) **No direct private read.** No teamadmin, lead or app-admin capability reads `skillProfiles` directly. The only reader of
> `skillProfiles` for team purposes is `readSkillLevelsBatch`, through the boundary publisher and the authorized erasure path.

*Consistency check (2026-11-07, read-only; no rule or code changed).*
- `firestore.rules`: `teams`, `teamMemberships`, `teamCompetenceAreas`, `skillProfiles`, `teamSkillNeeds` and the final
  catch-all all deny client read and write. A new collection for the flag, the publication or `teamProfileSettings` is
  denied by the catch-all, but convention requires an explicit deny block with a SPEC reference. Adding one is a separate
  approved rules step, not part of G0.
- Write paths: `skillProfiles` is written only by `set-own-skill-level`, `clear-own-skill-level` and
  `delete-own-skill-profile` (server). `teamSkillNeeds` is written only by `skill-needs-store` (server). `skillContribution`
  is written only by the owner-only contribution endpoints (server). `teamCompetenceAreas.teamLevel` has **no write path yet**
  (BLK-1), so (b) is a requirement for future code, not a description of existing code.
- Reads of `skillProfiles`: `get-team-skill-coverage` reads only through `readSkillLevelsBatch`. The erasure paths read it as
  part of the erasure inventory. No teamadmin route reads it.
- Superadmin: the uncommitted SECURITY.md text (SR-SI, TA-SI-1) names the registry as the superadmin authority. Invariant 36(b)
  refers to it by that name so the two stay consistent. The registry text is not changed by this draft.

### Invariant 12 — not amended

The survey threshold `minimumResponses` (per survey, default 5) is a separate rule and is not changed.

## A.3 K3-8 resolved: self-assessment edits are publication inputs

**Decision (proposed).** A change to a member's private level for a competence area is a publication input for every
team in which that member currently contributes and in which the area has a need. It sets that need's change boolean in
the **same transaction** as the level write.

### A.3.1 Exact transaction (C1 write path)

Applies to `set-own-skill-level.ts`, `clear-own-skill-level.ts` and `delete-own-skill-profile.ts` (for each tree of the
profile that changes).

1. **Pre-read (outside the transaction, Admin SDK query):** the caller's `teamMemberships` where `uid == caller`. This is
   the candidate list of teams. It is only a candidate list; every membership is re-validated in step 3.
2. **Transaction begins.** All reads precede all writes (Firestore rule).
   - Read the caller's `skillProfiles/{uid}` (existing).
   - Compute the new stored level for the tree. If it equals the stored level, **no flag is set** (a no-op write does not
     change inputs).
   - For each candidate membership: re-read `teamMemberships/{uid}__{teamId}`; require a genuine membership with an
     effective `skillContribution`; read `teams/{teamId}` (`active`); read `teamSkillNeeds/{teamId}__{treeId}`. Collect the
     teams for which all hold.
3. **Writes (same transaction):**
   - Write the level (existing write, existing stamps).
   - For each collected team: set `teamCoverageChange/{teamId}__{treeId}.changed = true`.
4. **Commit.** If any flag write fails, the whole transaction fails, and the level is **not** written. No level change
   can occur without its flag (fail closed). The response is the existing `persistence_failed`, with no detail.
5. **Response.** Unchanged: the caller's own level only. No team, count, or publication state is returned.

**Completeness argument.** A team can be missed in step 1 only if the caller's participation began in the same instant.
Participation begins through the opt-in write, which itself sets the team's change boolean for every need of that team
(a join or opt-in is an input change in its own right). So any missed team is already suppressed for the current epoch.

**Publication.** The change boolean is cleared only by the boundary publisher, in the same transaction that writes the
publication for that (team, need). The publication for that need is then a suppression (`insufficient_data`) for the
epoch in which the input changed.

### A.3.2 Observable behaviour (what a viewer can and cannot learn)

- **No immediate change.** A level write changes nothing a viewer can read until the next boundary. Coverage reads
  between boundaries serve the stored publication (invariant 35).
- **At the boundary,** a need whose boolean is set is published as `insufficient_data`, with the same shape and wording
  as every other suppression. The viewer cannot tell whether the cause was a level change, a join, a need edit or a
  withdrawal (SPEC BR-17). A change in one member's level therefore cannot be distinguished from a change in the cohort
  size, and the published state does not depend on the size of the change.
- **Residual.** A viewer learns that *some* input for that need changed in that period. They do not learn who, what, or
  by how much (R2 of §10d).

### A.3.3 Effect on chart availability (stated for the owner)

A need is suppressed in a period if any of its inputs changed in that period. Assuming independent changes:

P(suppressed in a period) ≈ 1 − (1 − q)^m, where m is the number of contributors to that need, and q is the probability
that a contributor changes a level for that area in one period.

| q (per period) | m = 3 | m = 4 | m = 5 |
| --- | --- | --- | --- |
| 0.02 | 6 % | 8 % | 10 % |
| 0.05 | 14 % | 19 % | 23 % |
| 0.10 | 27 % | 34 % | 41 % |

The period length P works against availability: a longer period contains more changes, so more periods are suppressed.
It works for anti-probing: a longer period slows the bit budget (§A.5). The owner chooses P knowing both effects (K3-3).

Per-need granularity limits the cost to one area. Team-wide suppression would multiply the cost by the number of areas.

## A.4 Radar publication

**Single chart library.** `recharts` (already a dependency, `^3.10.1`) is the one chart library, as UI-UX requires. No
hand-written SVG for the profile.

**Values (computed on the server, in the DTO; the client only renders them):**

| Source state (automatic) | Radar value | Shown as |
| --- | --- | --- |
| Publication holds integer `m` (1–4) | Green polygon vertex at radius `m` | Text «Teamets nivå» with the value; table cell shows the level name |
| Publication `insufficient_data` (no value, suppression of any cause) | No vertex. **Never zero** | Text «Ikke nok grunnlag»; table cell «Ikke nok grunnlag» |
| Publication `area_unavailable`, or no need | No vertex. **Never zero** | Text «Området kan ikke vises akkurat nå»; table cell «Ikke satt» |
| Need exists with target `t` (any state) | Dashed polygon vertex at radius `t` | Text «Forventet nivå» with the target level |

The coverage table's `covered` and `gap` labels are derived at read time: `covered` if `m ≥ t`, `gap` if `m < t`. They are
never stored.

**Collaborative mode:** green value = `teamLevel` (1–4), or `null` («Ikke satt»). No member data is read (§A.5).

**Dashed polygon (both modes):** `targetLevel` = `teamSkillNeeds.requiredLevel`, when a need exists.

**Presentation rules.**
- Axes: one per active area with a need or a team level; 3 to 8 axes. Below 3: no profile, message «Legg til minst tre kompetanseområder for å se kompetanseprofilen.» Above 8: table only.
- Title «Kompetanseprofil». Legend below the chart: «Teamets nivå» (solid green) and «Forventet nivå» (dashed). Text, not colour alone.
- Text alternative (required): `role="img"`, `aria-labelledby` (title), `aria-describedby` (summary: «Teamets profil er vist for X av Y områder.»). A visible table with the same values («Kompetanseområde», «Teamets nivå», «Forventet nivå») sits next to the chart. It may collapse behind `<details>` below 768 px. The table is never hidden from assistive technology.
- Colours and dark mode: use the semantic tokens defined in `app/globals.css` under `[data-theme="light"]` and `[data-theme="dark"]`. The chart follows `data-theme`, not the OS query (UI-UX theme rule). Stroke and fill meet 3:1 against the surface.
- Suppressed values are never drawn as zero (UI-UX charts rule). `null` is not `0`.
- Responsive: chart container width ≤ 100 %, minimum 260 px, labels 12 px and wrapped to two lines. No page-level horizontal scroll at 320, 360, 768, 1024 or 1440 px.

**Documentation conflict to resolve before activation.** UI-UX "Charts" permits one library and requires that charts never
encode suppressed values as zero. It also contains a forbidden-UI rule for the personal skills pages (no chart), which
still applies to `/me/skills` and `/me/goals`. The team profile is not on those pages. A UI-UX amendment recording the team
radar exception is required (gate G3).

## A.5 Server-side anti-probing protections

1. **Publication only at a boundary.** A coverage or profile read serves the stored publication. It never recomputes
   (invariant 35).
2. **One edit per need per period.** `upsertSkillNeed` refuses a second change in the same period. The period start is
   computed from the fixed grid (`publication-period.ts`) and compared with the need's `updatedAt`. No new field.
3. **Edit sets the need boolean.** A need edit or deletion sets `teamCoverageChange/{teamId}__{treeId}.changed = true`.
   The boundary therefore publishes `insufficient_data` for that need. A probe cannot read a state for the value it just
   wrote.
4. **No `requiredCoverage` in any member-facing response.** Removed from the coverage DTO and from the member needs DTO.
   The lead and teamadmin needs view keeps it, because they set it. (A lead can still observe its own edits through the
   boundary; the bit budget below bounds that.)
5. **Bit budget.** For a cohort of n = 3 with three cut-points, the count at or above each cut-point takes four values:
   3 × log₂ 4 = 6 observations. Each observation needs at least two periods, because an edited need is suppressed in the
   period it changed. The exact distribution needs at least **12 periods** with no membership change. With P = 30 days this
   is about 12 months. The owner chooses P (K3-3); it is a time bound, not an elimination.
6. **Endpoint inventory (every route that can return team competence).** Each must read only the publication, or only
   collaborative values, or only the requirement set:
   | Route | Returns | Rule |
   | --- | --- | --- |
   | `GET /api/teams/[teamId]/skill-coverage` | Publication states | Publication only; no `requiredCoverage` |
   | `GET /api/teams/[teamId]/competence-profile` (new) | Radar values | Publication (automatic) or team levels (collaborative) only |
   | `GET /api/teams/[teamId]/skill-needs` | Needs | Member DTO: no `requiredCoverage`. Lead DTO: unchanged |
   | `GET /api/teams/[teamId]/skills` | Member skill progress (`skillProgress`) | Not team competence; no coverage field (verified) |
   | Exports, debug routes | None exist | Any future export or debug route must be added to this inventory and must read the same sources |
   | Logs | Generic failure categories only | No states, levels, names, counts |
7. **No query-time inputs.** Accepted by no route in §A.5.6 (tests).

## A.6 Notice (member-facing, Norwegian) — k = 3 contract

Draft. Requires native-speaker and privacy review (gate G4). Must not state that the profile is anonymous.

**Primary notice** (next to «Del mine ferdighetsvurderinger med teamprofilen»):

- «Deling er av til du velger å slå den på. Du bestemmer selv, team for team.»
- «Hvis du deler, brukes nivåene du har satt i egenvurderingene dine til å beregne teamets kompetanseprofil. Teamet ser
  aldri nivåene dine, og ingen ser hvem som deler.»
- «Teamprofilen viser bare en grov status per kompetanseområde: «Dekket», «Behov for utvikling» eller «Ikke nok grunnlag».
  Et område vises først når minst tre bidragsytere har vurdert det.»
- «**Dette er ikke anonymt.** Med få bidragsytere kan en grov status gjøre det mulig å utlede enkeltpersoners nivåer,
  særlig hvis noen kjenner egne eller andres vurderinger. I et team på tre som deler, gjelder statusen alle tre.»
- «Du kan slutte å dele når som helst. Dine vurderinger tas da ut av nye beregninger med én gang. Teamprofilen endres først
  ved neste faste oppdatering, så en tidligere status kan vises en kort stund.»
- «Forlater du teamet, fjernes delingen din. Blir du med igjen, må du velge på nytt.»
- «Teamadmin kan velge om teamprofilen skal bygges automatisk fra delte vurderinger, eller settes felles. Teamadmin kan
  ikke se hvem som deler eller dine vurderinger, og kan ikke endre din deling.»

**Expanded disclosure** («Slik fungerer personvernet», collapsed):

- «Bare nivåene du selv har satt, og bare for områder du har vurdert.»
- «Teamet ser ingen tall: ikke hvor mange som deler, ikke gjennomsnitt og ikke fordeling av nivåer.»
- «Når en endring skjer i teamet, for eksempel at noen slutter å dele, endrer et nivå eller blir med, vises området som
  «Ikke nok grunnlag» ved neste oppdatering. Teamet kan ikke se hva endringen var.»
- «Hvis noen i teamet endrer kompetanseområder, behov eller deling over tid og følger statusen, kan de i noen tilfeller
  utlede grov informasjon om gruppen.»
- «Kollegaer som kjenner hverandres vurderinger, kan sammen utlede mer enn det som vises.»
- «Det lagres ingen historikk over statuser.»
- «Dette er ikke en vurdering av deg, og det brukes ikke til å sammenligne eller rangere personer.»

**Mode explanation** (Teaminnstillinger → Kompetanseprofil, for teamadmin):

- «Automatisk: teamprofilen beregnes fra medlemmenes delte egenvurderinger.»
- «Felles: teamadmin registrerer en felles vurdering av teamets nivå per område. Verdiene hentes ikke fra medlemmenes
  vurderinger.»
- «Endringen av modus gjelder fra neste oppdatering og endrer ikke noen medlems deling.»

**Label consistency.** Use exactly these strings in code, copy and tests: «Dekket», «Behov for utvikling», «Ikke nok grunnlag»,
«Området kan ikke vises akkurat nå», «Ikke satt», «Ikke angitt», «Kompetanseprofil», «Teamets nivå», «Forventet nivå»,
«Del mine ferdighetsvurderinger med teamprofilen». Remove «Delvis dekket» (no backing state). Replace «Området kan ikke vises»
with the full string above where the current component uses the shorter form (current code: `TeamCompetenceCoverage.tsx`).

**Notice version.** `SKILL_CONTRIBUTION_NOTICE_VERSION` 1 → 2 at activation (a lowered k is a notice-contract change, SPEC
BR-8). Transition (gate G5): recommended (i), so every opt-in lapses. Then the member sees: «Vi har endret hvordan
teamprofilen fungerer. Din deling er pauset til du bekrefter på nytt.» Members are not re-enrolled automatically.

## A.7 A3 test plan (replaces the old expectation after G1)

The old A3 case asserts that a five-member team with five contributors is suppressed. That expectation follows from the
k = 5 contract and is **not** preserved after Amendment A is approved. Until then, A3 stays as it is (expected-to-fail).

After approval, the following replace it. The old file is not deleted; the A3 case is replaced by a decision record.

| ID | Test | Expected result |
| --- | --- | --- |
| A3-1 | Three eligible contributors on an area with a need | Radar value present: the integer team level `m` from the rounded mean (invariant 35). No zero and no categorical stand-in |
| A3-2 | One or two eligible contributors | No automatic value (`insufficient_data`, same shape as other suppression) |
| A3-3 | Team API response for a three-member team | Exact key allow-list; no `uid`, e-mail, name, `memberRef`, raw level, contributor count, participation count, distribution or timestamp |
| A3-4 | Notice text | Contains the limitation sentence («Dette er ikke anonymt» and the three-contributor sentence); contains no unqualified «anonym» |
| A3-5 | Residual documentation test `R-k3-A3` | A roster of three with three contributors yields an evaluated value that describes all three members. Named as an **accepted residual**, not as a safety property |

A3 is **not described as eliminated.** The documentation test asserts the residual so that a future change that silently
alters it fails.

## A.8 Required security regression tests (in addition to §A.7)

- **A1 (re-expressed at k = 3):** withdrawal from three to two does not change the displayed value before the boundary; at
  the boundary the area is `insufficient_data` regardless of the cohort size (boundary-only, compared for cohorts of 3 and 4).
- **A2:** a sweep of `requiredCoverage` within one period observes one state; a second edit in the period is refused;
  the member DTO has no `requiredCoverage`.
- **A4 (re-expressed):** an opt-in that completes three contributors does not change the displayed value on the next read,
  and the boundary suppresses rather than evaluates.
- **Sanity:** two contributors → `insufficient_data`; three → evaluated; both at the boundary, after a quiet period.
- **Self-assessment flag (K3-8):** a level change sets the flag for each contributing team and need; a no-op write sets no
  flag; a failed flag write leaves the level unchanged; a non-contributing member's edit sets no flag; a team that is not
  `active` gets no flag.
- **Scope guard:** C1 writes only the change boolean into C2 state, and only through the transaction in §A.3.1.
- **Mode authority:** teamadmin and superadmin may write the mode and team levels of their team; member, lead without the
  role, app admin without membership, and non-member are refused; a mode write never changes a `skillContribution`
  (before/after on fixtures containing withdrawn members).
- **Collaborative DTO:** no read of `skillProfiles` or `skillContribution` (store spies: zero calls).
- **Publication:** the boundary publisher writes only `publication` documents and clears only the boolean; it never writes
  `skillContribution`, `skillProfiles` or `teamSkillNeeds`.
- **No retained history:** a second publication overwrites the first; no document holds a previous state.

## A.9 Approval gates

| Gate | Requirement | Owner or reviewer |
| --- | --- | --- |
| **G0** | **Closed with amendments (owner, 2026-11-07).** Numeric direction approved as product direction. Security and privacy review still required (§A.14). | Owner |
| **G1** | Security review of §A.2–§A.5 (publication, K3-8 transaction, anti-probing), including the availability table (§A.3.3) | Security reviewer |
| **G2** | Legal and privacy review of the three-contributor disclosure and the residual statement (§A.2 residual, §A.6) | Privacy reviewer; legal (L2, L6 of §12.6) |
| **G3** | UI-UX amendment recording the team radar exception and the single chart library (`recharts`) | Owner (UI-UX) |
| **G4** | Native-speaker review of §A.6 Norwegian copy | Reviewer |
| **G5** | Notice transition chosen (recommended (i)) and version bump scheduled | Owner; legal (L4) |
| **G6** | Period length P chosen with the horizon H (method in §10d.4, n = 3: P ≥ H / 12) | Owner (K3-3) |
| **G7** | Decision record that retires old A3 and records `R-k3-A3` | Owner and security reviewer |

Gates G0–G7 must all be recorded before the k = 3 activation step (§A.10). Amendment B's gates are separate.

## A.10 Activation step (k = 3), only after §A.9

1. Constant `SKILL_COVERAGE_MIN_CONTRIBUTORS` 5 → 3. No team-size constant is added.
2. Notice version bump and transition (G5). Copy regenerated from the constants and the strings in §A.6.
3. Publication path (§10d) is already live under k = 5 (earlier phase), so no period of unsafe operation occurs.
4. Tests: boundary 2/3 for each need; A1, A4 re-expressed and passing; A3 replaced per §A.7; `R-k3-A3` recorded.
5. Radar verification (§A.11) passes for three, four and five members.
6. Documentation: SECURITY.md (after G0), SPEC P2, Q12, Q15, Q18, BR-8, BR-13, BR-14, BR-15, BR-20, BR-25; team-experience
   SPEC edge case, security section, BR-22, BR-25, new BR-31–33 and acceptance criteria (see the D1 proposal §12.2).

## A.11 Radar verification for teams of three, four and five members

Each case uses synthetic data only. Roster size is the number of active members; contributors are those eligible for the need.

| Roster | Contributors per area | Expected automatic values | Expected collaborative values |
| --- | --- | --- | --- |
| 3 | 3 | Values present | Values present (if set) |
| 3 | 2 | No automatic value | Values present (if set) |
| 4 | 3 | Values present (one non-contributor) | Values present (if set) |
| 4 | 2 | No automatic value | Values present (if set) |
| 4 | 4 | Values present | Values present (if set) |
| 5 | 3 | Values present | Values present (if set) |
| 5 | 5 | Values present | Values present (if set) |
| 5 | 1 | No automatic value | Values present (if set) |

Per roster size, each case also checks: the DTO has no count or identity key; the text alternative matches the chart values;
the empty state («Ikke nok grunnlag» per axis) has no vertex; a team with no set levels shows «Ikke satt» for each axis.
Browser checks at 320, 360, 768, 1024 and 1440 px, in light and dark mode, are deferred until Firestore quota returns, and are recorded
in `VERIFICATION.md`.

## A.12 Open owner decisions (Amendment A only)

- **K3-3** Period length P, with the horizon H. Trade-off in §A.3.3 and §A.5.5. *Decided at G0 (§A.0): 30 days, provisional for security review.*
- **K3-6** Collaborative values entered by hand, with no prefill. Recommended. *Decided at G0 (§A.0): entered by hand, never prefilled.*
- **K3-7** Remove `requiredCoverage` from the member DTOs. Recommended. *Decided at G0 (§A.0): removed from member DTOs, subject to security review.*
- **K3-8** Resolved as §A.3 (self-assessment edits are inputs). **Confirm**, because it adds a cross-feature write from C1. *Decided at G0 (§A.0): confirmed; flag set atomically, fail closed.*
- **K3-9** No actor field on `teamProfileSettings`. Recommended. *Decided at G0 (§A.0): no actor field; audit record question open for security review.*
- **Per-need change boolean** (§A.2 note): confirm.

## A.13 Inference risk of the rounded mean for exactly three contributors

**Computed (2026-11-07, pure arithmetic over levels 1–4, rule as in invariant 35).** For a contributor who knows their own
level `x`, one published value `m` leaves the other two levels `(y, z)` in a set of pairs:

| Own level `x` | Published `m` | Consistent pairs `(y,z)` (out of 16) | Range of `y + z` |
| --- | --- | --- | --- |
| 1 | 1 | 3 | 2–3 |
| 1 | 2 | 10 | 4–6 |
| 1 | 3 | 3 | 7–8 |
| 2 | 1 | 1 (unique) | 2 |
| 2 | 2 | 9 | 3–5 |
| 2 | 3 | 6 | 6–8 |
| 3 | 2 | 6 | 2–4 |
| 3 | 3 | 9 | 5–7 |
| 3 | 4 | 1 (unique) | 8 |
| 4 | 2 | 3 | 2–3 |
| 4 | 3 | 10 | 4–6 |
| 4 | 4 | 3 | 7–8 |

Of the 12 non-empty cases, the pair is uniquely determined in 2. The remaining cases narrow each other member's level to a
range of two or three values. The table is a single period with no other information.

**What this means.**
- Each member's level can be inferred within a small range by a contributor who knows their own level. The owner accepted
  this. It is the central disclosure of this design, and it is not anonymity.
- **Across periods** the disclosure grows. Each change by another member sets the need's flag, so that period is suppressed.
  The next publication then shows a new `m`. A contributor can track the change in the others' combined level, period by
  period. This is the cross-period residual that §A.5 bounds only in time, not in amount.
- **Lead or teamadmin without a level** sees only the integer. Without their own level they can narrow only a combined
  value. A lead who is also a contributor has the same position as a member with their own level.
- **The needs no longer leak through cut-points.** The categorical version let a lead vary `requiredCoverage` and
  `requiredLevel` to read counts above cut-points. In the numeric version the published value does not depend on the
  target or on `requiredCoverage`. The member DTO drops `requiredCoverage` (K3-7). That removes the cut-point sweep (A2) as
  a lever, but not the membership and timing levers (A1, A4).
- **Information per period is larger.** A numeric value gives up to two bits per need per period, against about one bit
  for a categorical value. The bit budget in §A.5.5 was computed for categorical cut-points, so it does not bound numeric
  publication. It must be recomputed for security review.

**Not mitigated by this design, and stated as residual:** the exact `(y, z)` ambiguity above, cross-period change tracking,
and the collusion cases. A different aggregate (median, minimum, maximum or a larger threshold) would change the table. The
owner has fixed k = 3 and no team-size floor, so none of these is a substitute for review.

## A.14 Approvals required before numeric publication is implemented

| # | Approval | Owner or reviewer | Status (2026-11-07) |
| --- | --- | --- | --- |
| 1 | Numeric team radar as product direction (R-1, aggregate rule as stated) | Owner | **Recorded**, product direction only |
| 2 | Security review (G1) of invariants 35 and 36 as drafted: integer aggregate, flag, publication writes, DTO allow-lists, endpoint inventory (§A.5.6) | Independent security reviewer | **Not started** |
| 3 | Privacy and legal review (G2, L2, L6) of the three-contributor inference (§A.13) and the residual statement. Owner acceptance does not replace this | Privacy reviewer; legal | **Not started** |
| 4 | Notice version bump and transition (G5). The bump lapses all current participation (invariant 34). The notice must state the numeric aggregate, the three-contributor inference and «Dette er ikke anonymt» | Owner, with legal (L4) | **Not started** |
| 5 | Norwegian copy review of the notice and the radar text (G4) | Native-speaker reviewer | **Not started** |
| 6 | UI-UX amendment (G3) recording the numeric team radar, the table alternative and the single chart library | Owner (UI-UX) | **Not started** |
| 7 | D2 reversal: REQ §8.2 requires separate approval for numeric averages and radar coordinates. Confirm that owner decision R-1 satisfies it in writing | Owner | **To confirm** |
| 8 | Period length P = 30 days, confirmed or changed under the bit-budget recomputation in §A.13 | Owner and security reviewer | Provisional |
| 9 | Explicit deny blocks in `firestore.rules` for the new collections (`teamCoverageChange`, publication, `teamProfileSettings`). Deny-only, no client access. A separate rules step | Owner approves the step; reviewer checks | **Not started** |
| 10 | SECURITY.md amendment of invariants 34, 35, 36 and the residual. Applied only after items 2 and 3 | Owner and security reviewer | **Not applied** |
| 11 | Decision record retiring old test A3 and recording `R-k3-A3`, re-expressed for numeric output (G7) | Owner and security reviewer | **Not started** |
| 12 | Activation (§A.10), only after 2–11 | Owner | **Not authorized** |

Items 2 to 4 cannot be replaced by owner approval. Item 1 is the owner's product decision; the others are formal reviews.

## A.15 Anti-probing and publication-period rules, preserved for security review

Preserved unchanged, and to be reviewed as written in §A.5:
- **Publication only at a boundary.** Reads serve the stored publication and never recompute (invariant 35).
- **One edit per need per period** (`upsertSkillNeed`, fixed grid in `publication-period.ts`).
- **Edit sets the need flag.** A need edit or a member level change sets the flag, so the next publication for that need is
  `insufficient_data`, and a probe cannot read the value it just wrote.
- **A1 (withdrawal):** withdrawing from three contributors to two changes `n` to below three. The publication is suppressed
  at the next boundary, so the effect is visible only as a suppression, not as a value.
- **A4 (opt-in):** an opt-in that completes three contributors does not change the displayed value before the next boundary.
- **A2 (cut-point sweep):** removed as a lever for members (K3-7), and the published value does not depend on the target.
- **Endpoint inventory (§A.5.6):** the new `competence-profile` route returns only the integer publication or collaborative
  values. A test asserts zero reads of `skillProfiles` and `skillContribution` on that route.

Security review should check each point against the code once it exists. None of these protections is implemented yet.
