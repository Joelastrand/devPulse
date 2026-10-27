"use client";

import { useCallback, useRef, useState } from "react";

export interface SingleFlight {
  pending: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}

/**
 * One action at a time for one participant view (SPEC BR-48 and the TASK-030 duplicate rule). The `inFlight` ref is set
 * before the first `await`, so a second call in the same tick is refused before any re-render disables the control. The
 * guard is released when the action ends, and an action is never retried by the guard itself.
 */
export function useSingleFlight(): SingleFlight {
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}
