"use client";

// Floating quick-capture FAB. Tap the "+" (or press ⌘J) to drop a
// short thought — saved into long-term memory so recall can surface it
// later. Intentionally lightweight: one textarea, one kind selector,
// no tagging / timestamps / journaling — chat still exists for that.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "./ToastHost";

const KINDS = ["fact", "preference", "person", "event", "task"] as const;
type Kind = (typeof KINDS)[number];

export function QuickCapture() {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<Kind>("fact");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "j" || e.key === "J")) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    const openShim = () => setOpen(true);
    (window as unknown as { __jarvisQuickCapture?: () => void }).__jarvisQuickCapture = openShim;
    return () => {
      window.removeEventListener("keydown", handler);
      delete (window as unknown as { __jarvisQuickCapture?: () => void }).__jarvisQuickCapture;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setContent("");
      setKind("fact");
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, content: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      toast({
        variant: "success",
        title: "Saved to memory",
        meta: kind.toUpperCase(),
      });
      setOpen(false);
    } catch (e) {
      toast({
        variant: "error",
        title: "Memory save failed",
        body: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [content, kind]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Quick capture (⌘J)"
        aria-label="Quick capture"
        style={{
          position: "fixed",
          right: 20,
          bottom: 20,
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          color: "var(--ink-2)",
          fontSize: 22,
          cursor: "pointer",
          zIndex: 80,
          fontFamily: "var(--sans)",
          lineHeight: 1,
          display: open ? "none" : "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
        }}
      >
        +
      </button>

      {open && (
        <div
          onClick={() => !saving && setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: "16vh",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(520px, calc(100% - 48px))",
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: 16,
              boxShadow: "0 30px 80px -20px rgba(0,0,0,0.7)",
              overflow: "hidden",
              fontFamily: "var(--sans)",
              color: "var(--ink)",
            }}
          >
            <div
              style={{
                padding: "14px 20px",
                borderBottom: "1px solid var(--rule)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--serif)",
                  fontStyle: "italic",
                  fontSize: 18,
                  color: "var(--ink-2)",
                }}
              >
                Capture a thought
              </span>
              <div style={{ flex: 1 }} />
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10.5,
                  padding: "4px 8px",
                  background: "var(--bg)",
                  color: "var(--ink-2)",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  letterSpacing: "0.4px",
                  cursor: "pointer",
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="A fact, a preference, a promise, a person…"
              rows={5}
              style={{
                width: "100%",
                padding: "18px 20px",
                fontFamily: "var(--sans)",
                fontSize: 15,
                color: "var(--ink)",
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                lineHeight: 1.55,
              }}
            />
            <div
              style={{
                padding: "10px 20px",
                borderTop: "1px solid var(--rule)",
                background: "var(--bg)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--ink-4)",
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                }}
              >
                ⌘↩ Save · ESC Close
              </span>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                onClick={submit}
                disabled={saving || !content.trim()}
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 11,
                  padding: "7px 14px",
                  background: "var(--indigo-soft)",
                  color: "var(--ink)",
                  border: "1px solid var(--indigo)",
                  borderRadius: 8,
                  cursor: saving || !content.trim() ? "not-allowed" : "pointer",
                  letterSpacing: "0.6px",
                  opacity: !content.trim() ? 0.4 : 1,
                }}
              >
                {saving ? "SAVING…" : "SAVE"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

