'use strict';

const { pathToFileURL, fileURLToPath } = require('node:url');
const path = require('node:path');

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
    allowedResource(url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'file:') return false;
        const relative = path.relative(path.dirname(entryPath), fileURLToPath(parsed));
        return ['index.html', 'style.css', 'renderer.js',
          'audio/bootstrap.mjs', 'audio/audio-device-service.mjs', 'audio/devices.mjs',
          'audio/permissions.mjs', 'audio/resources.mjs', 'audio/errors.mjs'
        ].includes(relative.split(path.sep).join('/'));
      } catch { return false; }
    },
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
