import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', viewport: { width: 460, height: 780 }, colorScheme: 'light',
    launchOptions: { chromiumSandbox: true, executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined) } },
  webServer: { command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory .', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
  projects: [
    { name: 'chromium', testMatch: '**/components.spec.js' },
    { name: 'electron', testMatch: '**/electron.spec.js' },
  ],
});
