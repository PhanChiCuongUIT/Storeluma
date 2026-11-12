import {t,locale,localizedLabels} from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import "./management.css";
type Row = Record<string, any>;
type Api = (
  path: string,
  method?: string,
  data?: unknown,
  key?: string,
) => Promise<any>;
type Props = { tenant: string; sites: Row[]; role: string; api: Api };
export type SourceLink = {
  screen: string;
  sourceId: string;
  siteId: string;
  code?: string;
};
const money = (v: any) =>
  new Intl.NumberFormat(locale()).format(BigInt(v ?? 0)) + " ₫";
const qty = (v: any) =>
  new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 }).format(
    Number(v ?? 0),
  );
const date = (v: string) =>
  new Date(v).toLocaleString(locale(), {
    dateStyle: "short",
    timeStyle: "short",
  });
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function Freshness({ value }: { value?: Row }) {
  return (
    <p
      className={"report-freshness " + (value?.stale ? "delayed" : "")}
      role="status"
    >
      <span className="dot" />
      {!value
        ? t("Đang tải dữ liệu…")
        : value.initializing
          ? t("Đang tổng hợp dữ liệu ban đầu.")
          : t("{0}Đã đối chiếu dữ liệu đến {1}.", [value.stale ? "Đồng bộ đang chậm. " : "", date(value.dataAsOf)])}
    </p>
  );
}
function SiteSelect({
  sites,
  value,
  onChange,
}: {
  sites: Row[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label>{t("Địa điểm")}<select
        aria-label={t("Địa điểm báo cáo")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("Tất cả địa điểm được giao")}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Metric({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className={"report-metric " + (accent ? "accent" : "")}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Pagination({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="report-pagination">
      <span>
        {total
          ? `${offset + 1}–${Math.min(offset + 50, total)} / ${total}`
          : t("0 kết quả")}
      </span>
      <button
        className="button secondary"
        disabled={!offset}
        onClick={() => onChange(Math.max(0, offset - 50))}
      >{t("Trước")}</button>
      <button
        className="button secondary"
        disabled={offset + 50 >= total}
        onClick={() => onChange(offset + 50)}
      >{t("Tiếp")}</button>
    </div>
  );
}
export function ReportsRoom({ tenant, sites, api }: Props) {
  const [from, setFrom] = useState(() => today().slice(0, 8) + "01"),
    [to, setTo] = useState(today),
    [siteId, setSite] = useState(""),
    [pane, setPane] = useState("sales");
  const [data, setData] = useState<Row | null>(null),
    [stock, setStock] = useState<Row | null>(null),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [revision, setRevision] = useState(0);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false),
    [job, setJob] = useState<Row | null>(null);
  const ref = useRef(api);
  ref.current = api;
  const mounted = useRef(true),
    busy = useRef(false),
    exportKey = useRef({ payload: "", key: "" });
  const path = `/v1/tenants/${tenant}`,
    filters = { from, to, ...(siteId ? { siteId } : {}) };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setOffset(0);
    setJob(null);
  }, [from, to, siteId, pane, query]);
  useEffect(() => {
    let alive = true;
    setData(null);
    setStock(null);
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      const p = new URLSearchParams({
        ...filters,
        ...(pane === "stock" ? { q: query, offset: String(offset) } : {}),
      });
      void ref
        .current(
          `${path}/reports/${pane === "stock" ? "stock" : "summary"}?${p}`,
        )
        .then((d) => {
          if (alive) {
            if (pane === "stock") setStock(d);
            else setData(d);
          }
        })
        .catch((e) => {
          if (alive) setError(e.message);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [from, to, siteId, pane, query, offset, revision, tenant]);
  async function exportFile() {
    if (busy.current) return;
    busy.current = true;
    setExporting(true);
    setError("");
    setJob(null);
    const payload = JSON.stringify({ kind: pane, filters, language: window.storelumaPreferences.language });
    if (exportKey.current.payload !== payload)
      exportKey.current = { payload, key: crypto.randomUUID() };
    try {
      const created = await ref.current(
        path + "/report-exports",
        "POST",
        JSON.parse(payload),
        exportKey.current.key,
      );
      exportKey.current = { payload: "", key: "" };
      for (let i = 0; i < 60 && mounted.current; i++) {
        const status = await ref.current(
          path + "/report-exports/" + created.id,
        );
        if (!mounted.current) return;
        if (status.status === "FAILED") throw new Error(status.error);
        if (status.status === "READY") {
          setJob(status);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(t("Tệp đang được xử lý lâu hơn dự kiến. Thử xuất lại sau."));
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      busy.current = false;
      if (mounted.current) setExporting(false);
    }
  }
  async function download() {
    try {
      const file = await ref.current(
        `${path}/report-exports/${job!.id}/download`,
      );
      const url = URL.createObjectURL(
        new Blob([file.csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const siteName = (id: string) =>
    sites.find((s) => s.id === id)?.name ?? t("Địa điểm");
  const totals = data?.totals,
    max = Math.max(
      1,
      ...(data?.daily ?? []).flatMap((r: Row) => [
        Number(r.sales_vnd),
        Number(r.returns_vnd),
      ]),
    );
  return (
    <section className="management-room" aria-label={t("Báo cáo kinh doanh")}>
      <div className="report-tabs" role="group" aria-label={t("Loại báo cáo")}>
        {[
          ["sales", t("Kết quả bán hàng")],
          ["stock", t("Tồn kho hiện tại")],
          ["cash", t("Thu chi tại quầy")],
        ].map(([k, n]) => (
          <button
            key={k}
            aria-pressed={pane === k}
            className={pane === k ? "active" : ""}
            onClick={() => setPane(k)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="report-toolbar">
        <SiteSelect sites={sites} value={siteId} onChange={setSite} />
        {pane !== "stock" && (
          <>
            <label>{t("Từ ngày")}<input
                aria-label={t("Từ ngày báo cáo")}
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>{t("Đến ngày")}<input
                aria-label={t("Đến ngày báo cáo")}
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
        <div className="report-actions">
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => setRevision((n) => n + 1)}
          >{t("Làm mới")}</button>
          <button
            className="button primary"
            disabled={
              exporting ||
              loading ||
              (!data && !stock) ||
              (data ?? stock)?.freshness.initializing
            }
            onClick={() => void exportFile()}
          >
            {exporting ? t("Đang xuất…") : t("Xuất CSV")}
          </button>
          {job && (
            <button
              className="button secondary"
              onClick={() => void download()}
            >{t("Tải tệp CSV")}</button>
          )}
        </div>
      </div>
      <Freshness value={(data ?? stock)?.freshness} />
      {error && (
        <p role="alert" className="alert error">
          {t(error)}
        </p>
      )}
      {loading && <div className="report-empty">{t("Đang tải báo cáo…")}</div>}
      {data && pane === "sales" && (
        <>
          <div className="report-metrics">
            <Metric
              label={t("Doanh thu thuần")}
              value={money(totals.revenue_vnd)}
              note={t("Sau giảm giá và trả hàng")}
              accent
            />
            <Metric
              label={t("Bán hàng")}
              value={money(totals.sales_vnd)}
              note={t("{0} đơn hoàn tất", [totals.orders])}
            />
            <Metric
              label={t("Trả hàng")}
              value={money(totals.returns_vnd)}
              note={t("{0} phiếu hoàn tất", [totals.returns])}
            />
            {data.costVisible ? (
              <Metric
                label={t("Lãi gộp")}
                value={money(totals.profit_vnd)}
                note={t("Giá vốn thuần {0}", [money(totals.cost_vnd)])}
              />
            ) : (
              <Metric
                label={t("Giảm giá")}
                value={money(totals.discount_vnd)}
                note={t("Trong các đơn hoàn tất")}
              />
            )}
          </div>
          <section className="report-card">
            <div className="report-card-heading">
              <div>
                <h2>{t("Bán hàng theo ngày")}</h2>
                <p>{t("Ghi nhận theo ngày hoàn tất • Giờ Việt Nam")}</p>
              </div>
              <div className="chart-legend">
                <span>{t("Bán hàng")}</span>
                <span>{t("Trả hàng")}</span>
              </div>
            </div>
            <div
              className="report-chart"
              aria-label={t("Biểu đồ bán hàng và trả hàng")}
            >
              <div className="report-chart-bars">
                {data.daily.map((r: Row) => (
                  <div
                    className="report-day"
                    key={r.day}
                    title={t("{0}: bán {1}, trả {2}", [r.day, money(r.sales_vnd), money(r.returns_vnd)])}
                  >
                    <div className="report-bar-pair">
                      <i
                        style={{
                          height: `${(Number(r.sales_vnd) / max) * 100}%`,
                        }}
                      />
                      <i
                        style={{
                          height: `${(Number(r.returns_vnd) / max) * 100}%`,
                        }}
                      />
                    </div>
                    <small>
                      {r.day.slice(8)}/{r.day.slice(5, 7)}
                    </small>
                  </div>
                ))}
              </div>
            </div>
            <details className="report-daily">
              <summary>{t("Xem số liệu từng ngày")}</summary>
              <div className="report-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Ngày")}</th>
                      <th>{t("Bán hàng")}</th>
                      <th>{t("Trả hàng")}</th>
                      <th>{t("Thuần")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.daily.map((r: Row) => (
                      <tr key={r.day}>
                        <td>{r.day}</td>
                        <td>{money(r.sales_vnd)}</td>
                        <td>{money(r.returns_vnd)}</td>
                        <td>{money(r.revenue_vnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <div className="report-columns">
            <section className="report-card">
              <div className="report-card-heading">
                <h2>{t("Hàng bán nổi bật")}</h2>
                <small>{t("Theo doanh thu thuần")}</small>
              </div>
              <div className="report-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Hàng hóa")}</th>
                      <th>{t("Số lượng thuần")}</th>
                      <th>{t("Doanh thu")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top.map((r: Row) => (
                      <tr key={r.sku_id}>
                        <td>
                          <strong>{r.name}</strong>
                          <small>{r.code}</small>
                        </td>
                        <td>
                          {qty(r.qty_base)} {r.base_unit}
                        </td>
                        <td>{money(r.revenue_vnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.top.length && (
                  <p className="report-empty">{t("Chưa có bán hàng hoặc trả hàng trong kỳ.")}</p>
                )}
              </div>
            </section>
            <section className="report-card">
              <div className="report-card-heading">
                <h2>{t("Theo địa điểm")}</h2>
              </div>
              <div className="report-table">
                <table>
                  <thead>
                    <tr>
                      <th>{t("Địa điểm")}</th>
                      <th>{t("Đơn")}</th>
                      <th>{t("Doanh thu")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySite.map((r: Row) => (
                      <tr key={r.site_id}>
                        <td>{siteName(r.site_id)}</td>
                        <td>{r.orders}</td>
                        <td>{money(r.revenue_vnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.bySite.length && (
                  <p className="report-empty">{t("Chưa có giao dịch hoàn tất.")}</p>
                )}
              </div>
            </section>
          </div>
        </>
      )}
      {stock && pane === "stock" && (
        <>
          <div className="report-metrics">
            <Metric
              label={t("Dòng hàng theo địa điểm")}
              value={String(stock.total)}
              note={t("Theo bộ lọc hiện tại")}
              accent
            />
            {stock.totals.value_vnd !== undefined && (
              <Metric
                label={t("Giá trị tồn")}
                value={money(stock.totals.value_vnd)}
                note={t("Gồm hàng cách ly; theo giá vốn")}
              />
            )}
          </div>
          <section className="report-card">
            <div className="report-card-heading">
              <div>
                <h2>{t("Tồn kho hiện tại")}</h2>
                <p>{t("Khả dụng = tồn thực tế − đang giữ − cách ly.")}</p>
              </div>
              <input
                type="search"
                aria-label={t("Tìm hàng trong báo cáo")}
                placeholder={t("Tìm tên hoặc mã hàng…")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="report-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("Hàng hóa")}</th>
                    <th>{t("Địa điểm")}</th>
                    <th>{t("Đơn vị")}</th>
                    <th>{t("Tồn thực tế")}</th>
                    <th>{t("Đang giữ")}</th>
                    <th>{t("Cách ly")}</th>
                    <th>{t("Khả dụng")}</th>
                    {stock.totals.value_vnd !== undefined && (
                      <th>{t("Giá trị tồn")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {stock.items.map((r: Row) => (
                    <tr key={r.id}>
                      <td>
                        <strong>{r.name}</strong>
                        <small>{r.code}</small>
                      </td>
                      <td>{siteName(r.site_id)}</td>
                      <td>{r.base_unit}</td>
                      <td>{qty(r.on_hand)}</td>
                      <td>{qty(r.reserved)}</td>
                      <td>{qty(r.quarantined)}</td>
                      <td>{qty(r.available)}</td>
                      {r.value_vnd !== undefined && (
                        <td>{money(r.value_vnd)}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!stock.items.length && (
                <p className="report-empty">{t("Không có hàng phù hợp.")}</p>
              )}
            </div>
            <Pagination
              offset={offset}
              total={stock.total}
              onChange={setOffset}
            />
          </section>
        </>
      )}
      {data && pane === "cash" && (
        <>
          <div className="report-metrics">
            <Metric
              label={t("Thu bán hàng")}
              value={money(data.cash.totals.receipts_vnd)}
              note={t("Các khoản thu đã ghi sổ")}
              accent
            />
            <Metric
              label={t("Hoàn tiền khách")}
              value={money(data.cash.totals.refunds_vnd)}
              note={t("Các khoản hoàn đã ghi sổ")}
            />
            <Metric
              label={t("Thu khác / chi khác")}
              value={money(data.cash.totals.other_in_vnd)}
              note={t("Chi khác {0}", [money(data.cash.totals.other_out_vnd)])}
            />
            <Metric
              label={t("Dòng tiền thuần")}
              value={money(data.cash.totals.net_vnd)}
              note={t("Không gồm tiền đầu ca")}
            />
          </div>
          <section className="report-card">
            <div className="report-card-heading">
              <div>
                <h2>{t("Thu chi theo ngày")}</h2>
                <p>{t("Dòng tiền tại quầy theo ngày ghi sổ. Doanh thu được trình bày riêng trong kết quả bán hàng.")}</p>
              </div>
            </div>
            <div className="report-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("Ngày")}</th>
                    <th>{t("Thu bán")}</th>
                    <th>{t("Hoàn khách")}</th>
                    <th>{t("Thu khác")}</th>
                    <th>{t("Chi khác")}</th>
                    <th>{t("Thuần")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cash.daily.map((r: Row) => (
                    <tr key={r.day}>
                      <td>{r.day}</td>
                      {[
                        "receipts_vnd",
                        "refunds_vnd",
                        "other_in_vnd",
                        "other_out_vnd",
                        "net_vnd",
                      ].map((k) => (
                        <td key={k}>{money(r[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.cash.daily.length && (
                <p className="report-empty">{t("Chưa có thu chi trong kỳ.")}</p>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
const kinds: Record<string, string> = localizedLabels({
  LOW_STOCK: "Sắp hết hàng",
  PAYMENT_PENDING: "Chờ thu tiền",
  REFUND_PENDING: "Chờ hoàn tiền",
  ORDER_REVIEW: "Đối chiếu đơn",
  RETURN_APPROVAL: "Duyệt trả hàng",
  SHIFT_VARIANCE: "Chênh lệch ca",
});
const statuses: Record<string, string> = localizedLabels({
  ACTIVE: "Đang cần xử lý",
  OPEN: "Chưa tiếp nhận",
  ACKNOWLEDGED: "Đã tiếp nhận",
  RESOLVED: "Đã giải quyết",
  ALL: "Tất cả",
});
export function WorkRoom({
  tenant,
  sites,
  role,
  api,
  onOpen,
}: { onOpen: (link: SourceLink) => void } & Props) {
  const [siteId, setSite] = useState(""),
    [status, setStatus] = useState("ACTIVE"),
    [kind, setKind] = useState(""),
    [offset, setOffset] = useState(0),
    [data, setData] = useState<Row | null>(null),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [rules, setRules] = useState(false);
  const ref = useRef(api);
  ref.current = api;
  const path = `/v1/tenants/${tenant}`;
  useEffect(() => setOffset(0), [siteId, status, kind]);
  useEffect(() => {
    let alive = true,
      inFlight = false;
    setData(null);
    setError("");
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const q = new URLSearchParams({
          status,
          offset: String(offset),
          ...(siteId ? { siteId } : {}),
          ...(kind ? { kind } : {}),
        });
        const d = await ref.current(path + "/work-items?" + q);
        if (alive) {
          setData(d);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setData(null);
        }
      } finally {
        inFlight = false;
      }
    };
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tenant, siteId, status, kind, offset, revision]);
  async function acknowledge(item: Row) {
    setBusy(true);
    setError("");
    try {
      await ref.current(
        `${path}/work-items/${item.id}/acknowledge`,
        "POST",
        { version: item.version },
        crypto.randomUUID(),
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="management-room" aria-label={t("Công việc cần xử lý")}>
      <div className="report-metrics">
        <Metric
          label={t("Chưa tiếp nhận")}
          value={String(data?.counts.open ?? "—")}
          note={t("Cần phân công xử lý")}
          accent
        />
        <Metric
          label={t("Đã tiếp nhận")}
          value={String(data?.counts.acknowledged ?? "—")}
          note={t("Theo dõi đến khi hoàn tất")}
        />
        <Metric
          label={t("Đã giải quyết")}
          value={String(data?.counts.resolved ?? "—")}
          note={t("Đối chiếu từ chứng từ nguồn")}
        />
      </div>
      <div className="report-toolbar">
        <SiteSelect sites={sites} value={siteId} onChange={setSite} />
        <label>{t("Trạng thái")}<select
            aria-label={t("Trạng thái công việc")}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {Object.entries(statuses).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>{t("Loại công việc")}<select
            aria-label={t("Loại công việc")}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{t("Tất cả loại")}</option>
            {Object.entries(kinds).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="report-actions">
          <button
            className="button secondary"
            onClick={() => setRevision((n) => n + 1)}
          >{t("Làm mới")}</button>
          {["OWNER", "MANAGER"].includes(role) && (
            <button
              className="button secondary"
              aria-expanded={rules}
              onClick={() => setRules((v) => !v)}
            >{t("Cấu hình nhắc việc")}</button>
          )}
        </div>
      </div>
      {rules && (
        <Rules
          key={tenant}
          path={path}
          sites={sites}
          api={api}
          onSaved={() => setRevision((n) => n + 1)}
        />
      )}
      <Freshness value={data?.freshness} />
      {error && (
        <p className="alert error" role="alert">
          {t(error)}
        </p>
      )}
      <section className="report-card">
        <div className="report-card-heading">
          <div>
            <h2>{t("Danh sách công việc")}</h2>
            <p>{t("Tiếp nhận để theo dõi. Công việc tự khép lại khi chứng từ hoặc tồn kho được xử lý.")}</p>
          </div>
          <small>{data?.total ?? 0}{" "+t("công việc")}</small>
        </div>
        {data?.items.map((item: Row) => (
          <article className="work-item" key={item.id}>
            <span className={"work-symbol " + item.kind.toLowerCase()}>
              {item.kind === "LOW_STOCK"
                ? "↓"
                : item.kind === "SHIFT_VARIANCE"
                  ? "±"
                  : "•"}
            </span>
            <div className="work-body">
              <div className="work-tags">
                <span>{kinds[item.kind]}</span>
                <span className={"work-status " + item.status.toLowerCase()}>
                  {statuses[item.status]}
                </span>
              </div>
              <h3>{t(item.title)}</h3>
              <p>
                {sites.find((s) => s.id === item.site_id)?.name ?? t("Địa điểm")} ·{" "}
                {date(item.created_at)}
              </p>
              {item.kind === "LOW_STOCK" && (
                <p>{t("Khả dụng")+" "}{qty(item.detail.available)} {item.detail.baseUnit}{" "+t("· Ngưỡng nhắc")+" "}{qty(item.detail.threshold)}
                </p>
              )}
              {item.detail.amountVnd && (
                <p>{t("Số tiền")+" "}{money(item.detail.amountVnd)}</p>
              )}
              {item.detail.differenceVnd && (
                <p>{t("Chênh lệch")+" "}{money(item.detail.differenceVnd)}</p>
              )}
            </div>
            <div className="work-actions">
              <button
                className="button secondary"
                onClick={() => onOpen({ ...item.detail, siteId: item.site_id })}
              >{t("Mở")+" "}{item.kind === "LOW_STOCK" ? t("tồn kho") : t("chứng từ")}
              </button>
              {item.status === "OPEN" && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void acknowledge(item)}
                >{t("Tiếp nhận")}</button>
              )}
            </div>
          </article>
        ))}
        {data && !data.items.length && (
          <div className="report-empty">
            <strong>{t("Không có công việc phù hợp")}</strong>
            <p>{t("Các phát sinh mới sẽ xuất hiện tại đây theo phạm vi được giao.")}</p>
          </div>
        )}
        {!data && !error && <p className="report-empty">{t("Đang tải công việc…")}</p>}
        {data && (
          <Pagination offset={offset} total={data.total} onChange={setOffset} />
        )}
      </section>
    </section>
  );
}
function Rules({
  path,
  sites,
  api,
  onSaved,
}: {
  path: string;
  sites: Row[];
  api: Api;
  onSaved: () => void;
}) {
  const [site, setSite] = useState(sites[0]?.id ?? ""),
    [rule, setRule] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false);
  const ref = useRef(api);
  ref.current = api;
  useEffect(() => {
    let alive = true;
    setRule(null);
    setSaved(false);
    setError("");
    if (site)
      void ref
        .current(path + "/notification-rules?siteId=" + site)
        .then((r) => {
          if (alive) setRule(r);
        })
        .catch((e) => {
          if (alive) setError(e.message);
        });
    return () => {
      alive = false;
    };
  }, [site, path]);
  return (
    <form
      className="report-card rule-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!rule || busy) return;
        setBusy(true);
        setError("");
        setSaved(false);
        void api(
          `${path}/notification-rules/${site}`,
          "PATCH",
          {
            lowStock: rule.low_stock,
            pendingMinutes: Number(rule.pending_minutes),
            version: rule.version,
          },
          crypto.randomUUID(),
        )
          .then((r) => {
            setRule(r);
            setSaved(true);
            onSaved();
          })
          .catch((e) => setError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      <h2>{t("Cấu hình nhắc việc")}</h2>
      <p>{t("Ngưỡng tồn áp dụng theo đơn vị cơ sở của từng hàng. Khoản thu hoặc hoàn quá thời gian chờ sẽ được nhắc.")}</p>
      <div className="report-toolbar">
        <label>{t("Địa điểm cấu hình")}<select
            aria-label={t("Địa điểm cấu hình")}
            value={site}
            onChange={(e) => setSite(e.target.value)}
            disabled={busy}
          >
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        {rule && (
          <>
            <label>{t("Ngưỡng tồn khả dụng")}<input
                aria-label={t("Ngưỡng tồn khả dụng")}
                required
                type="number"
                min="0"
                max="999999999999"
                step="0.001"
                value={rule.low_stock}
                onChange={(e) =>
                  setRule({ ...rule, low_stock: e.target.value })
                }
              />
            </label>
            <label>{t("Thời gian chờ (phút)")}<input
                aria-label={t("Thời gian chờ")}
                required
                type="number"
                min="1"
                max="1440"
                value={rule.pending_minutes}
                onChange={(e) =>
                  setRule({ ...rule, pending_minutes: e.target.value })
                }
              />
            </label>
            <button className="button primary" disabled={busy} type="submit">{t("Lưu cấu hình")}</button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="alert error">
          {t(error)}
        </p>
      )}
      {saved && (
        <p role="status" className="alert success">{t("Đã lưu cấu hình nhắc việc.")}</p>
      )}
    </form>
  );
}
