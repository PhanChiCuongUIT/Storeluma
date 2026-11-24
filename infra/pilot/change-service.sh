#!/usr/bin/env bash
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: change-service.sh roll-service|rollback-service|rotate-service RELEASE.json SERVICE' >&2; exit 2; }
case "$1" in roll-service|rollback-service|rotate-service) ;; *) exit 2 ;; esac
# Share the installer lock. A full deployment and a component change cannot overlap.
exec flock -n /run/lock/storeluma-install.lock /opt/storeluma/bin/node infra/pilot/deploy.mjs "$1" "$2" /etc/storeluma "$3"
