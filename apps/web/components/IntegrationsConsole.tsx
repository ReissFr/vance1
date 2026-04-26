"use client";

// IntegrationsConsole: real connection management. Only shows providers this
// app has actual backend wiring for, pulls connection state from the DB, and
// every button does something. No fake chips.

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/jarvis/primitives";
import { Chip } from "@/components/jarvis/Chip";
import { supabaseBrowser } from "@/lib/supabase/client";

type ProviderKey =
  | "gmail"
  | "gcal"
  | "stripe"
  | "paypal"
  | "square"
  | "shopify"
  | "xero"
  | "quickbooks"
  | "freeagent"
  | "smartthings"
  | "truelayer"
  | "monzo"
  | "plaid"
  | "coinbase"
  | "kraken"
  | "notion"
  | "github"
  | "slack"
  | "calcom"
  | "linear"
  | "todoist"
  | "resend"
  | "google_drive";

type Row = {
  key: ProviderKey;
  kind: string;
  provider: string;
  connected: boolean;
  email: string | null;
  updated_at: string | null;
  expires_at: string | null;
};

type ListResponse = { ok: true; integrations: Row[] };

type Meta = {
  name: string;
  category: string;
  description: string;
  connect:
    | "google"
    | "truelayer"
    | "stripe"
    | "smartthings"
    | "monzo"
    | "coinbase"
    | "kraken"
    | "paypal"
    | "square"
    | "shopify"
    | "xero"
    | "quickbooks"
    | "freeagent"
    | "notion"
    | "github"
    | "slack"
    | "calcom"
    | "linear"
    | "todoist"
    | "resend"
    | "google_drive"
    | "plaid";
  note?: string;
};

const META: Record<ProviderKey, Meta> = {
  gmail: {
    name: "Gmail",
    category: "Email",
    description: "Read, triage and draft replies. Never sends without asking.",
    connect: "google",
  },
  gcal: {
    name: "Google Calendar",
    category: "Calendar",
    description: "Read and create events. Rides on the Gmail sign-in.",
    connect: "google",
    note: "Connects together with Gmail",
  },
  stripe: {
    name: "Stripe",
    category: "Payments",
    description: "Revenue, payouts, refunds — read-only.",
    connect: "stripe",
  },
  paypal: {
    name: "PayPal",
    category: "Payments",
    description: "Transactions and revenue via your developer app keys.",
    connect: "paypal",
  },
  square: {
    name: "Square",
    category: "Payments",
    description: "Payments, orders, customers — read-only.",
    connect: "square",
  },
  shopify: {
    name: "Shopify",
    category: "Commerce",
    description: "Orders, products, inventory — read-only.",
    connect: "shopify",
  },
  xero: {
    name: "Xero",
    category: "Accounting",
    description: "Invoices, expenses, contacts, balances.",
    connect: "xero",
  },
  quickbooks: {
    name: "QuickBooks",
    category: "Accounting",
    description: "Invoices, expenses, balances from QuickBooks Online.",
    connect: "quickbooks",
  },
  freeagent: {
    name: "FreeAgent",
    category: "Accounting",
    description: "Invoices, expenses, bank balances.",
    connect: "freeagent",
  },
  smartthings: {
    name: "SmartThings",
    category: "Smart home",
    description: "Lights, TV, thermostat, locks.",
    connect: "smartthings",
  },
  truelayer: {
    name: "TrueLayer",
    category: "Banking",
    description: "Open-banking feed for spending and balances.",
    connect: "truelayer",
  },
  monzo: {
    name: "Monzo",
    category: "Banking",
    description: "Direct Monzo feed — transactions, pots, spending.",
    connect: "monzo",
    note: "You'll need to approve the grant in the Monzo app after signing in.",
  },
  coinbase: {
    name: "Coinbase",
    category: "Crypto",
    description: "Wallets, balances, transactions — read-only.",
    connect: "coinbase",
  },
  kraken: {
    name: "Kraken",
    category: "Crypto",
    description: "Balances, trades, staking rewards — read-only.",
    connect: "kraken",
  },
  notion: {
    name: "Notion",
    category: "Productivity",
    description: "Search pages, read, append, create pages, add database rows.",
    connect: "notion",
  },
  github: {
    name: "GitHub",
    category: "Dev",
    description: "Issues, pull requests, notifications, code search.",
    connect: "github",
  },
  slack: {
    name: "Slack",
    category: "Messaging",
    description: "Read channels, send messages, DM users.",
    connect: "slack",
  },
  calcom: {
    name: "Cal.com",
    category: "Scheduling",
    description: "Bookings, event types, share your scheduling link.",
    connect: "calcom",
  },
  linear: {
    name: "Linear",
    category: "Tasks",
    description: "Issues, projects, assignments — create, comment, close.",
    connect: "linear",
  },
  todoist: {
    name: "Todoist",
    category: "Tasks",
    description: "Personal to-do list — create tasks, projects, complete.",
    connect: "todoist",
  },
  resend: {
    name: "Resend",
    category: "Transactional email",
    description:
      "Send transactional emails from your verified domain (not your Gmail).",
    connect: "resend",
  },
  google_drive: {
    name: "Google Drive",
    category: "Files",
    description: "Search, read, upload files. Separate Drive-scoped sign-in.",
    connect: "google_drive",
  },
  plaid: {
    name: "Plaid",
    category: "Banking",
    description:
      "US-primary open-banking feed — spending, balances, transactions.",
    connect: "plaid",
    note: "Connects via Plaid Link, not OAuth.",
  },
};

