import type { RefObject } from "react";
import { Alert } from "../../../components/ui/Alert";
import type { WriteFeedbackState } from "./use-owner-write";

interface WriteFeedbackRegionProps {
  feedback: WriteFeedbackState | undefined;
  regionRef: RefObject<HTMLDivElement | null>;
}

/**
 * The outcome of the last write in one section. The wrapper is always rendered and is focusable, so focus has a stable
 * place to land after a write. The message itself is an `Alert`, which keeps its live-region role.
 */
export function WriteFeedbackRegion({ feedback, regionRef }: WriteFeedbackRegionProps) {
  return (
    <div ref={regionRef} tabIndex={-1} className="outline-none">
      {feedback && <Alert variant={feedback.tone}>{feedback.message}</Alert>}
    </div>
  );
}
