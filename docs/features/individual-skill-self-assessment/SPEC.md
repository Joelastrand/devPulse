# Individual Skill Self-Assessment (C1)

## Status
**Implemented** (closed out 2026-10-05; TASK-001–011 Done). Approved, revision 2 —
planned 2026-10-04 against commit `2f2ff68` (Feature B closed). Revision 2 passed final
review with outcome PASS WITH SUGGESTIONS (BLOCKING 0, IMPORTANT 0). The requirements below
are the approved, historical text and are not rewritten; the clarifications that follow
record delivered-state wording only and change no behaviour or business rule.

### Dated pointer (2026-10-14, Personal development goals D1)
Historical text in this document is unchanged. The "D1/D2" labels used above (role expectations,
development goals, check-ins) are resolved by `docs/features/personal-development-goals/SPEC.md`
("Label resolution"): **D1** = person-owned development goals, **D2** = check-ins/conversations,
role expectations = a separate unscheduled future feature. D1 renamed the header link
*Mine ferdigheter* to **Min utvikling** (still `/me/skills`, also active on `/me/goals`) and added a
shared personal nav `Ferdigheter · Mål` to `/me/skills`. C1 behaviour, storage and privacy are
unchanged, and D1 never reads `skillProfiles`.

### Closeout clarifications (2026-10-05)
- **"Controls disabled" wording (BR-30 unreadable profile, TASK-009).** The text below says
  the catalog is shown read-only with "all controls disabled". As built, the unreadable
  state renders **skill names only**; assessment controls are *unavailable*, not rendered
  as disabled selectors. Reason: a disabled selector must show a selected value and could
  imply that an unknown malformed value means *Ikke vurdert*. The substantive invariant
  is unchanged and takes precedence: unreadable data is never presented as known
  assessment data.
- **Raw window.** `truncated` means only that the raw query returned a 501st document; the
  first 500 raw documents are the candidate window (invalid ones consume slots, no refill),
  so "the 500 oldest valid skills" is not a correct description.
- **Known limitations carried forward (not fixed):** a 404-triggered catalog refetch may
  transiently overwrite a concurrent same-user successful save with an older snapshot;
  after a reset failure, focus can land poorly once the status area becomes empty/hidden;
  the programmatic status-focus target has no visible outline; the generic
  `DeleteConfirmation` component is reused from `src/features/forum/components/`.
- **TASK-010 history.** Initial review: CHANGES REQUIRED (BLOCKING 0, IMPORTANT 1 — stale
  reset success/focus on repeated reset). A narrow remediation cleared the previous reset
  success when a new reset attempt opens. Narrow re-review: PASS WITH SUGGESTIONS
  (BLOCKING 0, IMPORTANT 0, previous IMPORTANT resolved).
- Fourth step of the *Team & Personal Development* initiative
  (F0 → A → B → **C1** → C2 → D1 → D2). C1 builds no aggregation; C2 is not authorized by C1.

## Problem
DevPulse knows where a **team** stands on a competency area (`skillProgress`) and
what a team **plans** (`roadmapItems`). It knows nothing a person has chosen to
record about their **own** skills. Without a person-owned, privacy-safe skill
model, a later team skill view (C2) would have to invent one under pressure, and
the likeliest shortcut is manager-visible individual data, which the product's
anti-surveillance direction rules out.

## User outcome
A signed-in person opens **Mine ferdigheter** (`/me/skills`), sees every
organization-defined skill area, states how they assess themselves in each on a
small descriptive scale, changes or clears any assessment at any time, and gets a
clear personal overview. **In C1 the assessment is private in the product:** other
users, team leads and app administrators cannot view a person's individual
assessment through any product or API surface (BR-18). The data is only the
person's own current self-report.

## Scope
- Person-owned **current** self-assessment, one level per skill area, global per
  person (not per team).
- Route `/me/skills`, one header link, personal list with per-row editing,
  text-first overview, legend, filter.
- Own-profile API: `GET /api/me/skills`, `PUT`/`DELETE /api/me/skills/[treeId]`,
  `DELETE /api/me/skills`.
- New server-only collection `skillProfiles/{uid}` (Admin SDK) with an explicit
  deny-only Firestore rules block (BR-36).
- A strict owner-only privacy contract plus a static scope guard that keeps it
  honest (truthfully bounded, BR-18).

## Out of scope
- C2: `teamSkillNeeds`, Team Skill Matrix, team gap/coverage analysis, any
  aggregate or aggregate endpoint, any minimum-cohort calculation or
  configuration, named teammate comparison, any C2 aggregate access to profiles.
- Role expectations, development goals, target levels, check-ins (D1/D2).
- Manager/lead/admin assessments; any sharing ("del med leder/team"), sharing flag
  or consent flag.
- Assessment history, per-skill timestamps, notes/free text, evidence links.
- A radar/radial chart or any chart (BR-29).
- A separate skill-definition concept, user-selected skill subsets, suggestions
  from team data.
- An account-deletion framework (none exists; see BR-33).
- `/me` shell/tabs, `Mål`, `Samtaler`, `Oversikt` entries.
- Demo Team fixture changes.

## Key concepts
- **Ferdighet / skill area** — an individual-facing skill area. Its stable identity
  **is** an existing org-wide `SkillTree` `treeId`; its displayed name **is** the
  tree's `name`, treated as the shared skill-area name (D1). Tree **stages
  (`nodes`) are not used**.
- **Kompetanseområde** — the *team-level* concept over the same tree
  (`skillProgress`, `roadmapItems`). Unchanged; never shown on `/me/skills` as team
  state.
- **Egenvurdering (self-assessment)** — one person's own, current, self-reported
  level for one skill area. Self-reported, person-owned, editable,
  development-oriented. Not a rating by anyone else, not a performance score, not a
  measure of employability.
- **Nivå (level)** — one of four ordered, **ordinal** values with canonical
  meanings (D2, BR-4). Unassessed is the *absence* of a level, never a level.
- **Skill profile** — the single document `skillProfiles/{uid}` holding a person's
  levels. Person-owned data.

Terminology rule: individual surface = *Ferdigheter*; team surface =
*Kompetanseområder* (`docs/UI-UX.md`). "Nivå" in C1 always means personal
self-assessed level; it is never called "stadium" (team maturity stage). The
future personal tab name (the earlier *Kompetanse*) is **not** decided by C1.

## Policy reconciliation (A1)
**The historical wording.** `docs/features/team-skill-tree/SPEC.md` (Phase 7),
justifying why *that* feature stored no person-level data, says: *"A per-person
skill rating would be exactly the individual-performance data point this project
has already ruled out."* It rests on `docs/PRODUCT.md` → Non-goals: *"DevPulse is
**not** an individual employee performance monitoring or ranking system."* The same
passage says the questions raised by person-level data (self-assessment, behaviour
when a user leaves a team, multi-team users, peer-visible capability) are ones
*that document* "deliberately does not build". The F0 and A specs and
`docs/ROADMAP.md` already schedule "individual self-assessment (`skillProfiles`)"
as C1, i.e. later product work.

**What the old rule was protecting against.** Surveillance and performance
semantics: someone *else* rating, scoring, ranking or inspecting a person. That is
the underlying rationale.

**What C1 does — an explicit narrowing, not a silent reinterpretation.** The old
sentence is literally broader than its rationale: it equates *any* per-person skill
rating with performance data. **C1 supersedes that blanket wording for one category
only**, and acknowledges that this is a deliberate product-policy narrowing that
the product owner must approve (A1).

| | |
|---|---|
| **Previously prohibited and still prohibited** | manager, lead or admin rating of a person; team-owned individual rating; ranking; scoring; named comparison between people; any performance- or productivity-monitoring use; inferred competence |
| **Permitted by C1 (only)** | **self-reported**, **person-owned**, **private in C1**, **development-oriented**, **non-evaluative** personal proficiency data |

This is consistent with the anti-surveillance rationale because no other person
holds, sees, sets or can derive the value in C1. The `PRODUCT.md` non-goal stays in
force as written (C1 is neither monitoring nor ranking).

**Reconciliation of the stale wording is deferred to feature closeout.** After C1 is
delivered, the closeout documentation pass reconciles `docs/PRODUCT.md` (Non-goals
clarification and a "Delivered" entry), a cross-reference from
`team-skill-tree/SPEC.md`, `docs/DATA-MODEL.md`, `docs/SECURITY.md`,
`docs/ARCHITECTURE.md`, `docs/UI-UX.md` and `docs/ROADMAP.md`. None of those is
modified by this specification work.