const ORDER: ProviderKey[] = [
  "gmail",
  "gcal",
  "calcom",
  "slack",
  "notion",
  "linear",
  "todoist",
  "google_drive",
  "github",
  "resend",
  "stripe",
  "paypal",
  "square",
  "shopify",
  "xero",
  "quickbooks",
  "freeagent",
  "smartthings",
  "monzo",
  "truelayer",
  "plaid",
  "coinbase",
  "kraken",
];

export function IntegrationsConsole() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [modal, setModal] = useState<ProviderKey | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/list", { cache: "no-store" });
      const body = (await res.json()) as ListResponse;
      if (!res.ok) throw new Error("load failed");
      setRows(body.integrations);
    } catch (e) {
      setFlash(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = useCallback(
    async (key: ProviderKey) => {
      setFlash(null);
      const meta = META[key];
      if (meta.connect === "google") {
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
        return;
      }
      if (meta.connect === "truelayer") {
        window.location.href = "/api/integrations/truelayer/start";
        return;
      }
      if (meta.connect === "monzo") {
        window.location.href = "/api/integrations/monzo/start";
        return;
      }
      if (meta.connect === "coinbase") {
        window.location.href = "/api/integrations/coinbase/start";
        return;
      }
      if (meta.connect === "xero") {
        window.location.href = "/api/integrations/xero/start";
        return;
      }
      if (meta.connect === "quickbooks") {
        window.location.href = "/api/integrations/quickbooks/start";
        return;
      }
      if (meta.connect === "freeagent") {
        window.location.href = "/api/integrations/freeagent/start";
        return;
      }
      if (meta.connect === "notion") {
        window.location.href = "/api/integrations/notion/start";
        return;
      }
      if (meta.connect === "github") {
        window.location.href = "/api/integrations/github/start";
        return;
      }
      if (meta.connect === "slack") {
        window.location.href = "/api/integrations/slack/start";
        return;
      }
      if (meta.connect === "calcom") {
        setModal(key);
        return;
      }
      if (meta.connect === "linear") {
        window.location.href = "/api/integrations/linear/start";
        return;
      }
      if (meta.connect === "todoist") {
        window.location.href = "/api/integrations/todoist/start";
        return;
      }
      if (meta.connect === "google_drive") {
        window.location.href = "/api/integrations/drive/start";
        return;
      }
      if (meta.connect === "resend") {
        setModal(key);
        return;
      }
      if (meta.connect === "plaid") {
        setModal(key);
        return;
      }
      if (meta.connect === "kraken") {
        setModal(key);
        return;
      }
      if (meta.connect === "paypal" || meta.connect === "square" || meta.connect === "shopify") {
        setModal(key);
        return;
      }
      setModal(key);
    },
    [],
  );

  const handleDisconnect = useCallback(
    async (row: Row) => {
      if (!confirm(`Disconnect ${META[row.key].name}?`)) return;
      setFlash(null);
      try {
        const res = await fetch("/api/integrations/disconnect", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind: row.kind, provider: row.provider }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "disconnect failed");
        setFlash(`${META[row.key].name} disconnected`);
        await load();
      } catch (e) {
        setFlash(e instanceof Error ? e.message : String(e));
      }
    },
    [load],
  );

  const connectedCount = rows?.filter((r) => r.connected).length ?? 0;
  const availableCount = (rows?.length ?? 0) - connectedCount;

  return (
    <>
      <div
        style={{
          padding: "20px 32px 0",
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          letterSpacing: "1.6px",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          display: "flex",
          gap: 16,
        }}
      >
        <span>
          {connectedCount.toString().padStart(2, "0")} connected
        </span>
        <span>
          {availableCount.toString().padStart(2, "0")} available
        </span>
        <span style={{ flex: 1 }} />
        {flash && <span style={{ color: "var(--ink-2)" }}>{flash}</span>}
      </div>

      <div
        style={{
          padding: "24px 32px 48px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        {!rows &&
          ORDER.map((k) => (
            <Card key={k} padding="20px 22px 18px">
              <div style={{ opacity: 0.4 }}>{META[k].name}</div>
            </Card>
          ))}
        {rows &&
          ORDER.map((k) => {
            const row = rows.find((r) => r.key === k);
            if (!row) return null;
            return (
              <ProviderCard
                key={k}
                row={row}
                meta={META[k]}
                onConnect={() => void handleConnect(k)}
                onDisconnect={() => void handleDisconnect(row)}
              />
            );
          })}
      </div>

      {modal === "stripe" && (
        <StripeModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Stripe connected");
            void load();
          }}
        />
      )}
      {modal === "smartthings" && (
        <SmartThingsModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("SmartThings connected");
            void load();
          }}
        />
      )}
      {modal === "kraken" && (
        <KrakenModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Kraken connected");
            void load();
          }}
        />
      )}
      {modal === "paypal" && (
        <PayPalModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("PayPal connected");
            void load();
          }}
        />
      )}
      {modal === "square" && (
        <SquareModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Square connected");
            void load();
          }}
        />
      )}
      {modal === "shopify" && (
        <ShopifyModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Shopify connected");
            void load();
          }}
        />
      )}
      {modal === "calcom" && (
        <CalComModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Cal.com connected");
            void load();
          }}
        />
      )}
      {modal === "resend" && (
        <ResendModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Resend connected");
            void load();
          }}
        />
      )}
      {modal === "plaid" && (
        <PlaidModal
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setFlash("Plaid connected");
            void load();
          }}
        />
      )}
    </>
  );
}

