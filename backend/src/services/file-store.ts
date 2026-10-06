import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Short-lived, unguessable links for PDFs that Twilio has to download.
 *
 * SECURITY FIX: before, PDFs were copied into a public folder as
 * "Khata_<Name>.pdf", so anyone could guess the URL and read a customer's
 * ledger. Now each file gets a random 128-bit id, is served only through a
 * route that validates that id, and is deleted after LINK_TTL_MS.
 */

export const LINK_TTL_MS = 30 * 60 * 1000; // Twilio fetches within seconds; 30 min is generous
const ID_RE = /^[a-f0-9]{32}$/;

export class FileStore {
  constructor(private readonly dir: string, private readonly ttlMs: number = LINK_TTL_MS) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Saves the buffer and returns the random id used in the URL. */
  save(buffer: Buffer): string {
    this.cleanup();
    const id = crypto.randomBytes(16).toString('hex');
    fs.writeFileSync(path.join(this.dir, `${id}.pdf`), buffer, { mode: 0o600 });
    return id;
  }

  /** Returns the file path if the id is valid, exists and has not expired. */
  resolve(id: string): string | null {
    if (!ID_RE.test(id)) return null; // also blocks path traversal like "../../.env"
    const file = path.join(this.dir, `${id}.pdf`);
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs > this.ttlMs) {
        fs.rmSync(file, { force: true });
        return null;
      }
      return file;
    } catch {
      return null;
    }
  }

  /** Deletes expired files so the disk never fills up. */
  cleanup(): number {
    let removed = 0;
    for (const name of fs.readdirSync(this.dir)) {
      const file = path.join(this.dir, name);
      try {
        if (Date.now() - fs.statSync(file).mtimeMs > this.ttlMs) {
          fs.rmSync(file, { force: true });
          removed++;
        }
      } catch {
        /* file vanished meanwhile */
      }
    }
    return removed;
  }
}

export const fileStore = new FileStore(
  process.env.PDF_STORAGE_DIR || path.join(process.cwd(), 'storage', 'pdfs')
);
