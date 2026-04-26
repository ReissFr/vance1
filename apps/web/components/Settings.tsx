"use client";

import { useEffect, useState } from "react";
import { isTauri, tauriInvoke } from "@/lib/tauri";

type SensorKey = "focus" | "gesture" | "swipe" | "gaze" | "screen";
type SensorState = Record<SensorKey, boolean>;

const SENSOR_META: Record<SensorKey, { label: string; desc: string }> = {
  focus: {
    label: "Focus Pause",
    desc: "Pauses media when another face or voice appears AND you turn your head away. Resumes when you look back.",
  },
  gesture: {
    label: "Thumbs-up Approve",
    desc: "Hold a thumbs-up to the webcam (~1 sec) to approve the most recent pending task — e.g. a £150 errand charge.",
  },
  swipe: {
    label: "Swipe to close tab",
    desc: "Quick horizontal hand sweep in front of the webcam closes the current browser tab (⌘W). Only fires when a browser is frontmost.",
  },
  gaze: {
    label: "Head-tilt scroll",
    desc: "Tilt your head up or down to smoothly scroll the current page — small tilt scrolls slow, bigger tilt scrolls fast. Also nudges you after 20 min on the same app.",
  },
  screen: {
    label: "Ambient screen context",
    desc: "Silently OCRs the frontmost window every ~15s so JARVIS can answer 'what's this email about?' or 'reply to this' without you copying anything. On-device, private.",
  },
};

interface Profile {
  display_name: string | null;
  mobile_e164: string | null;
  voice_id: string | null;
}

interface IntegrationStatus {
  banking: { connected: boolean; provider: string | null };
}

interface ConciergePreset {
  id: string;
  name: string;
  domain: string;
}

interface ConciergePaired {
  provider: string;
  display_name: string;
  domain: string;
  cookie_count: number;
  updated_at: string;
}

interface ConciergeList {
  paired: ConciergePaired[];
  presets: ConciergePreset[];
  auto_limit_gbp: number;
}

