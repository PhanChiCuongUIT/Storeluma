import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type APIResponse,
} from "@playwright/test";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { fillFreshTotp } from "./helpers/totp";
const accounts = JSON.parse(
  readFileSync("infra/generated/accounts.json", "utf8"),
);
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((x) => x.includes("="))
    .map((x) => [x.slice(0, x.indexOf("=")), x.slice(x.indexOf("=") + 1)]),
);
const pool = (s: string) =>
  new Pool({
    host: "127.0.0.1",
    port: 55432,
    user: s,
    password: env[s.toUpperCase() + "_DB_PASSWORD"],
    database: s + "_db",
    max: 3,
  });
const inventory = pool("inventory"),
  finance = pool("finance");
const evidence = process.env.WEEK06_SCREENSHOTS ?? "tmp/week06/screenshots";
async function good(r: APIResponse) {
  expect(r.status(), await r.text()).toBeLessThan(300);
  return r.json();
}
async function login(p: Page, i: number) {
  await p.goto("/auth/login");
  await p.locator("#username").fill(accounts[i].username);
  await p.locator("#password").fill(accounts[i].password);
  await p.locator("#kc-login").click();
  await fillFreshTotp(p, accounts[i].otpSecret);
  await p.locator("#kc-login").click();
  await expect(p).toHaveURL("http://localhost:4100/");
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
      origin: "http://localhost:4100",
      "x-csrf-token": s.csrf ?? "",
      ...(key ? { "idempotency-key": key } : {}),
    },
  });
}
test.describe
  .serial("Week 6 stock ledger, counts and adjustments - live services", () => {
  let owner: BrowserContext,
    staff: BrowserContext,
    outsider: BrowserContext,
    page: Page,
    tenant: string,
    site: any,
    otherSite: any,
    member: any,
    sku: any,
    count: any;
  const run = Date.now().toString(36).toUpperCase();
  let sequence = 0;
  const path = (s: string) => `/v1/tenants/${tenant}/${s}`;
  const get = (s: string, ctx = owner) => api(ctx, path(s));
  const cmd = (
    s: string,
    b: any,
    ctx = owner,
    key = randomUUID(),
    method = "POST",
  ) => api(ctx, path(s), method, b, key);
  const res = (d: any) =>
    d.kind === "COUNT" ? "stock-counts" : "stock-adjustments";
  const transition = async (d: any, a: string, ctx = owner) =>
    good(await cmd(`${res(d)}/${d.id}/${a}`, { version: d.version }, ctx));
  const balance = async (s = sku, at = site) =>
    (await good(await get(`stock-balances?siteId=${at.id}&skuId=${s.id}`)))
      .items[0];
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
  async function product(name = "Trà ô long 100g") {
    const p = await good(
      await cmd("products", {
        name,
        categoryId: null,
        sku: {
          code: `K6-${run}-${++sequence}`,
          name,
          baseUnit: "Hộp",
          priceVnd: "85000",
          attributes: {},
        },
      }),
    );
    return p.skus[0];
  }
  async function receipt(s = sku, qty = "100", at = site, cost = "10000") {
    const d = await good(
      await cmd("receipts", {
        siteId: at.id,
        warehouseId: at.warehouse_id,
        sourceType: "OPENING_STOCK",
        supplierId: null,
        note: "Ghi nhận số lượng ban đầu",
        lines: [{ skuId: s.id, unitId: s.units[0].id, qty, unitCostVnd: cost }],
      }),
    );
    return d;
  }
  async function seed(s: any, qty = "100", cost = "10000") {
    const d = await receipt(s, qty, site, cost);
    await good(await cmd(`receipts/${d.id}/post`, { version: d.version }));
  }
  async function createCount(skus = [sku], ctx = owner, at = site) {
    return good(
      await cmd(
        "stock-counts",
        {
          siteId: at.id,
          warehouseId: at.warehouse_id,
          note: "Đối chiếu số lượng thực tế",
          lines: skus.map((s) => ({ skuId: s.id })),
        },
        ctx,
      ),
    );
  }
  async function record(d: any, values: any[], ctx = owner) {
    return good(
      await cmd(
        `stock-counts/${d.id}/lines`,
        {
          version: d.version,
          note: "Kiểm đếm thực tế, xác nhận chênh lệch",
          lines: values,
        },
        ctx,
        randomUUID(),
        "PATCH",
      ),
    );
  }
  async function adjust(
    type: string,
    qty: string,
    s = sku,
    extra: any = {},
    ctx = owner,
  ) {
    return good(
      await cmd(
        "stock-adjustments",
        {
          siteId: site.id,
          warehouseId: site.warehouse_id,
          note: "Xác nhận điều chỉnh theo thực tế",
          adjustmentType: type,
          lines: [{ skuId: s.id, qty, ...extra }],
        },
        ctx,
      ),
    );
  }
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
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
    const fixturePath = existsSync("tmp/week05-fixture.json")
      ? "tmp/week05-fixture.json"
      : "tmp/week06-fixture.json";
    if (existsSync(fixturePath)) {
      const f = JSON.parse(readFileSync(fixturePath, "utf8"));
      tenant = f.tenant;
      site = await good(await get("sites/" + f.site));
      otherSite = await good(await get("sites/" + f.otherSite));
      member = (await good(await get("memberships"))).find(
        (m: any) => m.subject_id === accounts[1].subject,
      );
    } else {
      const t = await good(
        await api(
          owner,
          "/v1/tenants",
          "POST",
          {
            name: "Hộ An Mộc",
            site: { name: "Cửa hàng Trung Tâm", code: "AM01" },
          },
          randomUUID(),
        ),
      );
      tenant = t.tenantId;
      site = t.site;
      otherSite = await good(
        await cmd("sites", { name: "Cửa hàng Phú Mỹ", code: "AM02" }),
      );
      const invitation = await good(
        await api(owner, path("invitations"), "POST", {
          targetSubjectId: accounts[1].subject,
          role: "STOCK",
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
        "tmp/week06-fixture.json",
        JSON.stringify({ tenant, site: site.id, otherSite: otherSite.id }),
      );
    }
    for (const id of [site.id, otherSite.id])
      await expect
        .poll(async () => (await good(await get("sites/" + id))).status, {
          timeout: 45000,
        })
        .toBe("ACTIVE");
    site = await good(await get("sites/" + site.id));
    await role("STOCK");
    sku = await product();
    await seed(sku);
  });
  test.afterAll(async () => {
    await Promise.all([
      owner?.close(),
      staff?.close(),
      outsider?.close(),
      inventory.end(),
      finance.end(),
    ]);
  });
  test("W6-01 Receipt history retains source identity and exact before/after values", async () => {
    const m = (
      await inventory.query(
        "SELECT * FROM stock_movements WHERE tenant_id=$1 AND sku_id=$2",
        [tenant, sku.id],
      )
    ).rows;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      document_type: "RECEIPT",
      on_hand_before: "0.000",
      on_hand_after: "100.000",
      value_after: "1000000",
      reconstructed: false,
    });
    expect(m[0].document_id).toBe(m[0].receipt_id);
    expect(
      (
        await inventory.query(
          "SELECT 1 FROM stock_movements WHERE on_hand_after-on_hand_before<>qty_base OR value_after-value_before<>value_vnd",
        )
      ).rowCount,
    ).toBe(0);
  });
  test("W6-02 Quantity access, document roles and cost redaction apply at API boundary", async () => {
    await role("CASHIER");
    const b = await good(
      await get(`stock-balances?siteId=${site.id}&skuId=${sku.id}`, staff),
    );
    expect(b.items[0].available).toBe("100.000");
    expect(b.items[0]).not.toHaveProperty("inventory_value");
    expect(b.items[0]).not.toHaveProperty("avg_cost");
    const m = await good(
      await get(`stock-movements?siteId=${site.id}&skuId=${sku.id}`, staff),
    );
    expect(m.items[0].canOpenSource).toBe(false);
    for (const k of ["value_before", "value_after", "value_vnd"])
      expect(m.items[0]).not.toHaveProperty(k);
    expect((await get(`stock-counts?siteId=${site.id}`, staff)).status()).toBe(
      403,
    );
    expect(
      (await get(`stock-balances?siteId=${otherSite.id}`, staff)).status(),
    ).toBe(404);
    expect(
      (await get(`stock-balances?siteId=${site.id}`, outsider)).status(),
    ).toBe(404);
    await role("STOCK");
  });
  test("W6-03 Draft validation, tenant ownership and idempotency do not change stock", async () => {
    const b = {
        siteId: site.id,
        warehouseId: site.warehouse_id,
        note: "Kiểm định kỳ cuối tháng",
        lines: [{ skuId: sku.id }],
      },
      key = randomUUID();
    const [a, c] = await Promise.all([
      cmd("stock-counts", b, staff, key).then(good),
      cmd("stock-counts", b, staff, key).then(good),
    ]);
    expect(a.id).toBe(c.id);
    count = a;
    expect(
      (
        await cmd(
          "stock-counts",
          { ...b, note: "Lý do đã thay đổi" },
          staff,
          key,
        )
      ).status(),
    ).toBe(409);
    expect(
      (
        await cmd(
          "stock-counts",
          { ...b, lines: [...b.lines, ...b.lines] },
          staff,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await cmd(
          "stock-counts",
          { ...b, lines: [{ skuId: randomUUID() }] },
          staff,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await cmd(
          "stock-counts",
          { ...b, warehouseId: otherSite.warehouse_id },
          staff,
        )
      ).status(),
    ).toBe(404);
    expect((await balance()).on_hand).toBe("100.000");
    expect(
      (
        await inventory.query(
          "SELECT 1 FROM stock_freezes WHERE document_id=$1",
          [count.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  test("W6-04 Starting a count atomically snapshots and freezes only its scope", async () => {
    count = await transition(count, "start", staff);
    expect(count.status).toBe("COUNTING");
    expect(count.lines[0].snapshot_on_hand).toBe("100.000");
    expect((await balance()).frozen_by).toBe(count.id);
    const other = await createCount();
    expect(
      (
        await cmd(`stock-counts/${other.id}/start`, { version: other.version })
      ).status(),
    ).toBe(409);
    await transition(other, "cancel");
    const r = await receipt(sku, "1", otherSite);
    expect(
      (await good(await cmd(`receipts/${r.id}/post`, { version: r.version })))
        .status,
    ).toBe("POSTED");
  });
  test("W6-05 Receipts and adjustments both reject a frozen SKU without partial writes", async () => {
    const r = await receipt(sku, "2");
    const rejected = await cmd(`receipts/${r.id}/post`, { version: r.version });
    expect(rejected.status()).toBe(409);
    expect(await rejected.text()).toContain("STOCK_FROZEN");
    const a = await adjust("QUARANTINE", "2");
    expect(
      (
        await cmd(`stock-adjustments/${a.id}/post`, { version: a.version })
      ).status(),
    ).toBe(409);
    await transition(a, "cancel");
    expect(
      (
        await inventory.query(
          "SELECT 1 FROM stock_movements WHERE document_id=ANY($1::uuid[])",
          [[r.id, a.id]],
        )
      ).rowCount,
    ).toBe(0);
    expect((await balance()).on_hand).toBe("100.000");
  });
  test("W6-06 Count lines require exact scope, complete nonnegative quantities and current version", async () => {
    expect(
      (
        await cmd(
          `stock-counts/${count.id}/submit`,
          { version: count.version },
          staff,
        )
      ).status(),
    ).toBe(409);
    const body = {
      version: count.version,
      note: "Kiểm đếm hàng thực tế",
      lines: [{ skuId: sku.id, good: "-1", quarantined: "0" }],
    };
    expect(
      (
        await cmd(
          `stock-counts/${count.id}/lines`,
          body,
          staff,
          randomUUID(),
          "PATCH",
        )
      ).status(),
    ).toBe(400);
    const old = count;
    count = await record(
      count,
      [{ skuId: sku.id, good: "95", quarantined: "2" }],
      staff,
    );
    expect(count.lines[0].counted_good).toBe("95.000");
    expect(
      (
        await cmd(
          `stock-counts/${count.id}/lines`,
          {
            ...body,
            version: old.version,
            lines: [{ skuId: sku.id, good: "97", quarantined: "0" }],
          },
          staff,
          randomUUID(),
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    expect((await balance()).on_hand).toBe("100.000");
  });
  test("W6-07 Submit and concurrent approval write one delta, release freeze and emit stock only", async () => {
    count = await transition(count, "submit", staff);
    expect(
      (
        await cmd(
          `stock-counts/${count.id}/approve`,
          { version: count.version },
          staff,
        )
      ).status(),
    ).toBe(403);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        cmd(`stock-counts/${count.id}/approve`, {
          version: count.version,
        }).then(good),
      ),
    );
    expect(responses.every((d) => d.status === "POSTED")).toBe(true);
    count = responses[0];
    expect(await balance()).toMatchObject({
      on_hand: "97.000",
      quarantined: "2.000",
      available: "95.000",
      inventory_value: "970000",
      frozen_by: null,
    });
    const m = (
      await inventory.query(
        "SELECT * FROM stock_movements WHERE document_id=$1",
        [count.id],
      )
    ).rows;
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      document_type: "COUNT",
      qty_base: "-3.000",
      value_vnd: "-30000",
    });
    expect(
      (
        await inventory.query(
          "SELECT 1 FROM outbox WHERE payload->>'correlationId'=$1 AND type='inventory.stock-changed.v1'",
          [count.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (
        await finance.query("SELECT 1 FROM payables WHERE receipt_id=$1", [
          count.id,
        ])
      ).rowCount,
    ).toBe(0);
  });
  test("W6-08 Posted counts cannot be edited, cancelled or reused to change stock", async () => {
    expect(
      (
        await cmd(`stock-counts/${count.id}/cancel`, { version: count.version })
      ).status(),
    ).toBe(409);
    expect(
      (
        await cmd(
          `stock-counts/${count.id}/lines`,
          {
            version: count.version,
            note: "Cố sửa phiếu đã duyệt",
            lines: [{ skuId: sku.id, good: "100", quarantined: "0" }],
          },
          owner,
          randomUUID(),
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    await role("MANAGER");
    const d = await good(await get(`stock-counts/${count.id}`, staff));
    expect(d.lines[0]).not.toHaveProperty("value_delta");
    expect(d.lines[0]).not.toHaveProperty("unit_cost_vnd");
    await role("STOCK");
  });
  test("W6-09 Cancellation releases scope and is allowed after site suspension", async () => {
    const d = await transition(await createCount([sku], staff), "start", staff),
      before = await balance();
    let s = await good(await get("sites/" + site.id));
    s = await good(
      await api(owner, path("sites/" + site.id), "PATCH", {
        name: s.name,
        address: s.address,
        status: "SUSPENDED",
        version: s.version,
      }),
    );
    try {
      expect(
        (
          await cmd(
            `stock-counts/${d.id}/lines`,
            {
              version: d.version,
              note: "Đếm khi đã ngừng hoạt động",
              lines: [{ skuId: sku.id, good: "1", quarantined: "0" }],
            },
            staff,
            randomUUID(),
            "PATCH",
          )
        ).status(),
      ).toBe(403);
      const cancelled = await transition(d, "cancel", staff);
      expect(cancelled.status).toBe("CANCELLED");
      expect(await balance()).toMatchObject({
        on_hand: before.on_hand,
        inventory_value: before.inventory_value,
        frozen_by: null,
      });
    } finally {
      await good(
        await api(owner, path("sites/" + site.id), "PATCH", {
          name: s.name,
          address: s.address,
          status: "ACTIVE",
          version: s.version,
        }),
      );
    }
  });
  test("W6-10 Two starts and a receipt/start race serialize even for a new balance", async () => {
    const s = await product("Bánh hạt điều 150g"),
      a = await createCount([s]),
      b = await createCount([s]);
    const starts = await Promise.all([
      cmd(`stock-counts/${a.id}/start`, { version: a.version }),
      cmd(`stock-counts/${b.id}/start`, { version: b.version }),
    ]);
    expect(starts.map((r) => r.status()).sort()).toEqual([201, 409]);
    const winner = await good(starts.find((r) => r.ok())!);
    await transition(winner, "cancel");
    const pending = await receipt(s, "10"),
      c = await createCount([s]);
    const [posted, started] = await Promise.all([
      cmd(`receipts/${pending.id}/post`, { version: pending.version }),
      cmd(`stock-counts/${c.id}/start`, { version: c.version }),
    ]);
    const d = await good(started);
    expect([201, 409]).toContain(posted.status());
    expect(d.lines[0].snapshot_on_hand).toBe(posted.ok() ? "10.000" : "0.000");
    expect((await balance(s)).frozen_by).toBe(c.id);
    await transition(d, "cancel");
  });
  test("W6-11 Count from zero requires approved cost and supports recount before approval", async () => {
    const s = await product("Mật ong hoa nhãn 250ml");
    let d = await transition(await createCount([s]), "start");
    d = await record(d, [{ skuId: s.id, good: "2", quarantined: "0" }]);
    d = await transition(d, "submit");
    expect(
      (
        await cmd(`stock-counts/${d.id}/approve`, { version: d.version })
      ).status(),
    ).toBe(409);
    d = await transition(d, "reopen");
    expect((await balance(s)).frozen_by).toBe(d.id);
    d = await record(d, [
      { skuId: s.id, good: "2", quarantined: "0", unitCostVnd: "45000" },
    ]);
    d = await transition(d, "submit");
    d = await transition(d, "approve");
    expect(await balance(s)).toMatchObject({
      on_hand: "2.000",
      inventory_value: "90000",
      avg_cost: "45000.000000",
    });
  });
  test("W6-12 Quarantine, release and write-offs preserve buckets and valuation", async () => {
    const s = await product("Bánh quy bơ 200g");
    await seed(s, "10");
    await transition(await adjust("QUARANTINE", "3", s), "post");
    expect(await balance(s)).toMatchObject({
      on_hand: "10.000",
      quarantined: "3.000",
      inventory_value: "100000",
      available: "7.000",
    });
    expect(
      (
        await cmd("stock-adjustments", {
          siteId: site.id,
          warehouseId: site.warehouse_id,
          note: "Giải phóng hàng cách ly",
          adjustmentType: "RELEASE_QUARANTINE",
          lines: [{ skuId: s.id, qty: "1" }],
        })
      ).status(),
    ).toBe(400);
    await transition(
      await adjust("RELEASE_QUARANTINE", "1", s, { qualityConfirmed: true }),
      "post",
    );
    await transition(await adjust("WRITE_OFF_QUARANTINE", "2", s), "post");
    await transition(await adjust("WRITE_OFF_GOOD", "1", s), "post");
    expect(await balance(s)).toMatchObject({
      on_hand: "7.000",
      quarantined: "0.000",
      inventory_value: "70000",
    });
    const invalid = await adjust("WRITE_OFF_QUARANTINE", "1", s);
    expect(
      (
        await cmd(`stock-adjustments/${invalid.id}/post`, {
          version: invalid.version,
        })
      ).status(),
    ).toBe(409);
    await transition(invalid, "cancel");
  });
  test("W6-13 Reserved-stock fixture blocks count and overdraw without claiming a sales flow", async () => {
    const s = await product("Hạt điều rang 100g");
    await seed(s, "5");
    await inventory.query(
      "UPDATE stock_balances SET reserved=4 WHERE tenant_id=$1 AND sku_id=$2",
      [tenant, s.id],
    );
    try {
      const d = await createCount([s]);
      expect(
        (
          await cmd(`stock-counts/${d.id}/start`, { version: d.version })
        ).status(),
      ).toBe(409);
      await transition(d, "cancel");
      for (const type of ["WRITE_OFF_GOOD", "QUARANTINE"]) {
        const a = await adjust(type, "2", s);
        expect(
          (
            await cmd(`stock-adjustments/${a.id}/post`, { version: a.version })
          ).status(),
        ).toBe(409);
        await transition(a, "cancel");
      }
    } finally {
      await inventory.query(
        "UPDATE stock_balances SET reserved=0 WHERE tenant_id=$1 AND sku_id=$2",
        [tenant, s.id],
      );
    }
  });
  test("W6-14 Corrections use exact weighted value and zero residual on full depletion", async () => {
    const s = await product("Trà gừng 20 túi");
    let a = await adjust("CORRECTION", "3", s, { direction: "INCREASE" });
    expect(
      (
        await cmd(`stock-adjustments/${a.id}/post`, { version: a.version })
      ).status(),
    ).toBe(409);
    a = await good(
      await cmd(
        `stock-adjustments/${a.id}/lines`,
        {
          version: a.version,
          note: "Bổ sung giá vốn đã xác nhận",
          lines: [
            {
              skuId: s.id,
              qty: "3",
              direction: "INCREASE",
              unitCostVnd: "10001",
            },
          ],
        },
        owner,
        randomUUID(),
        "PATCH",
      ),
    );
    await transition(a, "post");
    await transition(
      await adjust("CORRECTION", "2", s, {
        direction: "INCREASE",
        unitCostVnd: "20000",
      }),
      "post",
    );
    expect(await balance(s)).toMatchObject({
      on_hand: "5.000",
      inventory_value: "70003",
      avg_cost: "14000.600000",
    });
    await transition(
      await adjust("CORRECTION", "1", s, { direction: "DECREASE" }),
      "post",
    );
    expect((await balance(s)).inventory_value).toBe("56002");
    await transition(await adjust("WRITE_OFF_GOOD", "4", s), "post");
    expect(await balance(s)).toMatchObject({
      on_hand: "0.000",
      inventory_value: "0",
      avg_cost: "0.000000",
    });
  });
  test("W6-15 Staff edits only own drafts; manager approves only assigned site; accountant reads costs", async () => {
    const a = await adjust("QUARANTINE", "1", sku, {}, staff),
      edit = {
        version: a.version,
        note: "Chỉnh lại số lượng thực tế",
        lines: [{ skuId: sku.id, qty: "2" }],
      };
    const changed = await good(
      await cmd(
        `stock-adjustments/${a.id}/lines`,
        edit,
        staff,
        randomUUID(),
        "PATCH",
      ),
    );
    expect(changed.lines[0].qty).toBe("2.000");
    expect(
      (
        await cmd(
          `stock-adjustments/${a.id}/post`,
          { version: changed.version },
          staff,
        )
      ).status(),
    ).toBe(403);
    const owned = await createCount();
    expect(
      (
        await cmd(
          `stock-counts/${owned.id}/start`,
          { version: owned.version },
          staff,
        )
      ).status(),
    ).toBe(403);
    await transition(owned, "cancel");
    await role("MANAGER");
    await transition(changed, "post", staff);
    const other = await createCount([sku], owner, otherSite);
    expect(
      (
        await cmd(
          `stock-counts/${other.id}/start`,
          { version: other.version },
          staff,
        )
      ).status(),
    ).toBe(404);
    await transition(other, "cancel");
    await role("ACCOUNTANT");
    expect(
      (
        await good(
          await get(`stock-movements?siteId=${site.id}&skuId=${sku.id}`, staff),
        )
      ).items[0],
    ).toHaveProperty("value_vnd");
    expect(
      (
        await cmd(
          "stock-counts",
          {
            siteId: site.id,
            warehouseId: site.warehouse_id,
            note: "Không được tạo phiếu",
            lines: [{ skuId: sku.id }],
          },
          staff,
        )
      ).status(),
    ).toBe(403);
    await role("STOCK");
  });
  test("W6-16 Movement filters and stable cursor do not duplicate rows or cross warehouses", async () => {
    let cursor: string | null = null;
    const ids: string[] = [];
    do {
      const d = await good(
        await get(
          `stock-movements?siteId=${site.id}&skuId=${sku.id}&limit=1${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
        ),
      );
      ids.push(...d.items.map((m: any) => m.id));
      expect(
        d.items.every((m: any) => m.warehouse_id === site.warehouse_id),
      ).toBe(true);
      cursor = d.nextCursor;
    } while (cursor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(
      (
        await inventory.query(
          "SELECT 1 FROM stock_movements WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3",
          [tenant, site.warehouse_id, sku.id],
        )
      ).rowCount,
    );
    const counts = await good(
      await get(`stock-movements?siteId=${site.id}&type=COUNT&q=${count.code}`),
    );
    expect(counts.items).toHaveLength(1);
    expect(counts.items[0].document_id).toBe(count.id);
    expect(
      (
        await good(
          await get(
            `stock-movements?siteId=${site.id}&from=2099-01-01T00:00:00Z`,
          ),
        )
      ).items,
    ).toHaveLength(0);
    expect(
      (await get(`stock-movements?siteId=${site.id}&cursor=garbage`)).status(),
    ).toBe(400);
  });
  test("W6-17 Multi-line failure rolls back every balance, movement, audit and freeze release", async () => {
    const s = await product("Cà phê hòa tan 12 gói");
    await seed(s, "1");
    const ids = [sku, s].sort((a, b) => a.id.localeCompare(b.id));
    const before = await Promise.all(ids.map((s) => balance(s)));
    const d = await good(
      await cmd("stock-adjustments", {
        siteId: site.id,
        warehouseId: site.warehouse_id,
        note: "Kiểm tra hoàn tác toàn phiếu",
        adjustmentType: "CORRECTION",
        lines: ids.map((s, i) => ({
          skuId: s.id,
          qty: i === 1 ? "999999999999999.999" : "1",
          direction: "INCREASE",
          unitCostVnd: i === 1 ? "99999999999999999999" : "1",
        })),
      }),
    );
    expect(
      (
        await cmd(`stock-adjustments/${d.id}/post`, { version: d.version })
      ).status(),
    ).toBe(400);
    for (let i = 0; i < ids.length; i++)
      expect(await balance(ids[i])).toMatchObject({
        on_hand: before[i].on_hand,
        inventory_value: before[i].inventory_value,
        version: before[i].version,
      });
    expect(
      (
        await inventory.query(
          "SELECT 1 FROM stock_movements WHERE document_id=$1",
          [d.id],
        )
      ).rowCount,
    ).toBe(0);
    await transition(d, "cancel");
  });
  test("W6-18 Freeze survives Inventory restart and cancellation allows a pending receipt", async () => {
    const d = await transition(await createCount(), "start");
    const r = await receipt(sku, "1");
    execFileSync("docker", ["compose", "restart", "inventory"], {
      stdio: "pipe",
      timeout: 60000,
    });
    await expect
      .poll(async () => (await get(`stock-counts/${d.id}`)).status(), {
        timeout: 45000,
      })
      .toBe(200);
    expect(
      (await cmd(`receipts/${r.id}/post`, { version: r.version })).status(),
    ).toBe(409);
    await transition(d, "cancel");
    expect(
      (await good(await cmd(`receipts/${r.id}/post`, { version: r.version })))
        .status,
    ).toBe("POSTED");
  });
  test("W6-19 Real UI creates, counts, submits and approves a document with source navigation", async () => {
    const s = await product("Trà sen hộp 100g");
    await seed(s, "20", "80000");
    page.on("dialog", (d) => d.accept());
    await page.reload();
    await page
      .getByLabel("Chọn hộ kinh doanh", { exact: true })
      .selectOption(tenant);
    await page.getByRole("button", { name: "Kho hàng", exact: true }).click();
    await page.getByLabel("Địa điểm kho").selectOption(site.id);
    await page.getByRole("tab", { name: "Kiểm kho", exact: true }).click();
    await page
      .getByRole("button", { name: "＋ Tạo phiếu kiểm", exact: true })
      .click();
    await page.getByLabel("Tìm mã hàng để chọn").fill(s.code);
    await page.getByRole("button", { name: new RegExp(s.code) }).click();
    await page
      .getByLabel("Lý do phiếu kho")
      .fill("Kiểm đếm cuối tháng tại quầy");
    await page.screenshot({
      path: evidence + "/count-draft.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Lưu phiếu nháp", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Bắt đầu kiểm", exact: true })
      .click();
    await page.getByLabel("Hàng tốt " + s.code, { exact: true }).fill("18");
    await page.getByLabel("Cách ly " + s.code, { exact: true }).fill("1");
    await page
      .getByLabel("Kết quả đối chiếu")
      .fill("Thiếu một hộp, một hộp rách vỏ được cách ly");
    await page.getByRole("button", { name: "Lưu số đếm", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Gửi duyệt", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: evidence + "/counting.png", fullPage: true });
    await page.getByRole("button", { name: "Gửi duyệt", exact: true }).click();
    await page
      .getByRole("button", { name: "Duyệt và ghi sổ", exact: true })
      .click();
    await expect(
      page
        .locator(".stock-document>.stock-page-heading")
        .getByText("Đã ghi sổ"),
    ).toBeVisible();
    await page.screenshot({
      path: evidence + "/count-posted.png",
      fullPage: true,
    });
    expect(await balance(s)).toMatchObject({
      on_hand: "19.000",
      quarantined: "1.000",
      available: "18.000",
      inventory_value: "1520000",
    });
    await page.getByRole("tab", { name: "Thẻ kho", exact: true }).click();
    await page.getByLabel("Tìm trong kho").fill(s.code);
    await page.getByRole("button", { name: "Tìm", exact: true }).click();
    await expect(page.locator(".stock-table tbody tr")).toHaveCount(2);
    await page.screenshot({
      path: evidence + "/movements.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Chứng từ", exact: true })
      .first()
      .click();
    await expect(page.locator(".stock-document")).toContainText("Đã ghi sổ");
  });
  test("W6-20 Real UI edits and posts an adjustment, and inventory responds on a narrow screen", async () => {
    await page.getByRole("tab", { name: "Điều chỉnh", exact: true }).click();
    await page
      .getByRole("button", { name: "＋ Tạo điều chỉnh", exact: true })
      .click();
    await page.getByLabel("Tìm mã hàng để chọn").fill(sku.code);
    await page.getByRole("button", { name: new RegExp(sku.code) }).click();
    await page.getByLabel("Loại điều chỉnh").selectOption("QUARANTINE");
    await page.getByLabel("Số lượng " + sku.code, { exact: true }).fill("1");
    await page
      .getByLabel("Lý do phiếu kho")
      .fill("Bao bì hỏng, chờ xác nhận chất lượng");
    await page
      .getByRole("button", { name: "Lưu phiếu nháp", exact: true })
      .click();
    await page.getByLabel("Số lượng " + sku.code, { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "Lưu thay đổi", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Duyệt và ghi sổ", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Duyệt và ghi sổ", exact: true })
      .click();
    await expect(
      page
        .locator(".stock-document>.stock-page-heading")
        .getByText("Đã ghi sổ"),
    ).toBeVisible();
    await page.screenshot({
      path: evidence + "/adjustment-posted.png",
      fullPage: true,
    });
    await page.getByRole("tab", { name: "Tồn kho", exact: true }).click();
    await page.getByLabel("Tìm trong kho").fill(sku.code);
    await page.getByRole("button", { name: "Tìm", exact: true }).click();
    await expect(page.locator(".stock-table tbody tr")).toHaveCount(1);
    await page.screenshot({ path: evidence + "/balances.png", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: evidence + "/mobile.png", fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  test("W6-21 Half-dong depletion rounds the issued value and omitted hidden cost stays unchanged", async () => {
    const s = await product("Kiểm tra làm tròn giá vốn");
    await seed(s, "1", "1");
    await transition(
      await adjust("CORRECTION", "1", s, {
        direction: "INCREASE",
        unitCostVnd: "0",
      }),
      "post",
    );
    await transition(await adjust("WRITE_OFF_GOOD", "1", s), "post");
    expect(await balance(s)).toMatchObject({
      on_hand: "1.000",
      inventory_value: "0",
    });
    let a = await adjust("CORRECTION", "1", s, {
      direction: "INCREASE",
      unitCostVnd: "12345",
    });
    await role("MANAGER");
    a = await good(
      await cmd(
        `stock-adjustments/${a.id}/lines`,
        {
          version: a.version,
          note: "Quản lý chỉnh số lượng, giữ giá đã nhập",
          lines: [{ skuId: s.id, qty: "2", direction: "INCREASE" }],
        },
        staff,
        randomUUID(),
        "PATCH",
      ),
    );
    expect(a.lines[0]).not.toHaveProperty("unit_cost_vnd");
    expect(
      (await good(await get(`stock-adjustments/${a.id}`))).lines[0]
        .unit_cost_vnd,
    ).toBe("12345");
    await transition(a, "post", staff);
    expect((await balance(s)).inventory_value).toBe("24690");
    await role("STOCK");
  });
  test("W6-22 All stored movements reconcile with stock and no count creates supplier debt", async () => {
    const inconsistent = await inventory.query(
      `WITH m AS(SELECT tenant_id,warehouse_id,sku_id,sum(qty_base) qty,sum(value_vnd) val FROM stock_movements GROUP BY 1,2,3) SELECT b.id FROM stock_balances b LEFT JOIN m USING(tenant_id,warehouse_id,sku_id) WHERE b.tenant_id=$1 AND (b.on_hand<>coalesce(m.qty,0) OR b.inventory_value<>coalesce(m.val,0) OR b.on_hand<b.reserved+b.quarantined)`,
      [tenant],
    );
    expect(inconsistent.rowCount).toBe(0);
    const ids = (
      await inventory.query(
        "SELECT id FROM stock_documents WHERE tenant_id=$1 AND status='POSTED'",
        [tenant],
      )
    ).rows.map((r) => r.id);
    expect(
      (
        await finance.query(
          "SELECT 1 FROM payables WHERE receipt_id=ANY($1::uuid[])",
          [ids],
        )
      ).rowCount,
    ).toBe(0);
  });
});
