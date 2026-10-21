import { readFileSync } from 'node:fs';

// Services run from the workspace/image root, like the migration runner.
export const appVersion: string = JSON.parse(readFileSync('package.json', 'utf8')).version;
