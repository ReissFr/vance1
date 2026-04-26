export type DeviceKind = "web" | "mac" | "ios" | "android";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export type MemoryKind = "fact" | "preference" | "person" | "event" | "task";

export interface Memory {
  id: string;
  user_id: string;
  kind: MemoryKind;
  content: string;
  source_message_id: string | null;
  created_at: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

export type ModelTier = "haiku" | "sonnet" | "opus";

export const MODEL_IDS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-6",
} as const satisfies Record<ModelTier, string>;
