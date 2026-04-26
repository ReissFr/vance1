import type { ReactNode } from "react";

export type ToastVariant = "info" | "success" | "attention" | "error" | "ambient";

type Props = {
  variant?: ToastVariant;
  title: ReactNode;
  body?: ReactNode;
  meta?: ReactNode;
};

const colors: Record<ToastVariant, string> = {
  info: "var(--indigo)",
  success: "#4ade80",
  attention: "var(--violet)",
  error: "#f87171",
  ambient: "var(--ink-4)",
};

export function Toast({ variant = "info", title, body, meta }: Props) {
  const accent = colors[variant];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        overflow: "hidden",
        minWidth: 340,
        maxWidth: 420,
        boxShadow: "0 10px 30px -10px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ width: 3, background: accent }} />
      <div style={{ padding: "14px 16px", flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink)",
            fontWeight: 500,
            letterSpacing: "-0.1px",
          }}
        >
          {title}
        </div>
        {body && (
          <div
            style={{
              marginTop: 4,
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-3)",
              lineHeight: 1.5,
            }}
          >
            {body}
          </div>
        )}
        {meta && (
          <div
            style={{
              marginTop: 8,
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-4)",
              letterSpacing: "0.8px",
              textTransform: "uppercase",
            }}
          >
            {meta}
          </div>
        )}
      </div>
    </div>
  );
}
