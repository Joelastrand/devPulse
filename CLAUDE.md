@AGENTS.md

# DevPulse

DevPulse is an internal application for developer/team wellbeing and delivery health, starting with short recurring pulse surveys.

## Ground rules

- The repository is the source of truth. Do not rely on prior chat state. Read only the `docs/`, feature files, rules, and code relevant to the current task.
- Implement one task at a time. `docs/features/<feature-id>/TASKS.md` owns task state (`Ready` / `In Progress` / `Done`). Normally only one task should be `In Progress`.
- Prefer small, vertical changes over broad refactors. Avoid unrelated cleanup, speculative abstractions, and scope expansion.
- Use the applicable path-scoped coding rules under `.claude/rules/`; do not duplicate those rules here.
- Run the repository's actual relevant checks before marking work complete, then inspect the actual `git diff`. Never report a command as passing unless it was run and checked.
- Routine verification is task-scoped. Name the files you changed or that the task owns: `pnpm test:quick --files <paths>` while implementing, and `pnpm test:standard --files <paths>` before reporting a task done. Both always run the security guards. Do not use `--changed` (all working-tree changes) unless the user asks, because this repository holds hundreds of unrelated uncommitted changes.
- A task-scoped quick or standard run is feedback for the task, not complete verification. Do not describe it as the full suite.
- Do not run the whole suite (`pnpm test`, about 9 minutes) after small changes. Use `pnpm test:full` only for milestones, architecture changes, encryption, authorization, Firestore schema or rules, and release work. Run `pnpm test:emulator` for changes to persistence, erasure, the superadmin registry, Firestore rules, or transactions. See `docs/TESTING.md` §1a.
- Use pnpm for repository commands. `package.json` is the source of truth for available scripts.
- Update the relevant durable document when a product, architecture, security, data, or feature contract changes.
- Never commit secrets, invent credentials, or expose sensitive survey/free-text/key material.
- Never weaken or bypass a `docs/SECURITY.md` invariant to make implementation or tests pass. Stop and report the conflict instead.
- Do not invent unresolved product, security, or architecture decisions. Stop and report them rather than guessing.
- Do not deploy or modify production/cloud infrastructure without an explicit request.

## Instruction ownership

```text
CLAUDE.md
  → universal repository/workflow rules

.claude/rules/
  → path-scoped coding constraints

.claude/skills/
  → workflow procedures

docs/
  → durable project truth

docs/features/<feature-id>/SPEC.md
  → feature requirements

docs/features/<feature-id>/TASKS.md
  → task definitions and state

git
  → actual repository changes
```

## Documentation map

| File | Contents |
| --- | --- |
| `docs/PRODUCT.md` | product as implemented: users, features, workflows, non-goals |
| `docs/ARCHITECTURE.md` | stack, layout, request path, feature slices, Firebase integration |
| `docs/ROUTES.md` | pages, navigation, redirects, API route groups and access |
| `docs/SECURITY.md` | authentication, authorization, privacy thresholds, encryption, erasure |
| `docs/DATA-MODEL.md` | Firestore collections, document IDs, validation, erasure classes |
| `docs/DEVELOPMENT.md` | setup, environment, emulators, scripts, operational tools |
| `docs/TESTING.md` | test layers, guards, expected-fail cases |
| `docs/KNOWN-LIMITATIONS.md` | verified gaps, operational limits, technical debt |
| `docs/AI-WORKFLOW.md` | practical Claude Code workflow |
| `docs/operations/` | operator runbooks (account erasure, superadmin bootstrap) |
| `docs/archive/` | historical specs and superseded documents. Not current guidance |
| `docs/features/<feature-id>/SPEC.md` | one feature's requirements, when a new feature is planned (none is live now) |
| `docs/features/<feature-id>/TASKS.md` | one feature's task state, when a new feature is planned (none is live now) |
