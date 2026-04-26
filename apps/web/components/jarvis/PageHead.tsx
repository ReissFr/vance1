import type { ReactNode } from "react";

type Props = {
  title: ReactNode;
  back?: string;
  meta?: ReactNode;
  right?: ReactNode;
  compact?: boolean;
};

export function PageHead({ back, title, meta, right, compact = false }: Props) {
  return (
    <div
      style={{
        padding: compact ? "22px 32px 18px" : "30px 32px 22px",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        gap: 24,
      }}
    >
      <div>
        {back && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10.5,
              color: "var(--ink-3)",
              letterSpacing: "1.4px",
              textTransform: "uppercase",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>←</span>
            <span>{back}</span>
          </div>
        )}
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 34,
            fontStyle: "italic",
            color: "var(--ink)",
            letterSpacing: "-0.5px",
            lineHeight: 1.15,
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        {meta && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11,
              color: "var(--ink-2)",
              letterSpacing: "0.6px",
            }}
          >
            {meta}
          </div>
        )}
      </div>
      {right && <div>{right}</div>}
    </div>
  );
}
