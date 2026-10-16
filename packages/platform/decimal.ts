/** Exact fixed-point arithmetic: quantities in thousandths, VND in integer dong. */
export function milli(value: string): bigint {
  if (!/^(0|[1-9]\d{0,14})(\.\d{1,3})?$/.test(value))
    throw new RangeError("Số lượng tối đa 3 chữ số thập phân.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
export function fromMilli(value: bigint): string {
  return `${value / 1000n}.${(value % 1000n).toString().padStart(3, "0")}`;
}
export function baseQuantity(qty: string, factor: string): string {
  const product = milli(qty) * milli(factor);
  if (
    product <= 0n ||
    product % 1000n !== 0n ||
    product / 1000n > 999999999999999999n
  )
    throw new RangeError(
      "Lượng quy đổi phải dương và có tối đa 3 chữ số thập phân.",
    );
  return fromMilli(product / 1000n);
}
export function lineCost(qty: string, unitCostVnd: string): string {
  if (!/^(0|[1-9]\d{0,19})$/.test(unitCostVnd))
    throw new RangeError("Giá nhập phải là số đồng không âm.");
  const value = (milli(qty) * BigInt(unitCostVnd) + 500n) / 1000n;
  if (value > 99999999999999999999n)
    throw new RangeError("Giá trị vượt giới hạn.");
  return value.toString();
}
