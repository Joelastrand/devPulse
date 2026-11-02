import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { ProfileForm } from "../../../src/features/profiles/components/ProfileForm";
import { profileCopy } from "../../../src/features/profiles/copy";
import { ErasureEntryLink } from "../../../src/features/account-erasure/components/ErasureEntryLink";

export default function ProfilePage() {
  return (
    <PageShell width="2xl">
      <PageHeader title={profileCopy.pageTitle} description={profileCopy.pageDescription} />
      <div className="mt-6">
        <ProfileForm />
      </div>
      <p className="mt-8">
        <ErasureEntryLink />
      </p>
    </PageShell>
  );
}
