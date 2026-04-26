"use client";

import * as faceapi from "@vladmandic/face-api";

const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/";
const STORAGE_KEY = "jarvis:face:descriptor";
const ENABLED_KEY = "jarvis:face:enabled";
const MATCH_THRESHOLD = 0.5;

let loadingPromise: Promise<void> | null = null;

export async function loadModels(): Promise<void> {
  if (loadingPromise) return loadingPromise;
  loadingPromise = Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
    faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
    faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
  ]).then(() => undefined);
  return loadingPromise;
}

function readStoredDescriptor(): Float32Array | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw) as number[];
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return new Float32Array(arr);
  } catch {
    return null;
  }
}

export function hasEnrollment(): boolean {
  return readStoredDescriptor() !== null;
}

export function clearEnrollment(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isFaceGateEnabled(): boolean {
  return localStorage.getItem(ENABLED_KEY) === "1";
}

export function setFaceGateEnabled(v: boolean): void {
  localStorage.setItem(ENABLED_KEY, v ? "1" : "0");
}

async function detectOnce(video: HTMLVideoElement) {
  return faceapi
    .detectSingleFace(
      video,
      new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }),
    )
    .withFaceLandmarks()
    .withFaceDescriptor();
}

export async function enrollFromVideo(
  video: HTMLVideoElement,
  samples = 5,
  timeoutMs = 15000,
): Promise<boolean> {
  await loadModels();
  const descriptors: Float32Array[] = [];
  const start = Date.now();
  while (descriptors.length < samples && Date.now() - start < timeoutMs) {
    const r = await detectOnce(video);
    if (r?.descriptor) descriptors.push(r.descriptor);
    await new Promise((res) => setTimeout(res, 250));
  }
  if (descriptors.length < 3) return false;
  const first = descriptors[0]!;
  const len = first.length;
  const avg = new Float32Array(len);
  for (const d of descriptors) for (let i = 0; i < len; i++) avg[i] = (avg[i] ?? 0) + (d[i] ?? 0);
  for (let i = 0; i < len; i++) avg[i] = (avg[i] ?? 0) / descriptors.length;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(avg)));
  return true;
}

export interface PresenceCheck {
  sawFace: boolean;
  match: boolean;
  distance: number;
}

export async function checkPresence(video: HTMLVideoElement): Promise<PresenceCheck> {
  await loadModels();
  const enrolled = readStoredDescriptor();
  if (!enrolled) return { sawFace: false, match: false, distance: 1 };
  const r = await detectOnce(video);
  if (!r?.descriptor) return { sawFace: false, match: false, distance: 1 };
  const distance = faceapi.euclideanDistance(enrolled, r.descriptor);
  return { sawFace: true, match: distance < MATCH_THRESHOLD, distance };
}
