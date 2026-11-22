import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export function stagingContext(drillId) {
  if (drillId !== undefined && !/^[a-f0-9]{12}$/.test(drillId)) throw new Error('Invalid recovery drill ID');
  const project = drillId ? 'storeluma-pitr-' + drillId : 'storeluma-https-stage';
  const directory = './tmp/' + (drillId ? 'recovery/' + drillId : 'https-staging');
  const state = resolve(root, directory);
  const git = (...cmd) => execFileSync('git', cmd, { cwd: root, encoding: 'utf8' }).trim();
  const commit = git('rev-parse', 'HEAD');
  const revision = commit + (git('status', '--porcelain') ? '-dirty' : '');
  const env = { ...process.env, STAGING_REVISION: revision, STAGING_STATE_DIR: directory, COMPOSE_PROJECT_NAME: project };
  if (drillId) env.STORELUMA_DRILL_ID = drillId;
  const args = ['compose', '-p', project, '--env-file', resolve(state, '.env'), '-f', 'compose.yaml', '-f', 'infra/staging/compose.yaml'];
  if (drillId) args.push('-f', 'infra/recovery/compose.yaml');
  return { project, state, commit, revision, env, args };
}
