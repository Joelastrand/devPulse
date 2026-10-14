import { PersonalNav } from "../../../src/components/nav/PersonalNav";
import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { GoalsPage } from "../../../src/features/personal-goals/components/GoalsPage";
import { goalsCopy } from "../../../src/features/personal-goals/copy";

export default function MyGoalsPage() {
  return (
    <PageShell width="2xl">
      <PersonalNav />
      <PageHeader title={goalsCopy.pageTitle} description={goalsCopy.pageDescription} />
      <div className="mt-6">
        <GoalsPage />
      </div>
    </PageShell>
  );
}
