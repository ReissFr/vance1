import type { ReactNode } from "react";
import { StatusStrip } from "./StatusStrip";
import { CommandLine } from "./CommandLine";
import { Wordmark } from "./Wordmark";

type Props = {
  greeting?: string | null;
  greetingTone?: "serif" | "sans";
  subtext?: ReactNode;
  subtextStyle?: "default" | "mono";
  statusBullets?: string[];
  listening?: boolean;
  pulse?: boolean;
  right?: ReactNode;
  children?: ReactNode;
  invitation?: ReactNode;
  bg?: string;
  wordmark?: boolean;
  command?: boolean;
  showGreeting?: boolean;
};

export function HomeShell({
  greeting = "Good afternoon.",
  greetingTone = "serif",
  subtext,
  subtextStyle = "default",
  statusBullets,
  listening = true,
  pulse = true,
  right,
  children,
  invitation,
  bg,
  wordmark = true,
  command = true,
  showGreeting = true,
}: Props) {
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        position: "relative",
        overflow: "hidden",
        background: bg ?? "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--sans)",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 32,
          left: 48,
          right: 48,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <StatusStrip bullets={statusBullets} listening={listening} pulse={pulse} />
        {right && <div>{right}</div>}
      </div>

      {showGreeting && greeting && (
        <div
          style={{
            position: "absolute",
            top: 150,
            left: 0,
            right: 0,
            textAlign: "center",
            fontFamily: greetingTone === "serif" ? "var(--serif)" : "var(--sans)",
            fontStyle: greetingTone === "serif" ? "italic" : "normal",
            fontWeight: greetingTone === "serif" ? 400 : 500,
            fontSize: greetingTone === "serif" ? 52 : 40,
            letterSpacing: greetingTone === "serif" ? "-0.8px" : "-0.6px",
            color: "var(--ink)",
            lineHeight: 1.1,
          }}
        >
          {greeting}
          {subtext && (
            <div
              style={{
                marginTop: 14,
                fontFamily: subtextStyle === "mono" ? "var(--mono)" : "var(--sans)",
                fontSize: subtextStyle === "mono" ? 13 : 15,
                color: "var(--ink-3)",
                letterSpacing: subtextStyle === "mono" ? "1.4px" : "-0.1px",
                fontStyle: "normal",
                fontWeight: 400,
                textTransform: subtextStyle === "mono" ? "uppercase" : "none",
              }}
            >
              {subtext}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </div>

      {invitation && (
        <div
          style={{
            position: "absolute",
            bottom: 156,
            left: 0,
            right: 0,
            textAlign: "center",
          }}
        >
          {invitation}
        </div>
      )}

      {command && (
        <div
          style={{
            position: "absolute",
            bottom: 44,
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <CommandLine />
        </div>
      )}

      {wordmark && <Wordmark />}
    </div>
  );
}
