"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

type Props = {
  width?: number;
  placeholder?: string;
  dim?: number;
  onSubmit?: (value: string) => void;
  // Seed the input. Each new seed (tracked by seedKey) replaces the current
  // value and focuses the field. Lets parent CTAs ("Start an errand") prefill
  // without lifting the whole input state.
  seed?: string;
  seedKey?: number;
};

export function CommandLine({
  width = 640,
  placeholder = "Ask me anything, or tell me what to do.",
  dim = 0,
  onSubmit,
  seed,
  seedKey,
}: Props) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (seedKey === undefined) return;
    setValue(seed ?? "");
    inputRef.current?.focus();
    // Put cursor at the end so the user can just keep typing.
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }, [seed, seedKey]);

  const handleSubmit = () => {
    const v = value.trim();
    if (!v) return;
    if (onSubmit) {
      onSubmit(v);
    } else {
      router.push(`/?q=${encodeURIComponent(v)}`);
    }
    setValue("");
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        width,
        maxWidth: "calc(100% - 80px)",
        padding: "14px 20px",
        background: "rgba(255,253,248,0.06)",
        border: "1px solid var(--rule)",
        borderRadius: 999,
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 14px 40px -12px rgba(0,0,0,0.4), 0 2px 6px rgba(0,0,0,0.2)",
        opacity: 1 - dim,
      }}
    >
      <span
        style={{
          fontFamily: "var(--serif)",
          fontSize: 18,
          color: "var(--ink-3)",
          fontStyle: "italic",
          opacity: 0.7,
        }}
      >
        /
      </span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        style={{
          flex: 1,
          fontFamily: "var(--sans)",
          fontSize: 14.5,
          color: "var(--ink)",
          background: "transparent",
          border: "none",
          outline: "none",
        }}
      />
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          padding: "2px 6px",
          borderRadius: 4,
          background: "var(--surface-2)",
          color: "var(--ink-2)",
          border: "1px solid var(--rule)",
          letterSpacing: "0.4px",
        }}
      >
        ⌘K
      </span>
    </div>
  );
}
