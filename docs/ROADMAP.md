# DevPulse — Roadmap

- **Phase 0 — Foundation** *(complete)*:
  repository structure, documentation, Claude Code workflow, skills and rules.

- **Phase 1 — Pulse Survey MVP** *(complete)*:
  anonymous pulse survey submission and storage with application-level
  encryption of sensitive response data.
  See `docs/features/pulse-survey/SPEC.md`.

- **Phase 2 — Authentication, Results and Team Management** *(complete)*:
  Firebase Authentication, protected team results, 12-period historical
  trends, Firestore-backed multi-team membership, app-admin team management,
  invitations, access requests, and dynamic survey-team configuration.

  The original Phase 2 static single-team authorization model has been
  superseded by the multi-team Team Management implementation.

  See:
  - `docs/features/results-dashboard/SPEC.md`
  - `docs/features/team-management/SPEC.md`

- **Phase 3 — Product UX, Localization and Application Shell** *(complete)*:
  made the implemented product coherent and usable as a complete
  application before adding new product capabilities.

  Delivered:
  - Norwegian UI throughout the application, sourced from per-feature/
    shared-area copy modules
  - an auth-aware, admin-aware site header/navigation, with admin
    visibility derived only from a server-side own-admin-status read
  - a consistent application shell and shared UI primitives
    (`src/components/ui/`) applied across every existing screen
  - coherent team, results and admin experiences
  - responsive layouts and accessibility improvements
  - consistent loading, empty, success and error states
  - a Recharts-based trend chart for team results, additive to the
    existing accessible trend table
  - a shared client-side auth-gating hook, replacing per-component
    duplication

  This phase did not weaken or redesign any existing authentication,
  authorization, anonymity, aggregation or privacy guarantee.

  See `docs/UI-UX.md` (design direction) and
  `docs/features/product-ux-shell/SPEC.md` (implemented contract).

- **Phase 4 — Managed Surveys & Survey-Based Insights** *(complete)*:
  replaced the implicit, calendar-week-driven survey model with admin-managed
  survey instances, so organizations with different participation needs can
  both be served by the same product.

  Delivered:
  - admin-managed survey instances (create, choose access mode, optional
    availability window, open/close, delete-before-responses or
    archive-after-responses) owned by exactly one team
  - configurable per-survey participation access: **public/link** (anonymous,
    no account) or **authenticated team members** (server-verified identity +
    actual team membership, not merely app-admin status)
  - a generated, opaque `/survey/{surveyId}` URL for every survey, regardless
    of access mode — no separate public/private URL namespaces
  - a race-safe, one-open-survey-per-team invariant, enforced via a
    dedicated `teamSurveyState` coordination document rather than a query
  - authenticated survey participation tracked separately
    (`SurveyParticipation`) from anonymous response content, so
    authorization-for-access never becomes identity-in-response-content
  - team-page "Pågående undersøkelse" discovery, and an admin team-management
    surface for creating/monitoring a team's surveys
  - survey-instance-based results and history, replacing the fixed
    "12 closed calendar periods" trend with a team's actual survey
    occurrences, at whatever cadence each team chooses
  - a per-survey `minimumResponses` threshold (integer in `[3, 20]`, default
    5, immutable after creation), replacing the single global threshold
    constant for the publication decision
  - a documented, non-blocking abuse/duplicate-response threat model for
    public-link participation
  - Home-page and site-navigation cleanup so a signed-in user is never shown
    signed-out-only actions, and the public survey is discovered only via a
    generated survey link, never the generic Home page
  - retirement of the static, always-on `/pulse-survey` page and the
    calendar-period-scoped results aggregation path

  This phase preserved every existing privacy/security invariant
  (anonymity, encryption, minimum response threshold, team isolation,
  admin ≠ raw-response access) under the new model.

  See `docs/features/managed-surveys/SPEC.md`.

