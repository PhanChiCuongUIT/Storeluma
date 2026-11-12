# Storeluma

Storeluma is a business management application for household business owners and their staff, built with a microservices architecture. The current version supports business locations, staff access, a product catalog, suppliers, goods receiving, stock cards, stocktaking, approved inventory adjustments, sales orders, cash checkout, returns, management reports, and an operational work inbox.

## Current features

- Sign in with a password and a TOTP verification code through Keycloak; sign out and end the session.
- Create a business, add locations, and suspend or reactivate locations.
- Automatically provision a warehouse and cash register for each location through RabbitMQ events, with readiness status shown in the interface.
- Select a business and working location within the user's assigned scope.
- Search locations by name, code, or address, filter by status, and switch between card and list views.
- Invite staff, accept invitations, manage roles and location assignments, and block or reactivate members.
- View the business's activity log.
- Manage categories, products, SKUs, barcodes, packaging units, and selling prices, with price history and optimistic version checks.
- Search and update suppliers, deactivate them, and view their receiving and payable history by location.
- Create, edit, and cancel receipt drafts; authorized managers can post receipts to inventory.
- Convert receipt quantities to base units, maintain moving weighted average cost, and create supplier payables asynchronously for purchases.
- Record owner-only opening stock without creating supplier debt. Posted receipts retain their original snapshots and cannot be edited or cancelled.
- Inspect on-hand, reserved, quarantined, and available quantities by location; filter stock movements and open their source documents within the user's permissions.
- Create stock counts, freeze their SKU scope, record good and quarantined quantities, submit for approval, request a recount, and post differences exactly once. Cancellation releases the scope without changing stock.
- Draft, edit, approve, or cancel stock adjustments: write-offs, quarantine, quality-confirmed release, and quantity corrections. Valuation uses exact decimal arithmetic; zero-stock increases require an explicit cost.
- Protect stock writers with the same transactional locks. Receipts and adjustments cannot change a SKU while its count is open. Cost fields are removed from responses for roles without financial access.
- Create authoritative quotes and editable order drafts, with exact unit conversion and allocated order discounts.
- Hold stock atomically across all order lines, confirm actual cash receipt, and complete orders only after payment and stock commit.
- Open a cash shift, record opening cash separately from sales, and close it with counted cash and variance.
- Recover checkout after service outages or restarts using durable workflow state and stable reservation/payment identifiers.
- Add items by exact SKU/barcode with Enter, focus product search with F2, and find orders by code, date range, or status.
- View and print completed-sale receipts at 80 mm, with immutable snapshots and an explicit reprint label.
- Request and approve partial or full returns; restore original cost to sellable or quarantined stock and explicitly confirm cash refunds.
- Track drawer sales, refunds and separate cash entries; close shifts, approve cash variances, and reverse cash entries into an open shift without editing closed history.
- View sales and returns by completion date, net revenue, authorized cost and gross profit, top-selling items, current stock and drawer cash flows.
- Export UTF-8 CSV asynchronously, with expiry, formula-safe labels and authorization checked again at download.
- Track low stock, overdue cash collection/refunds, orders under review, returns awaiting approval and unapproved shift variances. Acknowledge work, configure location thresholds and open the source document.
- Switch between Vietnamese and English, with light, dark or system appearance across the application and sign-in screens.

## Technology and architecture

| Component | Technology / responsibility |
| --- | --- |
| Frontend | React, TypeScript, Vite |
| Backend | NestJS, Gateway/BFF, and business services |
| Authentication | Keycloak, OpenID Connect, TOTP |
| Data | PostgreSQL, with a separate database and account for each service |
| Messaging | RabbitMQ, with Outbox/Inbox patterns for retries and deduplication |
| Runtime | Docker Compose |
| Testing | Playwright |

Gateway serves the frontend, manages login sessions, and routes requests to the owning service. Business owns businesses, locations, memberships, and authorization. Catalog owns products, units, and selling prices. Inventory owns suppliers, receipts, stock movements, quantities, and valuation. Finance owns registers, supplier payables, cash shifts, payments, and the cash ledger. Sales owns quotes, order snapshots, and durable checkout coordination.

Each service runs as a separate process with its own PostgreSQL database and credentials. Business authorization and Catalog validation use authenticated internal HTTP calls. Receipt posting commits stock, valuation, and its Outbox events in one Inventory transaction; Finance consumes the event in a separate transaction with Inbox and receipt-level deduplication. Money is represented as integer strings and quantities as decimal strings, using PostgreSQL numeric types and exact fixed-point arithmetic.

Counts and adjustments belong to Inventory. Approval commits the document, balances, movements, audit, and stock-change Outbox events in one transaction. These documents do not create supplier payables. SKU locks also protect stock with no existing balance. Sales reservations and stock commits use the same locks and freeze checks; transfer workflows remain planned.

