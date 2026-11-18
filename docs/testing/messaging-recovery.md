# Messaging recovery tests

Run `npx playwright test tests/week11-messaging.spec.ts` against a dedicated Compose environment after building and starting the services. Run `npm test` for the full regression suite. The tests create a household, locations, a product, a supplier and purchase receipts through the application APIs with real OIDC/TOTP authentication.

## Failure scenarios

| Test | Injected failure | Required result |
| --- | --- | --- |
| W11-01 | Kill the Finance process after the Inbox/payable transaction commits, before its consumer ACK | The broker marks the delivery as redelivered. Recovery acknowledges the same event; one Inbox row, one payable of VND 80,000 and one receipt movement remain. |
| W11-02 | Kill the publisher after a successful broker confirm, before marking the Outbox row delivered | The Outbox row remains pending. After restart and lease expiry, the same event ID and payload are published again; only one register and one source Outbox row exist. |
| W11-03 | Suppress one successful confirm callback after the broker accepts the publication | The real confirm timeout expires and Outbox remains pending. The worker retries after its lease, then marks the row delivered. Both observed publications have the same ID and payload. |
| W11-04 | Run two Finance consumers and send 32 copies alternating between the original event ID and a new ID for the same receipt | Both consumers acknowledge deliveries. There are two Inbox entries, but only one payable and one stock movement. |

## Fault injection and evidence

`tests/helpers/messaging-fault-worker.mjs` wraps the AMQP client boundary before importing the compiled Finance entry point. It uses the production handler, transaction code, publisher, PostgreSQL and RabbitMQ. The two crash cases terminate the process with SIGKILL; tests assert exit code 137. The lost-confirm case suppresses a client callback, rather than simulating a physical network partition. It does not return a fabricated business result or edit business records with SQL.

The harness is mounted read-only into uniquely named, one-off Compose containers. It is not copied into the application image and has no public HTTP endpoint or production configuration switch. Normal Finance is stopped during fault injection; temporary containers do not publish host ports. Cleanup removes only those containers and waits for the normal Finance service to become healthy after each case. Database and broker volumes are retained.

An exclusive observer queue records the actual `register.ready` publications. The consumer crash test reads the broker's redelivery flag and requeues the delivery unchanged. Database queries use the owning service's account for assertions. The parallel-consumer case waits until both consumers are registered and checks that both processed messages.

`tmp/week11/messaging-results.json` records event IDs, observed counts and recovery durations. GitHub Actions retains it alongside the full Playwright result. These measurements describe the test environment; they are not a throughput benchmark or a recovery-time SLA. The tests cover at-least-once delivery and idempotent effects, not exactly-once network delivery or multi-node broker failover.

Publisher confirms and consumer acknowledgements protect separate parts of delivery; a lost acknowledgement can require retransmission. See the [RabbitMQ acknowledgement and confirm documentation](https://www.rabbitmq.com/docs/confirms).
