import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { ADMIN_SCOPE_EYEBROW } from "../../../../src/components/ui/copy";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { AdminSuperadmins } from "../../../../src/features/superadmins/components/AdminSuperadmins";
import { superadminsCopy } from "../../../../src/features/superadmins/copy";

/** Superadmin management (`/admin/superadmins`). Thin entry point: the component and the server routes enforce access. */
export default function AdminSuperadminsPage() {
  return (
    <PageShell width="wide">
      <PageHeader eyebrow={ADMIN_SCOPE_EYEBROW} title={superadminsCopy.pageTitle} description={superadminsCopy.pageDescription} />
      <div className="mt-6">
        <AdminSuperadmins />
      </div>
    </PageShell>
  );
}
