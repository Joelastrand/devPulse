import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { SkillProfilePage } from "../../../src/features/skill-profiles/components/SkillProfilePage";
import { skillProfileCopy } from "../../../src/features/skill-profiles/copy";

export default function MySkillsPage() {
  return (
    <PageShell width="2xl">
      <PageHeader title={skillProfileCopy.pageTitle} description={skillProfileCopy.pageDescription} />
      <div className="mt-6">
        <SkillProfilePage />
      </div>
    </PageShell>
  );
}
