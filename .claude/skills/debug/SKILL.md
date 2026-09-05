---
description: |
  Investigate and fix one concrete DevPulse defect using a disciplined
  reproduce, minimize, hypothesize, instrument, fix, and regression-test
  workflow. Use when the user reports a bug, failing behavior,
  unexpected result, regression, failing test, or says "debug", "fix
  bug", "investigate failure", or similar. DO NOT use to define a new
  feature; use `plan-feature`. DO NOT use to split planned feature work;
  use `split-tasks`. DO NOT use for normal implementation of a Ready
  task; use `implement-task`. DO NOT use for a broad security
  assessment; use `security-review`.
name: debug
---

# debug

Investigate and resolve exactly one concrete defect: find the actual
cause, make the smallest correct fix, and leave behind verification that
prevents it from silently returning. Do not guess and patch.

## Principles

- Evidence beats speculation. Reproduce before fixing whenever practical;
  minimize the failing case before broadening investigation.
- Change one variable at a time: one falsifiable hypothesis, test it, then
  form the next. Instrument only when existing evidence is insufficient,
  and remove temporary instrumentation before completion.
- Fix the cause, not the symptom. Keep the fix narrowly scoped — no
  unrelated refactors. Never weaken security/validation, or delete/weaken
  a valid failing test, just to make something go green.
- Never expose sensitive data (survey answers, free text, keys, tokens,
  credentials, wellbeing data) through debug output, instrumentation, or
  logs.

## Step 1 — Establish context

Understand the reported defect: expected vs. observed behavior, known
reproduction conditions, and unverified assumptions. Read the relevant
feature's `SPEC.md`/`TASKS.md` if applicable, relevant sections of
`docs/SECURITY.md` and `docs/ARCHITECTURE.md`, relevant code/tests, and
available error messages or logs. If expected behavior is genuinely
undefined, stop and report the missing product decision rather than
inventing it.

Inspect `git status --short`/`git diff` to identify pre-existing
working-tree changes (never reset or discard them); when useful, record
`git rev-parse HEAD` as a starting point.

## Step 2 — Reproduce and minimize

Find the smallest reliable reproduction, preferring in order: a focused
automated test, a server/API call, a domain/application invocation, a
focused UI interaction, or an existing failing command. If it can't be
reproduced, verify the reported conditions, inspect available evidence, try
a smaller repro, and report uncertainty explicitly rather than claiming a
root cause without evidence.

When practical, encode the reproduction as a failing regression test
before touching production code, and confirm it fails for the expected
reason (not broken setup, syntax errors, or an unrelated failure). If an
automated test would be low-value or impractical, document the
manual/command-based reproduction instead.

Then reduce to the smallest input/state/request that still fails, and
identify which boundary the failure primarily belongs to (input/
validation, domain logic, state transition, server/API, authorization,
Firebase/data access, serialization, UI state, configuration,
concurrency/timing, integration boundary). Don't modify production code yet
unless instrumentation is required.

## Step 3 — Hypothesize and gather evidence

State one concrete, falsifiable hypothesis (e.g. "`teamId` is validated on
the client but not checked against the authenticated user's memberships on
the server") and identify the smallest observation that would confirm or
reject it.

If current evidence can't test it, add the smallest temporary
instrumentation needed — focused assertions, test diagnostics, a local
debugger, or narrow dev-only logging (never sensitive data). Confirm or
reject using code inspection, tests, or instrumentation. If rejected, form
the next single hypothesis and repeat — don't accumulate speculative
changes while investigating.

## Step 4 — Fix the root cause

Once evidence supports a cause, implement the smallest complete fix,
following established patterns, the relevant `SPEC.md`, and
`docs/SECURITY.md`. Don't bypass validation, weaken authorization, disable
encryption, broaden Firestore access, expose server-only data to the
client, add sensitive logging, or fix unrelated nearby issues. If the
correct fix requires a material product/architecture decision, stop and
report it rather than guessing.

## Step 5 — Verify and check for regressions

Run the original reproduction; confirm any added regression test now
passes; run relevant nearby tests. Verify the fix addresses the original
observed behavior, not a different symptom. Inspect the changed boundary
for closely related behavior the fix could affect, adding tests only where
there's meaningful regression risk — for security-sensitive defects,
explicitly verify the denied/negative path as well as the successful one.
Don't expand into a broad rewrite.

Run the repository's actual relevant checks (e.g. `pnpm test`, `pnpm
lint`, `pnpm typecheck`, `pnpm build`) — only ones that exist — and
report unrelated pre-existing failures separately.

## Step 6 — Inspect the diff, update docs, report

Inspect `git status --short`/`git diff` and confirm: the fix is narrowly
scoped; the regression test represents the defect; temporary
instrumentation and sensitive logging are removed; no secrets or sensitive
fixtures were introduced; no security invariant was weakened. Fix anything
found and rerun affected verification.

Update existing documentation only if the defect revealed durable
information future work must know (corrected architecture assumption,
security invariant, integration constraint, changed public behavior);
update `TASKS.md` only if the bug belongs to an active task and its
state/notes need to stay accurate. Don't build bug-history documentation
git and tests already cover.

Report: defect, reproduction, root cause, fix, regression test,
verification commands/results, files changed, and remaining risk. If
unresolved, report what was reproduced, hypotheses rejected, current
evidence, and what blocks further diagnosis.

Do not start unrelated work. Stop after the defect is resolved or the
investigation reaches a concrete blocker.
