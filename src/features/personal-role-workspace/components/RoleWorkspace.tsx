"use client";

import { useState } from "react";
import { workspaceCopy } from "../copy";
import { AchievementsSection } from "./AchievementsSection";
import { FormalRoleSection } from "./FormalRoleSection";
import { ResponsibilitiesSection } from "./ResponsibilitiesSection";

/**
 * The private personal role workspace (`/me/skills?vy=rolle`): the formal organizational role (Min rolle), the owner's
 * responsibilities and their contributions. Nothing here is shared, aggregated or shown to admins or participants
 * (PR-SI-1, PR-SI-2). No target role and no role expectations exist. The three sections are independent of each other.
 */
export function RoleWorkspace() {
  const [revision, setRevision] = useState(0);
  return (
    <div className="space-y-8">
      <p className="text-sm text-text-secondary">{workspaceCopy.privacy}</p>

      <FormalRoleSection />

      <ResponsibilitiesSection onChanged={() => setRevision((current) => current + 1)} />
      <AchievementsSection revision={revision} />
    </div>
  );
}
