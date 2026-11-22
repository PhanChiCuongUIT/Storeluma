import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'week11-load.spec.ts', workers: 1, retries: 0,
  timeout: 35 * 60_000, reporter: 'list', outputDir: '../tmp/week11/load-artifacts',
  use: { baseURL: 'http://localhost:4100', viewport: { width: 1440, height: 1000 } },
});
