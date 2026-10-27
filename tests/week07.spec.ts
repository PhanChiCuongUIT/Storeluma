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
    max: 4,
  });
const inv = pool("inventory"),
  fin = pool("finance"),
  sales = pool("sales");
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
  data?: any,
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
const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["pipe", "pipe", "pipe"],
  });
function machine(target: string, resource: string, body: any) {
  const script = `import {workflowCall} from './dist/packages/platform/workflow-client.js';try{console.log(JSON.stringify({status:200,body:await workflowCall(${JSON.stringify(target)},${JSON.stringify(resource)},${JSON.stringify(body)})}));}catch(e){console.log(JSON.stringify({status:e.getStatus?.()??500,body:e.getResponse?.()}));}`;
  return JSON.parse(
    compose(
      "exec",
      "-T",
      "sales",
      "node",
      "--input-type=module",
      "-e",
      script,
    ).trim(),
  );
}
test.describe.serial("Week 7 durable cash checkout across services", () => {
  let owner: BrowserContext,
    staff: BrowserContext,
    outsider: BrowserContext,
    page: Page,
    tenant: string,
    site: any,
    member: any,
    sku: any,
    shift: any,
    completed: any;
  let sequence = 0;
  const run = Date.now().toString(36).toUpperCase(),
    evidence = process.env.WEEK07_SCREENSHOTS ?? "tmp/week07/screenshots";
  const path = (s: string) => `/v1/tenants/${tenant}/${s}`;
  const get = (s: string, ctx = owner) => api(ctx, path(s));
  const cmd = (
    s: string,
    b: any,
    ctx = owner,
    key = randomUUID(),
    method = "POST",
  ) => api(ctx, path(s), method, b, key);
  async function role(value: string) {
    member = await good(
      await cmd(
        "memberships/" + member.id,
        {
          role: value,
          status: "ACTIVE",
          siteIds: [site.id],
          version: member.version,
        },
        owner,
        randomUUID(),
        "PATCH",
      ),
    );
  }
  async function product(name = "Cà phê rang mộc 250g", price = "85000") {
    const p = await good(
      await cmd("products", {
        name,
        categoryId: null,
        sku: {
          code: `K7-${run}-${++sequence}`,
          name,
          baseUnit: "Gói",
          priceVnd: price,
          attributes: {},
        },
      }),
    );
    return p.skus[0];
  }
  async function seed(s: any, quantity = "100", cost = "40000") {
    const r = await good(
      await cmd("receipts", {
        siteId: site.id,
        warehouseId: site.warehouse_id,
        sourceType: "OPENING_STOCK",
        supplierId: null,
        note: "Nhập tồn ban đầu",
        lines: [
          {
            skuId: s.id,
            unitId: s.units[0].id,
            qty: quantity,
            unitCostVnd: cost,
          },
        ],
      }),
    );
    await good(await cmd(`receipts/${r.id}/post`, { version: r.version }));
  }
  const quoteBody = (s = sku, quantity = "1", discount = "0") => ({
    siteId: site.id,
    lines: [{ skuId: s.id, unitId: s.units[0].id, quantity }],
    discount: { type: "AMOUNT", value: discount },
  });
  async function draft(s = sku, quantity = "1") {
    const q = await good(await cmd("sales/quotes", quoteBody(s, quantity)));
    return good(await cmd("orders", { quoteId: q.id, note: "Giao tại quầy" }));
  }
  async function read(d: any, ctx = owner) {
    return good(await get("orders/" + d.id, ctx));
  }
  async function checkout(d: any, ctx = owner) {
    await good(
      await cmd(
        "orders/" + d.id + "/checkout",
        { version: d.version, shiftId: shift.id, tenderedVnd: d.payable_vnd },
        ctx,
      ),
    );
    return pending(d);
  }
  async function pending(d: any) {
    let x: any;
    await expect
      .poll(
        async () => {
          x = await read(d);
          return x.checkout?.payment?.status;
        },
        { timeout: 30000 },
      )
      .toBe("PENDING");
    return x;
  }
  async function terminal(d: any, status = "COMPLETED") {
    let x: any;
    await expect
      .poll(
        async () => {
          const response = await get("orders/" + d.id);
          // A restarted service may briefly be unreachable; all other HTTP errors still fail.
          if (response.status() === 503) return "SERVICE_STARTING";
          x = await good(response);
          return x.status;
        },
        { timeout: 60000 },
      )
      .toBe(status);
    return x;
  }
  async function confirm(d: any, ctx = owner, key = randomUUID()) {
    const p = d.checkout.payment;
    return cmd(
      "payments/" + p.id + "/confirm",
      { siteId: site.id, version: p.version, cashReceived: true },
      ctx,
      key,
    );
  }
  async function cancel(d: any) {
    d = await read(d);
    await good(
      await cmd("orders/" + d.id + "/cancel", {
        version: d.version,
        reason: "Khách đổi nhu cầu mua hàng",
      }),
    );
    return terminal(d, "CANCELLED");
  }
  async function balance(s = sku) {
    return (
      await good(await get(`stock-balances?siteId=${site.id}&skuId=${s.id}`))
    ).items[0];
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
    const fpath = [
      "tmp/week05-fixture.json",
      "tmp/week06-fixture.json",
      "tmp/week07-fixture.json",
    ].find(existsSync);
    if (fpath) {
      const f = JSON.parse(readFileSync(fpath, "utf8"));
      tenant = f.tenant;
      site = await good(await get("sites/" + f.site));
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
      const i = await good(
        await cmd("invitations", {
          targetSubjectId: accounts[1].subject,
          role: "CASHIER",
          siteIds: [site.id],
          ownerConfirmed: true,
        }),
      );
      member = await good(
        await api(staff, "/v1/invitations/accept", "POST", { token: i.token }),
      );
      writeFileSync(
        "tmp/week07-fixture.json",
        JSON.stringify({ tenant, site: site.id }),
      );
    }
    await expect
      .poll(async () => (await good(await get("sites/" + site.id))).status, {
        timeout: 45000,
      })
      .toBe("ACTIVE");
    site = await good(await get("sites/" + site.id));
    await role("CASHIER");
    sku = await product();
    await seed(sku);
    shift =
      (await good(await get("shifts?siteId=" + site.id))).items.find(
        (s: any) => s.status === "OPEN",
      ) ??
      (await good(
        await cmd("shifts", { siteId: site.id, openingCash: "200000" }, staff),
      ));
  });
  test.afterAll(async () => {
    await Promise.all([
      owner?.close(),
      staff?.close(),
      outsider?.close(),
      inv.end(),
      fin.end(),
      sales.end(),
    ]);
  });
  test("W7-01 Server quote merges identical units and allocates integer discount", async () => {
    const b = quoteBody(sku, "0.333", "7");
    b.lines.push({ ...b.lines[0], quantity: "0.667" });
    const q = await good(await cmd("sales/quotes", b));
    expect(q.lines).toHaveLength(1);
    expect(q.subtotal_vnd).toBe("85000");
    expect(q.payable_vnd).toBe("84993");
    expect(q.lines[0].qtyBase).toBe("1.000");
    expect(
      (await cmd("sales/quotes", { ...b, payableVnd: "1" })).status(),
    ).toBe(400);
    expect((await balance()).reserved).toBe("0.000");
  });
  test("W7-02 Cashier discount cap, roles and tenant scope are enforced", async () => {
    expect(
      (await cmd("sales/quotes", quoteBody(sku, "1", "4251"), staff)).status(),
    ).toBe(403);
    await good(await cmd("sales/quotes", quoteBody(sku, "1", "4250"), staff));
    expect((await get("orders?siteId=" + site.id, outsider)).status()).toBe(
      404,
    );
    await role("STOCK");
    expect((await cmd("sales/quotes", quoteBody(), staff)).status()).toBe(403);
    await role("CASHIER");
  });
  test("W7-03 Draft idempotency and cancellation have no stock or cash effects", async () => {
    const q = await good(await cmd("sales/quotes", quoteBody()));
    const k = randomUUID(),
      b = { quoteId: q.id };
    const [a, c] = await Promise.all([
      good(await cmd("orders", b, owner, k)),
      good(await cmd("orders", b, owner, k)),
    ]);
    expect(a.id).toBe(c.id);
    expect(
      (await cmd("orders", { ...b, note: "changed" }, owner, k)).status(),
    ).toBe(409);
    await cancel(a);
    expect((await balance()).on_hand).toBe("100.000");
    expect(
      (
        await fin.query(
          "SELECT count(*) FROM payments WHERE tenant_id=$1 AND order_id=$2",
          [tenant, a.id],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  test("W7-04 Expired quote cannot start checkout", async () => {
    const d = await draft();
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [d.quote_id],
    );
    const r = await cmd(`orders/${d.id}/checkout`, {
      version: d.version,
      shiftId: shift.id,
      tenderedVnd: d.payable_vnd,
    });
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe("QUOTE_EXPIRED");
    await cancel(d);
  });
  test("W7-05 Changed catalog price requires a new confirmed quote", async () => {
    const s = await product("Trà hoa nhài 100g", "30000"),
      d = await draft(s);
    const u = s.units[0];
    await good(
      await cmd(
        `skus/${s.id}/units/${u.id}`,
        { priceVnd: "32000", status: "ACTIVE", version: u.version },
        owner,
        randomUUID(),
        "PATCH",
      ),
    );
    const r = await cmd(`orders/${d.id}/checkout`, {
      version: d.version,
      shiftId: shift.id,
      tenderedVnd: d.payable_vnd,
    });
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe("PRICE_CHANGED");
    await cancel(d);
  });
  test("W7-06 Prepared stock, explicit cash confirmation, one ledger and exact COGS", async () => {
    const d = await draft(sku, "2"),
      p = await checkout(d);
    expect((await balance()).reserved).toBe("2.000");
    expect((await balance()).on_hand).toBe("100.000");
    expect(
      (
        await fin.query(
          "SELECT count(*) FROM cash_ledger WHERE payment_id=$1",
          [p.checkout.payment.id],
        )
      ).rows[0].count,
    ).toBe("0");
    await good(await confirm(p));
    completed = await terminal(d);
    expect(completed.lines[0].costVnd).toBe("80000");
    expect((await balance()).on_hand).toBe("98.000");
    expect((await balance()).reserved).toBe("0.000");
    await good(await confirm(p));
    expect(
      (
        await fin.query(
          "SELECT count(*),sum(amount_vnd)::text total FROM cash_ledger WHERE payment_id=$1",
          [p.checkout.payment.id],
        )
      ).rows[0],
    ).toEqual({ count: "1", total: "170000" });
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_type='SALE' AND document_id=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W7-07 Checkout replay and commit replay retain the same identifiers", async () => {
    const d = await draft(),
      k = randomUUID(),
      b = { version: d.version, shiftId: shift.id, tenderedVnd: "100000" };
    await good(await cmd(`orders/${d.id}/checkout`, b, owner, k));
    const p = await pending(d);
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [d.quote_id],
    );
    await good(await cmd(`orders/${d.id}/checkout`, b, owner, k));
    await good(await confirm(p));
    await terminal(d);
    const res = (
      await inv.query("SELECT * FROM reservations WHERE order_id=$1", [d.id])
    ).rows[0];
    expect(
      machine("inventory", "reservation/commit", {
        tenantId: tenant,
        orderId: d.id,
        reservationId: res.id,
      }).body.status,
    ).toBe("COMMITTED");
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_id=$1 AND document_type='SALE'",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W7-08 Cancellation voids payment before releasing PREPARED stock", async () => {
    const d = await checkout(await draft());
    await cancel(d);
    expect(
      (
        await fin.query("SELECT status FROM payments WHERE id=$1", [
          d.checkout.payment.id,
        ])
      ).rows[0].status,
    ).toBe("FAILED");
    expect(
      (
        await inv.query("SELECT status FROM reservations WHERE order_id=$1", [
          d.id,
        ])
      ).rows[0].status,
    ).toBe("RELEASED");
    expect((await confirm(d)).status()).toBe(409);
    expect((await balance()).reserved).toBe("0.000");
  });
  test("W7-09 All-or-nothing multi-line reserve on insufficient stock", async () => {
    const empty = await product("Hàng chờ nhập");
    const b = quoteBody();
    b.lines.push({ skuId: empty.id, unitId: empty.units[0].id, quantity: "1" });
    const q = await good(await cmd("sales/quotes", b)),
      d = await good(await cmd("orders", { quoteId: q.id }));
    await good(
      await cmd(`orders/${d.id}/checkout`, {
        version: d.version,
        shiftId: shift.id,
        tenderedVnd: d.payable_vnd,
      }),
    );
    await terminal(d, "CANCELLED");
    expect((await balance()).reserved).toBe("0.000");
    expect(
      (
        await inv.query("SELECT count(*) FROM reservations WHERE order_id=$1", [
          d.id,
        ])
      ).rows[0].count,
    ).toBe("0");
  });
  test("W7-10 Twenty concurrent orders cannot oversell the final unit", async () => {
    test.setTimeout(150000);
    const s = await product("Hộp trà cuối"),
      quantity = "1";
    await seed(s, quantity);
    const drafts = await Promise.all(
      Array.from({ length: 20 }, () => draft(s)),
    );
    await Promise.all(drafts.map(async (d) => good(await cmdAsync(d))));
    async function cmdAsync(d: any) {
      return cmd(`orders/${d.id}/checkout`, {
        version: d.version,
        shiftId: shift.id,
        tenderedVnd: d.payable_vnd,
      });
    }
    await expect
      .poll(
        async () => {
          const rows = await Promise.all(drafts.map((d) => read(d)));
          return rows.filter((d) => d.status === "CANCELLED").length;
        },
        { timeout: 100000 },
      )
      .toBe(19);
    const survivor = (await Promise.all(drafts.map((d) => read(d)))).find(
      (d) => d.status !== "CANCELLED",
    );
    await good(await confirm(await pending(survivor)));
    await terminal(survivor);
    expect((await balance(s)).on_hand).toBe("0.000");
    expect((await balance(s)).inventory_value).toBe("0");
  });
  test("W7-11 Inventory freeze blocks checkout without taking cash", async () => {
    const c = await good(
      await cmd("stock-counts", {
        siteId: site.id,
        warehouseId: site.warehouse_id,
        note: "Kiểm đếm trước bán",
        lines: [{ skuId: sku.id }],
      }),
    );
    const started = await good(
      await cmd(`stock-counts/${c.id}/start`, { version: c.version }),
    );
    const d = await draft();
    await good(
      await cmd(`orders/${d.id}/checkout`, {
        version: d.version,
        shiftId: shift.id,
        tenderedVnd: d.payable_vnd,
      }),
    );
    await terminal(d, "CANCELLED");
    await good(
      await cmd(`stock-counts/${c.id}/cancel`, { version: started.version }),
    );
  });
  test("W7-12 PREPARED does not expire while waiting for cash", async () => {
    const d = await checkout(await draft());
    await inv.query(
      "UPDATE reservations SET expires_at=now()-interval '1 day' WHERE order_id=$1",
      [d.id],
    );
    await expect
      .poll(async () => (await read(d)).checkout?.payment?.status)
      .toBe("PENDING");
    expect(
      (
        await inv.query("SELECT status FROM reservations WHERE order_id=$1", [
          d.id,
        ])
      ).rows[0].status,
    ).toBe("PREPARED");
    await cancel(d);
  });
  test("W7-13 Pending payments prevent shift close and opening cash is not revenue", async () => {
    const d = await checkout(await draft());
    expect(
      (
        await cmd(`shifts/${shift.id}/close`, {
          siteId: site.id,
          version: shift.version,
          countedCash: "200000",
          note: "Đối chiếu cuối ca",
        })
      ).status(),
    ).toBe(409);
    expect(
      (await cmd("shifts", { siteId: site.id, openingCash: "0" })).status(),
    ).toBe(409);
    const total = (
        await fin.query(
          "SELECT COALESCE(sum(amount_vnd),0)::text total FROM cash_ledger WHERE shift_id=$1",
          [shift.id],
        )
      ).rows[0].total,
      s = (await good(await get("shifts?siteId=" + site.id))).items.find(
        (x: any) => x.id === shift.id,
      );
    expect(BigInt(s.expected_now)).toBe(BigInt(s.opening_cash) + BigInt(total));
    await cancel(d);
  });
  test("W7-14 A cash confirmation racing cancellation has a consistent terminal outcome", async () => {
    const d = await checkout(await draft());
    const results = await Promise.all([
      confirm(d),
      cmd(`orders/${d.id}/cancel`, {
        version: d.version,
        reason: "Khách thay đổi lựa chọn",
      }),
    ]);
    expect(results.every((r) => [200, 201, 409].includes(r.status()))).toBe(
      true,
    );
    let n: any;
    await expect
      .poll(
        async () => {
          n = await read(d);
          return ["COMPLETED", "CANCELLED"].includes(n.status);
        },
        { timeout: 60000 },
      )
      .toBe(true);
    const pay = (
      await fin.query("SELECT status FROM payments WHERE order_id=$1", [d.id])
    ).rows[0];
    const res = (
      await inv.query("SELECT status FROM reservations WHERE order_id=$1", [
        d.id,
      ])
    ).rows[0];
    expect([pay.status, res.status]).toEqual(
      n.status === "COMPLETED"
        ? ["SUCCEEDED", "COMMITTED"]
        : ["FAILED", "RELEASED"],
    );
  });
  test("W7-15 Finance outage preserves stock and resumes same payment", async () => {
    const d = await checkout(await draft());
    compose("stop", "finance");
    try {
      await expect
        .poll(async () => (await read(d)).status, { timeout: 30000 })
        .toBe("REVIEW");
      expect(
        (
          await inv.query("SELECT status FROM reservations WHERE order_id=$1", [
            d.id,
          ])
        ).rows[0].status,
      ).toBe("PREPARED");
    } finally {
      compose("start", "finance");
    }
    const p = await pending(d);
    expect(p.checkout.payment.id).toBe(d.checkout.payment.id);
    await cancel(p);
  });
  test("W7-16 Paid order survives Inventory outage and Sales restart", async () => {
    test.setTimeout(150000);
    const d = await checkout(await draft());
    compose("stop", "inventory");
    try {
      await good(await confirm(d));
      await expect
        .poll(async () => (await read(d)).status, { timeout: 30000 })
        .toBe("REVIEW");
      compose("restart", "sales");
    } finally {
      compose("start", "inventory");
    }
    await terminal(d);
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_id=$1 AND document_type='SALE'",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W7-17 Admitted Saga finishes after the actor loses access", async () => {
    const d = await draft(),
      p = await checkout(d, staff);
    compose("stop", "inventory");
    try {
      await good(await confirm(p, staff));
      await role("STOCK");
      expect((await get("orders/" + d.id, staff)).status()).toBe(403);
    } finally {
      compose("start", "inventory");
    }
    await terminal(d);
    await role("CASHIER");
  });
  test("W7-18 Cost is redacted and SALE history links only for allowed roles", async () => {
    const d = await read(completed, staff);
    expect(d.lines[0]).not.toHaveProperty("costVnd");
    const rows = (
      await good(
        await get(`stock-movements?siteId=${site.id}&type=SALE`, staff),
      )
    ).items;
    expect(
      rows.some((r: any) => r.document_id === completed.id && r.canOpenSource),
    ).toBe(true);
    expect(rows[0]).not.toHaveProperty("value_vnd");
    await role("STOCK");
    expect(
      (
        await good(
          await get(`stock-movements?siteId=${site.id}&type=SALE`, staff),
        )
      ).items[0].canOpenSource,
    ).toBe(false);
    await role("CASHIER");
  });
  test("W7-19 Browser cannot call internal workflows or forge service credentials", async () => {
    expect(
      (
        await api(owner, "/v1/internal/workflows/payment/void", "POST", {
          tenantId: tenant,
        })
      ).status(),
    ).toBe(404);
    const output = compose(
      "exec",
      "-T",
      "sales",
      "node",
      "--input-type=module",
      "-e",
      `const r=await fetch('http://inventory:4100/v1/internal/workflows/reservation/query',{method:'POST',headers:{'content-type':'application/json','x-workflow-authorization':'forged'},body:JSON.stringify({tenantId:${JSON.stringify(tenant)}})});console.log(r.status);`,
    );
    expect(output.trim()).toBe("403");
  });
  test("W7-20 Completed events are unique and service databases stay isolated", async () => {
    const d = completed;
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM outbox WHERE type='sales.order-completed.v1' AND payload->>'aggregateId'=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await fin.query(
          "SELECT count(*) FROM outbox WHERE type='finance.payment-succeeded.v1' AND payload->>'correlationId'=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await sales.query(
          "SELECT has_database_privilege(current_user,'inventory_db','CONNECT') allowed",
        )
      ).rows[0].allowed,
    ).toBe(false);
  });
  test("W7-23 Active hold expires without cash and cannot be prepared again", async () => {
    const p = {
      tenantId: tenant,
      siteId: site.id,
      warehouseId: site.warehouse_id,
      orderId: randomUUID(),
      reservationId: randomUUID(),
      paymentId: randomUUID(),
      orderCode: "EXP-" + run,
      actorId: accounts[0].subject,
      amountVnd: "85000",
      lines: [
        {
          skuId: sku.id,
          qtyBase: "1.000",
          code: sku.code,
          name: sku.name,
          baseUnit: sku.base_unit,
        },
      ],
    };
    expect(machine("inventory", "reservation/reserve", p).body.status).toBe(
      "ACTIVE",
    );
    await inv.query(
      "UPDATE reservations SET expires_at=now()-interval '1 second' WHERE id=$1",
      [p.reservationId],
    );
    await expect
      .poll(
        async () =>
          (
            await inv.query("SELECT status FROM reservations WHERE id=$1", [
              p.reservationId,
            ])
          ).rows[0].status,
      )
      .toBe("EXPIRED");
    expect(
      machine("inventory", "reservation/prepare", {
        tenantId: tenant,
        orderId: p.orderId,
        reservationId: p.reservationId,
        paymentId: p.paymentId,
      }).status,
    ).toBe(409);
    expect((await balance()).reserved).toBe("0.000");
  });
  test("W7-24 Cancel tombstone rejects delayed intent creation and early stock commit", async () => {
    const d = await checkout(await draft()),
      p = d.checkout.payment,
      ref = {
        tenantId: tenant,
        orderId: d.id,
        reservationId: p.reservation_id,
      };
    expect(machine("inventory", "reservation/commit", ref).status).toBe(409);
    expect(machine("inventory", "reservation/release", ref).status).toBe(409);
    await cancel(d);
    const replay = machine("finance", "payment/create", {
      ...ref,
      siteId: site.id,
      paymentId: p.id,
      shiftId: p.shift_id,
      actorId: p.actor_id,
      orderCode: p.order_code,
      amountVnd: p.amount_vnd,
      tenderedVnd: p.tendered_vnd,
    });
    expect(replay.body.status).toBe("FAILED");
    expect((await confirm(d)).status()).toBe(409);
  });
  test("W7-25 Mixed sale units share one stock movement and preserve exact discount and cost", async () => {
    const s = await product("Trà túi lọc", "10001");
    await seed(s, "10", "6001");
    const u = await good(
      await cmd(`skus/${s.id}/units`, {
        name: "Lốc 3",
        factor: "3",
        priceVnd: "29000",
      }),
    );
    const b = quoteBody(s, "1", "7");
    b.lines.push({ skuId: s.id, unitId: u.id, quantity: "1" });
    const q = await good(await cmd("sales/quotes", b));
    expect(q.subtotal_vnd).toBe("39001");
    expect(
      q.lines.reduce((n: bigint, l: any) => n + BigInt(l.discountVnd), 0n),
    ).toBe(7n);
    const d = await checkout(
      await good(await cmd("orders", { quoteId: q.id })),
    );
    await good(await confirm(d));
    const n = await terminal(d);
    expect(
      n.lines.reduce((v: bigint, l: any) => v + BigInt(l.costVnd), 0n),
    ).toBe(24004n);
    expect((await balance(s)).on_hand).toBe("6.000");
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_type='SALE' AND document_id=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W7-26 Cash checkout completes during broker outage and Outbox drains after recovery", async () => {
    test.setTimeout(150000);
    const d = await checkout(await draft());
    compose("stop", "rabbitmq");
    try {
      await good(await confirm(d));
      await terminal(d);
      expect(
        (
          await sales.query(
            "SELECT count(*) FROM outbox WHERE type='sales.order-completed.v1' AND payload->>'aggregateId'=$1 AND delivered_at IS NULL",
            [d.id],
          )
        ).rows[0].count,
      ).toBe("1");
    } finally {
      compose("start", "rabbitmq");
    }
    await expect
      .poll(
        async () =>
          (
            await sales.query(
              "SELECT count(*) FROM outbox WHERE type='sales.order-completed.v1' AND payload->>'aggregateId'=$1 AND delivered_at IS NOT NULL",
              [d.id],
            )
          ).rows[0].count,
        { timeout: 60000 },
      )
      .toBe("1");
  });
  test("W7-27 Inexact conversions and overflowing quote amounts are rejected before persistence", async () => {
    const s = await product("Hàng cân theo lượng", "99999999999999999999");
    const u = await good(
      await cmd(`skus/${s.id}/units`, {
        name: "Phần nhỏ",
        factor: "0.333",
        priceVnd: "1000",
      }),
    );
    const body = {
      siteId: site.id,
      lines: [{ skuId: s.id, unitId: u.id, quantity: "0.001" }],
      discount: { type: "AMOUNT", value: "0" },
    };
    expect((await cmd("sales/quotes", body)).status()).toBe(400);
    expect((await cmd("sales/quotes", quoteBody(s, "2"))).status()).toBe(400);
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM quotes WHERE tenant_id=$1 AND request->'lines' @> $2::jsonb",
          [tenant, JSON.stringify([{ skuId: s.id }])],
        )
      ).rows[0].count,
    ).toBe("0");
  });
  test("W7-28 Unpaid prepared checkout survives Sales restart without collecting cash", async () => {
    test.setTimeout(150000);
    const d = await checkout(await draft());
    const paymentId = d.checkout.payment.id;
    const reservationId = d.checkout.payment.reservation_id;
    const before = await balance();
    compose("restart", "sales");
    await expect
      .poll(async () => (await get("orders/" + d.id)).status(), {
        timeout: 30000,
      })
      .toBe(200);
    const resumed = await pending(d);
    expect(resumed.checkout.payment.id).toBe(paymentId);
    expect(resumed.checkout.payment.reservation_id).toBe(reservationId);
    expect(resumed.checkout.payment.status).toBe("PENDING");
    expect((await balance()).on_hand).toBe(before.on_hand);
    expect((await balance()).reserved).toBe(before.reserved);
    expect(
      (
        await fin.query(
          "SELECT count(*) FROM cash_ledger WHERE payment_id=$1",
          [paymentId],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      (
        await inv.query("SELECT status FROM reservations WHERE id=$1", [
          reservationId,
        ])
      ).rows[0].status,
    ).toBe("PREPARED");
    await good(await confirm(resumed));
    await terminal(d);
    expect(
      (
        await fin.query(
          "SELECT count(*) FROM cash_ledger WHERE payment_id=$1",
          [paymentId],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_type='SALE' AND document_id=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM checkout_sagas WHERE order_id=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W7-29 Draft command retries survive quote expiry without new orders", async () => {
    const q = await good(await cmd("sales/quotes", quoteBody()));
    const key = randomUUID();
    const body = { quoteId: q.id, note: "Giữ yêu cầu khi mất phản hồi" };
    const d = await good(await cmd("orders", body, owner, key));
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [q.id],
    );
    const replay = await good(await cmd("orders", body, owner, key));
    expect(replay.id).toBe(d.id);
    expect(
      (
        await cmd("orders", { ...body, note: "Nội dung khác" }, owner, key)
      ).status(),
    ).toBe(409);
    const next = await good(await cmd("sales/quotes", quoteBody(sku, "2")));
    const editKey = randomUUID();
    const edit = { quoteId: next.id, version: d.version, note: "Đã sửa nháp" };
    const updated = await good(
      await cmd("orders/" + d.id, edit, owner, editKey, "PATCH"),
    );
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [next.id],
    );
    const editReplay = await good(
      await cmd("orders/" + d.id, edit, owner, editKey, "PATCH"),
    );
    expect(editReplay.id).toBe(d.id);
    expect(editReplay.version).toBe(updated.version);
    expect(
      (
        await cmd(
          "orders/" + d.id,
          { ...edit, note: "Nội dung khác" },
          owner,
          editKey,
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    // Expiry still rejects a genuinely new command, and replay still checks live permissions.
    const unused = await good(await cmd("sales/quotes", quoteBody()));
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [unused.id],
    );
    expect((await cmd("orders", { quoteId: unused.id })).status()).toBe(409);
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM orders WHERE tenant_id=$1 AND quote_id=$2",
          [tenant, unused.id],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM orders WHERE tenant_id=$1 AND quote_id=$2",
          [tenant, next.id],
        )
      ).rows[0].count,
    ).toBe("1");
    await cancel(updated);
    const staffQuote = await good(
      await cmd("sales/quotes", quoteBody(), staff),
    );
    const staffKey = randomUUID();
    const staffBody = { quoteId: staffQuote.id };
    const staffDraft = await good(
      await cmd("orders", staffBody, staff, staffKey),
    );
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [staffQuote.id],
    );
    await role("STOCK");
    try {
      expect((await cmd("orders", staffBody, staff, staffKey)).status()).toBe(
        403,
      );
    } finally {
      await role("CASHIER");
      await cancel(staffDraft);
    }
  });
  test("W7-21 Real UI quote, draft, cash confirmation and mobile layout", async () => {
    test.setTimeout(150000);
    await page.goto("/");
    await page.getByLabel("Chọn hộ kinh doanh").selectOption(tenant);
    await page.getByRole("button", { name: "Đơn bán", exact: true }).click();
    await page.getByLabel("Địa điểm bán hàng").selectOption(site.id);
    expect(
      (await page.getByLabel("Tìm mã đơn bán").boundingBox())!.width,
    ).toBeGreaterThan(200);
    await page.getByRole("button", { name: "Tạo đơn bán" }).click();
    await page.getByLabel("Tìm hàng bán").fill(sku.code);
    await page
      .locator(".sale-product-results button")
      .filter({ hasText: sku.code })
      .click();
    const firstQuoteResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/sales/quotes") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Cập nhật báo giá", exact: true })
      .click();
    const firstQuote = await (await firstQuoteResponse).json();
    await sales.query(
      "UPDATE quotes SET expires_at=now()-interval '1 second' WHERE id=$1",
      [firstQuote.id],
    );
    const refreshedQuoteResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/sales/quotes") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Cập nhật báo giá", exact: true })
      .click();
    expect((await (await refreshedQuoteResponse).json()).id).not.toBe(
      firstQuote.id,
    );
    await expect(
      page.getByRole("button", { name: "Lưu đơn nháp" }),
    ).toBeEnabled();
    await page.screenshot({
      path: evidence + "/01-order-editor.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Lưu đơn nháp" }).click();
    await page.getByLabel("Tiền khách đưa").fill("100000");
    await page.getByRole("button", { name: "Tiến hành thanh toán" }).click();
    await expect(
      page.getByText("Đã nhận đủ tiền và trả lại tiền thừa"),
    ).toBeVisible({ timeout: 30000 });
    await page.screenshot({
      path: evidence + "/02-cash-confirmation.png",
      fullPage: true,
    });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Xác nhận đã thu tiền" }).click();
    await expect(page.getByText("Đã thu tiền và xuất kho")).toBeVisible({
      timeout: 45000,
    });
    await page.screenshot({
      path: evidence + "/03-completed-order.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: evidence + "/04-mobile-order.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "Danh sách đơn" }).click();
    await page.screenshot({
      path: evidence + "/05-order-list.png",
      fullPage: true,
    });
    // Another session can close the displayed shift before this user opens its form.
    const liveShift = (
      await good(await get("shifts?siteId=" + site.id))
    ).items.find((s: any) => s.status === "OPEN");
    await good(
      await cmd(`shifts/${liveShift.id}/close`, {
        siteId: site.id,
        version: liveShift.version,
        countedCash: liveShift.expected_now,
        note: "",
      }),
    );
    await page.getByRole("button", { name: "Đóng ca", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Mở ca thu ngân", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Tiền đầu ca", { exact: true }).fill("200000");
    await page
      .getByRole("button", { name: "Xác nhận mở ca", exact: true })
      .click();
    await expect(
      page.getByText("Đã mở ca thu ngân.", { exact: true }),
    ).toBeVisible();
  });
  test("W7-22 Shift close records exact cash variance and blocks later checkout", async () => {
    const s = (await good(await get("shifts?siteId=" + site.id))).items.find(
      (s: any) => s.status === "OPEN",
    );
    const n = await good(
      await cmd(`shifts/${s.id}/close`, {
        siteId: site.id,
        version: s.version,
        countedCash: s.expected_now,
        note: "",
      }),
    );
    expect(n.difference_vnd).toBe("0");
    const d = await draft();
    expect(
      (
        await cmd(`orders/${d.id}/checkout`, {
          version: d.version,
          shiftId: s.id,
          tenderedVnd: d.payable_vnd,
        })
      ).status(),
    ).toBe(409);
    await cancel(d);
    await role("STOCK");
  });
});
