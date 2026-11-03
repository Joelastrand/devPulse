import type { ReactNode } from "react";
import { SKIP_LINK_TARGET_ID } from "../../src/components/ui/SkipLink";

// The survey route has no navigation, sidebar or account menu (BR-S8). This
// layout must not import any identity-bearing component.
export default function SurveyLayout({ children }: { children: ReactNode }) {
  return (
    <div id={SKIP_LINK_TARGET_ID} tabIndex={-1} className="flex flex-1 flex-col">
      {children}
    </div>
  );
}
