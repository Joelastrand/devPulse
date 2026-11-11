"use client";

import { useState } from "react";
import { workspaceCopy } from "../copy";
import { AchievementsSection } from "./AchievementsSection";
import { ResponsibilitiesSection } from "./ResponsibilitiesSection";

/**
 * The private personal role workspace (`/me/skills?vy=rolle`): the formal organizational role (Min rolle), the owner's
 * responsibilities and their contributions. Nothing here is shared, aggregated or shown to admins or participants
 * (PR-SI-1, PR-SI-2). No target role and no role expectations exist.
 */
export function RoleWorkspace() {
  const [revision, setRevision] = useState(0);
  return (
    <div className="space-y-8">
      <p className="text-sm text-text-secondary">{workspaceCopy.privacy}</p>

      <section aria-labelledby="formal-role-heading" className="space-y-2 rounded-lg border border-border-subtle bg-surface p-4">
        <h2 id="formal-role-heading" className="text-base font-semibold text-text-primary">
          {workspaceCopy.formalRole.heading}
        </h2>
        <p className="text-sm text-text-primary">{workspaceCopy.formalRole.none}</p>
        <p className="text-sm text-text-secondary">{workspaceCopy.formalRole.explanation}</p>
      </section>

      <ResponsibilitiesSection onChanged={() => setRevision((current) => current + 1)} />
      <AchievementsSection revision={revision} />
    </div>
  );
}
