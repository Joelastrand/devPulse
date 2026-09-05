---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# TypeScript

- Use strict TypeScript.
- Avoid `any`; prefer `unknown` and narrow explicitly.
- Prefer inference when the type is obvious.
- Use explicit types at public, external, persistence, and trust boundaries.
- Use `import type` for type-only imports.
- Prefer discriminated unions over interacting boolean flags.
- Avoid unsafe type assertions unless the invariant is established at a trusted boundary.
- Avoid non-null assertions unless correctness is guaranteed and obvious.
- Model domain concepts with meaningful types rather than loosely shaped objects.
- Validate untrusted runtime data before treating it as a TypeScript type.
- Prefer small functions with one clear responsibility and early returns over deep nesting.
- Avoid abstractions or generic helpers without a concrete current need.
- Do not duplicate domain logic across UI, server, and persistence layers.
- Comments should explain non-obvious decisions or invariants, not restate code.
- Let TypeScript, ESLint, and formatting tooling enforce style where they can do so reliably.
