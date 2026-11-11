import { lstatSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

export function removeMigrationWorkspace(workspace: string) {
  const root = realpathSync(resolve('tmp'));
  const target = realpathSync(workspace);
  if (lstatSync(workspace).isSymbolicLink() || dirname(target) !== root ||
      !/^migration-[A-Za-z0-9]+$/.test(basename(target))) {
    throw new Error('Refusing to remove a path outside the migration test workspace.');
  }
  rmSync(target, { recursive: true, force: true });
}
