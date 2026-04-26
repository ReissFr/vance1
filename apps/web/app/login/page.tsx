"use client";

import { useState } from "react";
import { Orb } from "@/components/jarvis/Orb";
import { Wordmark } from "@/components/jarvis/Wordmark";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  const [sent, setSent] = useState(false);

  async function signInWithGoogle() {
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes:
          "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        width: "100%",
        background: "var(--bg)",
        color: "var(--ink)",
        fontFamily: "var(--sans)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -60%)",
          pointerEvents: "none",
        }}
      >
        <Orb state="idle" size={280} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px 24px",
          textAlign: "center",
          gap: 16,
        }}
      >
        <div style={{ height: 320 }} />
        <div
          style={{
            fontFamily: "var(--serif)",
            fontStyle: "italic",
            fontSize: 44,
            color: "var(--ink)",
            letterSpacing: "-0.6px",
            lineHeight: 1.1,
          }}
        >
          {sent ? "Check your inbox." : "A quiet assistant."}
        </div>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 14,
            color: "var(--ink-3)",
            maxWidth: 440,
            lineHeight: 1.55,
          }}
        >
          {sent
            ? "I sent a sign-in link to your email. Click it to open JARVIS."
            : "JARVIS pays attention so you don't have to. Sign in to begin."}
        </div>

        {!sent && (
          <button
            onClick={signInWithGoogle}
            style={{
              marginTop: 24,
              padding: "12px 26px",
              borderRadius: 999,
              background: "var(--ink)",
              color: "#000",
              fontFamily: "var(--sans)",
              fontSize: 14,
              fontWeight: 500,
              border: "none",
              cursor: "pointer",
            }}
          >
            Continue with Google
          </button>
        )}

        <div
          style={{
            marginTop: 12,
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-4)",
            letterSpacing: "1px",
            textTransform: "uppercase",
          }}
        >
          Gmail · Calendar · voice
        </div>

        {!sent && (
          <button
            onClick={() => setSent(true)}
            style={{
              marginTop: 8,
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-4)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
              textDecorationColor: "var(--rule)",
              textUnderlineOffset: 3,
            }}
          >
            email me a magic link instead
          </button>
        )}
      </div>

      <Wordmark bottom={34} left={30} />
    </main>
  );
}
