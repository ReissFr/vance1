import type { CSSProperties } from "react";

export type OrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "wake-igniting"
  | "dim"
  | "mid";

type OrbProps = {
  state?: OrbState;
  size?: number;
  igniteProgress?: number;
  style?: CSSProperties;
};

export function Orb({
  state = "idle",
  size = 360,
  igniteProgress = 1,
  style,
}: OrbProps) {
  const listening = state === "listening";
  const thinking = state === "thinking";
  const speaking = state === "speaking";
  const wake = state === "wake-igniting";
  const breathing = !wake;

  const swirl =
    thinking ? "9s" :
    speaking ? "14s" :
    listening ? "16s" :
    "24s";
  const breath =
    thinking ? "3.2s" :
    listening ? "4s" :
    speaking ? "2.8s" :
    "6s";

  const p = wake ? igniteProgress : 1;
  const wakeScale = wake ? 0.35 + p * 0.65 : 1;
  const wakeOpacity = wake ? 0.2 + p * 0.8 : 1;

  return (
    <div
      style={{
        width: size,
        height: size,
        position: "relative",
        display: "grid",
        placeItems: "center",
        transform: `scale(${wakeScale})`,
        opacity: wakeOpacity,
        transition: "transform 0.8s cubic-bezier(0.2,0.7,0.2,1), opacity 0.8s",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -size * 0.45,
          background:
            "radial-gradient(circle at center, rgba(232,180,200,0.55), rgba(180,190,230,0.28) 36%, rgba(235,220,190,0.16) 58%, transparent 75%)",
          filter: "blur(22px)",
          animation: `jv-breathe ${breath} ease-in-out infinite`,
          pointerEvents: "none",
        }}
      />

      {speaking &&
        [0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              borderRadius: "50%",
              border: "1px solid rgba(184,119,57,0.35)",
              animation: "jv-wave 2.4s ease-out infinite",
              animationDelay: `${i * 0.8}s`,
              opacity: 0,
            }}
          />
        ))}

      {listening && (
        <div
          style={{
            position: "absolute",
            width: "78%",
            height: "78%",
            borderRadius: "50%",
            border: "1px solid rgba(255,255,255,0.55)",
            animation: "jv-ripple 2.2s ease-out infinite",
            opacity: 0,
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 34% 28%, #fff7ee 0%, #fbe6e0 28%, #e9d0d9 48%, #cdc7e2 68%, #b8c7d8 86%, #9fb1c6 100%)",
          boxShadow:
            "inset 0 -24px 48px rgba(80,50,90,0.18), inset 18px 22px 60px rgba(255,255,255,0.55), 0 30px 80px -18px rgba(160,120,180,0.35), 0 10px 30px -8px rgba(120,100,160,0.22)",
          animation: breathing ? `jv-breathe ${breath} ease-in-out infinite` : "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          width: "82%",
          height: "82%",
          borderRadius: "50%",
          background:
            "conic-gradient(from 30deg, #f4c9d8 0deg, #d9c9ee 60deg, #bfd4ee 140deg, #e4dac4 210deg, #f0b8c9 280deg, #d4cbee 340deg, #f4c9d8 360deg)",
          filter: "blur(18px)",
          opacity: listening ? 0.85 : thinking ? 0.9 : 0.72,
          animation: `jv-spin ${swirl} linear infinite${
            thinking ? ", jv-pulse 2.4s ease-in-out infinite" : ""
          }`,
          mixBlendMode: "screen",
        }}
      />

      <div
        style={{
          position: "absolute",
          width: "70%",
          height: "70%",
          borderRadius: "50%",
          background:
            "conic-gradient(from 200deg, rgba(255,220,210,0.9), rgba(200,220,240,0.9) 90deg, rgba(230,210,240,0.9) 180deg, rgba(255,230,200,0.9) 270deg, rgba(255,220,210,0.9) 360deg)",
          filter: "blur(14px)",
          opacity: 0.55,
          animation: `jv-spin-rev ${swirl} linear infinite`,
          mixBlendMode: "screen",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: "8%",
          left: "14%",
          width: "44%",
          height: "36%",
          borderRadius: "50%",
          background:
            "radial-gradient(ellipse at center, rgba(255,255,255,0.85), rgba(255,255,255,0) 65%)",
          filter: "blur(3px)",
        }}
      />

      <div
        style={{
          position: "absolute",
          width: "92%",
          height: "92%",
          borderRadius: "50%",
          boxShadow:
            "inset -8px -14px 36px rgba(90,60,100,0.22), inset 6px 8px 24px rgba(255,255,255,0.35)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: "16%",
          left: "24%",
          width: "7%",
          height: "5.5%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,255,255,1), rgba(255,255,255,0) 70%)",
        }}
      />
    </div>
  );
}

type OrbHaloProps = {
  size?: number;
  state?: OrbState;
};

export function OrbHalo({ size = 280, state = "idle" }: OrbHaloProps) {
  const table = {
    idle: { filter: "none", scale: 1.0, halo: 0.55 },
    listening: { filter: "saturate(1.2) brightness(1.06)", scale: 1.02, halo: 0.75 },
    thinking: { filter: "blur(0.4px) contrast(1.04)", scale: 0.98, halo: 0.5 },
    speaking: { filter: "saturate(1.25) brightness(1.1)", scale: 1.04, halo: 0.95 },
    dim: { filter: "saturate(0.5) brightness(0.6)", scale: 0.35, halo: 0.15 },
    mid: { filter: "saturate(1.1) brightness(1.1)", scale: 0.78, halo: 0.8 },
    "wake-igniting": { filter: "none", scale: 1.0, halo: 0.55 },
  } as const;
  const cfg = table[state];

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: size * 2,
          height: size * 2,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(244,201,216,${0.22 * cfg.halo}), rgba(207,221,234,${0.12 * cfg.halo}) 40%, transparent 70%)`,
          filter: "blur(30px)",
          pointerEvents: "none",
        }}
      />
      {state === "listening" && (
        <div
          style={{
            position: "absolute",
            width: size + 32,
            height: size + 32,
            borderRadius: "50%",
            border: "1.5px solid var(--indigo)",
            opacity: 0.5,
            animation: "jv-breathe-ring 2.4s ease-in-out infinite",
          }}
        />
      )}
      <div
        style={{
          transform: `scale(${cfg.scale})`,
          filter: cfg.filter,
          transition: "all 400ms",
        }}
      >
        <Orb state={state === "dim" || state === "mid" ? "idle" : state} size={size} />
      </div>
    </div>
  );
}
