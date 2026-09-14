import { createReadStream, createWriteStream } from "fs";
import { mkdir, rm, stat } from "fs/promises";
import { once } from "events";
import path from "path";
import type { Readable } from "stream";
import { env } from "./env";

/**
 * Where attachment bytes live. Local disk is the default (mount a persistent
 * volume in production); the interface is deliberately small so an S3-style
 * implementation can replace it without touching controllers.
 */
export interface ObjectStorage {
  /** Streams `source` to `key`. `inspect` sees each chunk first and may throw to abort (the partial object is removed). */
  put(key: string, source: AsyncIterable<Buffer>, inspect: (chunk: Buffer) => void): Promise<number>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

const KEY_RE = /^[a-z0-9-]{36}$/;

class LocalDiskStorage implements ObjectStorage {
  constructor(private root: string) {}

  private pathFor(key: string) {
    // Keys are server-generated UUIDs; refuse anything else so a key can never escape the root.
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    return path.join(this.root, key.slice(0, 2), key);
  }

  async put(key: string, source: AsyncIterable<Buffer>, inspect: (chunk: Buffer) => void) {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    const out = createWriteStream(file, { flags: "wx", mode: 0o640 });
    let size = 0;
    try {
      for await (const chunk of source) {
        inspect(chunk);
        size += chunk.length;
        if (!out.write(chunk)) await once(out, "drain");
      }
      out.end();
      await once(out, "finish");
      return size;
    } catch (err) {
      out.destroy();
      await rm(file, { force: true });
      throw err;
    }
  }

  async get(key: string) {
    const file = this.pathFor(key);
    await stat(file); // throws ENOENT before headers are sent
    return createReadStream(file);
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}

let instance: ObjectStorage | null = null;

export function storage(): ObjectStorage {
  if (!instance) instance = new LocalDiskStorage(path.resolve(env().UPLOAD_DIR));
  return instance;
}

/** Best-effort bulk delete; a missing file must never block deleting the database rows. */
export async function deleteObjects(keys: string[]) {
  await Promise.all(
    keys.map((key) =>
      storage()
        .delete(key)
        .catch((err) => console.error(`[storage] failed to delete ${key}`, err))
    )
  );
}
