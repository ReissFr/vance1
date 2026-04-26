"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Orb } from "@/components/jarvis/Orb";
import { Wordmark } from "@/components/jarvis/Wordmark";
import { supabaseBrowser } from "@/lib/supabase/client";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6;

interface ProfileState {
  display_name: string | null;
  mobile_e164: string | null;
  timezone: string | null;
  briefing_enabled: boolean;
  proactive_enabled: boolean;
  concierge_auto_limit_gbp: number | null;
  google_connected: boolean;
  email: string | null;
}

const DEFAULT_PROFILE: ProfileState = {
  display_name: null,
  mobile_e164: null,
  timezone: null,
  briefing_enabled: true,
  proactive_enabled: true,
  concierge_auto_limit_gbp: 50,
  google_connected: false,
  email: null,
};

const TOTAL_STEPS = 7;

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(0);
  const [profile, setProfile] = useState<ProfileState>(DEFAULT_PROFILE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memoryText, setMemoryText] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/profile", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Partial<ProfileState>;
      setProfile((p) => ({
        ...p,
        ...data,
        timezone:
          data.timezone ??
          (typeof Intl !== "undefined"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : null),
      }));
    })();
  }, []);

  const patchProfile = useCallback(async (patch: Record<string, unknown>) => {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? "save failed");
    }
  }, []);

  const goNext = useCallback(
    async (action?: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        if (action) await action();
        if (step === 6) {
          await patchProfile({ onboarded: true });
          router.push("/");
          return;
        }
        setStep((s) => (s + 1) as Step);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [step, router, patchProfile],
  );

  const orbSize = 60 + step * 14;

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
          top: "22%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          transition: "transform 600ms var(--ease)",
          pointerEvents: "none",
        }}
      >
        <Orb state={busy ? "thinking" : "idle"} size={orbSize} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "38vh 32px 80px",
          textAlign: "center",
        }}
      >
        <div style={{ width: "100%", maxWidth: 460 }}>
          {step === 0 && <Welcome onNext={() => goNext()} busy={busy} />}
          {step === 1 && (
            <ProfileStep
              profile={profile}
              setProfile={setProfile}
              busy={busy}
              error={error}
              onNext={() =>
                goNext(async () => {
                  if (!profile.display_name?.trim()) {
                    throw new Error("Tell me what to call you.");
                  }
                  await patchProfile({
                    display_name: profile.display_name,
                    timezone: profile.timezone,
                  });
                })
              }
            />
          )}
          {step === 2 && (
            <WhatsAppStep
              profile={profile}
              setProfile={setProfile}
              busy={busy}
              error={error}
              onNext={() =>
                goNext(async () => {
                  if (profile.mobile_e164) {
                    await patchProfile({ mobile_e164: profile.mobile_e164 });
                  }
                })
              }
              onSkip={() => goNext()}
            />
          )}
          {step === 3 && (
            <GmailStep
              profile={profile}
              busy={busy}
              onNext={() => goNext()}
            />
          )}
          {step === 4 && (
            <PreferencesStep
              profile={profile}
              setProfile={setProfile}
              busy={busy}
              error={error}
              onNext={() =>
                goNext(async () => {
                  await patchProfile({
                    briefing_enabled: profile.briefing_enabled,
                    proactive_enabled: profile.proactive_enabled,
                    concierge_auto_limit_gbp: profile.concierge_auto_limit_gbp,
                  });
                })
              }
            />
          )}
          {step === 5 && (
            <MemoryStep
              value={memoryText}
              setValue={setMemoryText}
              busy={busy}
              error={error}
              onNext={() =>
                goNext(async () => {
                  const t = memoryText.trim();
                  if (!t) return;
                  const res = await fetch("/api/onboarding/memory", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ content: t, kind: "fact" }),
                  });
                  if (!res.ok) throw new Error("couldn't save that yet.");
                })
              }
              onSkip={() => goNext()}
            />
          )}
          {step === 6 && (
            <DoneStep onNext={() => goNext()} busy={busy} />
          )}
        </div>

        <div
          style={{
            position: "absolute",
            bottom: 60,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              style={{
                width: i === step ? 20 : 6,
                height: 5,
                borderRadius: 999,
                background: i <= step ? "var(--indigo)" : "var(--rule)",
                transition: "width 300ms var(--ease), background 300ms var(--ease)",
              }}
            />
          ))}
        </div>
      </div>

      <Wordmark bottom={34} left={30} />
    </main>
  );
}

