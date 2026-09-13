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

- **Phase 5 — Anonymous Challenges**:
  anonymous free-text challenge submission.

- **Phase 6 — Developer Forum Capabilities**.

- **Phase 7 — Skill / Capability Trees**.

Phases 0–4 are complete. See `docs/PRODUCT.md` for the product vision and
non-goals.