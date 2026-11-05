import { Zap } from "lucide-react";
import { ActionListItem, SummaryPanel } from "../../../components/ui/dashboard/DashboardPrimitives";
import { skillProfileCopy } from "../copy";

/** Up to three links to existing pages. Links only; no new data or recommendation logic (visual-redesign BR-18). */
export function SkillNextSteps() {
  return (
    <SummaryPanel title={skillProfileCopy.nextSteps.heading} icon={Zap}>
      <ul className="flex flex-col gap-2">
        {skillProfileCopy.nextSteps.items.slice(0, 3).map((item) => (
          <ActionListItem key={item.href} href={item.href} title={item.title} description={item.description} />
        ))}
      </ul>
    </SummaryPanel>
  );
}
