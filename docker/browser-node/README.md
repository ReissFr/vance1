# JARVIS browser node

Headless Chromium in a box. The JARVIS web app connects over CDP via the
`FlyBrowserProvider` in `apps/web/lib/browser-providers/fly.ts`.

## Deploy (single-tenant scaffold)

```bash
cd docker/browser-node
fly launch --no-deploy --name jarvis-browser --copy-config --region lhr
fly volumes create jarvis_browser_data --region lhr --size 1
fly deploy
```

## Point JARVIS at it

In `apps/web/.env.local`:

```
JARVIS_BROWSER=fly
JARVIS_FLY_CDP_URL=wss://jarvis-browser.fly.dev:443
```

## Notes

- CDP is unauthenticated. For a single-tenant scaffold this is fine if the
  Fly app is private (`fly ips private`); for multi-tenant SaaS (Step 4)
  each user gets their own machine and we add a reverse-proxy / token layer.
- The `click`, `type`, `scroll` etc. actions are not yet ported into
  `FlyBrowserProvider` — see `fly.ts` — only `open/screenshot/read/status/
  wait/back/forward/close`. Good enough for cookie-priming + sanity checks;
  finish porting before sending real browsing workloads through Fly.
