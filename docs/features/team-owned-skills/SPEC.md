# Team-Owned Skills — Specification

Status: **Approved** (owner decision, Option A — "Team-Owned Skill Definitions"). Implementation may proceed under this
document without a further routine approval. Amends the global-only skill identity contract documented in
`docs/DATA-MODEL.md`, `docs/ARCHITECTURE.md` and `docs/SECURITY.md` (see "Documentation amendments").

## 1. Purpose

Each team owns its own skill definitions (for example frontend: React, TypeScript; DevOps: Kubernetes, Terraform).
Team administrators create, edit, deactivate and reactivate them. Members assess themselves against their team's skills
on the existing four-level scale. Two teams may define skills with identical names; they share no identity, criteria,
assessments or aggregates.

The existing global `skillTrees` catalog stays supported unchanged. Nothing is deleted, rewritten or auto-mapped.

## 2. Storage decision

Two candidate designs were compared before implementation. A third shape, a map per person keyed by skill id, was
evaluated during implementation and rejected (see the last row).

| Criterion | (1) Namespaced keys in `skillProfiles/{uid}.levels` | (2) Separate team-scoped rating storage (**chosen**: one document per person and team skill) |
| --- | --- | --- |
| Existing readers | `skillProfiles` is read by C1 owner APIs, C2 `readSkillLevelsBatch` (identity-stripped), role comparison and erasure I-1. Every reader would need to understand a second key space. | No existing reader changes. Global ratings and their documents stay byte-for-byte unchanged. |
| Key safety | A composite key such as `team:{teamId}:{skillId}` may contain `:`, `.` or `__`. Field paths treat `.` as a separator, so field-path safety would have to be proven for every writer. | The document id is `{uid}__{skillId}`, with a team skill id restricted to `[A-Za-z0-9]{1,64}`. No dynamic field path or map key is built at all. |
| Team scope | Implicit: one person document mixes all teams. | Explicit: each rating carries `teamId`; a member query reads only the caller's ratings in one team. |
| Erasure | I-1 deletes the whole `skillProfiles` document, so new keys are covered for free, but the sweep would miscount them. | New row I-19, located by the stored `uid` field (`uidField`). |
| Migration | None needed for reads, but a risk of accidental rewrite of existing documents. | None. Additive collection. |
| Erasure guard | Not applicable. | No dynamic key, so no new exception to the reviewed erasure guard (see the rejected shape below). |
| Concurrency | Per-key merges inside one person document. | Each rating is its own document. Two skills never contend. |
| Aggregate cost | One read per eligible person. | One equality query per active skill, bounded by the number of ratings that exist. |

**Rejected during implementation: a map per person, `teamSkillProfiles/{uid}__{teamId}.levels[skillId]`.** It is closer to
C1, but it needs a dynamic map key and a dynamic `FieldPath` in the transaction. The erasure inventory guard admits dynamic
keys only for its reviewed C1 shapes, and its tripwire tests pin that exception to exactly one shape. Adding team-skill
shapes would have meant changing that reviewed control, which was not approved. Document-per-rating needs no such exception.

**Choice: (2), one document per person and team skill.** It is the smallest design that cannot disturb existing ratings,
keeps the team scope explicit and needs no change to the reviewed erasure guard.

## 3. Data model

### 3.1 `teamSkills/{skillId}` — team-owned definition (server-only)

| Field | Type | Rule |
| --- | --- | --- |
| `teamId` | string | Owning team. Never changes. |
| `name` | string | Trimmed, 2–80 characters. Not an identity. |
| `description` | string | Trimmed, 0–500 characters (may be empty). |
| `category` | string \| null | Optional, trimmed, 1–60 characters. |
| `guidance` | `{ "1"?, "2"?, "3"?, "4"? }` of string \| null | Rating guidance per existing level. Each value trimmed, at most 300 characters; absent or null = no guidance for that level. |
| `criteriaVersion` | integer ≥ 1 | Incremented when `guidance` changes (see §5). |
| `active` | boolean | `false` = not offered for new assessments. |
| `sortOrder` | integer 0–9999 | Display order within the team. |
| `createdAt`, `updatedAt` | Date | |
| `createdBy`, `updatedBy` | string \| null | Acting admin uid. Audit only; never returned by any API; erased by A-17. |

