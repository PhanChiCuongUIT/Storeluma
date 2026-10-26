import React, { useEffect, useRef, useState, type FormEvent } from "react";
import "./commerce.css";
import "./stock.css";
import { milli, fromMilli } from "../../../packages/platform/decimal";
type Row = Record<string, any>;
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
const labels: Record<string, string> = {
  DRAFT: "Phiếu nháp",
  COUNTING: "Đang kiểm",
  SUBMITTED: "Chờ duyệt",
  POSTED: "Đã ghi sổ",
  CANCELLED: "Đã hủy",
  RECEIPT: "Nhập hàng",
  COUNT: "Kiểm kho",
  ADJUSTMENT: "Điều chỉnh",
  SALE: "Xuất bán",
  WRITE_OFF_GOOD: "Xuất hủy hàng tốt",
  WRITE_OFF_QUARANTINE: "Xuất hủy hàng cách ly",
  QUARANTINE: "Đưa vào cách ly",
  RELEASE_QUARANTINE: "Giải phóng cách ly",
  CORRECTION: "Điều chỉnh tăng / giảm",
};
const qty = (v: any) =>
  v == null ? "—" : String(v).replace(/(\.\d*?[1-9])0+$|\.0+$/, "$1");
const money = (v: any) =>
  v == null ? "—" : new Intl.NumberFormat("vi-VN").format(BigInt(v)) + " ₫";
