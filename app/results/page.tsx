import { PageShell } from "../../src/components/ui/PageShell";
import { ResultsRedirect } from "../../src/features/results/components/ResultsRedirect";

export default function ResultsPage() {
  return (
    <PageShell width="3xl">
      <ResultsRedirect />
    </PageShell>
  );
}
