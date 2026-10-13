"use client";

import { useState } from "react";

import type { User } from "@/lib/types";

import { FirstLogin } from "./FirstLogin";

/**
 * Shows the first-login screen in place of the panel when the account still has a temporary password.
 * Whether to show it is decided once, when the panel opens: after the password is changed the screen
 * stays until the recovery codes were saved, even if the user record is refreshed meanwhile.
 */
export function FirstLoginGate({ user, logout, onDone, children }: { user: User; logout: () => void; onDone: () => void; children: React.ReactNode }) {
  const [active] = useState(user.must_change_password);
  const [finished, setFinished] = useState(false);
  if (active && !finished) {
    return (
      <FirstLogin
        username={user.username}
        displayName={user.display_name}
        logout={logout}
        onDone={() => {
          setFinished(true);
          onDone();
        }}
      />
    );
  }
  return <>{children}</>;
}
