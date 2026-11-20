import { PageShell } from "../../../../src/components/ui/PageShell";
import { ConversationsPage } from "../../../../src/features/development-conversations/components/ConversationsPage";

/** The owner's conversation list. The page header and its one primary action belong to the client view. */
export default function MyConversationsPage() {
  return (
    <PageShell width="3xl">
      <ConversationsPage />
    </PageShell>
  );
}
