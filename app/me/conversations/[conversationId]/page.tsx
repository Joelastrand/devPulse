import { PersonalNav } from "../../../../src/components/nav/PersonalNav";
import { PageHeader } from "../../../../src/components/ui/PageHeader";
import { PageShell } from "../../../../src/components/ui/PageShell";
import { ConversationDetail } from "../../../../src/features/development-conversations/components/ConversationDetail";
import { conversationsCopy } from "../../../../src/features/development-conversations/copy";

/** The owner's conversation page (SPEC BR-35; TASK-028). The page only passes the conversation id to the client view. */
export default async function MyConversationDetailPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;

  return (
    <PageShell width="2xl">
      <PersonalNav />
      <PageHeader title={conversationsCopy.detailHeading} />
      <div className="mt-6">
        <ConversationDetail conversationId={conversationId} />
      </div>
    </PageShell>
  );
}
