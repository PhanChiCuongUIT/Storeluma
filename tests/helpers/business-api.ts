import { expect, type APIResponse, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fillFreshTotp } from './totp';

export const accounts = JSON.parse(readFileSync('infra/generated/accounts.json', 'utf8'));
const origin = 'http://localhost:4100';
export async function good(response: APIResponse) {
  expect(response.status(), await response.text()).toBeLessThan(300);
  return response.json();
}
export async function login(page: Page, index: number) {
  await page.goto('/auth/login');
  await page.locator('#username').fill(accounts[index].username);
  await page.locator('#password').fill(accounts[index].password);
  await page.locator('#kc-login').click();
  await fillFreshTotp(page, accounts[index].otpSecret);
  await page.locator('#kc-login').click();
  await expect(page).toHaveURL(origin + '/');
}
export async function api(ctx: BrowserContext, path: string, method = 'GET', data?: unknown, key?: string) {
  const session = await good(await ctx.request.get('/auth/session'));
  return ctx.request.fetch(path, { method, data, headers: {
    origin, 'x-csrf-token': session.csrf, ...(key ? { 'idempotency-key': key } : {}),
  } });
}
