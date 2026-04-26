import { Fragment } from "react";

type Props = {
  listening?: boolean;
  bullets?: string[];
  pulse?: boolean;
  dim?: number;
};

export function StatusStrip({
  listening = true,
  bullets = ["LISTENING", "READY", "NO ACTIVE CALL"],
  pulse = true,
  dim = 0,
}: Props) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "1.6px",
        color: "var(--ink-2)",
        textTransform: "uppercase",
        opacity: 1 - dim,
      }}
    >
      {listening && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--indigo)",
            animation: pulse ? "jv-pulse 1.6s ease-in-out infinite" : "none",
          }}
        />
      )}
      {bullets.map((b, i) => (
        <Fragment key={i}>
          <span style={{ color: i === 0 && listening ? "var(--indigo)" : "var(--ink-2)" }}>
            {b}
          </span>
          {i < bullets.length - 1 && (
            <span style={{ color: "var(--ink-4)" }}>·</span>
          )}
        </Fragment>
      ))}
    </div>
  );
}
