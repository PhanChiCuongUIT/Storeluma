import { migrate } from "../../packages/platform/db.js";
import { start } from "../../packages/platform/http.js";
import { worker } from "../../packages/platform/bus.js";
import {
  consumeProjection,
  projectionRoutes,
  syncProjectionTick,
} from "../../packages/platform/projections.js";
import { WorkItems, evaluateWorkItems } from "./work-items.js";
await migrate("notification");
await worker("notification", projectionRoutes, consumeProjection);
await start([WorkItems]);
setInterval(
  () =>
    void syncProjectionTick().catch(() =>
      console.warn("projection_sync_pending"),
    ),
  1000,
);
setInterval(
  () =>
    void evaluateWorkItems().catch(() =>
      console.warn("work_item_evaluation_pending"),
    ),
  2000,
);