function ProviderCard({
  row,
  meta,
  onConnect,
  onDisconnect,
}: {
  row: Row;
  meta: Meta;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <Card padding="20px 22px 18px">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 15,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {meta.name}
        </div>
        <Chip
          color={row.connected ? "var(--indigo)" : "var(--ink-3)"}
          border={row.connected ? "var(--indigo-soft)" : "var(--rule)"}
          size={9.5}
        >
          {row.connected ? "connected" : "not connected"}
        </Chip>
      </div>
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-4)",
          letterSpacing: "1px",
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        {meta.category}
      </div>
      <div
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "var(--ink-3)",
          lineHeight: 1.5,
          minHeight: 40,
        }}
      >
        {meta.description}
      </div>
      {row.connected && row.email && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-3)",
            marginTop: 10,
          }}
        >
          {row.email}
        </div>
      )}
      {meta.note && !row.connected && (
        <div
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10.5,
            color: "var(--ink-4)",
            marginTop: 10,
            letterSpacing: "0.4px",
          }}
        >
          {meta.note}
        </div>
      )}
      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        {row.connected ? (
          <button
            onClick={onDisconnect}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "var(--ink-3)",
              background: "transparent",
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid var(--rule)",
              cursor: "pointer",
            }}
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={onConnect}
            disabled={meta.note === "Connects together with Gmail"}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 12.5,
              color: "#000",
              background: "var(--ink)",
              padding: "5px 12px",
              borderRadius: 999,
              border: "1px solid var(--ink)",
              cursor: "pointer",
              fontWeight: 500,
              opacity: meta.note === "Connects together with Gmail" ? 0.4 : 1,
            }}
          >
            Connect
          </button>
        )}
      </div>
    </Card>
  );
}

function StripeModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  return (
    <ManualKeyModal
      title="Connect Stripe"
      helper={
        <>
          Paste a restricted or standard secret key (starts with <code>sk_</code>).
          Get one from Stripe dashboard → Developers → API keys.
        </>
      }
      placeholder="sk_live_..."
      onClose={onClose}
      onSubmit={async (value) => {
        const res = await fetch("/api/integrations/stripe/manual", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret_key: value }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
        onSaved();
      }}
    />
  );
}

function KrakenModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!apiKey.trim() || !apiSecret.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/integrations/kraken/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey.trim(),
          api_secret: apiSecret.trim(),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "26px 28px",
          width: 460,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            color: "var(--ink)",
            letterSpacing: "-0.2px",
          }}
        >
          Connect Kraken
        </div>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          Kraken → Settings → Security → API. Create a key with{" "}
          <strong>Query Funds</strong> and <strong>Query Ledger Entries</strong> permissions
          only. Do NOT enable trade or withdraw — keep it read-only.
        </div>
        <input
          autoFocus
          type="text"
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--rule)",
            background: "var(--surface-2)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        <input
          type="password"
          placeholder="API Secret (base64)"
          value={apiSecret}
          onChange={(e) => setApiSecret(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--rule)",
            background: "var(--surface-2)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        {err && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--magenta)",
            }}
          >
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-3)",
              background: "transparent",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--rule)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !apiKey.trim() || !apiSecret.trim()}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "#000",
              background: "var(--ink)",
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--ink)",
              cursor: busy ? "default" : "pointer",
              fontWeight: 500,
              opacity: busy || !apiKey.trim() || !apiSecret.trim() ? 0.5 : 1,
            }}
          >
            {busy ? "saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PayPalModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [env, setEnv] = useState<"live" | "sandbox">("live");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!clientId.trim() || !clientSecret.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/integrations/paypal/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId.trim(),
          client_secret: clientSecret.trim(),
          env,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TwoFieldModal
      title="Connect PayPal"
      helper={
        <>
          PayPal Developer Dashboard → My Apps & Credentials → pick an app (or
          create a live app). Paste the Client ID and Secret.
        </>
      }
      field1Label="Client ID"
      field1Value={clientId}
      field1Set={setClientId}
      field1Placeholder="AU8l..."
      field1Secret={false}
      field2Label="Client Secret"
      field2Value={clientSecret}
      field2Set={setClientSecret}
      field2Placeholder="EB9..."
      field2Secret
      extra={
        <label style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>
          <input
            type="checkbox"
            checked={env === "sandbox"}
            onChange={(e) => setEnv(e.target.checked ? "sandbox" : "live")}
            style={{ marginRight: 6 }}
          />
          Use sandbox environment
        </label>
      }
      busy={busy}
      err={err}
      onClose={onClose}
      onSubmit={submit}
    />
  );
}

function SquareModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [token, setToken] = useState("");
  const [env, setEnv] = useState<"live" | "sandbox">("live");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!token.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/integrations/square/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: token.trim(), env }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <OneFieldModal
      title="Connect Square"
      helper={
        <>
          Square Developer Dashboard → your app → Credentials. Use the
          access token — live for real data, sandbox for testing.
        </>
      }
      fieldLabel="Access Token"
      fieldValue={token}
      fieldSet={setToken}
      fieldPlaceholder="EAAA..."
      fieldSecret
      extra={
        <label style={{ fontFamily: "var(--sans)", fontSize: 12.5, color: "var(--ink-3)" }}>
          <input
            type="checkbox"
            checked={env === "sandbox"}
            onChange={(e) => setEnv(e.target.checked ? "sandbox" : "live")}
            style={{ marginRight: 6 }}
          />
          Use sandbox environment
        </label>
      }
      busy={busy}
      err={err}
      onClose={onClose}
      onSubmit={submit}
    />
  );
}

function ShopifyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!shop.trim() || !token.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/integrations/shopify/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shop_domain: shop.trim(),
          admin_access_token: token.trim(),
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TwoFieldModal
      title="Connect Shopify"
      helper={
        <>
          In your Shopify admin: Apps and sales channels → Develop apps →
          create app → configure Admin API scopes (read_orders, read_products,
          read_inventory) → install → reveal the Admin API access token.
        </>
      }
      field1Label="Shop Domain"
      field1Value={shop}
      field1Set={setShop}
      field1Placeholder="myshop.myshopify.com"
      field1Secret={false}
      field2Label="Admin API Access Token"
      field2Value={token}
      field2Set={setToken}
      field2Placeholder="shpat_..."
      field2Secret
      busy={busy}
      err={err}
      onClose={onClose}
      onSubmit={submit}
    />
  );
}

function CalComModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  return (
    <ManualKeyModal
      title="Connect Cal.com"
      helper={
        <>
          Cal.com → Settings → Developer → API Keys → create an API key
          (starts with <code>cal_</code>). Paste it here.
        </>
      }
      placeholder="cal_live_..."
      onClose={onClose}
      onSubmit={async (value) => {
        const res = await fetch("/api/integrations/calcom/manual", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ api_key: value }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
        onSaved();
      }}
    />
  );
}

function ResendModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [defaultFrom, setDefaultFrom] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/integrations/resend/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey.trim(),
          default_from: defaultFrom.trim() || undefined,
          domain: domain.trim() || undefined,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Connect Resend"
      helper={
        <>
          Paste an API key from{" "}
          <a
            href="https://resend.com/api-keys"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--indigo)" }}
          >
            resend.com/api-keys
          </a>
          . Optionally set a verified default sender so you don't have to pass
          from= every time.
        </>
      }
      onClose={onClose}
    >
      <LabeledInput
        label="API Key"
        value={apiKey}
        onChange={setApiKey}
        placeholder="re_..."
        secret
        onEnter={submit}
      />
      <LabeledInput
        label="Default From (optional)"
        value={defaultFrom}
        onChange={setDefaultFrom}
        placeholder="JARVIS <noreply@yourdomain.com>"
        secret={false}
        onEnter={submit}
      />
      <LabeledInput
        label="Domain (optional)"
        value={domain}
        onChange={setDomain}
        placeholder="yourdomain.com"
        secret={false}
        onEnter={submit}
      />
      {err && <ErrLine text={err} />}
      <ModalActions
        busy={busy}
        canSubmit={apiKey.trim().length > 0}
        onCancel={onClose}
        onSubmit={() => void submit()}
      />
    </ModalShell>
  );
}

function PlaidModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Load the Plaid Link JS bundle once.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const win = window as unknown as { Plaid?: unknown };
    if (win.Plaid) {
      setReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => setErr("Failed to load Plaid Link");
    document.body.appendChild(script);
  }, []);

  const start = async () => {
    setBusy(true);
    setErr(null);
    try {
      const tokenRes = await fetch("/api/integrations/plaid/link-token", { method: "POST" });
      const tokenBody = (await tokenRes.json()) as { ok?: boolean; link_token?: string; error?: string };
      if (!tokenRes.ok || !tokenBody.link_token) {
        throw new Error(tokenBody.error ?? "link_token failed");
      }

      const win = window as unknown as {
        Plaid?: {
          create: (opts: {
            token: string;
            onSuccess: (
              public_token: string,
              metadata: { institution?: { name?: string; institution_id?: string } },
            ) => void;
            onExit: (err: unknown) => void;
          }) => { open: () => void };
        };
      };
      if (!win.Plaid) throw new Error("Plaid Link not loaded");

      const handler = win.Plaid.create({
        token: tokenBody.link_token,
        onSuccess: async (public_token, metadata) => {
          try {
            const cbRes = await fetch("/api/integrations/plaid/callback", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                public_token,
                institution: metadata.institution,
              }),
            });
            const cbBody = (await cbRes.json()) as { ok: boolean; error?: string };
            if (!cbRes.ok || !cbBody.ok) throw new Error(cbBody.error ?? "callback failed");
            onSaved();
          } catch (e) {
            setErr(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        },
        onExit: (e) => {
          if (e) setErr(String(e));
          setBusy(false);
        },
      });
      handler.open();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title="Connect a bank via Plaid"
      helper={
        <>
          You'll pick your bank, sign in to your bank in a Plaid-hosted window,
          and return here once connected. We only store the access token, not
          your credentials.
        </>
      }
      onClose={onClose}
    >
      {err && <ErrLine text={err} />}
      <ModalActions
        busy={busy || !ready}
        canSubmit={ready}
        onCancel={onClose}
        onSubmit={() => void start()}
      />
    </ModalShell>
  );
}

function SmartThingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  return (
    <ManualKeyModal
      title="Connect SmartThings"
      helper={
        <>
          Paste a Personal Access Token from{" "}
          <a
            href="https://account.smartthings.com/tokens"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--indigo)" }}
          >
            account.smartthings.com/tokens
          </a>
          .
        </>
      }
      placeholder="st-personal-access-token"
      onClose={onClose}
      onSubmit={async (value) => {
        const res = await fetch("/api/integrations/smartthings/manual", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ access_token: value }),
        });
        const body = (await res.json()) as { ok: boolean; error?: string };
        if (!res.ok || !body.ok) throw new Error(body.error ?? "save failed");
        onSaved();
      }}
    />
  );
}

function OneFieldModal(props: {
  title: string;
  helper: React.ReactNode;
  fieldLabel: string;
  fieldValue: string;
  fieldSet: (v: string) => void;
  fieldPlaceholder: string;
  fieldSecret: boolean;
  extra?: React.ReactNode;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <ModalShell title={props.title} helper={props.helper} onClose={props.onClose}>
      <LabeledInput
        label={props.fieldLabel}
        value={props.fieldValue}
        onChange={props.fieldSet}
        placeholder={props.fieldPlaceholder}
        secret={props.fieldSecret}
        onEnter={props.onSubmit}
      />
      {props.extra}
      {props.err && <ErrLine text={props.err} />}
      <ModalActions
        busy={props.busy}
        canSubmit={props.fieldValue.trim().length > 0}
        onCancel={props.onClose}
        onSubmit={() => void props.onSubmit()}
      />
    </ModalShell>
  );
}

