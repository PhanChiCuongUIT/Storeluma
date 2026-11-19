import { expect, test, type BrowserContext } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Pool } from 'pg';
import { api, good, login } from './helpers/business-api';

const env = parseEnv(readFileSync('.env', 'utf8'));
function servicePool(service: string) {
  return new Pool({ host: '127.0.0.1', port: Number(env.PG_HOST_PORT ?? 55432),
    database: service + '_db', user: service, password: env[service.toUpperCase() + '_DB_PASSWORD'] });
}
const sales = servicePool('sales'), inventory = servicePool('inventory'), finance = servicePool('finance');
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 60000 });
const startSales = () => docker('compose', 'up', '-d', '--no-deps', '--wait', 'sales');

test.describe('Week 11 checkout and return recovery', () => {
  test.describe.configure({ timeout: 160000 });
  let owner: BrowserContext, tenant: string, site: any, sku: any, shift: any;
  let worker: string | undefined, stopped = false;
  const path = (resource: string) => '/v1/tenants/' + tenant + '/' + resource;
  const get = async (resource: string) => good(await api(owner, path(resource)));
  const post = async (resource: string, body: unknown) => good(await api(owner, path(resource), 'POST', body, randomUUID()));
  async function stopSales() {
    stopped = true;
    docker('compose', 'stop', 'sales');
  }
  async function fault(resource: string, mode: string, id: string) {
    worker = 'storeluma-saga-test-' + randomUUID();
    const aliases = resource === 'return/receive' ? ['--use-aliases'] : [];
    docker('compose', 'run', '-d', '--no-deps', ...aliases, '--name', worker,
      '--volume', resolve('tests/helpers/saga-fault-worker.mjs') + ':/app/fault.mjs:ro',
      'sales', 'node', '/app/fault.mjs', resource, mode, id);
    await expect.poll(() => docker('logs', worker!), { timeout: 30000 }).toContain('worker ready');
  }
  function releaseWorker() {
    docker('exec', worker!, 'touch', '/tmp/release-reply');
  }
  async function exited(code: number) {
    await expect.poll(() => docker('inspect', '--format', '{{.State.Status}} {{.State.ExitCode}}', worker!).trim(),
      { timeout: 45000 }).toBe('exited ' + code);
  }
  async function saga(id: string) {
    return (await sales.query('SELECT *, lease_until <= clock_timestamp() AS expired FROM checkout_sagas WHERE order_id=$1', [id])).rows[0];
  }
  async function pending() {
    const quote = await post('sales/quotes', { siteId: site.id, lines: [{ skuId: sku.id, unitId: sku.units[0].id, quantity: '1' }],
      discount: { type: 'AMOUNT', value: '0' } });
    const order = await post('orders', { quoteId: quote.id });
    await post('orders/' + order.id + '/checkout', { version: order.version, shiftId: shift.id, tenderedVnd: '100000' });
    let payment: any;
    await expect.poll(async () => {
      payment = (await get('orders/' + order.id)).checkout?.payment;
      return payment?.status;
    }, { timeout: 30000 }).toBe('PENDING');
    return { order, payment };
  }
  const confirm = (payment: any) => post('payments/' + payment.id + '/confirm',
    { siteId: site.id, version: payment.version, cashReceived: true });
  async function assertSale(orderId: string, paymentId: string) {
    await expect.poll(async () => (await saga(orderId)).stage, { timeout: 45000 }).toBe('DONE');
    const order = await get('orders/' + orderId);
    expect(order.status).toBe('COMPLETED');
    expect(order.lines[0].costVnd).toBe('40000');
    expect((await finance.query('SELECT id FROM payments WHERE order_id=$1', [orderId])).rows).toEqual([{ id: paymentId }]);
    expect((await finance.query('SELECT amount_vnd FROM cash_ledger WHERE payment_id=$1', [paymentId])).rows).toEqual([{ amount_vnd: '100000' }]);
    expect((await inventory.query('SELECT id,status FROM reservations WHERE order_id=$1', [orderId])).rows)
      .toEqual([{ id: (await saga(orderId)).reservation_id, status: 'COMMITTED' }]);
    expect((await inventory.query('SELECT qty_base,value_vnd FROM stock_movements WHERE document_id=$1', [orderId])).rows)
      .toEqual([{ qty_base: '-1.000', value_vnd: '-40000' }]);
    expect((await sales.query("SELECT id FROM outbox WHERE type='sales.order-completed.v1' AND payload->>'aggregateId'=$1", [orderId])).rowCount).toBe(1);
  }

  test.beforeAll(async ({ browser }) => {
    owner = await browser.newContext();
    await login(await owner.newPage(), 0);
    const household = await good(await api(owner, '/v1/tenants', 'POST', { name: 'Cửa hàng An Bình',
      site: { code: 'AB01', name: 'An Bình' } }, randomUUID()));
    tenant = household.tenantId; site = household.site;
    await expect.poll(async () => (await get('sites/' + site.id)).status, { timeout: 45000 }).toBe('ACTIVE');
    sku = (await post('products', { name: 'Trà sen', categoryId: null,
      sku: { code: 'TRA-SEN', name: 'Trà sen', baseUnit: 'Gói', priceVnd: '100000' } })).skus[0];
    const receipt = await post('receipts', { siteId: site.id, warehouseId: site.warehouse_id, sourceType: 'OPENING_STOCK',
      supplierId: null, lines: [{ skuId: sku.id, unitId: sku.units[0].id, qty: '20', unitCostVnd: '40000' }] });
    await post('receipts/' + receipt.id + '/post', { version: receipt.version });
    shift = await post('shifts', { siteId: site.id, openingCash: '0' });
  });
  test.afterEach(async () => {
    try { if (worker) docker('rm', '-f', worker); }
    finally { if (stopped) startSales(); worker = undefined; stopped = false; }
  });
  test.afterAll(async () => { await Promise.all([owner?.close(), sales.end(), finance.end(), inventory.end()]); });

  test('W11-05 Sales loses the successful payment reply and resumes the same paid order', async () => {
    const { order, payment } = await pending();
    await stopSales();
    await confirm(payment);
    await fault('payment/query', 'drop', order.id);
    await exited(0);
    expect((await saga(order.id)).stage).toBe('PAYMENT');
    expect((await sales.query('SELECT status FROM orders WHERE id=$1', [order.id])).rows[0].status).toBe('REVIEW');
    startSales();
    await assertSale(order.id, payment.id);
  });

  for (const scenario of ['crash', 'expired', 'replaced'] as const) {
    const title = { crash: 'W11-06 Recover committed stock after Sales dies',
      expired: 'W11-07 An expired claim cannot write before takeover',
      replaced: 'W11-08 A late worker cannot overwrite the completed sale' }[scenario];
    test(title, async () => {
      const { order, payment } = await pending();
      await stopSales();
      await confirm(payment);
      await fault('reservation/commit', scenario === 'crash' ? 'crash' : 'hold', order.id);
      await expect.poll(() => docker('logs', worker!), { timeout: 45000 }).toContain('reply received for ' + order.id);
      const before = await saga(order.id);
      expect(before.stage).toBe('COMMIT');
      expect(before.lease_token).toBeTruthy();
      expect((await inventory.query('SELECT status FROM reservations WHERE id=$1', [before.reservation_id])).rows[0].status).toBe('COMMITTED');
      if (scenario === 'crash') await exited(137);
      if (scenario === 'expired') {
        await expect.poll(async () => (await saga(order.id)).expired, { timeout: 30000 }).toBe(true);
        releaseWorker();
        await exited(0);
        expect(await saga(order.id)).toMatchObject({ stage: 'COMMIT', version: before.version, lease_token: before.lease_token, last_error: null });
      }
      startSales();
      await expect.poll(async () => (await saga(order.id)).stage, { timeout: 45000 }).toBe('DONE');
      if (scenario === 'replaced') {
        const version = (await saga(order.id)).version;
        releaseWorker();
        await exited(0);
        expect((await saga(order.id)).version).toBe(version);
      }
      await assertSale(order.id, payment.id);
    });
  }

  for (const mode of ['crash', 'hold'] as const) {
    const title = mode === 'crash' ? 'W11-09 Recover received goods before creating the refund'
      : 'W11-10 An expired return claim cannot write before takeover';
    test(title, async () => {
      const { order, payment } = await pending();
      await confirm(payment);
      await assertSale(order.id, payment.id);
      const returned = await post('orders/' + order.id + '/returns', { reason: 'Bao bì hỏng',
        lines: [{ orderLineId: order.lines[0].id, quantity: '0.5', disposition: 'QUARANTINE' }] });
      await stopSales();
      await fault('return/receive', mode, returned.id);
      await post('returns/' + returned.id + '/approve', { version: returned.version, note: 'Đã kiểm tra hàng' });
      await expect.poll(() => docker('logs', worker!), { timeout: 45000 }).toContain('reply received for ' + returned.id);
      if (mode === 'hold') {
        await expect.poll(async () => (await sales.query(
          'SELECT lease_until <= clock_timestamp() AS expired FROM return_sagas WHERE return_id=$1', [returned.id],
        )).rows[0].expired, { timeout: 30000 }).toBe(true);
        releaseWorker();
        await exited(0);
        const lease = (await sales.query('SELECT lease_token,last_error,attempts FROM return_sagas WHERE return_id=$1', [returned.id])).rows[0];
        expect(lease.lease_token).toBeTruthy();
        expect(lease).toMatchObject({ last_error: null, attempts: 0 });
      } else {
        await exited(137);
      }
      expect((await sales.query('SELECT stage FROM return_sagas WHERE return_id=$1', [returned.id])).rows[0].stage).toBe('RECEIVE');
      expect((await inventory.query('SELECT id FROM return_receipts WHERE id=$1', [returned.id])).rowCount).toBe(1);
      expect((await finance.query('SELECT id FROM refunds WHERE return_id=$1', [returned.id])).rowCount).toBe(0);
      startSales();
      let refund: any;
      await expect.poll(async () => {
        refund = (await get('returns/' + returned.id)).progress?.refund;
        return refund?.status;
      }, { timeout: 45000 }).toBe('PENDING');
      expect(refund.id).toBe(returned.refund_id);
      const prepared = await post('refunds/' + refund.id + '/prepare', { shiftId: shift.id, version: refund.version });
      await post('refunds/' + refund.id + '/confirm', { shiftId: shift.id, version: prepared.version, cashPaid: true });
      await expect.poll(async () => (await get('returns/' + returned.id)).status).toBe('COMPLETED');
      expect((await finance.query('SELECT amount_vnd FROM cash_ledger WHERE refund_id=$1', [refund.id])).rows).toEqual([{ amount_vnd: '-50000' }]);
      expect((await inventory.query('SELECT qty_base,value_vnd,(quarantined_after-quarantined_before)::text AS quarantine_delta FROM stock_movements WHERE document_id=$1', [returned.id])).rows)
        .toEqual([{ qty_base: '0.500', value_vnd: '20000', quarantine_delta: '0.500' }]);
      await assertSale(order.id, payment.id);
    });
  }
});
