// Mounted into a disposable Sales container. Only intercept the selected document's reply.
import { existsSync, writeSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { start } from '/app/dist/packages/platform/http.js';
import { Returns } from '/app/dist/services/sales/returns.js';
import { checkoutTick } from '/app/dist/services/sales/checkout.js';
import { returnTick } from '/app/dist/services/sales/return-saga.js';

const [resource, mode, id] = process.argv.slice(2);
if (!['payment/query', 'reservation/commit', 'return/receive'].includes(resource) ||
    !['drop', 'crash', 'hold'].includes(mode) || !id) throw new Error('Invalid saga test arguments');
const originalFetch = globalThis.fetch;
let hit = false;
globalThis.fetch = async (url, options) => {
  const response = await originalFetch(url, options);
  if (hit || !response.ok || !String(url).endsWith('/workflows/' + resource)) return response;
  const request = JSON.parse(options.body);
  if ((request.returnId ?? request.orderId) !== id) return response;
  const result = await response.clone().json();
  if (resource === 'payment/query' && result.status !== 'SUCCEEDED') return response;
  hit = true;
  writeSync(1, 'reply received for ' + id + '\n');
  if (mode === 'crash') process.kill(process.pid, 'SIGKILL');
  if (mode === 'hold') {
    while (!existsSync('/tmp/release-reply')) await sleep(100);
  }
  throw new Error('Workflow response interrupted');
};

// Inventory queries Sales for the approved return before receiving the goods.
if (resource === 'return/receive') await start([Returns]);
writeSync(1, 'worker ready\n');
const tick = resource === 'return/receive' ? returnTick : checkoutTick;
while (!hit) {
  await tick();
  if (!hit) await sleep(200);
}
// All writes from this tick have settled, including any rejected stale result.
process.exit(0);
