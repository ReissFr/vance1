// Shared scroll-to-row behavior for entity pages that accept `?id=<uuid>` as
// a deep-link target (from /search, activity feeds, etc). Reads the id on
// mount, scrolls the matching [data-{attr}-id] element into view once the
// list has loaded, and clears the focus highlight after a short pulse.

import { useEffect, useState } from "react";

export function useDeepLinkFocus(
  dataAttr: string,
  opts: { ready: boolean; holdMs?: number } = { ready: true },
): { focusId: string | null } {
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    const urlId = new URLSearchParams(window.location.search).get("id");
    if (urlId) setFocusId(urlId);
  }, []);

  useEffect(() => {
    if (!focusId || !opts.ready) return;
    const hold = opts.holdMs ?? 2400;
    const el = document.querySelector<HTMLElement>(
      `[data-${dataAttr}-id="${focusId}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setFocusId(null), hold);
    return () => clearTimeout(t);
  }, [focusId, dataAttr, opts.ready, opts.holdMs]);

  return { focusId };
}
