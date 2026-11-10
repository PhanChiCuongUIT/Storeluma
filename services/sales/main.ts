import {ProjectionSource} from '../../packages/platform/projections.js';
import { migrate } from "../../packages/platform/db.js";
import { start } from "../../packages/platform/http.js";
import { worker } from "../../packages/platform/bus.js";
import { Orders } from "./orders.js";
import { checkoutTick } from "./checkout.js";
import { Returns } from './returns.js';
import { Receipts } from './receipts.js';
import { returnTick } from './return-saga.js';
await migrate("sales");
await worker("sales", [], async () => {});
await start([ProjectionSource,Orders,Returns,Receipts]);
setInterval(()=>void returnTick().catch(()=>console.warn('Return recovery pending.')),500);
setInterval(
  () =>
    void checkoutTick().catch(() =>
      console.warn("Checkout recovery will retry."),
    ),
  500,
);
