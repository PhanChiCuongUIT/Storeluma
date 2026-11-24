import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function verifyManifest(file,gh='/opt/storeluma/bin/gh') {
  const {commit}=JSON.parse(readFileSync(file,'utf8'));
  assert.match(commit,/^[a-f0-9]{40}$/);
  const repo='PhanChiCuongUIT/Storeluma';
  execFileSync(gh,['attestation','verify',file,'--bundle',file+'.sigstore.json','--repo',repo,
    '--signer-workflow',repo+'/.github/workflows/verify.yml','--source-ref','refs/heads/main',
    '--source-digest',commit,'--deny-self-hosted-runners'],{stdio:'inherit'});
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  verifyManifest(process.argv[2],process.argv[3]);