function Heading({ serif, sans }: { serif: string; sans: string }) {
  return (
    <>
      <div
        style={{
          fontFamily: "var(--serif)",
          fontStyle: "italic",
          fontSize: 40,
          letterSpacing: "-0.6px",
          lineHeight: 1.1,
          marginBottom: 14,
        }}
      >
        {serif}
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 15,
          color: "var(--ink-3)",
          lineHeight: 1.55,
          marginBottom: 26,
        }}
      >
        {sans}
      </div>
    </>
  );
}

const PILL: React.CSSProperties = {
  marginTop: 18,
  padding: "12px 28px",
  borderRadius: 999,
  background: "var(--ink)",
  color: "#000",
  fontFamily: "var(--sans)",
  fontSize: 14,
  fontWeight: 500,
  border: "none",
  cursor: "pointer",
};

const PILL_GHOST: React.CSSProperties = {
  ...PILL,
  background: "transparent",
  color: "var(--ink-3)",
  border: "1px solid var(--rule)",
  marginTop: 10,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(255,255,255,0.03)",
  color: "var(--ink)",
  border: "1px solid var(--rule)",
  fontSize: 15,
  fontFamily: "var(--sans)",
  outline: "none",
  marginBottom: 10,
};

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div style={{ color: "#ff6b6b", fontSize: 12, marginTop: 6 }}>{error}</div>
  );
}

function Welcome({ onNext, busy }: { onNext: () => void; busy: boolean }) {
  return (
    <>
      <Heading
        serif="Hello."
        sans="I'm JARVIS. Give me ninety seconds and I'll be ready to help."
      />
      <button onClick={onNext} disabled={busy} style={PILL}>
        Begin
      </button>
    </>
  );
}

function ProfileStep({
  profile,
  setProfile,
  busy,
  error,
  onNext,
}: {
  profile: ProfileState;
  setProfile: (fn: (p: ProfileState) => ProfileState) => void;
  busy: boolean;
  error: string | null;
  onNext: () => void;
}) {
  return (
    <>
      <Heading
        serif="What should I call you?"
        sans="And where are you in the world? I'll schedule around your day."
      />
      <input
        autoFocus
        placeholder="First name"
        value={profile.display_name ?? ""}
        onChange={(e) =>
          setProfile((p) => ({ ...p, display_name: e.target.value }))
        }
        style={INPUT}
      />
      <input
        placeholder="Timezone (e.g. Europe/London)"
        value={profile.timezone ?? ""}
        onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))}
        style={INPUT}
      />
      <ErrorLine error={error} />
      <button onClick={onNext} disabled={busy} style={PILL}>
        Continue
      </button>
    </>
  );
}

function WhatsAppStep({
  profile,
  setProfile,
  busy,
  error,
  onNext,
  onSkip,
}: {
  profile: ProfileState;
  setProfile: (fn: (p: ProfileState) => ProfileState) => void;
  busy: boolean;
  error: string | null;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <Heading
        serif="Your WhatsApp number."
        sans="I'll message you here for briefings, nudges, and anything you fire off from the road."
      />
      <input
        autoFocus
        placeholder="+447700900000"
        value={profile.mobile_e164 ?? ""}
        onChange={(e) =>
          setProfile((p) => ({ ...p, mobile_e164: e.target.value }))
        }
        style={INPUT}
      />
      <ErrorLine error={error} />
      <button onClick={onNext} disabled={busy} style={PILL}>
        Save
      </button>
      <button onClick={onSkip} disabled={busy} style={PILL_GHOST}>
        Skip for now
      </button>
    </>
  );
}

function GmailStep({
  profile,
  busy,
  onNext,
}: {
  profile: ProfileState;
  busy: boolean;
  onNext: () => void;
}) {
  const connectGoogle = async () => {
    const supabase = supabaseBrowser();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
        scopes:
          "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events",
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
  };

  if (profile.google_connected) {
    return (
      <>
        <Heading
          serif="Gmail is connected."
          sans={`I'll read, draft, and triage for ${profile.email ?? "you"}. Nothing goes out without your yes.`}
        />
        <button onClick={onNext} disabled={busy} style={PILL}>
          Continue
        </button>
      </>
    );
  }

  return (
    <>
      <Heading
        serif="Connect Gmail + Calendar."
        sans="This is where most of life happens. I'll only draft — you approve before anything sends."
      />
      <button onClick={connectGoogle} disabled={busy} style={PILL}>
        Connect Google
      </button>
      <button onClick={onNext} disabled={busy} style={PILL_GHOST}>
        Skip for now
      </button>
    </>
  );
}

