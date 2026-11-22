# PostgreSQL recovery

The Storeluma cluster holds the service databases and Keycloak. A physical pgBackRest backup and continuous WAL archiving preserve a common recovery point. The PostgreSQL 17 image in this directory includes pgBackRest. Its reference configuration encrypts the repository with AES-256-CBC, checks the SFTP server's host key and retains two full backups with their dependent WAL. The server receives encrypted backup files. Store the client key, cipher password, application configuration, realm settings and image manifest separately from the repository.

## Run the drill

From the repository root, install dependencies and Playwright Chromium, stop HTTPS staging if it occupies 9080/9443, then run:

```sh
node infra/recovery/drill.mjs
```

The script creates a unique Compose project and fresh keys for a synthetic store. Its SFTP server runs on a separate private network with its own volume, on the same Docker engine. On GitHub this runs on an ephemeral ARM64 VM. Neither setup measures transfer to a second physical host.

1. Take a full backup and check that WAL archiving works. Sell through HTTPS **after** the full backup, then verify the order, saga, payment, stock and reporting projection.
2. Record a database timestamp, create a named restore point, commit a later marker and wait for the containing WAL segment to reach the archive.
3. Stop application writes, the source database and the broker. Restore the selected backup into an empty data volume and start a fresh broker. Check that only the earlier marker survived.
4. On the restored database, requeue retained Outbox entries while consumers are stopped. Restart the services, drain the Outbox and verify that replay kept the original payment and stock movement unique. Sign in again, complete a second sale and reconcile both orders.

RPO in this drill is the interval between the simulated incident and the last retained marker transaction. RTO runs from the incident through service stop, restore, promotion, replay and verification of the new sale. For a real outage, record the newest recovered business transaction and include host provisioning time if a replacement is unavailable. Test on a host with the intended architecture, PostgreSQL major version, disk size and network before committing to an operational objective.

The public CI artifact contains measurements and image identifiers. Keys, captured screens and fixture accounts remain under the run's private volumes or `tmp/recovery/`. Local rehearsal volumes are retained for inspection. Never attach a restored test cluster to the source archive as a second writer.

## On a separate backup host

Provision a dedicated SFTP account with write access only to its backup directory. Restrict network access to the database host. Place a verified host key in `known_hosts`; obtain its fingerprint from the backup host through an independent channel. Mount a private configuration directory readable by the container's `postgres` user at `/etc/pgbackrest`. Copy the reference configuration there, set `repo1-sftp-host`, repository path and user, install the client key, and add a randomly generated `repo1-cipher-pass` to the global section. Keep an independent, protected copy of these recovery materials. The Compose pilot enables a 60-second PostgreSQL archive timeout.

On the pilot host, schedule the launcher from the deployment checkout with the release manifest and private config directory, for example:

```cron
15 2 * * 0 cd /opt/storeluma && /usr/bin/node infra/pilot/deploy.mjs backup-full /etc/storeluma/release.json /etc/storeluma
15 2 * * 1-6 cd /opt/storeluma && /usr/bin/node infra/pilot/deploy.mjs backup-diff /etc/storeluma/release.json /etc/storeluma
*/10 * * * * cd /opt/storeluma && /usr/bin/node infra/pilot/deploy.mjs check-archive /etc/storeluma/release.json /etc/storeluma
```

Route nonzero exits to the operator. Monitor disk space for both `pg_wal` and the repository and check the age of the newest usable backup. Confirm available capacity against the actual full-backup size, WAL generation and retention. Rehearse on a replacement machine with write traffic disabled. Before reopening, compare ledger amounts, stock, saga states, Outbox and Inbox with source documents and any external payment provider.