`skillId` is the Firestore-generated document id, validated to `[A-Za-z0-9]{1,64}`. It is the stable identity. Names are
never identifiers. Limit: 100 team skills per team (active and inactive together).

### 3.2 `teamSkillAssessments/{uid}__{skillId}` — a person's private rating of one team skill (owner-only)

| Field | Type | Rule |
| --- | --- | --- |
| `uid` | string | The rated person. Ownership evidence; located by the erasure sweep (I-19). |
| `teamId` | string | The team of the skill. Stored for the member-scoped own-ratings query. |
| `skillId` | string | The team skill id, `[A-Za-z0-9]{1,64}`. Must equal the document id suffix. |
| `level` | integer 1–4 | The existing four-level scale. Absence of a document means unassessed. |
| `criteriaVersion` | integer ≥ 1 | Guidance version the rating was given under (SPEC §5). |
| `createdAt`, `updatedAt` | Date | `createdAt` is kept when the rating is changed. |

- One document per (person, team skill). Ratings are never stored in a map keyed by skill id (see §2).
- Readability is fail closed: any document with a missing, extra or out-of-range field is unreadable. An unreadable rating
  blocks writes to that rating and fails aggregates. Nothing is repaired by a read or a write.
- Writes replace the single rating document. Two different skills never contend for the same document.
- Server-only via the Firebase Admin SDK. `firestore.rules` denies client access.

## 4. Authorization

| Action | Who | Team status |
| --- | --- | --- |
| List team skills (definitions only, with `canEdit`) | Any genuine member, or a superadmin | Active |
| Create, edit, reorder, activate, deactivate, reactivate | Superadmin or genuine `teamadmin` (`canAdministerTeam`) | Active |
| Read or set **own** assessment of a team skill | Genuine member (role `member` or `teamadmin`) of the team | Active |
| Read individual assessments of other people | **Nobody** (no API exists) | — |
| Aggregate team view (§6) | Any genuine member of the team | Active |

- Team administration never grants access to private assessments. The admin list response contains definitions only.
- App-admin status is not a member right. Writes re-check authority and team status **inside** the write transaction.
- The client never supplies `uid`, `teamId` authority, role or ownership. Those come from the verified token and server reads.

## 5. Criteria versioning and history safety

- Assessments are never re-interpreted silently. Each rating carries the `criteriaVersion` it was given under.
- Changing `guidance` increments `criteriaVersion`. Name, description, category, order and active state do not.
- The person's view flags a rating as **"gjelder eldre kriterier"** when its version is below the current version. The
  rating is kept, shown and never discarded; the person chooses whether to re-assess.
- Previous guidance text is not retained in this increment. This is a documented limitation (§9).
- Deactivation keeps every assessment. Deactivated skills appear in a read-only "Inaktive" group for the person.
- Reactivation restores assessment as normal.

## 6. Team sharing and aggregation

> **Status: IMPLEMENTED (owner-approved consumer of the C2 membership scan).** Implemented in
> `src/features/team-owned-skills/server/get-team-owned-skill-aggregate.ts` with the reader
> `read-team-skill-ratings-batch.ts`, exposed at `GET /api/teams/[teamId]/team-skills/aggregate` and shown to members on
> the Kompetanser tab. The C2 guard names this module exactly: `listMembershipsForCoverage`, `isEffectiveSkillContribution`
> and the `skill-contribution-store` import (`team-skills-scope-guard.test.ts`, `participation-boundary.test.ts`). No other
> module is added. The C2 coverage, team-level thresholds and global skill reads are unchanged.

- The existing team-level opt-in (`teamMemberships.skillContribution`, effective notice version) is the only sharing
  switch. It is not changed. A person who has not opted in is never counted.
- A new aggregate view returns, per **active** team skill, one of:
  - `value` with the derived integer level, when at least `SKILL_COVERAGE_MIN_CONTRIBUTORS` (fixed at 3 by the owner's unified team competence decision,
    2026-11-11; previously 5) eligible contributors have
    a rating at the **current** `criteriaVersion`;
  - `insufficient_data` otherwise.
- Contributors below the current criteria version are excluded from the aggregate, so ratings with different meanings
  are never mixed.
