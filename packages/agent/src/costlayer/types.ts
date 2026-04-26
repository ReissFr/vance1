// Shape of a single step recorded during a successful brain turn. We keep
// only the tool name + sanitised input + a short "expected hint" describing
// what the step should achieve, so the replayer can verify progress without
// re-baking the original reasoning.
export interface TrajectoryStep {
  tool: string;
  input: Record<string, unknown>;
  expectedHint?: string;
}

export interface Trajectory {
  version: number;
  steps: TrajectoryStep[];
}

// Lifecycle state for a learned skill.
export type SkillStatus = "unverified" | "verified" | "deprecated" | "flagged";

// A learned skill row — the DB shape trimmed to what the brain needs.
export interface LearnedSkill {
  id: string;
  fingerprint: string;
  name: string;
  intent: string;
  site: string | null;
  description: string;
  steps: Trajectory;
  variables: string[];
  status: SkillStatus;
  verifiedCount: number;
  failedCount: number;
  version: number;
  similarity?: number;
}

// Cross-user fact about a site or service.
export type LearningCategory = "ui" | "auth" | "rate_limit" | "selector" | "gotcha";

export interface SharedLearning {
  id: string;
  scope: string | null;
  fact: string;
  category: LearningCategory;
  upvotes: number;
  similarity?: number;
}

// A cached answer from a previous brain turn, reusable if still fresh and
// semantically close enough to the current question.
export type CacheCategory = "static" | "daily" | "hourly" | "minute";

export interface CachedResult {
  id: string;
  key: string;
  answer: string;
  category: CacheCategory;
  expiresAt: string;
  similarity: number;
}

// TTLs in seconds per category. Static entries still get a long TTL so a
// bad cache entry self-evicts eventually.
export const CACHE_TTL_SECONDS: Record<CacheCategory, number> = {
  static: 60 * 60 * 24 * 30, // 30 days
  daily: 60 * 60 * 12,       // 12 hours
  hourly: 60 * 30,           // 30 minutes
  minute: 60 * 2,            // 2 minutes
};
