import {t,locale,localizedLabels} from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import "./commerce.css";
import "./sales.css";
import { AfterSales, ReceiptView, ReturnQueue } from "./after-sales";
import { ShiftDesk } from "./drawer";
type Row = Record<string, any>;
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
const labels: Record<string, string> = localizedLabels({
  DRAFT: "Đơn nháp",
  PENDING: "Chờ thu tiền",
  COMMITTING: "Đang xuất kho",
  REVIEW: "Đang đối chiếu",
  COMPLETED: "Hoàn tất",
  CANCELLED: "Đã hủy",
});
const money = (v: any) =>
  new Intl.NumberFormat(locale()).format(BigInt(v ?? "0")) + " ₫";
const date = (v: string) =>
  new Date(v).toLocaleString(locale(), {
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
  initialSiteId,initialPane,initialSourceId,
  subjectId,
}: {
  tenant: string;
  role: string;
  sites: Row[];
  api: Api;
  initialOrderId?: string;
  initialSiteId?:string;initialPane?:string;initialSourceId?:string;
  subjectId: string;
}) {
  const path = "/v1/tenants/" + tenant;
  const [pane, setPane] = useState(initialPane??"orders");
  const [fromDate, setFromDate] = useState(""),
    [toDate, setToDate] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  const [siteId, setSiteId] = useState(initialSiteId??""),
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
        `/orders?siteId=${siteId}&q=${encodeURIComponent(query)}${filter ? "&status=" + filter : ""}${cursor ? "&cursor=" + cursor : ""}${fromDate ? "&from=" + encodeURIComponent(fromDate + "T00:00:00+07:00") : ""}${toDate ? "&to=" + encodeURIComponent(new Date(new Date(toDate + "T00:00:00+07:00").getTime() + 86400000).toISOString()) : ""}`,
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
    const latest = s.items.find((x: Row) => x.status === "OPEN") ?? s.activeShift ?? null;
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
            setShift(s.items.find((x: Row) => x.status === "OPEN") ?? s.activeShift ?? null);
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
  }, [siteId, query, filter, fromDate, toDate]);
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
        setDiscountType("AMOUNT");
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
    setCart((ls) => {
      const existing = ls.find(
        (l) => l.skuId === s.id && l.unitId === units[0].id,
      );
      if (existing && /^(0|[1-9]\d*)(\.\d{1,3})?$/.test(existing.quantity)) {
        const [whole, fraction = ""] = existing.quantity.split(".");
        const amount =
          BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")) + 1000n;
        return ls.map((l) =>
          l.id === existing.id
            ? {
                ...l,
                quantity: `${amount / 1000n}.${String(amount % 1000n).padStart(3, "0")}`,
              }
            : l,
        );
      }
      return [
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
      ];
    });
  }
  async function save() {
    await run(async () => {
      if (!quote) throw new Error(t("Cập nhật báo giá trước khi lưu."));
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
      setNotice(t("Đã lưu đơn nháp."));
      await refresh();
    });
  }
  if (role === "STOCK")
    return <p className="alert">{t("Vai trò hiện tại không được xem đơn bán.")}</p>;
  return (
    <section className="sales-room">
      <nav className="pos-tabs" aria-label={t("Nghiệp vụ bán hàng")}>
        {[
          ["orders", t("Bán hàng")],
          ["returns", t("Trả hàng")],
          ["shifts", t("Ca thu ngân")],
        ].map(([k, v]) => (
          <button
            key={k}
            role="tab"
            aria-selected={pane === k}
            disabled={busy}
            onClick={() => setPane(k)}
          >
            {v}
          </button>
        ))}
      </nav>
      <div className="sales-toolbar">
        <label>{t("Địa điểm")}<select
            aria-label={t("Địa điểm bán hàng")}
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
            <strong>{shift ? t("Ca đang mở") : t("Chưa mở ca")}</strong>
            <small>
              {shift
                ? t("Từ {0}", [date(shift.opened_at)])
                : t("Mở ca trước khi thu tiền mặt")}
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
                  setPane("orders");
                  const latest = await refresh();
                  if (
                    latest &&
                    role === "CASHIER" &&
                    latest.cashier_id !== subjectId
                  )
                    throw new Error(t("Ca hiện tại do người khác mở."));
                  setShiftForm(latest ? "close" : "open");
                  setCounted("");
                  setShiftNote("");
                })
              }
            >
              {shift ? t("Đóng ca") : t("Mở ca")}
            </button>
          )}
        </div>
      </div>
      {pane === "shifts" && (
        <ShiftDesk
          initialShiftId={siteId===initialSiteId?initialSourceId:undefined}
          key={siteId}
          api={api}
          path={path}
          siteId={siteId}
          role={role}
          subjectId={subjectId}
          onChange={refresh}
        />
      )}
      {pane === "returns" && (
        <ReturnQueue
          initialReturnId={siteId===initialSiteId?initialSourceId:undefined}
          key={siteId}
          api={api}
          path={path}
          siteId={siteId}
          role={role}
          shift={ownShift ? shift : null}
          openOrder={(id) => {
            setPane("orders");
            void open(id);
          }}
        />
      )}
      <div className="pos-sale-content" hidden={pane !== "orders"}>
        {error && (
          <div className="alert error" role="alert">
            {t(error)}
            <button onClick={() => setError("")} aria-label={t("Đóng lỗi đơn bán")}>
              ×
            </button>
          </div>
        )}
        {notice && (
          <div className="alert success" role="status">
            {t(notice)}
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
                    ? t("Đã mở ca thu ngân.")
                    : t("Đã đóng ca và ghi nhận tiền thực đếm."),
                );
              });
            }}
          >
            <h3>
              {shiftForm === "open" ? t("Mở ca thu ngân") : t("Đóng ca thu ngân")}
            </h3>
            {shiftForm === "open" ? (
              <label>{t("Tiền đầu ca (₫)")}<input
                  aria-label={t("Tiền đầu ca")}
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
                <p>{t("Tiền dự kiến:")+" "}<strong>{money(shift?.expected_now)}</strong>
                </p>
                <label>{t("Tiền thực đếm (₫)")}<input
                    aria-label={t("Tiền thực đếm")}
                    type="number"
                    min="0"
                    step="1"
                    required
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                  />
                </label>
                <label>{t("Ghi chú chênh lệch")}<input
                    maxLength={500}
                    value={shiftNote}
                    onChange={(e) => setShiftNote(e.target.value)}
                  />
                </label>
              </>
            )}
            <div>
              <button className="button primary" disabled={busy}>{t("Xác nhận")+" "}{shiftForm === "open" ? t("mở") : t("đóng")}{" "+t("ca")}</button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setShiftForm("")}
              >{t("Quay lại")}</button>
            </div>
          </form>
        )}
        {!editor && !order && (
          <>
            <div className="sales-list-heading">
              <div>
                <h2>{t("Đơn bán hàng")}</h2>
                <p>{t("Tra cứu và tiếp tục xử lý đơn tại địa điểm đang chọn.")}</p>
              </div>
              {writable && (
                <button
                  className="button primary"
                  disabled={busy || !active}
                  onClick={() => void edit()}
                >{t("＋ Tạo đơn bán")}</button>
              )}
            </div>
            <div className="sale-list-panel">
              <div className="sales-filters">
                <label>{t("Từ ngày")}<input
                    aria-label={t("Đơn từ ngày")}
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                </label>
                <label>{t("Đến ngày")}<input
                    aria-label={t("Đơn đến ngày")}
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </label>
                <input
                  aria-label={t("Tìm mã đơn bán")}
                  type="search"
                  placeholder={t("Tìm mã đơn bán…")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  aria-label={t("Trạng thái đơn bán")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="">{t("Tất cả trạng thái")}</option>
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
                      <th>{t("Đơn bán")}</th>
                      <th>{t("Thời gian")}</th>
                      <th>{t("Khách hàng")}</th>
                      <th>{t("Thanh toán")}</th>
                      <th>{t("Trạng thái")}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <strong>{d.code}</strong>
                          <small>{d.lines.length}{" "+t("dòng hàng")}</small>
                        </td>
                        <td>{date(d.created_at)}</td>
                        <td>{t("Khách lẻ")}</td>
                        <td className="sale-money">{money(d.payable_vnd)}</td>
                        <td>
                          <Badge status={d.status} />
                        </td>
                        <td>
                          <button
                            className="button secondary small"
                            onClick={() => void open(d.id)}
                          >{t("Xem đơn")}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!rows.length && (
                <div className="sale-empty">
                  <span>▤</span>
                  <h3>
                    {loaded ? t("Chưa có đơn phù hợp") : t("Đang tải đơn bán…")}
                  </h3>
                  <p>
                    {loaded
                      ? t("Tạo đơn bán hoặc thay đổi bộ lọc để tìm đơn.")
                      : t("Vui lòng đợi trong giây lát.")}
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
                >{t("Xem thêm")}</button>
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
              >{t("← Danh sách đơn")}</button>
              <span>
                {editor
                  ? order
                    ? "Sửa " + order.code
                    : t("Đơn bán mới")
                  : order?.code}
              </span>
              {order && !editor && <Badge status={order.status} />}
            </div>
            <div className="sale-workspace">
              <div className="sale-main-panel">
                {editor ? (
                  <>
                    <div className="sale-section-heading">
                      <h2>{t("Hàng bán")}</h2>
                      <span>{cart.length}{" "+t("dòng hàng")}</span>
                    </div>
                    <div className="sale-product-search">
                      <input
                        aria-label={t("Tìm hàng bán")}
                        ref={searchRef}
                        type="search"
                        placeholder={t("Tìm tên, mã hàng hoặc mã vạch…")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const value = e.currentTarget.value.trim();
                            void run(async () => {
                              if (!value) return;
                              const result = await api(
                                path +
                                  "/skus?status=ACTIVE&limit=200&q=" +
                                  encodeURIComponent(value),
                              );
                              const exact = result.items.filter(
                                (s: Row) =>
                                  s.barcode === value ||
                                  s.code.toLowerCase() === value.toLowerCase(),
                              );
                              if (exact.length !== 1)
                                throw new Error(
                                  t("Không có mã khớp duy nhất. Chọn hàng trong danh sách."),
                                );
                              add(exact[0]);
                              setSearch("");
                              searchRef.current?.focus();
                            });
                          }
                        }}
                      />
                      <small className="pos-muted">{t("F2 để tìm hàng · Quét mã rồi Enter để thêm")}</small>
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
                          <p>{t("Không có hàng phù hợp. Thử tên hoặc mã khác.")}</p>
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
                            <label>{t("Đơn vị")}<select
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
                            <label>{t("Số lượng")}<input
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
                          <h3>{t("Thêm hàng vào đơn")}</h3>
                          <p>{t("Chọn hàng ở trên để nhập số lượng và đơn vị bán.")}</p>
                        </div>
                      )}
                    </div>
                    <label className="sale-note">{t("Ghi chú đơn")}<textarea
                        maxLength={500}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={t("Ghi chú giao hàng hoặc yêu cầu của khách…")}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <div className="sale-section-heading">
                      <h2>{t("Chi tiết hàng bán")}</h2>
                      <span>{t("Khách lẻ")}</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>{t("Mặt hàng")}</th>
                            <th>{t("Số lượng")}</th>
                            <th>{t("Đơn giá")}</th>
                            <th>{t("Thành tiền")}</th>
                            {order?.lines.some(
                              (l: Row) => l.costVnd != null,
                            ) && <th>{t("Giá vốn")}</th>}
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
                                  <small>{t("Giảm")+" "}{money(l.discountVnd)}</small>
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
                        <small>{t("TẠO LÚC")}</small>
                        <strong>{date(order!.created_at)}</strong>
                      </div>
                      <div>
                        <small>{t("ĐỊA ĐIỂM")}</small>
                        <strong>{site?.name}</strong>
                      </div>
                      {order?.completed_at && (
                        <div>
                          <small>{t("HOÀN TẤT LÚC")}</small>
                          <strong>{date(order.completed_at)}</strong>
                        </div>
                      )}
                    </div>
                    {order?.note && (
                      <p className="sale-saved-note">{order.note}</p>
                    )}
                    {order?.cancel_reason && (
                      <p className="sale-saved-note">{t("Lý do hủy:")+" "}{order.cancel_reason}
                      </p>
                    )}
                  </>
                )}
              </div>
              <section className="sale-summary">
                <h2>{t("Thanh toán")}</h2>
                <span className="sale-customer">{t("Khách lẻ · Tiền mặt")}</span>
                <dl>
                  <div>
                    <dt>{t("Tiền hàng")}</dt>
                    <dd>{money((editor ? quote : order)?.subtotal_vnd)}</dd>
                  </div>
                  <div>
                    <dt>{t("Giảm giá")}</dt>
                    <dd>− {money((editor ? quote : order)?.discount_vnd)}</dd>
                  </div>
                  <div className="sale-total">
                    <dt>{t("Khách cần trả")}</dt>
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
                      <label>{t("Giảm giá")}<input
                          aria-label={t("Giảm giá đơn")}
                          type="number"
                          min="0"
                          step="1"
                          value={discount}
                          onChange={(e) => setDiscount(e.target.value)}
                        />
                      </label>
                      <label>{t("Hình thức")}<select
                          aria-label={t("Hình thức giảm giá")}
                          value={discountType}
                          onChange={(e) => setDiscountType(e.target.value)}
                        >
                          <option value="AMOUNT">{t("Số tiền (₫)")}</option>
                          <option value="PERCENT">{t("Phần trăm (%)")}</option>
                        </select>
                      </label>
                    </div>
                    {role === "CASHIER" && (
                      <p className="sale-hint">{t("Thu ngân được giảm tối đa 5% giá trị đơn.")}</p>
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
                    >{t("Cập nhật báo giá")}</button>
                    {quote && (
                      <p className="sale-hint">{t("Giá được xác nhận đến")}{" "}
                        {new Date(quote.expires_at).toLocaleTimeString(locale())}{t(". Kiểm tra tổng tiền trước khi lưu.")}</p>
                    )}
                    <button
                      className="button primary"
                      disabled={busy || !quote}
                      onClick={() => void save()}
                    >{t("Lưu đơn nháp")}</button>
                  </>
                ) : (
                  <>
                    {order?.status === "DRAFT" && writable && (
                      <>
                        <label>{t("Tiền khách đưa (₫)")}<input
                            aria-label={t("Tiền khách đưa")}
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
                              await command(
                                "orders/" + order!.id + "/checkout",
                                {
                                  version: order!.version,
                                  shiftId: shift!.id,
                                  tenderedVnd: tendered,
                                },
                              );
                              setOrder(
                                await api(path + "/orders/" + order!.id),
                              );
                              setReceived(false);
                              setNotice("");
                            })
                          }
                        >{t("Tiến hành thanh toán")}</button>
                        {!shift && (
                          <p className="sale-hint">{t("Mở ca thu ngân để tiếp tục.")}</p>
                        )}
                        <button
                          className="button secondary"
                          disabled={busy || !active}
                          onClick={() => void edit(order!)}
                        >{t("Sửa đơn / cập nhật giá")}</button>
                      </>
                    )}
                    {order?.checkout?.payment?.status === "PENDING" &&
                      !order?.checkout?.cancelRequested &&
                      writable && (
                        <div className="sale-cash-confirm">
                          <h3>{t("Nhận tiền mặt")}</h3>
                          <p>{t("Khách đưa")}{" "}
                            <b>{money(order.checkout.payment.tendered_vnd)}</b>
                          </p>
                          <p>{t("Tiền trả lại")}{" "}
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
                            />{t("Đã nhận đủ tiền và trả lại tiền thừa")}</label>
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
                                  t("Đã ghi nhận thu tiền. Đang hoàn tất xuất kho."),
                                );
                                setOrder(
                                  await api(path + "/orders/" + order.id),
                                );
                              })
                            }
                          >{t("Xác nhận đã thu tiền")}</button>
                        </div>
                      )}
                    {["PENDING", "COMMITTING", "REVIEW"].includes(
                      order!.status,
                    ) && (
                      <div className="sale-progress" role="status">
                        <strong>
                          {order?.checkout?.cancelRequested
                            ? t("Đang xử lý yêu cầu hủy")
                            : labels[order!.status]}
                        </strong>
                        <p>
                          {order?.status === "REVIEW"
                            ? t("Đang đối chiếu với kho và thu ngân. Giữ nguyên đơn để hệ thống tiếp tục xử lý.")
                            : order?.checkout?.payment?.status === "PENDING"
                              ? t("Hàng đã được giữ. Chỉ xác nhận sau khi thực nhận tiền.")
                              : t("Hệ thống đang xử lý đơn. Không cần tạo đơn mới.")}
                        </p>
                        {order?.checkout?.lastError && (
                          <small>{t(order.checkout.lastError)}</small>
                        )}
                      </div>
                    )}
                    {order?.status === "COMPLETED" && (
                      <>
                        <div className="sale-complete">
                          <span>✓</span>
                          <strong>{t("Đã thu tiền và xuất kho")}</strong>
                          <p>{t("Đơn được lưu để tra cứu và đối chiếu.")}</p>
                        </div>
                        <ReceiptView api={api} path={path} orderId={order.id} />
                        <button
                          className="button primary"
                          disabled={busy || !writable}
                          onClick={() => void edit()}
                        >{t("Bán đơn tiếp theo")}</button>
                      </>
                    )}
                    {writable &&
                      ["DRAFT", "PENDING", "REVIEW"].includes(order!.status) &&
                      !order?.checkout?.cancelRequested && (
                        <button
                          className="sale-cancel-link"
                          disabled={busy}
                          onClick={() => setCancelForm(!cancelForm)}
                        >{t("Hủy đơn bán")}</button>
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
                        <label>{t("Lý do hủy")}<textarea
                            required
                            minLength={3}
                            maxLength={500}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                        <p>{t("Nếu tiền đã được xác nhận, đơn sẽ tiếp tục hoàn tất.")}</p>
                        <button className="button secondary" disabled={busy}>{t("Xác nhận hủy")}</button>
                      </form>
                    )}
                  </>
                )}
              </section>
            </div>
            {!editor && order?.status === "COMPLETED" && (
              <AfterSales
                key={order.id}
                api={api}
                path={path}
                order={order}
                role={role}
                shift={ownShift ? shift : null}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
