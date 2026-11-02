import { randomUUID } from "node:crypto";
import { db, transaction } from "../../packages/platform/db.js";
import { workflowCall } from "../../packages/platform/workflow-client.js";
import { domainOutbox } from "../../packages/platform/events.js";
import { auditEntry } from "../../packages/platform/commands.js";
import { readReturn } from "./returns.js";
async function step(s: any) {
  const d = await readReturn(db, s.tenant_id, s.return_id),
    ref = { tenantId: s.tenant_id, returnId: s.return_id };
  let stage = s.stage,
    status = d.status,
    refund = s.refund,
    error: string | null = null;
  try {
    if (stage === "RECEIVE") {
      await workflowCall("inventory", "return/receive", ref);
      stage = "REFUND";
      status = "REFUND_PENDING";
    } else if (stage === "REFUND") {
      refund = await workflowCall("finance", "refund/create", ref);
      if (refund.status === "SUCCEEDED") {
        stage = "DONE";
        status = "COMPLETED";
      }
    }
  } catch (e: any) {
    error = String(
      e.getResponse?.()?.message ?? e.message ?? "Đang chờ dịch vụ liên quan.",
    ).slice(0, 500);
  }
  await transaction(async (c) => {
    const current = await readReturn(c, s.tenant_id, s.return_id, true),
      lease = (
        await c.query("SELECT * FROM return_sagas WHERE id=$1 FOR UPDATE", [
          s.id,
        ])
      ).rows[0];
    if (lease.lease_token !== s.lease_token) return;
    if (status !== current.status) {
      await c.query(
        "UPDATE returns SET status=$2,version=version+1,completed_at=CASE WHEN $2='COMPLETED' THEN clock_timestamp() ELSE completed_at END WHERE id=$1",
        [d.id, status],
      );
      await auditEntry(
        c,
        s.tenant_id,
        "service:sales",
        "RETURN_" + status,
        d.id,
        { status: current.status },
        { status },
      );
      if (status === "COMPLETED")
        await domainOutbox(
          c,
          "sales.return-completed.v1",
          d.tenant_id,
          d.site_id,
          d.id,
          current.version + 1,
          {
            returnId: d.id,
            orderId: d.order_id,
            refundId: d.refund_id,
            amountVnd: d.amount_vnd,
            lines: d.lines.map((l: any) => ({
              lineId: l.id,
              orderLineId: l.orderLineId,
              skuId: l.skuId,
              qtyBase: l.qtyBase,
              refundVnd: l.refundVnd,
              costVnd: l.costVnd,
              disposition: l.disposition,
            })),
          },
        );
    }
    await c.query(
      "UPDATE return_sagas SET stage=$2,refund=$3,last_error=$4,attempts=$5,next_attempt_at=now()+$6*interval '1 second',lease_token=null,lease_until=null WHERE id=$1",
      [
        s.id,
        stage,
        refund ? JSON.stringify(refund) : null,
        error,
        error ? s.attempts + 1 : 0,
        error ? Math.min(30, 2 ** Math.min(s.attempts, 5)) : 1,
      ],
    );
  });
}
let busy = false;
export async function returnTick() {
  if (busy) return;
  busy = true;
  try {
    const rows = await transaction(
      async (c) =>
        (
          await c.query(
            "UPDATE return_sagas SET lease_token=$1,lease_until=now()+interval '20 seconds' WHERE id IN (SELECT id FROM return_sagas WHERE stage<>'DONE' AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now()) ORDER BY next_attempt_at LIMIT 8 FOR UPDATE SKIP LOCKED) RETURNING *",
            [randomUUID()],
          )
        ).rows,
    );
    await Promise.allSettled(
      rows.map((s) =>
        step(s).catch(() => console.warn("Return recovery will retry.")),
      ),
    );
  } finally {
    busy = false;
  }
}
