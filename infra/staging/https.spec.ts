import { chromium, expect, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { fillFreshTotp } from '../../tests/helpers/totp';

const app = 'https://storeluma.localhost:9443';
const identity = 'https://storeluma-id.localhost:9443';
const files = (process.env.STAGING_STATE_DIR ?? 'tmp/https-staging') + '/';

// Verify both certificate chains and hostnames before pinning their public keys
// in an ephemeral Chromium instance. The operating system trust store is untouched.
function probe(address: string): Promise<{ status: number; location?: string; hsts?: string; pin?: string }> {
  const url = new URL(address);
  return new Promise((resolve, reject) => {
    const options = { hostname: '127.0.0.1', port: url.port, path: url.pathname + url.search,
      headers: { host: url.host }, servername: url.hostname, ca: readFileSync(files + 'root.crt'),
      agent: false as const, timeout: 10000 };
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.get(options, res => {
      const socket = res.socket;
      const cert = 'getPeerX509Certificate' in socket
        ? (socket as import('node:tls').TLSSocket).getPeerX509Certificate() : undefined;
      const pin = cert && createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64');
      res.resume();
      resolve({ status: res.statusCode!, location: res.headers.location, hsts: res.headers['strict-transport-security'], pin });
    });
    req.on('timeout', () => req.destroy(new Error('Edge timed out'))).on('error', reject);
  });
}

test('HTTPS edge, OIDC/TOTP session, cash sale and logout', async () => {
  for (const origin of [app, identity]) {
    const redirect = await probe(origin.replace('https:', 'http:').replace(':9443', ':9080') + '/check?q=1');
    expect([301, 308]).toContain(redirect.status);
    expect(redirect.location).toBe(origin + '/check?q=1');
  }
  const gateway = await probe(app + '/health');
  const provider = await probe(identity + '/realms/storeluma/.well-known/openid-configuration');
  for (const endpoint of [gateway, provider]) {
    expect(endpoint.status).toBe(200);
    expect(endpoint.pin).toBeTruthy();
    expect(endpoint.hsts).toMatch(/max-age=\d+/);
  }
  expect((await probe(identity + '/admin/')).status).toBe(404);
  const browser = await chromium.launch({ args: [
    '--host-resolver-rules=MAP storeluma-id.localhost 127.0.0.1,MAP storeluma.localhost 127.0.0.1',
    '--ignore-certificate-errors-spki-list=' + [gateway.pin, provider.pin].join(','),
  ] });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const [owner] = JSON.parse(readFileSync(files + 'infra/generated/accounts.json', 'utf8'));
    const unexpectedOrigins = new Set<string>();
    page.on('request', request => {
      const url = new URL(request.url());
      if (/^https?:$/.test(url.protocol) && ![app, identity].includes(url.origin)) unexpectedOrigins.add(url.origin);
    });
    await page.goto(app + '/auth/login');
    await page.locator('#username').waitFor();
    expect(new URL(page.url()).origin).toBe(identity);
    const attempt = (await context.cookies(app + '/auth/callback')).find(c => c.name.startsWith('sl_login_'));
    expect(attempt).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', path: '/auth' });
    await page.locator('#username').fill(owner.username);
    await page.locator('#password').fill(owner.password);
    await page.locator('#kc-login').click();
    await fillFreshTotp(page, owner.otpSecret);
    await page.locator('#kc-login').click();
    await expect(page).toHaveURL(app + '/');
    const sessionCookie = (await context.cookies(app)).find(c => c.name === 'sl_session');
    expect(sessionCookie).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax', domain: 'storeluma.localhost' });
    expect((await context.cookies(identity)).some(c => c.name === 'sl_session')).toBe(false);
    const csrf = await page.evaluate(async () => (await (await fetch('/auth/session')).json()).csrf);
    expect(typeof csrf).toBe('string');
    const call = async (path: string, body?: unknown) => page.evaluate(async ({ path, body, csrf }) => {
      const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: {
        'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': crypto.randomUUID(),
      }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(path + ' HTTP ' + response.status);
      return response.json();
    }, { path, body, csrf });

    const household = await call('/v1/tenants', { name: 'An Bình ' + randomUUID().slice(0,8),
      site: { code: 'AB01', name: 'An Bình' } });
    const site = household.site;
    const base = '/v1/tenants/' + household.tenantId + '/';
    await expect.poll(async () => (await call(base + 'sites/' + site.id)).status, { timeout: 30000 }).toBe('ACTIVE');
    const sku = (await call(base + 'products', { name: 'Trà sen', categoryId: null,
      sku: { code: 'TRA-SEN', name: 'Trà sen', baseUnit: 'Gói', priceVnd: '100000' } })).skus[0];
    const receipt = await call(base + 'receipts', { siteId: site.id, warehouseId: site.warehouse_id,
      sourceType: 'OPENING_STOCK', supplierId: null, lines: [{ skuId: sku.id, unitId: sku.units[0].id, qty: '2', unitCostVnd: '40000' }] });
    await call(base + 'receipts/' + receipt.id + '/post', { version: receipt.version });
    const shift = await call(base + 'shifts', { siteId: site.id, openingCash: '0' });
    const quote = await call(base + 'sales/quotes', { siteId: site.id,
      lines: [{ skuId: sku.id, unitId: sku.units[0].id, quantity: '1' }], discount: { type: 'AMOUNT', value: '0' } });
    const order = await call(base + 'orders', { quoteId: quote.id });
    const route = base + 'orders/' + order.id;
    await call(route + '/checkout', { shiftId: shift.id, version: order.version, tenderedVnd: '100000' });
    await expect.poll(async () => (await call(route)).checkout?.payment?.status, { timeout: 30000 }).toBe('PENDING');
    const payment = (await call(route)).checkout.payment;
    await call(base + 'payments/' + payment.id + '/confirm', { siteId: site.id, version: payment.version, cashReceived: true });
    await expect.poll(async () => (await call(route)).status, { timeout: 30000 }).toBe('COMPLETED');
    expect((await call(route)).lines[0].costVnd).toBe('40000');
    if (process.env.STORELUMA_DRILL_ID) {
      writeFileSync(files + 'sale.json', JSON.stringify({ tenant: household.tenantId, order: order.id, payment: payment.id, sku: sku.id }));
      await page.reload();
      await page.getByLabel('Chọn hộ kinh doanh').selectOption(household.tenantId);
      await page.getByRole('button', { name: 'Báo cáo', exact: true }).click();
      await page.getByLabel('Địa điểm báo cáo').selectOption(site.id);
      await expect(page.locator('.report-metric').first()).toContainText('100.000', { timeout: 30000 });
      await page.screenshot({ path: files + 'sales-report.png', fullPage: true });
    }
    const { redirectUrl } = await call('/auth/logout', {});
    expect(new URL(redirectUrl).origin).toBe(identity);
    await page.goto(redirectUrl);
    await expect(page).toHaveURL(app + '/');
    expect(await page.evaluate(async () => (await fetch('/auth/session')).status)).toBe(401);
    expect([...unexpectedOrigins]).toEqual([]);
  } finally { await browser.close(); }
});
