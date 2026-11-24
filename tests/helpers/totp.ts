import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

function totp(secret: string, step: number) {
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
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(bytes))
    .update(counter)
    .digest();
  const offset = digest.at(-1)! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}

/** A fresh window at each login prevents reuse across files and worker restarts.
 * Tests run with one worker; separate test processes must use separate accounts.
 * Waiting here also leaves almost the full 30 seconds for the browser to submit.
 */
export async function fillFreshTotp(page: Page, secret: string) {
  const input = page.locator("#otp");
  await input.waitFor({ state: "visible" });
  const clock = await page.evaluate(async () => {
    const response = await fetch("/realms/storeluma/.well-known/openid-configuration", { cache: "no-store" });
    const date = response.headers.get("date");
    // Keycloak can omit Date on a direct HTTP connection. A reverse proxy
    // commonly supplies it. Both test hosts use a synchronized system clock.
    return response.ok && date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : Date.now();
  });
  const step = Math.floor(clock / 30000) + 1;
  await new Promise((resolve) => setTimeout(resolve, step * 30000 + 1500 - clock));
  await input.fill(totp(secret, step));
}
