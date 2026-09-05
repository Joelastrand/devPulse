# DevPulse — Conceptual Data Model

Conceptual only — no Firestore collection/document schema is decided yet.
See `docs/SECURITY.md` for the invariants these concepts must respect.

| Concept | Purpose | Personal data? | Sensitive data? | Encryption likely? |
|---|---|---|---|---|
| User | An individual account (identity, later via Firebase Auth) | Yes | No | No |
| Team | A group users belong to, for access scoping | No | No | No |
| TeamMembership | Links a User to a Team, for authorization | Yes (linkage) | No | No |
| Survey | Defines a recurring pulse survey (questions/dimensions) | No | No | No |
| SurveyResponse | One anonymous set of answers to a Survey | No (must not contain identity fields) | Yes | Yes |
| SurveyParticipation | Records that a user completed a survey instance, separate from response content | Yes | No | No |
| SurveyAggregate | Team/period-level rollup of responses, above minimum threshold | No | Possibly (small-team re-identification risk) | No (derived; source responses are encrypted) |
| AnonymousChallenge | Free-text anonymous problem/challenge report | No (must not contain identity fields) | Yes (highly sensitive) | Yes |
| SkillTree | Defines a capability progression (future) | No | No | No |
| SkillNode | One stage within a SkillTree (future) | No | No | No |
| SkillProgress | A team/section's progress against a SkillTree (future) | No | No | No |

## Notes

- `SurveyResponse` and `SurveyParticipation` are intentionally separate
  concepts so that "who participated" cannot be directly joined to "what
  they said" (invariant 7 in `docs/SECURITY.md`).
- `SurveyAggregate` is only computed and exposed when the underlying
  response count meets the configured minimum threshold (invariant 11/12).
- Firestore collection design, field names, and indexes are deferred to
  feature-level `docs/features/<feature-id>/SPEC.md` work.
