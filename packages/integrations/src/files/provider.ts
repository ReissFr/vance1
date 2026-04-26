// FilesProvider — capability interface for file/drive services like Google
// Drive (and future Dropbox, OneDrive). Kept minimal: search, read, upload,
// create folder, share link.

export interface FilesProvider {
  readonly providerName: string;

  /** Search by name, mime-type, or free-text content. */
  search(input: FileSearchInput): Promise<FileEntry[]>;

  /** List direct children of a folder (root if omitted). */
  list(folderId?: string, limit?: number): Promise<FileEntry[]>;

  /** Fetch metadata + text/plain extraction if available. */
  read(fileId: string): Promise<FileContent>;

  /** Upload a new file. Content is base64-encoded bytes. */
  upload(input: UploadFileInput): Promise<FileEntry>;

  /** Create a folder. Returns the new folder entry. */
  createFolder(name: string, parentId?: string): Promise<FileEntry>;

  /** Get or create a public share link. */
  getShareLink(fileId: string): Promise<string>;
}

export type FileEntry = {
  id: string;
  name: string;
  mime_type: string;
  is_folder: boolean;
  size: number | null;
  modified_at: string | null;
  url: string | null;
  parent_id: string | null;
};

export type FileContent = {
  entry: FileEntry;
  text: string | null;
};

export type FileSearchInput = {
  query: string;
  mime_type?: string;
  limit?: number;
};

export type UploadFileInput = {
  name: string;
  mime_type: string;
  /** Base64-encoded bytes. */
  content_base64: string;
  parent_id?: string;
};