function TwoFieldModal(props: {
  title: string;
  helper: React.ReactNode;
  field1Label: string;
  field1Value: string;
  field1Set: (v: string) => void;
  field1Placeholder: string;
  field1Secret: boolean;
  field2Label: string;
  field2Value: string;
  field2Set: (v: string) => void;
  field2Placeholder: string;
  field2Secret: boolean;
  extra?: React.ReactNode;
  busy: boolean;
  err: string | null;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <ModalShell title={props.title} helper={props.helper} onClose={props.onClose}>
      <LabeledInput
        label={props.field1Label}
        value={props.field1Value}
        onChange={props.field1Set}
        placeholder={props.field1Placeholder}
        secret={props.field1Secret}
      />
      <LabeledInput
        label={props.field2Label}
        value={props.field2Value}
        onChange={props.field2Set}
        placeholder={props.field2Placeholder}
        secret={props.field2Secret}
        onEnter={props.onSubmit}
      />
      {props.extra}
      {props.err && <ErrLine text={props.err} />}
      <ModalActions
        busy={props.busy}
        canSubmit={
          props.field1Value.trim().length > 0 && props.field2Value.trim().length > 0
        }
        onCancel={props.onClose}
        onSubmit={() => void props.onSubmit()}
      />
    </ModalShell>
  );
}

function ModalShell({
  title,
  helper,
  onClose,
  children,
}: {
  title: string;
  helper: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "26px 28px",
          width: 460,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            color: "var(--ink)",
            letterSpacing: "-0.2px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          {helper}
        </div>
        {children}
      </div>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  secret,
  onEnter,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret: boolean;
  onEnter?: () => void | Promise<void>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--mono)",
          fontSize: 10.5,
          color: "var(--ink-4)",
          letterSpacing: "1px",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <input
        type={secret ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onEnter) void onEnter();
        }}
        style={{
          fontFamily: "var(--mono)",
          fontSize: 13,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--rule)",
          background: "var(--surface-2)",
          color: "var(--ink)",
          outline: "none",
        }}
      />
    </div>
  );
}

function ErrLine({ text }: { text: string }) {
  return (
    <div style={{ fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--magenta)" }}>
      {text}
    </div>
  );
}

function ModalActions({
  busy,
  canSubmit,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  canSubmit: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
      <button
        onClick={onCancel}
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "var(--ink-3)",
          background: "transparent",
          padding: "8px 14px",
          borderRadius: 8,
          border: "1px solid var(--rule)",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
      <button
        onClick={onSubmit}
        disabled={busy || !canSubmit}
        style={{
          fontFamily: "var(--sans)",
          fontSize: 13,
          color: "#000",
          background: "var(--ink)",
          padding: "8px 16px",
          borderRadius: 8,
          border: "1px solid var(--ink)",
          cursor: busy ? "default" : "pointer",
          fontWeight: 500,
          opacity: busy || !canSubmit ? 0.5 : 1,
        }}
      >
        {busy ? "saving…" : "Save"}
      </button>
    </div>
  );
}

function ManualKeyModal({
  title,
  helper,
  placeholder,
  onClose,
  onSubmit,
}: {
  title: string;
  helper: React.ReactNode;
  placeholder: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(value.trim());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 14,
          padding: "26px 28px",
          width: 440,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: "var(--serif)",
            fontSize: 22,
            color: "var(--ink)",
            letterSpacing: "-0.2px",
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: "var(--sans)",
            fontSize: 13,
            color: "var(--ink-3)",
            lineHeight: 1.5,
          }}
        >
          {helper}
        </div>
        <input
          autoFocus
          type="password"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          style={{
            fontFamily: "var(--mono)",
            fontSize: 13,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid var(--rule)",
            background: "var(--surface-2)",
            color: "var(--ink)",
            outline: "none",
          }}
        />
        {err && (
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: 11.5,
              color: "var(--magenta)",
            }}
          >
            {err}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "var(--ink-3)",
              background: "transparent",
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--rule)",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy || !value.trim()}
            style={{
              fontFamily: "var(--sans)",
              fontSize: 13,
              color: "#000",
              background: "var(--ink)",
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--ink)",
              cursor: busy ? "default" : "pointer",
              fontWeight: 500,
              opacity: busy || !value.trim() ? 0.5 : 1,
            }}
          >
            {busy ? "saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
