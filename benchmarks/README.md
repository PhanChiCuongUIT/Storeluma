# Checkout load and event recovery

Use a disposable Compose project with its own volumes and the repository's generated test accounts. The benchmark creates a household, inserts background data, starts cash transactions and temporarily stops Finance. It uses the same localhost ports as the development stack. Keep the Compose project selection in the environment for both commands.

```sh
export COMPOSE_PROJECT_NAME=storeluma-benchmark
docker compose up -d --build --wait
npx playwright test --config benchmarks/playwright.config.ts
docker compose down
```

In PowerShell set `$env:COMPOSE_PROJECT_NAME='storeluma-benchmark'` before running the Docker and Playwright commands. Run the usual setup and Chromium installation described in the root README first.

**Receipt backlog.** With Finance stopped, the owner posts 100 purchase receipts through the gateway. Timing starts immediately before restarting Finance, after Inventory confirms all 100 publications and the test verifies zero payables. The test measures until all 100 payables exist and checks their Inbox records, amounts and stock movements. The recovery budget is 60 seconds.

**Checkout workload.** Background data contains 10,000 SKUs with base units and 10,000 draft orders. Bulk inserts run only during setup, with real database constraints and projection triggers. The measured purchases use the live gateway, one real stocked SKU, one register, and ten independent OIDC sessions across three accounts. Each group of ten sessions searches simultaneously for distinct catalog codes. Their checkout journeys start one second apart over ten minutes. The harness records schedule lag, including time spent searching, quoting, and creating the draft before checkout admission.

**Metrics.** Admission ends when the gateway responds to checkout. Completion runs from the same request until the public API reports COMPLETED, including polling at 100 ms intervals and explicit cash confirmation as soon as the payment becomes available. The harness does not insert a cashier delay. Percentiles use nearest rank. Errors are collected by scheduled journey. Passing requires all 600 payments and movements, exact amounts, search p95 below 800 ms and end-to-end checkout p95 below three seconds. Catalog and Sales pending Outbox counts are sampled before and after the timed window.

The benchmark saves measurements and a screenshot in `tmp/week11/load/`. It runs separately from the functional CI suite so that service restarts and competing tests do not affect the timing. Machine resources, data shape, network and broker topology affect the results.
