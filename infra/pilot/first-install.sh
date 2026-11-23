#!/usr/bin/env bash
set -euo pipefail
umask 077
upload=${1:?private upload directory}
commit=${2:?release commit}
[[ $EUID == 0 && $(uname -m) == aarch64 && $commit =~ ^[0-9a-f]{40}$ ]]
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 ]]
exec 9>/run/lock/storeluma-install.lock
flock -n 9
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ca-certificates git docker.io docker-compose-v2 cron
systemctl enable --now docker cron
install -d -m 755 /opt/storeluma/bin /opt/storeluma/releases
node=/opt/storeluma/bin/node
if [[ ! -x $node ]] || ! "$node" -e 'process.exit(Number(process.versions.node.split(".")[0])===24?0:1)'; then
  node_tmp=$(mktemp /opt/storeluma/bin/.node.XXXXXXXX)
  docker run --rm --entrypoint cat node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 /usr/local/bin/node > "$node_tmp"
  chmod 755 "$node_tmp"
  "$node_tmp" --version
  mv -f "$node_tmp" "$node"
fi
checkout=/opt/storeluma/releases/$commit
if [[ ! -d $checkout/.git ]]; then
  stage=$(mktemp -d /opt/storeluma/releases/.checkout.XXXXXXXX)
  git -C "$stage" init --quiet
  git -C "$stage" fetch --quiet --depth 1 https://github.com/PhanChiCuongUIT/Storeluma.git "$commit"
  (umask 022; git -C "$stage" checkout --quiet --detach FETCH_HEAD)
  mv -T "$stage" "$checkout"
fi
cd "$checkout"
[[ $(git rev-parse HEAD) == "$commit" ]]
config=/etc/storeluma
if [[ ! -d $config ]]; then "$node" infra/pilot/prepare.mjs "$upload/input.env" "$config"; fi
# Check DNS and retained configuration before touching running services on a retry.
"$node" --input-type=module - "$upload/input.env" "$config/.env" <<'JS'
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {resolve4} from 'node:dns/promises';
const [user, saved] = process.argv.slice(2).map(p=>parseEnv(readFileSync(p,'utf8')));
for(const [host,expected] of [[saved.APP_HOST,'shop.'+user.DOMAIN],[saved.IDENTITY_HOST,'id.'+user.DOMAIN]]) {
  if(host!==expected || !(await resolve4(host)).includes(user.SERVER_IP)) throw Error('Check DNS and saved domain for '+expected);
}
JS
pg_image=$("$node" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).images.postgres)' "$upload/release.json")
"$node" infra/pilot/deploy.mjs validate "$upload/release.json" "$config"
if "$node" -e 'const e=require("node:util").parseEnv(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(e.REGISTRY_USER&&e.REGISTRY_READ_TOKEN?0:1)' "$upload/input.env"; then
  ghuser=$("$node" -e 'console.log(require("node:util").parseEnv(require("fs").readFileSync(process.argv[1],"utf8")).REGISTRY_USER)' "$upload/input.env")
  "$node" -e 'process.stdout.write(require("node:util").parseEnv(require("fs").readFileSync(process.argv[1],"utf8")).REGISTRY_READ_TOKEN)' "$upload/input.env" | docker login ghcr.io -u "$ghuser" --password-stdin
fi
docker pull "$pg_image"
pg_uid=$(docker run --rm --entrypoint id "$pg_image" -u postgres)
chown "$pg_uid" "$config/pgbackrest" "$config/pgbackrest/pgbackrest.conf"
"$node" infra/pilot/deploy.mjs deploy "$upload/release.json" "$config"
install -m 600 "$upload/release.json" "$config/release.json.new"
mv -f "$config/release.json.new" "$config/release.json"
ln -sfn "$checkout" /opt/storeluma/current
cat > /etc/cron.d/storeluma-backup <<'CRON'
15 2 * * 0 root cd /opt/storeluma/current && /opt/storeluma/bin/node infra/pilot/deploy.mjs backup-full /etc/storeluma/release.json /etc/storeluma
15 2 * * 1-6 root cd /opt/storeluma/current && /opt/storeluma/bin/node infra/pilot/deploy.mjs backup-diff /etc/storeluma/release.json /etc/storeluma
*/10 * * * * root cd /opt/storeluma/current && /opt/storeluma/bin/node infra/pilot/deploy.mjs check-archive /etc/storeluma/release.json /etc/storeluma
CRON
chmod 644 /etc/cron.d/storeluma-backup
printf '%s\n' 'Pilot is ready. Read /etc/storeluma/owner-login.json privately for the first sign-in.'
