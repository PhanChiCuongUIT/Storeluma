import React, { useEffect, useRef, useState } from "react";
import "./commerce.css";
import "./sales.css";
type Row = Record<string, any>;
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
const labels: Record<string, string> = {
  DRAFT: "Đơn nháp",
  PENDING: "Chờ thu tiền",
  COMMITTING: "Đang xuất kho",
  REVIEW: "Đang đối chiếu",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã hủy",
};
const money = (v: any) =>
  new Intl.NumberFormat("vi-VN").format(BigInt(v ?? "0")) + " ₫";
const date = (v: string) =>
  new Date(v).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
const qty = (v: any) => String(v).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
function Badge({ status }: { status: string }) {
  return (
    <span className={"sale-status " + status.toLowerCase()}>
      <i />
      {labels[status]}
    </span>
  );
}
export function SalesRoom({
  tenant,
  role,
  sites,
  api,
  initialOrderId,
  subjectId,
}: {
  tenant: string;
  role: string;
  sites: Row[];
  api: Api;
  initialOrderId?: string;
  subjectId: string;
}) {
  const path = "/v1/tenants/" + tenant;
  const [siteId, setSiteId] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [more, setMore] = useState<string | null>(null),
    [filter, setFilter] = useState(""),
    [query, setQuery] = useState("");
  const [order, setOrder] = useState<Row | null>(null),
    [editor, setEditor] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [shift, setShift] = useState<Row | null>(null),
    [shiftForm, setShiftForm] = useState(""),
    [opening, setOpening] = useState("0"),
    [counted, setCounted] = useState(""),
    [shiftNote, setShiftNote] = useState("");
  const [search, setSearch] = useState(""),
    [products, setProducts] = useState<Row[]>([]),
    [cart, setCart] = useState<Row[]>([]),
    [discount, setDiscount] = useState("0"),
    [discountType, setDiscountType] = useState("AMOUNT"),
    [note, setNote] = useState(""),
    [quote, setQuote] = useState<Row | null>(null);
  const [tendered, setTendered] = useState(""),
    [received, setReceived] = useState(false),
    [reason, setReason] = useState(""),
    [cancelForm, setCancelForm] = useState(false);
  const keyRef = useRef(new Map<string, string>()),
    busyRef = useRef(false),
    scope = useRef(0),
    loadedInitial = useRef("");
  const writable = ["OWNER", "MANAGER", "CASHIER"].includes(role),
    site = sites.find((s) => s.id === siteId),
    active = site?.status === "ACTIVE",
    ownShift = shift && (role !== "CASHIER" || shift.cashier_id === subjectId);
  const key = (resource: string, data: unknown) => {
    const signature = resource + JSON.stringify(data);
    if (!keyRef.current.has(signature))
      keyRef.current.set(signature, crypto.randomUUID());
    return keyRef.current.get(signature)!;
  };
  const command = async (resource: string, data: unknown, method = "POST") => {
    const result = await api(
      path + "/" + resource,
      method,
      data,
      key(resource, data),
    );
    keyRef.current.delete(resource + JSON.stringify(data));
    return result;
  };
  async function run(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const list = async (cursor?: string) => {
    const res = await api(
      path +
        `/orders?siteId=${siteId}&q=${encodeURIComponent(query)}${filter ? "&status=" + filter : ""}${cursor ? "&cursor=" + cursor : ""}`,
    );
    return res;
  };
  async function refresh() {
    const [res, s] = await Promise.all([
      list(),
      api(path + "/shifts?siteId=" + siteId),
    ]);
    setRows(res.items);
    setMore(res.nextCursor);
    const latest = s.items.find((x: Row) => x.status === "OPEN") ?? null;
    setShift(latest);
    setLoaded(true);
    return latest;
  }
  useEffect(() => {
    if (!sites.some((s) => s.id === siteId))
      setSiteId(
        sites.find((s) => s.status === "ACTIVE")?.id ?? sites[0]?.id ?? "",
      );
  }, [sites, siteId]);
  useEffect(() => {
    scope.current++;
    setRows([]);
    setOrder(null);
    setEditor(false);
    setShift(null);
    setShiftForm("");
    setLoaded(false);
    setError("");
    setNotice("");
  }, [siteId]);
  useEffect(() => {
    if (!siteId) return;
    let alive = true;
    const timer = setTimeout(() => {
      void Promise.all([list(), api(path + "/shifts?siteId=" + siteId)])
        .then(([res, s]) => {
          if (alive) {
            setRows(res.items);
            setMore(res.nextCursor);
            setShift(s.items.find((x: Row) => x.status === "OPEN") ?? null);
            setLoaded(true);
          }
        })
        .catch((e) => {
          if (alive) {
            setRows([]);
            setError(e.message);
          }
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [siteId, query, filter]);
  useEffect(() => {
    if (!initialOrderId || loadedInitial.current === initialOrderId) return;
    loadedInitial.current = initialOrderId;
    void api(path + "/orders/" + initialOrderId)
      .then((d) => {
        setSiteId(d.site_id);
        setTimeout(() => setOrder(d), 0);
      })
      .catch((e) => setError(e.message));
  }, [initialOrderId]);
  useEffect(() => {
    if (
      !order ||
      editor ||
      ["DRAFT", "COMPLETED", "CANCELLED"].includes(order.status)
    )
      return;
    let alive = true,
      inFlight = false;
    const timer = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const d = await api(path + "/orders/" + order.id);
        if (alive) {
          setOrder(d);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [order?.id, order?.status, editor]);
  useEffect(() => {
    if (!editor) return;
    let alive = true;
    const timer = setTimeout(
      () =>
        void api(
          path + "/skus?status=ACTIVE&limit=30&q=" + encodeURIComponent(search),
        )
          .then((r) => {
            if (alive) setProducts(r.items);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [editor, search]);
  useEffect(() => {
    setQuote(null);
  }, [cart, discount, discountType]);
  useEffect(() => {
    if (order && ["COMPLETED", "CANCELLED"].includes(order.status))
      setNotice("");
  }, [order?.status]);
  async function open(id: string) {
    await run(async () => {
      const d = await api(path + "/orders/" + id);
      setOrder(d);
      setEditor(false);
      setTendered(d.payable_vnd);
      setReceived(false);
      setCancelForm(false);
      setReason("");
      setNotice("");
    });
  }
  async function edit(d?: Row) {
    await run(async () => {
      if (d) {
        const skus = await Promise.all(
          d.lines.map((l: Row) => api(path + "/skus/" + l.skuId)),
        );
        setCart(
          d.lines.map((l: Row, i: number) => ({
            ...l,
            units: skus[i].units.filter((u: Row) => u.status === "ACTIVE"),
          })),
        );
        setDiscount(d.discount_vnd);
        setDiscountType("AMOUNT");
        setNote(d.note);
      } else {
        setOrder(null);
        setCart([]);
        setDiscount("0");
        setNote("");
      }
      setQuote(null);
      setSearch("");
      setEditor(true);
      setNotice("");
    });
  }
  function add(s: Row) {
    const units = s.units.filter((u: Row) => u.status === "ACTIVE");
    if (!units.length) return;
    setCart((ls) => [
      ...ls,
      {
        id: crypto.randomUUID(),
        skuId: s.id,
        unitId: units[0].id,
        name: s.name,
        code: s.code,
        quantity: "1",
        units,
      },
    ]);
  }
  async function save() {
    await run(async () => {
      if (!quote) throw new Error("Cập nhật báo giá trước khi lưu.");
      const d = await command(
        order ? "orders/" + order.id : "orders",
        {
          quoteId: quote.id,
          note,
          ...(order ? { version: order.version } : {}),
        },
        order ? "PATCH" : "POST",
      );
      setOrder(d);
      setEditor(false);
      setTendered(d.payable_vnd);
      setNotice("Đã lưu đơn nháp.");
      await refresh();
    });
  }
  if (role === "STOCK")
    return <p className="alert">Vai trò hiện tại không được xem đơn bán.</p>;
  return (
    <section className="sales-room">
      <div className="sales-toolbar">
        <label>
          Địa điểm
          <select
            aria-label="Địa điểm bán hàng"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
            }}
            disabled={busy}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="shift-summary">
          <span className={"shift-dot " + (shift ? "open" : "")} />
          <div>
            <strong>{shift ? "Ca đang mở" : "Chưa mở ca"}</strong>
            <small>
              {shift
                ? `Từ ${date(shift.opened_at)}`
                : "Mở ca trước khi thu tiền mặt"}
            </small>
          </div>
          {writable && (
            <button
              className="button secondary small"
              disabled={
                busy || (!shift && !active) || Boolean(shift && !ownShift)
              }
              onClick={() =>
                void run(async () => {
                  const latest = await refresh();
                  if (
                    latest &&
                    role === "CASHIER" &&
                    latest.cashier_id !== subjectId
                  )
                    throw new Error("Ca hiện tại do người khác mở.");
                  setShiftForm(latest ? "close" : "open");
                  setCounted("");
                  setShiftNote("");
                })
              }
            >
              {shift ? "Đóng ca" : "Mở ca"}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="Đóng lỗi đơn bán">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {shiftForm && (
        <form
          className="sale-shift-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (shiftForm === "open")
                await command("shifts", { siteId, openingCash: opening });
              else
                await command("shifts/" + shift!.id + "/close", {
                  siteId,
                  version: shift!.version,
                  countedCash: counted,
                  note: shiftNote,
                });
              setShiftForm("");
              await refresh();
              setNotice(
                shiftForm === "open"
                  ? "Đã mở ca thu ngân."
                  : "Đã đóng ca và ghi nhận tiền thực đếm.",
              );
            });
          }}
        >
          <h3>
            {shiftForm === "open" ? "Mở ca thu ngân" : "Đóng ca thu ngân"}
          </h3>
          {shiftForm === "open" ? (
            <label>
              Tiền đầu ca (₫)
              <input
                aria-label="Tiền đầu ca"
                type="number"
                min="0"
                step="1"
                required
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
              />
            </label>
          ) : (
            <>
              <p>
                Tiền dự kiến: <strong>{money(shift?.expected_now)}</strong>
              </p>
              <label>
                Tiền thực đếm (₫)
                <input
                  aria-label="Tiền thực đếm"
                  type="number"
                  min="0"
                  step="1"
                  required
                  value={counted}
                  onChange={(e) => setCounted(e.target.value)}
                />
              </label>
              <label>
                Ghi chú chênh lệch
                <input
                  maxLength={500}
                  value={shiftNote}
                  onChange={(e) => setShiftNote(e.target.value)}
                />
              </label>
            </>
          )}
          <div>
            <button className="button primary" disabled={busy}>
              Xác nhận {shiftForm === "open" ? "mở" : "đóng"} ca
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setShiftForm("")}
            >
              Quay lại
            </button>
          </div>
        </form>
      )}
      {!editor && !order && (
        <>
          <div className="sales-list-heading">
            <div>
              <h2>Đơn bán hàng</h2>
              <p>Tra cứu và tiếp tục xử lý đơn tại địa điểm đang chọn.</p>
            </div>
            {writable && (
              <button
                className="button primary"
                disabled={busy || !active}
                onClick={() => void edit()}
              >
                ＋ Tạo đơn bán
              </button>
            )}
          </div>
          <div className="sale-list-panel">
            <div className="sales-filters">
              <input
                aria-label="Tìm mã đơn bán"
                type="search"
                placeholder="Tìm mã đơn bán…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="Trạng thái đơn bán"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">Tất cả trạng thái</option>
                {Object.entries(labels).map(([v, l]) => (
                  <option value={v} key={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Đơn bán</th>
                    <th>Thời gian</th>
                    <th>Khách hàng</th>
                    <th>Thanh toán</th>
                    <th>Trạng thái</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.code}</strong>
                        <small>{d.lines.length} dòng hàng</small>
                      </td>
                      <td>{date(d.created_at)}</td>
                      <td>Khách lẻ</td>
                      <td className="sale-money">{money(d.payable_vnd)}</td>
                      <td>
                        <Badge status={d.status} />
                      </td>
                      <td>
                        <button
                          className="button secondary small"
                          onClick={() => void open(d.id)}
                        >
                          Xem đơn
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="sale-empty">
                <span>▤</span>
                <h3>{loaded ? "Chưa có đơn phù hợp" : "Đang tải đơn bán…"}</h3>
                <p>
                  {loaded
                    ? "Tạo đơn bán hoặc thay đổi bộ lọc để tìm đơn."
                    : "Vui lòng đợi trong giây lát."}
                </p>
              </div>
            )}
            {more && (
              <button
                className="button secondary sale-more"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await list(more);
                    setRows((old) => [...old, ...r.items]);
                    setMore(r.nextCursor);
                  })
                }
              >
                Xem thêm
              </button>
            )}
          </div>
        </>
      )}
      {(editor || order) && (
        <>
          <div className="sale-detail-heading">
            <button
              className="button secondary small"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setEditor(false);
                  setOrder(null);
                  await refresh();
                })
              }
            >
              ← Danh sách đơn
            </button>
            <span>
              {editor
                ? order
                  ? "Sửa " + order.code
                  : "Đơn bán mới"
                : order?.code}
            </span>
            {order && !editor && <Badge status={order.status} />}
          </div>
          <div className="sale-workspace">
            <div className="sale-main-panel">
              {editor ? (
                <>
                  <div className="sale-section-heading">
                    <h2>Hàng bán</h2>
                    <span>{cart.length} dòng hàng</span>
                  </div>
                  <div className="sale-product-search">
                    <input
                      aria-label="Tìm hàng bán"
                      type="search"
                      placeholder="Tìm tên, mã hàng hoặc mã vạch…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <div className="sale-product-results">
                      {products.slice(0, 8).map((s) => (
                        <button key={s.id} onClick={() => add(s)}>
                          <span className="sale-product-symbol">▦</span>
                          <span>
                            <strong>{s.name}</strong>
                            <small>{s.code}</small>
                          </span>
                          <b>＋</b>
                        </button>
                      ))}
                      {!products.length && (
                        <p>Không có hàng phù hợp. Thử tên hoặc mã khác.</p>
                      )}
                    </div>
                  </div>
                  <div className="sale-cart">
                    {cart.length ? (
                      cart.map((l, i) => (
                        <div className="sale-cart-line" key={l.id}>
                          <span className="sale-line-number">{i + 1}</span>
                          <div className="sale-line-name">
                            <strong>{l.name}</strong>
                            <small>{l.code}</small>
                          </div>
                          <label>
                            Đơn vị
                            <select
                              aria-label={"Đơn vị " + (i + 1)}
                              value={l.unitId}
                              onChange={(e) =>
                                setCart((ls) =>
                                  ls.map((x) =>
                                    x.id === l.id
                                      ? { ...x, unitId: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            >
                              {l.units.map((u: Row) => (
                                <option key={u.id} value={u.id}>
                                  {u.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Số lượng
                            <input
                              aria-label={"Số lượng " + (i + 1)}
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={l.quantity}
                              onChange={(e) =>
                                setCart((ls) =>
                                  ls.map((x) =>
                                    x.id === l.id
                                      ? { ...x, quantity: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                          </label>
                          <button
                            className="sale-remove"
                            aria-label={"Xóa dòng " + (i + 1)}
                            onClick={() =>
                              setCart((ls) => ls.filter((x) => x.id !== l.id))
                            }
                          >
                            ×
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="sale-empty">
                        <span>＋</span>
                        <h3>Thêm hàng vào đơn</h3>
                        <p>Chọn hàng ở trên để nhập số lượng và đơn vị bán.</p>
                      </div>
                    )}
                  </div>
                  <label className="sale-note">
                    Ghi chú đơn
                    <textarea
                      maxLength={500}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Ghi chú giao hàng hoặc yêu cầu của khách…"
                    />
                  </label>
                </>
              ) : (
                <>
                  <div className="sale-section-heading">
                    <h2>Chi tiết hàng bán</h2>
                    <span>Khách lẻ</span>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Mặt hàng</th>
                          <th>Số lượng</th>
                          <th>Đơn giá</th>
                          <th>Thành tiền</th>
                          {order?.lines.some((l: Row) => l.costVnd != null) && (
                            <th>Giá vốn</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {order?.lines.map((l: Row) => (
                          <tr key={l.id}>
                            <td>
                              <strong>{l.name}</strong>
                              <small>
                                {l.code} · {l.unitName}
                              </small>
                            </td>
                            <td>{qty(l.quantity)}</td>
                            <td>{money(l.priceVnd)}</td>
                            <td className="sale-money">
                              {money(l.netVnd)}
                              {l.discountVnd !== "0" && (
                                <small>Giảm {money(l.discountVnd)}</small>
                              )}
                            </td>
                            {l.costVnd != null && <td>{money(l.costVnd)}</td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="sale-order-meta">
                    <div>
                      <small>TẠO LÚC</small>
                      <strong>{date(order!.created_at)}</strong>
                    </div>
                    <div>
                      <small>ĐỊA ĐIỂM</small>
                      <strong>{site?.name}</strong>
                    </div>
                    {order?.completed_at && (
                      <div>
                        <small>HOÀN TẤT LÚC</small>
                        <strong>{date(order.completed_at)}</strong>
                      </div>
                    )}
                  </div>
                  {order?.note && (
                    <p className="sale-saved-note">{order.note}</p>
                  )}
                  {order?.cancel_reason && (
                    <p className="sale-saved-note">
                      Lý do hủy: {order.cancel_reason}
                    </p>
                  )}
                </>
              )}
            </div>
            <section className="sale-summary">
              <h2>Thanh toán</h2>
              <span className="sale-customer">Khách lẻ · Tiền mặt</span>
              <dl>
                <div>
                  <dt>Tiền hàng</dt>
                  <dd>{money((editor ? quote : order)?.subtotal_vnd)}</dd>
                </div>
                <div>
                  <dt>Giảm giá</dt>
                  <dd>− {money((editor ? quote : order)?.discount_vnd)}</dd>
                </div>
                <div className="sale-total">
                  <dt>Khách cần trả</dt>
                  <dd>
                    {editor && !quote
                      ? "—"
                      : money((editor ? quote : order)?.payable_vnd)}
                  </dd>
                </div>
              </dl>
              {editor ? (
                <>
                  <div className="sale-discount">
                    <label>
                      Giảm giá
                      <input
                        aria-label="Giảm giá đơn"
                        type="number"
                        min="0"
                        step="1"
                        value={discount}
                        onChange={(e) => setDiscount(e.target.value)}
                      />
                    </label>
                    <label>
                      Hình thức
                      <select
                        aria-label="Hình thức giảm giá"
                        value={discountType}
                        onChange={(e) => setDiscountType(e.target.value)}
                      >
                        <option value="AMOUNT">Số tiền (₫)</option>
                        <option value="PERCENT">Phần trăm (%)</option>
                      </select>
                    </label>
                  </div>
                  {role === "CASHIER" && (
                    <p className="sale-hint">
                      Thu ngân được giảm tối đa 5% giá trị đơn.
                    </p>
                  )}
                  <button
                    className="button secondary"
                    disabled={busy || !cart.length}
                    onClick={() =>
                      void run(async () => {
                        const q = await command("sales/quotes", {
                          siteId,
                          lines: cart.map((l) => ({
                            skuId: l.skuId,
                            unitId: l.unitId,
                            quantity: l.quantity,
                          })),
                          discount: { type: discountType, value: discount },
                        });
                        setQuote(q);
                      })
                    }
                  >
                    Cập nhật báo giá
                  </button>
                  {quote && (
                    <p className="sale-hint">
                      Giá được xác nhận đến{" "}
                      {new Date(quote.expires_at).toLocaleTimeString("vi-VN")}.
                      Kiểm tra tổng tiền trước khi lưu.
                    </p>
                  )}
                  <button
                    className="button primary"
                    disabled={busy || !quote}
                    onClick={() => void save()}
                  >
                    Lưu đơn nháp
                  </button>
                </>
              ) : (
                <>
                  {order?.status === "DRAFT" && writable && (
                    <>
                      <label>
                        Tiền khách đưa (₫)
                        <input
                          aria-label="Tiền khách đưa"
                          type="number"
                          min="0"
                          step="1"
                          value={tendered}
                          onChange={(e) => setTendered(e.target.value)}
                        />
                      </label>
                      <button
                        className="button primary"
                        disabled={busy || !active || !ownShift}
                        onClick={() =>
                          void run(async () => {
                            await command("orders/" + order!.id + "/checkout", {
                              version: order!.version,
                              shiftId: shift!.id,
                              tenderedVnd: tendered,
                            });
                            setOrder(await api(path + "/orders/" + order!.id));
                            setReceived(false);
                            setNotice("");
                          })
                        }
                      >
                        Tiến hành thanh toán
                      </button>
                      {!shift && (
                        <p className="sale-hint">Mở ca thu ngân để tiếp tục.</p>
                      )}
                      <button
                        className="button secondary"
                        disabled={busy || !active}
                        onClick={() => void edit(order!)}
                      >
                        Sửa đơn / cập nhật giá
                      </button>
                    </>
                  )}
                  {order?.checkout?.payment?.status === "PENDING" &&
                    !order?.checkout?.cancelRequested &&
                    writable && (
                      <div className="sale-cash-confirm">
                        <h3>Nhận tiền mặt</h3>
                        <p>
                          Khách đưa{" "}
                          <b>{money(order.checkout.payment.tendered_vnd)}</b>
                        </p>
                        <p>
                          Tiền trả lại{" "}
                          <b>
                            {money(
                              (
                                BigInt(order.checkout.payment.tendered_vnd) -
                                BigInt(order.payable_vnd)
                              ).toString(),
                            )}
                          </b>
                        </p>
                        <label className="sale-check">
                          <input
                            type="checkbox"
                            checked={received}
                            onChange={(e) => setReceived(e.target.checked)}
                          />
                          Đã nhận đủ tiền và trả lại tiền thừa
                        </label>
                        <button
                          className="button primary"
                          disabled={busy || !received || !active}
                          onClick={() =>
                            void run(async () => {
                              await command(
                                "payments/" +
                                  order.checkout.payment.id +
                                  "/confirm",
                                {
                                  siteId,
                                  version: order.checkout.payment.version,
                                  cashReceived: true,
                                },
                              );
                              setReceived(false);
                              setNotice(
                                "Đã ghi nhận thu tiền. Đang hoàn tất xuất kho.",
                              );
                              setOrder(await api(path + "/orders/" + order.id));
                            })
                          }
                        >
                          Xác nhận đã thu tiền
                        </button>
                      </div>
                    )}
                  {["PENDING", "COMMITTING", "REVIEW"].includes(
                    order!.status,
                  ) && (
                    <div className="sale-progress" role="status">
                      <strong>
                        {order?.checkout?.cancelRequested
                          ? "Đang xử lý yêu cầu hủy"
                          : labels[order!.status]}
                      </strong>
                      <p>
                        {order?.status === "REVIEW"
                          ? "Đang đối chiếu với kho và thu ngân. Giữ nguyên đơn để hệ thống tiếp tục xử lý."
                          : order?.checkout?.payment?.status === "PENDING"
                            ? "Hàng đã được giữ. Chỉ xác nhận sau khi thực nhận tiền."
                            : "Hệ thống đang xử lý đơn. Không cần tạo đơn mới."}
                      </p>
                      {order?.checkout?.lastError && (
                        <small>{order.checkout.lastError}</small>
                      )}
                    </div>
                  )}
                  {order?.status === "COMPLETED" && (
                    <div className="sale-complete">
                      <span>✓</span>
                      <strong>Đã thu tiền và xuất kho</strong>
                      <p>Đơn được lưu để tra cứu và đối chiếu.</p>
                    </div>
                  )}
                  {writable &&
                    ["DRAFT", "PENDING", "REVIEW"].includes(order!.status) &&
                    !order?.checkout?.cancelRequested && (
                      <button
                        className="sale-cancel-link"
                        disabled={busy}
                        onClick={() => setCancelForm(!cancelForm)}
                      >
                        Hủy đơn bán
                      </button>
                    )}
                  {cancelForm && (
                    <form
                      className="sale-cancel-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run(async () => {
                          await command("orders/" + order!.id + "/cancel", {
                            version: order!.version,
                            reason,
                          });
                          setCancelForm(false);
                          setOrder(await api(path + "/orders/" + order!.id));
                        });
                      }}
                    >
                      <label>
                        Lý do hủy
                        <textarea
                          required
                          minLength={3}
                          maxLength={500}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        />
                      </label>
                      <p>
                        Nếu tiền đã được xác nhận, đơn sẽ tiếp tục hoàn tất.
                      </p>
                      <button className="button secondary" disabled={busy}>
                        Xác nhận hủy
                      </button>
                    </form>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
