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
12. Initial planned minimum threshold: **5 responses**.
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

See `docs/ARCHITECTURE.md` for where these boundaries live, and
`docs/features/<feature-id>/SPEC.md` for feature-specific decisions.
