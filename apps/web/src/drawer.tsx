import {t,locale,localizedLabels} from "./i18n";
import React, { useEffect, useState } from "react";
import { useCommand, vnd, when } from "./after-sales";
type Row = Record<string, any>;
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
export function ShiftDesk({
  api,
  path,
  siteId,
  role,
  subjectId,
  onChange,
  initialShiftId,
}: {
  api: Api;
  path: string;
  siteId: string;
  role: string;
  subjectId: string;
  onChange: () => Promise<unknown>;
  initialShiftId?:string;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [activeShift, setActiveShift] = useState<Row | null>(null),
    [detail, setDetail] = useState<Row | null>(null),
    [mode, setMode] = useState(""),
    [amount, setAmount] = useState(""),
    [note, setNote] = useState(""),
    [kind, setKind] = useState("OUT"),
    [reversal, setReversal] = useState("");
  const { command, run, error, busy } = useCommand(api, path),
    manager = ["OWNER", "MANAGER"].includes(role),
    writable = ["OWNER", "MANAGER", "CASHIER"].includes(role);
  const current = rows.find((s) => s.status === "OPEN") ?? activeShift,
    own = detail && (role !== "CASHIER" || detail.cashier_id === subjectId);
  async function load(id?: string) {
    const res = await api(path + "/shifts?siteId=" + siteId);
    setRows(res.items);
    setActiveShift(res.activeShift ?? null);
    const readable = res.items.filter(
      (s: Row) => role !== "CASHIER" || s.cashier_id === subjectId,
    );
    const selected =
      id ??
      readable.find((s: Row) => s.status === "OPEN")?.id ??
      readable[0]?.id;
    setDetail(selected ? await api(path + "/shifts/" + selected) : null);
  }
  useEffect(() => {
    setDetail(null);
    setActiveShift(null);
    setMode("");
    if (siteId) void run(() => load(initialShiftId));
  }, [siteId]);
  const form = (value: string) => {
    setMode(value);
    setAmount("");
    setNote("");
  };
  return (
    <section className="drawer-desk">
      <div className="sales-list-heading">
        <div>
          <h2>{t("Ca thu ngân")}</h2>
          <p>{t("Đối chiếu tiền đầu ca, tiền bán, tiền hoàn và thu chi tại quầy.")}</p>
        </div>
        <div className="pos-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => void run(() => load(detail?.id))}
          >{t("Làm mới ca")}</button>
          {writable && !current && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => form("open")}
            >{t("Mở ca mới")}</button>
          )}
        </div>
      </div>
      {role === 'CASHIER' && current && current.cashier_id !== subjectId && (
        <p className="pos-card">{t("Quầy đang có ca do người khác mở.")}</p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {t(error)}
        </p>
      )}
      <div className="drawer-layout">
        <aside className="shift-history" aria-label={t("Lịch sử ca")}>
          {rows
            .filter((s) => role !== "CASHIER" || s.cashier_id === subjectId)
            .map((s) => (
              <button
                key={s.id}
                className={detail?.id === s.id ? "selected" : ""}
                onClick={() =>
                  void run(async () => {
                    setDetail(await api(path + "/shifts/" + s.id));
                    setMode("");
                  })
                }
              >
                <strong>{s.status === "OPEN" ? t("Đang mở") : t("Đã đóng")}</strong>
                <span>{when(s.opened_at)}</span>
                <small>
                  {s.status === "CLOSED"
                    ? "Thực đếm " + vnd(s.counted_cash)
                    : "Đầu ca " + vnd(s.opening_cash)}
                </small>
              </button>
            ))}
        </aside>
        <div>
          {detail ? (
            <>
              <div className="drawer-metrics">
                {[
                  [t("Đầu ca"), detail.opening_cash],
                  [t("Thu bán hàng"), detail.totals.sales],
                  [t("Hoàn khách"), detail.totals.refunds],
                  [t("Thu / chi khác"), detail.totals.adjustments],
                ].map(([k, v]) => (
                  <article key={k}>
                    <small>{k}</small>
                    <strong>{vnd(v)}</strong>
                  </article>
                ))}
              </div>
              <article className="drawer-balance pos-card">
                <div>
                  <small>{t("TIỀN DỰ KIẾN TẠI QUẦY")}</small>
                  <h2>{vnd(detail.expected_cash ?? detail.expected_now)}</h2>
                  <p>
                    {detail.status === "OPEN"
                      ? "Đang mở từ " + when(detail.opened_at)
                      : "Đã đóng lúc " + when(detail.closed_at)}
                  </p>
                </div>
                <div className="pos-actions">
                  {detail.status === "OPEN" && own && writable && (
                    <>
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => form("entry")}
                      >{t("Thu / chi quầy")}</button>
                      <button
                        className="button primary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await load(detail.id);
                            form("close");
                          })
                        }
                      >{t("Chốt ca")}</button>
                    </>
                  )}
                  {detail.status === "CLOSED" && (
                    <div>
                      <p>{t("Thực đếm")+" "}<b>{vnd(detail.counted_cash)}</b>
                      </p>
                      <p>{t("Chênh lệch")+" "}<b>{vnd(detail.difference_vnd)}</b>
                      </p>
                    </div>
                  )}
                </div>
              </article>
              {(detail.pendingPayments.length > 0 ||
                detail.pendingRefunds.length > 0) && (
                <div className="pos-card pending-cash">
                  <strong>{t("Chưa thể chốt ca")}</strong>
                  <p>
                    {detail.pendingPayments.length}{" "+t("khoản chờ thu ·")}{" "}
                    {detail.pendingRefunds.length}{" "+t("khoản chờ hoàn")}</p>
                  {detail.pendingPayments.map((p: Row) => (
                    <p key={p.id}>
                      {p.order_code}: {vnd(p.amount_vnd)}
                    </p>
                  ))}
                </div>
              )}
              {detail.status === "CLOSED" && detail.difference_vnd !== "0" && (
                <article className="pos-card">
                  <h3>
                    {detail.variance_approved_by
                      ? t("Đã xác nhận chênh lệch")
                      : t("Chênh lệch chờ quản lý xác nhận")}
                  </h3>
                  <p>{detail.close_note}</p>
                  {detail.variance_approval_note && (
                    <p>{detail.variance_approval_note}</p>
                  )}
                  {manager && !detail.variance_approved_by && (
                    <button
                      className="button secondary"
                      onClick={() => form("variance")}
                    >{t("Xác nhận chênh lệch")}</button>
                  )}
                </article>
              )}
              <article className="pos-card">
                <header>
                  <h3>{t("Giao dịch trong ca")}</h3>
                  <small>{t("200 giao dịch gần nhất")}</small>
                </header>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t("Thời điểm")}</th>
                        <th>{t("Nội dung")}</th>
                        <th>{t("Số tiền")}</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.ledger.map((l: Row) => (
                        <tr key={l.id}>
                          <td>{when(l.created_at)}</td>
                          <td>
                            {l.payment_id
                              ? "Thu đơn " + l.order_code
                              : l.refund_id
                                ? t("Hoàn tiền khách")
                                : l.kind === "REVERSAL"
                                  ? t("Đảo phiếu thu/chi")
                                  : l.kind === "IN"
                                    ? t("Thu tại quầy")
                                    : t("Chi tại quầy")}
                            {l.reason && <small>{l.reason}</small>}
                          </td>
                          <td
                            className={
                              BigInt(l.amount_vnd) < 0n ? "cash-out" : "cash-in"
                            }
                          >
                            {vnd(l.amount_vnd)}
                          </td>
                          <td>
                            {manager &&
                              l.cash_entry_id &&
                              l.kind !== "REVERSAL" &&
                              current && (
                                <button
                                  className="button secondary small"
                                  onClick={() => {
                                    setReversal(l.cash_entry_id);
                                    form("reverse");
                                  }}
                                >{t("Đảo phiếu")}</button>
                              )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!detail.ledger.length && (
                    <p className="pos-empty">{t("Ca chưa có giao dịch.")}</p>
                  )}
                </div>
              </article>
            </>
          ) : (
            <p className="pos-card pos-empty">{t("Chưa có ca để đối chiếu.")}</p>
          )}
        </div>
      </div>
      {mode && (
        <div className="pos-modal-backdrop">
          <form
            className="pos-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("Xử lý ca thu ngân")}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                let id = detail?.id;
                if (mode === "open") {
                  const n = await command("/shifts", {
                    siteId,
                    openingCash: amount,
                  });
                  id = n.id;
                }
                if (mode === "close")
                  await command("/shifts/" + detail!.id + "/close", {
                    siteId,
                    version: detail!.version,
                    countedCash: amount,
                    note,
                  });
                if (mode === "entry")
                  await command("/shifts/" + detail!.id + "/cash-entries", {
                    kind,
                    amountVnd: amount,
                    reason: note,
                  });
                if (mode === "variance")
                  await command("/shifts/" + detail!.id + "/approve-variance", {
                    version: detail!.version,
                    note,
                  });
                if (mode === "reverse")
                  await command("/cash-entries/" + reversal + "/reverse", {
                    shiftId: current!.id,
                    reason: note,
                  });
                setMode("");
                await load(id);
                await onChange();
              });
            }}
          >
            <h2>
              {
                {
                  open: t("Mở ca thu ngân"),
                  close: t("Chốt tiền cuối ca"),
                  entry: t("Thu / chi tại quầy"),
                  variance: t("Xác nhận chênh lệch"),
                  reverse: t("Đảo phiếu thu / chi"),
                }[mode]
              }
            </h2>
            {mode === "close" && (
              <p>{t("Tiền dự kiến")+" "}<strong>{vnd(detail?.expected_now)}</strong>
              </p>
            )}
            {mode === "entry" && (
              <label>{t("Loại giao dịch")}<select value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="OUT">{t("Chi từ quầy")}</option>
                  <option value="IN">{t("Thu thêm vào quầy")}</option>
                </select>
              </label>
            )}
            {["open", "close", "entry"].includes(mode) && (
              <label>
                {mode === "open"
                  ? t("Tiền đầu ca")
                  : mode === "close"
                    ? t("Tiền thực đếm")
                    : t("Số tiền")}
                <input
                  aria-label={t("Số tiền xử lý ca")}
                  required
                  type="number"
                  min={mode === "entry" ? 1 : 0}
                  step="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
            {mode !== "open" && (
              <label>{t("Lý do / ghi chú")}<textarea
                  required={mode !== "close" || amount !== detail?.expected_now}
                  minLength={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            )}
            {mode === "reverse" && (
              <p>{t("Ghi bút toán ngược vào ca đang mở; phiếu gốc và ca đã đóng được giữ nguyên.")}</p>
            )}
            {error && (
              <p role="alert" className="alert error">
                {t(error)}
              </p>
            )}
            <div className="pos-actions">
              <button className="button primary" disabled={busy}>{t("Lưu xác nhận")}</button>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setMode("")}
              >{t("Quay lại")}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
