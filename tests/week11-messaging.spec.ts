import { test, expect, type BrowserContext, type APIResponse } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { Pool } from 'pg';
import amqp, { type ConfirmChannel, type ChannelModel } from 'amqplib';
import { fillFreshTotp } from './helpers/totp';
import { publishConfirmed } from '../packages/platform/publish';

const accounts = JSON.parse(readFileSync('infra/generated/accounts.json', 'utf8'));
const env = Object.fromEntries(readFileSync('.env', 'utf8').trim().split(/\r?\n/).map(line => {
  const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
}));
const pool = (service: string) => new Pool({ host: '127.0.0.1',
  port: Number(env.PG_HOST_PORT ?? 55432), user: service, database: service + '_db',
  password: env[service.toUpperCase() + '_DB_PASSWORD'], max: 2 });
const finance = pool('finance'), inventory = pool('inventory');
const docker = (...args: string[]) => execFileSync('docker', args, {
  encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'],
});
const compose = (...args: string[]) => docker('compose', ...args);
const origin = 'http://localhost:4100';
async function good(response: APIResponse) {
  expect(response.status(), await response.text()).toBeLessThan(300);
  return response.json();
}

test.describe.serial('Week 11 messaging recovery at commit and acknowledgement boundaries', () => {
  let owner: BrowserContext, tenant: string, site: any, sku: any, supplier: any;
  let link: ChannelModel, ch: ConfirmChannel;
  const containers = new Set<string>();
  const observations: object[] = [];
  const evidence = 'tmp/week11/messaging-results.json';
  const path = (resource: string) => `/v1/tenants/${tenant}/${resource}`;
  async function api(url: string, method = 'GET', data?: unknown) {
    const session = await good(await owner.request.get('/auth/session'));
    return good(await owner.request.fetch(url, { method, data,
      headers: { origin, 'x-csrf-token': session.csrf, 'idempotency-key': randomUUID() } }));
  }
  const cmd = (resource: string, data: unknown) => api(path(resource), 'POST', data);
  async function startFault(mode: string, target: string) {
    const name = 'storeluma-message-test-' + randomUUID();
    containers.add(name);
    compose('run', '-d', '--no-deps', '--name', name,
      '--volume', `${resolve('tests/helpers/messaging-fault-worker.mjs')}:/app/messaging-fault-worker.mjs:ro`,
      '-e', 'FAULT_MODE=' + mode, '-e', 'FAULT_TARGET=' + target,
      'finance', 'node', '/app/messaging-fault-worker.mjs');
    return name;
  }
  const logs = (name: string) => {
    const result = spawnSync('docker', ['logs', name], { encoding: 'utf8', timeout: 15000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Unable to read fault-worker logs');
    return result.stdout + result.stderr;
  };
  async function stopFaults() {
    for (const name of [...containers]) {
      docker('rm', '-f', name);
      containers.delete(name);
    }
  }
  async function waitConsumers(count: number) {
    await expect.poll(async () => (await ch.checkQueue('finance')).consumerCount,
      { timeout: 30000 }).toBe(count);
  }
  async function postedReceipt() {
    const draft = await cmd('receipts', { siteId: site.id, warehouseId: site.warehouse_id,
      sourceType: 'PURCHASE', supplierId: supplier.id,
      lines: [{ skuId: sku.id, unitId: sku.units[0].id, qty: '2', unitCostVnd: '40000' }] });
    await cmd(`receipts/${draft.id}/post`, { version: draft.version });
    let event: any;
    await expect.poll(async () => {
      event = (await inventory.query("SELECT payload FROM outbox WHERE type='inventory.receipt-posted.v1' AND payload->>'aggregateId'=$1", [draft.id])).rows[0]?.payload;
      return Boolean(event);
    }).toBe(true);
    return { receipt: draft, event };
  }
  async function assertPayable(receiptId: string) {
    const rows = (await finance.query('SELECT * FROM payables WHERE tenant_id=$1 AND receipt_id=$2', [tenant, receiptId])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ total_vnd: '80000', paid_vnd: '0', supplier_id: supplier.id });
    expect((await inventory.query('SELECT count(*) FROM stock_movements WHERE tenant_id=$1 AND document_id=$2', [tenant, receiptId])).rows[0].count).toBe('1');
  }
  async function observeReady() {
    const queue = (await ch.assertQueue('', { exclusive: true, autoDelete: true })).queue;
    await ch.bindQueue(queue, 'storeluma', 'register.ready');
    const events: any[] = [];
    const consumer = await ch.consume(queue, message => {
      if (message) { events.push(JSON.parse(message.content.toString())); ch.ack(message); }
    });
    return { events, close: async () => { await ch.cancel(consumer.consumerTag); await ch.deleteQueue(queue); } };
  }
  async function newSite() {
    return cmd('sites', { code: 'F' + randomUUID().slice(0, 8).toUpperCase(), name: 'Điểm bán Bình An' });
  }
  async function assertProvision(target: any, eventId: string) {
    await expect.poll(async () => (await api(path('sites/' + target.id))).status, { timeout: 30000 }).toBe('ACTIVE');
    const rows = (await finance.query('SELECT * FROM registers WHERE tenant_id=$1 AND site_id=$2', [tenant, target.id])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(target.register_id);
    const outbox = (await finance.query("SELECT * FROM outbox WHERE type='register.ready' AND payload->>'siteId'=$1", [target.id])).rows;
    expect(outbox).toHaveLength(1);
    expect(outbox[0].id).toBe(eventId);
    expect(outbox[0].delivered_at).not.toBeNull();
  }

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    mkdirSync('tmp/week11', { recursive: true });
    owner = await browser.newContext();
    const page = await owner.newPage();
    await page.goto('/auth/login');
    await page.locator('#username').fill(accounts[0].username);
    await page.locator('#password').fill(accounts[0].password);
    await page.locator('#kc-login').click();
    await fillFreshTotp(page, accounts[0].otpSecret);
    await page.locator('#kc-login').click();
    await expect(page).toHaveURL(origin + '/');
    const household = await api('/v1/tenants', 'POST', { name: 'Cửa hàng Bình An', site: { code: 'BA01', name: 'Bình An - Trần Phú' } });
    tenant = household.tenantId; site = household.site;
    await expect.poll(async () => (await api(path('sites/' + site.id))).status, { timeout: 45000 }).toBe('ACTIVE');
    site = await api(path('sites/' + site.id));
    sku = (await cmd('products', { name: 'Trà sen', categoryId: null,
      sku: { code: 'BA-' + randomUUID().slice(0, 8).toUpperCase(), name: 'Trà sen', baseUnit: 'Gói', priceVnd: '60000' } })).skus[0];
    supplier = await cmd('suppliers', { code: 'BA-' + randomUUID().slice(0, 8).toUpperCase(), name: 'Nhà cung cấp Bình An' });
    link = await amqp.connect(`amqp://storeluma:${env.RABBIT_PASSWORD}@127.0.0.1:5673`);
    ch = await link.createConfirmChannel();
  });
  test.afterEach(async () => {
    test.setTimeout(90000);
    try { await stopFaults(); } finally { compose('up', '-d', '--no-deps', '--wait', 'finance'); }
    writeFileSync(evidence, JSON.stringify(observations, null, 2));
  });
  test.afterAll(async () => {
    await Promise.all([owner?.close(), link?.close(), finance.end(), inventory.end()]);
  });

  test('W11-01 Consumer death after commit before ACK redelivers without a second payable', async () => {
    compose('stop', 'finance');
    await waitConsumers(0);
    const { receipt, event } = await postedReceipt();
    const worker = await startFault('before-ack', event.eventId);
    await expect.poll(() => logs(worker), { timeout: 30000 }).toContain('"faultBoundary":"before-ack"');
    await expect.poll(() => docker('inspect', '--format', '{{.State.ExitCode}}', worker).trim()).toBe('137');
    expect((await finance.query('SELECT id FROM inbox WHERE id=$1', [event.eventId])).rowCount).toBe(1);
    await assertPayable(receipt.id);
    // Inspect the broker's actual redelivery flag, then return every delivery unchanged.
    const held: amqp.GetMessage[] = [];
    let redelivered = false;
    try {
      await expect.poll(async () => {
        const message = await ch.get('finance', { noAck: false });
        if (message) {
          held.push(message);
          if (JSON.parse(message.content.toString()).eventId === event.eventId) redelivered = message.fields.redelivered;
        }
        return redelivered;
      }, { timeout: 15000 }).toBe(true);
    } finally { for (const message of held) ch.nack(message, false, true); }
    const started = Date.now();
    await stopFaults();
    const recovered = await startFault('observe', event.eventId);
    await expect.poll(() => logs(recovered), { timeout: 30000 }).toContain('"faultBoundary":"ack"');
    await assertPayable(receipt.id);
    expect((await finance.query('SELECT id FROM inbox WHERE id=$1', [event.eventId])).rowCount).toBe(1);
    observations.push({ case: 'W11-01', eventId: event.eventId, redelivered, payableCount: 1, recoveryMs: Date.now() - started });
  });

  test('W11-02 Publisher death after broker confirm retries the same Outbox event', async () => {
    compose('stop', 'finance');
    await waitConsumers(0);
    const monitor = await observeReady();
    try {
      const target = await newSite();
      const worker = await startFault('after-confirm', target.id);
      await expect.poll(() => logs(worker), { timeout: 30000 }).toContain('"faultBoundary":"after-confirm"');
      await expect.poll(() => docker('inspect', '--format', '{{.State.ExitCode}}', worker).trim()).toBe('137');
      await expect.poll(() => monitor.events.filter(e => e.siteId === target.id).length).toBe(1);
      const first = monitor.events.find(e => e.siteId === target.id);
      expect((await finance.query('SELECT delivered_at FROM outbox WHERE id=$1', [first.id])).rows[0].delivered_at).toBeNull();
      const started = Date.now();
      compose('start', 'finance');
      await expect.poll(() => monitor.events.filter(e => e.id === first.id).length, { timeout: 45000 }).toBe(2);
      await expect.poll(async () => Boolean((await finance.query('SELECT delivered_at FROM outbox WHERE id=$1', [first.id])).rows[0].delivered_at)).toBe(true);
      expect(monitor.events.filter(e => e.siteId === target.id)).toEqual([first, first]);
      await assertProvision(target, first.id);
      observations.push({ case: 'W11-02', eventId: first.id, publications: 2, registerCount: 1, recoveryMs: Date.now() - started });
    } finally { await monitor.close(); }
  });

  test('W11-03 Lost publisher confirm leaves Outbox pending and recovers after its lease', async () => {
    compose('stop', 'finance');
    await waitConsumers(0);
    const monitor = await observeReady();
    try {
      const target = await newSite();
      const worker = await startFault('drop-confirm', target.id);
      await expect.poll(() => logs(worker), { timeout: 30000 }).toContain('"faultBoundary":"confirm-dropped"');
      await expect.poll(() => monitor.events.filter(e => e.siteId === target.id).length).toBe(1);
      const first = monitor.events.find(e => e.siteId === target.id), started = Date.now();
      expect((await finance.query('SELECT delivered_at FROM outbox WHERE id=$1', [first.id])).rows[0].delivered_at).toBeNull();
      await expect.poll(() => logs(worker), { timeout: 10000 }).toContain('outbox retry pending');
      expect((await finance.query('SELECT delivered_at FROM outbox WHERE id=$1', [first.id])).rows[0].delivered_at).toBeNull();
      await expect.poll(() => monitor.events.filter(e => e.id === first.id).length, { timeout: 30000 }).toBe(2);
      await expect.poll(async () => Boolean((await finance.query('SELECT delivered_at FROM outbox WHERE id=$1', [first.id])).rows[0].delivered_at)).toBe(true);
      expect(monitor.events.filter(e => e.siteId === target.id)).toEqual([first, first]);
      await assertProvision(target, first.id);
      observations.push({ case: 'W11-03', eventId: first.id, publications: 2, registerCount: 1, recoveryMs: Date.now() - started });
    } finally { await monitor.close(); }
  });

  test('W11-04 Two real consumers deduplicate concurrent event and business replays', async () => {
    const { receipt, event } = await postedReceipt();
    await expect.poll(async () => (await finance.query('SELECT id FROM inbox WHERE id=$1', [event.eventId])).rowCount).toBe(1);
    compose('stop', 'finance');
    await waitConsumers(0);
    const workers = [await startFault('observe', receipt.id), await startFault('observe', receipt.id)];
    await waitConsumers(2);
    // A new transport ID still refers to the same receipt; the source key must deduplicate it.
    const replay = { ...event, eventId: randomUUID() }, started = Date.now();
    // Each in-flight confirm temporarily owns return/close listeners on this test channel.
    const listenerLimit = ch.getMaxListeners();
    const listeners = [ch.listenerCount('return'), ch.listenerCount('close')];
    ch.setMaxListeners(40);
    try {
      await Promise.all(Array.from({ length: 32 }, (_, i) => {
        const value = i % 2 ? replay : event;
        return publishConfirmed(ch, '', 'finance', Buffer.from(JSON.stringify(value)), { messageId: value.eventId });
      }));
    } finally { ch.setMaxListeners(listenerLimit); }
    expect([ch.listenerCount('return'), ch.listenerCount('close')]).toEqual(listeners);
    const acknowledgements = () => workers.map(name => logs(name).split('\n').filter(line => line.includes('"faultBoundary":"ack"')).length);
    await expect.poll(() => acknowledgements().reduce((a, b) => a + b, 0), { timeout: 30000 }).toBe(32);
    const counts = acknowledgements();
    for (const count of counts) expect(count).toBeGreaterThan(0);
    expect((await finance.query('SELECT id FROM inbox WHERE id=ANY($1::uuid[])', [[event.eventId, replay.eventId]])).rowCount).toBe(2);
    await assertPayable(receipt.id);
    observations.push({ case: 'W11-04', eventId: event.eventId, replayId: replay.eventId, acknowledgements: counts, payableCount: 1, recoveryMs: Date.now() - started });
  });
});
