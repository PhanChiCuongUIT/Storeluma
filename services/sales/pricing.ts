import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  bodyHash,
  moneyInput,
  quantityInput,
} from "../../packages/platform/commands.js";
import {
  baseQuantity,
  milli,
  fromMilli,
  lineCost,
} from "../../packages/platform/decimal.js";
import { serviceCall } from "../../packages/platform/service-client.js";
import type { ActorRequest } from "../../packages/platform/http.js";
export const quoteInput = z
  .object({
    siteId: z.uuid(),
    lines: z
      .array(
        z
          .object({
            skuId: z.uuid(),
            unitId: z.uuid(),
            quantity: quantityInput,
          })
          .strict(),
      )
      .min(1)
      .max(100),
    discount: z
      .object({ type: z.enum(["AMOUNT", "PERCENT"]), value: moneyInput })
      .strict()
      .default({ type: "AMOUNT", value: "0" }),
  })
  .strict();
/** Largest remainder: allocations always sum to the requested integer amount. */
export function allocate(amount: bigint, weights: bigint[]) {
  const total = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n) return weights.map(() => 0n);
  const result = weights.map((w) => (amount * w) / total);
  const sorted = weights
    .map((w, i) => ({ i, remainder: (amount * w) % total }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.i - b.i
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  let left = amount - result.reduce((a, b) => a + b, 0n);
  for (const x of sorted) {
    if (left-- <= 0n) break;
    result[x.i]++;
  }
  return result;
}
export async function price(
  r: ActorRequest,
  tenant: string,
  p: z.infer<typeof quoteInput>,
  role: string,
) {
  const merged = new Map<string, (typeof p.lines)[number]>();
  for (const l of p.lines) {
    const key = l.skuId + ":" + l.unitId,
      old = merged.get(key);
    merged.set(key, {
      ...l,
      quantity: old
        ? fromMilli(milli(old.quantity) + milli(l.quantity))
        : fromMilli(milli(l.quantity)),
    });
  }
  const request = {
    ...p,
    lines: [...merged.values()].sort((a, b) =>
      (a.skuId + a.unitId).localeCompare(b.skuId + b.unitId),
    ),
  };
  const prices = await serviceCall<any[]>(
    "catalog",
    "/v1/internal/catalog/sale-prices",
    r,
    {
      tenantId: tenant,
      lines: request.lines.map(({ skuId, unitId }) => ({ skuId, unitId })),
    },
  );
  const lines = request.lines.map((l, i) => {
    const s = prices[i];
    let quantityBase: string, gross: string;
    try {
      quantityBase = baseQuantity(l.quantity, s.factor);
      gross = lineCost(l.quantity, s.price_vnd);
    } catch (error) {
      if (error instanceof RangeError)
        throw new BadRequestException(
          "Số lượng quy đổi hoặc tổng tiền vượt độ chính xác cho phép.",
        );
      throw error;
    }
    return {
      id: randomUUID(),
      skuId: l.skuId,
      unitId: l.unitId,
      code: s.code,
      name: s.name,
      baseUnit: s.base_unit,
      unitName: s.unit_name,
      factor: s.factor,
      quantity: l.quantity,
      qtyBase: quantityBase,
      priceVnd: s.price_vnd,
      skuVersion: s.sku_version,
      priceVersion: s.price_version,
      grossVnd: gross,
      discountVnd: "0",
      netVnd: "0",
    };
  });
  const subtotal = lines.reduce((v, l) => v + BigInt(l.grossVnd), 0n),
    value = BigInt(p.discount.value);
  if (p.discount.type === "PERCENT" && value > 100n)
    throw new ConflictException("Giảm giá tối đa 100%.");
  const discount =
    p.discount.type === "AMOUNT" ? value : (subtotal * value + 50n) / 100n;
  if (discount > subtotal || subtotal > 99999999999999999999n)
    throw new ConflictException("Giảm giá hoặc tổng tiền không hợp lệ.");
  if (role === "CASHIER" && discount * 100n > subtotal * 5n)
    throw new ForbiddenException(
      "Thu ngân được giảm tối đa 5%. Nhờ quản lý xử lý mức cao hơn.",
    );
  const shares = allocate(
    discount,
    lines.map((l) => BigInt(l.grossVnd)),
  );
  lines.forEach((l, i) => {
    l.discountVnd = shares[i].toString();
    l.netVnd = (BigInt(l.grossVnd) - shares[i]).toString();
  });
  return {
    request,
    lines,
    subtotal: subtotal.toString(),
    discount: discount.toString(),
    payable: (subtotal - discount).toString(),
    hash: bodyHash({ request, prices }),
  };
}
