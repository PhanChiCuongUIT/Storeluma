import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'https.spec.ts', workers: 1, retries: 0,
  timeout: 150_000, reporter: 'list', outputDir: '../../tmp/https-staging/test-results',
});