## Repository findings (code and docs, verified)
1. **`/me` today** is only `app/me/profile/page.tsx` (`/me/profile`, "Min profil") and
   `GET /api/me`, `/api/me/profile`. There is no `/me` index, shell or
   sub-navigation. Signed-in header links are `Hjem · Team · Min profil` (+ `Admin`
   for app admins) in `src/components/nav/SiteHeader.tsx`/`copy.ts`; the header list
   uses `flex-wrap`.
2. **`SkillTree` is a team-maturity progression**, not a proficiency scale: 2–20
   ordered adoption stages ("Manuell testing → … → Tester som kjører i
   byggløypa"), count/order/`nodeId` immutable, only `name`/`label` cosmetically
   correctable (name 3–100 characters), **no deletion and no hide path**. Stages
   describe how far a *team* has taken a practice, so they are semantically wrong for
   "how well do I know this". Hence D1/D2.
3. **No member-readable catalog exists.** `listSkillTrees` is app-admin-only
   (`requireAppAdmin`). C1 needs its own bounded catalog read and must **not**
   loosen `listSkillTrees`.
4. **Catalog query precedent (verified):** `listSkillTrees` runs
   `.orderBy("createdAt","asc").limit(500)` — a single-field auto-indexed query with
   no `where` — and filters invalid documents *after* the limit (so up to 500 raw
   documents, fewer valid ones). `listTeamRoster` uses limit 501 to detect
   truncation. Firestore orders documents with equal `createdAt` by document id (the
   Demo trees all share one `createdAt`).
5. **Own-data precedent:** `userProfiles/{uid}` (F0) — uid as document id, no uid or
   e-mail stored, `GET/PUT/DELETE /api/me/profile`, subject only from the verified
   token, strict single-key `PUT` body, `UserProfileStore` seam, owner hard-delete,
   no account-deletion flow (documented known limitation). `getOwnProfile`/
   `setOwnProfile` call `verifyIdToken` and do **not** require `emailVerified`. Where the
   code base does check it (app-admin detection, invitation resolution, access
   requests) the flow grants admin rights or membership; the own-profile endpoints and
   the other member-originated writes reviewed for C1 (e.g. skill-progress self-report)
   establish no general requirement.
6. **Policy tension:** see "Policy reconciliation (A1)".
7. **Doc inconsistency noticed (not part of C1):** `docs/ROADMAP.md` labels D1/D2
   "Role expectations" (`roleDefinitions`) while the C1 planning context calls D1/D2
   "personal development goals, progress and check-ins". C1 does not depend on either
   reading and does not redefine D1/D2.
8. **Chart dependency already exists** (`recharts`, `TrendChart`). C1 needs none.
9. **Demo Team** seeds the presenter's *membership* only; it never writes
   person-owned records under the presenter's uid.
10. **Firestore rules convention (verified):** `firestore.rules` has an **explicit
    deny block per collection** (`teams`, `teamMemberships`, …, `roadmapItems`,
    `userProfiles`) followed by a catch-all deny; `firestore-deployment-config.test.ts`
    pins those blocks and asserts "no composite index" for `userProfiles`. The
    catch-all already denies unlisted collections, but the convention (and the pins)
    require an explicit block for every collection.
11. **No account-deletion flow exists** for any user data.

## Actors and access
| Actor | Read own profile | Write own profile | Read another person's profile |
|---|---|---|---|
| Signed-in user (any team count, including zero) | Yes | Yes | **No** |
| Team member / team lead (as such) | Own only | Own only | **No** |
| App admin (as such) | Own only | Own only | **No** |
| Signed-out / invalid token | No (401) | No (401) | No |

- Identity comes only from the verified, revocation-checked ID token
  (`verifyIdToken`). No `uid`, `teamId`, role or owner is accepted from the client.
- **`emailVerified` is not required** for C1, consistent with `/me/profile` (see finding 5).
- **No team membership is required.** `authorizeTeamAccess`, `resolveTeamRole`,
  `requireAppAdmin`, `isAppAdmin` are **not** used.
- **No product path** reads another person's profile. Operational access to Firestore
  by an operator holding Admin credentials exists technically and is **not** a
  product entitlement.

## User stories
1. As a signed-in person, I want to see all organization-defined skill areas in one
   list so that I can decide where I stand.
2. As a person, I want to set my own current level for a skill area so that I get an
   accurate personal picture.
3. As a person, I want to change or clear a level at any time so that the picture
   stays mine and honest.
4. As a person, I want an overview of what I have and have not assessed without being
   scored so that I can reflect without judgement.
5. As a person in several teams, I want to assess a skill area once so that I am not
   asked per team.
6. As a person, I want to know that in this release no lead, admin or colleague can
   see my assessments so that I can answer honestly.
7. As a person, I want to erase my whole skill profile so that I stay in control of my
   data.
8. As a person using a keyboard, screen reader or phone, I want the full function
   without any chart.
9. As the later C2 feature, I need person-level current levels with canonical
   numeric meaning, stored globally and free of team coupling, so that
   privacy-protected aggregation can be specified later without a migration.

## Decisions
| # | Question | Decision |
|---|---|---|
| D1 | Skill catalog / definition source | A skill area = an existing org-wide `SkillTree`: **`treeId` = stable skill-area identity; tree `name` = displayed skill-area name** (explicitly treated as the shared name). **Every valid tree can be assessed through the owner API when its `treeId` is known** (the target is validated directly, BR-12); only valid trees inside the bounded catalog window are *listed* in the C1 UI (BR-11). Stages/`nodes`, `skillProgress` and roadmap state are **not** reused. No separate skill-definition concept in C1. Trade-offs recorded in "SkillTree catalog trade-offs". |
| D2 | Proficiency scale; reuse nodes? | **Separate fixed four-level personal scale, ordinal, integers `1–4`; tree nodes not reused.** Canonical meaning is defined in BR-4, independent of UI labels. Absence = unassessed. |
| D3 | Persistence shape | **One document per person**: `skillProfiles/{uid}` with a `levels` map `treeId → 1..4`. One `get` to read; C2 may later batch-`getAll` profiles; no per-skill fan-out, query or index; size bounded by the number of valid trees, with no C1 cap (BR-6). |
| D4 | Global vs per team | **Global per person.** No `teamId`, membership or team reference is stored. |
| D5 | Visible skill areas | **All valid trees inside the bounded catalog window (BR-11) are listed**, nothing derived from the person's teams (avoids reading memberships/`skillProgress` and leaking team planning state). |
| D6 | Clear/reset | Yes: per skill (clear → key removed) and whole profile (document physically deleted). |
| D7 | Skill changes/disappears | Rename/relabel: no effect. Tree absent/invalid: entry not shown, kept in storage, writes to it rejected, `DELETE` allowed (BR-9). |
| D8 | History | None. Current state plus document `createdAt`/`updatedAt` only. D1/D2 must not reinterpret `updatedAt` as per-skill history; they need their own storage. |
| D9 | Admin / lead access | None to profile content (BR-18). |
| D10 | Sharing | None. No flag, no placeholder field. |
| D11 | Route/nav | `/me/skills`; one header link **"Mine ferdigheter"**; no shell (BR-2). |
| D12 | Visualization | Canonical = list with per-row control and non-colour indicator; **no chart** (BR-29). |
| D13 | New chart dependency | None. |
| D14 | Index | None. |
| D15 | Migration/backfill | None. Absent document = empty profile. |
| D16 | Firestore rules | **A behavior-neutral, explicit deny-only `skillProfiles` block is added to `firestore.rules`, with a pinned deployment-config test and a "no composite index" assertion**, following the existing per-collection convention (BR-36). It grants nothing; clients still have no Firestore access. |
| D17 | Demo Team | No change (BR-35). |
| D18 | Multi-team | One assessment, no team association stored (BR-34). |
| D19 | Malformed data | Entry-level leniency; readability depends only on the `levels` container; timestamps tolerated (BR-9, BR-10). |
| D20 | Bounded read | One profile `get` + one catalog query (limit 501) in parallel; no per-skill reads (BR-8, BR-11). |
| D21 | Concurrency | No version field; per-key merge in a transaction; last-write-wins per skill; per-row request serialization in the UI (BR-16). |
| D22 | Write granularity | Per-skill mutation, never whole-profile replacement from client state. |
| D23 | `emailVerified` | Not required (BR-17). |

## Behavioral requirements

### Route and navigation
- **BR-1** `app/me/skills/page.tsx` renders the page through a thin route entry with
  logic in `src/features/skill-profiles/`. A signed-out visitor sees the existing
  sign-in prompt pattern (as `/me/profile`); no skill data is requested while signed
  out. Auth gating reuses `useAuthGatedResource`.
- **BR-2** `SiteHeader` shows exactly one new link for a signed-in user, label
  **"Mine ferdigheter"** → `/me/skills`, placed after "Min profil", `aria-current` on
  exact path. No other nav entry, tab, `/me` index or disabled placeholder is added.
  The eventual personal structure (`Oversikt · Kompetanse · Mål · Samtaler`) is
  direction only and is not built or linked in C1. **Navigation evolution constraint:**
  one direct header link is acceptable now; when a further personal page is
  added later, that feature must reconsider and introduce a proper `/me` navigation
  surface rather than adding more global header links indefinitely. C1 builds no
  shell.

### Catalog and scale
- **BR-3** The skill list is every `skillTrees` document that passes
  `isValidSkillTree`, within the catalog window of BR-11. Invalid trees are
  omitted. The response carries only `treeId` and `name` per skill — never `nodes`,
  stage labels, `createdBy`, or timestamps. `listSkillTrees` (admin) is unchanged and
  keeps its authorization.
- **BR-4 (canonical scale).** Levels are exactly the integers `1,2,3,4`, **ordinal**
  (ordered categories, not measurements): no averaging, summing, weighting or other
  arithmetic across skills or people is meaningful or permitted. The persisted value is
  the integer; its **canonical meaning is the one below, independent of any UI label**.

  | Level | Canonical meaning (domain definition) |
  |---|---|
  | `1` | **Limited or early familiarity** with the skill area. |
  | `2` | **Can perform relevant work with support or guidance.** |
  | `3` | **Can work independently in ordinary situations.** |
  | `4` | **Deep or advanced proficiency**: handles complex or unfamiliar situations and contributes to or shapes good practice. *Guiding or mentoring others may be an example of level-4 proficiency; it is **not** the defining requirement* — teaching ability and domain proficiency are different things, and no copy, validation or UI may require mentoring ability for level 4. |

  *Absent* = not assessed (carries no meaning about proficiency, never `0`).
  - **Where it lives:** one domain module in `src/features/skill-profiles/domain/`
    owns the level type, the guard (`isSelfAssessedLevel`) and the canonical meaning as
    documented constants/comments; Norwegian labels and descriptions live only in the
    feature's `copy.ts`. C2 must reason from the numeric value and these canonical
    meanings (e.g. "level ≥ 3 = can work independently"), never from translated labels.
  - **Stability rule:** UI labels/descriptions may be reworded without migration if the
    canonical meaning is unchanged. Changing what a level *means*, or the number of
    levels, is an explicit scale/schema decision and, because the meaning of persisted
    values would change, requires migration consideration.
  - **Proposed Norwegian copy (wording subject to A2; copy only):** `1` *Grunnleggende
    kjennskap* — "Jeg har begrenset eller tidlig kjennskap til området."; `2` *Kan med
    støtte* — "Jeg løser relevante oppgaver, men med støtte eller veiledning."; `3`
    *Kan selvstendig* — "Jeg løser oppgaver selvstendig i vanlige situasjoner."; `4`
    *Avansert* — "Jeg har dyp kompetanse, håndterer krevende eller ukjente situasjoner
    og bidrar til god praksis – for eksempel ved å veilede andre." No numeric "x av 4"
    display and no wording that implies seniority.
- **BR-5** The page carries one short, persistent (not tooltip) notice with C1-scoped
  wording: the assessment is the person's own, current and self-reported, is **not a
  rating or score**, and — **in this version of DevPulse it is private: other users,
  team leads and app administrators cannot see it.** Proposed copy: "Egenvurderingen din
  er privat. Andre brukere, teamledere og administratorer kan ikke se den i DevPulse."
  No text on the page, in the SPEC or in copy states or implies that the data will
  *never* be used elsewhere. Any later use for aggregation requires the process in
  "C1 / C2 boundary" (separately approved C2 SPEC, a new security invariant, an
  intentional access-path change, a consent-vs-automatic decision) **and an updated
  notice** before that use exists. C1 does not decide consent vs automatic inclusion.

### Persistence
- **BR-6** Collection `skillProfiles`, document id = verified `uid`. Fields, all
  canonical: `levels: { [treeId: string]: 1 | 2 | 3 | 4 }`, `createdAt: Timestamp`
  (first creation of the profile document), `updatedAt: Timestamp` (last successful
  write; server clock). **Not stored:** `uid`, e-mail, `displayName`, `teamId`,
  memberRef, `assessedBy`, per-skill timestamps, labels, tree names, derived values,
  sharing/consent flags, schema version. `levels` may be empty after clears. Size is
  bounded by the number of valid SkillTrees (a valid tree can be assessed through the
  API when its id is known, even outside the catalog window); C1 introduces **no
  product cap** on that number or on assessments. At current product scale the document
  stays far below Firestore's document-size limit; C1 gives no hard guarantee beyond
  that.
- **BR-7** Derived presentation values — assessed count, per-level counts, labels, sort
  order, filter results, indicator segments — are computed on read/render and never
  persisted.
- **BR-8** `GET /api/me/skills` performs, in parallel, one `skillProfiles/{uid}` `get` and
  one catalog query, and returns
  `{ skills: [{ treeId, name, level: 1|2|3|4|null }], truncated: boolean,
  profile: "ok" | "unreadable" }`. Skills are sorted by `name` (`localeCompare("nb")`,
  tie-break `treeId`) by the server after catalog selection (BR-11), so all clients
  agree. No per-skill request exists on page load. A `GET` never writes.
- **BR-9 (entry semantics).** A `levels` entry is used only if its key is a skill area
  returned in this response **and** its value is one of `1–4`. Any other entry — a key
  not in the response (tree unavailable/invalid, or outside the catalog window) or an
  invalid value (`0`, `5`, `"3"`, `2.5`, `null`) — is **ignored**: not shown, not
  counted, not an error, and **no inference is made** about why it is absent. No `GET`
  repairs or deletes stored data. A later valid `PUT` for that key overwrites it;
  `DELETE` of that key or of the whole profile removes it.
- **BR-10 (document semantics).** Readability is determined by the canonical
  assessment container only:
  - **Readable:** `levels` is absent (treated as the empty map) or a plain object.
    Invalid individual entries are handled by BR-9. **Timestamps do not affect
    readability**; an invalid or missing `createdAt`/`updatedAt` is simply not used by
    any read, and no timestamp is ever returned.
  - **Unreadable:** `levels` is present but is not a plain object (e.g. `null`, array,
    primitive). Then `GET` still returns the catalog with every `level: null` and
    `profile: "unreadable"`; single-skill `PUT`/`DELETE` are rejected with
    `409 profile_unreadable` and never overwrite the data; only `DELETE
    /api/me/skills` recovers it.
  - **Absent document** is the normal empty profile, not unreadable.
  - **Repair on write:** every successful profile write (a `PUT`, or a `DELETE`-one that
    actually removes a key) sets `updatedAt` to the server's current time; if the
    document lacks a valid `createdAt` (absent document, or invalid/missing value),
    `createdAt` is set to the current time in the same write — the canonical
    creation semantics are "first time a valid profile document existed; now if that
    cannot be established".
  - **Unknown top-level fields** never become part of any DTO and do not block
    otherwise safe use. Normal mutations use per-key merge and therefore **preserve**
    them; only `DELETE /api/me/skills` removes them, because it physically deletes the
    whole document (BR-14).
- **BR-11 (catalog window and truncation).**
  - **Raw-window algorithm (normative):** (1) query `skillTrees`
    `.orderBy("createdAt","asc").limit(501)`, no `where` (single-field, auto-indexed; no
    composite index); (2) the first 500 raw documents are the **visible candidate
    window**; a 501st raw document, if returned, is only a probe and is never returned
    to the client; (3) validate each window document with `isValidSkillTree`; (4) discard
    invalid ones; (5) **no refill query** replaces them; (6) sort the remaining trees by
    name for presentation (BR-8).
  - **Visible set (normative):** *the valid trees among the first 500 raw `skillTrees`
    documents ordered by `createdAt` ascending.* It is **not** "the 500 oldest valid
    trees".
  - **Ordering:** query/window ordering is `createdAt` ascending; Firestore orders
    documents with equal `createdAt` by document id, so the window is deterministic (the
    Demo trees share one `createdAt`) and C1 adds no application-level tie-break.
    Presentation ordering (name, tie-break `treeId`) applies only after selection and
    validation and never changes which trees are in the window.
  - **Invalid documents inside the window** consume their window slots, are omitted from
    the DTO and are not replaced by later documents: with 500 raw documents of which 3
    are invalid, at most 497 trees are visible. This is not a product cap.
  - **`truncated` (normative):** `truncated = true` iff the query returned a 501st raw
    document, i.e. more than 500 raw documents exist. It means *the window may not cover
    every document*; it does **not** mean a valid skill is definitely hidden. If the 501st
    document is invalid, `truncated` is `true` although every valid tree may already be
    visible. This is deliberately conservative.
  - **500 is a defensive read bound** inherited from the existing SkillTree listing
    convention. It is **not** a product guarantee that the organization has at most 500
    skill areas, not a product cap, and is not communicated as one.
  - **UI wording when `truncated`:** conservative: the notice says the list **may** be
    incomplete (e.g. "Listen kan være ufullstendig."); it must never state or imply that
    skill areas are definitely missing. Exact copy is a `copy.ts` decision.
  - **Read consequences when `truncated: true`:** only the visible set is returned; all
    counts and summaries refer only to visible skill areas; assessments stored for areas
    outside the visible set **remain persisted**, are **not** deleted, repaired or counted
    as visible progress.
  - **Valid tree beyond the window:** not listed by the C1 UI, but still a valid skill
    area for the API: `PUT` with its known `treeId` validates the target document directly
    and may write the assessment. A tree is never treated as nonexistent merely because it
    is absent from the `GET` catalog.
  - **Mutation safety:** a write never infers that a tree is invalid from its absence
    from the catalog response. `PUT` validates its target by reading
    `skillTrees/{treeId}` directly (BR-12), so truncation does **not** disable writes and
    mutation validity does not depend on the catalog window. The UI only initiates a write
    from a listed row; the server is correct independently of what the UI shows. (A tree
    id is non-sensitive org reference data, so a direct call revealing that a valid tree
    exists beyond the window discloses nothing new.)
  - **Hidden persisted entries:** remain stored; `GET` never repairs or deletes them;
    `DELETE /api/me/skills` removes them; `DELETE /api/me/skills/[treeId]` is valid
    for any well-formed `treeId` the caller supplies, including hidden or
    stale/unavailable ones. **API correctness is distinct from UI discoverability:**
    C1 builds no UI to discover or enumerate arbitrary hidden tree ids; the whole-profile
    reset (offered whenever `truncated` is true, see BR-25) is the UI route to remove
    them.

### Writes
- **BR-12** `PUT /api/me/skills/[treeId]` body exactly `{ "level": n }` (integer `1–4`).
  One Firestore transaction: read own profile (readability per BR-10), read
  `skillTrees/{treeId}` **directly** and require `isValidSkillTree`, then write only
  that map key, `updatedAt`, and (when needed per BR-10) `createdAt`, using a per-key
  merge (nested merge-set or `FieldPath`; never replacing the whole `levels` map or the
  document, so other keys and unknown fields survive). Idempotent. Returns `{ level }`
  (the canonical stored value).
- **BR-13** `DELETE /api/me/skills/[treeId]` removes that key. Idempotent: if the
  document or the key is absent it succeeds with `{ level: null }` and writes nothing (no
  timestamp change or repair). When it removes an existing key it is a profile write: it
  preserves all other keys and unknown top-level fields, sets `updatedAt`, and repairs a
  missing/invalid `createdAt` per BR-10. It does **not** require the tree to
  still be available (stale or hidden entries can be cleared). The document is kept with
  a possibly empty `levels`. Rejected with `409 profile_unreadable` on an unreadable
  document (BR-10).
- **BR-14** `DELETE /api/me/skills` **physically deletes the complete
  `skillProfiles/{uid}` document** (levels, timestamps and any unknown fields); succeeds
  if absent; idempotent; returns `{ ok: true }`. It is the owner's "erase everything"
  and the only recovery for an unreadable document. The UI requires an explicit
  confirmation (BR-30).
- **BR-15** Validation (server, all writes): body must be a JSON object with exactly the
  allowed key set (`level` for `PUT`; `DELETE` routes never read or validate a body —
  any body is ignored, as for `DELETE /api/me/profile`); extra keys,
  arrays, strings, floats, `null`, out-of-range → `400 invalid_input`; non-object body or
  malformed JSON → `400 invalid_request`. The `treeId` path segment must match
  `^[A-Za-z0-9_-]{1,128}$`, otherwise `404 skill_unavailable` (malformed, unknown and
  invalid-tree are not distinguished). A well-formed but non-existent or invalid tree on
  `PUT` → `404 skill_unavailable`. No client value other than `level` and the path
  `treeId` is ever used.
- **BR-16 (concurrency).** No version field. Writes are transactional per-key merges:
  concurrent updates to **different** skill areas preserve each other's keys (no lost
  update across keys), though concurrent transactions on the same profile document may
  be retried by Firestore. Concurrent writes to the **same** skill area are
  last-write-wins. In the UI each row serializes its own requests (control disabled
  while that row saves), so a stale response cannot overwrite a newer choice made in the
  same tab; different rows save independently. A successful response applies the
  server's canonical `level` to that row; there is no full refetch and no optimistic
  update before the server confirms.

