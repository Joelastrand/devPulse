/**
 * The narrow capability that lets one protected operation, the erasure start/resume endpoint, pass the in-progress fence
 * (TASK-038, approved boundary). A boolean option could be passed by any caller, and a name-based guard can be defeated by
 * an alias or a spread. A capability is different in two ways:
 *
 * - Type: `ErasureResumeCapability` carries a unique-symbol brand, so a plain `true` or an object literal does not type-check.
 * - Runtime: a capability is recognised only if this module minted it. The issuer records each token in a WeakSet, and
 *   `isErasureResumeCapability` checks membership, so a forged object is refused even with a cast.
 *
 * Issuance is restricted to `account-erasure/server/start-erasure.ts`. That is enforced by a static test, so a new caller
 * must be added there explicitly. The capability is never persisted, logged, or returned.
 */

declare const erasureResumeBrand: unique symbol;

export type ErasureResumeCapability = { readonly [erasureResumeBrand]: "erasure-resume" };

const issued = new WeakSet<object>();

/** Mints a capability. Call only from the erasure start/resume operation. */
export function issueErasureResumeCapability(): ErasureResumeCapability {
  const token = Object.freeze({}) as ErasureResumeCapability;
  issued.add(token);
  return token;
}

export function isErasureResumeCapability(value: unknown): value is ErasureResumeCapability {
  return typeof value === "object" && value !== null && issued.has(value);
}
