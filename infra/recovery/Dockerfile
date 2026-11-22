FROM postgres:17-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73 AS database
RUN apk add --no-cache pgbackrest

FROM database AS drill-repository
RUN apk add --no-cache openssh-server openssh-client openssh-sftp-server openssl \
 && adduser -D -h /repository backup
COPY pgbackrest.conf /usr/local/share/storeluma/pgbackrest.conf
COPY init-drill.sh serve-repository.sh /usr/local/bin/
