@AGENTS.md

# DevPulse

DevPulse is an internal application for developer/team wellbeing and delivery health, starting with short recurring pulse surveys.

## Ground rules

- The repository is the source of truth. Do not rely on prior chat state. Read only the `docs/`, feature files, rules, and code relevant to the current task.
- Implement one task at a time. `docs/features/<feature-id>/TASKS.md` owns task state (`Ready` / `In Progress` / `Done`). Normally only one task should be `In Progress`.
- Prefer small, vertical changes over broad refactors. Avoid unrelated cleanup, speculative abstractions, and scope expansion.
- Use the applicable path-scoped coding rules under `.claude/rules/`; do not duplicate those rules here.
- Run the repository's actual relevant checks before marking work complete, then inspect the actual `git diff`. Never report a command as passing unless it was run and checked.
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
| `docs/PRODUCT.md` | vision, users, non-goals |
| `docs/ARCHITECTURE.md` | system boundaries, technical decisions |
| `docs/SECURITY.md` | privacy/security invariants and review guidance |
| `docs/DATA-MODEL.md` | conceptual data model |
| `docs/ROADMAP.md` | product phases |
| `docs/DEVELOPMENT.md` | development conventions |
| `docs/AI-WORKFLOW.md` | practical Claude Code workflow |
| `docs/features/<feature-id>/SPEC.md` | one feature's requirements |
| `docs/features/<feature-id>/TASKS.md` | one feature's task state |
