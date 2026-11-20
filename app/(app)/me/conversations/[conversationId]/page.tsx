import { PageShell } from "../../../../../src/components/ui/PageShell";
import { ConversationDetail } from "../../../../../src/features/development-conversations/components/ConversationDetail";
import { conversationsCopy } from "../../../../../src/features/development-conversations/copy";

/**
 * The owner's conversation page (SPEC BR-35; TASK-028). The page only passes the conversation id to the client view.
 * The route shows only the small "Samtale" label (not a heading); the conversation title is the page h1
 * rendered by the client view, so the actual title is what a person reads first.
 */
export default async function MyConversationDetailPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;

  return (
    <PageShell width="3xl">
      <p className="text-eyebrow text-text-muted">{conversationsCopy.detailHeading}</p>
      <div className="mt-2">
        <ConversationDetail conversationId={conversationId} />
      </div>
    </PageShell>
  );
}
