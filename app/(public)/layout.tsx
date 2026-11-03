import type { ReactNode } from "react";
import { PublicHeader } from "../../src/components/nav/PublicHeader";
import { SKIP_LINK_TARGET_ID } from "../../src/components/ui/SkipLink";

// Signed-out routes: the simple top bar only (SPEC: Application shell).
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicHeader />
      <div id={SKIP_LINK_TARGET_ID} tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </div>
    </>
  );
}
