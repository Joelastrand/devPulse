import type { ErasureErrorCopyKey } from "../copy";

/**
 * The client-side erasure flow (TASK-039). It is pure: the Firebase client SDK and `fetch` are injected through
 * `ErasureClientGateway`, so tests never reach a real project. The flow is:
 *
 * 1. re-authenticate the account that is currently signed in, with its password (a fresh sign-in gives a fresh `auth_time`,
 *    SPEC "Confirmation"). The typed e-mail is never used to choose the account, so a different account cannot be signed in;
 * 2. call `POST /api/me/erasure` with the typed e-mail as the confirmation, and keep calling it while the answer is
 *    `in_progress` (resume needs no new sign-in and no confirmation, but the body is harmless to repeat);
 * 3. on `completed`, sign out and report success.
 *
 * It never shows a server detail, identifier, or e-mail. Each failure maps to a fixed copy key, and the flow is total: no
 * gateway rejection escapes it.
 */

/** The HTTP answer of one call, with the JSON body already parsed. */
export interface ErasureApiResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface ErasureClientGateway {
  /** The e-mail of the signed-in account, or null when no account is signed in. */
  signedInEmail(): string | null;
  /** Signs in again the signed-in account with its password. Throws on any failure, with no detail the flow needs. */
  reauthenticate(password: string): Promise<void>;
  /** The current ID token, or null when there is no signed-in user. */
  idToken(): Promise<string | null>;
  /** `POST /api/me/erasure` with `{ confirmation }`. */
  startOrResume(idToken: string, confirmation: string): Promise<ErasureApiResponse>;
  signOut(): Promise<void>;
  wait(ms: number): Promise<void>;
}

export type ErasureFlowResult = { readonly ok: true } | { readonly ok: false; readonly error: ErasureErrorCopyKey };

/** The client calls the resumable endpoint at most this many times before it reports the fixed unavailable copy. */
export const MAX_ERASURE_CALLS = 200;
export const RESUME_INTERVAL_MS = 1000;

export interface ErasureFlowInput {
  readonly email: string;
  readonly password: string;
  /** Called with each `in_progress` answer, so the screen can announce progress without any identifier. */
  readonly onProgress?: () => void;
}

export async function runErasureFlow(input: ErasureFlowInput, gateway: ErasureClientGateway): Promise<ErasureFlowResult> {
  const email = input.email.trim();
  if (email.length === 0 || input.password.length === 0) return { ok: false, error: "required" };

  try {
    if (gateway.signedInEmail() === null) return { ok: false, error: "unauthenticated" };

    try {
      await gateway.reauthenticate(input.password);
    } catch {
      return { ok: false, error: "reauthFailed" };
    }

    for (let call = 1; call <= MAX_ERASURE_CALLS; call += 1) {
      // The token is read on every call, so a long resume never relies on one token's lifetime.
      const idToken = await gateway.idToken();
      if (idToken === null) return { ok: false, error: "unauthenticated" };

      const response = await gateway.startOrResume(idToken, email);
      const outcome = interpret(response);

      if (outcome.kind === "completed") {
        await signOutQuietly(gateway);
        return { ok: true };
      }
      if (outcome.kind === "error") return { ok: false, error: outcome.error };

      input.onProgress?.();
      await gateway.wait(RESUME_INTERVAL_MS);
    }
    return { ok: false, error: "unavailable" };
  } catch {
    // A transport or SDK failure has no detail the person needs. It maps to the fixed generic copy.
    return { ok: false, error: "generic" };
  }
}

type Interpreted =
  | { readonly kind: "completed" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "error"; readonly error: ErasureErrorCopyKey };

/** Maps one answer to the flow's decision. Only fixed codes are read; any other body is treated as a generic failure. */
function interpret(response: ErasureApiResponse): Interpreted {
  const body = typeof response.body === "object" && response.body !== null ? response.body : {};
  const status = "status" in body ? body.status : undefined;
  const error = "error" in body ? body.error : undefined;

  if (response.status === 200) {
    if (status === "completed") return { kind: "completed" };
    if (status === "in_progress") return { kind: "in_progress" };
    return { kind: "error", error: "generic" };
  }

  switch (error) {
    case "recent_auth_required":
      return { kind: "error", error: "recentAuthRequired" };
    case "confirmation_mismatch":
      return { kind: "error", error: "confirmationMismatch" };
    case "erasure_unavailable":
      return { kind: "error", error: "unavailable" };
    case "unauthenticated":
      return { kind: "error", error: "unauthenticated" };
    case "last_superadmin":
      return { kind: "error", error: "lastSuperadmin" };
    default:
      return { kind: "error", error: "generic" };
  }
}

async function signOutQuietly(gateway: ErasureClientGateway): Promise<void> {
  try {
    await gateway.signOut();
  } catch {
    // The erasure is complete. A sign-out failure must not change the answer, and its detail is never shown.
  }
}
