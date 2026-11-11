import { fixtureFile } from './helpers/fixtures';
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
test.describe.serial("Week 8 POS, returns and drawer settlement", () => {
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
    evidence = process.env.WEEK08_SCREENSHOTS ?? "tmp/week08/screenshots";
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
          code: `K8-${run}-${++sequence}`,
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
      fixtureFile("week05-fixture.json"),
      fixtureFile("week06-fixture.json"),
      fixtureFile("week07-fixture.json"),
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
        fixtureFile("week07-fixture.json"),
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
    const createdSite = await good(
      await cmd("sites", {
        name: "Cửa hàng An Mộc - Quầy bán",
        code: "S8-" + run,
        address: "Quận 7, TP. Hồ Chí Minh",
      }),
    );
    site = createdSite;
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
  async function sell(quantity = "2", discount = "4000", s = sku) {
    const q = await good(
      await cmd("sales/quotes", quoteBody(s, quantity, discount)),
    );
    let d = await good(await cmd("orders", { quoteId: q.id }));
    d = await checkout(d);
    await good(await confirm(d));
    return terminal(d);
  }
  const requestReturn = (
    d: any,
    quantity = "1",
    disposition = "SELLABLE",
    ctx = owner,
    key = randomUUID(),
  ) =>
    cmd(
      "orders/" + d.id + "/returns",
      {
        reason: "Khách trả hàng còn nguyên",
        lines: [{ orderLineId: d.lines[0].id, quantity, disposition }],
      },
      ctx,
      key,
    );
  async function returnState(d: any, status: string) {
    let result: any;
    await expect
      .poll(
        async () => {
          const response = await get("returns/" + d.id);
          if (response.status() === 503) return "STARTING";
          result = await good(response);
          return result.status;
        },
        { timeout: 60000 },
      )
      .toBe(status);
    return result;
  }
  async function approve(d: any) {
    return good(
      await cmd("returns/" + d.id + "/approve", {
        version: d.version,
        note: "Đã kiểm tra hàng và chứng từ",
      }),
    );
  }
  async function waitingRefund(d: any) {
    let result: any;
    await expect
      .poll(
        async () => {
          const response = await get("returns/" + d.id);
          if (response.status() === 503) return "STARTING";
          result = await good(response);
          return result.progress?.refund?.status;
        },
        { timeout: 60000 },
      )
      .toBe("PENDING");
    return result;
  }
  async function prepareRefund(d: any) {
    d = await waitingRefund(d);
    return good(
      await cmd("refunds/" + d.refund_id + "/prepare", {
        shiftId: shift.id,
        version: d.progress.refund.version,
      }),
    );
  }
  async function payReturn(d: any) {
    const f = await prepareRefund(d);
    await good(
      await cmd("refunds/" + f.id + "/confirm", {
        shiftId: shift.id,
        version: f.version,
        cashPaid: true,
      }),
    );
    return returnState(d, "COMPLETED");
  }
  async function finishReturn(d: any) {
    await approve(d);
    return payReturn(d);
  }
  async function cancelReturn(d: any) {
    return good(
      await cmd("returns/" + d.id + "/cancel", {
        version: d.version,
        reason: "Khách giữ lại hàng",
      }),
    );
  }
  async function closeShift() {
    const s = await good(await get("shifts/" + shift.id));
    return good(
      await cmd("shifts/" + s.id + "/close", {
        siteId: site.id,
        version: s.version,
        countedCash: s.expected_now,
        note: "",
      }),
    );
  }
  async function openShift(openingCash = "500000") {
    shift = await good(
      await cmd("shifts", { siteId: site.id, openingCash }, staff),
    );
    return shift;
  }
  let returned: any;
  test("W8-01 Receipt rejects draft and uses completed immutable line snapshots", async () => {
    const d = await draft();
    expect((await get("orders/" + d.id + "/receipt")).status()).toBe(409);
    await cancel(d);
    completed = await sell();
    const receipt = await good(
      await get("orders/" + completed.id + "/receipt"),
    );
    expect(receipt.snapshot.paidVnd).toBe("166000");
    expect(receipt.snapshot.invoiceStatus).toBe("NOT_ISSUED");
    expect(JSON.stringify(receipt)).not.toContain("costVnd");
    const key = randomUUID(),
      first = await good(
        await cmd("orders/" + completed.id + "/receipt/prints", {}, owner, key),
      ),
      retry = await good(
        await cmd("orders/" + completed.id + "/receipt/prints", {}, owner, key),
      );
    expect(first.reprint).toBe(false);
    expect(retry.printNumber).toBe(1);
    const reprint = await good(
      await cmd("orders/" + completed.id + "/receipt/prints", {}),
    );
    expect(reprint.reprint).toBe(true);
    expect(reprint.snapshot).toEqual(first.snapshot);
    expect((await read(completed)).version).toBe(completed.version);
  });
  test("W8-02 Partial return uses allocated original net and records no effects before approval", async () => {
    const before = await balance();
    returned = await good(await requestReturn(completed));
    expect(returned.amount_vnd).toBe("83000");
    expect(returned.lines[0].costVnd).toBe("40000");
    expect((await balance()).on_hand).toBe(before.on_hand);
    expect(
      (
        await fin.query("SELECT count(*) FROM refunds WHERE return_id=$1", [
          returned.id,
        ])
      ).rows[0].count,
    ).toBe("0");
  });
  test("W8-03 Active return blocks competing allocation and changed idempotent body", async () => {
    expect((await requestReturn(completed)).status()).toBe(409);
    const d = await sell(),
      key = randomUUID();
    const results = await Promise.all([
      requestReturn(d, "1", "SELLABLE", owner, key),
      requestReturn(d, "1", "SELLABLE", owner, key),
    ]);
    const a = await good(results[0]),
      b = await good(results[1]);
    expect(a.id).toBe(b.id);
    expect(
      (await requestReturn(d, "0.5", "SELLABLE", owner, key)).status(),
    ).toBe(409);
    await cancelReturn(a);
  });
  test("W8-04 Return quantity, duplicate lines and source order are validated", async () => {
    const d = await sell();
    expect((await requestReturn(d, "2.001")).status()).toBe(409);
    const line = {
      orderLineId: d.lines[0].id,
      quantity: "1",
      disposition: "SELLABLE",
    };
    expect(
      (
        await cmd("orders/" + d.id + "/returns", {
          reason: "Trả hàng",
          lines: [line, line],
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await cmd("orders/" + d.id + "/returns", {
          reason: "Trả hàng",
          lines: [{ ...line, orderLineId: randomUUID() }],
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await cmd("orders/" + d.id + "/returns", {
          reason: "Trả hàng",
          lines: [line],
          amountVnd: "1",
        })
      ).status(),
    ).toBe(400);
  });
  test("W8-05 Approval enforces role and separation with a second manager", async () => {
    expect(
      (
        await cmd(
          "returns/" + returned.id + "/approve",
          { version: returned.version, note: "" },
          staff,
        )
      ).status(),
    ).toBe(403);
    await role("MANAGER");
    expect(
      (
        await cmd("returns/" + returned.id + "/approve", {
          version: returned.version,
          note: "",
        })
      ).status(),
    ).toBe(403);
    await good(
      await cmd(
        "returns/" + returned.id + "/approve",
        { version: returned.version, note: "Kiểm tra hàng nguyên vẹn" },
        staff,
      ),
    );
    await role("CASHIER");
    await waitingRefund(returned);
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM audit WHERE entity_id=$1 AND action='RETURN_APPROVED'",
          [returned.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W8-06 Stock returns once while cash remains pending until explicit payment", async () => {
    const d = await waitingRefund(returned),
      f = d.progress.refund;
    expect(f.shift_id).toBeNull();
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_type='RETURN' AND document_id=$1",
          [d.id],
        )
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await fin.query("SELECT count(*) FROM cash_ledger WHERE refund_id=$1", [
          f.id,
        ])
      ).rows[0].count,
    ).toBe("0");
    expect(
      (
        await cmd("refunds/" + f.id + "/confirm", {
          shiftId: shift.id,
          version: f.version,
          cashPaid: true,
        })
      ).status(),
    ).toBe(409);
    const prepared = await prepareRefund(d);
    expect(
      (
        await cmd("refunds/" + f.id + "/confirm", {
          shiftId: shift.id,
          version: prepared.version,
          cashPaid: false,
        })
      ).status(),
    ).toBe(400);
    const current = await good(await get("shifts/" + shift.id));
    expect(current.pendingRefunds).toHaveLength(1);
    expect(
      (
        await cmd("shifts/" + shift.id + "/close", {
          siteId: site.id,
          version: shift.version,
          countedCash: current.expected_now,
          note: "",
        })
      ).status(),
    ).toBe(409);
    const key = randomUUID(),
      body = { shiftId: shift.id, version: prepared.version, cashPaid: true };
    await Promise.all([
      good(await cmd("refunds/" + f.id + "/confirm", body, owner, key)),
      good(await cmd("refunds/" + f.id + "/confirm", body, owner, key)),
    ]);
    await returnState(d, "COMPLETED");
    expect(
      (
        await fin.query(
          "SELECT amount_vnd FROM cash_ledger WHERE refund_id=$1",
          [f.id],
        )
      ).rows,
    ).toEqual([{ amount_vnd: "-83000" }]);
  });
  test("W8-07 Replaying received and refunded work never duplicates stock or money", async () => {
    const ref = { tenantId: tenant, returnId: returned.id };
    const before = await balance();
    expect(machine("inventory", "return/receive", ref).status).toBe(200);
    expect(machine("finance", "refund/create", ref).body.status).toBe(
      "SUCCEEDED",
    );
    expect((await balance()).on_hand).toBe(before.on_hand);
    expect(
      (
        await inv.query("SELECT count(*) FROM return_receipts WHERE id=$1", [
          returned.id,
        ])
      ).rows[0].count,
    ).toBe("1");
    expect(
      (
        await sales.query(
          "SELECT count(*) FROM outbox WHERE type='sales.return-completed.v1' AND payload->>'aggregateId'=$1",
          [returned.id],
        )
      ).rows[0].count,
    ).toBe("1");
    expect((await read(completed)).status).toBe("COMPLETED");
    expect(
      (await good(await get("orders/" + completed.id + "/returns")))
        .returnStatus,
    ).toBe("PARTIAL");
  });
  test("W8-08 Final return reaches full net and cost while original order stays immutable", async () => {
    const d = await good(await requestReturn(completed));
    await finishReturn(d);
    const items = await good(await get("orders/" + completed.id + "/returns"));
    expect(items.returnStatus).toBe("FULL");
    expect(
      items.items.reduce((n: bigint, x: any) => n + BigInt(x.amount_vnd), 0n),
    ).toBe(166000n);
    expect((await requestReturn(completed, "0.001")).status()).toBe(409);
    const original = await read(completed);
    expect(original.lines).toEqual(completed.lines);
    expect(original.payable_vnd).toBe(completed.payable_vnd);
  });
  test("W8-09 Fractional cumulative rounding returns all residual dong exactly", async () => {
    const d = await sell("1", "1");
    const amounts = [];
    for (const quantity of ["0.333", "0.333", "0.334"]) {
      const ret = await good(await requestReturn(d, quantity));
      amounts.push(BigInt(ret.amount_vnd));
      await finishReturn(ret);
    }
    expect(amounts.reduce((a, b) => a + b, 0n)).toBe(84999n);
    const rows = (
      await sales.query(
        "SELECT lines FROM returns WHERE order_id=$1 AND status='COMPLETED'",
        [d.id],
      )
    ).rows;
    expect(rows.reduce((n, x) => n + BigInt(x.lines[0].costVnd), 0n)).toBe(
      40000n,
    );
  });
  test("W8-10 Damaged returns preserve cost in quarantine and remain unavailable", async () => {
    const d = await sell("1", "0"),
      before = await balance(),
      ret = await good(await requestReturn(d, "1", "QUARANTINE"));
    await finishReturn(ret);
    const after = await balance();
    expect(Number(after.on_hand) - Number(before.on_hand)).toBe(1);
    expect(Number(after.quarantined) - Number(before.quarantined)).toBe(1);
    expect(after.available).toBe(before.available);
    expect(BigInt(after.inventory_value) - BigInt(before.inventory_value)).toBe(
      40000n,
    );
    const movement = (
      await good(
        await get(
          "stock-movements?siteId=" +
            site.id +
            "&type=RETURN",
        ),
      )
    ).items.find((m: any) => m.document_id === ret.id);
    expect(movement).toBeTruthy();
  });
  test("W8-11 Frozen SKU leaves approved return pending without stock or cash effects", async () => {
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d));
    const count = await good(
      await cmd("stock-counts", {
        siteId: site.id,
        warehouseId: site.warehouse_id,
        note: "Kiểm trước nhận trả",
        lines: [{ skuId: sku.id }],
      }),
    );
    await good(
      await cmd("stock-counts/" + count.id + "/start", {
        version: count.version,
      }),
    );
    try {
      await approve(ret);
      await expect
        .poll(
          async () =>
            (await good(await get("returns/" + ret.id))).progress?.last_error,
          { timeout: 15000 },
        )
        .toContain("kiểm kho");
      expect(
        (
          await inv.query("SELECT count(*) FROM return_receipts WHERE id=$1", [
            ret.id,
          ])
        ).rows[0].count,
      ).toBe("0");
    } finally {
      const live = await good(await get("stock-counts/" + count.id));
      await good(
        await cmd("stock-counts/" + count.id + "/cancel", {
          version: live.version,
        }),
      );
    }
    await payReturn(ret);
  });
  test("W8-12 Finance outage after stock receipt preserves received goods and recovers", async () => {
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d));
    compose("stop", "finance");
    try {
      await approve(ret);
      await returnState(ret, "REFUND_PENDING");
      expect(
        (
          await inv.query("SELECT count(*) FROM return_receipts WHERE id=$1", [
            ret.id,
          ])
        ).rows[0].count,
      ).toBe("1");
    } finally {
      compose("start", "finance");
    }
    await payReturn(ret);
  });
  test("W8-13 Sales restart retains return and refund IDs without double receiving", async () => {
    test.setTimeout(150000);
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d));
    await approve(ret);
    await waitingRefund(ret);
    compose("restart", "sales");
    const resumed = await waitingRefund(ret);
    expect(resumed.refund_id).toBe(ret.refund_id);
    await payReturn(ret);
    expect(
      (
        await inv.query(
          "SELECT count(*) FROM stock_movements WHERE document_type='RETURN' AND document_id=$1",
          [ret.id],
        )
      ).rows[0].count,
    ).toBe("1");
  });
  test("W8-14 Inventory outage keeps return approved until receipt can be verified", async () => {
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d));
    compose("stop", "inventory");
    try {
      await approve(ret);
      await expect
        .poll(
          async () =>
            (await good(await get("returns/" + ret.id))).progress?.last_error,
          { timeout: 15000 },
        )
        .toBeTruthy();
      expect((await good(await get("returns/" + ret.id))).status).toBe(
        "APPROVED",
      );
      expect(
        (
          await fin.query("SELECT count(*) FROM refunds WHERE return_id=$1", [
            ret.id,
          ])
        ).rows[0].count,
      ).toBe("0");
    } finally {
      compose("start", "inventory");
    }
    await payReturn(ret);
  });
  test("W8-15 Overdue return requires explicit manager exception reason", async () => {
    const d = await sell("1", "0");
    await sales.query(
      "UPDATE orders SET completed_at=now()-interval '8 days' WHERE id=$1",
      [d.id],
    );
    const ret = await good(await requestReturn(d));
    expect(ret.late_return).toBe(true);
    expect(
      (
        await cmd("returns/" + ret.id + "/approve", {
          version: ret.version,
          note: "",
        })
      ).status(),
    ).toBe(409);
    await finishReturn(ret);
  });
  test("W8-16 Cancel requested return releases allocation but approved return cannot cancel", async () => {
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d));
    await cancelReturn(ret);
    const next = await good(await requestReturn(d));
    await approve(next);
    expect(
      (
        await cmd("returns/" + next.id + "/cancel", {
          version: next.version + 1,
          reason: "Hủy sau duyệt",
        })
      ).status(),
    ).toBe(409);
    await payReturn(next);
  });
  test("W8-17 Roles, tenant boundaries and internal namespaces remain enforced", async () => {
    expect((await get("returns/" + returned.id, outsider)).status()).toBe(404);
    await role("STOCK");
    expect((await get("returns/" + returned.id, staff)).status()).toBe(403);
    expect(
      (await get("orders/" + completed.id + "/receipt", staff)).status(),
    ).toBe(403);
    await role("CASHIER");
    const readable = await good(await get("returns/" + returned.id, staff));
    expect(JSON.stringify(readable)).not.toContain("costVnd");
    expect(
      (
        await api(owner, "/v1/internal/workflows/refund/create", "POST", {
          tenantId: tenant,
          returnId: returned.id,
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await cmd(
          "returns/" + returned.id + "/approve",
          { version: returned.version, note: "" },
          staff,
        )
      ).status(),
    ).toBe(403);
  });
  test("W8-18 Drawer totals separate sales, refunds, opening cash and expenses", async () => {
    await closeShift();
    await openShift("500000");
    const small = await product("Trà lài túi lọc", "100000");
    await seed(small, "10", "30000");
    const d = await sell("2", "0", small),
      ret = await good(await requestReturn(d, "0.5"));
    await finishReturn(ret);
    await good(
      await cmd(
        "shifts/" + shift.id + "/cash-entries",
        { kind: "OUT", amountVnd: "20000", reason: "Chi giao hàng tại quầy" },
        staff,
      ),
    );
    const snapshot = await good(await get("shifts/" + shift.id));
    expect(snapshot.expected_now).toBe("630000");
    expect(snapshot.totals).toMatchObject({
      sales: "200000",
      refunds: "50000",
      adjustments: "-20000",
    });
    const n = await good(
      await cmd(
        "shifts/" + shift.id + "/close",
        {
          siteId: site.id,
          version: shift.version,
          countedCash: "620000",
          note: "Thiếu tiền lẻ khi giao ca",
        },
        staff,
      ),
    );
    expect(n.difference_vnd).toBe("-10000");
    shift = n;
  });
  test("W8-19 Variance approval records manager identity and cannot change closed totals", async () => {
    expect(
      (
        await cmd(
          "shifts/" + shift.id + "/approve-variance",
          { version: shift.version, note: "Đã đối chiếu chứng từ" },
          staff,
        )
      ).status(),
    ).toBe(403);
    const n = await good(
      await cmd("shifts/" + shift.id + "/approve-variance", {
        version: shift.version,
        note: "Đã đối chiếu chứng từ",
      }),
    );
    expect(n.variance_approved_by).toBe(accounts[0].subject);
    expect(n.expected_cash).toBe("630000");
    expect(
      (
        await cmd("shifts/" + shift.id + "/cash-entries", {
          kind: "IN",
          amountVnd: "10000",
          reason: "Bù quỹ",
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await cmd("shifts/" + shift.id + "/close", {
          siteId: site.id,
          version: n.version,
          countedCash: "630000",
          note: "",
        })
      ).status(),
    ).toBe(409);
  });
  test("W8-20 Reversal posts to a new open shift and keeps the original entry unchanged", async () => {
    const closedId = shift.id,
      old = (
        await fin.query("SELECT * FROM cash_entries WHERE shift_id=$1", [
          closedId,
        ])
      ).rows[0];
    await openShift();
    const key = randomUUID(),
      body = { shiftId: shift.id, reason: "Điều chỉnh phiếu chi trùng" };
    const a = await good(
      await cmd("cash-entries/" + old.id + "/reverse", body, owner, key),
    );
    await good(
      await cmd("cash-entries/" + old.id + "/reverse", body, owner, key),
    );
    expect(a.amount_vnd).toBe("20000");
    expect(
      (await cmd("cash-entries/" + old.id + "/reverse", body)).status(),
    ).toBe(409);
    expect((await good(await get("shifts/" + closedId))).expected_cash).toBe(
      "630000",
    );
    expect((await good(await get("shifts/" + shift.id))).expected_now).toBe(
      "520000",
    );
  });
  test("W8-21 Closing competes atomically with a drawer posting", async () => {
    const snapshot = await good(await get("shifts/" + shift.id));
    const result = await Promise.all([
      cmd("shifts/" + shift.id + "/cash-entries", {
        kind: "IN",
        amountVnd: "1000",
        reason: "Bổ sung tiền lẻ",
      }),
      cmd("shifts/" + shift.id + "/close", {
        siteId: site.id,
        version: shift.version,
        countedCash: snapshot.expected_now,
        note: "Đối chiếu thao tác đồng thời",
      }),
    ]);
    expect(result[1].status()).toBeLessThan(300);
    const closed = await good(await get("shifts/" + shift.id));
    expect(closed.expected_cash).toBe(
      result[0].status() < 300 ? "521000" : "520000",
    );
    await openShift();
  });
  test("W8-22 Return from a closed sale shift posts refund only to the current shift", async () => {
    const d = await sell("1", "0"),
      oldShift = await closeShift();
    await openShift();
    const ret = await good(await requestReturn(d));
    await finishReturn(ret);
    expect((await good(await get("shifts/" + oldShift.id))).expected_cash).toBe(
      oldShift.expected_cash,
    );
    const ledger = (
      await fin.query(
        "SELECT shift_id,amount_vnd FROM cash_ledger WHERE refund_id=$1",
        [ret.refund_id],
      )
    ).rows[0];
    expect(ledger.shift_id).toBe(shift.id);
    expect(ledger.amount_vnd).toBe("-85000");
  });
  test("W8-23 Broker interruption retains return and refund events until recovery", async () => {
    test.setTimeout(150000);
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d));
    compose("stop", "rabbitmq");
    try {
      await finishReturn(ret);
      expect(
        (
          await sales.query(
            "SELECT count(*) FROM outbox WHERE type='sales.return-completed.v1' AND payload->>'aggregateId'=$1 AND delivered_at IS NULL",
            [ret.id],
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
              "SELECT count(*) FROM outbox WHERE type='sales.return-completed.v1' AND payload->>'aggregateId'=$1 AND delivered_at IS NULL",
              [ret.id],
            )
          ).rows[0].count,
        { timeout: 60000 },
      )
      .toBe("0");
  });
  test("W8-24 A changed role blocks new refund actions but admitted saga still recovers", async () => {
    const d = await sell("1", "0"),
      ret = await good(await requestReturn(d, "1", "SELLABLE", staff));
    await approve(ret);
    const f = await prepareRefund(ret);
    await role("STOCK");
    try {
      expect(
        (
          await cmd(
            "refunds/" + f.id + "/confirm",
            { shiftId: shift.id, version: f.version, cashPaid: true },
            staff,
          )
        ).status(),
      ).toBe(403);
      await good(
        await cmd("refunds/" + f.id + "/confirm", {
          shiftId: shift.id,
          version: f.version,
          cashPaid: true,
        }),
      );
      await returnState(ret, "COMPLETED");
    } finally {
      await role("CASHIER");
    }
  });
  test("W8-25 Date filtering and print retry preserve the completed receipt after catalog change", async () => {
    const d = await sell("1", "0"),
      receipt = await good(await cmd("orders/" + d.id + "/receipt/prints", {}));
    const current = await good(await get("skus/" + sku.id));
    await good(
      await cmd(
        "skus/" + sku.id,
        {
          version: current.version,
          name: "Cà phê đổi tên sau bán",
          barcode: current.barcode,
          status: "ACTIVE",
        },
        owner,
        randomUUID(),
        "PATCH",
      ),
    );
    const reprint = await good(
      await cmd("orders/" + d.id + "/receipt/prints", {}),
    );
    expect(reprint.snapshot).toEqual(receipt.snapshot);
    expect(reprint.snapshot.lines[0].name).not.toBe("Cà phê đổi tên sau bán");
    const renamed=await good(await get('skus/'+sku.id));await good(await cmd('skus/'+sku.id,{version:renamed.version,name:sku.name,barcode:renamed.barcode,status:'ACTIVE'},owner,randomUUID(),'PATCH'));
    expect(
      (
        await good(
          await get(
            "orders?siteId=" +
              site.id +
              "&q=" +
              d.code +
              "&from=2000-01-01T00:00:00Z&to=2001-01-01T00:00:00Z",
          ),
        )
      ).items,
    ).toHaveLength(0);
    expect(
      (await good(await get("orders?siteId=" + site.id + "&q=" + d.code)))
        .items[0].id,
    ).toBe(d.id);
  });
  let uiOrder: any;
  test("W8-26 Real POS keyboard scan, cash sale and 80mm receipt with reprint", async () => {
    test.setTimeout(150000);
    await page.goto("/");
    await page.getByLabel("Chọn hộ kinh doanh").selectOption(tenant);
    await page.getByRole("button", { name: "Đơn bán", exact: true }).click();
    await page.getByLabel("Địa điểm bán hàng").selectOption(site.id);
    await page.getByRole("button", { name: "Tạo đơn bán" }).click();
    await page.keyboard.press("F2");
    await expect(page.getByLabel("Tìm hàng bán")).toBeFocused();
    await page.getByLabel("Tìm hàng bán").fill(sku.code);
    await page.getByLabel("Tìm hàng bán").press("Enter");
    await expect(page.getByLabel("Số lượng 1", { exact: true })).toHaveValue(
      "1",
    );
    await page.getByLabel("Tìm hàng bán").fill(sku.code);
    await page.getByLabel("Tìm hàng bán").press("Enter");
    await expect(page.getByLabel("Số lượng 1", { exact: true })).toHaveValue(
      "2.000",
    );
    expect(await page.locator(".sale-cart-line").count()).toBe(1);
    await page
      .getByRole("button", { name: "Cập nhật báo giá", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Lưu đơn nháp" }),
    ).toBeEnabled();
    await page.locator('.sale-workspace').screenshot({ path: evidence + "/01-pos.png" });
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/orders") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Lưu đơn nháp" }).click();
    uiOrder = await (await saved).json();
    await page.getByLabel("Tiền khách đưa").fill("200000");
    await page.getByRole("button", { name: "Tiến hành thanh toán" }).click();
    await expect(
      page.getByText("Đã nhận đủ tiền và trả lại tiền thừa"),
    ).toBeVisible({ timeout: 30000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Xác nhận đã thu tiền" }).click();
    await expect(page.getByText("Đã thu tiền và xuất kho")).toBeVisible({
      timeout: 45000,
    });
    await page.getByRole("button", { name: "Xem / in biên nhận" }).click();
    const receipt = page.getByRole("dialog", { name: "Biên nhận bán hàng" });
    await expect(receipt).toBeVisible();
    await expect(receipt.getByText("BẢN IN LẠI", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      receipt.getByText("Biên nhận nội bộ, không phải hóa đơn điện tử."),
    ).toBeVisible();
    await page.evaluate(() => {
      (window as any).printCalls = 0;
      window.print = () => {
        (window as any).printCalls++;
      };
    });
    await page
      .getByRole("button", { name: "In biên nhận", exact: true })
      .click();
    expect(await page.evaluate(() => (window as any).printCalls)).toBe(1);
    await page.screenshot({ path: evidence + "/02-receipt-preview.png" });
    await page.emulateMedia({ media: "print" });
    expect(await page.locator(".receipt-controls").isVisible()).toBe(false);
    expect(
      (await page.locator(".receipt-paper").boundingBox())!.width,
    ).toBeCloseTo(302.36, 0);
    await expect(page.locator('.receipt-paper > img')).toHaveCSS('object-fit', 'cover');
    await page
      .locator(".receipt-paper")
      .screenshot({ path: evidence + "/03-receipt-80mm.png" });
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "Đóng bản in" }).click();
    await page.getByRole("button", { name: "Xem / in biên nhận" }).click();
    await expect(page.getByText("BẢN IN LẠI", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Đóng bản in" }).click();
    expect((await read(uiOrder)).status).toBe("COMPLETED");
  });
  test("W8-27 Real UI requests, approves and explicitly pays a partial return", async () => {
    test.setTimeout(120000);
    await page
      .getByRole("button", { name: "Lập phiếu trả", exact: true })
      .click();
    await page.getByLabel("Lượng trả 1", { exact: true }).fill("1");
    await page
      .getByLabel("Tình trạng trả 1", { exact: true })
      .selectOption("QUARANTINE");
    await page
      .getByLabel("Lý do trả hàng", { exact: true })
      .fill("Bao bì rách, nhận cách ly để kiểm tra");
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/returns") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Gửi yêu cầu trả hàng" }).click();
    const ret = await (await created).json();
    await page.getByRole("button", { name: "Duyệt nhận hàng trả" }).click();
    await expect(
      page.getByRole("button", { name: "Chuẩn bị hoàn tiền trên ca" }),
    ).toBeVisible({ timeout: 45000 });
    await page.locator('.after-sales').screenshot({
      path: evidence + "/04-return-pending.png",
    });
    await page
      .getByRole("button", { name: "Chuẩn bị hoàn tiền trên ca" })
      .click();
    await page.getByLabel("Đã giao đủ tiền hoàn cho khách").check();
    await page.getByRole("button", { name: "Xác nhận đã hoàn tiền" }).click();
    await expect(page.locator(".return-detail .return-badge")).toHaveText(
      "Hoàn tất",
      { timeout: 45000 },
    );
    await page.locator('.after-sales').screenshot({
      path: evidence + "/05-return-completed.png",
    });
    expect(
      (await good(await get("orders/" + uiOrder.id + "/returns"))).returnStatus,
    ).toBe("PARTIAL");
    expect(
      (
        await fin.query("SELECT count(*) FROM cash_ledger WHERE refund_id=$1", [
          ret.refund_id,
        ])
      ).rows[0].count,
    ).toBe("1");
  });
  test("W8-28 Real UI posts drawer expense and closes and reviews a cash variance", async () => {
    await page.getByRole("tab", { name: "Ca thu ngân", exact: true }).click();
    await expect(page.locator('.shift-history')).toHaveCSS('position','static');
    const historyBox=await page.locator('.shift-history').boundingBox();
    const workspaceBox=await page.locator('.workspace').boundingBox();
    expect(historyBox!.x).toBeGreaterThan(workspaceBox!.x);
    await expect(page.getByText("TIỀN DỰ KIẾN TẠI QUẦY")).toBeVisible();
    await page
      .getByRole("button", { name: "Thu / chi quầy", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Xử lý ca thu ngân" });
    await dialog.getByLabel("Số tiền xử lý ca").fill("10000");
    await dialog.getByLabel("Lý do / ghi chú").fill("Chi giao hàng cuối ca");
    await dialog.getByRole("button", { name: "Lưu xác nhận" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page
        .locator(".drawer-desk")
        .getByText("Chi giao hàng cuối ca", { exact: true }),
    ).toBeVisible();
    await page.locator('.drawer-desk').screenshot({
      path: evidence + "/06-shift-ledger.png",
    });
    const current = await good(await get("shifts/" + shift.id));
    await page.getByRole("button", { name: "Chốt ca", exact: true }).click();
    await dialog
      .getByLabel("Số tiền xử lý ca")
      .fill((BigInt(current.expected_now) - 1000n).toString());
    await dialog.getByLabel("Lý do / ghi chú").fill("Thiếu một nghìn tiền lẻ");
    await dialog.getByRole("button", { name: "Lưu xác nhận" }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("button", { name: "Xác nhận chênh lệch", exact: true })
      .click();
    await dialog.getByLabel("Lý do / ghi chú").fill("Đã đối chiếu giao ca");
    await dialog.getByRole("button", { name: "Lưu xác nhận" }).click();
    await expect(
      page.getByRole("heading", { name: "Đã xác nhận chênh lệch" }),
    ).toBeVisible();
    await page.locator('.drawer-desk').screenshot({
      path: evidence + "/07-shift-closed.png",
    });
  });
  test("W8-29 Returns and shift UI fit phone and tablet without horizontal overflow", async () => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: evidence + `/08-shift-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("tab", { name: "Trả hàng", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Phiếu trả hàng" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.locator('.sales-room').screenshot({
        path: evidence + `/09-returns-${width}.png`,
      });
      await page.getByRole("tab", { name: "Ca thu ngân", exact: true }).click();
    }
    await page.locator('.shift-summary').getByRole('button', { name: 'Mở ca', exact: true }).click();
    await expect(page.locator('.sale-shift-form')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Bán hàng', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  test("W8-30 Cashier shift lists hide other drawers while showing register occupancy", async () => {
    if ((await good(await get("shifts/" + shift.id))).status === 'OPEN') await closeShift();
    shift = await good(await cmd('shifts', {siteId: site.id, openingCash: '321987'}));
    const list = await good(await get('shifts?siteId=' + site.id, staff));
    expect(list.items.every((s: any) => s.cashier_id === accounts[1].subject)).toBe(true);
    expect(list.items.some((s: any) => s.id === shift.id)).toBe(false);
    expect(list.activeShift).toMatchObject({id: shift.id, status: 'OPEN', cashier_id: accounts[0].subject});
    for (const field of ['opening_cash','expected_now','counted_cash','difference_vnd','close_note','variance_approval_note'])
      expect(list.activeShift).not.toHaveProperty(field);
    expect((await get('shifts/' + shift.id, staff)).status()).toBe(403);
    const p = await staff.newPage();
    try {
      await p.goto('/');
      await p.getByLabel('Chọn hộ kinh doanh').selectOption(tenant);
      await p.getByRole('button', {name: 'Đơn bán', exact: true}).click();
      await p.getByLabel('Địa điểm bán hàng').selectOption(site.id);
      await expect(p.locator('.shift-summary').getByRole('button', {name: 'Đóng ca', exact: true})).toBeDisabled();
      await p.getByRole('tab', {name: 'Ca thu ngân', exact: true}).click();
      await expect(p.getByText('Quầy đang có ca do người khác mở.', {exact: true})).toBeVisible();
      await expect(p.getByRole('button', {name: 'Mở ca mới', exact: true})).toHaveCount(0);
      await p.locator('.drawer-desk').screenshot({path: evidence + '/10-cashier-shift-scope.png'});
    } finally { await p.close(); }
    await closeShift();
    const own = await openShift('123456');
    const ownList = await good(await get('shifts?siteId=' + site.id, staff));
    expect(ownList.items.find((s: any) => s.id === own.id)).toMatchObject({opening_cash: '123456', expected_now: '123456'});
    expect(ownList.items.some((s: any) => s.opening_cash === '321987')).toBe(false);
    await role('MANAGER');
    expect((await good(await get('shifts?siteId=' + site.id, staff))).items.some((s: any) => s.opening_cash === '321987')).toBe(true);
    await role('ACCOUNTANT');
    expect((await good(await get('shifts?siteId=' + site.id, staff))).items.some((s: any) => s.opening_cash === '321987')).toBe(true);
    await role('CASHIER');
  });
  test("W8-31 Cached cash commands still enforce current drawer ownership", async () => {
    test.setTimeout(120000);
    if ((await good(await get('shifts/' + shift.id))).status === 'OPEN') await closeShift();
    shift = await good(await cmd('shifts', {siteId: site.id, openingCash: '300000'}));
    let d = await checkout(await draft());
    const paymentBody = {siteId: site.id, version: d.checkout.payment.version, cashReceived: true}, paymentKey = randomUUID();
    const paid = await good(await cmd('payments/' + d.checkout.payment.id + '/confirm', paymentBody, owner, paymentKey));
    expect.soft((await cmd('payments/' + paid.id + '/confirm', paymentBody, staff, paymentKey)).status()).toBe(403);
    d = await terminal(d);
    let ret = await good(await requestReturn(d)); await approve(ret); ret = await waitingRefund(ret);
    const prepareBody = {shiftId: shift.id, version: ret.progress.refund.version}, prepareKey = randomUUID();
    const prepared = await good(await cmd('refunds/' + ret.refund_id + '/prepare', prepareBody, owner, prepareKey));
    expect.soft((await cmd('refunds/' + ret.refund_id + '/prepare', prepareBody, staff, prepareKey)).status()).toBe(403);
    const refundBody = {shiftId: shift.id, version: prepared.version, cashPaid: true}, refundKey = randomUUID();
    const refunded = await good(await cmd('refunds/' + ret.refund_id + '/confirm', refundBody, owner, refundKey));
    expect.soft((await cmd('refunds/' + ret.refund_id + '/confirm', refundBody, staff, refundKey)).status()).toBe(403);
    await returnState(ret, 'COMPLETED');
    const current = await good(await get('shifts/' + shift.id));
    const closeBody = {siteId: site.id, version: current.version, countedCash: current.expected_now, note: ''}, closeKey = randomUUID();
    const closed = await good(await cmd('shifts/' + shift.id + '/close', closeBody, owner, closeKey));
    expect.soft((await cmd('shifts/' + shift.id + '/close', closeBody, staff, closeKey)).status()).toBe(403);
    expect(await good(await cmd('payments/' + paid.id + '/confirm', paymentBody, owner, paymentKey))).toEqual(paid);
    expect(await good(await cmd('refunds/' + refunded.id + '/confirm', refundBody, owner, refundKey))).toEqual(refunded);
    expect(await good(await cmd('shifts/' + shift.id + '/close', closeBody, owner, closeKey))).toEqual(closed);
    expect((await fin.query('SELECT count(*) FROM cash_ledger WHERE payment_id=$1 OR refund_id=$2', [paid.id, refunded.id])).rows[0].count).toBe('2');
  });
});
