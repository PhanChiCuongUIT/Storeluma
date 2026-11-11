import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// IDs belong to one database environment. Do not share them between Compose projects.
export function fixtureFile(name: string) {
  if (!/^week\d{2}-fixture\.json$/.test(name)) throw new Error('Invalid fixture name');
  const project = process.env.COMPOSE_PROJECT_NAME ?? 'storeluma';
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Invalid Compose project name');
  const root = resolve(process.env.TEST_FIXTURE_DIR ?? `tmp/fixtures/${project}`);
  mkdirSync(root, { recursive: true });
  return resolve(root, name);
}
