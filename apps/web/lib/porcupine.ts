"use client";

import {
  PorcupineWorker,
  BuiltInKeyword,
  type PorcupineKeyword,
} from "@picovoice/porcupine-web";
import { WebVoiceProcessor } from "@picovoice/web-voice-processor";

const MODEL_PATH = "/models/porcupine_params.pv";
const CUSTOM_PPN_PATH = "/hey-vance.ppn";

export type PorcupineStatus =
  | { ok: true; keyword: string }
  | { ok: false; reason: string };

let worker: PorcupineWorker | null = null;
let starting = false;

async function customPpnAvailable(): Promise<boolean> {
  try {
    const r = await fetch(CUSTOM_PPN_PATH, { method: "HEAD" });
    return r.ok;
  } catch {
    return false;
  }
}

export async function startPorcupine(onWake: () => void): Promise<PorcupineStatus> {
  if (worker) return { ok: true, keyword: "already running" };
  if (starting) return { ok: false, reason: "starting" };
  starting = true;

  try {
    const accessKey = process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY;
    if (!accessKey) {
      return { ok: false, reason: "NEXT_PUBLIC_PICOVOICE_ACCESS_KEY not set" };
    }

    let keyword: PorcupineKeyword;
    let label: string;
    if (await customPpnAvailable()) {
      keyword = {
        label: "Hey Vance",
        publicPath: CUSTOM_PPN_PATH,
        sensitivity: 0.6,
      };
      label = "Hey Vance (custom)";
    } else {
      keyword = { builtin: BuiltInKeyword.Jarvis, sensitivity: 0.6 };
      label = "Jarvis (built-in — no hey-vance.ppn in /public, using this as stand-in)";
    }

    worker = await PorcupineWorker.create(
      accessKey,
      [keyword],
      () => onWake(),
      { publicPath: MODEL_PATH },
    );

    await WebVoiceProcessor.subscribe(worker);
    return { ok: true, keyword: label };
  } catch (e) {
    try {
      if (worker) await worker.release();
    } catch {}
    worker = null;
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    starting = false;
  }
}

export async function stopPorcupine(): Promise<void> {
  if (!worker) return;
  const w = worker;
  worker = null;
  try {
    await WebVoiceProcessor.unsubscribe(w);
  } catch {}
  try {
    await w.release();
  } catch {}
}