function previewDelta(good: string, quarantine: string, before: string) {
  try {
    const d = milli(good) + milli(quarantine) - milli(before);
    return qty((d < 0n ? "-" : "") + fromMilli(d < 0n ? -d : d));
  } catch {
    return "—";
  }
}
const when = (v: any) =>
  v
    ? new Date(v).toLocaleString("vi-VN", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const badge = (s: string) => (
  <span className={"commerce-badge " + s.toLowerCase()}>
    <i />
    {labels[s] ?? s}
  </span>
);
const resource = (kind: string) =>
  kind === "COUNT"
    ? "stock-counts"
    : kind === "ADJUSTMENT"
      ? "stock-adjustments"
      : "receipts";
function QInput({ label, value, onChange, required = true }: any) {
  return (
    <label className="stock-number-label">
      {label}
      <input
        aria-label={label}
        type="number"
        min="0"
        max="999999999999999.999"
        step="0.001"
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

export function StockRoom({
  tenant,
  role,
  sites,
  api,
  subjectId,
  onOpenOrder,
}: {
  tenant: string;
  role: string;
  sites: Row[];
  api: Api;
  subjectId: string;
  onOpenOrder: (id:string)=>void;
}) {
  const [view, setView] = useState("balances"),
    [siteId, setSiteId] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null),
    [asOf, setAsOf] = useState("");
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("ALL"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sku, setSku] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [creating, setCreating] = useState(false),
    [revision, setRevision] = useState(0);
  const apiRef = useRef(api);
  apiRef.current = api;
  const generation = useRef(0),
    pending = useRef({ payload: "", key: "" }),
    busyRef = useRef(false);
  const site = sites.find((s) => s.id === siteId),
    costRead = ["OWNER", "ACCOUNTANT"].includes(role),
    write = ["OWNER", "MANAGER", "STOCK"].includes(role),
    approve = ["OWNER", "MANAGER"].includes(role),
    documents = role !== "CASHIER";
  const siteSignature = sites.map((s) => s.id + ":" + s.status).join(",");
  useEffect(() => {
    setSiteId((id) =>
      sites.some((s) => s.id === id)
        ? id
        : (sites.find((s) => s.status === "ACTIVE")?.id ?? sites[0]?.id ?? ""),
    );
  }, [siteSignature]);
  function url(cursor?: string) {
    const q = new URLSearchParams({ siteId, limit: "30", q: query });
    if (cursor) q.set("cursor", cursor);
    if (view === "balances" && filter !== "ALL") q.set("filter", filter);
    if (view === "movements") {
      if (filter !== "ALL") q.set("type", filter);
      if (sku) q.set("skuId", sku.sku_id);
      if (from) q.set("from", new Date(from + "T00:00:00+07:00").toISOString());
      if (to) q.set("to", new Date(to + "T23:59:59.999+07:00").toISOString());
    }
    if (["counts", "adjustments"].includes(view) && filter !== "ALL")
      q.set("status", filter);
    return `/v1/tenants/${tenant}/${{ balances: "stock-balances", movements: "stock-movements", counts: "stock-counts", adjustments: "stock-adjustments" }[view]}?${q}`;
  }
  useEffect(() => {
    const gen = ++generation.current;
    setRows([]);
    setNext(null);
    setAsOf("");
    setError("");
    if (!siteId) return;
    setLoading(true);
    void apiRef
      .current(url())
      .then((data) => {
        if (gen === generation.current) {
          setRows(data.items);
          setNext(data.nextCursor);
          setAsOf(data.dataAsOf);
        }
      })
      .catch((e) => {
        if (gen === generation.current) setError(e.message);
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [tenant, siteId, view, query, filter, from, to, sku?.sku_id, revision]);
  async function more() {
    const gen = generation.current;
    setLoading(true);
    try {
      const d = await api(url(next!));
      if (gen === generation.current) {
        setRows((r) => [...r, ...d.items]);
        setNext(d.nextCursor);
        setAsOf(d.dataAsOf);
      }
    } catch (e) {
      if (gen === generation.current) setError((e as Error).message);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }
  function navigate(v: string) {
    // A tab changes the row shape. Clear the previous table in the same render.
    setRows([]);
    setNext(null);
    setAsOf("");
    setView(v);
    setFilter("ALL");
    setSearch("");
    setQuery("");
    setSku(null);
    setDetail(null);
    setCreating(false);
    setError("");
    setNotice("");
  }
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
  async function command(path: string, body: unknown, method = "POST") {
    const payload = JSON.stringify([path, method, body]);
    if (payload !== pending.current.payload)
      pending.current = { payload, key: crypto.randomUUID() };
    const d = await api(
      `/v1/tenants/${tenant}/${path}`,
      method,
      body,
      pending.current.key,
    );
    pending.current = { payload: "", key: "" };
    return d;
  }
  async function open(kind: string, id: string) {
    if(kind==='SALE'){onOpenOrder(id);return;}
    await run(async () => {
      setDetail({
        ...(await api(`/v1/tenants/${tenant}/${resource(kind)}/${id}`)),
        kind,
      });
      setCreating(false);
      setNotice("");
    });
  }
  async function transition(action: string) {
    if (!detail) return;
    const warning =
      action === "approve" || action === "post"
        ? "Ghi sổ sẽ thay đổi tồn kho và không thể sửa phiếu. Bạn đã kiểm tra số lượng và lý do?"
        : action === "cancel"
          ? "Hủy phiếu này? Tồn kho sẽ không thay đổi."
          : action === "start"
            ? "Bắt đầu kiểm và tạm khóa các mã hàng trên phiếu tại địa điểm này?"
            : null;
    if (warning && !window.confirm(warning)) return;
    await run(async () => {
      setDetail(
        await command(`${resource(detail.kind)}/${detail.id}/${action}`, {
          version: detail.version,
        }),
      );
      setNotice(
        action === "start"
          ? "Đã khóa phạm vi kiểm. Bạn có thể nhập số đếm."
          : action === "submit"
            ? "Đã gửi phiếu để duyệt."
            : action === "cancel"
              ? "Đã hủy phiếu."
              : action === "reopen"
                ? "Đã chuyển lại trạng thái đang kiểm."
                : "Đã ghi sổ và cập nhật tồn kho.",
      );
      setRevision((n) => n + 1);
    });
  }
  const path = `/v1/tenants/${tenant}`;
  return (
    <div className="stock-room">
      <div className="stock-tabs" role="tablist" aria-label="Quản lý kho">
        {[
          ["balances", "Tồn kho"],
          ["movements", "Thẻ kho"],
          ...(documents
            ? [
                ["counts", "Kiểm kho"],
                ["adjustments", "Điều chỉnh"],
              ]
            : []),
        ].map(([id, title]) => (
          <button
            key={id}
            role="tab"
            aria-selected={view === id}
            className={view === id ? "selected" : ""}
            onClick={() => navigate(id)}
          >
            {title}
          </button>
        ))}
      </div>
      <div className="stock-location">
        <div>
          <span className="eyebrow">ĐỊA ĐIỂM KINH DOANH</span>
          <label className="stock-site-label">
            <select
              aria-label="Địa điểm kho"
              value={siteId}
              disabled={busy}
              onChange={(e) => {
                setSiteId(e.target.value);
                setDetail(null);
                setCreating(false);
                setSku(null);
              }}
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.status !== "ACTIVE" ? " · Tạm ngừng" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="stock-location-note">
          <span
            className={"stock-dot " + (site?.status === "ACTIVE" ? "" : "off")}
          />
          {site?.status === "ACTIVE" ? "Sẵn sàng thao tác" : "Chỉ tra cứu"}
          <small>
            {asOf
              ? "Dữ liệu lúc " + when(asOf)
              : "Chọn địa điểm để xem dữ liệu"}
          </small>
        </div>
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
          <button
            className="button secondary small"
            disabled={busy || loading}
            onClick={() =>
              detail
                ? void open(detail.kind, detail.id)
                : setRevision((n) => n + 1)
            }
          >
            Tải lại
          </button>
        </div>
      )}
      {notice && (
        <div className="alert success" role="status">
          {notice}
        </div>
      )}
      {!sites.length ? (
        <div className="stock-empty">
          <h3>Chưa có địa điểm trong phạm vi</h3>
          <p>Chọn hộ kinh doanh hoặc liên hệ chủ hộ để được cấp quyền.</p>
        </div>
      ) : creating ? (
        <StockDraft
          kind={view === "counts" ? "COUNT" : "ADJUSTMENT"}
          api={api}
          path={path}
          site={site!}
          busy={busy}
          cancel={() => setCreating(false)}
          submit={(body) =>
            run(async () => {
              setDetail(
                await command(
                  resource(view === "counts" ? "COUNT" : "ADJUSTMENT"),
                  body,
                ),
              );
              setCreating(false);
              setNotice("Đã lưu phiếu nháp. Tồn kho chưa thay đổi.");
              setRevision((n) => n + 1);
            })
          }
        />
      ) : detail ? (
        <StockDetail
          key={detail.id + ":" + detail.version}
          row={detail}
          busy={busy}
          costRead={costRead}
          canWrite={
            write && (role !== "STOCK" || detail.created_by === subjectId)
          }
          canApprove={approve}
          active={site?.status === "ACTIVE"}
          close={() => setDetail(null)}
          refresh={() => void open(detail.kind, detail.id)}
          transition={transition}
          save={(body: Row) =>
            run(async () => {
              setDetail(
                await command(
                  `${resource(detail.kind)}/${detail.id}/lines`,
                  { ...body, version: detail.version },
                  "PATCH",
                ),
              );
              setNotice("Đã lưu phiếu. Tồn kho chưa thay đổi.");
              setRevision((n) => n + 1);
            })
          }
        />
      ) : (
        <>
          <div className="stock-page-heading">
            <div>
              <h2>
                {
                  {
                    balances: "Số lượng trong kho",
                    movements: "Lịch sử biến động",
                    counts: "Phiếu kiểm kho",
                    adjustments: "Phiếu điều chỉnh",
                  }[view]
                }
              </h2>
              <p>
                {
                  {
                    balances:
                      "Theo dõi hàng hiện có, đang giữ và cách ly tại từng địa điểm.",
                    movements:
                      "Đối chiếu từng lần thay đổi với chứng từ đã ghi sổ.",
                    counts:
                      "Ghi nhận số thực đếm và duyệt chênh lệch trước khi cập nhật tồn.",
                    adjustments:
                      "Ghi nhận hàng hỏng, cách ly và các thay đổi đã được xác nhận.",
                  }[view]
                }
              </p>
            </div>
            {write && ["counts", "adjustments"].includes(view) && (
              <button
                className="button primary"
                disabled={site?.status !== "ACTIVE"}
                onClick={() => {
                  setCreating(true);
                  setError("");
                  setNotice("");
                }}
              >
                ＋ {view === "counts" ? "Tạo phiếu kiểm" : "Tạo điều chỉnh"}
              </button>
            )}
          </div>
          {view === "balances" && (
            <p className="stock-help">
              Khả dụng = Hiện có − Đang giữ − Cách ly. Hàng đang kiểm sẽ được mở
              khóa khi duyệt hoặc hủy phiếu kiểm.
            </p>
          )}
          <section className="data-panel stock-panel">
            <form
              className="stock-filters"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                setQuery(search.trim());
              }}
            >
              <input
                aria-label="Tìm trong kho"
                placeholder={
                  view === "counts" || view === "adjustments"
                    ? "Tìm mã phiếu, lý do…"
                    : "Tìm mã hàng, tên hàng…"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="button secondary" type="submit">
                Tìm
              </button>
              <select
                aria-label="Lọc kho"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="ALL">Tất cả</option>
                {(view === "balances"
                  ? [
                      ["AVAILABLE", "Còn khả dụng"],
                      ["EMPTY", "Hết khả dụng"],
                      ["QUARANTINED", "Có hàng cách ly"],
                      ["FROZEN", "Đang kiểm kho"],
                    ]
                  : view === "movements"
                    ? ["RECEIPT", "COUNT", "ADJUSTMENT", "SALE"].map((k) => [
                        k,
                        labels[k],
                      ])
                    : (view === "counts"
                        ? [
                            "DRAFT",
                            "COUNTING",
                            "SUBMITTED",
                            "POSTED",
                            "CANCELLED",
                          ]
                        : ["DRAFT", "POSTED", "CANCELLED"]
                      ).map((k) => [k, labels[k]])
                ).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {view === "movements" && (
                <>
                  <label>
                    Từ ngày
                    <input
                      aria-label="Từ ngày"
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    Đến ngày
                    <input
                      aria-label="Đến ngày"
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </>
              )}
              <button
                type="button"
                className="button secondary"
                disabled={loading}
                onClick={() => setRevision((n) => n + 1)}
              >
                Làm mới
              </button>
            </form>
            {sku && (
              <div className="stock-sku-scope">
                Thẻ kho:{" "}
                <strong>
                  {sku.code} · {sku.name}
                </strong>
                <button
                  className="button secondary small"
                  onClick={() => setSku(null)}
                >
                  Bỏ lọc mã hàng
                </button>
              </div>
            )}
            <div className="table-wrap">
              <table className="stock-table">
                <thead>
                  <tr>
                    {(view === "balances"
                      ? [
                          "Mã hàng / Tên hàng",
                          "Đơn vị",
                          "Hiện có",
                          "Đang giữ",
                          "Cách ly",
                          "Khả dụng",
                          ...(costRead ? ["Giá trị tồn"] : []),
                          "Trạng thái",
                          "",
                        ]
                      : view === "movements"
                        ? [
                            "Thời gian / Chứng từ",
                            "Mã hàng / Tên hàng",
                            "Loại",
                            "Trước → Sau",
                            "Thay đổi",
                            "Cách ly",
                            ...(costRead ? ["Giá trị thay đổi"] : []),
                            "",
                          ]
                        : [
                            "Mã phiếu",
                            "Trạng thái",
                            view === "counts" ? "Phạm vi" : "Loại điều chỉnh",
                            "Lý do",
                            "Ngày lập",
                            "",
                          ]
                    ).map((v, i) => (
                      <th key={i}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      {view === "balances" ? (
                        <>
                          <td>
                            <strong>{row.name ?? row.sku_id}</strong>
                            <small>{row.code}</small>
                          </td>
                          <td>{row.base_unit}</td>
                          <td className="numeric">{qty(row.on_hand)}</td>
                          <td className="numeric muted">{qty(row.reserved)}</td>
                          <td className="numeric">{qty(row.quarantined)}</td>
                          <td className="numeric stock-available">
                            {qty(row.available)}
                          </td>
                          {costRead && (
                            <td className="numeric">
                              {money(row.inventory_value)}
                            </td>
                          )}
                          <td>
                            {row.frozen_by ? (
                              badge("COUNTING")
                            ) : (
                              <span className="stock-muted">
                                {row.sku_status === "INACTIVE"
                                  ? "Ngừng kinh doanh"
                                  : "—"}
                              </span>
                            )}
                          </td>
                          <td>
                            <button
                              className="button secondary small"
                              onClick={() => {
                                navigate("movements");
                                setSku(row);
                              }}
                            >
                              Thẻ kho
                            </button>
                          </td>
                        </>
                      ) : view === "movements" ? (
                        <>
                          <td>
                            <strong>{row.document_code}</strong>
                            <small>{when(row.created_at)}</small>
                          </td>
                          <td>
                            <strong>{row.sku_name}</strong>
                            <small>
                              {row.sku_code} · {row.base_unit}
                            </small>
                          </td>
                          <td>{labels[row.document_type]}</td>
                          <td className="numeric">
                            {qty(row.on_hand_before)} → {qty(row.on_hand_after)}
                            {row.reconstructed && (
                              <small>Số dư lịch sử tái lập</small>
                            )}
                          </td>
                          <td
                            className={
                              "numeric " +
                              (Number(row.qty_base) < 0
                                ? "stock-negative"
                                : "stock-positive")
                            }
                          >
                            {Number(row.qty_base) > 0 ? "+" : ""}
                            {qty(row.qty_base)}
                          </td>
                          <td className="numeric">
                            {qty(row.quarantined_before)} →{" "}
                            {qty(row.quarantined_after)}
                          </td>
                          {costRead && (
                            <td className="numeric">{money(row.value_vnd)}</td>
                          )}
                          <td>
                            {row.canOpenSource && (
                              <button
                                className="button secondary small"
                                onClick={() =>
                                  void open(row.document_type, row.document_id)
                                }
                              >
                                Chứng từ
                              </button>
                            )}
                          </td>
                        </>
                      ) : (
                        <>
                          <td>
                            <button
                              className="stock-doc-link"
                              onClick={() =>
                                void open(
                                  view === "counts" ? "COUNT" : "ADJUSTMENT",
                                  row.id,
                                )
                              }
                            >
                              {row.code}
                            </button>
                          </td>
                          <td>{badge(row.status)}</td>
                          <td>
                            {view === "counts"
                              ? row.line_count + " mã hàng"
                              : labels[row.adjustment_type]}
                          </td>
                          <td className="stock-note-cell">{row.note}</td>
                          <td>{when(row.created_at)}</td>
                          <td>
                            <button
                              className="button secondary small"
                              onClick={() =>
                                void open(
                                  view === "counts" ? "COUNT" : "ADJUSTMENT",
                                  row.id,
                                )
                              }
                            >
                              Mở phiếu
                            </button>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && (
              <div className="stock-empty">
                <h3>{loading ? "Đang tải dữ liệu…" : "Chưa có kết quả"}</h3>
                <p>
                  {view === "balances"
                    ? "Hàng đã nhập hoặc được kiểm sẽ xuất hiện tại đây. Bạn có thể đổi bộ lọc hoặc địa điểm."
                    : "Thử đổi bộ lọc hoặc tạo phiếu mới nếu được cấp quyền."}
                </p>
              </div>
            )}
            <footer className="stock-table-footer">
              <span>
                {rows.length} dòng đã tải{asOf ? " · " + when(asOf) : ""}
              </span>
              {next && (
                <button
                  className="button secondary small"
                  disabled={loading}
                  onClick={() => void more()}
                >
                  Xem thêm
                </button>
              )}
            </footer>
          </section>
        </>
      )}
    </div>
  );
}

function StockDraft({
  kind,
  api,
  path,
  site,
  busy,
  cancel,
  submit,
}: {
  kind: string;
  api: Api;
  path: string;
  site: Row;
  busy: boolean;
  cancel: () => void;
  submit: (body: Row) => Promise<void>;
}) {
  const [term, setTerm] = useState(""),
    [results, setResults] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null),
    [selected, setSelected] = useState<Row[]>([]),
    [type, setType] = useState("WRITE_OFF_GOOD"),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [searching, setSearching] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void apiRef
        .current(`${path}/skus?q=${encodeURIComponent(term)}&limit=20`)
        .then((d) => {
          if (alive) {
            setResults(d.items);
            setNext(d.nextCursor);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [term, path]);
  function update(id: string, field: string, value: any) {
    setSelected((ls) =>
      ls.map((l) => (l.id === id ? { ...l, [field]: value } : l)),
    );
  }
  async function more() {
    setSearching(true);
    try {
      const d = await api(
        `${path}/skus?q=${encodeURIComponent(term)}&limit=20&cursor=${next}`,
      );
      setResults((r) => [...r, ...d.items]);
      setNext(d.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  }
  return (
    <form
      className="stock-editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (!selected.length) {
          setError("Chọn ít nhất một mã hàng.");
          return;
        }
        void submit({
          siteId: site.id,
          warehouseId: site.warehouse_id,
          note,
          ...(kind === "ADJUSTMENT" ? { adjustmentType: type } : {}),
          lines: selected.map((l) => ({
            skuId: l.id,
            ...(kind === "ADJUSTMENT"
              ? {
                  qty: l.qty,
                  ...(type === "CORRECTION"
                    ? { direction: l.direction, unitCostVnd: l.cost || null }
                    : {}),
                  qualityConfirmed:
                    type === "RELEASE_QUARANTINE" ? l.quality : false,
                }
              : {}),
          })),
        });
      }}
    >
      <div className="stock-page-heading">
        <div>
          <button type="button" className="stock-back" onClick={cancel}>
            ← Quay lại danh sách
          </button>
          <h2>
            {kind === "COUNT" ? "Tạo phiếu kiểm kho" : "Tạo phiếu điều chỉnh"}
          </h2>
          <p>
            {kind === "COUNT"
              ? "Chọn phạm vi trước. Hàng chỉ bị khóa khi bạn bắt đầu kiểm."
              : "Mọi thay đổi tồn cần được chủ hộ hoặc quản lý ghi sổ."}
          </p>
        </div>
        {badge("DRAFT")}
      </div>
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="stock-draft-layout">
        <section className="data-panel stock-picker">
          <h3>Chọn mã hàng</h3>
          <input
            aria-label="Tìm mã hàng để chọn"
            placeholder="Tìm theo tên, mã hoặc barcode"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <p className="stock-muted">
            Đơn vị cơ sở được dùng xuyên suốt phiếu.
          </p>
          <div className="stock-picker-list">
            {results.map((s) => (
              <button
                key={s.id}
                type="button"
                disabled={
                  selected.some((l) => l.id === s.id) || selected.length >= 100
                }
                onClick={() =>
                  setSelected((ls) => [
                    ...ls,
                    {
                      ...s,
                      qty: "1",
                      direction: "DECREASE",
                      cost: "",
                      quality: false,
                    },
                  ])
                }
              >
                <span>
                  <strong>{s.name}</strong>
                  <small>
                    {s.code} · {s.base_unit}
                  </small>
                </span>
                <b>{selected.some((l) => l.id === s.id) ? "✓" : "＋"}</b>
              </button>
            ))}
          </div>
          {searching && <p>Đang tìm…</p>}
          {!searching && !results.length && <p>Không tìm thấy mã hàng.</p>}
          {next && (
            <button
              type="button"
              className="button secondary small"
              disabled={searching}
              onClick={() => void more()}
            >
              Tải thêm mã hàng
            </button>
          )}
        </section>
        <section className="data-panel stock-draft-lines">
          <h3>{selected.length} mã hàng đã chọn</h3>
          {kind === "ADJUSTMENT" && (
            <label className="c-field">
              Loại điều chỉnh
              <select
                aria-label="Loại điều chỉnh"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                {[
                  "WRITE_OFF_GOOD",
                  "WRITE_OFF_QUARANTINE",
                  "QUARANTINE",
                  "RELEASE_QUARANTINE",
                  "CORRECTION",
                ].map((k) => (
                  <option value={k} key={k}>
                    {labels[k]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!selected.length && (
            <div className="stock-empty">
              <h3>Chọn hàng cần đối chiếu</h3>
              <p>Tìm mã hàng bên cạnh và thêm vào phiếu.</p>
            </div>
          )}
          {selected.map((l) => (
            <div className="stock-selected-line" key={l.id}>
              <div className="stock-line-title">
                <div>
                  <strong>{l.name}</strong>
                  <small>
                    {l.code} · {l.base_unit}
                  </small>
                </div>
                <button
                  type="button"
                  className="stock-remove"
                  aria-label={"Bỏ " + l.code}
                  onClick={() =>
                    setSelected((ls) => ls.filter((x) => x.id !== l.id))
                  }
                >
                  ×
                </button>
              </div>
              {kind === "ADJUSTMENT" && (
                <div className="stock-line-inputs">
                  <QInput
                    label={"Số lượng " + l.code}
                    value={l.qty}
                    onChange={(v: string) => update(l.id, "qty", v)}
                  />
                  {type === "CORRECTION" && (
                    <>
                      <label className="c-field">
                        Chiều điều chỉnh
                        <select
                          aria-label={"Chiều " + l.code}
                          value={l.direction}
                          onChange={(e) =>
                            update(l.id, "direction", e.target.value)
                          }
                        >
                          <option value="DECREASE">Giảm tồn</option>
                          <option value="INCREASE">Tăng tồn</option>
                        </select>
                      </label>
                      {l.direction === "INCREASE" && (
                        <label className="c-field">
                          Giá vốn bổ sung (₫)
                          <input
                            aria-label={"Giá vốn " + l.code}
                            type="number"
                            min="0"
                            step="1"
                            value={l.cost}
                            placeholder="Để trống: vốn hiện hành"
                            onChange={(e) =>
                              update(l.id, "cost", e.target.value)
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                  {type === "RELEASE_QUARANTINE" && (
                    <label className="stock-check">
                      <input
                        type="checkbox"
                        required
                        checked={l.quality}
                        onChange={(e) =>
                          update(l.id, "quality", e.target.checked)
                        }
                      />
                      Đã kiểm tra chất lượng hàng
                    </label>
                  )}
                </div>
              )}
            </div>
          ))}
          <label className="c-field">
            {kind === "COUNT" ? "Nội dung kiểm kho" : "Lý do điều chỉnh"}
            <textarea
              aria-label="Lý do phiếu kho"
              required
              minLength={5}
              maxLength={500}
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                kind === "COUNT"
                  ? "Ví dụ: Đối chiếu số lượng cuối tháng"
                  : "Ghi rõ nguyên nhân và căn cứ xác nhận"
              }
            />
          </label>
          {type === "CORRECTION" && kind === "ADJUSTMENT" && (
            <p className="stock-help">
              Tăng từ tồn bằng 0 cần nhập giá vốn. Nếu đang có tồn và để trống,
              hệ thống dùng vốn hiện hành.
            </p>
          )}
          <div className="stock-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={cancel}
            >
              Quay lại
            </button>
            <button
              className="button primary"
              disabled={busy || !selected.length}
            >
              {busy ? "Đang lưu…" : "Lưu phiếu nháp"}
            </button>
          </div>
        </section>
      </div>
    </form>
  );
}

function StockDetail({
  row,
  busy,
  costRead,
  canWrite,
  canApprove,
  active,
  close,
  refresh,
  transition,
  save,
}: any) {
  const [note, setNote] = useState(row.note),
    [lines, setLines] = useState<Row[]>(
      row.lines.map((l: Row) => ({
        ...l,
        good: l.counted_good ?? "",
        quarantine: l.counted_quarantined ?? "",
        cost: l.unit_cost_vnd ?? "",
        quality: l.quality_confirmed,
      })),
    );
  const editable =
    row.kind === "COUNT" && row.status === "COUNTING" && canWrite && active;
  const editAdjustment =
    row.kind === "ADJUSTMENT" && row.status === "DRAFT" && canWrite && active;
  const dirty =
    note !== row.note ||
    lines.some(
      (l: Row, i: number) =>
        l.good !== (row.lines[i].counted_good ?? "") ||
        l.quarantine !== (row.lines[i].counted_quarantined ?? "") ||
        l.cost !== (row.lines[i].unit_cost_vnd ?? "") ||
        l.qty !== row.lines[i].qty ||
        l.direction !== row.lines[i].direction ||
        l.quality !== row.lines[i].quality_confirmed,
    );
  function change(id: string, key: string, value: string) {
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, [key]: value } : l)));
  }
  return (
    <section className="stock-document">
      <div className="stock-page-heading">
        <div>
          <button className="stock-back" onClick={close}>
            ← Quay lại danh sách
          </button>
          <h2>{row.code}</h2>
          <p>
            {labels[row.kind]}
            {row.adjustment_type ? " · " + labels[row.adjustment_type] : ""}
          </p>
        </div>
        {badge(row.status)}
      </div>
      {row.kind === "COUNT" && (
        <ol className="stock-steps">
          {["DRAFT", "COUNTING", "SUBMITTED", "POSTED"].map((s, i) => (
            <li key={s} className={row.status === s ? "current" : ""}>
              <span>{i + 1}</span>
              {labels[s]}
            </li>
          ))}
        </ol>
      )}
      {["COUNTING", "SUBMITTED"].includes(row.status) && (
        <div className="stock-freeze-notice">
          <strong>Phạm vi kiểm đang được khóa</strong>
          <p>
            Các mã hàng trên phiếu chưa thể nhập thêm hoặc điều chỉnh tại địa
            điểm này. Hoàn tất duyệt hoặc hủy phiếu để mở khóa.
          </p>
        </div>
      )}
      <div className="stock-document-meta">
        <div>
          <small>NGÀY LẬP</small>
          <strong>{when(row.created_at)}</strong>
        </div>
        <div>
          <small>PHẠM VI</small>
          <strong>{row.lines.length} mã hàng</strong>
        </div>
        <div>
          <small>
            {row.status === "POSTED" ? "GHI SỔ LÚC" : "CẬP NHẬT LÚC"}
          </small>
          <strong>{when(row.posted_at ?? row.updated_at)}</strong>
        </div>
      </div>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save({
            note,
            lines: lines.map((l) => ({
              skuId: l.sku_id,
              ...(editAdjustment
                ? {
                    qty: l.qty,
                    ...(row.adjustment_type === "CORRECTION"
                      ? {
                          direction: l.direction,
                          ...(costRead || l.cost !== ""
                            ? { unitCostVnd: l.cost || null }
                            : {}),
                        }
                      : {}),
                    qualityConfirmed: l.quality,
                  }
                : {
                    good: l.good,
                    quarantined: l.quarantine,
                    ...(costRead || l.cost !== ""
                      ? { unitCostVnd: l.cost || null }
                      : {}),
                  }),
            })),
          });
        }}
      >
        <section className="data-panel">
          <div className="table-wrap">
            <table className="stock-table">
              <thead>
                <tr>
                  <th>Mã hàng / Tên hàng</th>
                  <th>Đơn vị</th>
                  {row.kind === "COUNT" ? (
                    <>
                      <th>Tồn khi bắt đầu</th>
                      <th>Cách ly ban đầu</th>
                      <th>Đếm hàng tốt</th>
                      <th>Đếm cách ly</th>
                      <th>Chênh lệch</th>
                    </>
                  ) : (
                    <>
                      <th>Số lượng</th>
                      <th>
                        {row.kind === "RECEIPT"
                          ? "Quy đổi cơ sở"
                          : "Thay đổi tồn"}
                      </th>
                    </>
                  )}
                  {costRead && (
                    <th>
                      {row.kind === "RECEIPT"
                        ? "Thành tiền"
                        : "Giá trị thay đổi"}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.sku_name}</strong>
                      <small>{l.sku_code}</small>
                    </td>
                    <td>{l.base_unit}</td>
                    {row.kind === "COUNT" ? (
                      <>
                        <td className="numeric">{qty(l.snapshot_on_hand)}</td>
                        <td className="numeric">
                          {qty(l.snapshot_quarantined)}
                        </td>
                        <td>
                          {editable ? (
                            <QInput
                              label={"Hàng tốt " + l.sku_code}
                              value={l.good}
                              onChange={(v: string) => change(l.id, "good", v)}
                            />
                          ) : (
                            qty(l.counted_good)
                          )}
                        </td>
                        <td>
                          {editable ? (
                            <QInput
                              label={"Cách ly " + l.sku_code}
                              value={l.quarantine}
                              onChange={(v: string) =>
                                change(l.id, "quarantine", v)
                              }
                            />
                          ) : (
                            qty(l.counted_quarantined)
                          )}
                        </td>
                        <td className="numeric">
                          {l.delta != null
                            ? qty(l.delta)
                            : l.good !== "" &&
                                l.quarantine !== "" &&
                                l.snapshot_on_hand != null
                              ? previewDelta(
                                  l.good,
                                  l.quarantine,
                                  l.snapshot_on_hand,
                                )
                              : "—"}
                          {editable && Number(l.snapshot_on_hand) === 0 && (
                            <label className="stock-number-label">
                              Giá vốn khi tăng (₫)
                              <input
                                aria-label={"Giá vốn kiểm " + l.sku_code}
                                type="number"
                                min="0"
                                step="1"
                                value={l.cost}
                                onChange={(e) =>
                                  change(l.id, "cost", e.target.value)
                                }
                              />
                            </label>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="numeric">
                          {editAdjustment ? (
                            <>
                              <QInput
                                label={"Số lượng " + l.sku_code}
                                value={l.qty}
                                onChange={(v: string) => change(l.id, "qty", v)}
                              />
                              {row.adjustment_type === "CORRECTION" && (
                                <>
                                  <select
                                    aria-label={"Chiều " + l.sku_code}
                                    value={l.direction}
                                    onChange={(e) =>
                                      change(l.id, "direction", e.target.value)
                                    }
                                  >
                                    <option value="DECREASE">Giảm tồn</option>
                                    <option value="INCREASE">Tăng tồn</option>
                                  </select>
                                  {l.direction === "INCREASE" && (
                                    <label className="stock-number-label">
                                      Giá vốn bổ sung (₫)
                                      <input
                                        aria-label={"Giá vốn " + l.sku_code}
                                        type="number"
                                        min="0"
                                        step="1"
                                        value={l.cost}
                                        onChange={(e) =>
                                          change(l.id, "cost", e.target.value)
                                        }
                                      />
                                    </label>
                                  )}
                                </>
                              )}
                              {row.adjustment_type === "RELEASE_QUARANTINE" && (
                                <label className="stock-check">
                                  <input
                                    type="checkbox"
                                    checked={l.quality}
                                    required
                                    onChange={(e) =>
                                      setLines((ls) =>
                                        ls.map((x) =>
                                          x.id === l.id
                                            ? {
                                                ...x,
                                                quality: e.target.checked,
                                              }
                                            : x,
                                        ),
                                      )
                                    }
                                  />
                                  Đạt chất lượng
                                </label>
                              )}
                            </>
                          ) : (
                            <>
                              {qty(l.qty)}
                              {l.direction === "INCREASE"
                                ? " ↑"
                                : l.direction === "DECREASE"
                                  ? " ↓"
                                  : ""}
                            </>
                          )}
                        </td>
                        <td className="numeric">
                          {qty(row.kind === "RECEIPT" ? l.qty_base : l.delta)}
                        </td>
                      </>
                    )}
                    {costRead && (
                      <td className="numeric">
                        {money(
                          row.kind === "RECEIPT" ? l.total_vnd : l.value_delta,
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <div className="stock-detail-bottom">
          <section>
            <h3>{editable ? "Lý do / kết quả đối chiếu" : "Nội dung phiếu"}</h3>
            {editable || editAdjustment ? (
              <textarea
                aria-label="Kết quả đối chiếu"
                required
                minLength={5}
                maxLength={500}
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            ) : (
              <p className="stock-preserve">{row.note}</p>
            )}
            <p className="stock-muted">
              {row.status === "POSTED"
                ? "Phiếu đã ghi sổ được giữ nguyên để đối chiếu lịch sử."
                : row.kind === "COUNT"
                  ? "Số đếm chỉ cập nhật tồn sau khi được duyệt."
                  : "Phiếu nháp chưa làm thay đổi tồn kho."}
            </p>
          </section>
          <div className="stock-actions">
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={refresh}
            >
              Tải lại phiếu
            </button>
            {(editable || editAdjustment) && (
              <button type="submit" className="button primary" disabled={busy}>
                {editAdjustment ? "Lưu thay đổi" : "Lưu số đếm"}
              </button>
            )}
            {canWrite &&
              active &&
              row.kind === "COUNT" &&
              row.status === "DRAFT" && (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy}
                  onClick={() => transition("start")}
                >
                  Bắt đầu kiểm
                </button>
              )}
            {editable && (
              <button
                type="button"
                className="button primary"
                disabled={
                  busy ||
                  dirty ||
                  lines.some((l) => l.good === "" || l.quarantine === "")
                }
                onClick={() => transition("submit")}
              >
                Gửi duyệt
              </button>
            )}
            {canApprove &&
              active &&
              ((row.kind === "COUNT" && row.status === "SUBMITTED") ||
                (row.kind === "ADJUSTMENT" && row.status === "DRAFT")) && (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || dirty}
                  onClick={() =>
                    transition(row.kind === "COUNT" ? "approve" : "post")
                  }
                >
                  Duyệt và ghi sổ
                </button>
              )}
            {canApprove &&
              active &&
              row.kind === "COUNT" &&
              row.status === "SUBMITTED" && (
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => transition("reopen")}
                >
                  Yêu cầu đếm lại
                </button>
              )}
            {canWrite &&
              row.kind !== "RECEIPT" &&
              !["POSTED", "CANCELLED"].includes(row.status) && (
                <button
                  type="button"
                  className="button danger"
                  disabled={busy}
                  onClick={() => transition("cancel")}
                >
                  Hủy phiếu
                </button>
              )}
          </div>
        </div>
      </form>
    </section>
  );
}
