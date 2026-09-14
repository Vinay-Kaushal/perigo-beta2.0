/**
 * Upload allowlist. The type is decided on the server from the file extension
 * and then checked against the file's leading bytes — the browser-supplied MIME
 * type is never trusted, so "evil.html renamed to cat.png" is rejected.
 *
 * Deliberately excluded: SVG and HTML (can carry script), executables, archives
 * other than Office documents and zip.
 */
export interface FileType {
  contentType: string;
  /** Raster images are safe to render inline; everything else downloads. */
  inline: boolean;
  /** Returns true when the leading bytes are consistent with the type. */
  matches: (head: Buffer) => boolean;
}

const startsWith = (sig: number[], offset = 0) => (head: Buffer) =>
  head.length >= offset + sig.length && sig.every((byte, i) => head[offset + i] === byte);

const ZIP = startsWith([0x50, 0x4b, 0x03, 0x04]);
const EMPTY_ZIP = startsWith([0x50, 0x4b, 0x05, 0x06]);

/** Text files must not contain NUL bytes — a cheap, reliable "this is actually binary" check. */
const isText = (head: Buffer) => !head.includes(0x00);

const TYPES: Record<string, FileType> = {
  png: { contentType: "image/png", inline: true, matches: startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { contentType: "image/jpeg", inline: true, matches: startsWith([0xff, 0xd8, 0xff]) },
  jpeg: { contentType: "image/jpeg", inline: true, matches: startsWith([0xff, 0xd8, 0xff]) },
  gif: { contentType: "image/gif", inline: true, matches: startsWith([0x47, 0x49, 0x46, 0x38]) },
  webp: {
    contentType: "image/webp",
    inline: true,
    matches: (h) => startsWith([0x52, 0x49, 0x46, 0x46])(h) && startsWith([0x57, 0x45, 0x42, 0x50], 8)(h),
  },
  pdf: { contentType: "application/pdf", inline: false, matches: startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]) },
  txt: { contentType: "text/plain; charset=utf-8", inline: false, matches: isText },
  log: { contentType: "text/plain; charset=utf-8", inline: false, matches: isText },
  md: { contentType: "text/markdown; charset=utf-8", inline: false, matches: isText },
  csv: { contentType: "text/csv; charset=utf-8", inline: false, matches: isText },
  json: { contentType: "application/json", inline: false, matches: isText },
  zip: { contentType: "application/zip", inline: false, matches: (h) => ZIP(h) || EMPTY_ZIP(h) },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false, matches: ZIP },
  xlsx: { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false, matches: ZIP },
  pptx: { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false, matches: ZIP },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

export function extensionOf(fileName: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(fileName);
  return match ? match[1]!.toLowerCase() : "";
}

export function fileTypeFor(fileName: string): FileType | null {
  return TYPES[extensionOf(fileName)] ?? null;
}

/**
 * Makes a user-supplied name safe to store and echo back: no directories,
 * control characters or quotes; bounded length; extension preserved.
 */
export function sanitizeFileName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  let name = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "").replace(/\s+/g, " ").trim();
  name = name.replace(/^\.+/, "");
  if (name.length > 180) {
    const ext = extensionOf(name);
    name = `${name.slice(0, 170 - ext.length).trim()}${ext ? `.${ext}` : ""}`;
  }
  return name || "file";
}

/** RFC 6266 Content-Disposition with an ASCII fallback and a UTF-8 filename*. */
export function contentDisposition(kind: "inline" | "attachment", fileName: string) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
