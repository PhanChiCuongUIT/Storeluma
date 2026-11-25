# Operating an installed pilot

## Change one application service

Start in the checkout at the signed candidate manifest's commit. Keep its signature bundle next to it under the same basename followed by `.sigstore.json`. Confirm the candidate uses compatible API and event contracts and that the installed schema already supports the candidate and its predecessor. For an expansion requiring migrations, apply and test the compatible schema first. Keep the previous checkout and release bundle available.

```sh
sudo bash infra/pilot/change-service.sh roll-service /etc/storeluma/releases/candidate/release.json notification
sudo bash infra/pilot/change-service.sh rollback-service /etc/storeluma/releases/candidate/release.json notification
```

The command takes the installer lock, checks the running digest, verifies the signed manifest, pulls the selected service and checks its schema in a one-off container. Compose waits for that service's health check. The saved journal in the private config directory records its previous digest before replacement. Failed readiness restores the original image. A rollback uses the recorded digest and rejects an unrelated running image. A future full deploy intentionally converges all services on its selected manifest. Preserve the per-service journals with the configuration to reproduce an intermediate release.

After an interruption, rerun the same command with the same manifest and service. The journal retains both digests until the health check finishes. If a rollback fails its health check, the command restores the release that was serving before the rollback. Once the cause is resolved, rerun `rollback-service` to retry the original target. A pending change must be resolved before selecting a different release for that service.

## Rotate a service credential

Use the signed release matching the service's running image. Schedule a short interruption for that service.

```sh
sudo bash infra/pilot/change-service.sh rotate-service /etc/storeluma/release.json finance
```

The launcher persists a pending service seed with mode 0600, stops the selected service, changes its runtime database and broker passwords, ends its previous sessions and starts it again. Repeat the same command if interrupted. Include `service-seeds.json` in the private configuration escrow. Gateway uses a database account only. Database owner, OIDC client, session encryption, repository and host administrator credentials have separate lifecycles.

## Investigate an alert

The installer checks service availability, undelivered Outbox events older than 60 seconds, parked messages and WAL archiving every two minutes. By default the probe reports to cron. To deliver status changes to an on-call receiver, write the private HTTPS JSON endpoint URL to `/etc/storeluma/alert-webhook` with mode 0600. The payload contains the component, problem codes and time. A failed delivery is retried and a recovery notification follows once the checks clear. An external uptime monitor is needed to detect the loss of the entire host.

| Signal | Check and action |
| --- | --- |
| missing, unavailable, probe-failed | Check the service's health, disk and dependencies. Recover the service or revert its most recent deployment. Compare the running digest and signed release. |
| outbox-delay | Check RabbitMQ, producer confirm errors, consumer health and oldest outstanding event. Follow the document and correlation IDs in the service log. |
| dead-letter | Use the operations screen to inspect the event. Fix the source or consumer, record a reason and replay the selected event. Check Inbox, the document, stock and ledger before closing the incident. |
| wal-archive | Run the archive check, inspect repository access, disk capacity and last usable backup. Resume archiving and rehearse recovery before reporting the incident resolved. |

Test ownership of the receiver by causing a controlled backlog in an isolated environment. Record the delivery time, responsible operator, corrective action and recovery notice. Save the response and release version with site acceptance.
