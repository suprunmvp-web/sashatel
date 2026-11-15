'use strict';

const { pathToFileURL, fileURLToPath } = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

// App-authored renderer assets only. A new asset needs no filename registration.
const rendererExtensions = new Set(['.js', '.mjs', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.avif']);
const privateSegments = new Set(['node_modules', 'test', 'tests', 'build', 'dist', 'docs', 'coverage', 'main', 'preload']);

function createResourcePolicy(entryPath) {
  const root = path.dirname(path.resolve(entryPath));
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { /* missing root fails closed */ }
  return url => {
    try {
      if (!realRoot || typeof url !== 'string' || !url.startsWith('file:///') || /[\\\u0000-\u0020\u007f]/.test(url)) return false;
      // Check BEFORE URL parsing, which normalizes literal/encoded dot segments.
      const rawPath = url.slice('file://'.length).split(/[?#]/, 1)[0];
      const decoded = decodeURIComponent(rawPath);
      if (/[\\%\u0000-\u001f\u007f]/.test(decoded) || decoded.startsWith('//') ||
        decoded.split('/').some(segment => segment === '.' || segment === '..')) return false;
      const parsed = new URL(url);
      if (parsed.protocol !== 'file:' || parsed.host || parsed.username || parsed.password) return false;
      const target = fileURLToPath(parsed); // also rejects encoded path separators
      const relative = path.relative(root, target);
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) return false;
      const parts = relative.split(path.sep);
      if (parts.some(part => !part || part.startsWith('.') || privateSegments.has(part.toLowerCase()))) return false;
      const basename = parts.at(-1);
      if (/^(main|preload|security)(\.|$)/i.test(basename) || /\.(test|spec)\./i.test(basename)) return false;
      if (target !== path.resolve(entryPath) && !rendererExtensions.has(path.extname(basename).toLowerCase())) return false;
      // Recheck every request, including root replacement; don't cache approvals.
      if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root) !== realRoot) return false;
      let cursor = root;
      for (const [index, part] of parts.entries()) {
        cursor = path.join(cursor, part);
        const stat = fs.lstatSync(cursor);
        if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) return false;
      }
      return fs.realpathSync(target) === path.join(realRoot, relative);
    } catch { return false; } // malformed URL, EACCES, ENOENT, symlink loops, etc.
  };
}

function createPolicy(entryPath, getWindow) {
  const entryURL = pathToFileURL(entryPath).href;
  const trustedURL = url => {
    try { const parsed = new URL(url); parsed.hash = ''; return parsed.href === entryURL; }
    catch { return false; }
  };
  const trustedContents = contents => {
    const win = getWindow();
    return Boolean(win && !win.isDestroyed() && contents === win.webContents && trustedURL(contents.getURL()));
  };
  return {
    trustedURL,
    allowedResource: createResourcePolicy(entryPath),
    validIPC(event, args) {
      return args.length === 0 && trustedContents(event.sender) &&
        event.senderFrame === event.sender.mainFrame && trustedURL(event.senderFrame?.url);
    },
    permissionRequest(contents, permission, details) {
      return trustedContents(contents) && details?.isMainFrame === true &&
        trustedURL(details.requestingUrl) && permission === 'media' &&
        Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio';
    },
    permissionCheck(contents, permission, details) {
      return trustedContents(contents) && trustedURL(details?.requestingUrl) &&
        details?.isMainFrame === true && permission === 'media' && details.mediaType === 'audio';
    }
  };
}

module.exports = { createPolicy };
