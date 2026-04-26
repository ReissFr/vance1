# JARVIS browser node — headless Chromium with CDP exposed. Deployed to
# Fly.io (one machine per user once Step 4 lands; currently single-tenant
# shared). The JARVIS web app connects via FlyBrowserProvider over CDP.
#
# Base image is Playwright's official — ships a matching Chromium build and
# all the shared libs headful/headless needs. Leaner than rolling our own.

FROM mcr.microsoft.com/playwright:v1.49.0-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    PORT=9222 \
    PROFILE_DIR=/data/profile

# /data is the mount point for the Fly volume — Chromium's persistent user
# profile lives here so cookies/logins/localStorage survive machine restarts
# and redeploys. fly.toml declares the mount.
RUN mkdir -p "$PROFILE_DIR"
VOLUME ["/data"]

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 9222
CMD ["/usr/local/bin/entrypoint.sh"]
