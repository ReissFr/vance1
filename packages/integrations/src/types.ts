// Shared types for the integrations framework.

export type IntegrationKind =
  | "email"
  | "payment"
  | "calendar"
  | "social"
  | "crm"
  | "storage"
  | "home"
  | "banking"
  | "crypto"
  | "commerce"
  | "accounting"
  | "productivity"
  | "dev"
  | "messaging"
  | "tasks"
  | "transactional"
  | "files";

// Shape of a row in public.integrations. `credentials` is provider-specific.
export type IntegrationRow = {
  id: string;
  user_id: string;
  kind: IntegrationKind;
  provider: string;
  credentials: Record<string, unknown>;
  scopes: string[] | null;
  active: boolean;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};
