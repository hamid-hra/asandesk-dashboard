import { avatarOf, initialOf } from "@/lib/people";

import s from "./clients.module.css";

export function Avatar({ id, name, size = 34 }: { id: string; name: string; size?: number }) {
  const [bg, color] = avatarOf(id);
  return (
    <div className={s.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: bg, color }}>
      {initialOf(name)}
    </div>
  );
}
