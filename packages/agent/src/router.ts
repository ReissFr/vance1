import { MODEL_IDS, type ModelTier } from "@jarvis/types";

export interface RouterDecision {
  tier: ModelTier;
  modelId: string;
  reason: string;
}

export interface RouterInput {
  userMessage: string;
  forcedTier?: ModelTier;
  lastTurnEscalated?: boolean;
  deviceKind?: string;
}

const DEEP_THINK_PHRASES = [
  "think hard",
  "think about this properly",
  "deeply consider",
  "analyse thoroughly",
  "analyze thoroughly",
];

const COMPUTER_USE_PHRASES = [
  // navigation
  "go to",
  "go on",
  "navigate to",
  "open safari",
  "open chrome",
  "open google",
  "go to the",
  // search / lookup
  "search for",
  "look for",
  "look up",
  "find me",
  // shopping / checkout
  "add to cart",
  "go to checkout",
  "checkout",
  "buy",
  "order",
  "purchase",
  // booking
  "book a",
  "book me",
  "reserve",
  "schedule a",
  // trading / betting / markets
  "bet",
  "place",
  "trade",
  "sell",
  "long",
  "short",
  // accounts
  "sign in to",
  "log in to",
  "sign up",
  "register",
  "subscribe",
  // generic page interaction
  "click on",
  "scroll",
  "open and",
  "on the screen",
  "what's on screen",
  "what do you see",
  "select the",
  "fill in",
  "fill out",
  "type in",
  "submit",
  // money movement on any site
  "put £",
  "put $",
  "put €",
];

export function pickModel(input: RouterInput): RouterDecision {
  if (input.forcedTier) {
    return { tier: input.forcedTier, modelId: MODEL_IDS[input.forcedTier], reason: "forced by caller" };
  }

  const msg = input.userMessage.toLowerCase();

  if (DEEP_THINK_PHRASES.some((p) => msg.includes(p))) {
    return { tier: "opus", modelId: MODEL_IDS.opus, reason: "user requested deep reasoning" };
  }

  if (COMPUTER_USE_PHRASES.some((p) => msg.includes(p))) {
    return { tier: "sonnet", modelId: MODEL_IDS.sonnet, reason: "computer use task — needs vision" };
  }

  if (input.lastTurnEscalated) {
    return { tier: "sonnet", modelId: MODEL_IDS.sonnet, reason: "previous turn escalated" };
  }

  return { tier: "haiku", modelId: MODEL_IDS.haiku, reason: "default cheap/fast" };
}
