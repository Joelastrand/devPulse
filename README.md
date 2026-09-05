# DevPulse

DevPulse is an internal application for developer/team wellbeing and delivery health, starting with short recurring pulse surveys.

The product focuses on team-level trends and sustainable delivery rather than individual performance measurement. DevPulse is also a practical proof of concept for disciplined AI-assisted software development.

See `docs/PRODUCT.md` for the product vision, scope, and non-goals.

## Getting started

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Scripts

Use `package.json` as the source of truth for available commands.

Common commands:

```bash
pnpm dev
pnpm build
pnpm start
pnpm lint
pnpm typecheck
```

Run additional checks such as `pnpm test` only when the corresponding script exists.

pnpm is the package manager for this repository. `pnpm-lock.yaml` is the lockfile.

## AI-assisted development

DevPulse uses a repository-driven Claude Code workflow. Requirements, task state, durable decisions, coding rules, and security invariants live in the repository so work can continue in a fresh AI session without depending on previous conversation history.

The repository has six workflow skills:

- `plan-feature`
- `split-tasks`
- `implement-task`
- `review-change`
- `debug`
- `security-review`

It also has five path-scoped coding rules:

- `typescript`
- `nextjs-react`
- `architecture`
- `security`
- `tests`

For the practical step-by-step process, example prompts, session boundaries, rules, feature implementation loop, debugging, and security reviews, see **`docs/AI-WORKFLOW.md`**.

## Claude Code instruction model

```text
CLAUDE.md
  → universal repository and workflow rules

.claude/rules/
  → path-scoped coding constraints

.claude/skills/
  → procedures for carrying out work

docs/
  → durable product/system truth

docs/features/<feature-id>/SPEC.md
  → feature requirements

docs/features/<feature-id>/TASKS.md
  → task definitions and task state

git
  → what actually changed
```

Avoid duplicating the same rule across these layers.

### Coding rules

```text
.claude/rules/
├── typescript.md
├── nextjs-react.md
├── architecture.md
├── security.md
└── tests.md
```

Rules are intentionally small and path-scoped. They should capture durable constraints Claude is likely to violate without guidance, not duplicate what TypeScript, ESLint, formatting, or other tooling already enforces.

`docs/SECURITY.md` remains authoritative for security/privacy policy.

## Documentation

- `docs/PRODUCT.md` — product purpose, scope, and non-goals
- `docs/ARCHITECTURE.md` — architecture decisions and technical boundaries
- `docs/SECURITY.md` — authoritative security/privacy invariants
- `docs/DATA-MODEL.md` — conceptual data model
- `docs/ROADMAP.md` — product phases and planned direction
- `docs/DEVELOPMENT.md` — development conventions
- `docs/AI-WORKFLOW.md` — practical Claude Code workflow
- `docs/features/<feature-id>/SPEC.md` — feature requirements and behavioral contract
- `docs/features/<feature-id>/TASKS.md` — feature tasks and task state

Repository-wide agent instructions live in `CLAUDE.md` and `AGENTS.md`.

## Repository as memory

```text
CLAUDE.md                          → universal rules
.claude/rules/                    → path-scoped coding rules
.claude/skills/*/SKILL.md         → workflow procedures
docs/PRODUCT.md                    → durable product intent
docs/ARCHITECTURE.md               → durable architecture decisions
docs/SECURITY.md                   → security/privacy invariants
docs/DATA-MODEL.md                 → conceptual data model
docs/features/<feature-id>/SPEC.md → feature requirements
docs/features/<feature-id>/TASKS.md→ task definitions and state
git                                → what actually changed
```

## Project structure

The intended application architecture favors vertical feature slices:

```text
app/                       Existing Next.js App Router code
src/
├── app/                   Target App Router location when adopted explicitly
├── features/              Feature-owned domain/application/UI code
│   └── <feature>/
├── components/
│   └── ui/                Reusable presentation primitives
└── lib/                   Genuinely shared infrastructure

docs/
.claude/
├── rules/
└── skills/
```

Do not mass-move existing files merely to match this diagram. Structural migrations should be explicit work.

## Technology

DevPulse is a Next.js application written in strict TypeScript.

Firebase is the selected backend platform. Architecture, data-model, and security decisions belong in `docs/ARCHITECTURE.md`, `docs/DATA-MODEL.md`, and `docs/SECURITY.md`.

pnpm is the repository package manager.

## Security and privacy

DevPulse handles potentially sensitive wellbeing information. Security and privacy are architectural requirements, not a final implementation step.

`docs/SECURITY.md` is authoritative. Do not use real employee/wellbeing data in development or test fixtures, do not commit secrets, and do not weaken anonymity, access-control, encryption, or minimum-cohort protections for implementation convenience.
