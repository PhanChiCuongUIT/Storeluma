import { expect, test, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool } from 'pg';
import { accounts, api, good, login } from '../tests/helpers/business-api';

const out = 'tmp/week11/load';
const project = process.env.COMPOSE_PROJECT_NAME;
const env = parseEnv(readFileSync('.env', 'utf8'));
function pool(name: string) {
  return new Pool({ host: '127.0.0.1', port: Number(env.PG_HOST_PORT ?? 55432),
    user: name, database: name + '_db', password: env[name.toUpperCase() + '_DB_PASSWORD'] });
}
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 90_000 }).trim();
const save = (name: string, value: unknown) => writeFileSync(out + '/' + name + '.json', JSON.stringify(value, null, 2));
const round = (n: number) => Math.round(n * 10) / 10;
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p: number) => round(sorted[Math.ceil(sorted.length * p) - 1]);
  return { n: sorted.length, p50: rank(.50), p95: rank(.95), p99: rank(.99), max: rank(1) };
}
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, timeout = 30000) {
  const end = performance.now() + timeout;
  do {
    const value = await read();
    if (accepts(value)) return value;
    await sleep(100);
  } while (performance.now() < end);
  throw new Error('Timed out waiting for the expected state');
}

test('checkout load and receipt backlog on a dedicated Compose stack', async ({ browser }) => {
  if (!project || project === 'storeluma') throw new Error('Select a dedicated Compose project');
  expect(docker('compose', 'port', 'gateway', '4100')).toMatch(/:4100$/);
  expect(docker('compose', 'port', 'postgres', '5432')).toMatch(new RegExp(':' + (env.PG_HOST_PORT ?? 55432) + '$'));
  mkdirSync(out, { recursive: true });
  const catalog = pool('catalog'), sales = pool('sales'), finance = pool('finance'), inventory = pool('inventory');
  const contexts: BrowserContext[] = [];
  const loginAs = async (index: number) => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await login(page, index);
    await page.close();
    return context;
  };
  try {
    const owner = await loginAs(0);
    const household = await good(await api(owner, '/v1/tenants', 'POST',
      { name: 'Cửa hàng An Phúc', site: { code: 'AP01', name: 'An Phúc' } }, randomUUID()));
    const tenant = household.tenantId, site = household.site, base = '/v1/tenants/' + tenant + '/';
    const command = async (route: string, data: unknown) => good(await api(owner, base + route, 'POST', data, randomUUID()));
    await until(async () => (await good(await api(owner, base + 'sites/' + site.id))).status, s => s === 'ACTIVE');
    const sku = (await command('products', { name: 'Trà sen', categoryId: null,
      sku: { code: 'TRA-SEN', name: 'Trà sen', baseUnit: 'Gói', priceVnd: '100000' } })).skus[0];
    const supplier = await command('suppliers', { code: 'AP-NCC', name: 'Nhà cung cấp An Phúc' });
    const shift = await command('shifts', { siteId: site.id, openingCash: '0' });
    const receiptIds: string[] = [];
    let elapsed: number;
    docker('compose', 'stop', 'finance');
    try {
      for (let i = 0; i < 100; i++) {
        const receipt = await command('receipts', { siteId: site.id, warehouseId: site.warehouse_id,
          supplierId: supplier.id, sourceType: 'PURCHASE',
          lines: [{ skuId: sku.id, unitId: sku.units[0].id, qty: '10', unitCostVnd: '40000' }] });
        await command('receipts/' + receipt.id + '/post', { version: receipt.version });
        receiptIds.push(receipt.id);
      }
      await until(async () => (await inventory.query("SELECT id FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'tenantId'=$1 AND delivered_at IS NOT NULL", [tenant])).rowCount, n => n === 100);
      expect((await finance.query('SELECT id FROM payables WHERE tenant_id=$1', [tenant])).rowCount).toBe(0);
      const restart = performance.now();
      docker('compose', 'start', 'finance');
      await until(async () => (await finance.query('SELECT id FROM payables WHERE receipt_id=ANY($1::uuid[])', [receiptIds])).rowCount, n => n === 100, 60000);
      elapsed = round(performance.now() - restart);
    } finally { docker('compose', 'up', '-d', '--no-deps', '--wait', 'finance'); }
    const debt = (await finance.query('SELECT count(*)::int AS n,sum(total_vnd)::text AS total FROM payables p JOIN inbox i ON i.id=p.source_event_id WHERE receipt_id=ANY($1::uuid[])', [receiptIds])).rows[0];
    expect(debt).toEqual({ n: 100, total: '40000000' });
    const received = (await inventory.query('SELECT count(*)::int n,sum(qty_base)::text qty FROM stock_movements WHERE document_id=ANY($1::uuid[])', [receiptIds])).rows[0];
    expect(received).toEqual({ n: 100, qty: '1000.000' });
    save('recovery', { elapsedMs: elapsed, receipts: receiptIds.length, ...debt, received });
    expect(elapsed).toBeLessThanOrEqual(60000);
    console.log('Recovered 100 posted receipts in', elapsed, 'ms');

    // Background records use the owning databases and real constraints and projection triggers.
    // The timed sales, including quoting and payment, go through the public gateway.
    await catalog.query(`WITH products_added AS (
      INSERT INTO products(id,tenant_id,name) SELECT gen_random_uuid(),$1,'Hàng '||i FROM generate_series(1,9999) i
      RETURNING id,name), items AS (
      INSERT INTO skus(id,tenant_id,product_id,code,name,base_unit)
      SELECT gen_random_uuid(),$1,id,'AP-'||lpad(split_part(name,' ',2),4,'0'),name,'Gói' FROM products_added RETURNING id)
      INSERT INTO units(id,tenant_id,sku_id,name,factor,price_vnd,is_base)
      SELECT gen_random_uuid(),$1,id,'Gói',1,100000,true FROM items`, [tenant]);
    const basket = { siteId: site.id, lines: [{ skuId: sku.id, unitId: sku.units[0].id, quantity: '1' }],
      discount: { type: 'AMOUNT', value: '0' } };
    const template = await command('sales/quotes', basket);
    await sales.query(`WITH copies AS (INSERT INTO quotes
      SELECT gen_random_uuid(),tenant_id,site_id,warehouse_id,created_by,request,lines,subtotal_vnd,discount_vnd,
      payable_vnd,pricing_hash,expires_at,created_at FROM quotes CROSS JOIN generate_series(1,10000) WHERE id=$1
      RETURNING *)
      INSERT INTO orders(id,tenant_id,site_id,warehouse_id,quote_id,code,created_by,lines,subtotal_vnd,discount_vnd,payable_vnd)
      SELECT gen_random_uuid(),tenant_id,site_id,warehouse_id,id,id::text,created_by,lines,subtotal_vnd,discount_vnd,payable_vnd FROM copies`, [template.id]);
    expect((await catalog.query('SELECT count(*) FROM skus WHERE tenant_id=$1', [tenant])).rows[0].count).toBe('10000');
    expect((await sales.query('SELECT count(*) FROM orders WHERE tenant_id=$1', [tenant])).rows[0].count).toBe('10000');
    console.log('Background dataset ready: 10,000 SKUs and 10,000 draft orders');

    const lanes: BrowserContext[] = [];
    for (let i = 0; i < 10; i += 3) {
      const group = await Promise.all(Array.from({ length: Math.min(3, 10-i) }, (_, n) => loginAs(n)));
      if (i === 0) {
        for (const n of [1, 2]) {
          const invite = await command('invitations', { targetSubjectId: accounts[n].subject, siteIds: [site.id], role: 'MANAGER', ownerConfirmed: true });
          await good(await api(group[n], '/v1/invitations/accept', 'POST', { token: invite.token }));
        }
      }
      lanes.push(...group);
    }
    const csrf = await Promise.all(lanes.map(async c => (await good(await c.request.get('/auth/session'))).csrf));
    expect(new Set(csrf).size).toBe(10);
    console.log('Starting 600 scheduled purchases across ten authenticated sessions');
    const samples: { search?: number; admission?: number; completion?: number; lag?: number; error?: string }[] = [];
    const backlog = async () => Promise.all([catalog,sales].map(async db =>
      Number((await db.query('SELECT count(*) FROM outbox WHERE delivered_at IS NULL')).rows[0].count)));
    const beforeBacklog = await backlog();
    const start = performance.now();
    await Promise.all(lanes.map(async (ctx, lane) => {
      const request = async (route: string, body?: unknown) => {
        const response = await ctx.request.fetch(base + route, { method: body === undefined ? 'GET' : 'POST',
          data: body, headers: { origin: 'http://localhost:4100', 'x-csrf-token': csrf[lane], 'idempotency-key': randomUUID() } });
        try {
          if (!response.ok()) throw new Error(route.split('/')[0] + ' HTTP ' + response.status());
          return await response.json();
        } finally { await response.dispose(); }
      };
      for (let i = lane; i < 600; i += 10) {
        const scheduled = start + i * 1000;
        // All ten sessions search together, then stagger purchases one second apart.
        await sleep(Math.max(0, start + (i - lane) * 1000 - performance.now()));
        const sample: typeof samples[number] = {};
        samples[i] = sample;
        try {
          const code = 'AP-' + String(1 + i * 7919 % 9999).padStart(4, '0');
          const search = performance.now();
          const found = await request('skus?q=' + code + '&limit=50');
          sample.search = performance.now() - search;
          if (!found.items.some((row: { code: string }) => row.code === code)) throw new Error('Search missed SKU');
          await sleep(Math.max(0, scheduled - performance.now()));
          const quote = await request('sales/quotes', basket);
          const order = await request('orders', { quoteId: quote.id });
          const route = 'orders/' + order.id;
          const sent = performance.now();
          sample.lag = sent - scheduled;
          await request(route + '/checkout', { shiftId: shift.id, version: order.version, tenderedVnd: '100000' });
          sample.admission = performance.now() - sent;
          const pending = await until(() => request(route), d => d.checkout?.payment?.status === 'PENDING');
          await request('payments/' + pending.checkout.payment.id + '/confirm',
            { siteId: site.id, version: pending.checkout.payment.version, cashReceived: true });
          await until(() => request(route), d => d.status === 'COMPLETED');
          sample.completion = performance.now() - sent;
        } catch (e) { sample.error = e instanceof Error ? e.message : 'request failed'; }
        if ((i + 1) % 60 === 0) console.log(i + 1, 'scheduled journeys;', samples.filter(s => s?.error).length, 'errors so far');
      }
    }));
    const wallMs = performance.now() - start;
    const values = (key: 'search'|'admission'|'completion'|'lag') => distribution(samples.flatMap(s => s[key] === undefined ? [] : [s[key]!]));
    const result = { samples: samples.length, errors: samples.filter(s => s.error).length, wallMs: round(wallMs),
      search: values('search'), admission: values('admission'), completion: values('completion'), scheduleLag: values('lag'),
      beforeBacklog, afterBacklog: await backlog(), docker: docker('info','--format','{{.NCPU}} CPUs, {{.MemTotal}} bytes, engine {{.ServerVersion}}') };
    save('samples', samples); save('result', result);
    const money = (await finance.query('SELECT count(*)::int n,sum(amount_vnd)::text total FROM cash_ledger WHERE shift_id=$1', [shift.id])).rows[0];
    const stock = (await inventory.query("SELECT count(*)::int n,sum(qty_base)::text qty,sum(value_vnd)::text cost FROM stock_movements WHERE tenant_id=$1 AND document_type='SALE'", [tenant])).rows[0];
    expect(money).toEqual({ n: 600, total: '60000000' });
    expect(stock).toEqual({ n: 600, qty: '-600.000', cost: '-24000000' });
    save('balances', { money, stock });
    expect(result.errors).toBe(0);
    expect(result.search.p95).toBeLessThan(800);
    expect(result.completion.p95).toBeLessThan(3000);
    const viewer = lanes[9];
    const year = new Date().getUTCFullYear();
    const summary = await until(async () => (await good(await api(viewer, base +
      `reports/summary?siteId=${site.id}&from=${year}-01-01&to=${year}-12-31`))).totals,
      totals => totals.orders === 600, 60000);
    expect(summary).toMatchObject({ sales_vnd: '60000000', cost_vnd: '24000000', profit_vnd: '36000000' });
    const page = await viewer.newPage();
    await page.goto('/');
    await page.getByLabel('Chọn hộ kinh doanh').selectOption(tenant);
    await page.getByRole('button', { name: 'Báo cáo', exact: true }).click();
    await page.getByLabel('Địa điểm báo cáo').selectOption(site.id);
    await expect(page.locator('.report-metric').first()).toContainText('60.000.000');
    await page.screenshot({ path: out + '/sales-report.png', fullPage: true });
  } finally {
    await Promise.all([...contexts.map(c => c.close()), ...[catalog,sales,finance,inventory].map(db => db.end())]);
  }
});
