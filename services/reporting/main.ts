import { migrate } from "../../packages/platform/db.js";
import { start } from "../../packages/platform/http.js";
import { worker } from "../../packages/platform/bus.js";
import {
  consumeProjection,
  projectionRoutes,
  syncProjectionTick,
} from "../../packages/platform/projections.js";
import { Reports, exportTick } from "./reports.js";
await migrate("reporting");
await worker("reporting", projectionRoutes, consumeProjection);
await start([Reports]);
setInterval(
  () =>
    void syncProjectionTick().catch(() =>
      console.warn("projection_sync_pending"),
    ),
  1000,
);
setInterval(
  () => void exportTick().catch(() => console.warn("report_export_pending")),
  1000,
);
