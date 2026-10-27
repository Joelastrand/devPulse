import { PersonalNav } from "../../../src/components/nav/PersonalNav";
import { PageHeader } from "../../../src/components/ui/PageHeader";
import { PageShell } from "../../../src/components/ui/PageShell";
import { ConversationsPage } from "../../../src/features/development-conversations/components/ConversationsPage";
import { conversationsCopy } from "../../../src/features/development-conversations/copy";

export default function MyConversationsPage() {
  return (
    <PageShell width="2xl">
      <PersonalNav />
      <PageHeader title={conversationsCopy.pageTitle} description={conversationsCopy.pageDescription} />
      <div className="mt-6">
        <ConversationsPage />
      </div>
    </PageShell>
  );
}
