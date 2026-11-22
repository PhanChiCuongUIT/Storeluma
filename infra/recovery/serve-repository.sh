#!/bin/sh
set -eu
mkdir -p /run/sshd /vault/repository
chown backup:backup /vault/repository
chmod 700 /vault/repository
# Unlock the disposable Unix account; the daemon accepts only the fixture's public key.
printf 'backup:%s\n' "$(openssl rand -hex 32)" | chpasswd
exec /usr/sbin/sshd -D -e -f /dev/null -h /server/host \
    -o AllowUsers=backup -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no \
    -o AuthorizedKeysFile=/server/authorized_keys -o ChrootDirectory=/vault \
    -o 'ForceCommand=internal-sftp -d /repository' -o 'Subsystem=sftp internal-sftp' \
    -o DisableForwarding=yes -o PermitTTY=no
