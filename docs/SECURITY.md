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
    no aggregate. *C2 amendment (2026-10-10):* the single reader C2 added is
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
    admin. The cohort is judged per skill with a fixed threshold of 5 eligible
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
34. The coverage threshold `k = 5` is the code constant
    `SKILL_COVERAGE_MIN_CONTRIBUTORS` (with the notice version
    `SKILL_CONTRIBUTION_NOTICE_VERSION`, both owned by
    `src/features/team-skills/domain/skill-coverage-policy.ts`). It is never
    configurable by a request, setting, environment variable, team, lead or
    app admin, and may not be lowered without a product decision, a revision of
    this document and a bump of the notice version (which lapses all
    participation). The coverage endpoint accepts no query-time inputs; the
    only cut-points are the persisted needs (`requiredLevel` 2–4,
    `requiredCoverage` 1–20; level 1 is excluded).
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
sense, and `k = 5` is a product threshold, not an anonymity guarantee. C2 does
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
52. Account erasure is a known limitation: there is no deletion flow (SI-16).
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
