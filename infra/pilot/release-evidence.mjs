import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const base='tmp/recovery', destination=join(base,'release-evidence');
mkdirSync(destination,{recursive:true});
const releaseBytes=readFileSync(join(base,'release.json'));
const release=JSON.parse(releaseBytes), result=JSON.parse(readFileSync(join(base,'latest.json')));
assert.equal(release.commit,result.revision);
assert.equal(Object.keys(release.images).length,12);
const subjects=[];
function addFile(name,bytes) {
  subjects.push(createHash('sha256').update(bytes).digest('hex')+'  '+name);
}
addFile('release.json',releaseBytes);
for(const [service,ref] of Object.entries(release.images)) {
  assert.match(service,/^[a-z]+$/);
  const image=result.images[service];
  assert.match(image,/^sha256:[a-f0-9]{64}$/);
  const filename=service+'.spdx.json',target=join(destination,filename);
  execFileSync('syft',['scan','docker:'+image,'--source-name',service,'--source-version',ref.split('@')[1],'-o','spdx-json='+target],{stdio:'inherit'});
  const bytes=readFileSync(target),sbom=JSON.parse(bytes);
  assert.ok(sbom.spdxVersion && sbom.packages?.length>0,'Missing packages for '+service);
  addFile(filename,bytes);
  const [name,digest]=ref.split('@');
  if(name.startsWith('ghcr.io/'+process.env.GITHUB_REPOSITORY.toLowerCase()+'/'))subjects.push(digest.slice(7)+'  '+name);
}
writeFileSync(join(destination,'subjects.sha256'),subjects.join('\n')+'\n');