Event publication uses persistent messages, mandatory routing, and bounded publisher confirms. Unroutable events remain pending in the Outbox. Failed handlers retry with backoff and park messages in the owning service's dead queue. Events awaiting future consumers are retained in `storeluma.deferred`; this deferred queue is not used as the Reporting/Notification bootstrap source. Those consumers have dedicated queues and reconcile existing records through their source snapshot APIs.

Sales coordinates reserve, prepare, cash confirmation, stock commit, and completion through authenticated service commands. Unknown outcomes enter review and retry with the same identifiers; prepared stock does not expire automatically. Cancellation voids the cash intent before releasing stock, and a successful cash confirmation wins over cancellation. Each service commits only its own data and Outbox.

Reporting and Notification run by default with their own databases. Source services atomically write revisioned projections and Outbox events alongside business changes. Both consumers deduplicate events and reconcile through authenticated, paginated source snapshots; they never query another service’s tables. Reports expose a conservative reconciliation timestamp and synchronization status. Work items resolve automatically when the source condition clears, while acknowledgment preserves the outstanding business action.

## Setup and startup

Requirements: Node.js 24 or later and Docker with support for Linux containers. Ports `4100`, `8180`, `55432`, `5673`, and `15673` must be available.

The PostgreSQL host port defaults to `55432`. If Windows reserves that port or it is in use, set `PG_HOST_PORT` to an available port in `.env`, then run Compose again. The test suite reads this setting. Service-to-service database connections continue to use the internal port `5432`.

```sh
git clone https://github.com/PhanChiCuongUIT/Storeluma.git
cd Storeluma
npm ci
npm run setup
docker compose up -d --build
docker compose ps
```

