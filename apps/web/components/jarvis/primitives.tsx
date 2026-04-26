import type { CSSProperties, ReactNode } from "react";

export function Card({
  children,
  padding = "20px 22px",
  style,
}: {
  children: ReactNode;
  padding?: string | number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 14,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  tone?: "default" | "alert" | "positive";
}) {
  const deltaColor =
    tone === "alert"
      ? "var(--magenta)"
      : tone === "positive"
      ? "var(--indigo)"
      : "var(--ink-3)";
  return (
    <Card style={{ minWidth: 180 }}>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-3)",
          letterSpacing: "1.4px",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontSize: 34,
          fontStyle: "italic",
          color: "var(--ink)",
          marginTop: 8,
          lineHeight: 1,
          letterSpacing: "-0.4px",
        }}
      >
        {value}
      </div>
      {delta && (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 12.5,
            color: deltaColor,
            marginTop: 6,
          }}
        >
          {delta}
        </div>
      )}
    </Card>
  );
}

export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  onClick,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 18px",
        borderBottom: "1px solid var(--rule-soft)",
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {leading && <div style={{ flexShrink: 0 }}>{leading}</div>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink)",
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {meta && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: "0.8px",
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {meta}
        </div>
      )}
      {trailing && <div style={{ flexShrink: 0 }}>{trailing}</div>}
    </div>
  );
}

export function SectionHeading({
  children,
  meta,
}: {
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        padding: "24px 32px 14px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 11,
          color: "var(--ink-3)",
          letterSpacing: "1.6px",
          textTransform: "uppercase",
        }}
      >
        {children}
      </div>
      {meta && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: "0.8px",
          }}
        >
          {meta}
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  cta,
  tone = "default",
}: {
  title: string;
  body?: string;
  cta?: string;
  tone?: "default" | "warm";
}) {
  return (
    <div
      style={{
        padding: "48px 32px",
        textAlign: "center",
        border: "1px dashed var(--rule)",
        borderRadius: 16,
        background: tone === "warm" ? "var(--surface)" : "transparent",
      }}
    >
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 26,
          color: "var(--ink-2)",
          letterSpacing: "-0.3px",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {body && (
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--ink-3)",
            maxWidth: 380,
            margin: "0 auto",
            lineHeight: 1.5,
          }}
        >
          {body}
        </div>
      )}
      {cta && (
        <div
          style={{
            marginTop: 20,
            fontFamily: "var(--sans)",
            fontSize: 13.5,
            color: "var(--indigo)",
            fontWeight: 500,
          }}
        >
          {cta}
        </div>
      )}
    </div>
  );
}
