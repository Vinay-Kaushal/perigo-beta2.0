import { API_URL, ApiError } from "./api";

/** Mirrors the API allowlist so people get instant feedback; the API remains the source of truth. */
export const ALLOWED_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "pdf", "txt", "log", "md", "csv", "json", "zip", "docx", "xlsx", "pptx"];
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(",");

export function validateFile(file: { name: string; size: number }): string | null {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(file.name)?.[1]?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) return `${file.name}: that file type isn't allowed`;
  if (file.size === 0) return `${file.name} is empty`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB`;
  return null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Uploads a file as the raw request body (the API reads the name from X-File-Name).
 * XHR rather than fetch so we can report upload progress.
 */
export function uploadFile<T>(path: string, file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-CSRF-Protection", "1");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      let body: { error?: string; code?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* empty or non-JSON body */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new ApiError(xhr.status, body.error ?? `Upload failed (${xhr.status})`, body.code));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed — check your connection"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

export const attachmentUrl = (orgId: string, ticketRef: string | number, attachmentId: string, inline = false) =>
  `${API_URL}/organisations/${orgId}/tickets/${ticketRef}/attachments/${attachmentId}${inline ? "?inline=1" : ""}`;
