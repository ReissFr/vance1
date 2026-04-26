import type { ReactNode } from "react";

type Props = {
  n?: number;
  head: ReactNode;
  body?: ReactNode;
  cta?: string;
  onCta?: () => void;
  onDismiss?: () => void;
};

export function ApprovalCard({ n, head, body, cta, onCta, onDismiss }: Props) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 18,
        padding: "22px 26px",
        display: "grid",
        gridTemplateColumns: n != null ? "28px 1fr" : "1fr",
        gap: 18,
        boxShadow:
          "0 20px 50px -18px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.2)",
      }}
    >
      {n != null && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-4)",
            letterSpacing: "1px",
            paddingTop: 6,
          }}
        >
          {String(n).padStart(2, "0")}
        </div>
      )}
      <div>
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 24,
            color: "var(--ink)",
            letterSpacing: "-0.3px",
            lineHeight: 1.3,
            fontWeight: 400,
            fontStyle: "italic",
          }}
        >
          {head}
        </div>
        {body && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 14,
              color: "var(--ink-3)",
              lineHeight: 1.55,
              marginTop: 8,
              maxWidth: 520,
            }}
          >
            {body}
          </div>
        )}
        {(cta || onDismiss) && (
          <div
            style={{
              display: "flex",
              gap: 14,
              alignItems: "center",
              marginTop: 18,
            }}
          >
            {cta && (
              <button
                onClick={onCta}
                style={{
                  fontFamily: "var(--sans)",
                  fontSize: 13.5,
                  fontWeight: 500,
                  color: "var(--indigo)",
                  letterSpacing: "-0.1px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--indigo)",
                  paddingBottom: 2,
                  background: "transparent",
                  border: "none",
                  borderBottomWidth: 1,
                  borderBottomStyle: "solid",
                  borderBottomColor: "var(--indigo)",
                }}
              >
                {cta}
              </button>
            )}
            <button
              onClick={onDismiss}
              style={{
                fontFamily: "var(--sans)",
                fontSize: 13.5,
                color: "var(--ink-4)",
                cursor: "pointer",
                background: "transparent",
                border: "none",
              }}
            >
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
