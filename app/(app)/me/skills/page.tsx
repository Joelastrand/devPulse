import { PersonalNav } from "../../../../src/components/nav/PersonalNav";
import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { SkillProfilePage } from "../../../../src/features/skill-profiles/components/SkillProfilePage";
import { skillProfileCopy } from "../../../../src/features/skill-profiles/copy";
import { SkillNextSteps } from "../../../../src/features/skill-profiles/components/SkillNextSteps";
import { RoleTargetSection } from "../../../../src/features/role-profiles/components/RoleTargetSection";
import { OwnCompetenceSharing } from "../../../../src/features/team-skills/components/OwnCompetenceSharing";

export default function MySkillsPage() {
  return (
    <PageShell width="3xl">
      <PersonalNav />
      <PageHeader title={skillProfileCopy.pageTitle} description={skillProfileCopy.pageDescription} />
      <div className="mt-6 flex flex-col gap-6">
        {/* The participation control leads the page so the owner's sharing choice is visible before the skill list (BR-21). */}
        <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-sm lg:ml-auto lg:max-w-md">
          <OwnCompetenceSharing />
        </div>
        <SkillProfilePage
          sidePanel={
            <>
              <RoleTargetSection />
              <SkillNextSteps />
            </>
          }
        />
      </div>
    </PageShell>
  );
}
