import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { TasksPage } from "../../../src/features/personal-tasks/components/TasksPage";
import { tasksCopy } from "../../../src/features/personal-tasks/copy";

/** Personal Kanban board (Mine oppgaver). The board loads its own data client-side through the authenticated gateway. */
export default function MyTasksPage() {
  return (
    <PageShell width="wide">
      <PageHeader title={tasksCopy.pageTitle} description={tasksCopy.pageDescription} />
      <div className="mt-6">
        <TasksPage />
      </div>
    </PageShell>
  );
}
