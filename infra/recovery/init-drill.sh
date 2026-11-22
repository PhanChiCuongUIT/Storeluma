#!/bin/sh
set -eu
umask 077
# Both mounts belong to a new drill. Refuse to replace any key material.
test -z "$(ls -A /client)"
test -z "$(ls -A /server)"
ssh-keygen -q -t ecdsa -b 256 -N '' -f /server/host
ssh-keygen -q -t ecdsa -b 256 -N '' -f /client/client
cp /client/client.pub /server/authorized_keys
printf 'repository %s\n' "$(cat /server/host.pub)" > /client/known_hosts
sed "/^\[global\]/a repo1-cipher-pass=$(openssl rand -hex 32)" \
    /usr/local/share/storeluma/pgbackrest.conf > /client/pgbackrest.conf
chown -R postgres:postgres /client
chmod 755 /server
chmod 644 /server/authorized_keys
