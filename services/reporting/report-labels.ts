/** Authored export labels only; source data must never be passed to this function. */
const english:Record<string,string>={
  "Mã hàng": "SKU",
  "Tên hàng": "Item name",
  "Đơn vị": "Unit",
  "Địa điểm": "Location",
  "Tồn thực tế": "On hand",
  "Đang giữ": "Reserved",
  "Cách ly": "Quarantine",
  "Khả dụng": "Available",
  "Giá trị tồn VND": "Stock value VND",
  "Ngày": "Date",
  "Thu bán VND": "Sales collected VND",
  "Hoàn khách VND": "Customer refunds VND",
  "Thu khác VND": "Other cash in VND",
  "Chi khác VND": "Other cash out VND",
  "Dòng tiền thuần VND": "Net cash flow VND",
  "Bán hàng VND": "Sales VND",
  "Trả hàng VND": "Returns VND",
  "Doanh thu thuần VND": "Net revenue VND",
  "Tổng doanh thu thuần VND": "Total net revenue VND",
  "Giá vốn thuần VND": "Net cost of goods sold VND",
  "Lãi gộp VND": "Gross profit VND",
  "Múi giờ": "Time zone",
  "Dữ liệu được đối chiếu đến": "Data reconciled through",
  "Đang đồng bộ": "Syncing"
};
export const exportLabel=(text:string,language?:string)=>language==="en"?(english[text]??text):text;
