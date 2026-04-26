// ProductivityProvider — capability interface for knowledge/task tools like
// Notion. Keep the surface small and provider-agnostic: search, read, write,
// append. Provider-specific features (databases, blocks, properties) are
// flattened into these four.

export interface ProductivityProvider {
  readonly providerName: string;

  /** Full-text search across the user's workspace. */
  search(query: string, limit?: number): Promise<ProductivitySearchResult[]>;

  /** Read a page's title + plaintext body. */
  readPage(pageId: string): Promise<ProductivityPage>;

  /** Create a new page with plaintext body. Optionally under a parent page. */
  createPage(input: CreatePageInput): Promise<ProductivityPage>;

  /** Append plaintext paragraphs to an existing page. */
  appendToPage(pageId: string, text: string): Promise<void>;

  /** List the user's databases (so the brain can pick one to add rows to). */
  listDatabases(limit?: number): Promise<ProductivityDatabase[]>;

  /** Add a row to a database. Properties are flattened plaintext map. */
  addDatabaseRow(input: AddDatabaseRowInput): Promise<ProductivityPage>;
}

export type ProductivitySearchResult = {
  id: string;
  type: "page" | "database";
  title: string;
  url: string;
  last_edited: string | null;
};

export type ProductivityPage = {
  id: string;
  title: string;
  url: string;
  body: string;
  last_edited: string | null;
};

export type ProductivityDatabase = {
  id: string;
  title: string;
  url: string;
  /** Shape-only property names so the brain knows what it can set. */
  property_names: string[];
};

export type CreatePageInput = {
  title: string;
  body: string;
  /** Optional parent page id. If omitted, created under the workspace root. */
  parent_page_id?: string;
};

export type AddDatabaseRowInput = {
  database_id: string;
  /** Plain strings keyed by Notion property name. Title prop is auto-detected. */
  properties: Record<string, string>;
};
