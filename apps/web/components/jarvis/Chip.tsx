import type { CSSProperties, ReactNode } from "react";

type Props = {
  color?: string;
  border?: string;
  bg?: string;
  size?: number;
  children: ReactNode;
  style?: CSSProperties;
};

export function Chip({
  color,
  border,
  bg,
  size = 10.5,
  children,
  style,
}: Props) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        padding: "3px 8px",
        borderRadius: 999,
        fontFamily: "var(--mono)",
        fontSize: size,
        letterSpacing: "0.8px",
        color: color ?? "var(--ink-2)",
        background: bg ?? "transparent",
        border: `1px solid ${border ?? "var(--rule)"}`,
        textTransform: "uppercase",
        fontWeight: 500,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

type FilterPillProps = {
  label: string;
  active?: boolean;
  count?: number;
  onClick?: () => void;
};

export function FilterPill({ label, active, count, onClick }: FilterPillProps) {
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        borderRadius: 999,
        fontFamily: "var(--sans)",
        fontSize: 12.5,
        fontWeight: 500,
        background: active ? "var(--ink)" : "transparent",
        color: active ? "#000" : "var(--ink-2)",
        border: `1px solid ${active ? "var(--ink)" : "var(--rule)"}`,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {label}
      {count != null && (
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            opacity: 0.7,
            letterSpacing: "0.4px",
          }}
        >
          {count}
        </span>
      )}
    </span>
  );
}
