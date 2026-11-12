# Archive — historical documents (not current guidance)

Everything in this directory is historical. It describes earlier plans, proposals, decisions and review records. Do not use
it as a description of current behaviour. The current documentation is in the parent `docs/` directory and the code is the
final reference.

Archived on 2026-11-11 during the documentation rebuild. Nothing here was deleted; git history also keeps every version.

| Path | What it is | Current replacement |
| --- | --- | --- |
| `SECURITY-2026-11-11.md` | Previous security invariant list, numbered 1–72 plus erasure, role and workspace invariants | [`../SECURITY.md`](../SECURITY.md) (invariant IDs kept where the code cites them) |
| `ARCHITECTURE-2026-11-11.md` | Previous architecture document | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| `DATA-MODEL-2026-11-11.md` | Previous conceptual data model | [`../DATA-MODEL.md`](../DATA-MODEL.md) |
| `PRODUCT-2026-11-11.md` | Previous product description | [`../PRODUCT.md`](../PRODUCT.md) |
| `DEVELOPMENT-2026-11-11.md` | Previous development guide | [`../DEVELOPMENT.md`](../DEVELOPMENT.md) |
| `README-2026-11-11.md` | Previous README | [`../../README.md`](../../README.md) |
| `ROADMAP-2026-11-11.md` | Previous product phases and planned direction | None. Planning is not kept in the repository |
| `UI-UX-2026-11-11.md` | Previous UI and UX guidance | The implementation in `src/components/ui/` and `src/components/nav/` |
| `design/` | Earlier design-system and redesign documents | The implementation |
| `features/<feature-id>/` | Feature specifications (`SPEC.md`), task lists (`TASKS.md`), verification records and proposals for the previous build | The code, the tests and [`../ROUTES.md`](../ROUTES.md), [`../DATA-MODEL.md`](../DATA-MODEL.md) |

## Notes

- Code comments and some test titles still cite `docs/archive/features/...` paths. They point to the requirement history
  behind the code, not to current requirements.
- Several archived specifications describe behaviour that has since been retired. Examples: the `teamCompetenceAreas`
  system, numeric skill-level routes, the old collaborative profile APIs, the personal target-role feature and the k = 5
  threshold. Do not use them as requirements.
- Operational runbooks have been moved out of the archive to [`../operations/`](../operations/).
