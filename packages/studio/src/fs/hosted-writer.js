// hosted-writer.js — the hosted-mode writer.
//
// Implements `write-client`'s write + lifecycle surface over a core
// `FilesystemAccess` backend (the FSA backend in production). The hosted boot
// registers it via `setHostedWriter()`, so the in-studio editors and entity
// lifecycle write to the user's local disk through the browser — no CLI server.
//
// Each method returns the same `{ ok, error?, ... }` shape the matching
// `write-client` helper returns, and NEVER throws (FSA exceptions become a calm
// `{ ok: false, error }`).
//
// - H2: writeFile (data/config/meta).
// - H3: FOLDER lifecycle (page/group create/rename/delete) — whole-tree copy/
//   delete, so contents travel for free.
// - H4: ASSET lifecycle (create from a starter template; rename/move/duplicate/
//   delete that sweep companion files — `<stem>.data.json`, `<stem>.config.json`,
//   component-prefixed images — mirroring the Node backend's contract).
// (Epic 10 / H2–H4.)

import { validateEntryName, assetFileName, starterAssetContent, starterAssetData } from '@lerret/core';

import { PermissionDeniedError } from './fsa-backend.js';

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp', '.avif'];

// ── path helpers (LerretPath: forward slashes) ──────────────────────────────
function joinPath(parent, name) {
  const base = String(parent).replace(/\/+$/, '');
  return base === '' ? name : `${base}/${name}`;
}
function basename(p) {
  const i = String(p).lastIndexOf('/');
  return i < 0 ? String(p) : p.slice(i + 1);
}
function parentOf(p) {
  const i = String(p).lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}
/** Filename without its final extension (`Hero.jsx` → `Hero`). */
function stemOf(fileName) {
  const i = fileName.lastIndexOf('.');
  return i <= 0 ? fileName : fileName.slice(0, i);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Turn a thrown FSA error into a calm `{ ok: false, error }`.
 * @param {unknown} err
 * @returns {{ ok: false, error: string }}
 */
export function hostedWriteFailure(err) {
  if (err instanceof PermissionDeniedError) {
    return {
      ok: false,
      error: 'Permission to write to this folder was denied — re-open the folder to continue editing.',
    };
  }
  return { ok: false, error: err && err.message ? err.message : String(err) };
}

// ── filesystem helpers over the FilesystemAccess contract ───────────────────
async function isDirectory(backend, path) {
  try {
    await backend.readDir(path);
    return true;
  } catch {
    return false;
  }
}
async function copyFile(backend, from, to) {
  const bytes = await backend.readFile(from, { encoding: 'binary' });
  await backend.writeFile(to, bytes, { encoding: 'binary' });
}
async function copyTree(backend, fromDir, toDir) {
  await backend.mkdir(toDir);
  for (const entry of await backend.readDir(fromDir)) {
    const dest = joinPath(toDir, entry.name);
    if (entry.isDirectory) await copyTree(backend, entry.path, dest);
    else await copyFile(backend, entry.path, dest);
  }
}
async function removeTree(backend, dir) {
  for (const entry of await backend.readDir(dir)) {
    if (entry.isDirectory) await removeTree(backend, entry.path);
    else await backend.deleteFile(entry.path);
  }
  await backend.removeDir(dir);
}
/** A name (with extension) in `folder` that doesn't collide, appending " 2", " 3"… */
async function uniqueName(backend, folder, stem, ext) {
  if (!(await backend.exists(joinPath(folder, `${stem}${ext}`)))) return `${stem}${ext}`;
  let n = 2;
  while (await backend.exists(joinPath(folder, `${stem} ${n}${ext}`))) n += 1;
  return `${stem} ${n}${ext}`;
}

/**
 * Companion file PATHS that travel with an asset whose basename stem is `stem`,
 * living in `folder`. Mirrors the Node backend's `discoverCompanions`:
 *   • `<stem>.data.json` / `<stem>.data.js` / `<stem>.config.json` (case-insensitive)
 *   • component-prefixed images `<stem>-*.<imageExt>` (case-insensitive prefix + ext)
 *
 * @param {import('@lerret/core').FilesystemAccess} backend
 * @param {string} folder
 * @param {string} stem
 * @returns {Promise<string[]>}
 */
async function discoverCompanions(backend, folder, stem) {
  const stemLower = stem.toLowerCase();
  const prefix = `${stemLower}-`;
  let entries;
  try {
    entries = await backend.readDir(folder);
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isFile) continue;
    const lower = e.name.toLowerCase();
    if (
      lower === `${stemLower}.data.json` ||
      lower === `${stemLower}.data.js` ||
      lower === `${stemLower}.config.json`
    ) {
      out.push(e.path);
    } else if (lower.startsWith(prefix) && IMAGE_EXTS.some((x) => lower.endsWith(x))) {
      out.push(e.path);
    }
  }
  return out;
}

/**
 * Construct the hosted writer over a `FilesystemAccess` backend.
 *
 * @param {import('@lerret/core').FilesystemAccess} backend
 * @returns {object} The write/lifecycle surface (see write-client helpers).
 */
