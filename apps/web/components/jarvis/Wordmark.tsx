type Props = {
  bottom?: number;
  left?: number;
  dim?: number;
};

export function Wordmark({ bottom = 28, left = 32, dim = 0 }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        left,
        bottom,
        fontFamily: "var(--mono)",
        fontSize: 10.5,
        color: "var(--ink-3)",
        letterSpacing: "2.2px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: 1 - dim,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: "linear-gradient(135deg, #f4c9d8, #bfd4ee)",
        }}
      />
      <span>JARVIS</span>
    </div>
  );
}
