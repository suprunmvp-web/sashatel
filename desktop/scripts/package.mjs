import { packager } from '@electron/packager';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
// Copy the canonical Core into the package only. Never fork its implementation.
const outputs = await packager({
  dir: '.', name: 'SashaTel', out: 'dist', overwrite: true, prune: true,
  appBundleId: 'com.sashatel.desktop',
  extendInfo: { NSMicrophoneUsageDescription: 'SashaTel использует микрофон для проверки аудио и исходящих звонков.' },
  osxSign: false,
  ignore: [/^\/(tests?|artifacts|test-results|playwright-report|scripts|node_modules|dist|build|docs|runtime)($|\/)/, /playwright|eslint|tsconfig/],
  afterCopy: [async ({ buildPath }) => {
    await mkdir(path.join(buildPath, 'runtime'), { recursive: true });
    await cp('../packages/call-lifecycle/src', path.join(buildPath, 'runtime/core'), { recursive: true });
  }],
});

console.log(`Packaged: ${outputs.join(", ")}`);