### Authorization and privacy
- **BR-17** All four endpoints derive the subject exclusively from the verified token.
  There is no `uid`, e-mail or profile id in any path, query or body. Invalid/missing
  token → `401 unauthenticated`. `emailVerified` is not required (as for
  `/api/me/profile`).
- **BR-18 (C1 owner-only invariant, stated independently of any test).** During C1, **no
  product or API surface other than the authenticated person's own C1 endpoints may
  expose individual `skillProfiles` content.** Team membership, team lead role, app-admin
  status, roadmap ownership and `memberRef` grant nothing. A team lead or app admin
  calling any endpoint receives nothing about anyone else's profile; the own-profile
  endpoints behave identically for them as for everyone. No admin or team endpoint
  returns profile content; `authorizeTeamAccess`/`resolveTeamRole`/`requireAppAdmin`/
  `isAppAdmin` never decide access to it.
  - **The static scope guard is evidence, not the invariant.** It is an automated test
    (style of Feature B's TASK-012 guard) that proves only: (1) the set of source files under
    `src/` and `app/` that statically reference the `skillProfiles` collection/persistence
    identifier equals the approved C1 set (the `skill-profiles` server modules and their
    tests, the rules/config pins); (2) a **module-import allow-list**: the
    application/server entry points (route files, pages, other feature modules) that import
    the `skill-profiles` server or store modules are exactly the approved C1 set (the
    `app/api/me/skills/**` routes and the feature's own modules), so a new route importing
    an approved operation or the store seam fails the test visibly; (3) the persisted key
    set equals `{levels, createdAt, updatedAt}`; (4) the skill-profiles sources do not
    import team-authorization, `skillProgress`, roadmap or membership code; (5) no
    `app/api/admin/**` or `app/api/teams/**` file references the collection or imports
    those modules. It does **not** prove arbitrary runtime behaviour and does **not**
    exclude a dynamically constructed collection name or module path, a re-export or
    dynamic import the scan cannot resolve, a reference outside the guarded directories, or
    Admin-credential access outside the application. Code review of the diff remains the
    check for those.
  - **Future access process (C2).** A future aggregation reader must not be added as an
    incidental reader. It requires **all** of: its own approved C2 SPEC; an explicit new
    `docs/SECURITY.md` invariant; deliberate review of the privacy model; a deliberate,
    reviewed change to the guard's allow-lists (collection references and module
    imports); threshold/aggregation protections; and the separate
    consent-vs-automatic-inclusion decision. C1 builds none of it, and the guard
    is designed so that this change is *deliberate* (an allow-list edit under review), not
    impossible.
- **BR-19** No sharing of any kind: no endpoint, DTO field, UI control, flag or copy
  suggests that a lead, team or admin can or will see assessments in C1, and none exists.
- **BR-20** Responses contain only the allow-listed keys in BR-8/BR-12/BR-13/BR-14, built
  field by field. Never a `uid`, e-mail, display name, team id, membership id,
  `memberRef`, audit field, tree `nodes`/stage labels, or timestamps. No team information
  appears anywhere on the page.
- **BR-21** Logs and error reports never contain levels, tree ids, skill names or the
  profile; failures log only a generic category.
- **BR-22** Anti-surveillance (UI + API + copy): no overall score, average, percentage,
  grade, rank, "top/bottom", badge, streak, leaderboard, "progress to goal", comparison
  with teammates/team/org/role, profile-completeness nagging or reminder, or evaluative
  wording ("svak", "sterk", "dårlig"). Counts are allowed and descriptive only (BR-26).
  Levels are ordinal (BR-4): the product computes no mean or sum of levels.

### Independence from team data
- **BR-23** Writing the skill profile never reads or writes `skillProgress`, and writing
  `skillProgress` (admin or member report) never reads or writes `skillProfiles`. A
  person's level and a team's stage are different facts; neither updates, defaults or
  constrains the other. The page never shows team stage, tracking state or plans.
- **BR-24** `roadmapItems`, roadmap `ownerRef`, `memberRef`, `teamMemberships`, `teams`
  and `userProfiles` are neither read nor written by C1. Roadmap ownership is
  coordination metadata, not evidence of skill: no inference in either direction, no UI
  link between them.

### Page and UI
- **BR-25** Page structure (top to bottom): `PageHeader` "Mine ferdigheter" with a
  one-sentence description; the BR-5 notice; an always-visible **level legend** (`dl`:
  the four level names with their descriptions; not collapsed, not a tooltip); overview
  line (BR-26); filter (BR-28); the skill list; a secondary "Nullstill alle ferdigheter"
  action shown when any visible skill is assessed, **or** `profile: "unreadable"`, **or**
  `truncated: true` (hidden entries may exist).
- **BR-26** Overview is plain text, descriptive only: "Du har vurdert *N* av *M*
  ferdigheter." plus per-level counts as a text list ("Nivå-navn: n") for levels with `n >
  0`. *N* and *M* count **visible** skill areas only. When `truncated`, the BR-11 notice
  replaces *M* ("Du har vurdert *N* av de viste ferdighetene."). No percentage, bar of
  totals or single summary figure. With zero assessed: the empty-assessment state (BR-30).
- **BR-27** Each skill is one list row: the skill name (long Norwegian names wrap, never
  truncated), a level `Select` (existing primitive; options: "Ikke vurdert" + the four
  level names; label = skill name), and a read-only level indicator: four segments filled
  up to the level, **plus the level name as text** — never colour or fill alone
  (segments `aria-hidden`; the text carries the meaning). Changing the `Select` saves
  immediately (`PUT`, or `DELETE` for "Ikke vurdert"); no global save button, no unsaved
  state.
- **BR-28** Filter: local, client-side only, no request: segmented/radio filter "Alle ·
  Vurdert · Ikke vurdert", default "Alle", no persisted view state. A filter with no rows
  shows a neutral empty message.
- **BR-29** **No chart.** Reasons (recorded so the decision is not reopened casually):
  skill count is admin-defined with no C1 cap (the list window alone is up to 500 documents; a radar is usable at roughly
  5–12 axes); axis order is arbitrary (creation order), so polygon shape and area carry
  no meaning and would read as an overall score (BR-22); sparse assessments render as
  misleading slivers; long Norwegian labels collide on a radial layout; and C1 already
  needs a canonical accessible list. No committed product requirement for a personal chart
  exists (`UI-UX.md` "Charts" covers results/trends only), so this is a SPEC decision. A
  later optional supplemental visualization over a user-selected small subset may be
  specified separately; it must keep the list canonical and add no overall figure.
- **BR-30** States (each distinct, Norwegian via `copy.ts`, no raw error text):
  | State | Behavior |
  |---|---|
  | Signed out / session expired (401) | sign-in prompt; no data shown; pending row edits discarded |
  | Loading | `LoadingState`; no stale data from another user |
  | Catalog read failure (or profile read failure) | single page error with retry; stored assessments untouched (nothing to name them with) |
  | No skill areas defined | `EmptyState` "Ingen ferdigheter er definert ennå." (no control, no action) |
  | No assessments yet | list shown with all rows "Ikke vurdert"; one neutral sentence inviting a start; no nag |
  | Partial assessments | normal list; overview per BR-26 |
  | Save pending | that row's control disabled, "Lagrer…" in a polite live region |
  | Save failure | row reverts to last confirmed value, inline `Alert` for that row, retry by choosing again; other rows unaffected |
  | Skill unavailable on write (404) | row error "Denne ferdigheten er ikke lenger tilgjengelig."; then one catalog refetch |
  | Unreadable profile | catalog shown read-only (controls disabled), notice that stored data cannot be read, and "Nullstill alle ferdigheter" as recovery |
  | Reset-all | explicit confirmation step (existing confirmation pattern, as `DeleteConfirmation`); on success all rows "Ikke vurdert" |
  | Truncated catalog | BR-11 notice |
- **BR-31** Accessibility contract: the list is the canonical, complete representation;
  every skill and level is operable and readable with keyboard only and a screen reader;
  each control has a real `<label>` (skill name) and the level description is associated
  via `aria-describedby` or the legend; status messages use a polite live region and
  errors use `role="alert"` (existing `Alert`); visible focus; the indicator duplicates,
  never replaces, text; nothing conveyed by colour alone; heading order `h1` → section
  headings; no animation required.
- **BR-32** Responsive: single column at phone width, no horizontal page scroll; each row
  stacks name above control below the `sm` breakpoint and sits side by side above it;
  touch targets at least the existing form-control size; the legend wraps.

### Lifecycle
- **BR-33** Lifecycle table:
  | Event | Behavior |
  |---|---|
  | First assessment | `PUT` creates `skillProfiles/{uid}` with `createdAt = updatedAt = now` |
  | Change level | `PUT` overwrites that key and `updatedAt`; no trace of the previous value |
  | Clear one | `DELETE …/[treeId]`; key removed |
  | Erase all | `DELETE /api/me/skills`; whole document physically removed; next `PUT` recreates it |
  | Tree renamed / stage relabelled | nothing stored depends on it; new name shown |
  | Tree unavailable/invalid | entry ignored on read (BR-9); `PUT` rejected `skill_unavailable`; `DELETE` allowed |
  | New tree created | appears as "Ikke vurdert"; no write |
  | User leaves one/all teams | no effect; profile is global with no team link |
  | User joins a team | no effect; no re-assessment asked |
  | Display name / e-mail changes, re-auth | no effect; keyed by `uid` only |
  | Malformed stored entry / document | BR-9 / BR-10 |
  | Firebase account deleted | **no deletion flow exists** (finding 11); the document is orphaned until a future deletion feature removes `skillProfiles/{uid}`; recorded as a known limitation identical to `userProfiles`. `skillProfiles/{uid}` is **person-owned data**: any future account-deletion or data-export work must include it. C1 does not solve deletion or export. |
- **BR-34** Multi-team semantics: a person in Team X and Team Y assesses a skill area
  **once**; C1 stores and shows no team association. A future C2 (not built) decides
  independently, under its own SPEC, which memberships make a profile eligible for an
  aggregate; the natural derivation is a read-time join to the person's genuine, current
  membership in an active team (leaving stops contributing, joining contributes without a
  new assessment) — nothing about it is persisted in `skillProfiles`. No C1 write depends
  on team membership.
- **BR-35** Demo Team: **no change.** Seeding `skillProfiles/{presenterUid}` would write
  person-owned data into a real signed-in user's profile and need conflict/ownership
  handling the Demo seed deliberately avoids; synthetic users or fixed uids are not
  allowed. The presenter sees the seeded demo skill trees as "Ikke vurdert" and can assess
  live. Limitation recorded: no pre-populated personal demo state.

### Infrastructure
- **BR-36** `firestore.rules` gains an **explicit, deny-only** block for
  `/skillProfiles/{document=**}` (`allow read, write: if false;`) with the repository's
  usual explanatory comment, **placed before the catch-all**. It is behavior-neutral
  (the catch-all already denies) and grants nothing; its purpose is to make the intended
  boundary explicit and pinned per the existing per-collection convention.
  `src/lib/firebase/firestore-deployment-config.test.ts` gains the matching pin and a
  "no composite index for `skillProfiles`" assertion (as for `userProfiles`). No
  `firestore.indexes.json` change. Deploying rules remains a separate, explicit step per
  `docs/DEVELOPMENT.md` and is not performed by the implementation work; because the
  catch-all already denies, safety does not depend on the deploy.

## C1 / C2 boundary
C1 provides: person-owned current levels, personal list/overview, edit/clear/erase, the
personal API, `skillProfiles/{uid}`, the privacy contract and its guard tests.

C1 deliberately does **not** calculate, store or expose: team coverage, gaps, a matrix, an
aggregate or aggregate endpoint, cohort counts, any minimum-cohort check or its
configuration, any per-person score, role fit, desired levels, or freshness/age of an
assessment, and it grants **no** C2 aggregate access to profiles.

| Fact | Source of truth |
|---|---|
| Team current state | `skillProgress` (existing) |
| Team plan | `roadmapItems` (existing) |
| **Person current self-assessed level** | **C1 `skillProfiles/{uid}.levels`** |
| Team desired state | future C2 `teamSkillNeeds` |
| Role expectation | future role definitions |
| Coverage / gap / matrix | derived, never persisted as a canonical score |

### C1 product invariant vs future C2 access
The C1 owner-only invariant (BR-18) is a statement about the **product as delivered in
C1**. It does not forbid C2 from ever deriving privacy-protected aggregates; it forbids
any such access from appearing without the deliberate process in BR-18 ("Future access
process"). Until then, C1 makes no promise that the data can never participate in a
future thresholded aggregate, and the page makes no such promise (BR-5).

### Constraints C2 must honour (recorded now, implemented in C2)
1. Individual profiles are never exposed to lead/admin/teammate through C2. A C2 read path
   is a **new** access to person-owned data and needs the BR-18 process.
2. Aggregates use a minimum cohort threshold. The established product direction is
   default **5**, configurable **3–20** (the survey `minimumResponses` precedent). C1
   encodes **nothing** for it and adds no configuration or persistence.
3. The cohort for a skill area must be the number of **assessed** members for that area,
   not team size; differencing across membership changes and across assessed-vs-unassessed
   counts must be covered by C2's own privacy analysis.
4. Whether assessments contribute to team aggregates automatically or only after an
   explicit opt-in is a **C2 decision**; the BR-5 notice must be updated before any such
   use is introduced.
5. C2 must not write `skillProfiles`, must not persist derived coverage as a score, and
   must not copy levels into team documents. It must treat levels as ordinal (BR-4).
6. Skill-area identity is `treeId` (see trade-offs below).

## SkillTree catalog trade-offs (A4)
C1 reuses **only** `treeId` (identity) and `name` (display) of a SkillTree as the personal
skill-area catalog. It does not reuse stage/`nodes` semantics, `skillProgress` or roadmap
state, and the DTO exposes no stage content (BR-3). The tree `name` is **deliberately
treated as the shared skill-area name**, used both as a team Kompetanseområde name and as
a personal Ferdighet name. Consequences, accepted knowingly and not cost-free:
- **Permanence/visibility:** the repository has no per-tree hide, archive or delete
  lifecycle. An unsuitable or oddly phrased admin-created tree name (names are 3–100
  characters of admin free text; some may describe team adoption rather than a skill)
  remains visible to **all** C1 users, and cannot be excluded from the personal catalog.
  C1 intentionally accepts this coupling instead of introducing `skillDefinitions`.
- **Double coupling / migration cost:** C2 is expected to key `teamSkillNeeds` on the
  same `treeId`. Replacing SkillTree as the catalog later therefore requires a
  **coordinated migration/reconciliation across both** `skillProfiles.levels` keys and
  future `teamSkillNeeds`, not one collection.
- **Mitigation (documentation only):** closeout/product documentation should give admins
  naming guidance so a SkillTree name works both as a team competency-area name and as a
  personal skill-area name. Those documents are not edited now.

## Security and privacy
Feature-specific implications of `docs/SECURITY.md` (the policy itself is not restated):
- Touches: authentication, personal data (self-assessment), Firestore Admin access,
  Firestore rules (explicit deny), logging, retention. Does **not** touch: survey
  encryption, anonymity, the response threshold, team isolation (no team data involved).
- **Classification:** personal, user-chosen, structured, non-free-text. Existing policy
  requires application-level encryption for sensitive **survey** payloads and treats
  anonymous/free-text content as highly sensitive; it contains no general rule requiring
  encryption of person data, and `userProfiles` is the plaintext precedent. Plaintext is
  therefore consistent (A3); free-text notes would change the classification and are out
  of scope.
- **Owner-only invariant:** BR-18 (candidate wording for `docs/SECURITY.md` at closeout):
  skill-profile data is person-owned, server-only, readable and writable only by its owner
  through the own-profile API; lead and admin roles, team membership and `memberRef` grant
  nothing; no individual score, ranking, comparison, manager note or inferred competence
  exists; any derived view needs a separately specified, approved, privacy-protected
  aggregate.
- **Retention:** current state only, no history, owner can erase (BR-14); orphaned after
  Firebase account deletion until a deletion feature exists (known limitation).
- **Correlation:** document id is the `uid`, as for `userProfiles`; acceptable because no
  endpoint can query or list profiles and no client sees an id. No identity field beyond
  the id and no team linkage.
- **Abuse/rate limiting:** none, consistent with other own-data endpoints; document growth
  is bounded by the number of valid SkillTrees (writes require an existing valid tree); C1
  adds no cap on it.
- **Accepted residual risks:** (1) an operator with Admin credentials can read profiles in
  the console — not a product entitlement; (2) tree-name suitability and permanence (see
  trade-offs); (3) no freshness information on an assessment; (4) the static guard's
  limited proof (BR-18).

## API contracts
All routes: `Authorization: Bearer <ID token>`; handlers thin (bearer extraction, strict
key allow-list, then a server operation with injectable deps); JSON; errors `{ "error":
<code> }`.

| Method & path | Request | Success | Errors |
|---|---|---|---|
| `GET /api/me/skills` | — | `200 { skills: [{treeId, name, level}], truncated, profile }` | `401 unauthenticated`; `500 persistence_failed` (catalog or profile read failed) |
| `PUT /api/me/skills/[treeId]` | `{level: 1..4}` exactly | `200 { level }` | `400 invalid_request`/`invalid_input`; `401`; `404 skill_unavailable`; `409 profile_unreadable`; `500 persistence_failed` |
| `DELETE /api/me/skills/[treeId]` | none | `200 { level: null }` | `401`; `404 skill_unavailable` (malformed id only); `409 profile_unreadable`; `500` |
| `DELETE /api/me/skills` | none | `200 { ok: true }` | `401`; `500` |

No other method is routed on these paths. No admin route exists. A browser gateway
(`src/features/skill-profiles/client/`) wraps these calls; the browser never touches
Firestore.

## Edge cases and failure behavior
- Two tabs, same skill area: last write wins; the other tab shows its last confirmed value
  until reload — accepted (BR-16).
- Stored level `0`, `5`, `"3"`, `2.5`, `null`: entry ignored (BR-9).
- `levels` holds many keys for unavailable or hidden areas: ignored on read; bounded by
  the document size; `DELETE /api/me/skills` clears.
- `PUT` for a tree that became invalid between page load and save: `404`, row error, one
  catalog refetch (BR-30).
- Network failure mid-save: row reverts and offers retry; the UI never claims success
  without a `200`.
- Token expiry during editing: `401` → sign-in prompt; no data from the previous user
  remains rendered after identity change (same generation handling as existing auth-gated
  pages).
- User with no team memberships: fully functional.
- Profile with an invalid `createdAt`/`updatedAt` but valid `levels`: readable; repaired
  by the next write (BR-10).
- Profile with unknown top-level fields: readable; fields preserved by normal writes,
  removed by erase-all (BR-10, BR-14).
- More than 500 raw tree documents: BR-11. In particular: an invalid document inside the
  window consumes a slot (fewer visible trees, no refill); an invalid 501st document still
  yields `truncated: true` with the notice saying only that the list *may* be incomplete; a
  valid tree beyond the window is unlisted but writable through `PUT` with its known id.

## Architecture decisions
- **New slice `src/features/skill-profiles/`**: `domain/` (level type + guard + canonical
  scale, record guard, row/overview derivation, sort), `server/` (store seam over
  `skillProfiles/{uid}` mirroring `UserProfileStore`; `getOwnSkills`, `setOwnSkillLevel`,
  `clearOwnSkillLevel`, `deleteOwnSkillProfile`; a bounded catalog read), `client/`
  (gateway), `components/`, `copy.ts`. Thin routes `app/api/me/skills/**` and
  `app/me/skills/page.tsx`.
- **Dependency direction:** `skill-profiles → skill-trees (isValidSkillTree and the
  catalog read) / auth`. Never `skill-trees|teams|roadmap|profiles → skill-profiles`. The
  catalog read may be extracted from `listSkillTrees` only as a behaviour-preserving
  refactor with the admin tests unchanged, or duplicated minimally; `/split-tasks`
  decides, but `listSkillTrees`' authorization must not move.
- **Server-only persistence** via the Admin SDK `getFirestoreDb`; `server-only` imports;
  no client SDK.
- **Writes** in a Firestore transaction with a per-key merge (nested merge-set or
  `FieldPath`); never replacing the `levels` map or document from client state.
- **State:** server state in the page component (one load, per-row mutation state); no
  global store.
- **Intentional differences from F0/A/B:** (a) no team scope, no `authorizeTeamAccess`, no
  `canEdit`, no lead/admin read path — authorization is identity ⇒ own data only; (b)
  writes apply the server's response rather than a full refetch (single-owner, per-row);
  (c) a bounded catalog join on read, unlike `userProfiles`; (d) no audit actor is stored
  (always the owner); (e) document id *is* the uid (as `userProfiles`), acceptable because
  no list/lookup exists; (f) the guard states what it does *not* prove, per the TASK-012
  lesson.

## Infrastructure impact
| Area | Impact |
|---|---|
| New collection | `skillProfiles` (server-only) |
| `firestore.rules` | **explicit deny-only block added** (behavior-neutral; BR-36) |
| Deployment-config test | matching pin + "no composite index" assertion (BR-36) |
| `firestore.indexes.json` | none (`get` by id; existing single-field `skillTrees` ordering) |
| Migration / backfill | none |
| New dependency | none |
| Demo Team | none |
| Env/config | none |
| Deploy | rules deploy is a separate explicit step, not performed by implementation; no Firebase action in planning |

## Performance and read strategy
Per page load: 1 `get` (small at current product scale; size bounded by the number of valid trees, BR-6) + 1 catalog query (≤ 501 small documents,
bounded by precedent) + `verifyIdToken`; no membership reads, no fan-out, no N+1. Per
edit: 1 transaction (≤2 reads, 1 write). Filtering, counts and sorting of the loaded list
are client-side/pure (server orders the response). The 500 bound is inherited from the
existing catalog read (BR-11), not a new product cap.

## Test boundaries
| Boundary | Covers |
|---|---|
| Domain: canonical scale module (levels 1–4 only, `isSelfAssessedLevel` rejects `0`/`5`/`"3"`/`2.5`/`null`, canonical meanings documented, level 4 not tied to mentoring), record guard (entry and container leniency, timestamp tolerance), sort/derivation (visible counts, no mean/percentage) | BR-4, BR-7, BR-9, BR-10, BR-22, BR-26 |
| Server operations with injected fakes: `getOwnSkills`, `setOwnSkillLevel`, `clearOwnSkillLevel`, `deleteOwnSkillProfile` — catalog DTO minimality (no nodes), hidden entries retained and not counted, `PUT` direct target-tree validation independent of truncation, `GET` performs no write (no repair, no creation), `DELETE`-one that removes a key sets `updatedAt` and repairs `createdAt` while an absent-key `DELETE` writes nothing, `DELETE` bodies ignored, `404 skill_unavailable`, `DELETE`-one idempotency incl. stale/hidden entries, `DELETE`-all physical deletion incl. unknown fields, malformed entry, `levels` unreadable → `409` + recovery, invalid timestamps tolerated and repaired on write, unknown top-level fields preserved by per-key writes, other keys preserved under concurrent per-key writes | BR-3, BR-6, BR-8–BR-16, BR-20, BR-33 |
| **Catalog window (distinguishes the real algorithm from "500 oldest valid")**, with a fake reader returning raw documents ordered as Firestore would: (a) a window of 500 raw documents containing k invalid ones → exactly 500−k visible trees, and a valid 501st document is **not** pulled in (one reader call with limit 501, no refill); (b) 501 raw documents whose 501st is invalid → `truncated: true` and every valid tree visible; (c) 501 valid documents → 500 visible, the 501st (latest) absent, `truncated: true`; (d) exactly 500 raw documents → `truncated: false`; (e) equal `createdAt` values follow the reader's document-id order and presentation sorting does not change window membership; (f) a valid tree beyond the window is absent from `GET` yet `PUT` with its id succeeds; (g) entries for unlisted trees are retained, not counted; (h) component: the truncated notice says the list *may* be incomplete and never claims areas are missing. Asserting only "length ≤ 500" or "`truncated` is true" is insufficient | BR-3, BR-8, BR-9, BR-11, BR-26, BR-30 |
| Route handlers (`app/api/me/skills/**/route.test.ts`): auth, strict bodies, status mapping, response allow-lists, no subject in path/query/body, no `emailVerified` requirement, no extra methods, `DELETE` ignores any body | BR-12–BR-15, BR-17, BR-20, API table |
| Owner isolation and negative authorization: no token, invalid token, ordinary user, team lead, app admin — none can reach another person's data (no such parameter/endpoint); team membership irrelevant | BR-17, BR-18 |
| **Static privacy/scope guard** (style of `roadmap-scope-guard.test.ts`; claims only what BR-18 says it proves): approved reference set for `skillProfiles` under `src/`/`app/`; module-import allow-list for the `skill-profiles` server/store modules (a fixture import from an unapproved route/module must fail the guard); persisted key-set exhaustiveness (`levels`, `createdAt`, `updatedAt`); no import of team-authorization, `skillProgress`, roadmap, membership code from skill-profiles sources; no `app/api/admin|teams/**` reference; route-method surface; anti-surveillance token scan of `copy.ts` | BR-6, BR-18–BR-24 |
| Firestore config guard (`firestore-deployment-config.test.ts`): explicit `skillProfiles` deny-only block precedes the catch-all; no composite index for `skillProfiles`; indexes file otherwise unchanged | BR-36 |
| Independence: writing a level leaves `skillProgress`/`roadmapItems`/`teamMemberships` fakes untouched, and vice versa | BR-23, BR-24 |
| Component/user behavior (`/me/skills`): states table, save/revert/row serialization, filter, reset-all confirmation, unreadable profile, truncated notice and visible-only counts, 401 handling, no team text, no score/percentage/rank wording, keyboard operation, labels, text-plus-segment indicator, level descriptions, no chart | BR-1, BR-5, BR-25–BR-32 |
| Header: link visible only when signed in, `aria-current`; no other new entries | BR-2 |
| C1/C2 boundary: no `teamSkillNeeds`, matrix, aggregate endpoint, threshold configuration, sharing flag or history field exists | C1/C2 boundary, BR-19 |
| Regression: Feature A/B and admin skill behavior unchanged (`listSkillTrees` authorization, `skillProgress`, roadmap tests untouched) | BR-3, BR-23, BR-24 |

## Acceptance criteria
- [ ] **Owner-only read:** `GET /api/me/skills` returns only the verified caller's levels (BR-8, BR-17).
- [ ] **Owner-only mutation:** `PUT`/`DELETE` change only the verified caller's profile; no uid/team/role input exists (BR-12–BR-17).
- [ ] **Ordinary-user negative:** no endpoint or parameter lets one user read or write another user's profile (BR-18).
- [ ] **Team-lead negative:** a team lead gains no access to anyone else's profile and no behavior differs for them (BR-18).
- [ ] **App-admin negative:** an app admin gains no product access to anyone else's profile; no admin endpoint or admin-gated path references the collection (BR-18).
- [ ] **Canonical scale:** levels are exactly `1–4` with the canonical meanings in BR-4 defined in one domain module, independent of labels; any other value is rejected on write and ignored on read (BR-4, BR-9, BR-15).
- [ ] **Level 4 not mentoring-defined:** no copy, validation or UI requires mentoring ability for level 4; "guiding others" appears only as an example (BR-4).
- [ ] **Ordinal only:** no mean, sum, percentage or single figure over levels is computed or shown (BR-22, BR-26).
- [ ] **No history:** only `{levels, createdAt, updatedAt}` is persisted; no per-skill timestamp or previous value exists (BR-6, BR-33).
- [ ] **No sharing:** no sharing/consent flag, endpoint, control or copy exists (BR-19).
- [ ] **No comparison/ranking/scoring:** no rank, score, badge, streak, comparison or evaluative wording anywhere (BR-22).
- [ ] **Minimal catalog DTO:** each listed skill carries only `treeId`, `name`, `level`; never nodes/stage labels/audit fields/timestamps; `listSkillTrees` unchanged (BR-3, BR-20).
- [ ] **Catalog read:** `orderBy(createdAt asc).limit(501)`, no `where`, no new index; the visible set is the valid trees among the first 500 raw documents ordered by `createdAt` ascending (not "the 500 oldest valid trees"), presented sorted by name; no refill query (BR-11).
- [ ] **Truncation behavior:** `truncated` is true iff more than 500 raw documents exist; only the visible set is returned; the UI shows a conservative "may be incomplete" notice (never a claim that areas are missing) and visible-only counts; 500 is not presented as a product limit (BR-11, BR-26).
- [ ] **Invalid document inside the window:** it consumes its slot, yields fewer visible valid trees, and no refill query occurs (BR-11).
- [ ] **Invalid 501st document:** with 501 raw documents and an invalid 501st, `truncated` is `true` even if every valid tree is visible, and the UI says only that the list may be incomplete (BR-11).
- [ ] **Valid tree beyond the window:** it is absent from the catalog UI, yet `PUT` with its known valid `treeId` validates the target directly and may write; absence from the catalog is never used as proof of nonexistence (BR-11, BR-12).
- [ ] **No unsafe absence inference:** nothing treats absence from the catalog response as proof a tree is invalid; hidden entries stay stored, are not repaired or counted (BR-9, BR-11).
- [ ] **PUT validates the target directly:** `PUT` reads `skillTrees/{treeId}` itself and succeeds for a valid tree beyond the bound (BR-12, BR-11).
- [ ] **PUT not-found:** an unavailable, non-existent or malformed `treeId` yields `404 skill_unavailable` and writes nothing (BR-15).
- [ ] **DELETE-one:** idempotent; works for stale/hidden entries; absent key/document writes nothing; removing an existing key preserves other keys and unknown fields, sets `updatedAt` and repairs `createdAt`; `409` on an unreadable document; any request body is ignored (BR-13, BR-15).
- [ ] **DELETE-all:** physically deletes the whole document including timestamps and unknown fields; idempotent; recovers an unreadable profile; UI asks for confirmation (BR-14, BR-30).
- [ ] **Malformed entry:** an invalid entry is ignored, never repaired by `GET`, and overwritten only by a valid `PUT` (BR-9).
- [ ] **Malformed timestamps:** invalid/missing timestamps do not make valid `levels` unreadable; the next write sets `updatedAt` and repairs `createdAt` (BR-10).
- [ ] **Unreadable container:** a non-object `levels` yields `profile: "unreadable"`, disabled edits, `409` on single-skill writes, and no overwrite (BR-10).
- [ ] **Unknown top-level fields:** never in any DTO; preserved by per-key writes; removed by DELETE-all (BR-10, BR-14).
- [ ] **Per-key preservation:** updating or deleting one skill never overwrites unrelated assessment keys (BR-12, BR-13, BR-16).
- [ ] **GET purity:** `GET` performs no persistence write, repair or document creation (BR-8, BR-9).
- [ ] **No client Firestore access:** the browser reaches data only through the API; no client SDK usage is added (BR-1, Architecture).
- [ ] **Explicit rules block:** `firestore.rules` has an explicit deny-only `skillProfiles` block before the catch-all, granting nothing (BR-36).
- [ ] **Deployment/config test:** `firestore-deployment-config.test.ts` pins that block and asserts no `skillProfiles` composite index; `firestore.indexes.json` is otherwise unchanged (BR-36).
- [ ] **No `skillProgress` coupling:** neither side reads or writes the other (BR-23).
- [ ] **No `roadmapItems` coupling:** roadmap data and ownership are neither read, written nor inferred (BR-24).
- [ ] **No membership/memberRef coupling:** no read or write of `teamMemberships`, `memberRef`, `teams`; works with zero teams (BR-24, Actors).
- [ ] **No Demo seeding:** no Demo Team fixture or seed writes a personal skill profile (BR-35).
- [ ] **No C2 artifacts:** no `teamSkillNeeds`, matrix, gap view, aggregate endpoint or threshold configuration exists, and no C2 aggregate read of `skillProfiles` exists (C1/C2 boundary).
- [ ] **Static guard with truthful boundary:** the guard test exists, enforces the approved collection-reference set, the module-import allow-list and the key set, and its description states what it does not prove (BR-18).
- [ ] **No chart:** the page renders no chart, radar or radial visualization and adds no dependency (BR-29).
- [ ] **Accessible text representation:** every skill and level is available as text with a labelled control; the indicator never conveys level by fill or colour alone; keyboard and screen-reader operable; no horizontal scroll at phone width (BR-27, BR-31, BR-32).
- [ ] **Privacy copy scoped:** the on-page notice states the C1-scoped privacy (BR-5) and no text promises the data can never be used elsewhere (BR-5).
- [ ] **No `emailVerified` requirement:** own-profile skill access succeeds for a valid token regardless of `emailVerified` (BR-17).
- [ ] **Route and navigation:** `/me/skills` exists; the only new navigation is one signed-in "Mine ferdigheter" header link; no `/me` shell, `Mål`, `Samtaler` or placeholder (BR-1, BR-2).
- [ ] **State coverage:** every state in BR-30 is implemented, distinct and Norwegian, keeping other rows usable on a row-level failure (BR-30).
- [ ] **No new index, migration, dependency or env/config** (Infrastructure impact).
- [ ] **Verification (implementation time):** `pnpm typecheck`, `pnpm lint`, `pnpm test` pass and the `git diff` is inspected.

## Documentation impact (at implementation closeout, not now)
`docs/DATA-MODEL.md` (add `SkillProfile`; replace "`skillProfiles/{uid}` … do not exist
yet"), `docs/SECURITY.md` (owner-only invariant per BR-18 + checklist items),
`docs/ARCHITECTURE.md` (section), `docs/UI-UX.md` (Personal skills UX; nav),
`docs/ROADMAP.md` (mark C1), `docs/PRODUCT.md` (delivered entry; Non-goals clarification
per "Policy reconciliation"), a cross-reference from `team-skill-tree/SPEC.md`, and
optional admin naming guidance for SkillTree names (A4). **The ROADMAP D1/D2 naming
inconsistency (finding 7) is reported to the product owner for future roadmap
reconciliation; C1 does not redefine D1/D2.** `AGENTS.md`/`CLAUDE.md` unchanged.

## Product-owner approval items
Status of every item: **approved** (A1–A6, Revision 2).
- **A1** Self-owned, private-in-C1, self-reported, development-oriented, non-evaluative
  skill data is approved as an **explicit narrowing of the historical blanket
  per-person-rating prohibition** (see "Policy reconciliation (A1)"); manager/lead/admin/
  team ratings, ranking, scoring, named comparison and monitoring use stay prohibited.
- **A2** The four-level ordinal personal proficiency scale with the **canonical meanings
  in BR-4** (corrected level 4: deep/advanced proficiency; guiding others is only an
  example), integers 1–4, absence = unassessed; labels are copy and may change without
  migration.
- **A3** Plaintext, current-state `skillProfiles/{uid}` (`levels`, `createdAt`,
  `updatedAt`), no per-skill timestamp, no history (D1/D2 must not reinterpret
  `updatedAt`; adding per-skill timestamps later changes the value shape and needs a
  migration), with the **corrected explicit deny-only rules block** (BR-36).
- **A4** Reuse of SkillTree `treeId` (identity) and `name` (display) as the personal
  skill-area catalog, accepting the permanence/naming/double-coupling trade-offs in
  "SkillTree catalog trade-offs".
- **A5** No chart in C1 (BR-29).
- **A6** `/me/skills` plus one current header link, no `/me` shell; future tab name and a
  future `/me` nav left undecided (BR-2).

## Open questions
None. A1–A6 are confirmations of recommended decisions, not undecided design. C2-owned
questions (consent/opt-in, cohort definition, differencing) are recorded under "Constraints
C2 must honour" and deliberately not resolved here.

## C2 amendment (2026-10-10, Team Skill Needs and Privacy-Thresholded Coverage)
Appended at C2 closeout; the approved C1 text above is not rewritten. C1's behaviour and owner-only
APIs are unchanged, and `/me/skills` remains person-owned and shows no team information.
- **BR-5 notice.** The page notice was amended copy-only (C2 BR-29, `skill-profiles/copy.ts`): it still
  says teammates, team leads and administrators cannot see the levels set, and now also says the person
  may choose, team by team, to let the self-assessment count towards a privacy-protected team overview
  in which the team sees only a coarse status per skill need. The participation control is on the team
  Overview, not here.
- **BR-18 "Future access process" fulfilled for C2 only.** C2 introduced one read-only reader (a batch
  module behind both static-guard allow-lists) under an approved SPEC, a notice change, a security
  review, opt-in participation and a fixed threshold; see `docs/SECURITY.md` invariants 31–36. No lead,
  admin or teammate can read another person's levels, and any other future reader still needs the same
  process.
- **"Constraints C2 must honour" #2 superseded.** The "default 5, configurable 3–20" direction was
  replaced by a fixed `k = 5` (C2 decision P2). Constraints #1, #3–#6 were honoured (opt-in per team,
  per-skill cohort, no `skillProfiles` writes, no persisted coverage, `treeId` identity).
- **Demo.** C2 added no Demo Team personal assessments.
