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
    port: Number(env.PG_HOST_PORT ?? 55432),
    user: s,
    password: env[s.toUpperCase() + "_DB_PASSWORD"],
    database: s + "_db",
    max: 3,
  });
const reporting = pool("reporting"),
  notification = pool("notification"),
  sales = pool("sales"),
  finance = pool("finance"),
  inventory = pool("inventory");
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
const compose = (...args: string[]) =>
  execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    timeout: 60000,
    stdio: ["pipe", "pipe", "pipe"],
  });
const machine = (service: string, script: string) =>
  JSON.parse(
    compose(
      "exec",
      "-T",
      service,
      "node",
      "--input-type=module",
      "-e",
      script,
    ).trim(),
  );
test.describe.serial("Week 9 reports and work inbox", () => {
  let owner: BrowserContext,
    staff: BrowserContext,
    outsider: BrowserContext,
    page: Page,
    tenant: string,
    site: any,
    otherSite: any,
    member: any,
    sku: any,
    shift: any,
    order: any,
    returned: any;
  const stamp = Date.now().toString(36).toUpperCase(),
    evidence = process.env.WEEK09_SCREENSHOTS ?? "tmp/week09/screenshots";
  const path = (s: string) => `/v1/tenants/${tenant}/${s}`,
    get = (s: string, c = owner) => api(c, path(s)),
    cmd = (s: string, b: any, c = owner, key = randomUUID(), method = "POST") =>
      api(c, path(s), method, b, key);
  const dates = { from: "2026-01-01", to: "2026-12-31" };
  const summary = async (c = owner, extra: Record<string, string> = {}) =>
    good(
      await get(
        "reports/summary?" +
          new URLSearchParams({ ...dates, siteId: site.id, ...extra }),
        c,
      ),
    );
  const work = async (status = "ACTIVE", c = owner) =>
    good(await get(`work-items?siteId=${site.id}&status=${status}`, c));
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
  async function waitWork(kind: string, status = "ACTIVE") {
    let item: any;
    await expect
      .poll(
        async () => {
          item = (await work(status)).items.find((r: any) => r.kind === kind);
          return !!item;
        },
        { timeout: 30000 },
      )
      .toBe(true);
    return item;
  }
  async function stockIn(quantity: string) {
    const r = await good(
      await cmd("receipts", {
        siteId: site.id,
        warehouseId: site.warehouse_id,
        sourceType: "OPENING_STOCK",
        supplierId: null,
        note: "Nhập tồn ban đầu",
        lines: [
          {
            skuId: sku.id,
            unitId: sku.units[0].id,
            qty: quantity,
            unitCostVnd: "40000",
          },
        ],
      }),
    );
    await good(await cmd(`receipts/${r.id}/post`, { version: r.version }));
  }
  async function sell() {
    const q = await good(
      await cmd("sales/quotes", {
        siteId: site.id,
        lines: [{ skuId: sku.id, unitId: sku.units[0].id, quantity: "2" }],
        discount: { type: "AMOUNT", value: "10000" },
      }),
    );
    let d = await good(
      await cmd("orders", { quoteId: q.id, note: "Giao tại quầy" }),
    );
    await good(
      await cmd(`orders/${d.id}/checkout`, {
        version: d.version,
        shiftId: shift.id,
        tenderedVnd: d.payable_vnd,
      }),
    );
    await expect
      .poll(
        async () => {
          d = await good(await get("orders/" + d.id));
          return d.checkout?.payment?.status;
        },
        { timeout: 30000 },
      )
      .toBe("PENDING");
    await good(
      await cmd(`payments/${d.checkout.payment.id}/confirm`, {
        siteId: site.id,
        version: d.checkout.payment.version,
        cashReceived: true,
      }),
    );
    await expect
      .poll(
        async () => {
          d = await good(await get("orders/" + d.id));
          return d.status;
        },
        { timeout: 30000 },
      )
      .toBe("COMPLETED");
    return d;
  }
  async function exportReport(kind = "sales", c = owner) {
    const j = await good(
      await cmd(
        "report-exports",
        { kind, filters: { ...dates, siteId: site.id } },
        c,
      ),
    );
    await expect
      .poll(
        async () => (await good(await get("report-exports/" + j.id, c))).status,
        { timeout: 30000 },
      )
      .toBe("READY");
    return j;
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
    const file = [
      "tmp/week05-fixture.json",
      "tmp/week06-fixture.json",
      "tmp/week07-fixture.json",
      "tmp/week09-fixture.json",
    ].find(existsSync);
    if (file) {
      tenant = JSON.parse(readFileSync(file, "utf8")).tenant;
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
      const i = await good(
        await cmd("invitations", {
          targetSubjectId: accounts[1].subject,
          role: "MANAGER",
          siteIds: [t.site.id],
          ownerConfirmed: true,
        }),
      );
      member = await good(
        await api(staff, "/v1/invitations/accept", "POST", { token: i.token }),
      );
      writeFileSync(
        "tmp/week09-fixture.json",
        JSON.stringify({ tenant, site: t.site.id }),
      );
    }
    site = await good(
      await cmd("sites", {
        name: "Cửa hàng An Mộc - Nguyễn Văn Cừ",
        code: "S9-" + stamp,
        address: "Quận 5, TP. Hồ Chí Minh",
      }),
    );
    otherSite = await good(
      await cmd("sites", {
        name: "Kho An Mộc - Bình Thạnh",
        code: "T9-" + stamp,
      }),
    );
    await expect
      .poll(
        async () => {
          site = await good(await get("sites/" + site.id));
          return site.status;
        },
        { timeout: 45000 },
      )
      .toBe("ACTIVE");
    await role("MANAGER");
    const p = await good(
      await cmd("products", {
        name: "Cà phê rang mộc 250g",
        categoryId: null,
        sku: {
          code: "K9-" + stamp,
          name: "Cà phê rang mộc 250g",
          baseUnit: "Gói",
          priceVnd: "100000",
          attributes: {},
        },
      }),
    );
    sku = p.skus[0];
    await stockIn("6");
    shift = await good(
      await cmd("shifts", { siteId: site.id, openingCash: "500000" }),
    );
    order = await sell();
  });
  test.afterAll(async () => {
    await Promise.all([
      owner?.close(),
      staff?.close(),
      outsider?.close(),
      reporting.end(),
      notification.end(),
      sales.end(),
      finance.end(),
      inventory.end(),
    ]);
  });
  test("W9-01 Revenue, cost and drawer cash use independent facts", async () => {
    await expect
      .poll(async () => (await summary()).totals.revenue_vnd, {
        timeout: 30000,
      })
      .toBe("190000");
    const d = await summary();
    expect(d.totals).toMatchObject({
      orders: 1,
      sales_vnd: "190000",
      discount_vnd: "10000",
      cost_vnd: "80000",
      profit_vnd: "110000",
    });
    expect(d.cash.totals.net_vnd).toBe("190000");
    expect(d.daily).toHaveLength(365);
    expect(d.top[0]).toMatchObject({
      sku_id: sku.id,
      qty_base: "2.000",
      revenue_vnd: "190000",
    });
    await expect
      .poll(async () => (await summary()).freshness.initializing, {
        timeout: 30000,
      })
      .toBe(false);
  });
  test("W9-02 Returns enter the completion period; source sale remains unchanged", async () => {
    returned = await good(
      await cmd(`orders/${order.id}/returns`, {
        reason: "Khách trả hàng còn nguyên",
        lines: [
          {
            orderLineId: order.lines[0].id,
            quantity: "1",
            disposition: "SELLABLE",
          },
        ],
      }),
    );
    await waitWork("RETURN_APPROVAL");
    await page.goto("/");
    await page.getByLabel("Chọn hộ kinh doanh").selectOption(tenant);
    await page.getByRole("button", { name: "Công việc", exact: true }).click();
    await page.getByLabel("Địa điểm báo cáo").selectOption(site.id);
    await page.getByLabel("Loại công việc").selectOption("RETURN_APPROVAL");
    await page
      .getByRole("button", { name: "Mở chứng từ", exact: true })
      .click();
    await expect(page.locator(".return-detail")).toContainText(returned.code);
    await good(
      await cmd(
        `returns/${returned.id}/approve`,
        { version: returned.version, note: "Đã kiểm tra hàng và chứng từ" },
        staff,
      ),
    );
    await expect
      .poll(
        async () => {
          returned = await good(await get("returns/" + returned.id));
          return returned.progress?.refund?.status;
        },
        { timeout: 30000 },
      )
      .toBe("PENDING");
    const f = await good(
      await cmd(`refunds/${returned.refund_id}/prepare`, {
        shiftId: shift.id,
        version: returned.progress.refund.version,
      }),
    );
    await good(
      await cmd(`refunds/${f.id}/confirm`, {
        shiftId: shift.id,
        version: f.version,
        cashPaid: true,
      }),
    );
    await expect
      .poll(async () => (await summary()).totals.returns_vnd, {
        timeout: 30000,
      })
      .toBe("95000");
    const d = await summary();
    expect(d.totals).toMatchObject({
      revenue_vnd: "95000",
      cost_vnd: "40000",
      profit_vnd: "55000",
    });
    expect(d.cash.totals).toMatchObject({
      receipts_vnd: "190000",
      refunds_vnd: "95000",
      net_vnd: "95000",
    });
    // Move only this fixture's return completion to a known next-day boundary.
    const original = (
      await sales.query("SELECT completed_at FROM returns WHERE id=$1", [
        returned.id,
      ])
    ).rows[0].completed_at;
    try {
      await sales.query(
        "UPDATE returns SET completed_at='2026-12-31T17:00:00Z' WHERE id=$1",
        [returned.id],
      );
      await expect
        .poll(async () => (await summary()).totals.returns_vnd, {
          timeout: 15000,
        })
        .toBe("0");
      const next = await summary(owner, {
        from: "2027-01-01",
        to: "2027-01-01",
      });
      expect(next.totals).toMatchObject({
        orders: 0,
        returns_vnd: "95000",
        revenue_vnd: "-95000",
        cost_vnd: "-40000",
      });
    } finally {
      await sales.query("UPDATE returns SET completed_at=$2 WHERE id=$1", [
        returned.id,
        original,
      ]);
    }
    await expect
      .poll(async () => (await summary()).totals.returns_vnd, {
        timeout: 15000,
      })
      .toBe("95000");
    expect((await good(await get("orders/" + order.id))).payable_vnd).toBe(
      "190000",
    );
  });
  test("W9-03 Report permissions enforce tenant, site and confidential cost", async () => {
    const d = await summary(staff);
    expect(d.costVisible).toBe(false);
    expect(JSON.stringify(d)).not.toContain("cost_vnd");
    expect(
      (
        await get(
          `reports/summary?${new URLSearchParams({ ...dates, siteId: otherSite.id })}`,
          staff,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await get("reports/summary?" + new URLSearchParams(dates), outsider)
      ).status(),
    ).toBe(404);
    await role("CASHIER");
    expect(
      (
        await get("reports/summary?" + new URLSearchParams(dates), staff)
      ).status(),
    ).toBe(403);
    await role("STOCK");
    expect(
      (
        await get("reports/stock?" + new URLSearchParams(dates), staff)
      ).status(),
    ).toBe(403);
    await role("ACCOUNTANT");
    expect((await summary(staff)).totals.cost_vnd).toBe("40000");
    await role("MANAGER");
  });
  test("W9-04 Date validation, empty period and current inventory semantics", async () => {
    for (const q of [
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2027-01-01", to: "2026-01-01" },
      { from: "2025-01-01", to: "2026-12-31" },
    ])
      expect(
        (await get("reports/summary?" + new URLSearchParams(q))).status(),
      ).toBe(400);
    const empty = await summary(owner, {
      from: "2025-01-01",
      to: "2025-01-02",
    });
    expect(empty.totals.revenue_vnd).toBe("0");
    expect(empty.daily).toHaveLength(2);
    const stock = await good(
      await get(
        "reports/stock?" + new URLSearchParams({ ...dates, siteId: site.id }),
      ),
    );
    expect(stock.pointInTime).toBe("CURRENT");
    expect(stock.items.find((s: any) => s.sku_id === sku.id)).toMatchObject({
      on_hand: "5.000",
      available: "5.000",
      value_vnd: "200000",
    });
  });
  test("W9-05 CSV jobs are idempotent, private, expiring and reauthorize downloads", async () => {
    const key = randomUUID(),
      body = { kind: "sales", filters: { ...dates, siteId: site.id } };
    const a = await good(await cmd("report-exports", body, owner, key)),
      b = await good(await cmd("report-exports", body, owner, key));
    expect(a.id).toBe(b.id);
    const j = await exportReport("sales", staff);
    const file = await good(
      await get(`report-exports/${j.id}/download`, staff),
    );
    expect(file.csv).toContain("95000");
    expect(file.csv).not.toContain("Giá vốn");
    expect((await get(`report-exports/${j.id}/download`, owner)).status()).toBe(
      404,
    );
    await role("ACCOUNTANT");
    expect((await get(`report-exports/${j.id}/download`, staff)).status()).toBe(
      403,
    );
    await role("MANAGER");
    const own = await exportReport();
    await reporting.query(
      "UPDATE report_exports SET expires_at=now()-interval '1 second' WHERE id=$1",
      [own.id],
    );
    expect((await get(`report-exports/${own.id}/download`)).status()).toBe(410);
    const occupied = [randomUUID(), randomUUID(), randomUUID()];
    try {
      for (const id of occupied)
        await reporting.query(
          "INSERT INTO report_exports(id,tenant_id,subject_id,query,grant_scope,status,lease_until) VALUES($1,$2,$3,$4,'{}','RUNNING',now()+interval '5 minutes')",
          [id, tenant, accounts[0].subject, body],
        );
      expect((await cmd("report-exports", body)).status()).toBe(422);
    } finally {
      await reporting.query(
        "DELETE FROM report_exports WHERE tenant_id=$1 AND id=ANY($2::uuid[])",
        [tenant, occupied],
      );
    }
  });
  test("W9-06 CSV protects formula-like product labels and preserves numeric negatives", async () => {
    const result = machine(
      "reporting",
      `import {toCsv} from './dist/services/reporting/reports.js';console.log(JSON.stringify(toCsv([['=1+1',' @SUM(A1)','-95000','x,y','a"b','\t+1']])));process.exit(0);`,
    );
    expect(result).toContain("'=1+1");
    expect(result).toContain("' @SUM(A1)");
    expect(result).toContain('"-95000"');
    expect(result).toContain('"x,y"');
    expect(result).toContain('a""b');
    expect(result).toContain("'\t+1");
  });
  test("W9-07 Low-stock work is acknowledged once, resolves from stock and can recur", async () => {
    const item = await waitWork("LOW_STOCK"),
      key = randomUUID();
    const a = await good(
      await cmd(
        `work-items/${item.id}/acknowledge`,
        { version: item.version },
        owner,
        key,
      ),
    );
    expect(a.status).toBe("ACKNOWLEDGED");
    expect(
      (
        await good(
          await cmd(
            `work-items/${item.id}/acknowledge`,
            { version: item.version },
            owner,
            key,
          ),
        )
      ).id,
    ).toBe(a.id);
    expect(
      (
        await cmd(`work-items/${item.id}/acknowledge`, {
          version: item.version,
        })
      ).status(),
    ).toBe(409);
    await stockIn("2");
    await expect
      .poll(
        async () =>
          (await work("RESOLVED")).items.some((x: any) => x.id === item.id),
        { timeout: 30000 },
      )
      .toBe(true);
    const r = await good(await get("notification-rules?siteId=" + site.id));
    await good(
      await cmd(
        "notification-rules/" + site.id,
        { lowStock: "10", pendingMinutes: 1, version: r.version },
        owner,
        randomUUID(),
        "PATCH",
      ),
    );
    const next = await waitWork("LOW_STOCK");
    expect(next.id).not.toBe(item.id);
    expect(next.status).toBe("OPEN");
  });
  test("W9-08 Rule changes have optimistic concurrency and scope restrictions", async () => {
    const rule = await good(await get("notification-rules?siteId=" + site.id));
    expect(
      (
        await cmd(
          "notification-rules/" + site.id,
          { lowStock: "12", pendingMinutes: 1, version: rule.version - 1 },
          owner,
          randomUUID(),
          "PATCH",
        )
      ).status(),
    ).toBe(409);
    expect(
      (await get("notification-rules?siteId=" + otherSite.id, staff)).status(),
    ).toBe(404);
    await role("STOCK");
    expect(
      (await get("notification-rules?siteId=" + site.id, staff)).status(),
    ).toBe(403);
    expect(
      (await work("ALL", staff)).items.every(
        (r: any) => r.kind === "LOW_STOCK",
      ),
    ).toBe(true);
    expect((await get("work-items", outsider)).status()).toBe(404);
    await role("MANAGER");
  });
  test("W9-09 Projection deduplication, ordering, validation and database isolation", async () => {
    const result = machine(
      "reporting",
      `import {db,transaction} from './dist/packages/platform/db.js';import {applyProjection,projectionRecordSchema} from './dist/packages/platform/projections.js';const p=(await db.query("SELECT * FROM read_records WHERE kind='STOCK' AND tenant_id=$1 AND site_id=$2",[${JSON.stringify(tenant)},${JSON.stringify(site.id)}])).rows[0];const rec={kind:p.kind,id:p.id,tenantId:p.tenant_id,siteId:p.site_id,revision:p.revision,data:p.data};await transaction(async c=>{await applyProjection(c,p.producer,rec);await applyProjection(c,p.producer,{...rec,revision:Math.max(1,rec.revision-1),data:{...rec.data,onHand:'999.000'}});});const after=(await db.query('SELECT revision,data FROM read_records WHERE producer=$1 AND kind=$2 AND id=$3',[p.producer,p.kind,p.id])).rows[0];console.log(JSON.stringify({same:JSON.stringify(after.data)===JSON.stringify(p.data),revision:after.revision,expected:p.revision,bad:projectionRecordSchema.safeParse({...rec,data:{...rec.data,onHand:'oops'}}).success}));await db.end();`,
    );
    expect(result).toMatchObject({ same: true, bad: false });
    expect(result.revision).toBe(result.expected);
    await expect(reporting.query("SELECT * FROM orders")).rejects.toMatchObject(
      { code: "42P01" },
    );
    expect(
      (
        await api(owner, "/v1/internal/projections/snapshot", "POST", {})
      ).status(),
    ).toBe(404);
    const unsigned = machine(
      "reporting",
      `const r=await fetch(process.env.SALES_URL+'/v1/internal/projections/snapshot',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});console.log(JSON.stringify(r.status));`,
    );
    expect(unsigned).toBe(403);
    const race = machine(
      "reporting",
      `
      import {db} from './dist/packages/platform/db.js';
      import {applyProjection} from './dist/packages/platform/projections.js';
      import {randomUUID} from 'node:crypto';
      const a=await db.connect(),b=await db.connect(),id=randomUUID();
      const first={kind:'SKU',id,tenantId:randomUUID(),siteId:null,revision:1,data:{code:'RACE',name:'First tenant',baseUnit:'Goi',status:'ACTIVE'}};
      let rejected=false,blocked=false,preserved=false;
      try{
        await a.query('BEGIN');await b.query('BEGIN');
        await applyProjection(a,'catalog',first);
        const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
        const second=applyProjection(b,'catalog',{...first,tenantId:randomUUID(),revision:2,data:{...first.data,name:'Other tenant'}}).then(()=>false,()=>true);
        for(let n=0;n<100;n++){
          const activity=(await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0];
          if(activity?.wait_event_type==='Lock'){blocked=true;break;}
          await new Promise(r=>setTimeout(r,20));
        }
        await a.query('COMMIT');rejected=await second;await b.query('ROLLBACK');
        const saved=(await db.query("SELECT tenant_id,data FROM read_records WHERE producer='catalog' AND kind='SKU' AND id=$1",[id])).rows[0];
        preserved=saved.tenant_id===first.tenantId&&saved.data.name===first.data.name;
      }finally{
        await a.query('ROLLBACK');await b.query('ROLLBACK');a.release();b.release();
        await db.query("DELETE FROM read_records WHERE producer='catalog' AND kind='SKU' AND id=$1",[id]);await db.end();
      }
      console.log(JSON.stringify({blocked,rejected,preserved}));
    `,
    );
    expect(race).toEqual({ blocked: true, rejected: true, preserved: true });
  });
  test("W9-10 Reconciliation rebuilds a missing read record without changing its source", async () => {
    const before = (
      await inventory.query(
        "SELECT on_hand,inventory_value FROM stock_balances WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3",
        [tenant, site.warehouse_id, sku.id],
      )
    ).rows[0];
    await reporting.query(
      "DELETE FROM read_records WHERE producer='inventory' AND tenant_id=$1 AND site_id=$2",
      [tenant, site.id],
    );
    await reporting.query(
      "UPDATE projection_sync SET next_attempt_at=now() WHERE producer='inventory'",
    );
    await expect
      .poll(
        async () =>
          (
            await reporting.query(
              "SELECT count(*) FROM read_records WHERE kind='STOCK' AND tenant_id=$1 AND site_id=$2",
              [tenant, site.id],
            )
          ).rows[0].count,
        { timeout: 30000 },
      )
      .toBe("1");
    expect(
      (
        await inventory.query(
          "SELECT on_hand,inventory_value FROM stock_balances WHERE tenant_id=$1 AND warehouse_id=$2 AND sku_id=$3",
          [tenant, site.warehouse_id, sku.id],
        )
      ).rows[0],
    ).toEqual(before);
  });
  test("W9-11 Consumer outage does not block checkout and recovers after restart", async () => {
    test.setTimeout(150000);
    compose("stop", "notification");
    try {
      order = await sell();
      expect(order.status).toBe("COMPLETED");
    } finally {
      compose("start", "notification");
    }
    await expect
      .poll(
        async () =>
          (
            await notification.query(
              "SELECT data->>'status' status FROM read_records WHERE producer='sales' AND id=$1",
              [order.id],
            )
          ).rows[0]?.status,
        { timeout: 60000 },
      )
      .toBe("COMPLETED");
  });
  test("W9-12 Pending-payment and shift-variance alerts follow source settlement", async () => {
    const q = await good(
      await cmd("sales/quotes", {
        siteId: site.id,
        lines: [{ skuId: sku.id, unitId: sku.units[0].id, quantity: "1" }],
        discount: { type: "AMOUNT", value: "0" },
      }),
    );
    let d = await good(await cmd("orders", { quoteId: q.id, note: "" }));
    await good(
      await cmd(`orders/${d.id}/checkout`, {
        version: d.version,
        shiftId: shift.id,
        tenderedVnd: d.payable_vnd,
      }),
    );
    await expect
      .poll(
        async () => {
          d = await good(await get("orders/" + d.id));
          return d.checkout?.payment?.status;
        },
        { timeout: 30000 },
      )
      .toBe("PENDING");
    await finance.query(
      "UPDATE payments SET created_at=now()-interval '2 minutes' WHERE id=$1",
      [d.checkout.payment.id],
    );
    const pending = await waitWork("PAYMENT_PENDING");
    expect(pending.detail.sourceId).toBe(d.id);
    await role("CASHIER");
    expect(
      (await work("ACTIVE", staff)).items.some((r: any) => r.id === pending.id),
    ).toBe(false);
    await role("MANAGER");
    await good(
      await cmd(`orders/${d.id}/cancel`, {
        version: d.version,
        reason: "Khách đổi nhu cầu mua hàng",
      }),
    );
    await expect
      .poll(
        async () =>
          (await work("RESOLVED")).items.some((r: any) => r.id === pending.id),
        { timeout: 30000 },
      )
      .toBe(true);
    const current = await good(await get("shifts/" + shift.id));
    shift = await good(
      await cmd(`shifts/${shift.id}/close`, {
        siteId: site.id,
        version: current.version,
        countedCash: (BigInt(current.expected_now) - 10000n).toString(),
        note: "Thiếu tiền lẻ khi giao ca",
      }),
    );
    const variance = await waitWork("SHIFT_VARIANCE");
    expect(variance.detail.differenceVnd).toBe("-10000");
    await page.goto("/");
    await page.getByLabel("Chọn hộ kinh doanh").selectOption(tenant);
    await page.getByRole("button", { name: "Công việc", exact: true }).click();
    await page.getByLabel("Địa điểm báo cáo").selectOption(site.id);
    await page.getByLabel("Loại công việc").selectOption("SHIFT_VARIANCE");
    await page
      .getByRole("button", { name: "Mở chứng từ", exact: true })
      .click();
    await expect(page.locator(".drawer-desk")).toContainText("10.000");
    await good(
      await cmd(
        `shifts/${shift.id}/approve-variance`,
        { version: shift.version, note: "Đã đối chiếu tiền và chứng từ" },
        staff,
      ),
    );
    await expect
      .poll(
        async () =>
          (await work("RESOLVED")).items.some((r: any) => r.id === variance.id),
        { timeout: 30000 },
      )
      .toBe(true);
  });
  test("W9-13 Work opens real stock and reports export on desktop and mobile", async () => {
    test.setTimeout(120000);
    await page.goto("/");
    await page.getByLabel("Chọn hộ kinh doanh").selectOption(tenant);
    await page.getByRole("button", { name: "Báo cáo", exact: true }).click();
    await page.getByLabel("Địa điểm báo cáo").selectOption(site.id);
    await expect(page.locator(".report-metric").first()).toContainText(
      "285.000",
    );
    await page.screenshot({
      path: evidence + "/01-sales-report.png",
      fullPage: true,
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.getByRole("button", { name: "Xuất CSV", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Tải tệp CSV", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Tải tệp CSV", exact: true })
      .click();
    expect((await downloadPromise).suggestedFilename()).toContain(
      "Storeluma-sales",
    );
    await page
      .getByRole("button", { name: "Tồn kho hiện tại", exact: true })
      .click();
    await expect(page.locator(".report-table")).toContainText(sku.code);
    await page.screenshot({
      path: evidence + "/02-stock-report.png",
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Thu chi tại quầy", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Thu chi theo ngày" }),
    ).toBeVisible();
    await page.screenshot({
      path: evidence + "/03-cash-report.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Công việc", exact: true }).click();
    await page.getByLabel("Địa điểm báo cáo").selectOption(site.id);
    await expect(page.locator(".work-item")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Cấu hình nhắc việc", exact: true })
      .click();
    await page.getByLabel("Địa điểm cấu hình").selectOption(site.id);
    await expect(page.getByLabel("Ngưỡng tồn khả dụng")).toHaveValue("10.000");
    await page.screenshot({
      path: evidence + "/04-work-inbox.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Mở tồn kho", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Kho hàng", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".stock-room")).toContainText(sku.code);
    await page.getByRole("button", { name: "Báo cáo", exact: true }).click();
    await page.getByLabel("Địa điểm báo cáo").selectOption(site.id);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".report-metric").first()).toContainText(
      "285.000",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: evidence + "/05-mobile-report.png",
      fullPage: false,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(errors).toEqual([]);
  });
});