- **Phase 5 — Anonymous Challenges** *(complete)*:
  let an actual team member submit a free-text challenge (friction, problem,
  or improvement suggestion) for that team, with no submitter identity ever
  persisted or recoverable, and gave an app admin a minimal, one-way
  resolve/archive/delete lifecycle so a team's challenge list stays usable
  over time.

  Delivered:
  - authenticated, real-team-membership-only challenge submission
    (app-admin status alone is not sufficient) — no public/anonymous-link
    submission mode
  - server-side application-level encryption of challenge text at rest,
    reusing the same encryption boundary as survey responses
  - a `challenges` document containing no submitter identity field of any
    kind, and no participation-tracking collection at all (no dedup
    requirement to enforce, unlike `SurveyParticipation`)
  - two separate, purpose-built read operations — `listTeamChallengesForMember`
    (`open`/`resolved` only, backing the team page) and
    `listTeamChallengesForAdmin` (`open`/`resolved`/`archived`, backing
    admin management) — so archived-challenge visibility is enforced
    server-side, never by client-side filtering
  - `/teams/[teamId]`'s "Meld en utfordring" submission panel and read-only
    challenge list, and `/admin/teams/[teamId]`'s "Utfordringer" management
    section (resolve/archive/delete, delete behind explicit confirmation)
  - a deliberately different anonymity shape from survey responses: a
    challenge's *content* is individually visible to any authorized team
    member/admin (the point of the feature), while *submitter identity* is
    never persisted or recoverable — narrower than, not weaker than, the
    survey-response guarantee
  - no rate limiting, pagination, categories/tags, comments/voting/
    reactions, or AI classification (explicit v1 non-goals)

  This phase preserved every existing privacy/security invariant
  (server-side authorization, team isolation, application-level encryption,
  no client-side Firestore access, admin ≠ raw-identity access) and applied
  it correctly to a feature where content is deliberately visible while the
  submitter is not.

  See `docs/features/anonymous-challenges/SPEC.md`.