Wait for the services to become ready, then open [http://localhost:4100](http://localhost:4100). Gateway health is available at [http://localhost:4100/health](http://localhost:4100/health).

`npm run setup` generates local configuration and sample accounts while preserving any existing configuration. `.env` and `infra/generated/` contain environment-specific secrets and are excluded from Git.

### Sign in

Retrieve the sample owner's credentials and current TOTP code:

```sh
node tools/demo-login.mjs owner
```

Sign in using the displayed username, password, and TOTP code. If the code expires, run the command again to obtain a new one. Replace `owner` with `cashier` or `outsider` to check access using another account.

After signing in, create a business and its first location. Once the location is ready, select it as the working location and manage staff in the staff section. Access depends on the user's role and assigned locations within each business. Language and appearance controls are available before and after sign-in. Preferences persist in the browser and are shared with Keycloak on the same host. Product names and business data remain unchanged when switching languages; monetary values remain in VND.

For an existing local environment, run `node tools/configure-branding.mjs` after Keycloak is ready to enable both languages without changing accounts. Compose shares the preference script and color palette with the login theme and waits for Keycloak readiness before starting Gateway.

Use **Hàng hóa** to add a product and its first SKU, then add packaging units and prices. Add a supplier in **Nhà cung cấp**. In **Nhập hàng**, select a location, choose the supplier and items, enter received quantities and purchase prices, save a draft, and post it. A draft changes neither stock nor payables. Posting a purchase does not record a cash payment.

Open **Kho hàng** for stock balances, movements, counts, and adjustments. A count follows draft → counting → submitted → posted; starting the count freezes its selected SKUs until approval or cancellation. Owners and assigned managers approve; stock staff maintain their own drafts and counts. Accountants can inspect valuation; cashiers can inspect quantities and movements without cost fields or restricted source documents.

Use **Đơn bán** to open a cash shift, choose products and selling units, obtain a quote, and save a draft. Start checkout to reserve stock, then confirm cash only after receiving payment and returning change. The completed order links to a sale movement in the stock card. Quotes expire after 120 seconds; use **Sửa đơn / cập nhật giá** if a quote expires or prices change. Cashiers may discount up to 5% and operate their own shift; authorized owners/managers can handle shifts in their location scope.

Completed orders offer **Xem / in biên nhận** and **Lập phiếu trả**. Receipts are internal sales receipts, not electronic tax invoices. Printing never repeats checkout. A return records original order lines, quantity, reason and stock disposition. A manager approves before Inventory receives the goods; Finance then prepares a refund. Select an open drawer and confirm only after physically handing the cash to the customer. Returns retain their identifiers through interruptions, and the original sale stays completed. One active return per order serializes partial returns; later returns become available after completion or cancellation of an unapproved request. Returns requested more than seven days after sale completion require an approval reason. A sole eligible owner may self-approve with an audit record; when another eligible manager exists, a different approver is required.

Open **Ca thu ngân** to inspect opening cash, sales receipts, cash refunds, other drawer movements and expected cash. Pending payments or refunds assigned to the drawer block closing. Counted cash and any variance reason are stored at closing; a manager approves discrepancies separately. Reversals create a new linked entry in an open drawer, preserving the original document and any closed-shift totals.

Cashiers can read financial details only for their own shifts. They can see whether another cashier occupies the register, without receiving that shift's cash totals or notes. Cash collection, refund and close requests check current permissions and shift ownership even when returning a previously saved idempotent result.

### Reports and operational work

Open **Báo cáo** as an owner, manager or accountant. Select locations and dates, then switch between sales results, current inventory and drawer cash flow. Managers see only assigned locations and do not receive cost, inventory valuation or gross-profit fields. Owners and accountants with access can see those fields. Cashiers and stock staff do not have aggregate-report access.

Select **Xuất CSV**, wait for completion, then **Tải tệp CSV**. Jobs expire after 15 minutes and belong to their requester. A changed role or location assignment invalidates the old download. Dates use Vietnam time; returns reduce revenue in the return completion period. Inventory is the current balance, not a historical reconstruction.

Open **Công việc** to review pending work in the assigned scope. **Tiếp nhận** acknowledges an item; it does not settle payment, approve a return or change stock. Use the source link to perform the actual business action. Owners and managers can configure the available-stock threshold and pending-payment/refund delay by location. The inbox refreshes every 15 seconds. Notifications are in-app; email and push delivery are not implemented.

After upgrading an existing environment, run `npm run setup` to add missing service credentials without replacing existing configuration, then rebuild and start Compose. Keep the database volumes. Initial snapshots may take time; exports are blocked until every source has completed its first reconciliation. A delayed-source message is shown when synchronization is behind. Source snapshots retain a consistent paginated cohort for one hour and reconcile every five minutes; capacity testing is needed before operating at larger scale.

### Stop the application

```sh
docker compose down
```

Data is stored in Docker volumes and remains available after the application stops.

## Build and test

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Start the services before running `npm test`. The test suite uses real backend services and databases, creates test data, and stops or restarts some services to verify recovery. Run it in a dedicated development and test environment.

Authentication tests wait for a fresh TOTP window before each login to avoid reusing a code across suites. Keep one test process per account set; the suite runs with one worker.

Test fixture IDs are stored under `tmp/fixtures/<compose-project>` so separate Compose projects do not reuse each other's records. Set `TEST_FIXTURE_DIR` to a new empty directory after replacing or resetting a test database. Use a fresh test environment for a full run: the business creation tests deliberately exercise the normal owner limit and must not bypass it.

The suite also checks upgrades from existing inventory and finance schemas to stocktaking, reservations, returns and cash refunds. It creates uniquely named disposable databases, runs the actual migration runner, verifies preserved history and rollback, then drops only those test databases. Run the build before the tests so the compiled migration runner is available.

GitHub Actions builds the application and audits runtime dependencies, and runs the full suite on a fresh Docker environment for pushes and pull requests. Workflow artifacts retain test results, screenshots, failure context, and container status for seven days. Deployment is not automated yet.

## Project structure

| Path | Contents |
| --- | --- |
| `apps/web` | Frontend and Storeluma assets |
| `services` | Gateway, business services, and migrations |
| `packages/platform` | Shared database, HTTP, and messaging components |
| `infra/keycloak` | Bilingual login theme with light and dark appearance |
| `tests` | Integration and browser tests |
| `tools` | Environment setup and application configuration tools |
| `compose.yaml` | Docker service and infrastructure configuration |

## Development status

The application currently runs locally with Docker Compose, HTTP, and Keycloak in development mode. Sample accounts are intended for testing. Login sessions last up to 15 minutes; users must sign in again after their session expires.

Each sign-in attempt has a separate five-minute state and browser cookie. Expired attempts return to the sign-in screen with a retry action; revisiting a callback preserves an existing valid session. Start from `http://localhost:4100/`, rather than bookmarking a temporary identity-provider or callback URL.

The current release is `0.9.0`. The implemented POS flow covers walk-in cash sales, receipts, partial/full returns, cash refunds and drawer settlement at one default register per location. Customer profiles and purchase history, electronic payments, customer credit, transfers, supplier payments, tax reporting and external email/push notifications remain planned. Management reports currently cover settled sales/returns, current inventory and cash movements at the register; gross profit is not net profit. Offline checkout, CSV imports and purchase orders are not included. Unit conversion factors are immutable after creation; create a new unit for a different pack size. Browser printing is implemented; compatibility with a physical receipt printer depends on its driver and paper settings.

Migrations preserve existing receipt history. Pre-upgrade movement balances are reconstructed in recorded-time order and marked in the stock card; new movements capture their actual locked before/after values. New databases apply the same numbered migrations at startup. Do not reset Docker volumes when upgrading an existing installation.

Production deployment, HTTPS, account self-registration, email delivery, automatic session renewal, and backup and recovery procedures have not yet been implemented. Local service accounts currently own their databases and perform startup migrations; production migration roles, service identity rotation, and broker-level per-service credentials remain deployment work.
