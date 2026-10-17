"use client";

import { useState } from "react";

import type { User } from "@/lib/types";

import { ContactStep } from "./ContactStep";
import { FirstLogin } from "./FirstLogin";

/**
 * Screens shown in place of the panel until the account is complete:
 * 1. a temporary password (someone else chose it) → the user sets their own and saves the recovery codes;
 * 2. no mobile number or email → the user enters both.
 * Which steps to show is decided once, when the panel opens, so a refreshed user record does not cut a
 * step short (the recovery codes stay on screen until saved).
 */
export function FirstLoginGate({ user, logout, onDone, children }: { user: User; logout: () => void; onDone: () => void; children: React.ReactNode }) {
  const [needPassword] = useState(user.must_change_password);
  const [needContact] = useState(user.needs_contact);
  const [passwordDone, setPasswordDone] = useState(false);
  const [contactDone, setContactDone] = useState(false);
  if (needPassword && !passwordDone) {
    return (
      <FirstLogin
        username={user.username}
        displayName={user.display_name}
        logout={logout}
        onDone={() => {
          setPasswordDone(true);
          onDone();
        }}
      />
    );
  }
  if (needContact && !contactDone) {
    return (
      <ContactStep
        user={user}
        logout={logout}
        onDone={() => {
          setContactDone(true);
          onDone();
        }}
      />
    );
  }
  return <>{children}</>;
}
