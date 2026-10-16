# Catalog and receiving API — 0.5.0

Public prefix: `/v1/tenants/{tenant}` through Gateway. UUIDs identify resources. Browser requests use the BFF session cookie; mutations require the session's `x-csrf-token`, matching `Origin`, and `Idempotency-Key` (16–64 letters, digits, `_` or `-`). Keys are scoped to actor, tenant and command. Identical retries return the stored result; a changed body with the same key returns 409.

The URLs below extend the tenant-prefixed API established by the application. Purchase prices and VND amounts are JSON strings, never JavaScript numbers. Quantities and conversion factors are positive decimal strings with at most three decimal places. Updates require the current integer `version`. Unknown request fields are rejected.

| Method and suffix | Request / result | Permission |
| --- | --- | --- |
| GET `/categories`, `/products`, `/skus` | `q`, `status`, `limit`, `cursor`; `{items,nextCursor}` | All active member roles |
| GET `/products/{id}` | Product with SKUs and units | All active member roles |
| POST `/categories` | `{code,name}` | OWNER, MANAGER |
| PATCH `/categories/{id}` | `{name,status,version}` | OWNER, MANAGER |
| POST `/products` | `{name,categoryId?,sku}`; creates first SKU and base unit atomically | OWNER, MANAGER |
| PATCH `/products/{id}` | `{name,categoryId,status,version}` | OWNER, MANAGER |
| POST `/products/{id}/skus` | SKU body below | OWNER, MANAGER |
| PATCH `/skus/{id}` | `{name,barcode,status,version}` | OWNER, MANAGER |
| POST `/skus/{id}/units` | `{name,factor,priceVnd}` | OWNER, MANAGER |
| PATCH `/skus/{id}/units/{unit}` | `{priceVnd,status,version}`; stores price history | OWNER, MANAGER |
| GET `/suppliers` | `q` searches code/name/phone; common pagination | OWNER, MANAGER, STOCK, ACCOUNTANT |
| POST `/suppliers` | `{code,name,phone?,address?}` | OWNER, MANAGER, STOCK |
| PATCH `/suppliers/{id}` | `{name,phone?,address?,status,version}` | OWNER, MANAGER, STOCK |
| GET `/receipts` | Required `siteId`; optional `q,status,supplierId,limit,cursor` | Receiving readers in site scope |
| GET `/receipts/{id}` | Header and immutable line snapshots | Receiving readers in site scope |
| POST `/receipts` | Draft body below | OWNER, MANAGER, STOCK in active site |
| PATCH `/receipts/{id}` | `{version,draft}` | Same; STOCK edits own drafts only |
| POST `/receipts/{id}/post` | `{version}` | OWNER, MANAGER in active site |
| POST `/receipts/{id}/cancel` | `{version}`; drafts only | Draft editors |
| GET `/stock-balances` | Required `siteId`; optional `skuId,limit,cursor` | All roles in site scope; valuation only OWNER/ACCOUNTANT |
| GET `/payables` | Required `siteId`; optional `receiptId,supplierId,limit,cursor`; includes `dataAsOf` | OWNER, ACCOUNTANT in site scope |

List limit defaults to 50 and cannot exceed 200. Cursors are the last UUID returned; order is stable by UUID, not chronological. `ACTIVE` and `INACTIVE` apply to catalog and suppliers; receipts use `DRAFT`, `POSTED`, `CANCELLED`. No destructive delete endpoint is exposed.

```json
{
  "code": "CF-250",
  "name": "Cà phê Arabica 250g",
  "barcode": null,
  "baseUnit": "Gói",
  "priceVnd": "85000",
  "attributes": {"size": "250g"}
}
```

The draft body is `{siteId,warehouseId,sourceType,supplierId,note?,lines}`. `sourceType` is `PURCHASE` or `OPENING_STOCK`; each of 1–100 lines has `{skuId,unitId,qty,unitCostVnd}`. A SKU appears once per receipt. The server validates the active product/SKU/unit in Catalog, calculates base quantity and line cost, and stores snapshots. The warehouse must be the one provisioned for the selected site. `OPENING_STOCK` requires OWNER and a null supplier. Purchases require an active supplier in the same tenant.

`unitCostVnd` is per selected receiving unit. Line cost is quantity × unit cost, rounded HALF_UP to whole VND. Conversion must be exactly representable in 0.001 base units; otherwise the request is rejected. A posted purchase updates Inventory first; the payable can appear later. `dataAsOf` is the Finance query time, not a guarantee that its event queue is empty. A Finance error must be displayed as unavailable, never as zero debt.

Purchase prices on receipts are available to receiving roles because they enter and approve them. Aggregate inventory value and average cost are separate protected fields. Cashiers cannot read supplier contact details, receipts, or payables.

## Internal calls and events

`POST /v1/internal/authorize` is owned by Business. `POST /v1/internal/catalog/snapshots` is owned by Catalog. Gateway blocks both routes. Direct service calls require a valid actor JWT plus a 30-second HS256 service token bound to issuer, audience, subject, method, path and canonical body hash. Each target accepts only its configured callers. Business checks the current membership and site scope for every call and rejects suspended sites on commands. Service outages fail closed.

Domain events: `catalog.sku-updated.v1`, `inventory.receipt-posted.v1`, `inventory.stock-changed.v1`. Envelope fields: `eventId,eventType,schemaVersion,occurredAt,producer,tenantId,siteId,aggregateId,aggregateType,aggregateVersion,correlationId,causationId,data`. No user JWT or login secret is included. Payload contracts are in `packages/platform/events.ts`. Catalog projection ignores lower versions; receipt payables are unique by tenant and receipt as well as deduplicated by event ID.

Existing location-provisioning events retain their version-1 envelope for compatibility. Publisher confirms plus durable queues provide at-least-once delivery to registered consumers. Failed consumers retry five times with backoff, then dead-letter for operator investigation. Replaying a corrected event requires preserving its identity. Stock-change events are emitted, but the reporting consumer is not yet implemented; Outbox history is retained for later backfill.

Errors: 400 validation or numeric bounds; 401 invalid session/token; 403 missing role, CSRF or service identity; 404 resource outside the tenant/site or unavailable Catalog item; 409 duplicate code, stale version, conflicting key or invalid business state; 503 dependency unavailable. Error responses contain `message`, with validation `fields` when relevant. PostgreSQL numeric and check-constraint failures roll back the full transaction.
