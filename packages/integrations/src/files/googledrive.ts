// GoogleDriveProvider — FilesProvider backed by Google Drive v3 via the
// googleapis SDK. Shares the same OAuth token refresh pattern as Gmail: if
// the stored access token is expired, refresh using refresh_token and
// persist the new pair back via the resolver's persist callback.

import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import type {
  FilesProvider,
  FileEntry,
  FileContent,
  FileSearchInput,
  UploadFileInput,
} from "./provider";

const SKEW_MS = 60_000;

export type GoogleDriveCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
  email?: string | null;
};

export type GoogleDrivePersistFn = (updated: {
  credentials: GoogleDriveCredentials;
  expires_at: string;
}) => Promise<void>;

export type GoogleDriveProviderOptions = {
  credentials: GoogleDriveCredentials;
  expiresAt: string | null;
  persist: GoogleDrivePersistFn;
  clientId: string;
  clientSecret: string;
};

const FOLDER_MIME = "application/vnd.google-apps.folder";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDE_MIME = "application/vnd.google-apps.presentation";

export class GoogleDriveProvider implements FilesProvider {
  readonly providerName = "google_drive";
  private accessToken: string | null;
  private refreshToken: string | null;
  private expiresAt: string | null;
  private readonly persist: GoogleDrivePersistFn;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(opts: GoogleDriveProviderOptions) {
    this.accessToken = opts.credentials.access_token ?? null;
    this.refreshToken = opts.credentials.refresh_token ?? null;
    this.expiresAt = opts.expiresAt;
    this.persist = opts.persist;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
  }

  async search(input: FileSearchInput): Promise<FileEntry[]> {
    const drive = await this.client();
    const conditions: string[] = [`trashed = false`];
    if (input.query) {
      const safe = input.query.replace(/'/g, "\\'");
      conditions.push(
        `(name contains '${safe}' or fullText contains '${safe}')`,
      );
    }
    if (input.mime_type) {
      conditions.push(`mimeType = '${input.mime_type}'`);
    }
    const res = await drive.files.list({
      q: conditions.join(" and "),
      pageSize: Math.max(1, Math.min(100, input.limit ?? 25)),
      fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, parents)",
    });
    return (res.data.files ?? []).map(toEntry);
  }

  async list(folderId?: string, limit = 50): Promise<FileEntry[]> {
    const drive = await this.client();
    const parent = folderId ?? "root";
    const res = await drive.files.list({
      q: `'${parent}' in parents and trashed = false`,
      pageSize: Math.max(1, Math.min(200, limit)),
      fields: "files(id, name, mimeType, size, modifiedTime, webViewLink, parents)",
      orderBy: "modifiedTime desc",
    });
    return (res.data.files ?? []).map(toEntry);
  }

  async read(fileId: string): Promise<FileContent> {
    const drive = await this.client();
    const meta = await drive.files.get({
      fileId,
      fields: "id, name, mimeType, size, modifiedTime, webViewLink, parents",
    });
    const entry = toEntry(meta.data);
    const text = await this.extractText(drive, fileId, entry.mime_type);
    return { entry, text };
  }

  async upload(input: UploadFileInput): Promise<FileEntry> {
    const drive = await this.client();
    const buffer = Buffer.from(input.content_base64, "base64");
    const res = await drive.files.create({
      requestBody: {
        name: input.name,
        parents: input.parent_id ? [input.parent_id] : undefined,
        mimeType: input.mime_type,
      },
      media: {
        mimeType: input.mime_type,
        body: buffer.toString("binary"),
      },
      fields: "id, name, mimeType, size, modifiedTime, webViewLink, parents",
    });
    return toEntry(res.data);
  }

  async createFolder(name: string, parentId?: string): Promise<FileEntry> {
    const drive = await this.client();
    const res = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: parentId ? [parentId] : undefined,
      },
      fields: "id, name, mimeType, size, modifiedTime, webViewLink, parents",
    });
    return toEntry(res.data);
  }

  async getShareLink(fileId: string): Promise<string> {
    const drive = await this.client();
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
    });
    const meta = await drive.files.get({
      fileId,
      fields: "webViewLink",
    });
    return meta.data.webViewLink ?? "";
  }

  private async extractText(
    drive: drive_v3.Drive,
    fileId: string,
    mime: string,
  ): Promise<string | null> {
    // Google-native docs export to plain text.
    if (mime === GOOGLE_DOC_MIME) {
      const res = await drive.files.export({ fileId, mimeType: "text/plain" });
      return String(res.data ?? "");
    }
    if (mime === GOOGLE_SHEET_MIME) {
      const res = await drive.files.export({ fileId, mimeType: "text/csv" });
      return String(res.data ?? "");
    }
    if (mime === GOOGLE_SLIDE_MIME) {
      const res = await drive.files.export({ fileId, mimeType: "text/plain" });
      return String(res.data ?? "");
    }
    // Plain-text / markdown / JSON / xml etc.
    if (mime.startsWith("text/") || mime === "application/json") {
      const res = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" },
      );
      return String(res.data ?? "");
    }
    return null;
  }

  private async client(): Promise<drive_v3.Drive> {
    await this.ensureFreshAccessToken();
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: this.accessToken });
    return google.drive({ version: "v3", auth });
  }

  private async ensureFreshAccessToken(): Promise<void> {
    const needsRefresh =
      !this.accessToken ||
      !this.expiresAt ||
      new Date(this.expiresAt).getTime() - Date.now() < SKEW_MS;
    if (!needsRefresh && this.accessToken) return;

    if (!this.refreshToken) {
      throw new Error(
        "Drive access token expired and no refresh token on file — reconnect Google account",
      );
    }

    const oauth2 = new google.auth.OAuth2(this.clientId, this.clientSecret);
    oauth2.setCredentials({ refresh_token: this.refreshToken });
    const res = await oauth2.refreshAccessToken();
    const newAccess = res.credentials.access_token;
    if (!newAccess) throw new Error("Google refresh returned no access token");
    const newExpiryMs = res.credentials.expiry_date ?? Date.now() + 3500_000;

    this.accessToken = newAccess;
    this.expiresAt = new Date(newExpiryMs).toISOString();

    await this.persist({
      credentials: {
        access_token: this.accessToken,
        refresh_token: this.refreshToken,
      },
      expires_at: this.expiresAt,
    });
  }
}

function toEntry(f: drive_v3.Schema$File): FileEntry {
  const mime = f.mimeType ?? "application/octet-stream";
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mime_type: mime,
    is_folder: mime === FOLDER_MIME,
    size: f.size ? Number(f.size) : null,
    modified_at: f.modifiedTime ?? null,
    url: f.webViewLink ?? null,
    parent_id: (f.parents ?? [])[0] ?? null,
  };
}
