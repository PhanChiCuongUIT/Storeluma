# HTTPS staging

This Compose deployment runs the application, Keycloak and the seven business services behind Caddy. It has its own generated credentials, certificate authority, database and broker volumes. Development can continue on the usual localhost ports.

| Endpoint | Purpose |
| --- | --- |
| `https://storeluma.localhost:9443` | Web app, gateway and login callback |
| `https://storeluma-id.localhost:9443` | OIDC discovery, login, logout and theme resources |
| Port 9080 on either host | Redirect to HTTPS, preserving the path and query |

Only Caddy publishes ports. Both bindings use loopback. PostgreSQL and RabbitMQ use the private Compose network. Keycloak runs in server mode and advertises its HTTPS issuer. The gateway and services validate discovery and signing-key requests against the staging CA. The browser uses a host-only Secure, HttpOnly session cookie on the application host.

## Run locally

From the repository root, use Node 24, Docker with Compose 2.24.4 or later, and the Chromium version installed by Playwright.

```sh
npm ci
npx playwright install chromium
node infra/staging/stage.mjs up
npx playwright test --config infra/staging/playwright.config.ts
node infra/staging/stage.mjs manifest
node infra/staging/stage.mjs down
```

`up` creates the staging configuration under `tmp/https-staging/`, starts Caddy, copies its public root certificate and builds the service images. Subsequent runs keep the same credentials and volumes. For an interactive browser session, resolve both hostnames to 127.0.0.1 and trust `root.crt` in a dedicated test profile. The automated browser first verifies both certificate chains and hostnames and uses their public-key pins for that browser process.

The smoke test signs in with password and TOTP, opens a register shift, receives two units of stock and sells one for VND 100,000. It waits for the completed order, checks its VND 40,000 cost and signs out. Each run creates a test household. `down` stops the containers and retains the data. Store the generated configuration together with the volumes for repeat runs.

## Continuous integration

The `https-staging` job creates a fresh deployment on an Ubuntu ARM64 runner. A successful smoke test is followed by a check of service readiness, published ports, image revision labels and the runtime user. The `https-staging-manifest` artifact contains the Git revision, check time, platform, image IDs, available registry digests and latest migration file packaged in each application image. Locally built application image IDs identify the build on that engine. Promotion to a separate host requires published registry digests.

The manifest is the only artifact from this job. The generated realm, accounts, credentials and CA material stay on the runner. Staging runs alongside the functional regression job; completing both checks verifies the commit on the two environments.
