---
paths:
  - "app/**/*.ts"
  - "app/**/*.tsx"
  - "src/**/*.ts"
  - "src/**/*.tsx"
---

# Architecture

Prefer vertical feature slices.

The intended feature location is:

`src/features/<feature>/`

A feature may own:
- domain types
- runtime validation
- DTOs and persistence shapes
- mappers
- server operations
- domain/application logic
- feature-specific components
- feature-specific tests

Examples:

```text
src/features/pulse-survey/
src/features/teams/
src/features/results/
src/features/auth/
```

Rules:

- Organize feature-specific code by feature rather than primarily by technical type.
- Do not create global `services`, `repositories`, `hooks`, `utils`, or `types` folders for code owned by one feature.
- Use `src/lib/` only for genuinely shared infrastructure such as Firebase initialization, encryption, logging, and environment/config handling.
- Use `src/components/ui/` for reusable presentation primitives; do not place business logic there.
- Route/framework entry points may depend on features; features must not depend on route/page files.
- Shared infrastructure must not depend on feature UI.
- Avoid cross-feature imports that create hidden coupling.
- Extract shared code only when genuine shared ownership is demonstrated.
- Do not introduce architectural layers for hypothetical future needs.
- Do not mass-move existing files merely to satisfy this rule; structural migrations require an explicit task.