- No count, uid, per-person value or contributor number is returned. The derivation reuses `deriveTeamLevel`.
- Deactivated skills are excluded from the aggregate but keep their stored data.
- The existing C2 coverage and team-level endpoints, their thresholds and their reads are not changed.

## 7. Account erasure

- **I-19** `teamSkillAssessments`: DELETE, located by the stored `uid` field (`uidField`), one document per rating.
- **A-17** `teamSkills`: ANONYMIZE `createdBy`, `updatedBy`.
- The erasure personal-data step deletes the uid's `teamSkillAssessments` documents in batches, idempotently.

## 8. Backward compatibility

- Global `skillTrees`, `skillProfiles`, `teamSkillNeeds`, `teamCompetenceAreas`, roadmap, progress and erasure rows keep
  their behaviour. Nothing is migrated.
- Personal UI shows existing global skills as before, in a separately labelled section ("Organisasjonens kompetanser").
  Team-owned skills appear in a per-team section with the team name. Two identical names are never merged.

## 9. Limitations (accepted for this increment)

- Previous guidance text is not kept after an edit; only the version number records that criteria changed.
- No import of global skills into team skills, and no automatic mapping of names.
- Team-owned skills are not used by role-expectation comparison or the team skill-needs matrix. Those stay global.

## 10. Documentation amendments

- `docs/DATA-MODEL.md`: adds `teamSkills` and `teamSkillAssessments` rows and the stated identity rule.
- `docs/ARCHITECTURE.md`: states that team-owned skill identity is additive to the global SkillTree catalog.
- `docs/SECURITY.md`: adds invariants for team-owned skill administration and private team assessments.

## 11. Non-goals

- No deletion of skills or assessments. No hard delete path exists.
- No change to global catalog ownership, C2 thresholds or sharing notice versions.
- No new dependency, chart library or composite index.

## 12. Unified team competence (owner decision 2026-11-11)

Status: **implemented in part** (see `docs/features/team-owned-skills/TASKS.md`, TASK-008 to TASK-010).

- **One catalog.** `teamSkills` is the only team competence area catalog. Both profiles reference its skill ids. No
  legacy catalog, name matching or automatic merge is used.
- **Automatic profile.** Served by `GET /api/teams/[teamId]/team-skills/aggregate` (§6), threshold
  `SKILL_COVERAGE_MIN_CONTRIBUTORS` = 3. It is the only automatic team source. Suppressed skills are not plotted as zero.
- **Collaborative profile (manual).** `teamManualAssessments/{teamId}__{skillId}`: one agreed level 1–4 per active team
  skill, an optional note (≤300 characters), `criteriaVersion` (the skill's version when entered), `updatedAt` and
  `updatedBy` (audit only). Written by a team administrator of an active team (`requireTeamAdministratorWith`). Read by
  any genuine member or administrator: `GET /api/teams/[teamId]/team-skills/manual`. Responses never contain `updatedBy`.
  Individual self-assessments are never read or changed by this path. A guidance change marks an entry as outdated but
  keeps it. No k-threshold applies (directly entered team-level value).
- **Erasure.** A-19 (`updatedBy`, ANONYMIZE, `actor_audit`). The agreed level and note are team-level values and are kept.
- **Navigation.** One Teamkompetanse tab (`/teams/[teamId]/competence`) holds the catalog administration, the mode switch
  (Automatisk profil / Felles vurdering), the radar and the readable list. `/teams/[teamId]/skills` redirects there and
  the duplicate "Kompetanser" tab is removed. Kompetanseplan stays a separate tab.
- **Retired UI.** The categorical C2 coverage view, the collaborative profile component tree, the profile-mode settings
  control and the team-level status panel are no longer rendered. Their server routes and stores still exist (see §13).

## 13. Open items (not yet implemented)

- **Competence Plan independence.** Plan validation still requires an assignment in the retired `teamCompetenceAreas`
  catalog (`src/features/team-competence-plan/server/competence-plans.ts`). It must be decoupled before that catalog is
  removed, and existing `teamCompetencePlans` documents keep their content.
- **Server retirement.** `teamCompetenceAreas`, `teamProfileSettings`, `teamCollaborativeLevels`, `skill-levels`,
  `skill-coverage` and `skill-needs` routes and their stores remain callable but have no UI.
- **Legacy data cleanup.** Not performed. A dry-run script is still to be written; nothing has been deleted in Firestore.
