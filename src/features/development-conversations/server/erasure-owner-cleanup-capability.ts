import "server-only";

/**
 * The narrow capability that lets the account-erasure owner cleanup delete an owner conversation without the owner fence
 * (TASK-027, TASK-038 approved boundary). A caller-controlled `unfenced` option was removed from `deleteConversation` on
 * 2026-11-02, because any caller could then disable the erasure fence with one property.
 *
 * - Type: the capability carries a unique-symbol brand, so a plain `true` or an object literal does not type-check.
 * - Runtime: the issuer records each token in a WeakSet, and `isErasureOwnerCleanupCapability` checks membership, so a
 *   forged object is refused even with a cast.
 *
 * Issuance is restricted to three approved erasure modules (conversations-erasure.ts, production-erasure-handlers.ts and
 * membership-destruction-adapter.ts). A static test enforces that exact list, so a new minter
 * must be added there explicitly. The capability is never persisted, logged, serialised, or returned to a client.
 */

declare const erasureOwnerCleanupBrand: unique symbol;

export type ErasureOwnerCleanupCapability = { readonly [erasureOwnerCleanupBrand]: "erasure-owner-cleanup" };

const issued = new WeakSet<object>();

/** Mints a capability. Call only from the erasure owner-conversation cleanup step. */
export function issueErasureOwnerCleanupCapability(): ErasureOwnerCleanupCapability {
  const token = Object.freeze({}) as ErasureOwnerCleanupCapability;
  issued.add(token);
  return token;
}

export function isErasureOwnerCleanupCapability(value: unknown): value is ErasureOwnerCleanupCapability {
  return typeof value === "object" && value !== null && issued.has(value);
}
