import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { ErasureConfirmation } from "../../../src/features/account-erasure/components/ErasureConfirmation";
import { erasureCopy } from "../../../src/features/account-erasure/copy";

export default function ErasurePage() {
  return (
    <PageShell width="2xl">
      <PageHeader title={erasureCopy.pageTitle} description={erasureCopy.pageDescription} />
      <div className="mt-6">
        <ErasureConfirmation />
      </div>
    </PageShell>
  );
}
