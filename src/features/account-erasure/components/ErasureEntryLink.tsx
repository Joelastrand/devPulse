import Link from "next/link";
import { erasureCopy } from "../copy";

/** The entry point to the erasure confirmation, shown on the profile page (TASK-039). It holds no state and no identity. */
export function ErasureEntryLink() {
  return (
    <Link href="/me/erasure" className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300">
      {erasureCopy.profileLinkLabel}
    </Link>
  );
}
