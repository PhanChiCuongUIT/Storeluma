import React, { useEffect, useRef, useState, type FormEvent } from "react";
import { lineCost } from "../../../packages/platform/decimal";
import "./commerce.css";
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
type Row = Record<string, any>;
const money = (v: string = "0") =>
  new Intl.NumberFormat("vi-VN").format(BigInt(v)) + " ₫";
const qty = (v: string) =>
  v.includes(".") ? v.replace(/0+$/, "").replace(/\.$/, "") : v;
const label: Record<string, string> = {
  ACTIVE: "Đang dùng",
  INACTIVE: "Ngừng dùng",
  DRAFT: "Phiếu nháp",
  POSTED: "Đã ghi sổ",
  CANCELLED: "Đã hủy",
};
const date = (v: string) =>
  new Date(v).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
function Badge({ value }: { value: string }) {
  return (
    <span className={"commerce-badge " + value.toLowerCase()}>
      <i />
      {label[value]}
    </span>
  );
}
function Field({
  label: caption,
  name,
  value = "",
  type = "text",
  required = true,
  ...props
}: any) {
  return (
    <label className="c-field">
      {caption}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        {...props}
      />
    </label>
  );
}
function Status({ value = "ACTIVE" }: { value?: string }) {
  return (
    <label className="c-field">
      Trạng thái
      <select name="status" defaultValue={value}>
        <option value="ACTIVE">Đang dùng</option>
        <option value="INACTIVE">Ngừng dùng</option>
      </select>
    </label>
  );
}
function SupplierHistory({
  supplier,
  sites,
  path,
  api,
  costRead,
  close,
}: {
  supplier: Row;
  sites: Row[];
  path: string;
  api: Api;
  costRead: boolean;
  close: () => void;
}) {
  const [site, setSite] = useState(sites[0]?.id ?? ""),
    [rows, setRows] = useState<Row[]>([]),
    [next, setNext] = useState<string | null>(null),
    [debts, setDebts] = useState<Row[]>([]),
    [debtNext, setDebtNext] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [asOf, setAsOf] = useState(""),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const apiRef = useRef(api);
  apiRef.current = api;
  useEffect(() => {
    let alive = true;
    setRows([]);
    setDebts([]);
    setNext(null);
    setDebtNext(null);
    setAsOf("");
    setError("");
    setMessage("");
    if (!site) return;
    setLoading(true);
    void Promise.allSettled([
      apiRef.current(
        `${path}/receipts?siteId=${site}&supplierId=${supplier.id}&limit=30`,
      ),
      ...(costRead
        ? [
            apiRef.current(
              `${path}/payables?siteId=${site}&supplierId=${supplier.id}&limit=30`,
            ),
          ]
        : []),
    ]).then(([receipts, payables]) => {
      if (!alive) return;
      if (receipts.status === "fulfilled") {
        setRows(receipts.value.items);
        setNext(receipts.value.nextCursor);
      } else setError(receipts.reason.message);
      if (payables?.status === "fulfilled") {
        setDebts(payables.value.items);
        setDebtNext(payables.value.nextCursor);
        setAsOf(payables.value.dataAsOf);
      } else if (payables)
        setMessage(
          "Chưa kết nối được sổ công nợ. Dữ liệu nhập hàng vẫn được giữ.",
        );
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [site, path, supplier.id, costRead]);
  async function more(kind: "receipts" | "payables") {
    setLoading(true);
    try {
      const data = await api(
        `${path}/${kind}?siteId=${site}&supplierId=${supplier.id}&limit=30&cursor=${kind === "receipts" ? next : debtNext}`,
      );
      if (kind === "receipts") {
        setRows([...rows, ...data.items]);
        setNext(data.nextCursor);
      } else {
        setDebts([...debts, ...data.items]);
        setDebtNext(data.nextCursor);
        setAsOf(data.dataAsOf);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <header>
        <div>
          <span className="eyebrow">LỊCH SỬ NHÀ CUNG CẤP</span>
          <h2>{supplier.name}</h2>
        </div>
        <button className="quiet" onClick={close} aria-label="Đóng lịch sử">
          ×
        </button>
      </header>
      <div className="c-form-body">
        <label className="c-field">
          Địa điểm
          <select
            aria-label="Địa điểm lịch sử"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          >
            {!site && <option value="">Chưa có địa điểm</option>}
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {loading && <p role="status">Đang tải…</p>}
        <h3>Phiếu nhập</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Mã phiếu</th>
                <th>Ngày lập</th>
                <th>Trạng thái</th>
                <th className="number">Giá trị nhập</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.code}</td>
                  <td>{date(r.created_at)}</td>
                  <td>
                    <Badge value={r.status} />
                  </td>
                  <td className="number">{money(r.total_vnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && !rows.length && (
          <p className="c-help">Chưa có phiếu nhập tại địa điểm này.</p>
        )}
        {next && (
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => void more("receipts")}
          >
            Xem thêm phiếu
          </button>
        )}
        {costRead && (
          <>
            <h3>Công nợ từ phiếu mua</h3>
            {asOf && (
              <p className="c-help">
                Kiểm tra lúc {date(asOf)}. Phiếu vừa ghi sổ có thể đang chờ đồng
                bộ.
              </p>
            )}
            {message ? (
              <p role="status">{message}</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Ngày ghi sổ</th>
                      <th className="number">Phải trả</th>
                      <th className="number">Đã trả</th>
                      <th className="number">Còn nợ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debts.map((d) => (
                      <tr key={d.id}>
                        <td>{date(d.posted_at)}</td>
                        <td className="number">{money(d.total_vnd)}</td>
                        <td className="number">{money(d.paid_vnd)}</td>
                        <td className="number">{money(d.outstanding_vnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {asOf && !debts.length && (
              <p className="c-help">
                Chưa ghi nhận khoản phải trả tại thời điểm kiểm tra.
              </p>
            )}
            {debtNext && (
              <button
                className="button secondary"
                disabled={loading}
                onClick={() => void more("payables")}
              >
                Xem thêm công nợ
              </button>
            )}
          </>
        )}
      </div>
      <footer>
        <button className="button secondary" onClick={close}>
          Đóng
        </button>
      </footer>
    </>
  );
}
export function Commerce({
  tab,
  tenant,
  role,
  sites,
  api,
  subjectId,
}: {
  tab: string;
  tenant: string;
  role: string;
  sites: Row[];
  api: Api;
  subjectId: string;
}) {
  const [section, setSection] = useState("products"),
    [rows, setRows] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [siteId, setSiteId] = useState(
      sites.find((s) => s.status === "ACTIVE")?.id ?? "",
    );
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [detail, setDetail] = useState<Row | null>(null),
    [modal, setModal] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [categories, setCategories] = useState<Row[]>([]),
    [suppliers, setSuppliers] = useState<Row[]>([]),
    [skus, setSkus] = useState<Row[]>([]),
    [skuQuery, setSkuQuery] = useState(""),
    [skuMore, setSkuMore] = useState<string | null>(null),
    [supplierQuery, setSupplierQuery] = useState(""),
    [supplierMore, setSupplierMore] = useState<string | null>(null),
    [categoryQuery, setCategoryQuery] = useState(""),
    [categoryMore, setCategoryMore] = useState<string | null>(null);
  const [lines, setLines] = useState<Row[]>([]),
    [source, setSource] = useState("PURCHASE"),
    [supplierId, setSupplierId] = useState(""),
    [payable, setPayable] = useState<Row | null>(null),
    [payableState, setPayableState] = useState(""),
    [checkedAt, setCheckedAt] = useState("");
  const modalRef = useRef<HTMLDialogElement>(null),
    requestKey = useRef({ body: "", key: "" }),
    busyRef = useRef(false),
    loadVersion = useRef(0),
    apiRef = useRef(api);
  apiRef.current = api;
  const catalogWrite = ["OWNER", "MANAGER"].includes(role),
    supplierWrite = ["OWNER", "MANAGER", "STOCK"].includes(role),
    receiptWrite = supplierWrite,
    canPost = catalogWrite,
    costRead = ["OWNER", "ACCOUNTANT"].includes(role);
  const resource = tab === "products" ? section : tab,
    path = `/v1/tenants/${tenant}`,
    activeSite = sites.find((s) => s.id === siteId),
    canEdit =
      detail?.status === "DRAFT" &&
      receiptWrite &&
      (role !== "STOCK" || detail.created_by === subjectId) &&
      (detail.source_type !== "OPENING_STOCK" || role === "OWNER");
  async function load(next?: string) {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        q: search,
        limit: "30",
        ...(filter ? { status: filter } : {}),
        ...(next ? { cursor: next } : {}),
        ...(tab === "receipts" ? { siteId } : {}),
      });
      const data = await apiRef.current(`${path}/${resource}?${q}`);
      if (version !== loadVersion.current) return;
      setRows((old) => (next ? [...old, ...data.items] : data.items));
      setCursor(data.nextCursor);
    } catch (e) {
      if (version === loadVersion.current) setError((e as Error).message);
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    setDetail(null);
    setRows([]);
    setError("");
    if (tab === "receipts" && !siteId) {
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      loadVersion.current++;
    };
  }, [resource, siteId, search, filter]);
  useEffect(() => {
    if (!siteId && sites.length)
      setSiteId(sites.find((s) => s.status === "ACTIVE")?.id ?? sites[0].id);
  }, [sites, siteId]);
  useEffect(() => {
    if (!modal) return;
    const dialog = modalRef.current;
    dialog?.showModal();
    const prev = document.activeElement as HTMLElement;
    return () => {
      dialog?.close();
      prev?.isConnected && prev.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (!["product", "productEdit"].includes(modal)) return;
    let alive = true;
    const timer = setTimeout(() => {
      void apiRef
        .current(
          `${path}/categories?limit=50&status=ACTIVE&q=${encodeURIComponent(categoryQuery)}`,
        )
        .then((d) => {
          if (alive) {
            setCategories(d.items);
            setCategoryMore(d.nextCursor);
          }
        })
        .catch((e) => alive && setError(e.message));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [modal, categoryQuery]);
  useEffect(() => {
    if (modal !== "receipt") return;
    let alive = true;
    const timer = setTimeout(() => {
      void apiRef
        .current(
          `${path}/suppliers?limit=50&status=ACTIVE&q=${encodeURIComponent(supplierQuery)}`,
        )
        .then((d) => {
          if (alive) {
            setSuppliers(d.items);
            setSupplierMore(d.nextCursor);
          }
        })
        .catch((e) => alive && setError(e.message));
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [modal, supplierQuery]);
  useEffect(() => {
    if (modal !== "receipt") return;
    let alive = true;
    const timer = setTimeout(() => {
      void apiRef
        .current(
          `${path}/skus?limit=30&status=ACTIVE&q=${encodeURIComponent(skuQuery)}`,
        )
        .then((d) => {
          if (alive) {
            setSkus(d.items);
            setSkuMore(d.nextCursor);
          }
        })
        .catch((e) => alive && setError(e.message));
    }, 220);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [modal, skuQuery]);
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
      setBusy(false);
      busyRef.current = false;
    }
  }
  function key(body: unknown) {
    const signature = JSON.stringify(body);
    if (requestKey.current.body !== signature)
      requestKey.current = { body: signature, key: crypto.randomUUID() };
    return requestKey.current.key;
  }
  function open(kind: string, row: Row | null = null) {
    setError("");
    setEditing(row);
    setModal(kind);
    requestKey.current = { body: "", key: "" };
    if (kind === "receipt") {
      setLines(
        row?.lines.map((l: Row) => ({
          skuId: l.sku_id,
          unitId: l.unit_id,
          qty: l.qty,
          unitCostVnd: l.unit_cost_vnd,
          name: l.sku_name,
          code: l.sku_code,
          unitName: l.unit_name,
          units: [{ id: l.unit_id, name: l.unit_name }],
          baseUnit: l.base_unit,
        })) ?? [],
      );
      setSource(row?.source_type ?? "PURCHASE");
      setSupplierId(row?.supplier_id ?? "");
      setSkuQuery("");
      setSupplierQuery("");
    }
    if (kind === "product" || kind === "productEdit") setCategoryQuery("");
  }
  async function show(row: Row) {
    await run(async () => {
      setDetail(
        await api(
          `${path}/${tab === "receipts" ? "receipts" : "products"}/${row.id}`,
        ),
      );
      setPayable(null);
      setPayableState("");
    });
  }
  async function checkPayable() {
    if (!detail) return;
    setPayableState("Đang kiểm tra…");
    try {
      const data = await api(
        `${path}/payables?siteId=${detail.site_id}&receiptId=${detail.id}`,
      );
      setPayable(data.items[0] ?? null);
      setCheckedAt(data.dataAsOf);
      setPayableState(
        data.items.length
          ? ""
          : "Đang chờ đồng bộ công nợ. Bạn có thể kiểm tra lại.",
      );
    } catch {
      setPayableState(
        "Chưa kết nối được sổ công nợ. Phiếu nhập vẫn đã ghi sổ.",
      );
    }
  }
  useEffect(() => {
    if (
      detail?.status !== "POSTED" ||
      detail.source_type !== "PURCHASE" ||
      !costRead ||
      payable
    )
      return;
    let alive = true,
      inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await apiRef.current(
          `${path}/payables?siteId=${detail.site_id}&receiptId=${detail.id}`,
        );
        if (alive) {
          setPayable(data.items[0] ?? null);
          setCheckedAt(data.dataAsOf);
          setPayableState(
            data.items.length
              ? ""
              : "Đang chờ đồng bộ công nợ. Bạn có thể kiểm tra lại.",
          );
        }
      } catch {
        if (alive)
          setPayableState(
            "Chưa kết nối được sổ công nợ. Phiếu nhập vẫn đã ghi sổ.",
          );
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [detail?.id, detail?.status, payable?.id, costRead]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget),
      v = (n: string) => String(fd.get(n) ?? "").trim();
    await run(async () => {
      let endpoint = "",
        method = "POST",
        body: any;
      const sku = {
        code: v("code").toUpperCase(),
        name: v("skuName"),
        barcode: v("barcode") || null,
        baseUnit: v("baseUnit"),
        priceVnd: v("price"),
        attributes: {
          ...(v("color") ? { color: v("color") } : {}),
          ...(v("size") ? { size: v("size") } : {}),
        },
      };
      if (modal === "category") {
        endpoint = "/categories" + (editing ? "/" + editing.id : "");
        method = editing ? "PATCH" : "POST";
        body = {
          name: v("name"),
          ...(editing
            ? { version: editing.version, status: v("status") }
            : { code: v("code").toUpperCase() }),
        };
      }
      if (modal === "supplier") {
        endpoint = "/suppliers" + (editing ? "/" + editing.id : "");
        method = editing ? "PATCH" : "POST";
        body = {
          name: v("name"),
          phone: v("phone") || null,
          address: v("address") || null,
          ...(editing
            ? { version: editing.version, status: v("status") }
            : { code: v("code").toUpperCase() }),
        };
      }
      if (modal === "product") {
        endpoint = "/products";
        body = { name: v("name"), categoryId: v("categoryId") || null, sku };
      }
      if (modal === "productEdit") {
        endpoint = "/products/" + editing!.id;
        method = "PATCH";
        body = {
          name: v("name"),
          categoryId: v("categoryId") || null,
          status: v("status"),
          version: editing!.version,
        };
      }
      if (modal === "sku") {
        endpoint = "/products/" + detail!.id + "/skus";
        body = sku;
      }
      if (modal === "skuEdit") {
        endpoint = "/skus/" + editing!.id;
        method = "PATCH";
        body = {
          name: v("skuName"),
          barcode: v("barcode") || null,
          status: v("status"),
          version: editing!.version,
        };
      }
      if (modal === "unit") {
        endpoint = "/skus/" + editing!.id + "/units";
        body = { name: v("name"), factor: v("factor"), priceVnd: v("price") };
      }
      if (modal === "price") {
        endpoint = "/skus/" + editing!.sku_id + "/units/" + editing!.id;
        method = "PATCH";
        body = {
          priceVnd: v("price"),
          status: v("status"),
          version: editing!.version,
        };
      }
      if (modal === "receipt") {
        if (!lines.length) throw new Error("Thêm ít nhất một mã hàng.");
        if (source === "PURCHASE" && !supplierId)
          throw new Error("Chọn nhà cung cấp.");
        const draft = {
          siteId,
          warehouseId: activeSite!.warehouse_id,
          sourceType: source,
          supplierId: source === "PURCHASE" ? supplierId : null,
          note: v("note"),
          lines: lines.map((l) => ({
            skuId: l.skuId,
            unitId: l.unitId,
            qty: l.qty,
            unitCostVnd: l.unitCostVnd,
          })),
        };
        endpoint = "/receipts" + (editing ? "/" + editing.id : "");
        method = editing ? "PATCH" : "POST";
        body = editing ? { version: editing.version, draft } : draft;
      }
      if (modal === "post" || modal === "cancel") {
        endpoint = "/receipts/" + detail!.id + "/" + modal;
        body = { version: detail!.version };
      }
      const result = await api(path + endpoint, method, body, key(body));
      setModal("");
      setNotice(
        modal === "post"
          ? "Đã ghi sổ phiếu nhập. Số lượng và giá trị tồn đã được cập nhật."
          : modal === "cancel"
            ? "Đã hủy phiếu nháp."
            : "Đã lưu thay đổi.",
      );
      await load();
      if (tab === "products" && detail)
        setDetail(await api(`${path}/products/${detail.id}`));
      if (tab === "receipts" && result.id)
        setDetail(await api(`${path}/receipts/${result.id}`));
    });
  }
  function addLine(s: Row) {
    if (lines.some((l) => l.skuId === s.id)) return;
    const units = s.units.filter((u: Row) => u.status === "ACTIVE"),
      u = units[0];
    if (!u) return;
    setLines([
      ...lines,
      {
        skuId: s.id,
        unitId: u.id,
        qty: "1",
        unitCostVnd: "0",
        name: s.name,
        code: s.code,
        unitName: u.name,
        units,
        baseUnit: s.base_unit,
      },
    ]);
  }
  function changeLine(index: number, values: Row) {
    setLines((old) =>
      old.map((l, i) => (i === index ? { ...l, ...values } : l)),
    );
  }
  let preview = "0";
  try {
    preview = lines
      .reduce((s, l) => s + BigInt(lineCost(l.qty, l.unitCostVnd)), 0n)
      .toString();
  } catch {
    preview = "";
  }
  const title =
    tab === "receipts"
      ? "Phiếu nhập hàng"
      : tab === "suppliers"
        ? "Nhà cung cấp"
        : section === "categories"
          ? "Nhóm hàng"
          : "Danh mục hàng hóa";
  const writable =
    tab === "products"
      ? catalogWrite
      : tab === "suppliers"
        ? supplierWrite
        : receiptWrite && activeSite?.status === "ACTIVE";
  const modalTitles: Record<string, string> = {
    product: "Thêm sản phẩm",
    productEdit: "Sửa sản phẩm",
    category: editing ? "Sửa nhóm hàng" : "Thêm nhóm hàng",
    supplier: editing ? "Sửa nhà cung cấp" : "Thêm nhà cung cấp",
    sku: "Thêm biến thể",
    skuEdit: "Sửa mã hàng",
    unit: "Thêm đơn vị quy đổi",
    price: "Giá bán và trạng thái",
    receipt: editing ? "Sửa phiếu nhập" : "Lập phiếu nhập",
    post: "Ghi sổ phiếu nhập",
    cancel: "Hủy phiếu nháp",
    history: "Lịch sử nhà cung cấp",
  };
  return (
    <div className="commerce">
      {notice && (
        <div role="status" className="alert success">
          {notice}
          <button aria-label="Đóng thông báo" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {error && !modal && (
        <div role="alert" className="alert error">
          {error}
          <button onClick={() => setError("")} aria-label="Đóng lỗi">
            ×
          </button>
        </div>
      )}
      {tab === "products" && (
        <div className="c-tabs">
          <button
            className={section === "products" ? "selected" : ""}
            onClick={() => {
              setSection("products");
              setSearch("");
              setFilter("");
            }}
          >
            Sản phẩm
          </button>
          <button
            className={section === "categories" ? "selected" : ""}
            onClick={() => {
              setSection("categories");
              setSearch("");
              setFilter("");
            }}
          >
            Nhóm hàng
          </button>
        </div>
      )}
      {detail ? (
        <section className="c-sheet">
          <div className="c-sheet-head">
            <div>
              <button className="c-back" onClick={() => setDetail(null)}>
                ← Quay lại danh sách
              </button>
              <h2>{tab === "receipts" ? detail.code : detail.name}</h2>
              <div className="c-meta">
                <Badge value={detail.status} />
                {tab === "receipts" && (
                  <span>
                    {date(detail.created_at)} ·{" "}
                    {detail.source_type === "OPENING_STOCK"
                      ? "Tồn đầu kỳ"
                      : detail.supplier_name}
                  </span>
                )}
              </div>
            </div>
            <div className="c-actions">
              {tab === "products" && catalogWrite && (
                <>
                  <button
                    className="button secondary"
                    onClick={() => open("productEdit", detail)}
                  >
                    Sửa sản phẩm
                  </button>
                  {detail.status === "ACTIVE" && (
                    <button
                      className="button primary"
                      onClick={() => open("sku")}
                    >
                      ＋ Thêm biến thể
                    </button>
                  )}
                </>
              )}
              {tab === "receipts" &&
                canEdit &&
                activeSite?.status === "ACTIVE" && (
                  <>
                    <button
                      className="button quiet"
                      onClick={() => open("cancel")}
                    >
                      Hủy phiếu
                    </button>
                    <button
                      className="button secondary"
                      onClick={() => open("receipt", detail)}
                    >
                      Sửa phiếu
                    </button>
                    {canPost && (
                      <button
                        className="button primary"
                        onClick={() => open("post")}
                      >
                        Ghi sổ
                      </button>
                    )}
                  </>
                )}
            </div>
          </div>
          {tab === "products" ? (
            <div className="c-skus">
              {detail.skus.map((s: Row) => (
                <article className="c-sku" key={s.id}>
                  <div className="c-sku-heading">
                    <div className="c-item-icon">▤</div>
                    <div>
                      <small>{s.code}</small>
                      <h3>{s.name}</h3>
                      <p>
                        {[
                          s.attributes?.color,
                          s.attributes?.size,
                          s.barcode && "Mã vạch: " + s.barcode,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Đơn vị cơ sở: " + s.base_unit}
                      </p>
                    </div>
                    <Badge value={s.status} />
                    {catalogWrite && (
                      <button
                        className="quiet"
                        onClick={() => open("skuEdit", s)}
                      >
                        Sửa mã hàng
                      </button>
                    )}
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Đơn vị</th>
                          <th>Quy đổi</th>
                          <th className="number">Giá bán</th>
                          <th>Trạng thái</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {s.units.map((u: Row) => (
                          <tr key={u.id}>
                            <td>
                              <strong>{u.name}</strong>
                              {u.is_base && (
                                <small className="c-under">Đơn vị cơ sở</small>
                              )}
                            </td>
                            <td>
                              1 {u.name} = {qty(u.factor)} {s.base_unit}
                            </td>
                            <td className="number">{money(u.price_vnd)}</td>
                            <td>
                              <Badge value={u.status} />
                            </td>
                            <td>
                              {catalogWrite && (
                                <button
                                  className="quiet"
                                  onClick={() => open("price", u)}
                                >
                                  Chỉnh giá
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {catalogWrite && s.status === "ACTIVE" && (
                    <button
                      className="c-add-unit"
                      onClick={() => open("unit", s)}
                    >
                      ＋ Thêm đơn vị quy đổi
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <>
              <div className="c-receipt-facts">
                <div>
                  <small>Địa điểm nhận hàng</small>
                  <strong>{activeSite?.name}</strong>
                </div>
                <div>
                  <small>Loại nhập</small>
                  <strong>
                    {detail.source_type === "OPENING_STOCK"
                      ? "Tồn đầu kỳ"
                      : "Mua từ nhà cung cấp"}
                  </strong>
                </div>
                <div>
                  <small>
                    {detail.status === "POSTED"
                      ? "Thời gian ghi sổ"
                      : "Cập nhật gần nhất"}
                  </small>
                  <strong>{date(detail.posted_at ?? detail.updated_at)}</strong>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mã hàng / Tên hàng</th>
                      <th>Đơn vị</th>
                      <th className="number">Số lượng</th>
                      <th className="number">Quy về cơ sở</th>
                      <th className="number">Đơn giá nhập</th>
                      <th className="number">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((l: Row) => (
                      <tr key={l.id}>
                        <td>
                          <strong>{l.sku_name}</strong>
                          <small className="c-under">{l.sku_code}</small>
                        </td>
                        <td>{l.unit_name}</td>
                        <td className="number">{qty(l.qty)}</td>
                        <td className="number">
                          {qty(l.qty_base)} {l.base_unit}
                        </td>
                        <td className="number">{money(l.unit_cost_vnd)}</td>
                        <td className="number">{money(l.total_vnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="c-total">
                <span>Tổng giá trị nhập</span>
                <strong>{money(detail.total_vnd)}</strong>
              </div>
              {detail.note && (
                <p className="c-note">
                  <b>Ghi chú:</b> {detail.note}
                </p>
              )}
              {detail.status === "DRAFT" && (
                <div className="c-info">
                  Phiếu nháp chưa làm tăng tồn kho. Kiểm tra số lượng và đơn giá
                  trước khi ghi sổ.
                </div>
              )}
              {detail.status === "POSTED" && (
                <div className="c-posted">
                  <span className="c-check">✓</span>
                  <div>
                    <strong>Đã cập nhật tồn kho</strong>
                    <p>Phiếu đã ghi sổ được giữ nguyên để đối chiếu lịch sử.</p>
                    {detail.source_type === "OPENING_STOCK" ? (
                      <p>Tồn đầu kỳ không phát sinh công nợ nhà cung cấp.</p>
                    ) : (
                      costRead && (
                        <div className="c-payable">
                          {payable ? (
                            <p>
                              Công nợ phải trả:{" "}
                              <b>{money(payable.outstanding_vnd)}</b> · Chưa
                              phát sinh chi tiền
                            </p>
                          ) : (
                            <p>{payableState}</p>
                          )}
                          {checkedAt && (
                            <small>Kiểm tra lúc {date(checkedAt)}</small>
                          )}
                          <button
                            className="quiet"
                            onClick={() => void checkPayable()}
                          >
                            Kiểm tra công nợ
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      ) : (
        <section className="c-sheet">
          <div className="c-sheet-head">
            <div>
              <h2>{title}</h2>
              <p>
                {tab === "receipts"
                  ? "Theo dõi hàng nhận về theo từng địa điểm."
                  : tab === "suppliers"
                    ? "Thông tin đối tác cung ứng hàng hóa."
                    : "Quản lý mã hàng, đơn vị và giá bán thống nhất."}
              </p>
            </div>
            {writable && (
              <button
                className="button primary"
                onClick={() =>
                  open(
                    tab === "receipts"
                      ? "receipt"
                      : tab === "suppliers"
                        ? "supplier"
                        : section === "categories"
                          ? "category"
                          : "product",
                  )
                }
              >
                ＋{" "}
                {tab === "receipts"
                  ? "Lập phiếu nhập"
                  : tab === "suppliers"
                    ? "Thêm nhà cung cấp"
                    : section === "categories"
                      ? "Thêm nhóm hàng"
                      : "Thêm sản phẩm"}
              </button>
            )}
          </div>
          <div className="c-toolbar">
            <label className="c-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Tìm trong danh sách"
                placeholder={
                  tab === "products"
                    ? "Tìm tên, mã hàng, mã vạch…"
                    : tab === "receipts"
                      ? "Tìm mã phiếu, nhà cung cấp…"
                      : "Tìm tên, mã, số điện thoại…"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            {tab === "receipts" && (
              <select
                aria-label="Địa điểm nhập hàng"
                value={siteId}
                onChange={(e) => setSiteId(e.target.value)}
              >
                {!siteId && <option value="">Chọn địa điểm</option>}
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.status !== "ACTIVE" ? " (Tạm ngừng)" : ""}
                  </option>
                ))}
              </select>
            )}
            <select
              aria-label="Trạng thái danh sách"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">Tất cả trạng thái</option>
              {(tab === "receipts"
                ? ["DRAFT", "POSTED", "CANCELLED"]
                : ["ACTIVE", "INACTIVE"]
              ).map((s) => (
                <option key={s} value={s}>
                  {label[s]}
                </option>
              ))}
            </select>
            <button
              className="quiet"
              onClick={() => void load()}
              disabled={loading}
            >
              Tải lại
            </button>
          </div>
          {loading && !rows.length ? (
            <div className="c-empty" role="status">
              Đang tải dữ liệu…
            </div>
          ) : !rows.length ? (
            <div className="c-empty">
              <span className="c-empty-icon">▤</span>
              <h3>
                {search || filter
                  ? "Không tìm thấy kết quả"
                  : tab === "receipts" && !siteId
                    ? "Chọn địa điểm để xem phiếu"
                    : "Danh sách đang trống"}
              </h3>
              <p>
                {search || filter
                  ? "Thử từ khóa khác hoặc bỏ bộ lọc."
                  : writable
                    ? "Thêm bản ghi đầu tiên bằng nút phía trên."
                    : "Chưa có dữ liệu để hiển thị."}
              </p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table className="c-table">
                  <thead>
                    <tr>
                      {tab === "products" && section === "products" ? (
                        <>
                          <th>Sản phẩm</th>
                          <th>Nhóm hàng</th>
                          <th>Biến thể</th>
                        </>
                      ) : tab === "receipts" ? (
                        <>
                          <th>Phiếu nhập</th>
                          <th>Nhà cung cấp / Loại nhập</th>
                          <th className="number">Tổng tiền</th>
                        </>
                      ) : tab === "suppliers" ? (
                        <>
                          <th>Nhà cung cấp</th>
                          <th>Điện thoại</th>
                          <th>Địa chỉ</th>
                        </>
                      ) : (
                        <>
                          <th>Nhóm hàng</th>
                          <th>Mã nhóm</th>
                        </>
                      )}
                      <th>Trạng thái</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        {tab === "products" && section === "products" ? (
                          <>
                            <td>
                              <div className="c-product-cell">
                                <span className="c-item-icon">▤</span>
                                <button
                                  className="c-name"
                                  onClick={() => void show(row)}
                                >
                                  {row.name}
                                </button>
                              </div>
                            </td>
                            <td>{row.category_name ?? "Chưa phân nhóm"}</td>
                            <td>{row.sku_count} mã hàng</td>
                          </>
                        ) : tab === "receipts" ? (
                          <>
                            <td>
                              <button
                                className="c-name"
                                onClick={() => void show(row)}
                              >
                                {row.code}
                              </button>
                              <small className="c-under">
                                {date(row.created_at)}
                              </small>
                            </td>
                            <td>
                              {row.source_type === "OPENING_STOCK"
                                ? "Tồn đầu kỳ"
                                : row.supplier_name}
                            </td>
                            <td className="number">{money(row.total_vnd)}</td>
                          </>
                        ) : tab === "suppliers" ? (
                          <>
                            <td>
                              <strong>{row.name}</strong>
                              <small className="c-under">{row.code}</small>
                            </td>
                            <td>{row.phone ?? "—"}</td>
                            <td>{row.address ?? "—"}</td>
                          </>
                        ) : (
                          <>
                            <td>
                              <strong>{row.name}</strong>
                            </td>
                            <td>{row.code}</td>
                          </>
                        )}
                        <td>
                          <Badge value={row.status} />
                        </td>
                        <td>
                          {tab === "receipts" ||
                          (tab === "products" && section === "products") ? (
                            <button
                              className="quiet"
                              aria-label={"Xem " + (row.name ?? row.code)}
                              onClick={() => void show(row)}
                            >
                              Xem chi tiết →
                            </button>
                          ) : (
                            <div className="c-actions">
                              {tab === "suppliers" && (
                                <button
                                  className="quiet"
                                  onClick={() => open("history", row)}
                                >
                                  Lịch sử nhập
                                </button>
                              )}
                              {writable && (
                                <button
                                  className="quiet"
                                  onClick={() =>
                                    open(
                                      tab === "suppliers"
                                        ? "supplier"
                                        : "category",
                                      row,
                                    )
                                  }
                                >
                                  Chỉnh sửa
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="c-list-footer">
                <span>
                  Đã tải {rows.length}{" "}
                  {tab === "receipts"
                    ? "phiếu"
                    : tab === "suppliers"
                      ? "nhà cung cấp"
                      : section === "categories"
                        ? "nhóm hàng"
                        : "sản phẩm"}
                </span>
                {cursor && (
                  <button
                    className="button secondary"
                    disabled={loading}
                    onClick={() => void load(cursor)}
                  >
                    Xem thêm
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      )}
      {modal && (
        <dialog
          ref={modalRef}
          className={
            "c-dialog " +
            (["receipt", "history"].includes(modal) ? "c-wide" : "")
          }
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setModal("");
          }}
        >
          {modal === "history" ? (
            <SupplierHistory
              supplier={editing!}
              sites={sites}
              path={path}
              api={api}
              costRead={costRead}
              close={() => setModal("")}
            />
          ) : (
            <form onSubmit={submit}>
              <header>
                <div>
                  <span className="eyebrow">
                    {tab === "products"
                      ? "HÀNG HÓA"
                      : tab === "suppliers"
                        ? "ĐỐI TÁC"
                        : "NHẬP HÀNG"}
                  </span>
                  <h2>{modalTitles[modal]}</h2>
                </div>
                <button
                  type="button"
                  className="quiet"
                  aria-label="Đóng biểu mẫu"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  ×
                </button>
              </header>
              <fieldset disabled={busy} className="c-form-body">
                {[
                  "product",
                  "productEdit",
                  "category",
                  "supplier",
                  "unit",
                ].includes(modal) && (
                  <Field
                    label={
                      modal === "unit"
                        ? "Tên đơn vị"
                        : modal === "supplier"
                          ? "Tên nhà cung cấp"
                          : modal === "category"
                            ? "Tên nhóm hàng"
                            : "Tên sản phẩm"
                    }
                    name="name"
                    value={editing?.name}
                    maxLength={120}
                  />
                )}
                {["category", "supplier"].includes(modal) && !editing && (
                  <Field
                    label={modal === "category" ? "Mã nhóm" : "Mã nhà cung cấp"}
                    name="code"
                    pattern="[A-Za-z0-9_-]{2,64}"
                    maxLength={64}
                    placeholder="VD: NCC01"
                  />
                )}
                {modal === "supplier" && (
                  <>
                    <Field
                      label="Điện thoại"
                      name="phone"
                      value={editing?.phone}
                      required={false}
                      maxLength={30}
                    />
                    <Field
                      label="Địa chỉ"
                      name="address"
                      value={editing?.address}
                      required={false}
                      maxLength={300}
                    />
                  </>
                )}
                {["product", "productEdit"].includes(modal) && (
                  <>
                    <label className="c-field">
                      Tìm nhóm hàng
                      <input
                        type="search"
                        value={categoryQuery}
                        onChange={(e) => setCategoryQuery(e.target.value)}
                        placeholder="Nhập tên hoặc mã nhóm"
                      />
                    </label>
                    <label className="c-field">
                      Nhóm hàng
                      <select
                        aria-label="Nhóm hàng"
                        name="categoryId"
                        defaultValue={editing?.category_id ?? ""}
                      >
                        <option value="">Chưa phân nhóm</option>
                        {editing?.category_id &&
                          !categories.some(
                            (c) => c.id === editing.category_id,
                          ) && (
                            <option value={editing.category_id}>
                              Nhóm đang dùng
                            </option>
                          )}
                        {categories.map((c) => (
                          <option value={c.id} key={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {categoryMore && (
                      <button
                        type="button"
                        className="quiet"
                        onClick={() =>
                          void run(async () => {
                            const d = await api(
                              `${path}/categories?limit=50&status=ACTIVE&q=${encodeURIComponent(categoryQuery)}&cursor=${categoryMore}`,
                            );
                            setCategories([...categories, ...d.items]);
                            setCategoryMore(d.nextCursor);
                          })
                        }
                      >
                        Tải thêm nhóm
                      </button>
                    )}
                  </>
                )}
                {["product", "sku", "skuEdit"].includes(modal) && (
                  <>
                    <div className="c-form-divider">
                      {modal === "product"
                        ? "Mã hàng đầu tiên"
                        : "Thông tin mã hàng"}
                    </div>
                    <Field
                      label="Tên mã hàng"
                      name="skuName"
                      value={modal === "skuEdit" ? editing?.name : ""}
                      maxLength={120}
                    />
                    {modal !== "skuEdit" && (
                      <Field
                        label="Mã SKU"
                        name="code"
                        pattern="[A-Za-z0-9_-]{2,64}"
                        maxLength={64}
                        placeholder="VD: CF-250"
                      />
                    )}
                    <Field
                      label="Mã vạch"
                      name="barcode"
                      value={modal === "skuEdit" ? editing?.barcode : ""}
                      required={false}
                      maxLength={64}
                    />
                    {modal !== "skuEdit" && (
                      <>
                        <div className="c-form-grid">
                          <Field
                            label="Màu sắc (nếu có)"
                            name="color"
                            required={false}
                            maxLength={50}
                          />
                          <Field
                            label="Kích cỡ (nếu có)"
                            name="size"
                            required={false}
                            maxLength={50}
                          />
                        </div>
                        <div className="c-form-grid">
                          <Field
                            label="Đơn vị cơ sở"
                            name="baseUnit"
                            maxLength={30}
                            placeholder="VD: Gói"
                          />
                          <Field
                            label="Giá bán (₫)"
                            name="price"
                            value="0"
                            inputMode="numeric"
                            pattern="(0|[1-9][0-9]{0,19})"
                          />
                        </div>
                        <p className="c-help">
                          Mã SKU và đơn vị cơ sở được giữ cố định để đối chiếu
                          lịch sử.
                        </p>
                      </>
                    )}
                  </>
                )}
                {modal === "unit" && (
                  <>
                    <Field
                      label={
                        "1 đơn vị này bằng bao nhiêu " +
                        editing!.base_unit +
                        "?"
                      }
                      name="factor"
                      inputMode="decimal"
                      pattern="[0-9]+(\.[0-9]{1,3})?"
                    />
                    <Field
                      label="Giá bán theo đơn vị (₫)"
                      name="price"
                      value="0"
                      inputMode="numeric"
                      pattern="(0|[1-9][0-9]{0,19})"
                    />
                    <p className="c-help">
                      Hệ số quy đổi được cố định khi tạo. Nếu cần quy cách khác,
                      thêm đơn vị mới.
                    </p>
                  </>
                )}
                {modal === "price" && (
                  <>
                    <p className="c-help">
                      Đơn vị: <b>{editing!.name}</b>. Giá mới áp dụng cho các
                      thao tác tiếp theo, lịch sử giá được giữ lại.
                    </p>
                    <Field
                      label="Giá bán (₫)"
                      name="price"
                      value={editing!.price_vnd}
                      inputMode="numeric"
                      pattern="(0|[1-9][0-9]{0,19})"
                    />
                  </>
                )}
                {editing &&
                  [
                    "category",
                    "supplier",
                    "productEdit",
                    "skuEdit",
                    "price",
                  ].includes(modal) && <Status value={editing.status} />}
                {modal === "receipt" && (
                  <>
                    <div className="c-form-grid">
                      <label className="c-field">
                        Loại nhập
                        <select
                          aria-label="Loại nhập"
                          value={source}
                          onChange={(e) => setSource(e.target.value)}
                        >
                          <option value="PURCHASE">Mua từ nhà cung cấp</option>
                          {role === "OWNER" && (
                            <option value="OPENING_STOCK">Tồn đầu kỳ</option>
                          )}
                        </select>
                      </label>
                      <div className="c-field">
                        Nhập tại
                        <strong className="c-static">{activeSite?.name}</strong>
                      </div>
                    </div>
                    {source === "PURCHASE" && (
                      <>
                        <label className="c-field">
                          Tìm nhà cung cấp
                          <input
                            type="search"
                            value={supplierQuery}
                            onChange={(e) => setSupplierQuery(e.target.value)}
                            placeholder="Nhập tên hoặc mã nhà cung cấp"
                          />
                        </label>
                        <label className="c-field">
                          Nhà cung cấp
                          <select
                            aria-label="Nhà cung cấp"
                            value={supplierId}
                            onChange={(e) => setSupplierId(e.target.value)}
                            required
                          >
                            <option value="">Chọn nhà cung cấp</option>
                            {supplierId &&
                              !suppliers.some((s) => s.id === supplierId) && (
                                <option value={supplierId}>
                                  {editing?.supplier_name ??
                                    "Nhà cung cấp đã chọn"}
                                </option>
                              )}
                            {suppliers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} · {s.code}
                              </option>
                            ))}
                          </select>
                        </label>
                        {supplierMore && (
                          <button
                            type="button"
                            className="quiet"
                            onClick={() =>
                              void run(async () => {
                                const d = await api(
                                  `${path}/suppliers?limit=50&status=ACTIVE&q=${encodeURIComponent(supplierQuery)}&cursor=${supplierMore}`,
                                );
                                setSuppliers([...suppliers, ...d.items]);
                                setSupplierMore(d.nextCursor);
                              })
                            }
                          >
                            Tải thêm nhà cung cấp
                          </button>
                        )}
                      </>
                    )}
                    <div className="c-form-divider">Hàng nhận về</div>
                    <label className="c-field">
                      Tìm mã hàng
                      <input
                        type="search"
                        value={skuQuery}
                        onChange={(e) => setSkuQuery(e.target.value)}
                        placeholder="Tên hàng, mã SKU hoặc mã vạch…"
                      />
                    </label>
                    <div className="c-sku-picker">
                      {skus.map((s) => (
                        <button
                          type="button"
                          key={s.id}
                          disabled={
                            lines.some((l) => l.skuId === s.id) ||
                            lines.length >= 100
                          }
                          onClick={() => addLine(s)}
                        >
                          <span>
                            <b>{s.name}</b>
                            <small>
                              {s.code} · {s.base_unit}
                            </small>
                          </span>
                          <span>
                            {lines.some((l) => l.skuId === s.id)
                              ? "Đã thêm"
                              : "＋ Thêm"}
                          </span>
                        </button>
                      ))}
                      {!skus.length && <p>Không tìm thấy mã hàng đang dùng.</p>}
                      {skuMore && (
                        <button
                          type="button"
                          onClick={() =>
                            void run(async () => {
                              const d = await api(
                                `${path}/skus?limit=30&status=ACTIVE&q=${encodeURIComponent(skuQuery)}&cursor=${skuMore}`,
                              );
                              setSkus([...skus, ...d.items]);
                              setSkuMore(d.nextCursor);
                            })
                          }
                        >
                          Tải thêm mã hàng
                        </button>
                      )}
                    </div>
                    <div className="c-entry-lines">
                      {lines.map((l, i) => (
                        <div className="c-entry" key={l.skuId}>
                          <div className="c-entry-title">
                            <b>{l.name}</b>
                            <small>{l.code}</small>
                            <button
                              type="button"
                              className="quiet"
                              aria-label={"Bỏ " + l.name}
                              onClick={() =>
                                setLines(lines.filter((_, n) => n !== i))
                              }
                            >
                              ×
                            </button>
                          </div>
                          <div className="c-entry-fields">
                            <label className="c-field">
                              Đơn vị
                              <select
                                aria-label={"Đơn vị " + l.name}
                                value={l.unitId}
                                onChange={(e) =>
                                  changeLine(i, {
                                    unitId: e.target.value,
                                    unitName: l.units.find(
                                      (u: Row) => u.id === e.target.value,
                                    )?.name,
                                  })
                                }
                              >
                                {l.units.map((u: Row) => (
                                  <option key={u.id} value={u.id}>
                                    {u.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="c-field">
                              Số lượng
                              <input
                                aria-label={"Số lượng " + l.name}
                                value={l.qty}
                                required
                                inputMode="decimal"
                                pattern="[0-9]+(\.[0-9]{1,3})?"
                                onChange={(e) =>
                                  changeLine(i, { qty: e.target.value })
                                }
                              />
                            </label>
                            <label className="c-field">
                              Đơn giá nhập (₫)
                              <input
                                aria-label={"Đơn giá " + l.name}
                                value={l.unitCostVnd}
                                required
                                inputMode="numeric"
                                pattern="(0|[1-9][0-9]{0,19})"
                                onChange={(e) =>
                                  changeLine(i, { unitCostVnd: e.target.value })
                                }
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="c-total">
                      <span>Tổng dự tính</span>
                      <strong>
                        {preview
                          ? money(preview)
                          : "Kiểm tra số lượng, đơn giá"}
                      </strong>
                    </div>
                    <Field
                      label="Ghi chú"
                      name="note"
                      value={editing?.note}
                      required={false}
                      maxLength={500}
                    />
                    <p className="c-help">
                      Lưu nháp chưa tăng tồn. Đơn giá tính theo đơn vị đã chọn,
                      tiền làm tròn đến đồng.
                    </p>
                  </>
                )}
                {modal === "post" && (
                  <>
                    <p>
                      Ghi sổ <b>{detail?.code}</b> với tổng giá trị{" "}
                      <b>{money(detail?.total_vnd)}</b>?
                    </p>
                    <div className="c-info">
                      Tồn kho sẽ tăng theo số lượng trên phiếu.{" "}
                      {detail?.source_type === "PURCHASE"
                        ? "Khoản phải trả được đồng bộ sang sổ công nợ, chưa chi tiền."
                        : "Tồn đầu kỳ không tạo công nợ."}{" "}
                      Phiếu đã ghi sổ không thể sửa hoặc hủy.
                    </div>
                  </>
                )}
                {modal === "cancel" && (
                  <p>
                    Hủy phiếu nháp <b>{detail?.code}</b>? Phiếu được giữ trong
                    lịch sử và không làm thay đổi tồn kho.
                  </p>
                )}
              </fieldset>
              {error && (
                <div role="alert" className="alert error">
                  {error}
                </div>
              )}
              <footer>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => setModal("")}
                >
                  Đóng
                </button>
                <button className="button primary" disabled={busy}>
                  {busy
                    ? "Đang lưu…"
                    : modal === "receipt"
                      ? "Lưu phiếu nháp"
                      : modal === "post"
                        ? "Xác nhận ghi sổ"
                        : modal === "cancel"
                          ? "Xác nhận hủy"
                          : "Lưu thay đổi"}
                </button>
              </footer>
            </form>
          )}
        </dialog>
      )}
    </div>
  );
}