- **Phase 6 — Developer Forum Capabilities** *(complete, v1 slice)*:
  let a real team member start a titled, team-scoped discussion thread and
  reply to one, with ordinary (not anonymous) attribution, and gave a
  thread/reply's own author or an app admin a minimal way to remove it.

  Delivered:
  - authenticated, real-team-membership-only thread/reply creation
    (app-admin status alone is not sufficient) — the same BR-1 posture as
    Anonymous Challenges, applied to a feature where content is deliberately
    attributed rather than anonymous
  - a pseudonymous, per-team `authorTag` attribution mechanism
    (`uppercase(hex(SHA-256(teamId:authorUid)).slice(0, 6))`) — a reader can
    recognize "the same person wrote these two posts" without learning that
    person's real name, email, or `uid`; no Firebase Auth lookup or
    persisted display field is involved
  - server-side application-level encryption of thread/reply content at
    rest, reusing the same encryption boundary as survey responses and
    challenges
  - genuine hard deletion: deleting a thread removes the thread document
    and every one of its reply documents from Firestore (with a
    looped, multi-batch cascade for threads with more than 500 replies),
    not a soft-delete; deleting a single reply content-erases it into a
    terminal tombstone (encrypted/identity fields physically removed,
    only its position/timestamp retained) so it is never decryptable again
  - a 500-reply-per-thread creation-time capacity limit, guaranteeing a
    thread's reply list is always returned in full, with no reply that
    becomes unreachable to read or delete
  - `/teams/[teamId]`'s new "Forum" section (thread list + creation form)
    and a new `/teams/[teamId]/forum/[threadId]` detail view (replies,
    reply form, delete affordances) — content rendered strictly as literal
    text everywhere, with a runtime regression proving HTML/script-shaped
    input never executes
  - no edit, no restore/undelete, no reactions/voting/tags/mentions/
    notifications/search, and no rate limiting (explicit v1 non-goals,
    mirroring Anonymous Challenges' equivalent choices)
  - a cross-team/org-wide "developer forum" and real-name attribution both
    remain unimplemented future scope — this v1 slice is deliberately
    team-scoped only, per its own feature-id note

  This phase preserved every existing privacy/security invariant
  (server-side authorization, team isolation, application-level encryption,
  no client-side Firestore access, admin ≠ raw-identity access) while
  introducing this codebase's first feature where persisted, member-visible
  author attribution is the deliberate point rather than a near-miss to
  avoid.

  See `docs/features/team-forum/SPEC.md`.

- **Phase 7 — Skill / Capability Trees** *(complete, v1 slice)*: let an app
  admin define a named, ordered capability-maturity progression (a
  **SkillTree**) once and track which stage a specific team has reached
  against it — team-level data only, never a person's.

  Delivered:
  - `createSkillTree`/`updateSkillTree`/`listSkillTrees`
    (`skillTrees/{treeId}`, app-admin-only): create a 2-20-stage tree;
    cosmetically correct an existing tree's name/stage-label text with its
    stage count, order, and every stage's `nodeId` permanently immutable —
    no structural editing or deletion exists; list the catalog bounded to
    the 500 oldest-created
  - `startTeamSkillTracking`/`updateTeamSkillProgress`/
    `stopTeamSkillTracking` (`skillProgress/{teamId}__{treeId}`,
    app-admin-only): start tracking a tree for a team (rejected for a
    `disabled` team — the one skill-tracking write gated on team status);
    set/advance a tracked tree's current stage to any stage, forward or
    backward; stop tracking, which hard-deletes the record with no
    tombstone — updating or stopping an already-tracked pair remains
    available regardless of team status, and a later restart always begins
    again at "not started," with no history retained anywhere
  - `getTeamSkillProgress`: a real team member or admin can read their own
    team's full tracked-skill state; a caller authorized for one team can
    never obtain another's via any team id it supplies; viewing a disabled
    team's existing progress remains available
  - `/admin/skills` (tree creation/correction/catalog) and
    `/admin/teams/[teamId]`'s per-team tracking section (start/set-stage/
    stop, with the start picker hidden for a disabled team) — both
    app-admin-only; `/teams/[teamId]`'s read-only section for an authorized
    member/admin, rendered as a semantic ordered list with the current
    stage marked by both text and `aria-current`, never color alone
  - every write is app-admin-only in v1 — a deliberate scope-minimization
    decision, not one this feature's individual-data non-goal itself
    requires; no comment/voting/reaction/ranking/leaderboard feature, no
    progress history, and no section-scoped or org-wide (multi-team) trees
    exist
  - `skillTrees`/`skillProgress` are org-wide/team-scoped reference data,
    not encrypted, matching this codebase's existing posture for similarly
    short, structured, admin-authored text such as `teams.name`

  This phase preserved every existing privacy/security invariant
  (server-side authorization, team isolation, no client-side Firestore
  access, admin ≠ raw-identity access) while introducing this codebase's
  first feature with a genuinely immutable-by-default persisted structure
  (a tree's stage identity) alongside a narrowly-scoped, explicitly
  approved cosmetic-correction exception to it.

  See `docs/features/team-skill-tree/SPEC.md`.

- **Phase 8 — Member Skill Progress Self-Report** *(complete, v1 slice)*:
  let a real team member set their own team's current stage on any
  SkillTree the team is already tracking, without needing an app admin to
  do it for them.

  Delivered:
  - `reportTeamSkillProgress` (`skillProgress/{teamId}__{treeId}`): a
    **second, additive** write path alongside Phase 7's unchanged
    `updateTeamSkillProgress` — a caller with a genuine, fresh-read
    `teamMemberships/{uid}__{teamId}` record for the requested team may set
    that team's `currentNodeId` for a tree it already tracks, forward or
    backward, identical to the admin contract. App-admin status alone,
    without a real membership record, is never sufficient. A member cannot
    start/stop tracking or define/correct a tree — self-report only ever
    updates the stage of an already-tracked tree.
  - Unlike `updateTeamSkillProgress`, `reportTeamSkillProgress` **is**
    gated on the owning team's `active` status (`team_disabled` otherwise)
    — matching this codebase's established pattern for every other
    member-originated write (`submitChallenge`, `createThread`,
    `createReply`), not Phase 7's admin-only creation-vs-management split.
  - `PATCH /api/teams/[teamId]/skills/[treeId]` (new route, member-facing,
    distinct from the unchanged admin route) and an extension to
    `/teams/[teamId]`'s existing read-only Kompetanseområder section: each
    already-tracked tree gains a stage-setting control, rendered for any
    authorized viewer (member or admin) with the server remaining the sole
    authority; a successful report re-fetches through the existing
    `getTeamSkillProgress` read path rather than an optimistic local
    update.
  - No visible attribution (`updatedBy` remains internal-only bookkeeping,
    never returned by any API response, identical in shape whether an
    admin or a member wrote it last); no per-team/per-tree opt-in toggle;
    no new Firestore collection, field, or index — the identical
    `skillProgress` document shape from Phase 7 is reused unchanged.
    `/admin/skills` and `/admin/teams/[teamId]`'s tracking controls are
    byte-for-byte unmodified.

  This phase preserved every existing privacy/security invariant
  (server-side authorization, team isolation, no client-side Firestore
  access, admin ≠ raw-identity access) while adding this codebase's first
  second-writer-class extension to an existing team-level record, resolving
  the gap Phase 7's own "Open questions" #1 had flagged.

  See `docs/features/skill-progress-self-report/SPEC.md`.

Phases 0–8 are complete. See `docs/PRODUCT.md` for the product vision and
non-goals.