"use client";

import { useEffect, useState } from "react";

import s from "./clients.module.css";

/** جستجو با تأخیر کوتاه تا با هر کلید درخواست جدید فرستاده نشود */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 250);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <label className={s.search}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function Seg<T extends string>({ options, value, onChange, wrap }: { options: [T, string][]; value: T; onChange: (v: T) => void; wrap?: boolean }) {
  return (
    <div className={`seg ${wrap ? s.wrapSeg : ""}`}>
      {options.map(([id, label]) => (
        <button key={id} aria-pressed={value === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}
