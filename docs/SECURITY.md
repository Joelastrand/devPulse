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
    Firestore model (client rules deny all).
22. A team role (`teamMemberships.role`) is membership metadata, not a
    general RBAC system. It is read fail-safe to least privilege (only
    exactly `"lead"` is a lead; a stored lead is effective only while the
    team is `active`), written only by an app admin through a server-side
    transaction, never client-supplied, and grants no capability unless a
    feature explicitly opts into `resolveTeamRole`. `authorizeTeamAccess`
    continues to treat a lead as an ordinary member.
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
    access, visibility, lead capability or edit right.
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

Known, accepted limitations of the member-identity foundation (display-name
Unicode compatibility, roster truncation above 500 members, the absence of an
account-deletion flow for profiles, no display-name moderation) are listed in
`docs/features/member-identity-and-team-roles/SPEC.md` — "Known limitations
(as built)".

See `docs/ARCHITECTURE.md` for where these boundaries live, and
`docs/features/<feature-id>/SPEC.md` for feature-specific decisions.
