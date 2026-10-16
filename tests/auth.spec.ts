import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { Pool } from "pg";
const origin = "http://localhost:4100";
const account = JSON.parse(
  readFileSync("infra/generated/accounts.json", "utf8"),
)[0];
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .trim()
    .split(/\r?\n/)
    .map((s) => s.split("=")),
);
const gateway = new Pool({
  host: "127.0.0.1",
  port: 55432,
  user: "gateway",
  password: env.GATEWAY_DB_PASSWORD,
  database: "gateway_db",
  max: 2,
});
const hash = (s: string) =>
  createHash("sha256")
    .update("login:" + s)
    .digest("hex");
function otp(secret: string) {
  let bits = 0,
    value = 0;
  const bytes: number[] = [];
  for (const ch of secret) {
    value = (value << 5) | "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const d = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(),
    o = d.at(-1)! & 15;
  return ((d.readUInt32BE(o) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
async function credentials(page: Page) {
  await page.locator("#username").fill(account.username);
  await page.locator("#password").fill(account.password);
  await page.locator("#kc-login").click();
  // Keycloak rejects reusing a successful TOTP in the same time window.
  // Each isolated browser must submit a fresh code, including after other suites.
  await page.locator("#otp").waitFor();
  await new Promise((resolve) =>
    setTimeout(resolve, 31000 - (Date.now() % 30000)),
  );
  await page.locator("#otp").fill(otp(account.otpSecret));
  await page.locator("#kc-login").click();
  await expect(page).toHaveURL(origin + "/");
  await expect(
    page.getByRole("button", { name: "Đăng xuất", exact: true }),
  ).toBeVisible();
}
async function begin(context: BrowserContext) {
  const r = await context.request.get("/auth/login", { maxRedirects: 0 });
  expect(r.status()).toBe(302);
  const url = r.headers().location;
  return { url, state: new URL(url).searchParams.get("state")! };
}
const callback = (state: string) =>
  "/auth/callback?state=" +
  encodeURIComponent(state) +
  "&code=invalid&iss=" +
  encodeURIComponent("http://localhost:8180/realms/storeluma");
const loginCookies = async (context: BrowserContext) =>
  (await context.cookies(origin + "/auth/callback")).filter((c) =>
    c.name.startsWith("sl_login_"),
  );
test.afterAll(async () => {
  await gateway.end();
  // Leave an unused TOTP window for the following foundation suite.
  await new Promise((resolve) =>
    setTimeout(resolve, 31000 - (Date.now() % 30000)),
  );
});
test.beforeAll(async () => {
  await expect
    .poll(
      async () => {
        try {
          return (await fetch(origin + "/health")).status;
        } catch {
          return 0;
        }
      },
      { timeout: 90000 },
    )
    .toBe(200);
});

test("AUTH-01 Expired login attempt returns to usable sign-in and can authenticate again", async ({
  page,
  context,
}) => {
  const flow = await begin(context),
    cookies = await loginCookies(context);
  expect(cookies).toHaveLength(1);
  expect(cookies[0].httpOnly).toBe(true);
  expect(cookies[0].sameSite).toBe("Lax");
  await gateway.query(
    "UPDATE sessions SET expires_at=now()-interval '1 second' WHERE id_hash=$1",
    [hash(cookies[0].value)],
  );
  await page.goto(callback(flow.state));
  await expect(page).toHaveURL(origin + "/?auth=expired");
  await expect(page.getByRole("alert")).toContainText(
    "Lượt đăng nhập đã hết hạn",
  );
  expect((await context.request.get("/v1/me")).status()).toBe(401);
  mkdirSync("tmp/auth/screenshots", { recursive: true });
  await page.locator(".sign-in-card").screenshot({
    path: "tmp/auth/screenshots/expired-login.png",
  });
  await page.getByRole("link", { name: /Đăng nhập vào Storeluma/ }).click();
  await credentials(page);
  expect((await context.request.get("/auth/session")).status()).toBe(200);
});
test("AUTH-02 Revisiting callback and login does not delete an authenticated session", async ({
  page,
  context,
}) => {
  let completed = "";
  page.on("request", (r) => {
    if (r.url().startsWith(origin + "/auth/callback?")) completed = r.url();
  });
  await page.goto("/auth/login");
  await credentials(page);
  const sid = (await context.cookies()).find(
    (c) => c.name === "sl_session",
  )!.value;
  const original = completed;
  expect(original).not.toBe("");
  await page.goto(original);
  await expect(page).toHaveURL(origin + "/");
  expect((await context.request.get("/auth/session")).status()).toBe(200);
  await page.goto("/auth/login");
  await expect(page).toHaveURL(origin + "/");
  expect(
    (await context.cookies()).find((c) => c.name === "sl_session")!.value,
  ).toBe(sid);
});
test("AUTH-03 Two login attempts do not overwrite each other", async ({
  page,
  context,
}) => {
  const first = await begin(context),
    second = await begin(context);
  expect(first.state).not.toBe(second.state);
  expect(await loginCookies(context)).toHaveLength(2);
  await page.goto(first.url);
  await credentials(page);
  expect((await context.request.get("/auth/session")).status()).toBe(200);
  await page.goto(callback(second.state));
  await expect(page).toHaveURL(origin + "/");
  expect((await context.request.get("/v1/me")).status()).toBe(200);
  expect(await loginCookies(context)).toHaveLength(0);
});
test("AUTH-04 Wrong state or another browser cannot consume a valid login attempt", async ({
  page,
  context,
  browser,
}) => {
  const flow = await begin(context),
    sid = (await loginCookies(context))[0].value;
  const stranger = await browser.newContext();
  try {
    const r = await stranger.request.get(callback(flow.state), {
      maxRedirects: 0,
    });
    expect(r.headers().location).toBe("/?auth=expired");
    expect((await stranger.request.get("/v1/me")).status()).toBe(401);
  } finally {
    await stranger.close();
  }
  const r = await context.request.get(callback("wrong-state"), {
    maxRedirects: 0,
  });
  expect(r.headers().location).toBe("/?auth=expired");
  expect(
    (
      await gateway.query("SELECT 1 FROM sessions WHERE id_hash=$1", [
        hash(sid),
      ])
    ).rowCount,
  ).toBe(1);
  await page.goto(flow.url);
  await credentials(page);
});
test("AUTH-05 Invalid code consumes only its pending attempt and offers a safe retry", async ({
  page,
  context,
}) => {
  const flow = await begin(context),
    sid = (await loginCookies(context))[0].value;
  await page.goto(callback(flow.state));
  await expect(page).toHaveURL(origin + "/?auth=failed");
  expect(
    (
      await gateway.query("SELECT 1 FROM sessions WHERE id_hash=$1", [
        hash(sid),
      ])
    ).rowCount,
  ).toBe(0);
  expect(await loginCookies(context)).toHaveLength(0);
  expect((await context.request.get("/v1/me")).status()).toBe(401);
  await expect(page.getByRole("alert")).toContainText("Chưa xác minh được");
  await page.getByRole("link", { name: /Đăng nhập vào Storeluma/ }).click();
  await credentials(page);
});
test("AUTH-06 Login from loopback IP uses canonical origin before setting cookies", async ({
  page,
  context,
}) => {
  const r = await context.request.get("http://127.0.0.1:4100/auth/login", {
    maxRedirects: 0,
  });
  expect(r.status()).toBe(302);
  expect(r.headers().location).toBe(origin + "/auth/login");
  expect(r.headers()["set-cookie"]).toBeUndefined();
  await page.goto("http://127.0.0.1:4100/auth/login");
  await credentials(page);
  expect((await context.request.get("/auth/session")).status()).toBe(200);
});
