// embed-bridge.js — the studio's line to the Lerret MCP server, through the
// chat host (`app.callServerTool`). Every call stays under the host's
// tool-result cap (~150K chars in Claude): files come in pages, and large
// writes go out in chunks.

/** Max characters of file content per write call. */
export const WRITE_CHUNK = 90_000;

const b64encode = (bytes) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * @param {{ callServerTool: (p: { name: string, arguments: object }) => Promise<any> }} app
 * @param {() => Promise<string | undefined>} [getFolder]  The project this studio
 *   shows (from its lerret_open result); sent on every call so the studio
 *   stays on its own project when another chat opens a different one.
 */
export function createEmbedBridge(app, getFolder = async () => undefined) {
  async function call(name, args = {}) {
    const folder = await getFolder();
    const res = await app.callServerTool({ name, arguments: folder ? { ...args, folder } : args });
    if (res?.isError) {
      const msg = res.content?.find((c) => c.type === 'text')?.text || `${name} failed`;
      throw new Error(msg);
    }
    return res?.structuredContent ?? {};
  }

  return {
    call,

    /** The project's change signature (cheap; polled while visible). */
    async version() {
      return (await call('lerret_version')).version;
    },

    /**
     * Every project file, as `{ path: string | Uint8Array }`, read in pages.
     * Text files arrive as text; binaries as base64, possibly split in parts.
     */
    async loadFiles() {
      const files = {};
      const parts = {}; // binary path → base64 slices
      const texts = {}; // text path → slices
      let cursor = 0;
      let version = null;
      let name = null;
      do {
        const page = await call('lerret_files', { cursor });
        version ??= page.version;
        name ??= page.name;
        for (const f of page.files) {
          if (f.text != null) (texts[f.path] ??= []).push(f.text);
          else (parts[f.path] ??= []).push(f.base64);
        }
        cursor = page.next;
      } while (cursor != null);
      for (const [path, chunks] of Object.entries(texts)) files[path] = chunks.join('');
      for (const [path, chunks] of Object.entries(parts)) files[path] = b64decode(chunks.join(''));
      return { files, version, name };
    },

    /** Write a text or binary file, chunked under the cap. */
    async writeFile(path, data) {
      const binary = ArrayBuffer.isView(data);
      const content = binary ? b64encode(data) : String(data);
      const encoding = binary ? 'base64' : 'utf8';
      // ponytail: base64 chunks must split on 4-char boundaries; WRITE_CHUNK is a multiple of 4.
      for (let i = 0; i === 0 || i < content.length; i += WRITE_CHUNK) {
        await call('lerret_write', { path, content: content.slice(i, i + WRITE_CHUNK), encoding, append: i > 0 });
      }
    },

    deleteFile: (path) => call('lerret_delete', { path }),
    mkdir: (path) => call('lerret_mkdir', { path }),
    removeDir: (path) => call('lerret_delete', { path, dir: true }),
  };
}

/**
 * Wrap the in-memory project so every write also reaches the real files on
 * the server. Reads stay local (fast); the memory copy is refreshed from the
 * server when its version changes.
 *
 * @param {object} memory  A createMemoryBackend() instance.
 * @param {ReturnType<typeof createEmbedBridge>} bridge
 * @param {(path: string, data: string | Uint8Array | null) => void} [onLocalWrite]
 *   Mirrors our own writes (null = deleted) so the app's file map stays current.
 */
export function createSyncedBackend(memory, bridge, onLocalWrite = () => {}) {
  return {
    ...memory,
    async writeFile(path, data, options) {
      await memory.writeFile(path, data, options);
      onLocalWrite(path, data);
      await bridge.writeFile(path, data);
    },
    async deleteFile(path) {
      await memory.deleteFile(path);
      onLocalWrite(path, null);
      await bridge.deleteFile(path);
    },
    async mkdir(path) {
      await memory.mkdir(path);
      await bridge.mkdir(path);
    },
    async removeDir(path) {
      await memory.removeDir(path);
      await bridge.removeDir(path);
    },
  };
}
