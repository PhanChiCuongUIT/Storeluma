# Single-host HTTPS pilot

The pilot overlay runs on a Linux ARM64 host. Caddy obtains public certificates for separate application and identity DNS names. Only ports 80 and 443 are published. PostgreSQL archives WAL to the operator's private repository. Keep the host, SSH access, DNS ownership, external repository and decryption material under the deployment owner's control.

## Prepare a release

On `main`, manually dispatch **Verify Storeluma** with `publish_pilot` selected. The publishing job requires the functional, HTTPS and recovery checks to pass, repeats the recovery scenario on its own runner and publishes those tested image IDs to GHCR. Download `release.json` from the `pilot-release` artifact. The manifest references all twelve images by registry digest. Ordinary pushes run the checks with read-only permissions. The registry requires package write permission during publication and pull access on the pilot machine.

## Configure the host

For a fresh Ubuntu 24.04 ARM64 pilot backed by a private OCI Standard bucket, copy `input.example.env` into `docs/local/pilot-input.env`. Fill the IPv4 address, registered domain, bucket coordinates and scoped OCI customer key. Place the release manifest in `docs/local/pilot-release.json`. Point the `shop` and `id` A records at the VM and allow TCP 80/443. Run `infra/pilot/install.ps1 -IdentityFile PATH_TO_SSH_KEY` from PowerShell at the repository root. The installer uses the Ubuntu SSH account, creates a single pilot owner, provisions the private configuration and schedules backups after deployment. For a manually managed host, configure the following inputs.

- Point two DNS records at the host. Allow incoming HTTP/HTTPS and provide persistent storage for the database, broker and Caddy certificates. Set the host clock and verify enough disk capacity for WAL growth during a repository outage.
- Use a private directory outside the checkout for `.env`, `init.sql`, `realm.json` and `pgbackrest/`. Use distinct credentials for this deployment. Supply the variable names in the root `.env.example`, plus `APP_HOST` and `IDENTITY_HOST` as hostnames without a scheme. Use URL-safe database passwords and a 32-byte hex session key.
- The initial SQL must provision the per-service databases and logins expected by Compose. The Keycloak realm uses the Storeluma password/TOTP browser flow. Set SSL required to `all`. Its confidential `storeluma-web` client must match the gateway secret, allow the exact HTTPS application origin, use S256, and register only `/auth/callback` and the root post-logout URL. On an existing realm, apply changes via Keycloak administration before rollout. Realm import only initializes a missing realm.
- Configure the separate backup host, client key and cipher password as described in [PostgreSQL recovery](../recovery/README.md). Escrow the environment, key material and release manifest independently of the VM.

## Deploy and verify

Check out the commit listed in the manifest, then run from the repository root:

```sh
node infra/pilot/deploy.mjs validate /etc/storeluma/release.json /etc/storeluma
node infra/pilot/deploy.mjs deploy /etc/storeluma/release.json /etc/storeluma
```

The launcher checks the image pins, hosts, client configuration and published ports before pulling images. It checks archiving and takes a full backup before starting the application services. It waits for service readiness and verifies HTTPS health and the published OIDC issuer. Preserve the previous manifest and configuration. Reapply an earlier release only after verifying schema and event compatibility. For a destructive schema change, stop writes and restore into a fresh volume first.

Verify from outside the host with a pilot account: sign in with TOTP, receive stock, complete a cash sale, compare the payment and inventory values, then sign out. Record the public smoke result and the time of the last off-host restore before inviting other users. The staging rehearsal uses a private CA and synthetic accounts.
