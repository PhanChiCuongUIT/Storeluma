import { fillFreshTotp } from "./helpers/totp";
import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type APIResponse,
} from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID, createHash, createDecipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import amqp from "amqplib";
import { EventEmitter } from "node:events";
import { publishConfirmed } from "../packages/platform/publish";
import { baseQuantity, lineCost } from "../packages/platform/decimal";
const evidence = process.env.WEEK05_SCREENSHOTS ?? "tmp/week05/screenshots";
const origin = "http://localhost:4100",
  accounts = JSON.parse(readFileSync("infra/generated/accounts.json", "utf8"));
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .trim()
    .split(/\r?\n/)
    .map((s) => s.split("=")),
);
const pool = (s: string) =>
  new Pool({
    host: "127.0.0.1",
    port: 55432,
    user: s,
    password: env[`${s.toUpperCase()}_DB_PASSWORD`],
    database: s + "_db",
    max: 2,
  });
const inventory = pool("inventory"),
  finance = pool("finance"),
  catalog = pool("catalog"),
  gateway = pool("gateway");
async function login(page: Page, i: number) {
  await page.goto("/");
  await page.getByRole("link", { name: /Đăng nhập vào Storeluma/ }).click();
  await page.locator("#username").fill(accounts[i].username);
  await page.locator("#password").fill(accounts[i].password);
  await page.locator("#kc-login").click();
  await fillFreshTotp(page, accounts[i].otpSecret);
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(origin + "/");
}
async function api(
  ctx: BrowserContext,
  path: string,
  method = "GET",
  data?: unknown,
  key?: string,
) {
  const s = await (await ctx.request.get("/auth/session")).json();
  return ctx.request.fetch(path, {
    method,
    data,
    headers: {
      origin,
      "x-csrf-token": s.csrf ?? "",
      ...(key ? { "idempotency-key": key } : {}),
    },
  });
}
async function good(r: APIResponse) {
  expect(r.status(), await r.text()).toBeLessThan(300);
  return r.json();
}
const docker = (...args: string[]) =>
  execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
