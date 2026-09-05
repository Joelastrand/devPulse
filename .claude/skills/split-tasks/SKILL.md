---
description: |
  Split an approved DevPulse feature specification into small
  implementation tasks. Use when the user asks to split, break down,
  create tasks from, or prepare implementation work for an existing
  SPEC.md, or says "split tasks", "create tasks", "break down the
  feature", or similar. Produces `docs/features/<feature-id>/TASKS.md`.
  DO NOT use to define or clarify feature requirements; use
  `plan-feature`. DO NOT implement tasks; use `implement-task`. DO NOT
  use for a concrete defect; use `debug`.
name: split-tasks
---

# split-tasks

Turn exactly one approved feature specification into a small, ordered set of
implementation tasks that another Claude Code session can implement
independently, with no conversational context. Do not implement any task.

## Principles

- `SPEC.md` owns requirements; `TASKS.md` owns task state. Reference `BR-*`
  IDs rather than restating requirements.
- Prefer small vertical slices (one working behavior across all needed
  layers) over horizontal technical layers (types-only, repository-only,
  UI-only tasks) unless a horizontal split is independently valuable.
- Each task should have one primary outcome, cover a small set of related
  requirements, and be reviewable as one coherent diff.
- Include tests/verification inside the task that needs them — never a
  separate "add tests later" task.
- Don't invent requirements absent from the spec, and don't silently resolve
  open product decisions.

## Step 1 — Establish context

Identify the `<feature-id>`. Read `docs/features/<feature-id>/SPEC.md` and
relevant sections of `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
`docs/DATA-MODEL.md`, plus existing code/tests if the feature extends
existing behavior. If `TASKS.md` already exists, read it first and preserve
completed tasks, notes, dependencies, and current state — don't regenerate
from scratch unless explicitly asked.

## Step 2 — Validate the specification

Check that scope is clear, behavioral requirements have stable IDs,
acceptance criteria are testable, important access/security behavior is
defined, and no blocking product decision remains (minor technical choices
that can reasonably be made during implementation don't block splitting).
If a material requirement is unresolved, stop and report the decision, why
it blocks planning, and recommend returning to `plan-feature`. Do not invent
the answer.

## Step 3 — Slice, order, and size

Slice behavioral requirements into the smallest useful vertical tasks, e.g.
prefer one `TASK-001: working server behavior including domain logic and
verification` over `TASK-001 types / TASK-002 repository / TASK-003 API /
TASK-004 UI / TASK-005 tests`.

Order for early feedback — a tracer-bullet sequence: smallest end-to-end
behavior → additional core behavior → important edge cases →
security/access restrictions → secondary UX → cleanup only if required.
Security requirements are not automatically deferred: include an invariant
in the earliest task where it becomes relevant, and never create a temporary
architecture that violates `docs/SECURITY.md`.

Split a task further when it has multiple unrelated outcomes, needs
multiple independent architectural changes, would produce a very large
diff, or can't be clearly verified — but never split merely to create more
tasks. Avoid tasks whose only purpose is "create types/interfaces/folders"
or "add tests later" unless that work is independently necessary.

## Step 4 — Assign IDs and dependencies

Use stable IDs (`TASK-001`, `TASK-002`, ...); never renumber existing tasks
when inserting new ones — assign the next unused ID instead. For each task,
record requirements covered (`Covers: BR-1, BR-3`), dependencies (by task
ID), observable outcome, verification approach, security/privacy impact,
and documentation impact. Keep tasks independent where safely possible;
avoid unnecessary dependency chains.

## Step 5 — Write TASKS.md

Create or update `docs/features/<feature-id>/TASKS.md`:

```markdown
# <Feature title> — Tasks

Specification: [SPEC.md](./SPEC.md)

## Status
Ready: <n>  In Progress: <n>  Done: <n>

## Tasks

### TASK-001 — <Outcome-oriented title>

**Status:** Ready
**Covers:** BR-1, BR-2
**Depends on:** None

**Outcome**
Observable behavior that exists when this task is complete.

**Implementation notes**
Only constraints/decisions needed to implement — no unnecessary detail.

**Verification**
- Expected behavioral test/verification boundary
- Relevant lint/typecheck/build requirements

**Security / privacy**
Feature-specific implications, or `No additional considerations`.

**Documentation impact**
Docs that may need updates, or `None expected`.

**Acceptance criteria**
- [ ] Observable criterion
- [ ] Relevant tests pass
- [ ] No conflict with `docs/SECURITY.md`
- [ ] Relevant documentation is updated

---

### TASK-002 — <title>
...
```

Only use states `Ready`, `In Progress`, `Done` — normally zero or one task
`In Progress`. Keep completed tasks in the file; don't reconstruct history
from conversation memory. If a task is blocked by another, keep it `Ready`
and express the dependency via `Depends on`. If blocked by an unresolved
product decision, record it in the task and report it — don't invent a new
status.

If three or more tasks have meaningful dependencies, add a small Mermaid
graph (`flowchart LR`); skip it when the sequence is obvious.

## Step 6 — Check coverage and workflow

Before finishing, confirm: every in-scope `BR-*` maps to at least one task
(explain any intentional exception); no task implements behavior outside
the spec; security requirements appear in the right task; tasks are
vertical and sized for one `implement-task` cycle; verification is inside
the task, not deferred; `SPEC.md` is unchanged (barring a factual link/path
fix); existing `Done` tasks and task IDs are preserved; no task was marked
`Done`; no implementation code was changed.

## Step 7 — Present and stop

Report the feature, number of tasks created, requirement coverage, key
dependencies, any unresolved blocker, and the path to `TASKS.md`.

Do not invoke `implement-task` automatically. Do not begin `TASK-001`. Stop
after the task plan is ready for review.
