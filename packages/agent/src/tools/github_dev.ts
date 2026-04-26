// Brain-level GitHub tools via the DevProvider resolver. Named
// `github_dev` (not just `github`) because the existing `info.ts` already
// exports a `github_notifications` tool that hits a different endpoint.

import { z } from "zod";
import { getDevProvider } from "@jarvis/integrations";
import { defineTool } from "./types";

const PROVIDERS = ["github"] as const;

export const devListReposTool = defineTool({
  name: "github_list_repos",
  description:
    "List the user's GitHub repos sorted by most recently updated. Use this to discover repos before drilling into issues/PRs.",
  schema: z.object({
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max, 1–100. Default 30." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      repos: await dev.listRepos(input.limit ?? 30),
    };
  },
});

export const devListIssuesTool = defineTool({
  name: "github_list_issues",
  description:
    "List issues on a repo. Default is open issues sorted by most-recently-updated. Use `state: 'closed'` or `'all'` to change. Pass `labels` to filter.",
  schema: z.object({
    repo: z.string().min(1).describe("owner/name, e.g. 'reissmh/jarvis'"),
    state: z.enum(["open", "closed", "all"]).optional(),
    labels: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "owner/name" },
      state: { type: "string", enum: ["open", "closed", "all"] },
      labels: { type: "array", items: { type: "string" } },
      limit: { type: "number", description: "Max, 1–100. Default 30." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["repo"],
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      issues: await dev.listIssues({
        repo: input.repo,
        state: input.state,
        labels: input.labels,
        limit: input.limit,
      }),
    };
  },
});

export const devListPullRequestsTool = defineTool({
  name: "github_list_prs",
  description:
    "List pull requests on a repo. Use this for 'what PRs need my review', 'any open PRs', etc.",
  schema: z.object({
    repo: z.string().min(1),
    state: z.enum(["open", "closed", "all"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "owner/name" },
      state: { type: "string", enum: ["open", "closed", "all"] },
      limit: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["repo"],
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      pull_requests: await dev.listPullRequests({
        repo: input.repo,
        state: input.state,
        limit: input.limit,
      }),
    };
  },
});

export const devGetIssueTool = defineTool({
  name: "github_get_issue",
  description:
    "Read a single issue's full body by (repo, issue number). Use this before commenting so you understand the issue.",
  schema: z.object({
    repo: z.string().min(1),
    number: z.number().int().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string", description: "owner/name" },
      number: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["repo", "number"],
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      issue: await dev.getIssue(input.repo, input.number),
    };
  },
});

export const devCreateIssueTool = defineTool({
  name: "github_create_issue",
  description:
    "Create a new issue on a repo. Use for 'file a bug', 'open an issue titled X', etc. Labels and assignees are optional.",
  schema: z.object({
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      labels: { type: "array", items: { type: "string" } },
      assignees: { type: "array", items: { type: "string" }, description: "GitHub logins." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["repo", "title"],
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      issue: await dev.createIssue({
        repo: input.repo,
        title: input.title,
        body: input.body,
        labels: input.labels,
        assignees: input.assignees,
      }),
    };
  },
});

export const devCommentTool = defineTool({
  name: "github_comment",
  description:
    "Post a comment on an issue or PR (same endpoint for both). Returns the comment url.",
  schema: z.object({
    repo: z.string().min(1),
    number: z.number().int().min(1),
    body: z.string().min(1),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      repo: { type: "string" },
      number: { type: "number" },
      body: { type: "string" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["repo", "number", "body"],
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      comment: await dev.comment({
        repo: input.repo,
        number: input.number,
        body: input.body,
      }),
    };
  },
});

export const devNotificationsTool = defineTool({
  name: "github_inbox",
  description:
    "List the user's unread GitHub notifications (mentions, review requests, assignments, new releases). Use for 'what do I need to look at on GitHub'.",
  schema: z.object({
    limit: z.number().int().min(1).max(50).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      limit: { type: "number", description: "Max, 1–50. Default 30." },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      notifications: await dev.listNotifications(input.limit ?? 30),
    };
  },
});

export const devSearchCodeTool = defineTool({
  name: "github_search_code",
  description:
    "Search code content across the user's GitHub. Great for 'where do we define X', 'find the TODO about Y'. Scope to a specific repo with `repo: 'owner/name'`.",
  schema: z.object({
    query: z.string().min(1),
    repo: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    provider: z.enum(PROVIDERS).optional(),
  }),
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      repo: { type: "string", description: "Optional owner/name to scope the search." },
      limit: { type: "number" },
      provider: { type: "string", enum: [...PROVIDERS] },
    },
    required: ["query"],
  },
  async run(input, ctx) {
    const dev = await getDevProvider(ctx.supabase, ctx.userId, input.provider);
    return {
      provider: dev.providerName,
      hits: await dev.searchCode({
        query: input.query,
        repo: input.repo,
        limit: input.limit,
      }),
    };
  },
});