test.describe.serial("Week 5 catalog and receiving - live services", () => {
  let owner: BrowserContext,
    staff: BrowserContext,
    outsider: BrowserContext,
    page: Page,
    tenant: string,
    site: any,
    otherSite: any,
    member: any,
    category: any,
    product: any,
    sku: any,
    unit: any,
    supplier: any,
    receipt: any;
  const run = Date.now().toString(36).toUpperCase();
  const path = (r: string) => `/v1/tenants/${tenant}/${r}`;
  const command = (
    r: string,
    body: any,
    method = "POST",
    ctx = owner,
    key = randomUUID(),
  ) => api(ctx, path(r), method, body, key);
  const draft = (overrides: any = {}) => ({
    siteId: site.id,
    warehouseId: site.warehouse_id,
    sourceType: "PURCHASE",
    supplierId: supplier.id,
    note: "Nhận hàng theo chứng từ giao hàng",
    lines: [
      { skuId: sku.id, unitId: unit.id, qty: "2", unitCostVnd: "240000" },
    ],
    ...overrides,
  });
  async function role(value: string) {
    member = await good(
      await api(owner, path("memberships/" + member.id), "PATCH", {
        role: value,
        status: "ACTIVE",
        siteIds: [site.id],
        version: member.version,
      }),
    );
  }
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    mkdirSync("tmp", { recursive: true });
    mkdirSync(evidence, { recursive: true });
    owner = await browser.newContext();
    staff = await browser.newContext();
    outsider = await browser.newContext();
    page = await owner.newPage();
    await Promise.all([
      login(page, 0),
      login(await staff.newPage(), 1),
      login(await outsider.newPage(), 2),
    ]);
    const previous = existsSync("tmp/week05-fixture.json")
      ? JSON.parse(readFileSync("tmp/week05-fixture.json", "utf8"))
      : null;
    if (previous) {
      tenant = previous.tenant;
      site = await good(await api(owner, path("sites/" + previous.site)));
      otherSite = await good(
        await api(owner, path("sites/" + previous.otherSite)),
      );
      member = (await good(await api(owner, path("memberships")))).find(
        (m: any) => m.subject_id === accounts[1].subject,
      );
    } else {
      const t = await good(
        await api(
          owner,
          "/v1/tenants",
          "POST",
          {
            name: "Cửa hàng An Mộc",
            site: {
              name: "An Mộc · Quận 7",
              code: "AM01",
              address: "TP. Hồ Chí Minh",
            },
          },
          randomUUID(),
        ),
      );
      tenant = t.tenantId;
      site = t.site;
      otherSite = await good(
        await command("sites", { name: "An Mộc · Quận 3", code: "AM02" }),
      );
      const invitation = await good(
        await api(owner, path("invitations"), "POST", {
          targetSubjectId: accounts[1].subject,
          role: "CASHIER",
          siteIds: [site.id],
          ownerConfirmed: true,
        }),
      );
      member = await good(
        await api(staff, "/v1/invitations/accept", "POST", {
          token: invitation.token,
        }),
      );
      writeFileSync(
        "tmp/week05-fixture.json",
        JSON.stringify({ tenant, site: site.id, otherSite: otherSite.id }),
      );
    }
    for (const id of [site.id, otherSite.id])
      await expect
        .poll(
          async () =>
            (await good(await api(owner, path("sites/" + id)))).status,
          { timeout: 45000 },
        )
        .toBe("ACTIVE");
    site = await good(await api(owner, path("sites/" + site.id)));
    await role("CASHIER");
  });
  test.afterAll(async () => {
    await Promise.all([
      owner?.close(),
      staff?.close(),
      outsider?.close(),
      inventory.end(),
      finance.end(),
      catalog.end(),
      gateway.end(),
    ]);
  });
  test("W5-01 Exact decimal arithmetic and invalid conversions", () => {
    expect(baseQuantity("2", "24.000")).toBe("48.000");
    expect(baseQuantity("0.125", "8")).toBe("1.000");
    expect(() => baseQuantity("0.001", "0.001")).toThrow();
    expect(lineCost("0.5", "1")).toBe("1");
    expect(lineCost("1", "9007199254740993")).toBe("9007199254740993");
  });
  test("W5-02 Catalog create is atomic, tenant-unique, idempotent and paginated", async () => {
    category = await good(
      await command("categories", { code: "DOUONG-" + run, name: "Đồ uống" }),
    );
    const body = {
        name: "Cà phê rang xay",
        categoryId: category.id,
        sku: {
          code: "CF-" + run,
          name: "Cà phê Arabica 250g",
          barcode: "BC-" + run,
          baseUnit: "Gói",
          priceVnd: "85000",
          attributes: { size: "250g" },
        },
      },
      key = randomUUID();
    const values = await Promise.all(
      (
        await Promise.all([
          command("products", body, "POST", owner, key),
          command("products", body, "POST", owner, key),
        ])
      ).map(good),
    );
    expect(values[0].id).toBe(values[1].id);
    product = values[0];
    sku = product.skus[0];
    expect(sku.units[0].factor).toBe("1.000");
    expect(sku.units[0].price_vnd).toBe("85000");
    expect((await command("products", body)).status()).toBe(409);
    expect(
      (
        await command("products", { ...body, name: "Khác" }, "POST", owner, key)
      ).status(),
    ).toBe(409);
    expect(
      (
        await command("products", {
          ...body,
          sku: { ...body.sku, code: "NEW-" + run, priceVnd: 1 },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await catalog.query(
          "SELECT count(*)::int AS n FROM products WHERE tenant_id=$1 AND name=$2",
          [tenant, body.name],
        )
      ).rows[0].n,
    ).toBeGreaterThanOrEqual(1);
    const list = await good(await api(owner, path("products?limit=1")));
    expect(list.items).toHaveLength(1);
    expect(list).toHaveProperty("nextCursor");
    expect(
      (
        await good(
          await api(
            owner,
            path("products?q=" + encodeURIComponent("BC-" + run)),
          ),
        )
      ).items[0].id,
    ).toBe(product.id);
  });
  test("W5-03 Units and prices keep exact values, versions and history", async () => {
    unit = await good(
      await command("skus/" + sku.id + "/units", {
        name: "Thùng",
        factor: "24",
        priceVnd: "1900000",
      }),
    );
    expect(unit.factor).toBe("24.000");
    expect(
      (
        await command("skus/" + sku.id + "/units", {
          name: "Sai",
          factor: "0",
          priceVnd: "0",
        })
      ).status(),
    ).toBe(400);
    const price = await good(
      await command(
        `skus/${sku.id}/units/${unit.id}`,
        { priceVnd: "1950000", status: "ACTIVE", version: unit.version },
        "PATCH",
      ),
    );
    expect(price.price_vnd).toBe("1950000");
    expect(
      (
        await command(
          `skus/${sku.id}/units/${unit.id}`,
          { priceVnd: "1", status: "ACTIVE", version: unit.version },
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    expect(
      (
        await command(
          `skus/${sku.id}/units/${unit.id}`,
          {
            priceVnd: "1",
            factor: "2",
            status: "ACTIVE",
            version: price.version,
          },
          "PATCH",
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await catalog.query(
          "SELECT count(*)::int AS n FROM price_history WHERE unit_id=$1",
          [unit.id],
        )
      ).rows[0].n,
    ).toBe(2);
  });
  test("W5-04 Supplier validation, current permissions, tenant and internal API isolation", async () => {
    supplier = await good(
      await command("suppliers", {
        code: "NCC-" + run,
        name: "Công ty Thực phẩm Minh An",
        phone: "0900000000",
        address: "TP. Hồ Chí Minh",
      }),
    );
    expect(
      (
        await command("suppliers", { code: supplier.code, name: "Trùng" })
      ).status(),
    ).toBe(409);
    expect((await api(outsider, path("products"), "GET")).status()).toBe(404);
    expect((await api(staff, path("suppliers"))).status()).toBe(403);
    expect(
      (
        await command(
          "categories",
          { code: "DENY", name: "Không hợp lệ" },
          "POST",
          staff,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await owner.request.post(path("suppliers"), {
          data: { name: "No CSRF" },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await api(owner, "/v1/internal/authorize", "POST", {})).status(),
    ).toBe(404);
    expect(
      docker(
        "exec",
        "-T",
        "catalog",
        "node",
        "-e",
        "fetch('http://localhost:4100/v1/internal/catalog/snapshots',{method:'POST',headers:{authorization:'Bearer forged','x-service-authorization':'forged','content-type':'application/json'},body:'{}'}).then(r=>console.log(r.status))",
      ).trim(),
    ).toBe("401");
  });
  test("W5-05 Draft uses authoritative snapshots and leaves stock and payable unchanged", async () => {
    receipt = await good(await command("receipts", draft()));
    expect(receipt.status).toBe("DRAFT");
    expect(receipt.total_vnd).toBe("480000");
    expect(receipt.lines[0].qty_base).toBe("48.000");
    expect(
      (
        await inventory.query(
          "SELECT * FROM stock_movements WHERE receipt_id=$1",
          [receipt.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
          receipt.id,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await command("receipts", { ...draft(), totalVnd: "1" })).status(),
    ).toBe(400);
    expect(
      (
        await command(
          "receipts",
          draft({
            lines: [
              {
                skuId: sku.id,
                unitId: randomUUID(),
                qty: "1",
                unitCostVnd: "1",
              },
            ],
          }),
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await command(
          "receipts",
          draft({ warehouseId: otherSite.warehouse_id }),
        )
      ).status(),
    ).toBe(403);
  });
  test("W5-06 Stock role drafts in scope but cannot post, see valuation or create opening stock", async () => {
    await role("STOCK");
    const d = await good(await command("receipts", draft(), "POST", staff));
    expect(
      (
        await command(
          "receipts/" + d.id + "/post",
          { version: d.version },
          "POST",
          staff,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await command(
          "receipts",
          draft({ sourceType: "OPENING_STOCK", supplierId: null }),
          "POST",
          staff,
        )
      ).status(),
    ).toBe(403);
    expect(
      (await api(staff, path("receipts?siteId=" + otherSite.id))).status(),
    ).toBe(404);
    expect(
      (
        await command(
          "receipts/" + receipt.id,
          { version: receipt.version, draft: draft() },
          "PATCH",
          staff,
        )
      ).status(),
    ).toBe(403);
    expect(
      (
        await command(
          "receipts/" + d.id + "/cancel",
          { version: d.version },
          "POST",
          staff,
        )
      ).status(),
    ).toBe(201);
  });
  test("W5-07 Concurrent post retries produce exactly one movement and payable", async () => {
    const key = randomUUID(),
      body = { version: receipt.version };
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        command(
          "receipts/" + receipt.id + "/post",
          body,
          "POST",
          owner,
          i < 3 ? key : randomUUID(),
        ),
      ),
    );
    const posted = await Promise.all(responses.map(good));
    expect(posted.every((r) => r.status === "POSTED")).toBe(true);
    receipt = posted[0];
    expect(
      (
        await inventory.query(
          "SELECT * FROM stock_movements WHERE receipt_id=$1",
          [receipt.id],
        )
      ).rowCount,
    ).toBe(1);
    const balances = await good(
      await api(
        owner,
        path(`stock-balances?siteId=${site.id}&skuId=${sku.id}`),
      ),
    );
    expect(balances.items[0]).toMatchObject({
      on_hand: "48.000",
      available: "48.000",
      inventory_value: "480000",
      avg_cost: "10000.000000",
    });
    await expect
      .poll(
        async () =>
          (
            await good(
              await api(
                owner,
                path(`payables?siteId=${site.id}&receiptId=${receipt.id}`),
              ),
            )
          ).items.length,
      )
      .toBe(1);
    expect(
      (
        await good(
          await api(
            owner,
            path(`payables?siteId=${site.id}&receiptId=${receipt.id}`),
          ),
        )
      ).items[0],
    ).toMatchObject({
      total_vnd: "480000",
      paid_vnd: "0",
      outstanding_vnd: "480000",
    });
    const limited = await good(
      await api(
        staff,
        path(`stock-balances?siteId=${site.id}&skuId=${sku.id}`),
      ),
    );
    expect(limited.items[0]).not.toHaveProperty("avg_cost");
    expect(limited.items[0]).not.toHaveProperty("inventory_value");
    expect(
      (await api(staff, path("payables?siteId=" + site.id))).status(),
    ).toBe(403);
  });
  test("W5-08 Finance outage does not roll back posted inventory; recovery catches up", async () => {
    const d = await good(
      await command(
        "receipts",
        draft({
          lines: [
            {
              skuId: sku.id,
              unitId: sku.units[0].id,
              qty: "48",
              unitCostVnd: "12000",
            },
          ],
        }),
      ),
    );
    docker("stop", "finance");
    try {
      const p = await good(
        await command("receipts/" + d.id + "/post", { version: d.version }),
      );
      expect(p.status).toBe("POSTED");
      expect(
        (await api(owner, path("payables?siteId=" + site.id))).status(),
      ).toBe(503);
      const b = (
        await good(
          await api(
            owner,
            path(`stock-balances?siteId=${site.id}&skuId=${sku.id}`),
          ),
        )
      ).items[0];
      expect(b).toMatchObject({
        on_hand: "96.000",
        inventory_value: "1056000",
        avg_cost: "11000.000000",
      });
    } finally {
      docker("start", "finance");
    }
    await expect
      .poll(
        async () => {
          const r = await api(
            owner,
            path(`payables?siteId=${site.id}&receiptId=${d.id}`),
          );
          return r.ok() ? (await r.json()).items.length : 0;
        },
        { timeout: 45000 },
      )
      .toBe(1);
  });
  test("W5-09 Event redelivery and business replay with a new event ID do not duplicate payable", async () => {
    const e = (
      await inventory.query(
        "SELECT payload FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1",
        [receipt.id],
      )
    ).rows[0].payload;
    const connection = await amqp.connect(
        `amqp://storeluma:${env.RABBIT_PASSWORD}@127.0.0.1:5673`,
      ),
      ch = await connection.createConfirmChannel(),
      barrier = { ...e, eventId: randomUUID() };
    for (const msg of [e, e, e, barrier])
      ch.publish("storeluma", e.eventType, Buffer.from(JSON.stringify(msg)), {
        persistent: true,
      });
    await ch.waitForConfirms();
    await connection.close();
    await expect
      .poll(
        async () =>
          (
            await finance.query("SELECT * FROM inbox WHERE id=$1", [
              barrier.eventId,
            ])
          ).rowCount,
      )
      .toBe(1);
    expect(
      (
        await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
          receipt.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
  test("W5-10 Opening stock changes value without creating debt", async () => {
    const d = await good(
      await command(
        "receipts",
        draft({
          sourceType: "OPENING_STOCK",
          supplierId: null,
          lines: [
            {
              skuId: sku.id,
              unitId: sku.units[0].id,
              qty: "1",
              unitCostVnd: "11000",
            },
          ],
        }),
      ),
    );
    await good(
      await command("receipts/" + d.id + "/post", { version: d.version }),
    );
    const event = (
      await inventory.query(
        "SELECT id FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1",
        [d.id],
      )
    ).rows[0];
    await expect
      .poll(
        async () =>
          (await finance.query("SELECT * FROM inbox WHERE id=$1", [event.id]))
            .rowCount,
      )
      .toBe(1);
    expect(
      (
        await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
          d.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  test("W5-11 Posted snapshots remain immutable after supplier, SKU and price edits", async () => {
    supplier = await good(
      await command(
        "suppliers/" + supplier.id,
        {
          name: "Minh An · Thực phẩm và đồ uống",
          phone: supplier.phone,
          address: supplier.address,
          status: "ACTIVE",
          version: supplier.version,
        },
        "PATCH",
      ),
    );
    sku = (
      await good(await api(owner, path("products/" + product.id)))
    ).skus.find((v: any) => v.id === sku.id);
    sku = await good(
      await command(
        "skus/" + sku.id,
        {
          name: "Cà phê Arabica nguyên chất 250g",
          barcode: sku.barcode,
          status: "ACTIVE",
          version: sku.version,
        },
        "PATCH",
      ),
    );
    const old = await good(await api(owner, path("receipts/" + receipt.id)));
    expect(old.supplier_name).toBe("Công ty Thực phẩm Minh An");
    expect(old.lines[0].sku_name).toBe("Cà phê Arabica 250g");
    expect(old.total_vnd).toBe("480000");
    expect(
      (
        await command(
          "receipts/" + receipt.id,
          { version: receipt.version, draft: draft() },
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    expect(
      (
        await command("receipts/" + receipt.id + "/cancel", {
          version: receipt.version,
        })
      ).status(),
    ).toBe(409);
  });
  test("W5-12 Inactive supplier, product, unit and suspended site block new business", async () => {
    const d = await good(await command("receipts", draft()));
    supplier = await good(
      await command(
        "suppliers/" + supplier.id,
        {
          name: supplier.name,
          phone: supplier.phone,
          address: supplier.address,
          status: "INACTIVE",
          version: supplier.version,
        },
        "PATCH",
      ),
    );
    expect(
      (
        await command("receipts/" + d.id + "/post", { version: d.version })
      ).status(),
    ).toBe(409);
    supplier = await good(
      await command(
        "suppliers/" + supplier.id,
        {
          name: supplier.name,
          phone: supplier.phone,
          address: supplier.address,
          status: "ACTIVE",
          version: supplier.version,
        },
        "PATCH",
      ),
    );
    product = await good(
      await command(
        "products/" + product.id,
        {
          name: product.name,
          categoryId: category.id,
          status: "INACTIVE",
          version: product.version,
        },
        "PATCH",
      ),
    );
    expect((await command("receipts", draft())).status()).toBe(404);
    product = await good(
      await command(
        "products/" + product.id,
        {
          name: product.name,
          categoryId: category.id,
          status: "ACTIVE",
          version: product.version,
        },
        "PATCH",
      ),
    );
    unit = (
      await good(await api(owner, path("products/" + product.id)))
    ).skus[0].units.find((u: any) => u.id === unit.id);
    unit = await good(
      await command(
        `skus/${sku.id}/units/${unit.id}`,
        { priceVnd: unit.price_vnd, status: "INACTIVE", version: unit.version },
        "PATCH",
      ),
    );
    expect((await command("receipts", draft())).status()).toBe(404);
    unit = await good(
      await command(
        `skus/${sku.id}/units/${unit.id}`,
        { priceVnd: unit.price_vnd, status: "ACTIVE", version: unit.version },
        "PATCH",
      ),
    );
    site = await good(
      await api(owner, path("sites/" + site.id), "PATCH", {
        name: site.name,
        address: site.address,
        status: "SUSPENDED",
        version: site.version,
      }),
    );
    expect((await command("receipts", draft())).status()).toBe(409);
    site = await good(
      await api(owner, path("sites/" + site.id), "PATCH", {
        name: site.name,
        address: site.address,
        status: "ACTIVE",
        version: site.version,
      }),
    );
  });
  test("W5-13 Stale draft edits and cancellation preserve stock", async () => {
    const d = await good(await command("receipts", draft())),
      edited = await good(
        await command(
          "receipts/" + d.id,
          { version: d.version, draft: draft({ note: "Đã kiểm đếm" }) },
          "PATCH",
        ),
      );
    expect(
      (
        await command(
          "receipts/" + d.id,
          { version: d.version, draft: draft() },
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    await good(
      await command("receipts/" + d.id + "/cancel", {
        version: edited.version,
      }),
    );
    expect(
      (
        await command("receipts/" + d.id + "/post", {
          version: edited.version + 1,
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await inventory.query(
          "SELECT * FROM stock_movements WHERE receipt_id=$1",
          [d.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  test("W5-14 Manager posts only assigned sites; accountant reads but cannot receive", async () => {
    await role("MANAGER");
    const d = await good(await command("receipts", draft(), "POST", staff));
    await good(
      await command(
        "receipts/" + d.id + "/post",
        { version: d.version },
        "POST",
        staff,
      ),
    );
    expect(
      (
        await command(
          "receipts",
          draft({ siteId: otherSite.id, warehouseId: otherSite.warehouse_id }),
          "POST",
          staff,
        )
      ).status(),
    ).toBe(404);
    await role("ACCOUNTANT");
    expect(
      (await api(staff, path("payables?siteId=" + site.id))).status(),
    ).toBe(200);
    expect((await command("receipts", draft(), "POST", staff)).status()).toBe(
      403,
    );
    expect(
      (
        await good(
          await api(
            staff,
            path(`stock-balances?siteId=${site.id}&skuId=${sku.id}`),
          ),
        )
      ).items[0],
    ).toHaveProperty("avg_cost");
    await role("CASHIER");
  });
  test("W5-15 Business outage fails closed; Catalog outage leaves draft unposted", async () => {
    docker("stop", "business");
    try {
      expect(
        (
          await command("categories", {
            code: "FAIL-" + run,
            name: "Không được lưu",
          })
        ).status(),
      ).toBe(503);
    } finally {
      docker("start", "business");
    }
    await expect
      .poll(async () => (await api(owner, path("products"))).status(), {
        timeout: 45000,
      })
      .toBe(200);
    const d = await good(await command("receipts", draft()));
    docker("stop", "catalog");
    try {
      expect(
        (
          await command("receipts/" + d.id + "/post", { version: d.version })
        ).status(),
      ).toBe(503);
      expect(
        (await good(await api(owner, path("receipts/" + d.id)))).status,
      ).toBe("DRAFT");
      expect(
        (
          await inventory.query(
            "SELECT * FROM stock_movements WHERE receipt_id=$1",
            [d.id],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      docker("start", "catalog");
    }
    await expect
      .poll(async () => (await api(owner, path("products"))).status(), {
        timeout: 45000,
      })
      .toBe(200);
  });
  test("W5-16 Real UI creates catalog, supplier and receipt, then posts it", async () => {
    await page.reload();
    await page
      .getByLabel("Chọn hộ kinh doanh", { exact: true })
      .selectOption(tenant);
    await page.getByRole("button", { name: "Hàng hóa", exact: true }).click();
    await page
      .getByRole("button", { name: "＋ Thêm sản phẩm", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Tên sản phẩm", { exact: true })
      .fill("Trà sen Tây Hồ");
    await dialog
      .getByLabel("Tên mã hàng", { exact: true })
      .fill("Trà sen hộp 100g");
    await dialog.getByLabel("Mã SKU", { exact: true }).fill("TRA-" + run);
    await dialog.getByLabel("Đơn vị cơ sở", { exact: true }).fill("Hộp");
    await dialog.getByLabel("Giá bán (₫)", { exact: true }).fill("125000");
    await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Trà sen Tây Hồ", exact: true }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: evidence + "/01-products.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Cà phê rang xay", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("button", { name: "＋ Thêm biến thể" }),
    ).toBeVisible();
    await page.screenshot({ path: evidence + "/02-units.png", fullPage: true });
    await page
      .getByRole("button", { name: "Nhà cung cấp", exact: true })
      .click();
    await page.getByRole("button", { name: "＋ Thêm nhà cung cấp" }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Tên nhà cung cấp", { exact: true })
      .fill("Trà Việt");
    await dialog
      .getByLabel("Mã nhà cung cấp", { exact: true })
      .fill("TV-" + run);
    await dialog.getByLabel("Điện thoại", { exact: true }).fill("0900000001");
    await dialog.getByRole("button", { name: "Lưu thay đổi" }).click();
    await expect(dialog).toHaveCount(0);
    await page.screenshot({
      path: evidence + "/03-suppliers.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Nhập hàng", exact: true }).click();
    await page.getByLabel("Địa điểm nhập hàng").selectOption(site.id);
    await page.getByRole("button", { name: "＋ Lập phiếu nhập" }).click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Nhà cung cấp", { exact: true })
      .selectOption({ label: "Trà Việt · TV-" + run });
    await dialog.getByLabel("Tìm mã hàng", { exact: true }).fill("TRA-" + run);
    await dialog
      .getByRole("button", { name: new RegExp("Trà sen hộp 100g.*TRA-" + run) })
      .click();
    await dialog
      .getByLabel("Số lượng Trà sen hộp 100g", { exact: true })
      .fill("10");
    await dialog
      .getByLabel("Đơn giá Trà sen hộp 100g", { exact: true })
      .fill("80000");
    await page.screenshot({
      path: evidence + "/04-receipt-form.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Lưu phiếu nháp" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByText("Phiếu nháp chưa làm tăng tồn kho.", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ghi sổ", exact: true }).click();
    await page
      .getByRole("button", { name: "Xác nhận ghi sổ", exact: true })
      .click();
    await expect(
      page.getByText("Đã cập nhật tồn kho", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Kiểm tra công nợ" }).click();
    await expect(
      page.getByText("Công nợ phải trả:", { exact: false }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence + "/05-posted.png",
      fullPage: true,
    });
  });
  test("W5-17 Narrow viewport has no page overflow and cashier has no receiving UI", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Hàng hóa", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Danh mục hàng hóa" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: evidence + "/06-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    const p = staff.pages()[0];
    await p.reload();
    await p
      .getByLabel("Chọn hộ kinh doanh", { exact: true })
      .selectOption(tenant);
    await expect(
      p.getByRole("button", { name: "Nhập hàng", exact: true }),
    ).toHaveCount(0);
    await p.getByRole("button", { name: "Hàng hóa", exact: true }).click();
    await expect(
      p.getByRole("button", { name: "＋ Thêm sản phẩm" }),
    ).toHaveCount(0);
  });
  test("W5-18 Local database isolation and schema ownership boundaries", async () => {
    for (const [source, target] of [
      ["catalog", "inventory"],
      ["inventory", "finance"],
      ["finance", "business"],
    ]) {
      const forbidden = new Pool({
        host: "127.0.0.1",
        port: 55432,
        user: source,
        password: env[`${source.toUpperCase()}_DB_PASSWORD`],
        database: target + "_db",
        connectionTimeoutMillis: 3000,
      });
      try {
        await expect(forbidden.query("SELECT 1")).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await forbidden.end();
      }
    }
    const tables = async (db: Pool) =>
      (
        await db.query(
          "SELECT tablename FROM pg_tables WHERE schemaname='public'",
        )
      ).rows.map((r) => r.tablename);
    expect(await tables(catalog)).not.toContain("stock_balances");
    expect(await tables(inventory)).not.toContain("payables");
    expect(await tables(finance)).not.toContain("receipt_lines");
    expect(await tables(finance)).not.toContain("cash_movements");
    await expect
      .poll(
        async () =>
          (
            await inventory.query(
              "SELECT version FROM sku_projection WHERE tenant_id=$1 AND sku_id=$2",
              [tenant, sku.id],
            )
          ).rows[0]?.version,
      )
      .toBe(
        (await catalog.query("SELECT version FROM skus WHERE id=$1", [sku.id]))
          .rows[0].version,
      );
  });
  test("W5-19 Valid actor JWT cannot impersonate an internal service", async () => {
    const cookie = (await owner.cookies()).find(
        (c) => c.name === "sl_session",
      )!,
      hash = createHash("sha256").update(cookie.value).digest("hex");
    const sealed = Buffer.from(
        (
          await gateway.query("SELECT sealed FROM sessions WHERE id_hash=$1", [
            hash,
          ])
        ).rows[0].sealed,
        "base64",
      ),
      decipher = createDecipheriv(
        "aes-256-gcm",
        Buffer.from(env.SESSION_KEY, "hex"),
        sealed.subarray(0, 12),
      );
    decipher.setAuthTag(sealed.subarray(12, 28));
    const session = JSON.parse(
      Buffer.concat([
        decipher.update(sealed.subarray(28)),
        decipher.final(),
      ]).toString(),
    );
    const script =
      "let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{const d=JSON.parse(input);const r=await fetch('http://business:4100/v1/internal/authorize',{method:'POST',headers:{authorization:'Bearer '+d.token,'x-service-authorization':'forged','content-type':'application/json'},body:JSON.stringify({tenantId:d.tenant,action:'catalog.write'})});console.log(r.status)});";
    const result = execFileSync(
      "docker",
      ["compose", "exec", "-T", "gateway", "node", "-e", script],
      {
        input: JSON.stringify({ token: session.accessToken, tenant }),
        encoding: "utf8",
        timeout: 10000,
      },
    );
    expect(result.trim()).toBe("403");
  });
  test("W5-20 Multi-line posting rolls back every stock write on precision overflow", async () => {
    const p = await good(
      await command("products", {
        name: "Kiểm tra giới hạn số",
        sku: {
          code: "LIMIT-" + run,
          name: "Hàng kiểm tra giới hạn",
          baseUnit: "Cái",
          priceVnd: "1",
        },
      }),
    );
    const d = await good(
      await command(
        "receipts",
        draft({
          lines: [
            { skuId: sku.id, unitId: unit.id, qty: "1", unitCostVnd: "1" },
            {
              skuId: p.skus[0].id,
              unitId: p.skus[0].units[0].id,
              qty: "1",
              unitCostVnd: "99999999999999999998",
            },
          ],
        }),
      ),
    );
    const old = (
      await inventory.query(
        "SELECT on_hand,inventory_value FROM stock_balances WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3",
        [tenant, site.warehouse_id, sku.id],
      )
    ).rows[0];
    expect(
      (
        await command("receipts/" + d.id + "/post", { version: d.version })
      ).status(),
    ).toBe(400);
    expect(
      (
        await inventory.query(
          "SELECT on_hand,inventory_value FROM stock_balances WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3",
          [tenant, site.warehouse_id, sku.id],
        )
      ).rows[0],
    ).toEqual(old);
    expect(
      (
        await inventory.query(
          "SELECT * FROM stock_movements WHERE receipt_id=$1",
          [d.id],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await good(await api(owner, path("receipts/" + d.id)))).status,
    ).toBe("DRAFT");
    await good(
      await command("receipts/" + d.id + "/cancel", { version: d.version }),
    );
    await good(
      await command(
        "products/" + p.id,
        {
          name: p.name,
          categoryId: null,
          status: "INACTIVE",
          version: p.version,
        },
        "PATCH",
      ),
    );
  });
  test("W5-21 Tenant-scoped codes and blocked membership are enforced on existing sessions", async () => {
    const me = await good(await api(outsider, "/v1/me"));
    let other = me.memberships.find((m: any) => m.role === "OWNER");
    if (!other) {
      const t = await good(
        await api(
          outsider,
          "/v1/tenants",
          "POST",
          {
            name: "Hộ đối chiếu phạm vi",
            site: { code: "CH01", name: "Cửa hàng" },
          },
          randomUUID(),
        ),
      );
      other = { tenant_id: t.tenantId };
    }
    await good(
      await api(
        outsider,
        `/v1/tenants/${other.tenant_id}/suppliers`,
        "POST",
        { code: supplier.code, name: "Nhà cung cấp hộ khác" },
        randomUUID(),
      ),
    );
    await good(
      await api(
        outsider,
        `/v1/tenants/${other.tenant_id}/products`,
        "POST",
        {
          name: "Sản phẩm hộ khác",
          sku: {
            code: sku.code,
            barcode: sku.barcode,
            name: "Mã hàng hộ khác",
            baseUnit: "Cái",
            priceVnd: "1",
          },
        },
        randomUUID(),
      ),
    );
    await role("STOCK");
    member = await good(
      await api(owner, path("memberships/" + member.id), "PATCH", {
        role: "STOCK",
        status: "BLOCKED",
        siteIds: [site.id],
        version: member.version,
      }),
    );
    expect((await api(staff, path("products"))).status()).toBe(403);
    expect((await command("receipts", draft(), "POST", staff)).status()).toBe(
      403,
    );
    await role("CASHIER");
  });
  test("W5-22 Reopened draft loads current units and saves the chosen conversion", async () => {
    const current = await good(await api(owner, path("skus/" + sku.id)));
    expect(current.units.some((u: any) => u.id === unit.id)).toBe(true);
    const other = (await good(await api(outsider, "/v1/me"))).memberships.find(
      (m: any) => m.role === "OWNER",
    );
    expect(
      (
        await api(outsider, `/v1/tenants/${other.tenant_id}/skus/${sku.id}`)
      ).status(),
    ).toBe(404);
    const d = await good(
      await command(
        "receipts",
        draft({
          lines: [
            {
              skuId: sku.id,
              unitId: current.units.find((u: any) => u.is_base).id,
              qty: "2",
              unitCostVnd: "120",
            },
          ],
        }),
      ),
    );
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await page
      .getByLabel("Chọn hộ kinh doanh", { exact: true })
      .selectOption(tenant);
    await page.getByRole("button", { name: "Nhập hàng", exact: true }).click();
    await page.getByLabel("Địa điểm nhập hàng").selectOption(site.id);
    await page.getByLabel("Tìm trong danh sách").fill(d.code);
    await page.getByRole("button", { name: d.code, exact: true }).click();
    await page.getByRole("button", { name: "Sửa phiếu", exact: true }).click();
    const dialog = page.getByRole("dialog"),
      select = dialog.getByLabel("Đơn vị " + current.name, { exact: true });
    await expect(select.locator("option")).toHaveCount(current.units.length);
    await select.selectOption(unit.id);
    await page.screenshot({
      path: evidence + "/07-edit-units.png",
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Lưu phiếu nháp" }).click();
    await expect(dialog).toHaveCount(0);
    const saved = await good(await api(owner, path("receipts/" + d.id)));
    expect(saved.lines[0].qty_base).toBe("48.000");
    expect(saved.lines[0].unit_id).toBe(unit.id);
    expect(
      (
        await inventory.query(
          "SELECT * FROM stock_movements WHERE receipt_id=$1",
          [d.id],
        )
      ).rowCount,
    ).toBe(0);
    await good(
      await command("receipts/" + d.id + "/cancel", { version: saved.version }),
    );
  });
  test("W5-23 Malformed and exhausted events are parked only in the failed service queue", async () => {
    const connection = await amqp.connect(
      `amqp://storeluma:${env.RABBIT_PASSWORD}@127.0.0.1:5673`,
    );
    const ch = await connection.createConfirmChannel();
    try {
      const probe = (await ch.assertQueue("", { exclusive: true })).queue;
      await ch.bindQueue(probe, "storeluma.dead", "");
      const before = (await ch.checkQueue("finance.dead")).messageCount;
      await publishConfirmed(ch, "", "finance", Buffer.from("{invalid"), {
        messageId: randomUUID(),
      });
      await expect
        .poll(async () => (await ch.checkQueue("finance.dead")).messageCount)
        .toBe(before + 1);
      const e = (
        await inventory.query(
          "SELECT payload FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1",
          [receipt.id],
        )
      ).rows[0].payload;
      const invalid = {
        ...e,
        eventId: randomUUID(),
        producer: "catalog-service",
      };
      await publishConfirmed(
        ch,
        "",
        "finance",
        Buffer.from(JSON.stringify(invalid)),
        { headers: { "x-retry-count": 4 } },
      );
      await expect
        .poll(async () => (await ch.checkQueue("finance.dead")).messageCount, {
          timeout: 20000,
        })
        .toBe(before + 2);
      expect((await ch.checkQueue(probe)).messageCount).toBe(0);
      expect(
        (
          await finance.query("SELECT * FROM inbox WHERE id=$1", [
            invalid.eventId,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await connection.close();
    }
  });
  test("W5-24 Missing route keeps Outbox pending; confirm timeout releases listeners", async () => {
    const stalled = new EventEmitter() as any;
    stalled.publish = () => true;
    await expect(
      publishConfirmed(stalled, "", "missing", Buffer.from("x"), {}, 30),
    ).rejects.toThrow("timed out");
    expect(
      stalled.listenerCount("return") + stalled.listenerCount("close"),
    ).toBe(0);
    const connection = await amqp.connect(
        `amqp://storeluma:${env.RABBIT_PASSWORD}@127.0.0.1:5673`,
      ),
      ch = await connection.createConfirmChannel();
    let d: any;
    try {
      await expect(
        publishConfirmed(ch, "", "missing-" + randomUUID(), Buffer.from("x")),
      ).rejects.toThrow("no route");
      await ch.unbindQueue(
        "finance",
        "storeluma",
        "inventory.receipt-posted.v1",
      );
      d = await good(await command("receipts", draft()));
      await good(
        await command("receipts/" + d.id + "/post", { version: d.version }),
      );
      await expect
        .poll(
          async () =>
            (
              await inventory.query(
                "SELECT lease_until < now()+interval '13 seconds' AND delivered_at IS NULL AS pending FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1",
                [d.id],
              )
            ).rows[0]?.pending,
        )
        .toBe(true);
      expect(
        (
          await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
            d.id,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await ch.bindQueue("finance", "storeluma", "inventory.receipt-posted.v1");
      await connection.close();
    }
    await expect
      .poll(
        async () =>
          (
            await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
              d.id,
            ])
          ).rowCount,
        { timeout: 30000 },
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await inventory.query(
              "SELECT delivered_at IS NOT NULL AS delivered FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1",
              [d.id],
            )
          ).rows[0]?.delivered,
      )
      .toBe(true);
  });
  test("W5-25 Broker outage retains committed receipt and reconnect delivers once", async () => {
    let d: any;
    try {
      docker("stop", "rabbitmq");
      d = await good(await command("receipts", draft()));
      await good(
        await command("receipts/" + d.id + "/post", { version: d.version }),
      );
      expect(
        (
          await inventory.query(
            "SELECT * FROM stock_movements WHERE receipt_id=$1",
            [d.id],
          )
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
            d.id,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (
          await inventory.query(
            "SELECT delivered_at FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1",
            [d.id],
          )
        ).rows[0].delivered_at,
      ).toBeNull();
    } finally {
      docker("start", "rabbitmq");
    }
    await expect
      .poll(
        async () =>
          (
            await finance.query("SELECT * FROM payables WHERE receipt_id=$1", [
              d.id,
            ])
          ).rowCount,
        { timeout: 45000 },
      )
      .toBe(1);
    expect(
      (
        await inventory.query(
          "SELECT * FROM stock_movements WHERE receipt_id=$1",
          [d.id],
        )
      ).rowCount,
    ).toBe(1);
  });
});
