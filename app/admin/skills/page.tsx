import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { adminSkillsCopy } from "../../../src/features/skill-trees/copy";
import { AdminSkills } from "../../../src/features/skill-trees/components/AdminSkills";

export default function AdminSkillsPage() {
  return (
    <PageShell width="3xl">
      <PageHeader title={adminSkillsCopy.pageTitle} description={adminSkillsCopy.pageDescription} />
      <div className="mt-6">
        <AdminSkills />
      </div>
    </PageShell>
  );
}
