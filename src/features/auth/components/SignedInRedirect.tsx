"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { useAuthGatedResource } from "../client/use-auth-gated-resource";
import { resolveSignInDestination } from "../domain/continuation";

interface SignedInRedirectProps {
  /** The raw `continue` value; validated by `resolveSignInDestination`. */
  continuation?: string | string[] | null;
}

/**
 * Sends a visitor who is already signed in away from `/sign-in`
 * (docs/archive/features/managed-surveys/SPEC.md — BR-40). Only the first auth
 * emission is acted on, so a sign-in completed on this page still shows the
 * existing success message with its continue link instead of redirecting
 * unexpectedly.
 */
export function SignedInRedirect({ continuation }: SignedInRedirectProps) {
  const router = useRouter();
  const decidedRef = useRef(false);

  useAuthGatedResource((token) => {
    if (decidedRef.current) {
      return;
    }
    decidedRef.current = true;

    if (token !== null) {
      router.replace(resolveSignInDestination(continuation).path);
    }
  });

  return null;
}
