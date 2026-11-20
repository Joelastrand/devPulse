"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "../../auth/client/auth-client";
import { Button } from "../../../components/ui/Button";
import { Icon } from "../../../components/ui/Icon";
import { profileCopy } from "../copy";

/**
 * Sign-out on Min profil (moved from the sidebar). It calls the same client
 * `signOut` the shell used; the signed-out state follows from the auth observer, so no redirect is added here.
 * It is a neutral secondary button, not a destructive account action.
 */
export function ProfileSignOutButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignOut() {
    setPending(true);
    setFailed(false);
    const result = await signOut();
    setPending(false);
    if (!result.ok) setFailed(true);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="secondary" size="sm" pending={pending} onClick={handleSignOut} className="inline-flex w-fit items-center gap-2">
        <Icon icon={LogOut} size="inline" />
        {pending ? profileCopy.signingOutButton : profileCopy.signOutButton}
      </Button>
      {failed ? (
        <p role="alert" className="text-help text-danger-text">
          {profileCopy.genericError}
        </p>
      ) : null}
    </div>
  );
}
