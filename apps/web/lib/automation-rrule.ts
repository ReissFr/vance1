// Minimal RRULE evaluator. Supports the cases the brain produces in practice
// and nothing more — full RFC 5545 is overkill for now.
//
// Supported:
//   FREQ=HOURLY[;BYMINUTE=M]
//   FREQ=DAILY;BYHOUR=H[;BYMINUTE=M]
//   FREQ=WEEKLY;BYDAY=MO,TU,...;BYHOUR=H[;BYMINUTE=M]
//
// Times are interpreted in tz (default Europe/London). Returns the next UTC
// firing strictly after `from`.

const DAY_MAP: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

type RruleParts = {
  freq?: "HOURLY" | "DAILY" | "WEEKLY";
  byhour: number[];
  byminute: number[];
  byday: number[]; // 0..6 (Sun..Sat)
};

function parseRrule(rrule: string): RruleParts {
  const parts: RruleParts = { byhour: [], byminute: [], byday: [] };
  for (const seg of rrule.split(";")) {
    const [k, v] = seg.split("=");
    if (!k || !v) continue;
    switch (k.toUpperCase()) {
      case "FREQ":
        parts.freq = v.toUpperCase() as RruleParts["freq"];
        break;
      case "BYHOUR":
        parts.byhour = v.split(",").map((n) => Number(n)).filter((n) => Number.isFinite(n));
        break;
      case "BYMINUTE":
        parts.byminute = v.split(",").map((n) => Number(n)).filter((n) => Number.isFinite(n));
        break;
      case "BYDAY": {
        for (const d of v.split(",")) {
          const code = d.toUpperCase().slice(-2);
          if (code in DAY_MAP) parts.byday.push(DAY_MAP[code] as number);
        }
        break;
      }
    }
  }
  return parts;
}

// Returns local-time components for a given UTC instant in `tz`.
function localParts(d: Date, tz: string): { y: number; mo: number; da: number; h: number; mi: number; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    da: Number(parts.day),
    h: Number(parts.hour === "24" ? "0" : parts.hour),
    mi: Number(parts.minute),
    dow: dowMap[parts.weekday as string] ?? 0,
  };
}

// Convert local Y-M-D-H-M (in tz) → UTC Date. Iterative because Intl can't go
// the other direction in one step. 2 iterations is enough to handle DST.
function localToUtc(y: number, mo: number, da: number, h: number, mi: number, tz: string): Date {
  let guess = Date.UTC(y, mo - 1, da, h, mi);
  for (let i = 0; i < 2; i++) {
    const lp = localParts(new Date(guess), tz);
    const target = Date.UTC(y, mo - 1, da, h, mi);
    const actual = Date.UTC(lp.y, lp.mo - 1, lp.da, lp.h, lp.mi);
    guess += target - actual;
  }
  return new Date(guess);
}

export function nextFireAfter(rrule: string, from: Date, tz = "Europe/London"): Date | null {
  const r = parseRrule(rrule);
  if (!r.freq) return null;

  const hours = r.byhour.length ? r.byhour : [0];
  const minutes = r.byminute.length ? r.byminute : [0];

  // Walk forward day-by-day (or hour-by-hour for HOURLY) up to ~370 iterations.
  if (r.freq === "HOURLY") {
    for (let offsetH = 0; offsetH < 24 * 32; offsetH++) {
      const candidate = new Date(from.getTime() + offsetH * 3_600_000);
      const lp = localParts(candidate, tz);
      for (const mi of minutes) {
        const fire = localToUtc(lp.y, lp.mo, lp.da, lp.h, mi, tz);
        if (fire.getTime() > from.getTime()) return fire;
      }
    }
    return null;
  }

  for (let offsetD = 0; offsetD < 370; offsetD++) {
    const candidate = new Date(from.getTime() + offsetD * 86_400_000);
    const lp = localParts(candidate, tz);

    if (r.freq === "WEEKLY" && r.byday.length && !r.byday.includes(lp.dow)) continue;

    for (const h of hours) {
      for (const mi of minutes) {
        const fire = localToUtc(lp.y, lp.mo, lp.da, h, mi, tz);
        if (fire.getTime() > from.getTime()) return fire;
      }
    }
  }
  return null;
}
