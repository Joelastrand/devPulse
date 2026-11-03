import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { ADMIN_SCOPE_EYEBROW } from "../../../../src/components/ui/copy";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { AdminRoles } from "../../../../src/features/role-profiles/components/AdminRoles";
import { adminRolesCopy } from "../../../../src/features/role-profiles/copy";

export default function AdminRolesPage() {
  return (
    <PageShell width="wide">
      <PageHeader eyebrow={ADMIN_SCOPE_EYEBROW} title={adminRolesCopy.pageTitle} description={adminRolesCopy.pageDescription} />
      <div className="mt-6">
        <AdminRoles />
      </div>
    </PageShell>
  );
}
