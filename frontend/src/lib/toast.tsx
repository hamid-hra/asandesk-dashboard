"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext<(msg: string) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(""), 2600);
  }, []);
  return (
    <ToastContext.Provider value={flash}>
      {children}
      {msg && (
        <div
          role="status"
          style={{
            position: "fixed",
            bottom: 28,
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--toast)",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 18px",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            gap: 10,
            boxShadow: "0 12px 30px rgba(0,0,0,.2)",
            zIndex: 20,
          }}
        >
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "var(--ok)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
            }}
          >
            ✓
          </span>
          {msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
