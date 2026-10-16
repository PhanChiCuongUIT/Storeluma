# Storeluma

Storeluma is a business management application for household business owners and their staff, built with a microservices architecture. The current version supports business locations, staff access, a product catalog, suppliers, and goods receiving.

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
- Use a Vietnamese interface that supports desktop and mobile screens.

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

Gateway serves the frontend, manages login sessions, and routes requests to the owning service. Business owns businesses, locations, memberships, and authorization. Catalog owns products, units, and selling prices. Inventory owns suppliers, receipts, stock movements, quantities, and valuation. Finance owns registers and supplier payables.

Each service runs as a separate process with its own PostgreSQL database and credentials. Business authorization and Catalog validation use authenticated internal HTTP calls. Receipt posting commits stock, valuation, and its Outbox events in one Inventory transaction; Finance consumes the event in a separate transaction with Inbox and receipt-level deduplication. Money is represented as integer strings and quantities as decimal strings, using PostgreSQL numeric types and exact fixed-point arithmetic.

Sales, Reporting, and Notification remain service scaffolding. Their workflows are not implemented. They can be started with `docker compose --profile full up -d --build`.

## Setup and startup

Requirements: Node.js 24 or later and Docker with support for Linux containers. Ports `4100`, `8180`, `55432`, `5673`, and `15673` must be available.

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

After signing in, create a business and its first location. Once the location is ready, select it as the working location and manage staff in the staff section. Access depends on the user's role and assigned locations within each business. The application interface is in Vietnamese.

Use **Hàng hóa** to add a product and its first SKU, then add packaging units and prices. Add a supplier in **Nhà cung cấp**. In **Nhập hàng**, select a location, choose the supplier and items, enter received quantities and purchase prices, save a draft, and post it. A draft changes neither stock nor payables. Posting a purchase does not record a cash payment.

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

## Project structure

| Path | Contents |
| --- | --- |
| `apps/web` | Frontend and Storeluma assets |
| `services` | Gateway, business services, and migrations |
| `packages/platform` | Shared database, HTTP, and messaging components |
| `infra/keycloak` | Vietnamese login theme |
| `tests` | Integration and browser tests |
| `tools` | Environment setup and application configuration tools |
| `compose.yaml` | Docker service and infrastructure configuration |

## Development status

The application currently runs locally with Docker Compose, HTTP, and Keycloak in development mode. Sample accounts are intended for testing. Login sessions last up to 15 minutes; users must sign in again after their session expires.

The current release is `0.5.0`. Detailed stock cards, stocktaking, sales/POS, supplier payments, financial reporting, and notifications remain planned. CSV imports and purchase orders are not included. Unit conversion factors are immutable after creation; create a new unit for a different pack size.

Production deployment, HTTPS, account self-registration, email delivery, automatic session renewal, and backup and recovery procedures have not yet been implemented. Local service accounts currently own their databases and perform startup migrations; production migration roles, service identity rotation, and broker-level per-service credentials remain deployment work.
