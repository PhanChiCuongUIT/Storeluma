import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./pos.css";
type Row = Record<string, any>;
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
export const vnd = (n: any) =>
  new Intl.NumberFormat("vi-VN").format(BigInt(n ?? "0")) + " ₫";
export const when = (n: string) =>
  new Date(n).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
export const returnLabels: Record<string, string> = {
  REQUESTED: "Chờ duyệt",
  APPROVED: "Chờ nhận hàng",
  REFUND_PENDING: "Chờ hoàn tiền",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã hủy",
};
export function useCommand(api: Api, path: string) {
  const keys = useRef(new Map<string, string>()),
    guard = useRef(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const command = async (resource: string, data: unknown) => {
    const signature = path + resource + JSON.stringify(data);
    if (!keys.current.has(signature))
      keys.current.set(signature, crypto.randomUUID());
    const result = await api(
      path + resource,
      "POST",
      data,
      keys.current.get(signature),
    );
    keys.current.delete(signature);
    return result;
  };
  const run = async (fn: () => Promise<void>) => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  return { command, run, error, busy };
}
export function ReceiptView({
  api,
  path,
  orderId,
}: {
  api: Api;
  path: string;
  orderId: string;
}) {
  const [data, setData] = useState<Row | null>(null);
  const { command, run, error, busy } = useCommand(api, path);
  useEffect(() => {
    document.body.classList.toggle("receipt-printing", Boolean(data));
    return () => document.body.classList.remove("receipt-printing");
  }, [data]);
  const s = data?.snapshot;
  return (
    <>
      <button
        className="button secondary"
        disabled={busy}
        onClick={() =>
          void run(async () =>
            setData(
              await command("/orders/" + orderId + "/receipt/prints", {}),
            ),
          )
        }
      >
        Xem / in biên nhận
      </button>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {data &&
        createPortal(
          <div
            className="receipt-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Biên nhận bán hàng"
          >
            <div className="receipt-controls">
              <button className="button primary" onClick={() => window.print()}>
                In biên nhận
              </button>
              <button
                className="button secondary"
                onClick={() => setData(null)}
              >
                Đóng bản in
              </button>
              <small>Khổ giấy 80 mm · Chọn máy in hoặc lưu PDF</small>
            </div>
            <article className="receipt-paper">
              <img src="/brand/Logo_Storeluma.png" alt="Storeluma" />
              <h2>{s!.tenantName}</h2>
              <p>
                {s!.siteName}
                <br />
                {s!.siteAddress}
              </p>
              <h3>BIÊN NHẬN BÁN HÀNG</h3>
              {data.reprint && (
                <strong className="receipt-reprint">BẢN IN LẠI</strong>
              )}
              <p>
                {s!.number}
                <br />
                {when(s!.completedAt)}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Mặt hàng</th>
                    <th>Thành tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {s!.lines.map((l: Row) => (
                    <tr key={l.id}>
                      <td>
                        {l.name}
                        <small>
                          {l.quantity} {l.unitName} × {vnd(l.priceVnd)}
                          {l.discountVnd !== "0" && (
                            <>
                              <br />
                              Giảm {vnd(l.discountVnd)}
                            </>
                          )}
                        </small>
                      </td>
                      <td>{vnd(l.netVnd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl>
                <div>
                  <dt>Tiền hàng</dt>
                  <dd>{vnd(s!.subtotalVnd)}</dd>
                </div>
                <div>
                  <dt>Giảm giá</dt>
                  <dd>{vnd(s!.discountVnd)}</dd>
                </div>
                <div className="receipt-total">
                  <dt>Đã thanh toán</dt>
                  <dd>{vnd(s!.paidVnd)}</dd>
                </div>
                <div>
                  <dt>Khách đưa</dt>
                  <dd>{vnd(s!.tenderedVnd)}</dd>
                </div>
                <div>
                  <dt>Tiền thừa</dt>
                  <dd>{vnd(s!.changeVnd)}</dd>
                </div>
              </dl>
              <p>
                Thanh toán tiền mặt
                <br />
                Cảm ơn quý khách!
              </p>
              <footer>Biên nhận nội bộ, không phải hóa đơn điện tử.</footer>
            </article>
          </div>,
          document.body,
        )}
    </>
  );
}
export function ReturnDetail({
  api,
  path,
  id,
  role,
  shift,
  onChange,
}: {
  api: Api;
  path: string;
  id: string;
  role: string;
  shift: Row | null;
  onChange: () => void;
}) {
  const [d, setD] = useState<Row | null>(null),
    [readError, setReadError] = useState(""),
    [note, setNote] = useState(""),
    [cashPaid, setCashPaid] = useState(false);
  const { command, run, error, busy } = useCommand(api, path);
  useEffect(() => {
    let live = true,
      inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const n = await api(path + "/returns/" + id);
        if (live) {
          setD(n);
          setReadError("");
        }
      } catch (e) {
        if (live) setReadError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(() => void load(), 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [id, path]);
  const refresh = async () => {
    setD(await api(path + "/returns/" + id));
    onChange();
  };
  useEffect(() => {
    if (d) onChange();
  }, [d?.status]);
  if (!d) return <p role="status">{readError || "Đang đọc phiếu trả…"}</p>;
  const refund = d.progress?.refund,
    manager = ["OWNER", "MANAGER"].includes(role),
    canPay = ["OWNER", "MANAGER", "CASHIER"].includes(role);
  return (
    <article className="pos-card return-detail">
      {readError && (
        <p className="alert error" role="alert">
          {readError}
        </p>
      )}
      <header>
        <div>
          <small>PHIẾU TRẢ HÀNG</small>
          <h3>{d.code}</h3>
        </div>
        <span className={"return-badge " + d.status.toLowerCase()}>
          {returnLabels[d.status]}
        </span>
      </header>
      <p>{d.reason}</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mặt hàng</th>
              <th>Lượng trả</th>
              <th>Tiếp nhận</th>
              <th>Tiền hoàn</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l: Row) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>
                  {l.quantity} {l.unitName}
                </td>
                <td>
                  {l.disposition === "QUARANTINE" ? "Cách ly" : "Bán lại"}
                </td>
                <td>{vnd(l.refundVnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pos-total">
        <span>Tổng hoàn cho khách</span>
        <strong>{vnd(d.amount_vnd)}</strong>
      </div>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {d.status === "REQUESTED" && canPay && (
        <div className="pos-form">
          <label>
            {d.late_return ? "Lý do duyệt quá hạn 7 ngày" : "Ghi chú xử lý"}
            <textarea
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="pos-actions">
            {manager && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await command("/returns/" + id + "/approve", {
                      version: d.version,
                      note,
                    });
                    await refresh();
                  })
                }
              >
                Duyệt nhận hàng trả
              </button>
            )}
            <button
              className="button secondary"
              disabled={busy || note.trim().length < 3}
              onClick={() =>
                void run(async () => {
                  await command("/returns/" + id + "/cancel", {
                    version: d.version,
                    reason: note,
                  });
                  await refresh();
                })
              }
            >
              Hủy yêu cầu trả
            </button>
          </div>
        </div>
      )}
      {d.status === "APPROVED" && (
        <p className="pos-muted">
          Đang chờ kho tiếp nhận.{" "}
          {d.progress?.last_error ?? "Phiếu sẽ tự cập nhật khi nhận xong."}
        </p>
      )}
      {d.status === "REFUND_PENDING" && (
        <div className="refund-panel">
          <h4>Hàng đã nhận lại</h4>
          <p>Chỉ xác nhận sau khi đã giao đủ tiền hoàn cho khách.</p>
          {!refund && (
            <p>
              {d.progress?.last_error ?? "Đang chuẩn bị yêu cầu hoàn tiền…"}
            </p>
          )}
          {refund?.status === "PENDING" && canPay && (
            <>
              {!refund.shift_id ? (
                <button
                  className="button primary"
                  disabled={busy || !shift}
                  onClick={() =>
                    void run(async () => {
                      await command("/refunds/" + refund.id + "/prepare", {
                        shiftId: shift!.id,
                        version: refund.version,
                      });
                      await refresh();
                    })
                  }
                >
                  Chuẩn bị hoàn tiền trên ca
                </button>
              ) : (
                <>
                  <label className="sale-check">
                    <input
                      type="checkbox"
                      checked={cashPaid}
                      onChange={(e) => setCashPaid(e.target.checked)}
                    />
                    Đã giao đủ tiền hoàn cho khách
                  </label>
                  <button
                    className="button primary"
                    disabled={
                      busy || !cashPaid || shift?.id !== refund.shift_id
                    }
                    onClick={() =>
                      void run(async () => {
                        await command("/refunds/" + refund.id + "/confirm", {
                          shiftId: refund.shift_id,
                          version: refund.version,
                          cashPaid: true,
                        });
                        setCashPaid(false);
                        await refresh();
                      })
                    }
                  >
                    Xác nhận đã hoàn tiền
                  </button>
                </>
              )}
              {!shift && <p>Cần ca đang mở mà bạn được phép xử lý để hoàn tiền mặt.</p>}
            </>
          )}
          {refund?.status === "SUCCEEDED" && (
            <p>Đã ghi nhận tiền hoàn. Đang hoàn tất phiếu.</p>
          )}
        </div>
      )}
      {d.status === "COMPLETED" && (
        <p className="pos-success">
          Đã nhận hàng và hoàn tiền · {when(d.completed_at)}
        </p>
      )}
    </article>
  );
}
export function AfterSales({
  api,
  path,
  order,
  role,
  shift,
}: {
  api: Api;
  path: string;
  order: Row;
  role: string;
  shift: Row | null;
}) {
  const [data, setData] = useState<Row>({ items: [], returned: [] }),
    [form, setForm] = useState(false),
    [lines, setLines] = useState<Row[]>([]),
    [reason, setReason] = useState(""),
    [selected, setSelected] = useState("");
  const { command, run, error, busy } = useCommand(api, path);
  const load = async () =>
    setData(await api(path + "/orders/" + order.id + "/returns"));
  useEffect(() => {
    void run(load);
    setSelected("");
    setForm(false);
  }, [order.id]);
  const active = data.items.some(
    (x: Row) => !["COMPLETED", "CANCELLED"].includes(x.status),
  );
  return (
    <section className="after-sales">
      <div className="sales-list-heading">
        <div>
          <h2>Trả hàng</h2>
          <p>
            {data.returnStatus === "FULL"
              ? "Đã trả toàn bộ hàng."
              : data.returnStatus === "PARTIAL"
                ? "Đơn đã có hàng trả một phần."
                : "Lập phiếu từ hàng trên đơn bán này."}
          </p>
        </div>
        {["OWNER", "MANAGER", "CASHIER"].includes(role) && (
          <button
            className="button secondary"
            disabled={busy || active || data.returnStatus === "FULL"}
            onClick={() => {
              setLines(
                order.lines.map((l: Row) => ({
                  ...l,
                  returnQuantity: "",
                  disposition: "SELLABLE",
                })),
              );
              setReason("");
              setForm(true);
            }}
          >
            Lập phiếu trả
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {active && (
        <p className="pos-muted">
          Hoàn tất phiếu đang xử lý trước khi lập lần trả tiếp theo.
        </p>
      )}
      {form && (
        <form
          className="pos-card pos-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const picked = lines
                .filter((l) => Number(l.returnQuantity) > 0)
                .map((l) => ({
                  orderLineId: l.id,
                  quantity: l.returnQuantity,
                  disposition: l.disposition,
                }));
              const d = await command("/orders/" + order.id + "/returns", {
                reason,
                lines: picked,
              });
              setForm(false);
              setSelected(d.id);
              await load();
            });
          }}
        >
          {lines.map((l, i) => (
            <div className="return-line" key={l.id}>
              <div>
                <strong>{l.name}</strong>
                <small>
                  Đã bán {l.quantity} {l.unitName} · Đã trả{" "}
                  {data.returned.find((x: Row) => x.orderLineId === l.id)
                    ?.quantity ?? "0"}
                </small>
              </div>
              <label>
                Lượng trả
                <input
                  aria-label={"Lượng trả " + (i + 1)}
                  type="number"
                  min="0"
                  step="0.001"
                  value={l.returnQuantity}
                  onChange={(e) =>
                    setLines((xs) =>
                      xs.map((x) =>
                        x.id === l.id
                          ? { ...x, returnQuantity: e.target.value }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Tình trạng
                <select
                  aria-label={"Tình trạng trả " + (i + 1)}
                  value={l.disposition}
                  onChange={(e) =>
                    setLines((xs) =>
                      xs.map((x) =>
                        x.id === l.id
                          ? { ...x, disposition: e.target.value }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="SELLABLE">Có thể bán lại</option>
                  <option value="QUARANTINE">Hỏng / cần cách ly</option>
                </select>
              </label>
            </div>
          ))}
          <label>
            Lý do trả hàng
            <textarea
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="pos-actions">
            <button className="button primary" disabled={busy}>
              Gửi yêu cầu trả hàng
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => setForm(false)}
            >
              Quay lại
            </button>
          </div>
        </form>
      )}
      <div className="return-history">
        {data.items.map((d: Row) => (
          <button
            key={d.id}
            onClick={() => setSelected(d.id)}
            className={selected === d.id ? "selected" : ""}
          >
            <strong>{d.code}</strong>
            <span>{returnLabels[d.status]}</span>
            <b>{vnd(d.amount_vnd)}</b>
          </button>
        ))}
      </div>
      {selected && (
        <ReturnDetail
          key={selected}
          api={api}
          path={path}
          id={selected}
          role={role}
          shift={shift}
          onChange={() => void load()}
        />
      )}
    </section>
  );
}
export function ReturnQueue({
  api,
  path,
  siteId,
  role,
  shift,
  openOrder,
}: {
  api: Api;
  path: string;
  siteId: string;
  role: string;
  shift: Row | null;
  openOrder: (id: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [selected, setSelected] = useState<Row | null>(null),
    [filter, setFilter] = useState("");
  const { run, error } = useCommand(api, path);
  const load = async () =>
    setRows(
      (
        await api(
          path +
            "/returns?siteId=" +
            siteId +
            (filter ? "&status=" + filter : ""),
        )
      ).items,
    );
  useEffect(() => {
    if (siteId) void run(load);
    setSelected(null);
  }, [siteId, filter]);
  return (
    <section>
      <div className="sales-list-heading">
        <div>
          <h2>Phiếu trả hàng</h2>
          <p>Duyệt, theo dõi nhận hàng và hoàn tiền.</p>
        </div>
        <select
          aria-label="Lọc phiếu trả"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="">Tất cả trạng thái</option>
          {Object.entries(returnLabels).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="alert error">{error}</p>}
      <div className="return-history">
        {rows.map((d) => (
          <button key={d.id} onClick={() => setSelected(d)}>
            <strong>{d.code}</strong>
            <span>{returnLabels[d.status]}</span>
            <b>{vnd(d.amount_vnd)}</b>
          </button>
        ))}
      </div>
      {!rows.length && (
        <p className="pos-card pos-empty">Chưa có phiếu trả phù hợp.</p>
      )}
      {selected && (
        <>
          <button
            className="button secondary"
            onClick={() => openOrder(selected.order_id)}
          >
            Mở đơn bán gốc
          </button>
          <ReturnDetail
            key={selected.id}
            api={api}
            path={path}
            id={selected.id}
            role={role}
            shift={shift}
            onChange={() => void load()}
          />
        </>
      )}
    </section>
  );
}
