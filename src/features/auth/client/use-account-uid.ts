"use client";

import { useEffect, useState } from "react";
import { observeIdToken } from "./auth-client";

/**
 * The signed-in Firebase account UID, or `null` while signed out, while an account switch is in progress, and before the
 * first auth emission. Used only to scope local presentation preferences. It is never an e-mail address, and it is never
 * treated as authorization: every protected request is still verified on the server.
 */
export function useAccountUid(): string | null {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(
    () =>
      observeIdToken((token, nextUid) => {
        setUid(token === null ? null : nextUid);
      }),
    [],
  );
  return uid;
}
