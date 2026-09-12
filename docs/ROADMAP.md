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

- **Phase 4 — Anonymous Challenges**:
  anonymous free-text challenge submission.

- **Phase 5 — Developer Forum Capabilities**.

- **Phase 6 — Skill / Capability Trees**.

Phases 0–3 are complete. Phase 4 is the next planned phase.
See `docs/PRODUCT.md` for the product vision and non-goals.