export function createHostedWriter(backend) {
  /** Rename an asset file + its companions (stem changes). */
  async function renameAsset(fromPath, toPath) {
    const folder = parentOf(fromPath);
    const fromStem = stemOf(basename(fromPath));
    const toStem = stemOf(basename(toPath));
    if (await backend.exists(toPath)) return { ok: false, error: `"${toPath}" already exists.` };
    const companions = await discoverCompanions(backend, folder, fromStem);
    await copyFile(backend, fromPath, toPath);
    await backend.deleteFile(fromPath);
    for (const comp of companions) {
      const newName = toStem + basename(comp).slice(fromStem.length);
      await copyFile(backend, comp, joinPath(folder, newName));
      await backend.deleteFile(comp);
    }
    return { ok: true };
  }

  return {
    async writeFile(path, content, opts = {}) {
      try {
        if (opts && opts.encoding === 'base64') {
          await backend.writeFile(path, base64ToBytes(content), { encoding: 'binary' });
        } else {
          await backend.writeFile(path, content, { encoding: 'utf-8' });
        }
        return { ok: true };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async createEntry(parentPath, name, kind, opts = {}) {
      try {
        const v = validateEntryName(name, { kind: kind === 'asset' ? 'asset' : 'page' });
        if (!v.ok) return { ok: false, error: v.error };
        if (kind === 'folder') {
          const path = joinPath(parentPath, v.name);
          if (await backend.exists(path)) return { ok: false, error: `"${v.name}" already exists here.` };
          await backend.mkdir(path);
          return { ok: true, path };
        }
        // asset
        const assetKind = opts.assetKind === 'markdown' ? 'markdown' : 'component';
        const fileName = assetFileName(v.name, assetKind);
        const path = joinPath(parentPath, fileName);
        if (await backend.exists(path)) return { ok: false, error: `"${fileName}" already exists here.` };
        await backend.writeFile(path, starterAssetContent(v.name, assetKind), { encoding: 'utf-8' });
        // Component assets ship a companion `.data.json` (Tier-1 text, editable
        // without code + live on save). Markdown has none.
        if (path.endsWith('.jsx')) {
          const dataPath = `${path.slice(0, -'.jsx'.length)}.data.json`;
          await backend.writeFile(dataPath, starterAssetData(v.name), { encoding: 'utf-8' });
        }
        return { ok: true, path };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async renameEntry(fromPath, toPath) {
      try {
        if (await isDirectory(backend, fromPath)) {
          if (await backend.exists(toPath)) return { ok: false, error: `"${toPath}" already exists.` };
          await copyTree(backend, fromPath, toPath);
          await removeTree(backend, fromPath);
          return { ok: true };
        }
        return await renameAsset(fromPath, toPath);
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async deleteEntry(path) {
      try {
        if (!(await backend.exists(path))) return { ok: true };
        if (await isDirectory(backend, path)) {
          await removeTree(backend, path);
          return { ok: true };
        }
        // asset file + companions
        const folder = parentOf(path);
        const stem = stemOf(basename(path));
        const companions = await discoverCompanions(backend, folder, stem);
        await backend.deleteFile(path);
        for (const comp of companions) await backend.deleteFile(comp);
        return { ok: true };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async moveEntry(fromPath, toFolderPath) {
      try {
        const name = basename(fromPath);
        const newPath = joinPath(toFolderPath, name);
        if (await backend.exists(newPath)) {
          return { ok: false, error: `"${name}" already exists in the destination.` };
        }
        if (await isDirectory(backend, fromPath)) {
          await copyTree(backend, fromPath, newPath);
          await removeTree(backend, fromPath);
          return { ok: true, newPath };
        }
        const folder = parentOf(fromPath);
        const stem = stemOf(name);
        const companions = await discoverCompanions(backend, folder, stem);
        await copyFile(backend, fromPath, newPath);
        await backend.deleteFile(fromPath);
        for (const comp of companions) {
          await copyFile(backend, comp, joinPath(toFolderPath, basename(comp)));
          await backend.deleteFile(comp);
        }
        return { ok: true, newPath };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async duplicateEntry(path) {
      try {
        const folder = parentOf(path);
        const name = basename(path);
        if (await isDirectory(backend, path)) {
          const dupName = await uniqueName(backend, folder, `${name} (copy)`, '');
          const dupPath = joinPath(folder, dupName);
          await copyTree(backend, path, dupPath);
          return { ok: true, path: dupPath };
        }
        const stem = stemOf(name);
        const ext = name.slice(stem.length); // includes the leading dot
        const dupFileName = await uniqueName(backend, folder, `${stem} (copy)`, ext);
        const dupStem = stemOf(dupFileName);
        const dupPath = joinPath(folder, dupFileName);
        const companions = await discoverCompanions(backend, folder, stem);
        await copyFile(backend, path, dupPath);
        for (const comp of companions) {
          const newName = dupStem + basename(comp).slice(stem.length);
          await copyFile(backend, comp, joinPath(folder, newName));
        }
        return { ok: true, path: dupPath };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async mkdir(path) {
      try {
        await backend.mkdir(path);
        return { ok: true };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },

    async removeDir(path) {
      try {
        await backend.removeDir(path);
        return { ok: true };
      } catch (err) {
        return hostedWriteFailure(err);
      }
    },
  };
}
