# DevPulse — Security & Privacy Invariants

DevPulse processes potentially sensitive employee wellbeing information.
These invariants are project-wide and must hold before any related feature
is considered done.

## Invariants

1. Sensitive survey responses must never be stored as plaintext in Firestore.
2. Firebase encryption-at-rest is not sufficient by itself for sensitive
   survey payloads.
3. DevPulse uses application-level encryption for sensitive fields.
4. Sensitive encryption/decryption happens server-side only.
5. Encryption keys must never: be exposed to the browser, be stored in
   Firestore, be committed to git, or be written to normal application logs.
6. Anonymous survey responses must not directly contain: `userId`, `email`,
   `employeeId`, or `displayName`.
7. Authentication/participation records and anonymous response data are
   stored separately.
8. Team authorization is enforced server-side.
9. A user authorized for Team A must not automatically gain access to Team
   B's private results.
10. Individual wellbeing scores are never displayed as individual employee
    data.
11. Aggregated results support a configurable minimum response threshold.
12. The minimum response threshold is configured per survey instance
    (`minimumResponses`, an integer in `[3, 20]`, default **5**), set at
    creation and immutable afterward — see
    `docs/features/managed-surveys/SPEC.md` → "Per-survey result
    threshold". A missing or invalid persisted threshold fails closed
    (the survey's results are never published) rather than defaulting to
    5 or any other value.
13. Anonymous free-text challenges/comments are treated as highly sensitive.
14. Survey payloads and sensitive free text must not enter ordinary
    application logs or error-reporting systems.
15. Real employee wellbeing data must never be used as development/test
    fixtures.
16. Data minimization and retention are considered from the beginning of
    each feature, not retrofitted.
17. Admin access does not automatically imply access to raw individual
    responses.
18. Security-sensitive behavior (authorization, encryption, aggregation
    thresholds) has automated tests.
19. Member-visible API responses never contain another member's Firebase
    `uid`, e-mail address, membership document identifier
    (`{uid}__{teamId}`) or audit fields (`grantedBy`, `roleUpdatedBy`), nor
    any value from which a `uid` can be computed. Reason: a Forum
    `authorTag` is the deterministic pseudonym `SHA-256(teamId:authorUid)`, so
    any client that learns a member's `uid` can compute that member's
    `authorTag` and de-anonymise their forum posts. The member-facing team
    roster is therefore an explicit allow-list — `{displayName, isLead,
    isSelf}` per member — built field by field, never from a spread of a
    membership or profile object. Only admin-only contracts may carry a
    `uid`.
20. A client-visible reference to a specific team member (e.g. a roadmap
    owner, or a future mentor or check-in participant) must not be a Firebase
    `uid` or be derived from one. It must be an opaque, team-scoped
    reference that is resolved server-side, never treated as authentication
    or authorization evidence (the server re-authorizes on every use), and
    fails closed when the membership ends. The reference now exists as
    `teamMemberships.memberRef` (invariants 23–30, introduced by Team Skill
    Planning); any new feature needing a member handle must reuse it and its
    constraints rather than invent another.
21. A display name (`userProfiles`) is presentation only: never an
    identifier, lookup key, uniqueness key or authorization input, never
    derived from or falling back to an e-mail address, and always rendered
    as inert text. Profile data is readable only by its owner, by same-team
    members (the name only, through the roster) and by app admins (admin
    member list). There is no organisation-wide directory, search, or
    by-`uid` profile read, and `userProfiles` follows the server-only
    Firestore model (client rules deny all). *Development conversations
    amendment (CL-20, 2026-10-21):* a conversation owner's and a participant's
    names are shown to each other only while both hold an active same-team
    membership; this is the roster rule above applied to one team, not a
    directory.
22. A team role (`teamMemberships.role`) is membership metadata, not a
    general RBAC system. It is read fail-safe to least privilege (only
    exactly `"lead"` is a lead; a stored lead is effective only while the
    team is `active`), written only by an app admin through a server-side
    transaction, never client-supplied, and grants no capability unless a
    feature explicitly opts into `resolveTeamRole`. `authorizeTeamAccess`
    continues to treat a lead as an ordinary member. *C2 amendment
    (2026-10-10):* Team Skill Needs (C2) is the first feature to opt in, for
    **exactly one** capability — management of `teamSkillNeeds` (invariant 33).
    It decides this from the genuine membership read in the write
    transaction, not through `resolveTeamRole`, and no other lead capability
    exists.
*TA-SI amendment (2026-11-06):* the stored `lead` role no longer grants any capability (see TA-SI-2, TA-SI-3). The
team editing authority is the `teamadmin` role, granted only by a superadmin (TA-SI-1, TA-SI-2).
23. Roadmap data (`roadmapItems`) is team-scoped and server-only (client
    Firestore rules deny all). Every roadmap operation re-derives
    authorization from the verified identity and fresh state. Reads follow
    `authorizeTeamAccess`; writes require a genuine membership in an `active`
    team, checked in the write transaction. App-admin status or a team lead
    role does not independently grant roadmap write access (a lead is an
    ordinary member for planning). `canEdit` is server-derived and only hides
    controls. A client-supplied team, uid, role, owner or document id is never
    proof, and the deterministic document id is a uniqueness device, not
    authorization.
24. A client-visible member reference (`teamMemberships.memberRef`) is CSPRNG
    output stored on the membership, never derived from `uid`, `teamId` or
    e-mail.
25. A member reference is never authentication or authorization evidence;
    being referenced (e.g. as a roadmap `ownerRef`) grants nothing — no
    access, visibility, lead capability or edit right. *Development
    conversations amendment (CL-23, 2026-10-21; product-owner approved 2026-10-21,
    see the D2 SPEC closeout record):* a participant's access to a development conversation
    requires the full D2-SI-2 predicate: the verified uid, a participation index,
    the authoritative owner document (naming the caller as the accepted
    participant), an active team, a current genuine membership, and a matching
    membership-instance binding (the `memberRef` equals the value bound on the
    owner document). The `memberRef` is only that equality and freshness check.
    It grants nothing alone.
26. A member reference is valid only with its own `teamId`. Unknown, stale,
    malformed, cross-team or ambiguous (duplicate) references fail closed: a
    write is rejected, and a stored owner that no longer resolves is shown as
    unavailable, never guessed. Owner display names are resolved server-side.
27. A removed membership cannot be newly assigned, and its reference is
    destroyed with it; a rejoin receives a fresh reference. No `GET`
    generates or writes a reference: only the grant primitive and the
    admin-only preparation operation (`POST
    /api/admin/teams/[teamId]/member-refs`, which writes only `memberRef`,
    is idempotent and never recreates a membership) do.
28. Member-facing planning responses contain only allow-listed keys — never a
    `uid`, e-mail, membership document id or audit field
    (`createdBy`/`updatedBy`/`archivedBy`). The assignable-members endpoint
    is privacy-minimized (`memberRef`, display name, presentation ordinal,
    `isSelf`, counts) and exposes no join date. Logs never carry names, refs
    or plan content.
29. The F0 member roster stays identifier-free (`{displayName, isLead,
    isSelf}`: no `uid`, e-mail, membership id or `memberRef`); member
    selection uses the dedicated assignable-members contract instead.
30. Planning stores team-level intent only: no individual score, ranking,
    per-person aggregate, manager note or inferred competence. The optional
    owner is coordination metadata, not an individual performance or
    accountability measure, and the UI offers no per-owner filter, sort or
    summary.
31. Individual skill self-assessments (`skillProfiles/{uid}`, Individual Skill
    Self-Assessment C1) are person-owned and, **in C1, owner-only**. The
    subject is always the verified token's uid; no path, query or body carries
    a uid, and there is no uid-based reader or writer. Ordinary member, team
    lead and app admin have no access to another person's assessment, and no
    role, team membership, roadmap ownership or `memberRef` widens it
    (`authorizeTeamAccess`, `resolveTeamRole`, `requireAppAdmin` and
    `isAppAdmin` never decide access to it). Access is server-only (Admin SDK);
    `firestore.rules` has an explicit deny-only block, which is defence in
    depth and not the owner-authorization mechanism. Personal self-assessment
    for the person's own development is permitted; manager, lead, admin or
    team assessment of an individual, performance evaluation, surveillance
    use, ranking and productivity scoring remain prohibited. Levels are
    ordinal: no average, sum or overall score is computed. Logs never carry
    levels, tree ids, skill names or the profile. C1 provides no sharing and
    no aggregate. The one approved composition (2026-11-06, TASK-009) mounts the
    C2 "Del kompetanse med teamet" participation control on `/me/skills`; it is
    owned and enforced by C2 (invariant 32) and reads no `skillProfiles` content.
    *C2 amendment (2026-10-10):* the single reader C2 added is
    governed by invariants 32–36 and does not widen owner access: no other
    person can read a profile, and the only derived output is the
    privacy-thresholded categorical team coverage. Any *other* future reader
    of personal assessments is **not** authorized by C1 or C2 and requires all of: a separately
    approved specification, an updated user-facing privacy notice, an explicit
    security/privacy review, a deliberate change to **both** static-guard
    allow-lists, threshold/aggregation protections where applicable, and an
    explicit consent-or-inclusion decision. The static guard
    (`src/features/skill-profiles/skill-profiles-scope-guard.test.ts`) is
    change-detection evidence, not a security boundary: it does not prove
    runtime behaviour, dynamically built collection names or module paths,
    unresolvable re-exports/dynamic imports, code outside `src/` and `app/`, or
    Admin-credential access outside the application.
32. **Team skill coverage (C2) reads a person's `skillProfiles` document only
    through the single batch module** (`readSkillLevelsBatch`), only for a
    person who holds an effective, per-team, versioned participation
    (`teamMemberships.skillContribution`) on a genuine membership of an
    `active` team, and only for the `treeId`s of the team's persisted needs.
    It returns only a categorical per-need state (`covered`, `gap`,
    `insufficient_data`, and `area_unavailable` for an unusable catalog tree) —
    never a `uid`, e-mail, name, `memberRef`, level, count, ratio,
    distribution, min/max, timestamp, completeness or contributor identity.
    Participation is opt-in, per team, revocable, destroyed with the
    membership, absent after a rejoin, and never overridden by a lead or app
    admin. The cohort is judged per skill with a fixed threshold of 3 eligible (owner decision 2026-11-11, previously 5)
    contributors; below it the result is `insufficient_data`, and every
    suppression cause is indistinguishable.
33. Roles do not widen coverage or profile access. Coverage is readable only
    by genuine members of an `active` team, with an identical response for
    ordinary members and leads; a non-member app admin may read the stated
    needs (never coverage), and an app admin who is also a member is evaluated
    purely as that membership. Another person's participation is never
    readable (no contributor list, no `consentedAt`, not in any
    membership-derived response). The single lead capability introduced by C2
    is limited to creating, updating and deleting `teamSkillNeeds` of an
    `active` team, decided from a fresh genuine-membership read; it grants no
    access to any profile or richer output. App-admin status never grants
    need mutation, coverage or participation.
*TA-SI amendment (2026-11-06):* the single C2 capability is now team administration of `teamSkillNeeds` for a superadmin or
a genuine `teamadmin` of an active team (TA-SI-4). Participation and coverage remain unchanged and never use this check.
34. The coverage threshold `k = 3` is the code constant
    `SKILL_COVERAGE_MIN_CONTRIBUTORS` (with the notice version
    `SKILL_CONTRIBUTION_NOTICE_VERSION`, both owned by
    `src/features/team-skills/domain/skill-coverage-policy.ts`). It is never
    configurable by a request, setting, environment variable, team, lead or
    app admin, and may not be lowered without a product decision, a revision of
    this document and a bump of the notice version (which lapses all
    participation). The coverage endpoint accepts no query-time inputs; the
    only cut-points are the persisted needs (`requiredLevel` 2–4,
    `requiredCoverage` 1–20; level 1 is excluded).
    *Numeric automatic team profile (owner decision 2026-11-08):* a separate
    threshold `AUTOMATIC_TEAM_LEVEL_MIN_CONTRIBUTORS = 3`
    (`src/features/team-skills/domain/team-level.ts`) applies to the rounded
    arithmetic mean per competence area. It is served only by
    `GET /api/teams/[teamId]/team-skills/aggregate` (team-owned skills, k = 3 via `SKILL_COVERAGE_MIN_CONTRIBUTORS`) through a strict DTO allow-list: no
    identity, individual rating, contributor count, sum or `requiredCoverage`.
    There is no additional team-size floor. A three-person aggregate is **not
    anonymous**: inference about an individual rating is possible and is an
    accepted product risk. The retired `GET /api/teams/[teamId]/skill-levels` route (2026-11-11) and its DTO are gone. The categorical coverage view uses the same k = 3 (owner decision 2026-11-11);
    its retirement is a separate decision.
*Unified team competence amendment (owner decision, 2026-11-11, final):* the shared-assessment threshold for the team-owned skill
aggregate and the categorical coverage view is lowered from 5 to 3 by changing the single owner constant
`SKILL_COVERAGE_MIN_CONTRIBUTORS`. `SKILL_CONTRIBUTION_NOTICE_VERSION` is bumped from 1 to 2 because the notice text states the
threshold. Every participation recorded under version 1 lapses; each member must re-consent. Two or fewer eligible
contributors remain suppressed. Membership, explicit sharing consent, criteria-version checks and every other protection in
this section are unchanged.
35. Nothing derived from personal assessments is persisted or cached: no
    aggregate, coverage/gap score, matrix snapshot, contribution record,
    history or trend. Every coverage request recomputes from the canonical
    sources. Any read failure yields an error with no partial result, and a
    cohort that cannot be read completely (more than 500 memberships) yields
    `incomplete` with no rows.
36. C2 never writes `skillProfiles`, `userProfiles`, `skillProgress` or
    `roadmapItems`. It writes only `teamSkillNeeds` (lead-only, no actor or
    history fields, hard delete) and the caller's own
    `teamMemberships.skillContribution` field. A `gap` creates no assignment,
    notification, goal or roadmap item. `teamSkillNeeds` is server-only
    (explicit deny-only rules block, no composite index).

**Residual-risk statement for invariants 32–36 (approved, P6).** The output is
**privacy-thresholded team coverage**. It is **not** anonymous in any formal
sense, and `k = 3` is a product threshold, not an anonymity guarantee. C2 does
not provide differential privacy, and does not protect against: a lead who
deliberately mutates the persisted needs and compares the categorical results
over time (the *malicious-lead oracle*: by varying `requiredLevel` and
`requiredCoverage` a lead can learn whether the number of contributors at or
above a level reaches a chosen value, hence roughly the count at or above each
level and, at level 2, roughly the cohort size; several leads widen this); a
state change that coincides with a visible roster or participation change,
which can reveal a broad band property of one person; a homogeneous cohort,
which reveals a broad band property of every contributor; collusion among
contributors or leads, and self-subtraction by a contributor who knows their own
level, at the margins of a small cohort; or repeated observations in general.
Operators with Firestore Admin credentials can read the raw data (not a product
entitlement). These limits are stated to participants in the participation
notice (self-subtraction only through its general "rough information about the
group" wording). The static guards (`team-skills-scope-guard.test.ts`,
`skill-profiles-scope-guard.test.ts`) are change-detection evidence, not
security boundaries: they do not prove runtime behaviour, dynamic collection
names or module paths, path aliases other than `@/`, code outside `src/` and
`app/`, or Admin-credential access.

**Personal development goals (D1, `docs/features/personal-development-goals/SPEC.md`).**
Invariants 37–54 are SI-1…SI-18 of that SPEC, in order (invariant *n* = SI-*(n−36)*).

37. Goals (`userDevelopment/{uid}/goals/{goalId}`) are owner-only: readable and writable only
    by the signed-in owner through `/api/me/goals…` (SI-1).
38. The subject is always the verified-token uid; no uid, owner, e-mail, team or member
    reference is accepted from the client in a path, query or body (SI-2).
39. No uid-parameterised goal reader or writer exists (SI-3).
40. Team roles and app-admin status never widen goal access (SI-4).
41. Goals have no team scope and no sharing in D1 (SI-5). Any future reader (leads, mentors,
    D2) needs a separately approved privacy/security design, an updated privacy notice, a
    deliberate guard allow-list change and a consent decision.
42. D1 never reads `skillProfiles` (SI-6) and goals feed no roadmap, matrix, coverage,
    maturity or performance view.
43. D1 never persists C1 levels (SI-7).
44. D1 never writes SkillTree data (SI-8).
45. Client Firestore access to `userDevelopment` is denied by an explicit deny-only rules
    block before the catch-all (SI-9). This is defence in depth only: the Admin SDK bypasses
    client rules, and owner authorization is enforced by server behaviour using the verified
    token. Rules deployment is a separate explicit step.
46. Goal DTOs, the recovery DTO and the list envelope are explicit field-by-field
    allow-lists (SI-10).
47. No uid, e-mail, display name, team id, audit actor or C1 level appears in any goal DTO
    or error body (SI-11).
48. Goal titles are potentially sensitive free text, stored **unencrypted**; the UI
    discourages sensitive content (SI-12).
49. Titles are inert text only (never HTML/Markdown) and are never logged; no request body,
    stored document or tree name is logged (SI-13).
50. A foreign goal id reveals no owner information: it is structurally missing under the
    caller's path (SI-14).
51. No `collectionGroup` goal query is permitted (SI-15).
52. Account erasure exists (see the account-erasure invariants below). A personal goal is erased with its owner's account, and the goal title is not claimed erased from provider logs or backups (SI-16 superseded 2026-11-02).
53. Operator or Admin-SDK access to goal data is an accepted residual risk, not a product
    entitlement (SI-17).
54. A malformed goal's existence and opaque id may be revealed to its owner only, as a
    delete-only `{ goalId }` recovery item; no malformed content, failure reason or stored
    field is returned (SI-18).

Development conversations (D2, `docs/features/development-conversations/SPEC.md`)
assigns the next free numbers 55–72 to its D2-SI-1…D2-SI-18 in order. Each is
stated here in the form the feature implements; the SPEC holds the full rules.

55. Every conversation request derives the caller uid from the verified token. No
    path, query or body carries a `uid`, owner uid, participant uid or membership
    id; a `teamId` in a body is a choice, checked against the owner's real
    membership (D2-SI-1).
56. Conversation content is readable only by the owner, or by a participant who
    passes the access check: a participation index, the authoritative owner
    document, an active team, a current genuine membership and a matching member
    reference. App-admin, lead and role checks are not used on this path. A member
    reference grants nothing alone (D2-SI-2, invariant 25).
57. No participant content is returned before an explicit accept that re-checks
    the access rules. Participation starts only with the owner's choice and the
    invitee's acceptance (D2-SI-3).
58. A conversation has at most one participant, who must be an eligible member of
    the owner's team, chosen by opaque reference. Lead-initiated, admin-initiated,
    cross-team and role-derived participants do not exist (D2-SI-4).
59. Participants see only owner-selected goal snapshots. They never read D1 goals or
    goal ids. No C1 level, skill profile, C2 output, roadmap item or `skillProgress`
    enters D2, and D2 never writes them (D2-SI-5).
60. After acceptance, both parties see every owner and participant section. No
    owner-only, participant-only, lead-only or admin-only section exists (D2-SI-6).
61. Owner sections are written only by the owner; `participantNotes` only by an
    accepted, eligible participant. No write crosses roles (D2-SI-7).
62. Access ends immediately, on the next request, through decline, leave, removal,
    replacement, withdrawal, team disablement or ineligibility. Only the
    participant's own leave and the owner's removal delete `participantNotes`.
    Ineligibility never deletes or hides content (D2-SI-8, CL-21).
63. Completion freezes content and additions, never access. After completion the
    owner can still remove the participant, clear snapshots and delete; the
    participant can still leave (D2-SI-9).
64. No exception keeps a former member able to read a conversation (D2-SI-10).
65. Named free-text fields are encrypted on the server with the existing AES-256-GCM
    helper. This is application-layer encryption, not end-to-end and not
    zero-knowledge: the server and anyone with the encryption key can decrypt, and
    both accepted parties receive plaintext through the API by design (D2-SI-11).
66. Every conversation read is bounded and every body is capped. There is no
    `collectionGroup` query, no export and no unbounded history (D2-SI-12).
67. A malformed owner document is visible to its owner only as a delete-only
    `{ conversationId }`. A malformed index entry is invisible. A missing, invalid or
    mismatched encryption key is never a malformed document or a recovery candidate.
    No ciphertext, key identifier, check value, decryption error or stored field
    name is returned (D2-SI-13).
68. Response DTOs are explicit allow-lists. The owner never sees the participant's
    member reference or uid. Names appear only under the roster rule (invariant 21
    amendment) (D2-SI-14).
69. Missing, inaccessible, non-participant, ineligible, unbound and foreign ids all
    return the same `conversation_not_found`. Invitation and goal-selection errors do
    not reveal which underlying condition failed (D2-SI-15).
70. D2 writes no `userDevelopment` goal, `skillProfiles`, `teamSkillNeeds`,
    `roadmapItems`, `skillProgress`, `userProfiles` or membership document. It reads
    membership only for the access and eligibility checks, and D1 goals only for
    snapshot selection (D2-SI-16).
71. D2 has no score, rating, rank, progress, activity, read receipt, last-viewed
    time, lead dashboard, team aggregate or cross-conversation summary. No
    notifications are sent (D2-SI-17, CL-24).
72. D2 has no admin or lead route, no support or recovery path, and no route that
    lets anyone other than the owner or the bound participant read a conversation
    (D2-SI-18).

D1 makes no claim of anonymity, differential privacy, or encryption of titles beyond the
platform's storage guarantees, and does not claim operators cannot access the data.

## Account erasure invariants (AE-SI, 2026-11-02)

Source: `docs/features/account-erasure/SPEC.md`. These are the durable invariants of the erasure of a person's data.

- **AE-SI-1 Self-only initiation.** Only the verified person, for their own uid, can start or resume an erasure. No admin,
  lead, team member, operator-facing route, or other user can initiate it for someone else.
- **AE-SI-2 No cross-person exposure.** Erasure responses, errors, and status never contain another person's data, uid,
  e-mail, or membership identifier.
- **AE-SI-3 Fence.** While a record exists for a uid, no person-owned data is created or mutated for that uid, and no
  protected route accepts the uid's requests except the erasure endpoint.
- **AE-SI-4 Ordering.** Auth deletion is the last step that depends on the person's authentication. No state exists in
  which Auth is deleted while person-owned data is still reachable through a route.
- **AE-SI-5 Residual record.** The only record that may still carry the uid is the fence record. It holds the uid as its
  document id, a status, a step, timestamps, an `expireAt`, and an error code from a fixed enum. It holds no e-mail,
  team, memberRef, content, or free text.
- **AE-SI-6 Content removal.** Erased authored content (forum title and body and ciphertext, reply content,
  `participantNotes`, the person's owned conversations including owner notes and next steps) is removed, not retained in
  plain or encrypted form.
- **AE-SI-7 No retained linkage.** After completion no stored record contains the erased uid, e-mail, `participantUid`,
  `authorUid`, or `memberRef` for that person, except the transient fence record (AE-SI-5). Nulled actor fields are nulled,
  not replaced with anything derived from the uid.
- **AE-SI-8 Anonymity preserved.** Erasure does not join, infer, or delete anonymous `surveyResponses` or challenge content.
  It does not make an anonymous record easier to correlate with a person. Erasing forum authorship does not reveal or
  preserve a former `authorTag`.
- **AE-SI-9 No collateral deletion.** Erasure never deletes another person's authored content, owner-authored content in
  another person's conversation, team, survey, challenge, skill tree, or role definition merely because the erased person
  acted on or participated in it.
- **AE-SI-10 Recent authentication.** Starting an erasure requires a verified token whose `auth_time` is within the window
  (BR-3). Possession of an older bearer token is not sufficient.
- **AE-SI-11 Irreversible.** No undo, recovery, grace period, or restore exists.
- **AE-SI-12 No content logging.** Erasure logs only status, step, and error code. It never logs uid, e-mail, content,
  ciphertext, or payloads in application logs.
- **AE-SI-13 Demo isolation.** Demo tooling never creates, recreates, or writes person-owned data for a uid that has an
  erasure record or no current Auth user.

## Feature review checklist

Before marking a feature touching survey/team/user data as done, check:

- [ ] Is sensitive data written to Firestore in plaintext anywhere?
- [ ] Can the browser obtain encryption material?
- [ ] Does a stored anonymous response contain an identity field?
- [ ] Can participation records be correlated directly with responses?
- [ ] Could timestamps or metadata undermine anonymity (e.g. a team of one)?
- [ ] Can a user from Team A access Team B's data?
- [ ] Are aggregates ever exposed below the minimum response threshold?
- [ ] Can sensitive text reach logs or error-monitoring tools?
- [ ] Are secrets or credentials present in source control?
- [ ] Is real employee data present in tests or fixtures?
- [ ] Can an admin path reach raw individual responses unnecessarily?
- [ ] Does any member-facing response expose another member's `uid`, e-mail,
      membership id or audit field, or a value derived from them (Forum
      `authorTag` is computable from `teamId` + `uid`)?
- [ ] Does any client-visible member reference use a Firebase `uid` or a value
      computable from it?
- [ ] Is a display name or team role used as an identifier, lookup key or
      authorization input, or trusted from the client?
- [ ] Does a lead role (or any other membership metadata) grant access
      implicitly instead of through an explicit, reviewed opt-in?
- [ ] Is a member reference or planning owner treated as authorization, or
      does any read/GET generate or write one?
- [ ] Does a planning write rely on app-admin status or the lead role instead
      of a genuine active-team membership, or trust a client-supplied
      team/owner/document id?
- [ ] Does a planning feature introduce a per-person score, ranking,
      aggregate, owner-based filter or manager note?
- [ ] Can any role (lead, app admin, team member) or any uid/team parameter
      reach another person's `skillProfiles` document, or does a new
      reader/importer of the skill-profiles server modules appear without a
      deliberate guard allow-list edit and review?
- [ ] Does a skill-assessment feature introduce a manager/lead/admin rating,
      score, average, rank, comparison or sharing path?
- [ ] Is there a reader of `skillProfiles` outside the single approved batch
      module, or does any team response contain a count, ratio, distribution,
      min/max, timestamp or any path revealing who contributes?
- [ ] Is the coverage threshold or need cut-point widened (a threshold below 5,
      a configurable `k`, `requiredLevel = 1`, a non-lead need write, or a
      query parameter, snapshot or timestamp on the coverage endpoint)?
- [ ] Does a lead capability extend beyond managing `teamSkillNeeds`, or is
      app-admin status used for coverage, need writes or participation?
- [ ] Is participation exposed through a membership-derived response, kept
      after removal or rejoin, defaulted on, or overridable by a lead or admin?
- [ ] Is derived coverage persisted or cached, or is any output described as
      "anonymous" or as preventing inference?
- [ ] Can any role (lead, app admin, team member) or any uid/team parameter reach
      another person's `userDevelopment/{uid}/goals` documents, or does a new
      reader/importer of the personal-goals server modules (or a `collectionGroup`
      goal query) appear without a deliberate guard allow-list edit and review?
- [ ] Does a goal feature share goals, derive goals from `skillProfiles`, or feed
      goals or goal status into roadmap, coverage, matrix, maturity or any
      performance/ranking view?
- [ ] Is a goal title logged, or rendered as HTML/Markdown, or is the page or any
      copy described as encrypting titles or guaranteeing operators cannot read them?
- [ ] Can any party other than the owner or the one bound, accepted, eligible participant
      reach a development conversation, through a role, admin, lead, `memberRef` alone,
      a name match or a generic team endpoint?
- [ ] Does a conversation response, error or log carry a `uid`, e-mail, membership id,
      `memberRef`, title, note or goal title outside the authorized view, or a key or
      decryption detail?
- [ ] Does a conversation feature store free text outside the encrypted payload, or
      treat a key outage or key mismatch as a malformed document?
- [ ] Does a conversation feature add a score, progress, read receipt, last-viewed time,
      activity count, notification, or a read of C1, C2, roadmap or goal data?

Known, accepted limitations of the member-identity foundation (display-name
Unicode compatibility, roster truncation above 500 members, the absence of an
account-deletion flow for profiles, no display-name moderation) are listed in
`docs/features/member-identity-and-team-roles/SPEC.md` — "Known limitations
(as built)".

Known, accepted limitations of individual skill self-assessment (C1): there is
no account-deletion flow, so a `skillProfiles` document can outlive a deleted
Firebase account (the owner can erase it while signed in); and anyone with
operator/console access to Firestore can technically read the data — that is not
a product entitlement and no DevPulse surface provides it. See
`docs/features/individual-skill-self-assessment/SPEC.md`.

Known, accepted limitations of team skill coverage (C2): the residual privacy
risks stated after invariant 36; there is no account-deletion flow, so a
membership (and its participation) or a profile can outlive a deleted Firebase
account until the membership is removed; and the Demo Team cannot show the
available (`covered`/`gap`) states because no personal assessments are seeded.
See `docs/features/team-skill-needs-and-matrix/SPEC.md`.

Known, accepted limitations of personal development goals (D1): there is no
account-deletion flow, so goals can outlive a deleted Firebase account (the owner can
delete them while signed in; the owner-subtree layout keeps a future erasure a single
subtree operation); anyone with operator/Admin-SDK access to Firestore can technically
read goal titles (not a product entitlement); titles are stored unencrypted and the owner
can type sensitive text; the 100-goal cap can be slightly overshot under concurrent
creates; malformed stored documents count toward the cap and appear to the owner only as
delete-only recovery items, and a document whose id is not addressable cannot be
recovered in-product; when more than the bounded read window of goals exists only a window
is examined and deleting visible goals reveals the rest; and the static scope guard is
change-detection evidence, not a security boundary. See
`docs/features/personal-development-goals/SPEC.md`.

Known, accepted limitations of development conversations (D2): there is no account-deletion
flow, so conversation content and participant bindings can outlive a deleted Firebase account until the
owner removes the participant or deletes the conversation; anyone with operator or Admin-SDK access can
decrypt conversation content (not a product entitlement); the encryption key is a single environment key with no
rotation, so key loss makes content unrecoverable and rotation needs a separate migration; the
ciphertext carries no additional authenticated data, so an operator with database write access could move
ciphertext between documents undetected; an ineligible participant's notes stay visible to the owner until the
owner removes them (CL-21); a membership removal does not itself delete participant notes; names follow the
roster rule; there is no invitation rate limit beyond the participant cap; and the participant list verifies each
entry with up to three point reads, so one call costs a bounded but non-trivial number of reads. The owner list
verifies each bound participant with an index read and an owner read per item. See
`docs/features/development-conversations/SPEC.md`.

See `docs/ARCHITECTURE.md` for where these boundaries live, and
`docs/features/<feature-id>/SPEC.md` for feature-specific decisions.

## Role profiles invariants (RP-SI, simplified 2026-11-11)

The role-profiles feature (`docs/features/role-profiles/SPEC.md`) uses its own `RP-SI` prefix, so the numbered invariants above
are not renumbered. The 2026-10-28 invariants about a personal target role and a derived comparison are withdrawn with that
model. Their collection no longer exists in the code and was removed from the test project on 2026-11-11.

- **RP-SI-1 (organizational roles are reference data).** `roleDefinitions` (title and description only) is written only by an
  app administrator through Admin SDK routes behind `requireAppAdmin`, and read by signed-in people only through the
  allow-listed `GET /api/roles`. Client Firestore access is denied by an explicit deny-only rule. Descriptions are org text and
  must not contain personal names (the admin form shows the notice).
- **RP-SI-2 (formal assignment is server-only and admin-written).** `roleAssignments/{uid}` is written only by an app
  administrator through `requireAppAdmin` routes, and read only through the Admin SDK. Client Firestore access is denied by an
  explicit deny-only rule. Writes are fenced on the target uid's erasure record.
- **RP-SI-3 (no self-assignment).** An administrator cannot assign or remove their own role. The check compares the verified
  token's uid with the route's target uid before any write.
- **RP-SI-4 (an assignment grants nothing).** No application permission, team role, superadmin decision, skill calculation,
  goal rule or access check reads `roleAssignments`. The personal read returns only the title and description of the
  assigned active role to its owner.
- **RP-SI-5 (internal fields stay internal).** `createdBy`, `updatedBy`, `archivedBy` and `uid` never appear in any response.
  Route responses are field allow-lists. The personal response carries no uid and no role id.
- **RP-SI-6 (no skill or goal reader).** role-profiles reads no skill, goal, responsibility, achievement or team-planning data.
  No role data reaches D2, team skill needs, coverage, progress or the roadmap.
- **RP-SI-7 (neutral errors and logs).** Errors and logs carry no role title, description, role id or uid. A failed read is a
  neutral failure (`persistence_failed`), never an empty list or a different role.
- **RP-SI-8 (malformed content is never echoed or repaired).** A malformed role or assignment is skipped or reported as
  `none`, with no content returned. Reads never repair a document.
- **RP-SI-9 (one write per operation).** Every operation performs at most one write, and every refusal writes nothing.
- **RP-SI-10 (archived roles receive no new assignments).** An assignment to an archived or missing role is refused. An
  existing assignment to a role that is later archived is kept as stored and is not replaced silently.
- **RP-SI-11 (static guards are not authorization).** The scope guards and the rules check are change detection. Authorization
  evidence is the operation tests (`role-assignments.test.ts`) and the route suites.

## Personal role workspace invariants (PR-SI, 2026-11-10)

Source: `docs/features/personal-role-workspace/SPEC.md` and `SECURITY-REVIEW.md` §10–§11. Approved for the **first increment**
(private responsibilities, private achievements, the personal role workspace, and explicitly selected encrypted conversation
evidence) on 2026-11-10 (product owner, G1–G3). They do **not** approve formal role assignments, assignment history or any
role-administration feature (TASK-010 stays deferred). They do not weaken any existing invariant. Invariants 59 and 70 are amended
by this section: where the numbered text above differs from the "Now" text below, the "Now" text applies.

- **PR-SI-1 (owner-only personal records).** Responsibilities (`userDevelopment/{uid}/responsibilities/{id}`) and achievements
  (`userDevelopment/{uid}/achievements/{id}`) are read and written only by the verified token uid through server routes with the
  Admin SDK. No admin, app-admin, superadmin, team admin, lead, member, participant or other user route, query, collection group
  or export reads them. A `uid`, `ownerUid` or record id in a path, query or body never selects another person's record. The only
  other read is the owner-initiated evidence selection (D2-SI-16 as amended below), which uses the verified owner uid and copies
  allow-listed fields only. Client Firestore access is denied (the existing `userDevelopment` deny-only rule covers the subtree).
- **PR-SI-2 (no aggregation; static import guard).** No team, org, admin, survey, coverage, roadmap, skill-progress, role-comparison,
  ranking or analytics code reads or derives from responsibilities, achievements or evidence snapshots. The import allow-list of the
  personal-record store is a **static architecture and regression guard**. It detects an unexpected importer at build time. It is
  **not** runtime authorization and does not authorize any request. The enforceable boundaries are: the verified authenticated owner
  identity; server-side authorization on every request; strict owner-scoped data access; Firestore client denial; minimal response
  DTOs; and negative cross-user access tests. Documented guard exceptions are listed in SECURITY-REVIEW §11.4.
- **PR-SI-4 (the formal role is read only by its owner).** The personal workspace shows the signed-in person's own formal
  organizational role (title and description) through `GET /api/me/role-assignment` only. It never reads `roleAssignments`
  directly, never shows another person's role, and never presents the role as a permission. No target-role concept exists.
- **PR-SI-5 (source records are encrypted; key failures are never data loss).** `title`, `description` and `outcome` of
  responsibilities and achievements are stored only inside an encrypted payload, using the existing AES-256-GCM helper
  (`src/lib/encryption`, invariants 3–5 and 65). The stored envelope is `{ ciphertext, iv, authTag, keyVersion, keyCheck }`.
  `keyCheck` is HMAC-SHA-256 keyed with the configured 32-byte key over a context string distinct from the D2 context (domain
  separation). The check order is: key valid, `keyCheck` match, authenticated decryption, schema parse. A missing, invalid or
  mismatched key, and an authentication failure, are never classified as a malformed record, never produce a deletable item, never
  cause a write (create, update or delete of content), and never cause deletion. Only a schema failure after successful
  authenticated decryption is malformed, and it is delete-only for the owner (`{ id }`). Deleting a known record by explicit owner
  action and account erasure work by path and do not require the key. Plaintext is never logged, returned, or stored in plain fields.
- **PR-SI-6 (limits enforced on the server).** Request body at most 16 KiB, read as a bounded stream, so the cap holds whatever
  `Content-Length` claims. Encrypted envelope at most 32 KiB, checked before the write. Caps of 100 responsibilities and 200
  achievements per person, count-then-create. Ids are addressable under the D2 rule (`^[A-Za-z0-9_-]{1,128}$`, no `__`-wrapped id).
  Oversized input fails with `payload_too_large` or `invalid_input` and writes nothing.
- **PR-SI-7 (write fence).** Every write to a personal record reads `accountErasures/{uid}` inside its transaction and refuses with
  `erasure_in_progress` if the record exists (the existing fence helper).

**Amendments to D2 (first increment, approved 2026-11-10):**

- **Amendment A (invariant 59).** *Previous:* participants see only owner-selected goal snapshots; no C1, skill, C2, roadmap or
  `skillProgress` enters D2. *Now:* participants see only owner-selected snapshots: goal snapshots and evidence snapshots (the
  responsibility and achievement copies with exactly the snapshot allow-list). They never read source records, source ids, goal ids,
  responsibility ids, achievement ids, the target role, an assigned role, a comparison, a C1 level, a skill profile, C2 output, roadmap
  items or `skillProgress`. D2 never writes them.
- **Amendment B (invariant 70).** *Previous:* D2 writes no `userDevelopment` goal, `skillProfiles`, `teamSkillNeeds`, `roadmapItems`,
  `skillProgress`, `userProfiles` or membership document, and reads D1 goals only for snapshot selection. *Now:* D2 additionally writes
  no `userDevelopment` responsibility or achievement document, and reads responsibilities and achievements only for the owner's
  snapshot selection, through the owner-scoped store with the verified owner uid. It never reads target roles, assigned roles, C1
  levels or skill profiles.
- **Amendment C2 (D2-SI-19, evidence storage; BR-51).** Evidence snapshots are stored only in the `sharedEvidence` array inside the
  encrypted `content` payload. The BR-51 encrypted payload has one of two exact key sets: payload v1 `{ title, ownerNotes,
  nextSteps, participantNotes, sharedGoals }` (unchanged), and payload v2 which adds `sharedEvidence`. The sixteen plain-field keys
  are unchanged, and no plain field carries evidence. An absent `sharedEvidence` reads as `[]`. Any other key set, including a
  non-array `sharedEvidence`, is `malformed_payload`. The v2 codec is deployed before any evidence route. Code that predates v2 must
  not be deployed while any conversation holds `sharedEvidence` (release gate, SECURITY-REVIEW §11.2).
- **Amendment D (D2-SI-9a, completion).** After completion, `sharedEvidence` may only be cleared as a whole set. A non-empty
  selection is validated first, and then rejected with `conversation_completed` if valid. Partial removal, addition and editing are
  rejected. Evidence text is never edited. Completion never deletes snapshots. This matches BR-27, BR-28 and CL-26 for goals.
- **Evidence write precondition (E-1 of personal-role-workspace SPEC).** An owner evidence write carries the `updatedAt` it read as `expectedUpdatedAt`.
  The comparison runs inside the write transaction before any status check, so a stale write cannot overwrite a newer conversation
  state. The only response is `conversation_changed` (409), with no content. Verified by unit tests (two concurrent attempts with
  one version, stale replace, stale clear) and by the Firestore emulator suite. The precondition is not a security control on its
  own; authorization still comes from the verified owner uid.
- **Participant binding re-encryption (I-7, verified).** Erasure re-encrypts the owner payload with the real encryption helper. Its
  success path keeps `sharedEvidence` byte-identical in content and changes only the ciphertext. A failed encryption, a thrown
  encryption and a key mismatch each write nothing: the owner document and the participant index are unchanged, and the response
  is `store_unavailable` or `payload_unreadable` with no key or ciphertext detail (`participant-bindings-real-codec.test.ts`).

**Residual risks, accepted and recorded.** Operator or Admin-SDK access to encrypted source records is an accepted residual risk, as
for D2 (invariant 65). Records that fail authenticated decryption stay in place until erasure or an operator action; the product never
deletes them. Erasure of another owner's conversation, in which the erased person is a participant, requires a working key for the
re-encryption step (I-7), and it fails closed without one.

## Superadmin, teamadmin and team visibility (TA-SI, 2026-11-06)

Source: `docs/features/teamadmin-and-team-visibility/SPEC.md`. These invariants supersede the stored team `lead` as
the team editing authority (invariants 22, 23 and 33 are amended accordingly; their residual-risk statements still apply
to the data they describe). The superadmin is the Firestore-backed registry (`superadmins/{uid}`, section SR-SI below), not
any environment variable; no client-supplied role is ever trusted.

- **TA-SI-1 Server-side role.** Superadmin, teamadmin and member are derived per request on the server from the verified
  identity, the active `superadmins/{uid}` registry record (read on every request, SR-SI-1) and the `teamMemberships` document
  of the same (uid, teamId). No request field decides a role.
- **TA-SI-2 Only a superadmin assigns teamadmin.** `teamMemberships.role` accepts only `teamadmin` or `member`, is written
  only by `setTeamMemberRole` behind `requireAppAdmin`, and is never client-supplied. A teamadmin cannot promote themselves
  or another person, and cannot administer another team.
- **TA-SI-3 Legacy lead grants nothing.** A stored `role: "lead"` classifies as `member`. Nothing is migrated automatically.
- **TA-SI-4 Team-administration writes.** Writes to projects, participations, the competence catalog, competence plans and
  team skill needs require superadmin or a genuine `teamadmin` of an `active` team, re-checked inside the write transaction.
  Team status is checked after the role. No other capability is granted by the teamadmin role. Superadmin does not override
  personal data rules: `skillProfiles`, goals, role targets and development conversations remain owner-only, and
  participation and coverage never use the team-admin check.
- **TA-SI-5 Visibility is a persisted, validated field.** `teams/{teamId}.visibility` is `public` only when exactly that
  value is stored. Missing or malformed values are `private`. New teams are created `private`. The write path is server-only
  and authorized by superadmin or teamadmin on an `active` team.
- **TA-SI-6 Public read is an explicit projection.** The anonymous endpoint returns only `{teamId, name}` for an active,
  public team. Private, disabled, malformed and missing teams return the same `not_found`. No token is read on this path, no
  member, competence, project, planning, forum or audit field is returned, and the response is never cached. Further public
  fields need a separate approval and privacy review; any competence data would additionally need consent (invariants
  31–36) and the k = 3 threshold (invariant 34).
- **TA-SI-7 Visibility does not bypass consent.** A public team exposes no competence data, so no consent decision is
  bypassed. Any future public coverage must still apply invariants 32–35.
- **TA-SI-8 No actor uid for visibility.** A visibility change stores `visibility` and `visibilityUpdatedAt` only, so it adds
  no person linkage that account erasure would need to clear (AE-SI-7).

## Superadmin registry (SR-SI, 2026-11-06)

Source: `docs/features/superadmin-registry/VERIFICATION.md` and `docs/features/superadmin-registry/BOOTSTRAP.md`. The registry is
the single authority for global administration. Its implementation status and its production activation status are separate
facts; see "Status" at the end of this section.

- **SR-SI-1 Registry is the authority, read per request.** `superadmins/{uid}` (`active: true`) decides superadmin status. It is
  read with the Admin SDK on every privileged request. It is never cached and never derived from a token claim, cookie,
  client flag, environment variable or e-mail address. A read failure fails closed (`auth_unavailable`).
- **SR-SI-2 `APP_ADMIN_EMAILS` is not an authority.** No code path reads it. Its presence in an environment changes nothing.
  Removing it from deployments is a separate, owner-approved operator step.
- **SR-SI-3 Only an active superadmin grants or revokes.** Each grant or revoke re-verifies the caller's registry record
  inside the write transaction. A revoked superadmin is refused on its next request.
- **SR-SI-4 Targets come from Firebase Auth, by e-mail.** A grant resolves the e-mail through Firebase Auth. The account must
  exist, have a verified e-mail and be enabled. No Auth user is created. A client-supplied UID is never accepted as a grant
  target or as authorization evidence; a revoke names a UID but acts only on an existing active record.
- **SR-SI-5 Last superadmin is protected.** A revoke that would leave zero active superadmins is refused (`last_superadmin`,
  HTTP 409). The count lives in `superadminRegistry/control` and is read and written in the same transaction as every
  change. Two concurrent revocations conflict on that document, so one retries against the updated count.
- **SR-SI-6 Duplicate grants are idempotent.** Granting an active superadmin again succeeds with no write.
- **SR-SI-7 Client access is denied.** `firestore.rules` denies all client reads and writes to `superadmins` and
  `superadminRegistry`. Only the Admin SDK on the server touches them.
- **SR-SI-8 Erasure start is atomic with the revoke.** Starting an erasure for an active superadmin revokes the privilege and
  creates the erasure fence in one Firestore transaction (`account-erasure/server/erasure-start-atomic.ts`). A failed fence
  leaves the privilege in place. The last active superadmin cannot start an erasure (`last_superadmin`). No recovery path
  restores a privilege silently; any re-grant is an explicit grant by another superadmin.
- **SR-SI-9 Bootstrap is explicit and one-time.** `scripts/bootstrap-superadmin.ts` is run by hand. It is a dry run unless
  `--apply --confirm <project-id>` is given, refuses any project other than the configured one, refuses when another active
  superadmin exists, and never runs at startup. The exact command is in `docs/features/superadmin-registry/BOOTSTRAP.md`.
- **SR-SI-10 Privilege boundary (owner decision, approved).** A superadmin may perform globally authorized team administration
  and manage team skill needs without holding a team membership or the legacy lead role. These privileges do **not** override
  the privacy of personal self-assessments, private role direction or explicit sharing consent (invariants 31–36 and SI-4).
- **SR-SI-11 Audit fields.** Grant and revoke record `grantedByUid`, `revokedByUid`, `grantedAt`, `revokedAt` and `updatedAt`
  on the registry record. UID-typed fields hold a UID or null only; the owner bootstrap grant writes `grantedByUid: null`. No e-mail address is stored in the registry.

**Status (2026-11-06).**
- *Implemented in the repository:* registry domain and operations, `GET/POST /api/admin/superadmins`,
  `DELETE /api/admin/superadmins/[uid]`, the `/admin/superadmins` page, the erasure atomic start, and the bootstrap script.
  Verified by unit, route and in-memory transaction tests.
- *Verified on the Firestore emulator (review pass):* registry grant and revoke, concurrent revocations, the atomic erasure start,
  the fenced grant, and client-SDK denial of both registry collections (14 tests, see VERIFICATION.md).
- *Not verified:* an authenticated browser run, the erasure fence race (D-EMU, owner-gated), and any
  real Firebase project.
- *Not activated:* no production or shared Firebase environment has been bootstrapped, and `APP_ADMIN_EMAILS` has not been
  removed from any deployment. Production activation requires the owner's explicit approval (see BOOTSTRAP.md).

Known, accepted limitation: a demoted teamadmin loses write access on their next request (TA-SI-1), but any client-side
state already rendered continues until the next read. Team-admin management of ordinary membership and access requests
remains superadmin-only pending an owner decision.

## Team-owned skills invariants (docs/features/team-owned-skills/SPEC.md)

- **TS-SI-1 Private ratings stay private.** `teamSkillAssessments` is owner-only. No API lets a team administrator, a
  superadmin or any other member read another person's rating. The team skill list returns definitions and the caller's
  own ratings only.
- **TS-SI-2 Administration is server-authorized.** Creating or editing a team skill requires a superadmin or a genuine
  `teamadmin` of an active team, re-checked inside the write transaction. A skill of another team is reported as
  `not_found`, never as an existence signal.
- **TS-SI-3 Aggregates use only the existing opt-in.** The team skill aggregate (`get-team-owned-skill-aggregate.ts`) is the
  one approved team-owned consumer of the C2 membership scan (reviewed in `team-skills-scope-guard.test.ts`). It counts only
  genuine members whose existing team sharing consent is effective, only ratings under the current criteria version, and
  only at a threshold of 3 (`SKILL_COVERAGE_MIN_CONTRIBUTORS`, owner decision 2026-11-11). A skill with any unreadable or inconsistent eligible rating
  is suppressed. It never returns a count, a uid, a contributor number or a per-person value, and the reader never queries
  across people (exact `{uid}__{skillId}` documents only).
- **TS-SI-4 Erasure covers the new records.** I-19 (`teamSkillAssessments`, owner-only, DELETE) and A-17 (`teamSkills`
  actor fields, ANONYMIZE) are registered in the inventory, the sweep and the erasure steps.
- **TS-SI-5 No dynamic keys.** The team-skill write path builds no dynamic map key or field path. The erasure guard
  stays unchanged, and its reviewed exception is not extended.

## Team competence invariants (unified Teamkompetanse and Competence Plan, 2026-11-11)

Source: `docs/features/team-experience-redesign/SPEC.md` (OD-6 for the plan) and `src/features/team-owned-skills/`. These
describe the code as it stands after the legacy retirement. They replace the earlier statements about the retired
`teamCompetenceAreas`, collaborative profile, `skill-levels` route and numeric profile endpoints, which no longer exist.

- **TC-SI-1 Manual team level: administrator writes only.** The collaborative team level (`teamManualAssessments/{skillId}`:
  `level` 1–4, optional `note`, `criteriaVersion`, `updatedAt`, and the audit actor `updatedBy`) is written only by
  `PUT` / `DELETE /api/teams/[teamId]/team-skills/[skillId]/manual`. Each write re-checks inside its transaction that the
  caller is a superadmin or a genuine `teamadmin` of an active team (`requireTeamAdministratorWith`). Other callers get
  `forbidden`; a disabled team gets `team_disabled`; a skill of another team, an unknown skill or an inactive skill gets `skill_unavailable`, so a foreign id is not an existence signal.
- **TC-SI-2 Manual team level: genuine members read, no person data.** `GET /api/teams/[teamId]/team-skills/manual` returns
  to a genuine member or an administrator only: `skillId`, `name`, `level`, `note`, `criteriaVersion`, `outdated`,
  `updatedAt` and `canEdit`. It never returns `updatedBy`, another person's uid or any member rating. A caller who is
  neither a genuine member nor an administrator gets `forbidden`.
- **TC-SI-3 Criteria version handling.** Every manual level stores the `criteriaVersion` of the skill at the time it was
  entered. `outdated` is `entry.criteriaVersion < skill.criteriaVersion`. An outdated level is kept and shown with the flag;
  it is never reinterpreted, rescaled or cleared automatically. A new write stores the current version.
- **TC-SI-4 Fail closed on malformed data.** A malformed stored skill, or a manual-assessment document that fails
  `isValidTeamManualAssessment` (extra keys, a wrong document id, an unknown level), fails the whole read with `read_failed`.
  It is never skipped, defaulted or shown as zero. Assessments whose skill is inactive are left out of the read view.
- **TC-SI-5 Automatic profile: k = 3 on shared, current-criteria ratings only.** The automatic team level
  (`GET /api/teams/[teamId]/team-skills/aggregate`) is derived only from members with an effective team sharing consent
  (TS-SI-3), only from ratings under the current criteria version, and only when at least
  `SKILL_COVERAGE_MIN_CONTRIBUTORS = 3` such ratings exist. Below that, the area is reported as insufficient data, never as
  zero. Any unreadable or inconsistent eligible rating suppresses the area. The response carries no count, uid, sum or
  per-person value. Three contributors is the minimum product threshold, not an anonymity guarantee (invariant 34).
- **TC-SI-6 Canonical catalog writes.** Creating or editing a team skill (`teamSkills`) requires a superadmin or a genuine
  `teamadmin` of an active team, re-checked in the write transaction. Guidance changes bump the skill's `criteriaVersion`.
  Names are unique among active skills of the team.
- **TC-SI-7 Competence Plan: no competence dependency.** A plan (`teamCompetencePlans/{planId}`, a random UUID) is written
  only by a lead of an active team and read by any team role other than `denied`. It stores a title, an optional catalog label `treeId`
  (`null` for new plans, never checked against any assignment), a target stage, a priority, milestones and timestamps. No
  read or write checks a competence area, a team skill, an assessment, sharing consent or a profile. It holds no uid,
  actor, `memberRef` or member assessment.
- **TC-SI-8 Direct client access is denied.** `teamSkills`, `teamSkillAssessments`, `teamManualAssessments`,
  `teamCompetencePlans` and `teamSkillNeeds` have deny-only Firestore rules. Every read and write goes through the Admin SDK
  on the server, behind the checks above.
- **TC-SI-9 Erasure.** `teamSkillAssessments` (the owner's own ratings) is deleted with the owner (I-19). The audit actor
  fields `teamSkills.createdBy` / `updatedBy` (A-17) and `teamManualAssessments.updatedBy` (A-19) are anonymized on erasure,
  and the record and its level are kept. `teamCompetencePlans` holds no person field and needs no erasure step; the allow-list
  states this with a reason. Erasure never deletes a team's manual level or plan because a member left.
- **TC-SI-10 Retired surfaces.** The `teamCompetenceAreas`, `teamProfileSettings`, `teamCollaborativeLevels` collections, the
  `profile-settings`, `competence-areas` and `skill-levels` routes and the collaborative-profile modules are removed. They have
  no rules, no inventory rows and no callers. A request to them returns no route.
- **TC-SI-11 Open items.** The `skill-needs` and `skill-coverage` routes remain. They are not wired into any page: the
  needs section is unmounted, so the routes have no live caller, although BR-17a places needs and coverage on Teamkompetanse.
  Re-mounting or retiring them is a product decision, recorded in `docs/features/team-experience-redesign/TASKS.md`.
