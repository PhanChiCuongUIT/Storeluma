import { test, expect, type BrowserContext, type Page, type APIResponse } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fillFreshTotp } from './helpers/totp';

const accounts = JSON.parse(readFileSync('infra/generated/accounts.json', 'utf8'));
const origin = 'http://localhost:4100';
async function good(response: APIResponse) {
  expect(response.status(), await response.text()).toBeLessThan(300);
  return response.json();
}
async function login(page: Page, index: number) {
  await page.goto('/auth/login');
  await page.locator('#username').fill(accounts[index].username);
  await page.locator('#password').fill(accounts[index].password);
  await page.locator('#kc-login').click();
  await fillFreshTotp(page, accounts[index].otpSecret);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(origin + '/');
}
async function api(ctx: BrowserContext, path: string, method = 'GET', data?: unknown, key?: string) {
  const session = await good(await ctx.request.get('/auth/session'));
  return ctx.request.fetch(path, { method, data, headers: {
    origin, 'x-csrf-token': session.csrf, ...(key ? { 'idempotency-key': key } : {}),
  } });
}

// One connected business scenario, with exact stock/cash assertions at each boundary.
// All setup and commands use public APIs; no SQL edits, mocks or broker injection.
test.describe.serial('Week 10 integrated receipt, sale, return and settlement', () => {
  let owner: BrowserContext, staff: BrowserContext, page: Page;
  let tenant: string, site: any, secondSite: any, sku: any, supplier: any, shift: any, sale: any;
  const stamp = Date.now().toString(36).toUpperCase();
  const evidence = process.env.WEEK10_SCREENSHOTS ?? 'tmp/week10/screenshots';
  const year = new Date().getUTCFullYear();
  const dates = { from: `${year}-01-01`, to: `${year}-12-31` };
  const path = (resource: string) => `/v1/tenants/${tenant}/${resource}`;
  const get = (resource: string, ctx = owner) => api(ctx, path(resource));
  const cmd = (resource: string, body: unknown, ctx = owner, key = randomUUID(), method = 'POST') =>
    api(ctx, path(resource), method, body, key);
  const balance = async () => (await good(await get(`stock-balances?siteId=${site.id}&skuId=${sku.id}`))).items[0];
  async function currentDrawer() { return good(await get('shifts/' + shift.id)); }
  async function summary(ctx = owner) {
    return good(await get('reports/summary?' + new URLSearchParams({ ...dates, siteId: site.id }), ctx));
  }
  async function role(value: string, status = 'ACTIVE', siteIds = [site.id]) {
    const member = (await good(await get('memberships'))).find((m: any) => m.subject_id === accounts[1].subject);
    return good(await cmd('memberships/' + member.id,
      { role: value, status, siteIds, version: member.version }, owner, randomUUID(), 'PATCH'));
  }
  async function waitOrder(id: string, status: string) {
    let order: any;
    await expect.poll(async () => {
      order = await good(await get('orders/' + id)); return order.status;
    }, { timeout: 45000 }).toBe(status);
    return order;
  }
  async function pending(quantity = '2', discount = '10000') {
    const quote = await good(await cmd('sales/quotes', { siteId: site.id,
      lines: [{ skuId: sku.id, unitId: sku.units[0].id, quantity }],
      discount: { type: 'AMOUNT', value: discount } }, staff));
    let order = await good(await cmd('orders', { quoteId: quote.id, note: 'Bán tại quầy' }, staff));
    await good(await cmd(`orders/${order.id}/checkout`,
      { version: order.version, shiftId: shift.id, tenderedVnd: order.payable_vnd }, staff));
    await expect.poll(async () => {
      order = await good(await get('orders/' + order.id)); return order.checkout?.payment?.status;
    }, { timeout: 30000 }).toBe('PENDING');
    return order;
  }
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    mkdirSync(evidence, { recursive: true });
    owner = await browser.newContext(); staff = await browser.newContext();
    page = await owner.newPage();
    await Promise.all([login(page, 0), login(await staff.newPage(), 1)]);
    const household = await good(await api(owner, '/v1/tenants', 'POST', {
      name: 'Cửa hàng An Nhiên', site: { code: 'AN01', name: 'An Nhiên - Nguyễn Trãi' },
    }, randomUUID()));
    tenant = household.tenantId; site = household.site;
    secondSite = await good(await cmd('sites', { code: 'AN02', name: 'An Nhiên - Lê Lợi' }));
    for (const id of [site.id, secondSite.id]) {
      await expect.poll(async () => (await good(await get('sites/' + id))).status, { timeout: 45000 }).toBe('ACTIVE');
    }
    site = await good(await get('sites/' + site.id));
    const invitation = await good(await cmd('invitations', { targetSubjectId: accounts[1].subject,
      role: 'CASHIER', siteIds: [site.id], ownerConfirmed: true }));
    await good(await api(staff, '/v1/invitations/accept', 'POST', { token: invitation.token }));
    sku = (await good(await cmd('products', { name: 'Cà phê rang mộc 250g', categoryId: null,
      sku: { code: 'AN-' + stamp, name: 'Cà phê rang mộc 250g', baseUnit: 'Gói', priceVnd: '100000' } }))).skus[0];
    supplier = await good(await cmd('suppliers', { code: 'AN-' + stamp, name: 'Nhà cung cấp An Phú' }));
    shift = await good(await cmd('shifts', { siteId: site.id, openingCash: '500000' }, staff));
  });
  test.afterAll(async () => { await Promise.all([owner?.close(), staff?.close()]); });

  test('W10-12 Duplicate purchase posting creates one stock increase and one payable', async () => {
    const receipt = await good(await cmd('receipts', { siteId: site.id, warehouseId: site.warehouse_id,
      sourceType: 'PURCHASE', supplierId: supplier.id, note: 'Nhập hàng đầu kỳ',
      lines: [{ skuId: sku.id, unitId: sku.units[0].id, qty: '10', unitCostVnd: '40000' }] }));
    const key = randomUUID();
    const posted = await Promise.all([1, 2].map(async () => good(await cmd(`receipts/${receipt.id}/post`, { version: receipt.version }, owner, key))));
    expect(posted[0].id).toBe(posted[1].id);
    expect(await balance()).toMatchObject({ on_hand: '10.000', reserved: '0.000', inventory_value: '400000' });
    await expect.poll(async () => (await good(await get(`payables?siteId=${site.id}&receiptId=${receipt.id}`))).items.length).toBe(1);
    const payable = (await good(await get(`payables?siteId=${site.id}&receiptId=${receipt.id}`))).items[0];
    expect(payable.total_vnd).toBe('400000');
    const movements = (await good(await get(`stock-movements?siteId=${site.id}&skuId=${sku.id}`))).items;
    expect(movements.filter((m: any) => m.document_id === receipt.id)).toHaveLength(1);
    expect((await currentDrawer()).ledger).toHaveLength(0);
  });

  test('W10-13 Revoked cash confirmation leaves money pending; restored concurrent replay collects once', async () => {
    sale = await pending();
    expect(await balance()).toMatchObject({ on_hand: '10.000', reserved: '2.000' });
    const body = { siteId: site.id, version: sale.checkout.payment.version, cashReceived: true };
    const endpoint = `payments/${sale.checkout.payment.id}/confirm`, key = randomUUID();
    await role('STOCK');
    expect((await cmd(endpoint, body, staff, key)).status()).toBe(403);
    expect((await currentDrawer()).ledger).toHaveLength(0);
    expect((await good(await get('orders/' + sale.id))).checkout.payment.status).toBe('PENDING');
    await role('CASHIER');
    await Promise.all([1, 2].map(async () => good(await cmd(endpoint, body, staff, key))));
    sale = await waitOrder(sale.id, 'COMPLETED');
    expect(await balance()).toMatchObject({ on_hand: '8.000', reserved: '0.000', inventory_value: '320000' });
    const cash = await currentDrawer();
    expect(cash.ledger).toHaveLength(1); expect(cash.totals.sales).toBe('190000');
    const movements = (await good(await get(`stock-movements?siteId=${site.id}&type=SALE`))).items;
    expect(movements.filter((m: any) => m.document_id === sale.id)).toHaveLength(1);
    await role('ACCOUNTANT');
    expect((await cmd(endpoint, body, staff, key)).status()).toBe(403);
    expect((await currentDrawer()).ledger).toHaveLength(1);
    await role('CASHIER');
  });

  test('W10-14 Partial damaged return, refund revocation and retries preserve original sale and exact balances', async () => {
    const receiptBefore = await good(await get(`orders/${sale.id}/receipt`));
    let returned = await good(await cmd(`orders/${sale.id}/returns`, { reason: 'Bao bì bị hỏng',
      lines: [{ orderLineId: sale.lines[0].id, quantity: '0.5', disposition: 'QUARANTINE' }] }, staff));
    expect(returned.amount_vnd).toBe('47500');
    expect((await cmd(`returns/${returned.id}/approve`, { version: returned.version, note: 'Kiểm tra hàng trả' }, staff)).status()).toBe(403);
    await good(await cmd(`returns/${returned.id}/approve`, { version: returned.version, note: 'Đã kiểm tra hàng và chứng từ' }));
    await expect.poll(async () => {
      returned = await good(await get('returns/' + returned.id)); return returned.progress?.refund?.status;
    }, { timeout: 30000 }).toBe('PENDING');
    const prepared = await good(await cmd(`refunds/${returned.refund_id}/prepare`,
      { shiftId: shift.id, version: returned.progress.refund.version }, staff));
    const body = { shiftId: shift.id, version: prepared.version, cashPaid: true }, key = randomUUID();
    await role('ACCOUNTANT');
    expect((await cmd(`refunds/${prepared.id}/confirm`, body, staff, key)).status()).toBe(403);
    expect((await currentDrawer()).totals.refunds).toBe('0');
    await role('CASHIER');
    await Promise.all([1, 2].map(async () => good(await cmd(`refunds/${prepared.id}/confirm`, body, staff, key))));
    await expect.poll(async () => (await good(await get('returns/' + returned.id))).status, { timeout: 30000 }).toBe('COMPLETED');
    expect(await balance()).toMatchObject({ on_hand: '8.500', quarantined: '0.500', available: '8.000', inventory_value: '340000' });
    expect((await currentDrawer()).ledger).toHaveLength(2);
    const movements = (await good(await get(`stock-movements?siteId=${site.id}&type=RETURN`))).items;
    expect(movements.filter((m: any) => m.document_id === returned.id)).toHaveLength(1);
    expect((await currentDrawer()).totals).toMatchObject({ sales: '190000', refunds: '47500', net: '142500' });
    expect((await good(await get(`orders/${sale.id}/receipt`))).snapshot).toEqual(receiptBefore.snapshot);
    await expect.poll(async () => (await summary()).totals.revenue_vnd, { timeout: 30000 }).toBe('142500');
    expect((await summary()).totals).toMatchObject({ orders: 1, sales_vnd: '190000', returns_vnd: '47500', cost_vnd: '60000', profit_vnd: '82500' });
  });

  test('W10-15 Cancelling an unpaid checkout releases stock and never enters cash or sales totals', async () => {
    const draft = await pending('1', '0');
    await good(await cmd(`orders/${draft.id}/cancel`, { version: draft.version, reason: 'Khách không nhận hàng' }, staff));
    const cancelled = await waitOrder(draft.id, 'CANCELLED');
    expect(cancelled.checkout.payment.status).toBe('FAILED');
    expect(await balance()).toMatchObject({ on_hand: '8.500', reserved: '0.000', available: '8.000' });
    expect((await currentDrawer()).ledger).toHaveLength(2);
    expect((await summary()).totals.orders).toBe(1);
  });

  test('W10-16 Cached drawer commands recheck blocked membership and changed site scope', async () => {
    const endpoint = `shifts/${shift.id}/cash-entries`, body = { kind: 'OUT', amountVnd: '12500', reason: 'Chi vận chuyển' }, key = randomUUID();
    const entry = await good(await cmd(endpoint, body, staff, key));
    await role('CASHIER', 'BLOCKED');
    expect((await cmd(endpoint, body, staff, key)).status()).toBe(403);
    await role('CASHIER', 'ACTIVE', [secondSite.id]);
    expect((await cmd(endpoint, body, staff, key)).status()).toBe(404);
    await role('CASHIER');
    expect((await good(await cmd(endpoint, body, staff, key))).id).toBe(entry.id);
    expect((await currentDrawer()).ledger).toHaveLength(3);
    expect((await currentDrawer()).expected_now).toBe('630000');
    await expect.poll(async () => (await summary()).cash.totals.net_vnd, { timeout: 30000 }).toBe('130000');
    expect((await summary()).totals.revenue_vnd).toBe('142500');
  });

  test('W10-17 Export jobs bind current permission version and never inherit a later cost grant', async () => {
    await role('MANAGER');
    const exportBody = { kind: 'sales', filters: { ...dates, siteId: site.id }, language: 'en' };
    const job = await good(await cmd('report-exports', exportBody, staff));
    await expect.poll(async () => (await good(await get('report-exports/' + job.id, staff))).status, { timeout: 30000 }).toBe('READY');
    const old = await good(await get(`report-exports/${job.id}/download`, staff));
    expect(old.csv).not.toContain('Gross profit'); expect(old.csv).not.toContain('Net cost of goods sold');
    expect(old.csv).toContain('142500');
    expect((await get(`report-exports/${job.id}/download`)).status()).toBe(404);
    await role('ACCOUNTANT');
    expect((await get(`report-exports/${job.id}/download`, staff)).status()).toBe(403);
    const fresh = await good(await cmd('report-exports', exportBody, staff));
    await expect.poll(async () => (await good(await get('report-exports/' + fresh.id, staff))).status, { timeout: 30000 }).toBe('READY');
    const csv = (await good(await get(`report-exports/${fresh.id}/download`, staff))).csv;
    expect(csv).toContain('Gross profit VND'); expect(csv).toContain('Net cost of goods sold VND');
    expect(csv).toContain('82500'); expect(csv).toContain('60000');
    await role('ACCOUNTANT', 'BLOCKED');
    expect((await get(`report-exports/${fresh.id}/download`, staff)).status()).toBe(403);
    await role('CASHIER');
  });

  test('W10-18 Settlement variance follows actual ledger, produces work and resolves after approval', async () => {
    const current = await currentDrawer();
    shift = await good(await cmd(`shifts/${shift.id}/close`, { siteId: site.id, version: current.version,
      countedCash: '629000', note: 'Thiếu 1.000 đồng khi kiểm đếm' }, staff));
    expect(shift.expected_cash).toBe('630000'); expect(shift.difference_vnd).toBe('-1000');
    expect((await cmd(`shifts/${shift.id}/cash-entries`, { kind: 'IN', amountVnd: '1000', reason: 'Bổ sung sau chốt' }, staff)).status()).toBe(409);
    const work = async () => good(await get(`work-items?siteId=${site.id}&kind=SHIFT_VARIANCE`));
    await expect.poll(async () => (await work()).items.length, { timeout: 30000 }).toBe(1);
    expect((await cmd(`shifts/${shift.id}/approve-variance`, { version: shift.version, note: 'Đối chiếu quỹ' }, staff)).status()).toBe(403);
    await good(await cmd(`shifts/${shift.id}/approve-variance`, { version: shift.version, note: 'Đã đối chiếu chứng từ và số đếm' }));
    await expect.poll(async () => (await work()).items.length, { timeout: 30000 }).toBe(0);
    expect((await currentDrawer()).expected_cash).toBe('630000');
    expect((await currentDrawer()).ledger).toHaveLength(3);
  });

  test('W10-19 Product UI shows reconciled sales, inventory, cash and a real downloadable CSV', async () => {
    test.setTimeout(120000);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByLabel('Chọn hộ kinh doanh').selectOption(tenant);
    await page.getByRole('button', { name: 'Báo cáo', exact: true }).click();
    await page.getByLabel('Địa điểm báo cáo').selectOption(site.id);
    await expect(page.locator('.report-metric').first()).toContainText('142.500');
    await page.screenshot({ path: evidence + '/01-sales.png', fullPage: true });
    await page.getByRole('button', { name: 'Xuất CSV', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Tải tệp CSV', exact: true })).toBeVisible({ timeout: 30000 });
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Tải tệp CSV', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toContain('Storeluma-sales');
    expect(await download.failure()).toBeNull();
    const csv = readFileSync((await download.path())!, 'utf8');
    expect(csv).toContain('142500'); expect(csv).toContain('82500');
    await page.getByRole('button', { name: 'Tồn kho hiện tại', exact: true }).click();
    await expect(page.locator('.report-table')).toContainText(sku.code);
    await expect(page.locator('.report-table')).toContainText('340.000');
    await page.screenshot({ path: evidence + '/02-stock.png', fullPage: true });
    await page.getByRole('button', { name: 'Thu chi tại quầy', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thu chi theo ngày' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Báo cáo kinh doanh', exact: true })).toContainText('130.000');
    await page.screenshot({ path: evidence + '/03-cash.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: evidence + '/04-mobile.png', fullPage: false });
    expect(errors).toEqual([]);
  });
});