function PreferencesStep({
  profile,
  setProfile,
  busy,
  error,
  onNext,
}: {
  profile: ProfileState;
  setProfile: (fn: (p: ProfileState) => ProfileState) => void;
  busy: boolean;
  error: string | null;
  onNext: () => void;
}) {
  return (
    <>
      <Heading
        serif="How proactive should I be?"
        sans="You can change any of this later in Settings."
      />
      <Toggle
        label="Morning briefing"
        sub="07:00 summary over WhatsApp — revenue, calendar, inbox, weather."
        value={profile.briefing_enabled}
        onChange={(v) => setProfile((p) => ({ ...p, briefing_enabled: v }))}
      />
      <Toggle
        label="Proactive nudges"
        sub="I can start conversations when I spot something you'd want to know."
        value={profile.proactive_enabled}
        onChange={(v) => setProfile((p) => ({ ...p, proactive_enabled: v }))}
      />
      <div style={{ marginTop: 14 }}>
        <label
          style={{
            fontSize: 13,
            color: "var(--ink-3)",
            display: "block",
            marginBottom: 6,
            textAlign: "left",
          }}
        >
          Auto-spend limit (£)
        </label>
        <input
          type="number"
          min={0}
          placeholder="50"
          value={profile.concierge_auto_limit_gbp ?? ""}
          onChange={(e) =>
            setProfile((p) => ({
              ...p,
              concierge_auto_limit_gbp:
                e.target.value === "" ? null : Number(e.target.value),
            }))
          }
          style={INPUT}
        />
        <div style={{ fontSize: 11, color: "var(--ink-4, #666)", textAlign: "left" }}>
          Under this and I'll book / buy without checking. Over it, I ask first.
        </div>
      </div>
      <ErrorLine error={error} />
      <button onClick={onNext} disabled={busy} style={PILL}>
        Continue
      </button>
    </>
  );
}

function Toggle({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "12px 14px",
        marginBottom: 10,
        borderRadius: 10,
        border: "1px solid var(--rule)",
        background: value ? "rgba(88,101,242,0.08)" : "rgba(255,255,255,0.03)",
        color: "var(--ink)",
        cursor: "pointer",
        fontFamily: "var(--sans)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>
          {sub}
        </div>
      </div>
      <div
        style={{
          flexShrink: 0,
          marginTop: 2,
          width: 32,
          height: 18,
          borderRadius: 999,
          background: value ? "var(--indigo)" : "var(--rule)",
          position: "relative",
          transition: "background 200ms",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 2,
            left: value ? 16 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#fff",
            transition: "left 200ms",
          }}
        />
      </div>
    </button>
  );
}

function MemoryStep({
  value,
  setValue,
  busy,
  error,
  onNext,
  onSkip,
}: {
  value: string;
  setValue: (v: string) => void;
  busy: boolean;
  error: string | null;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <Heading
        serif="Tell me about yourself."
        sans="What do you do, what are you working on, anyone I should know about? I'll remember it."
      />
      <textarea
        autoFocus
        rows={5}
        placeholder="I run SevenPoint AI, I'm building JARVIS, I live in East London, my partner is…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ ...INPUT, resize: "none" }}
      />
      <ErrorLine error={error} />
      <button onClick={onNext} disabled={busy} style={PILL}>
        Save
      </button>
      <button onClick={onSkip} disabled={busy} style={PILL_GHOST}>
        Skip for now
      </button>
    </>
  );
}

function DoneStep({ onNext, busy }: { onNext: () => void; busy: boolean }) {
  return (
    <>
      <Heading
        serif="Ready."
        sans="Say 'Hey Vance' out loud, type in the command line, or WhatsApp me. I'm listening."
      />
      <button onClick={onNext} disabled={busy} style={PILL}>
        Go home
      </button>
    </>
  );
}
