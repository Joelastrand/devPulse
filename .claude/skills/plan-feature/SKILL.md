---
description: |
  Plan one new DevPulse feature before implementation. Use when the user
  asks to plan, define, specify, design, or clarify a feature, or says
  "plan feature", "create spec", or similar. Produces
  `docs/features/<feature-id>/SPEC.md`. DO NOT use to split an existing
  spec into tasks; use `split-tasks`. DO NOT use to implement code; use
  `implement-task`. DO NOT use for a concrete defect; use `debug`.
name: plan-feature
---

# plan-feature

Plan exactly one feature and turn it into a precise, implementation-ready
specification. The goal is shared understanding before code is written.
Do not implement the feature.

## Principles

- Distinguish **already known** (repository docs, code, tests, prior
  approved specs) from **needs a decision** (genuinely unresolved). Never
  ask the user about the former.
- Ask only about decisions that materially affect behavior, scope,
  security/privacy, architecture, or acceptance criteria — not
  implementation trivia.
- Batch independent questions together; defer a question until its
  prerequisite decision is answered. Recommend a default when one option is
  clearly preferable.
- Use `docs/SECURITY.md` as the authoritative security policy — record only
  feature-specific implications in the spec, never copy the policy itself.
- Keep the specification concise but implementation-ready.

## Step 1 — Establish context

Choose a short kebab-case `<feature-id>`. Read `docs/PRODUCT.md`,
`docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DATA-MODEL.md`, and any
relevant existing spec, code, or tests. If
`docs/features/<feature-id>/SPEC.md` already exists, read and update it
rather than discarding prior decisions.

## Step 2 — Separate facts from decisions

List what's already known (see Principles) and what needs a decision.
Typical decision areas: user-visible behavior, actors/permissions, scope
boundaries, anonymous vs. authenticated behavior, failure behavior,
lifecycle/state transitions, edge cases, privacy/security/retention
implications, behavior at the minimum aggregation threshold, and behavior
when required data is unavailable.

## Step 3 — Clarify in rounds

Ask one batch of numbered questions, each with a brief rationale and a
recommended answer where appropriate:

> 1. Should a closed survey stop accepting responses?
> Recommended: Yes — closed surveys become read-only so aggregates don't
> change unexpectedly.

Incorporate answers, surface any newly exposed decisions, and repeat only if
material ambiguity remains. Don't prolong planning for low-value details.

## Step 4 — Define behavioral boundaries

Identify the highest useful observable boundary for later testing, in order
of preference: server/API contract, application/domain boundary, then
user-visible UI behavior. Avoid specifying tests against private helpers
unless no better boundary exists. Record these boundaries — `split-tasks`
and `implement-task` depend on them.

## Step 5 — Security and privacy check

Explicitly determine whether the feature touches authentication,
authorization, team isolation, anonymous identity separation, sensitive
survey data, application-level encryption, Firestore access, logging/error
reporting, the minimum response threshold, personal data, retention, or
abuse/rate-limiting. For anonymous responses, explicitly consider whether
timestamps, identifiers, participation records, or logs could allow
correlation back to a person. Record only feature-specific implications.

## Step 6 — Write the specification

Create or update `docs/features/<feature-id>/SPEC.md`:

```markdown
# <Feature title>

## Status
Draft | Approved

## Problem
What user or organizational problem does this solve?

## User outcome
What becomes possible when this is complete?

## Scope
## Out of scope
## Key concepts
Only feature-specific terms whose meaning must stay consistent.

## Actors and access
Who can perform or observe which behavior? Use `N/A` if none.

## User stories
1. As a <actor>, I want <behavior> so that <outcome>.

## Behavioral requirements
Numbered, observable, stable IDs: BR-1, BR-2, BR-3. Describe behavior, not
implementation.

## Edge cases and failure behavior

## Security and privacy
Feature-specific implications of `docs/SECURITY.md`. Use `No additional
requirements` when appropriate.

## Architecture decisions
Only decisions this feature needs. Mark unresolved ones `Open`. Don't
invent final Firestore structure unless the feature requires it.

## Test boundaries
| Boundary | Covers |
|---|---|
| ... | BR-1, BR-2 |

## Acceptance criteria
- [ ] Objectively verifiable criterion

## Open questions
Only decisions that genuinely block or materially affect implementation.
Use `None` when resolved.
```

## Step 7 — Check and present

Before presenting, verify: scope is narrow enough for one feature;
requirements don't contradict `PRODUCT.md` or `SECURITY.md`; terminology is
consistent; every user story is backed by a behavioral requirement;
acceptance criteria are verifiable; open questions are real decisions, not
implementation detail; no implementation or task breakdown has started; no
project-wide rule was duplicated.

Summarize the feature, key decisions, remaining open questions, and the spec
path. Ask the user to approve or adjust.

Do not invoke `split-tasks` automatically. Do not implement anything. Stop
after the specification is ready for approval.

## Lightweight path

A full `SPEC.md` is unnecessary for a trivial, low-risk change (copy fix,
obvious styling correction, simple rename, config tweak with no
behavioral/security impact). Instead, write a short mini-spec in the
conversation — what changes, why, how it's verified — then stop. If there's
any uncertainty about behavior, security, data, permissions, or scope, use
the full workflow above.
