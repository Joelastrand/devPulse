"use client";

import { RoleTargetSection } from "../../role-profiles/components/RoleTargetSection";
import { workspaceCopy } from "../copy";
import { useState } from "react";
import { AchievementsSection } from "./AchievementsSection";
import { ResponsibilitiesSection } from "./ResponsibilitiesSection";

/**
 * The private personal role workspace (`/me/skills?vy=rolle`). It shows the formal role status, the self-selected target role
 * (never presented as an assigned role), and the owner's own responsibilities and achievements. Nothing here is shared,
 * aggregated or shown to admins or participants (PR-SI-1, PR-SI-2).
 */
export function RoleWorkspace() {
  const [revision, setRevision] = useState(0);
  return (
    <div className="space-y-10">
      <p className="text-sm text-text-secondary">{workspaceCopy.privacy}</p>

      <section aria-labelledby="formal-role-heading" className="space-y-2">
        <h2 id="formal-role-heading" className="text-lg font-semibold text-text-primary">{workspaceCopy.formalRole.heading}</h2>
        <p className="text-sm text-text-secondary">{workspaceCopy.formalRole.none}</p>
      </section>

      <section aria-label={workspaceCopy.targetHeading} className="space-y-2">
        <p className="text-sm text-text-secondary">{workspaceCopy.targetNote}</p>
        <RoleTargetSection />
      </section>
      <ResponsibilitiesSection onChanged={() => setRevision((current) => current + 1)} />
      <AchievementsSection revision={revision} />
    </div>
  );
}
