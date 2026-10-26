import { migrate } from "../../packages/platform/db.js";
import { start } from "../../packages/platform/http.js";
import { worker } from "../../packages/platform/bus.js";
import { Orders } from "./orders.js";
import { checkoutTick } from "./checkout.js";
await migrate("sales");
await worker("sales", [], async () => {});
await start([Orders]);
setInterval(
  () =>
    void checkoutTick().catch(() =>
      console.warn("Checkout recovery will retry."),
    ),
  500,
);
