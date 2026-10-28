import { PersonalNav } from "../../../src/components/nav/PersonalNav";
import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { GoalsPage } from "../../../src/features/personal-goals/components/GoalsPage";
import { goalsCopy } from "../../../src/features/personal-goals/copy";

interface MyGoalsPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** Only `treeId` is read (PG-11); other parameters are ignored. A repeated `treeId` is ignored as well. */
export default async function MyGoalsPage({ searchParams }: MyGoalsPageProps) {
  const { treeId } = await searchParams;
  return (
    <PageShell width="2xl">
      <PersonalNav />
      <PageHeader title={goalsCopy.pageTitle} description={goalsCopy.pageDescription} />
      <div className="mt-6">
        <GoalsPage initialTreeId={typeof treeId === "string" && treeId !== "" ? treeId : undefined} />
      </div>
    </PageShell>
  );
}
