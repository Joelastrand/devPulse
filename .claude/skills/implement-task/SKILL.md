---
description: |
  Implement exactly one DevPulse task from an existing feature TASKS.md.
  Use when the user asks to implement, continue, complete, or work on
  the next task, or says "implement task", "implement next task",
  "continue feature", or similar. Resumes an existing In Progress task
  first; otherwise selects the first unblocked Ready task. Uses
  meaningful test-first development where appropriate, verifies the
  implementation, inspects the diff, updates affected documentation, and
  updates TASKS.md. DO NOT use to define feature requirements; use
  `plan-feature`. DO NOT use to create or reorganize tasks; use
  `split-tasks`. DO NOT use for an unrelated concrete defect; use
  `debug`. DO NOT implement more than one task per invocation.
name: implement-task
---

# implement-task

Implement exactly one task completely: a small, verified, reviewable change
that satisfies the task and its covered feature requirements, without
relying on conversational memory. Stop after one task.

## Principles

- `SPEC.md` owns requirements; `TASKS.md` owns task state. Resume an
  `In Progress` task before starting another.
- Prefer the smallest complete solution; never silently expand scope.
- Use test-first development where it creates a useful red/green loop,
  especially for authorization, team isolation, encryption, aggregation,
  validation, domain rules, server behavior, data transformations, and
  regression-prone behavior. Don't force artificial TDD onto trivial
  presentation-only changes, and never weaken or remove a valid test to
  make verification pass.
- Documentation affected by the task is part of completing it.

## Step 1 — Context, select, and validate

Read `docs/features/<feature-id>/SPEC.md`, `TASKS.md`, and relevant
sections of `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATA-MODEL.md`,
plus code/tests relevant to the task.

Select work in order: (1) if exactly one task is `In Progress`, resume it;
(2) otherwise pick the first unblocked `Ready` task (dependencies `Done`);
(3) if the user names a task explicitly, use it if eligible. Never start a
second task. If multiple tasks are unexpectedly `In Progress`, stop and
report the inconsistency rather than guessing.

Confirm the task exists, its dependencies are satisfied, its `BR-*`
references exist in `SPEC.md`, and acceptance criteria are clear. If a
material product, security, or architecture decision is missing, stop and
report the decision, why implementation depends on it, and where it should
be recorded. Ordinary implementation choices that don't change the external
contract may be made autonomously.

## Step 2 — Mark In Progress and establish the change boundary

If the task is `Ready`, set its status to `In Progress` and update summary
counts. When the working tree is dirty or the task may span multiple
commits, record `git rev-parse HEAD` and `git status --short` to help
distinguish the task's changes later — this isn't required for a normal
clean-tree task. Never reset or discard pre-existing user changes.

Inspect the smallest relevant area of the codebase: existing patterns, the
affected public/server/domain boundary, existing tests, and the relevant
Firebase/security boundary. Prefer extending established patterns over new
abstractions; don't build architecture for hypothetical future features.

## Step 3 — Establish RED where appropriate

Choose the highest useful observable boundary (server/API →
application/domain → component/user-visible → focused lower-level only if
nothing better exists). When a meaningful test-first boundary exists, add
the smallest test expressing the missing behavior, run the narrowest
command that executes it, and confirm it fails for the expected reason (not
a syntax error, broken setup, or unrelated failure). If it unexpectedly
passes, determine whether the behavior already exists, the test is
insufficient, or the task is stale — don't proceed blindly.

## Step 4 — Implement the smallest complete solution

Implement only what the task needs, following `SPEC.md`, its acceptance
criteria, and established repository patterns. For Firebase-related code:
respect client/server boundaries, never introduce real credentials or
expose server secrets to client code, never store sensitive survey payloads
as plaintext or place identity fields into anonymous response records, and
never log sensitive payloads.

Don't implement future tasks preemptively. If unavoidable minimal
supporting work surfaces, keep it tightly tied to the current task; if
substantial new work is required, stop and report that task planning may
need revision rather than silently expanding scope.

## Step 5 — Verify GREEN and refactor

Run targeted verification for the behavior; confirm any test-first test now
passes, then run other directly affected tests, fixing failures caused by
the implementation. Report unrelated pre-existing failures explicitly
rather than "fixing" unrelated code to look green.

Once behavior is correct, refactor the changed code only where it improves
this task (duplication, unclear naming, excessive nesting, needless
abstraction) while keeping tests green. Don't perform repository-wide
cleanup.

Before completion, run the repository's actual broader checks (e.g.
`pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`) — only
ones that exist. If no test script exists, say so and use the strongest
available verification instead of inventing a result. Resolve every failure
caused by the task.

## Step 6 — Inspect the diff and check requirements

Inspect `git status --short` and `git diff` (compare against the recorded
starting commit if one was taken). Separate this task's changes from
pre-existing working-tree changes. Confirm: every change relates to the
task; no accidental files, secrets, or sensitive sample data were
introduced; no debug logging remains; no requirement or security invariant
was silently changed or weakened; tests verify meaningful behavior; nothing
from a future task leaked in. Fix any problem found and rerun affected
verification.

Verify the implementation against every `BR-*` listed under the task's
`Covers`, and every acceptance criterion individually — don't infer
completion merely because tests pass. If an acceptance criterion can't be
satisfied without changing the approved spec, stop and report the conflict.

## Step 7 — Update docs and mark Done

Update an existing authoritative doc only when the implementation
establishes durable information (architecture decision, security
constraint, data-model change, dev command, public contract, or a
feature-specific note future sessions will need). Don't document obvious
implementation detail or duplicate project-wide rules into feature docs.

Mark the task `Done` (from `In Progress`) only when: required behavior is
implemented, acceptance criteria are satisfied, relevant tests and
lint/typecheck/build pass, the diff has been inspected, no known
task-caused security violation remains, and relevant documentation is
updated. Update `TASKS.md` summary counts; preserve the task ID, coverage,
acceptance criteria, and useful notes. Never mark a task `Done` with
incomplete or failing verification.

## Step 8 — Report and stop

Report the task ID/title, outcome, tests added/changed, verification
commands and results, files changed, documentation updated, and any
deviations or remaining risk. If the task couldn't be completed, report
current state, the blocker, verification already done, and the exact
decision or action needed next.

Do not invoke `review-change` automatically. Do not start the next task.
Stop after exactly one task.