export function SettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-white/60 hover:text-white/90"
        aria-label="Settings"
      >
        ⚙
      </button>
      {open && <SettingsPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [mobile, setMobile] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);
  const [bankingError, setBankingError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualJson, setManualJson] = useState("");
  const [manualSaving, setManualSaving] = useState(false);
  const [manualMsg, setManualMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [concierge, setConcierge] = useState<ConciergeList | null>(null);
  const [conciergeMsg, setConciergeMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [limitInput, setLimitInput] = useState("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [pairPreset, setPairPreset] = useState<string>("opentable");
  const [pairing, setPairing] = useState<{ pair_id: string; display_name: string } | null>(null);
  const [pairStarting, setPairStarting] = useState(false);
  const [pairFinishing, setPairFinishing] = useState(false);
  const [callTo, setCallTo] = useState("");
  const [callGoal, setCallGoal] = useState("");
  const [callStarting, setCallStarting] = useState(false);
  const [callMsg, setCallMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [sensors, setSensors] = useState<SensorState | null>(null);
  const [sensorBusy, setSensorBusy] = useState<SensorKey | null>(null);
  const [sensorErr, setSensorErr] = useState<string | null>(null);
  const [swipeDir, setSwipeDir] = useState<"left" | "right" | "either">("left");

  const toggleSensor = async (which: SensorKey) => {
    const invoke = tauriInvoke();
    if (!invoke || !sensors) return;
    setSensorBusy(which);
    setSensorErr(null);
    const turnOn = !sensors[which];
    try {
      await invoke(`${which}_${turnOn ? "start" : "stop"}`);
      setSensors({ ...sensors, [which]: turnOn });
    } catch (e) {
      setSensorErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSensorBusy(null);
    }
  };

  const startTestCall = async () => {
    setCallMsg(null);
    setCallStarting(true);
    try {
      const r = await fetch("/api/outbound-call/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to_e164: callTo.trim(), goal: callGoal.trim() }),
      });
      const data = (await r.json()) as { ok: boolean; id?: string; error?: string };
      if (!r.ok || !data.ok) {
        setCallMsg({ kind: "err", text: data.error ?? "failed to start call" });
        return;
      }
      setCallMsg({ kind: "ok", text: `Calling… (outbound_calls.id = ${data.id})` });
    } catch (e) {
      setCallMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setCallStarting(false);
    }
  };

  const loadConcierge = async () => {
    try {
      const r = await fetch("/api/integrations/concierge/list");
      if (!r.ok) return;
      const data = (await r.json()) as ConciergeList;
      setConcierge(data);
      setLimitInput(String(data.auto_limit_gbp ?? 0));
    } catch {}
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((r) => r.json())
      .then((data: Profile) => {
        if (cancelled) return;
        setProfile(data);
        setMobile(data.mobile_e164 ?? "");
      })
      .catch(() => {});
    fetch("/api/integrations/status")
      .then((r) => r.json())
      .then((data: IntegrationStatus) => {
        if (cancelled) return;
        setIntegrations(data);
      })
      .catch(() => {});
    loadConcierge();
    const invoke = tauriInvoke();
    if (invoke) {
      Promise.all([
        invoke("focus_is_active").catch(() => false),
        invoke("gesture_is_active").catch(() => false),
        invoke("swipe_is_active").catch(() => false),
        invoke("gaze_is_active").catch(() => false),
        invoke("screen_is_active").catch(() => false),
      ]).then(([focus, gesture, swipe, gaze, scr]) => {
        if (cancelled) return;
        setSensors({
          focus: Boolean(focus),
          gesture: Boolean(gesture),
          swipe: Boolean(swipe),
          gaze: Boolean(gaze),
          screen: Boolean(scr),
        });
      });
      invoke("swipe_get_direction")
        .then((d) => {
          if (cancelled) return;
          if (d === "left" || d === "right" || d === "either") setSwipeDir(d);
        })
        .catch(() => {});
    }
    // Read ?tl_connected / ?tl_error from URL so we can show a toast and clean up.
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("tl_connected")) {
        setMsg({ kind: "ok", text: "Bank connected." });
      }
      const tlErr = params.get("tl_error");
      if (tlErr) setBankingError(tlErr);
      if (params.get("tl_connected") || params.get("tl_error")) {
        params.delete("tl_connected");
        params.delete("tl_error");
        const clean =
          window.location.pathname + (params.toString() ? `?${params.toString()}` : "");
        window.history.replaceState({}, "", clean);
      }
    }
    return () => {
      cancelled = true;
    };
  }, []);

  const saveMobile = async () => {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mobile_e164: mobile.trim() || null }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "failed" }));
      setMsg({ kind: "err", text: body.error ?? "failed" });
      return;
    }
    setMsg({ kind: "ok", text: "Saved." });
    setProfile((p) => (p ? { ...p, mobile_e164: mobile.trim() || null } : p));
  };

  const saveManualToken = async () => {
    setManualSaving(true);
    setManualMsg(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(manualJson);
    } catch {
      setManualSaving(false);
      setManualMsg({ kind: "err", text: "Invalid JSON" });
      return;
    }
    const res = await fetch("/api/integrations/truelayer/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(parsed),
    });
    setManualSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "failed" }));
      setManualMsg({ kind: "err", text: body.error ?? "failed" });
      return;
    }
    setManualMsg({ kind: "ok", text: "Token saved. Bank connected." });
    setManualJson("");
    setIntegrations({ banking: { connected: true, provider: "truelayer" } });
  };

  const startPair = async () => {
    setPairStarting(true);
    setConciergeMsg(null);
    try {
      const r = await fetch("/api/integrations/concierge/pair/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preset_id: pairPreset }),
      });
      const data = await r.json();
      if (!r.ok) {
        setConciergeMsg({ kind: "err", text: data.error ?? "failed to start pairing" });
        return;
      }
      setPairing({ pair_id: data.pair_id, display_name: data.display_name });
      setConciergeMsg({
        kind: "ok",
        text: `A browser just opened — log in to ${data.display_name}, then click "I'm logged in".`,
      });
    } finally {
      setPairStarting(false);
    }
  };

  const finishPair = async () => {
    if (!pairing) return;
    setPairFinishing(true);
    try {
      const r = await fetch("/api/integrations/concierge/pair/finish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pair_id: pairing.pair_id }),
      });
      const data = await r.json();
      if (!r.ok) {
        setConciergeMsg({ kind: "err", text: data.error ?? "failed to capture session" });
        return;
      }
      setConciergeMsg({
        kind: "ok",
        text: `Paired ${data.display_name} (${data.cookie_count} cookies).`,
      });
      setPairing(null);
      await loadConcierge();
    } finally {
      setPairFinishing(false);
    }
  };

  const cancelPair = async () => {
    if (!pairing) return;
    await fetch("/api/integrations/concierge/pair/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pair_id: pairing.pair_id }),
    });
    setPairing(null);
    setConciergeMsg(null);
  };

  const removePair = async (provider: string) => {
    const r = await fetch("/api/integrations/concierge/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({ error: "failed" }));
      setConciergeMsg({ kind: "err", text: body.error ?? "failed" });
      return;
    }
    await loadConcierge();
  };

  const saveLimit = async () => {
    const gbp = Number(limitInput);
    if (!Number.isFinite(gbp) || gbp < 0 || gbp > 10000) {
      setConciergeMsg({ kind: "err", text: "Limit must be £0–£10,000" });
      return;
    }
    setSavingLimit(true);
    try {
      const r = await fetch("/api/integrations/concierge/limit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gbp }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({ error: "failed" }));
        setConciergeMsg({ kind: "err", text: body.error ?? "failed" });
        return;
      }
      setConciergeMsg({ kind: "ok", text: `Limit saved (£${gbp.toFixed(2)}).` });
      await loadConcierge();
    } finally {
      setSavingLimit(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel border border-white/10 rounded-xl max-w-md w-full p-5 space-y-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-white/50 hover:text-white/90" aria-label="Close">
            ✕
          </button>
        </div>

        <section className="space-y-2">
          <label className="block text-sm text-white/70">Mobile number</label>
          <p className="text-xs text-white/40">
            E.164 format, e.g. <code className="text-white/60">+447700900000</code>. Used when Vance
            texts or calls you.
          </p>
          <div className="flex gap-2">
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="+447700900000"
              className="flex-1 bg-bg border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent/50"
            />
            <button
              onClick={saveMobile}
              disabled={saving || !profile}
              className="px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          {msg && (
            <p className={`text-xs ${msg.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
              {msg.text}
            </p>
          )}
        </section>

        {isTauri() && sensors && (
          <section className="space-y-2 pt-3 border-t border-white/5">
            <label className="block text-sm text-white/70">Webcam sensors</label>
            <p className="text-xs text-white/40">
              Mac-only ambient features. Each one opens its own camera session —
              leave them off unless you want them. macOS will prompt for camera /
              mic access on first use.
            </p>
            <div className="space-y-2">
              {(Object.keys(SENSOR_META) as SensorKey[]).map((key) => {
                const on = sensors[key];
                const meta = SENSOR_META[key];
                const busy = sensorBusy === key;
                return (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-white/80">{meta.label}</div>
                      <div className="text-[11px] text-white/40">{meta.desc}</div>
                    </div>
                    <button
                      onClick={() => toggleSensor(key)}
                      disabled={busy}
                      className={`shrink-0 px-3 py-1 rounded-lg text-xs border disabled:opacity-50 ${
                        on
                          ? "bg-accent/20 border-accent/40 text-white"
                          : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                      }`}
                    >
                      {busy ? "…" : on ? "On" : "Off"}
                    </button>
                  </div>
                );
              })}
            </div>
            {sensors.swipe && (
              <div className="flex items-center justify-between gap-3 bg-white/[0.02] rounded-lg px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs text-white/80">Swipe direction</div>
                  <div className="text-[11px] text-white/40">
                    Only fires when your hand moves this way. If the wrong direction triggers,
                    flip this.
                  </div>
                </div>
                <select
                  value={swipeDir}
                  onChange={async (e) => {
                    const v = e.target.value as "left" | "right" | "either";
                    setSwipeDir(v);
                    const invoke = tauriInvoke();
                    if (invoke) {
                      try {
                        await invoke("swipe_set_direction", { direction: v });
                      } catch (err) {
                        setSensorErr(err instanceof Error ? err.message : String(err));
                      }
                    }
                  }}
                  className="shrink-0 bg-bg border border-white/10 rounded-lg px-2 py-1 text-xs"
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="either">Either</option>
                </select>
              </div>
            )}
            {sensorErr && <p className="text-xs text-red-400">{sensorErr}</p>}
          </section>
        )}

        <section className="space-y-2 pt-3 border-t border-white/5">
          <label className="block text-sm text-white/70">Banking (TrueLayer)</label>
          <p className="text-xs text-white/40">
            Connects Revolut, Monzo, Starling, Barclays, HSBC — lets Vance answer
            "how much did I spend on X" and show balances.
          </p>
          {integrations?.banking.connected ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-green-400">
                ✓ Connected ({integrations.banking.provider})
              </span>
              <a
                href="/api/integrations/truelayer/start"
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10"
              >
                Reconnect
              </a>
            </div>
          ) : (
            <a
              href="/api/integrations/truelayer/start"
              className="inline-block px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm"
            >
              Connect bank
            </a>
          )}
          {bankingError && (
            <p className="text-xs text-red-400">
              Connection error: {bankingError}
            </p>
          )}
          <button
            onClick={() => setShowManual((v) => !v)}
            className="text-xs text-white/40 hover:text-white/70 underline"
          >
            {showManual ? "Hide manual token entry" : "OAuth not working? Paste token manually"}
          </button>
          {showManual && (
            <div className="space-y-2 pt-1">
              <p className="text-xs text-white/40">
                Paste the JSON response from TrueLayer&apos;s <code>/connect/token</code> endpoint
                (must include <code>access_token</code>, <code>refresh_token</code>, <code>expires_in</code>).
              </p>
              <textarea
                value={manualJson}
                onChange={(e) => setManualJson(e.target.value)}
                placeholder={'{\n  "access_token": "...",\n  "refresh_token": "...",\n  "expires_in": 3600\n}'}
                rows={6}
                className="w-full bg-bg border border-white/10 rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-accent/50"
              />
              <button
                onClick={saveManualToken}
                disabled={manualSaving || !manualJson.trim()}
                className="px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm disabled:opacity-50"
              >
                {manualSaving ? "Saving…" : "Save token"}
              </button>
              {manualMsg && (
                <p className={`text-xs ${manualMsg.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
                  {manualMsg.text}
                </p>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2 pt-3 border-t border-white/5">
          <label className="block text-sm text-white/70">Concierge sites</label>
          <p className="text-xs text-white/40">
            Log in once to sites the concierge agent should use on your behalf (Uber,
            OpenTable, Booking, etc.). A headless browser will reuse the session on tasks.
          </p>

          {concierge?.paired && concierge.paired.length > 0 && (
            <ul className="space-y-1">
              {concierge.paired.map((p) => (
                <li
                  key={p.provider}
                  className="flex items-center justify-between gap-2 bg-white/[0.02] rounded-lg px-3 py-2"
                >
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-white/80 truncate">{p.display_name}</span>
                    <span className="text-[10px] text-white/40">
                      {p.cookie_count} cookies · {new Date(p.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    onClick={() => removePair(p.provider)}
                    className="text-xs text-white/50 hover:text-red-400 px-2"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          {!pairing ? (
            <div className="flex gap-2">
              <select
                value={pairPreset}
                onChange={(e) => setPairPreset(e.target.value)}
                className="flex-1 bg-bg border border-white/10 rounded-lg px-3 py-2 text-sm"
              >
                {concierge?.presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                onClick={startPair}
                disabled={pairStarting || !concierge}
                className="px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm disabled:opacity-50"
              >
                {pairStarting ? "Opening…" : "Add site"}
              </button>
            </div>
          ) : (
            <div className="space-y-2 bg-white/[0.02] rounded-lg p-3">
              <p className="text-xs text-white/70">
                Log into <strong>{pairing.display_name}</strong> in the browser window that
                just opened, then click below.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={finishPair}
                  disabled={pairFinishing}
                  className="flex-1 px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm disabled:opacity-50"
                >
                  {pairFinishing ? "Capturing…" : "I'm logged in"}
                </button>
                <button
                  onClick={cancelPair}
                  className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="pt-2 space-y-1">
            <label className="block text-xs text-white/60">
              Autonomous spend limit (GBP)
            </label>
            <p className="text-[11px] text-white/40">
              Bookings at or under this amount are confirmed automatically. Above this,
              the agent pauses and pings you on WhatsApp. Set 0 to require approval for
              everything.
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                max={10000}
                step={1}
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="w-32 bg-bg border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={saveLimit}
                disabled={savingLimit}
                className="px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm disabled:opacity-50"
              >
                {savingLimit ? "Saving…" : "Save"}
              </button>
            </div>
          </div>

          {conciergeMsg && (
            <p className={`text-xs ${conciergeMsg.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
              {conciergeMsg.text}
            </p>
          )}
        </section>

        <section className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-medium">Outbound PA — test call</h2>
            <p className="text-[11px] text-white/40 mt-1">
              JARVIS will call the number below and pursue the goal. Transcript +
              outcome land in <code>outbound_calls</code>; a WhatsApp summary hits
              your mobile when the call ends.
            </p>
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-xs text-white/60 mb-1">Number (E.164)</label>
              <input
                type="tel"
                placeholder="+4407700900000"
                value={callTo}
                onChange={(e) => setCallTo(e.target.value)}
                className="w-full bg-bg border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1">Goal</label>
              <textarea
                rows={3}
                placeholder="e.g. Book a dental check-up for Reiss, ideally weekday mornings next week. His contact number is +44..."
                value={callGoal}
                onChange={(e) => setCallGoal(e.target.value)}
                className="w-full bg-bg border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={startTestCall}
              disabled={callStarting || !callTo.trim() || !callGoal.trim()}
              className="px-3 py-2 bg-accent/20 border border-accent/40 rounded-lg text-sm disabled:opacity-50"
            >
              {callStarting ? "Placing call…" : "Place call"}
            </button>
            {callMsg && (
              <p className={`text-xs ${callMsg.kind === "ok" ? "text-green-400" : "text-red-400"}`}>
                {callMsg.text}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
