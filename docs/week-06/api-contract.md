# Hợp đồng tồn kho và kiểm kho

API qua Gateway, tiền tố `/v1/tenants/:tenant`. JWT chỉ được Gateway chuyển đến dịch vụ; trình duyệt dùng phiên BFF và CSRF. Mọi command cần `Idempotency-Key` và kiểm quyền hiện tại qua Business. Mọi cập nhật phiếu cần `version`; version cũ trả 409. Số lượng dạng chuỗi, tối đa 3 số thập phân; tiền là chuỗi số nguyên đồng không âm. Mỗi phiếu có 1-100 SKU không trùng, dùng đơn vị cơ sở và lý do 5-500 ký tự.

## Tra cứu

| API | Đầu vào và kết quả |
| --- | --- |
| `GET /stock-balances` | `siteId` bắt buộc; `skuId`, `q`, `filter`, `cursor`, `limit` tùy chọn. Filter: ALL/AVAILABLE/EMPTY/QUARANTINED/FROZEN. Trả on_hand/reserved/quarantined/available, frozen_by, thông tin SKU và dataAsOf. |
| `GET /stock-movements` | `siteId`; lọc skuId/q/type/from/to. Type RECEIPT/COUNT/ADJUSTMENT; from/to là ISO timestamp. Phân trang theo thời gian và sequence, cursor opaque. |
| `GET /stock-counts`, `/stock-adjustments` | `siteId`; q/status/cursor/limit; trả danh sách chứng từ và số dòng. |
| `GET /stock-counts/:id`, `/stock-adjustments/:id` | Kiểm hộ và quyền site của chứng từ trước khi trả chi tiết. |

Danh sách tồn chứa SKU đã có balance từ nhập, kiểm hoặc điều chỉnh. SKU chưa có balance vẫn có thể được tìm từ Catalog để lập phiếu. `available = on_hand - reserved - quarantined`. Trạng thái đang kiểm hiển thị riêng; available dương không cho phép bỏ qua kiểm tra freeze khi ghi tồn.

Movement lưu nguồn, mã chứng từ, snapshot tên/mã/đơn vị, lý do, lượng và giá trị trước/sau, delta và cách ly trước/sau. CASHIER có `canOpenSource=false`; API chứng từ cũng kiểm quyền độc lập, không chỉ ẩn nút trên UI. Các trường `inventory_value`, `avg_cost`, `value_vnd`, `value_before`, `value_after`, `value_delta`, `unit_cost_vnd` bị loại khỏi phản hồi khi không có quyền xem vốn.

## Phiếu kiểm

| Command | Nội dung / điều kiện |
| --- | --- |
| `POST /stock-counts` | `{siteId, warehouseId, note, lines:[{skuId}]}` → DRAFT, chưa khóa và chưa đổi tồn. |
| `POST /stock-counts/:id/start` | `{version}`; DRAFT → COUNTING. Khóa toàn scope, snapshot số lượng/cách ly/version và tạo freeze nguyên tử. |
| `PATCH /stock-counts/:id/lines` | `{version,note,lines:[{skuId,good,quarantined,unitCostVnd?}]}`; nhập đủ scope đã chọn, không tự đổi tồn. |
| `POST /stock-counts/:id/submit` | `{version}`; đủ số đếm mới chuyển COUNTING → SUBMITTED; vẫn khóa. |
| `POST /stock-counts/:id/reopen` | `{version}`; người duyệt yêu cầu đếm lại: SUBMITTED → COUNTING, giữ freeze/snapshot. |
| `POST /stock-counts/:id/approve` | `{version}`; SUBMITTED → POSTED. Kiểm freeze còn thuộc phiếu, snapshot version và reservation; ghi một movement/dòng, balance, audit, Outbox, mở khóa cùng transaction. |
| `POST /stock-counts/:id/cancel` | `{version}`; nháp/đang kiểm/chờ duyệt → CANCELLED. Gỡ freeze, không thay đổi tồn. |

Tồn sau duyệt bằng good + quarantined. Tăng từ tồn bằng 0 bắt buộc nhập vốn được duyệt; khi còn tồn có thể dùng vốn hiện hành. Dòng không chênh tổng vẫn có movement để ghi thay đổi phân loại hoặc lần xác nhận kiểm. POSTED không sửa/hủy. Duyệt lặp sau ghi sổ trả chứng từ hiện có, không ghi lại movement. Hủy được phép tại site tạm ngừng để tránh giữ khóa vô hạn; các thao tác ghi nghiệp vụ khác yêu cầu site ACTIVE.

## Điều chỉnh

`POST /stock-adjustments`: `{siteId,warehouseId,note,adjustmentType,lines:[{skuId,qty,direction?,unitCostVnd?,qualityConfirmed?}]}` → DRAFT. `PATCH /stock-adjustments/:id/lines` sửa lý do/lượng/thông tin dòng với version, giữ scope/loại phiếu. `POST /:id/post` ghi sổ; `POST /:id/cancel` hủy nháp. Đường đầy đủ đều dưới `/stock-adjustments`.

| Loại | Tác động |
| --- | --- |
| WRITE_OFF_GOOD | Giảm onHand, không lấy hàng reserved hoặc quarantined. |
| WRITE_OFF_QUARANTINE | Giảm onHand và quarantined, không vượt hàng cách ly. |
| QUARANTINE | Tăng quarantined trong phần hàng tốt chưa reserved; giữ onHand và giá trị. |
| RELEASE_QUARANTINE | Giảm quarantined, giữ onHand/giá trị; qualityConfirmed bắt buộc true. |
| CORRECTION | INCREASE/DECREASE, lượng dương. Tăng dùng unitCostVnd hoặc vốn hiện hành; từ tồn 0 bắt buộc vốn. Giảm không dùng reserved/cách ly. |

Vốn xuất được tính từ giá trị hiện hành chia lượng hiện hành, nhân lượng giảm rồi làm tròn HALF_UP đến đồng; trừ khỏi giá trị đang có. Xuất hết đưa giá trị và avgCost về 0. Tăng cộng giá trị được làm tròn; tính lại avgCost 6 chữ số. PostgreSQL numeric thực hiện phép tính, không dùng Number của JavaScript. UI dùng fixed-point cho xem trước chênh lệch. Không gửi `unitCostVnd` khi sửa nghĩa là giữ giá đã có; gửi null xóa giá chỉ định để dùng quy tắc mặc định. Điều này tránh xóa vốn bị ẩn khi người không có cost.read sửa số lượng.

## Phân quyền

| Vai trò | Tra tồn/thẻ | Đọc phiếu kho | Lập/sửa/bắt đầu/gửi/hủy | Duyệt/đếm lại | Xem vốn |
| --- | --- | --- | --- | --- | --- |
| OWNER | Toàn hộ | Toàn hộ | Có | Có | Có |
| MANAGER | Site được giao | Site được giao | Có | Có | Không |
| STOCK | Site được giao | Site được giao | Phiếu của mình | Không | Không |
| ACCOUNTANT | Site được giao | Site được giao | Không | Không | Có |
| CASHIER | Site được giao | Không | Không | Không | Không |

Các action riêng tại Business: `stock.count.read/write/approve/cancel`, `stock.adjust.read/write/approve/cancel`. Không dùng quyền ghi sổ nhập thay quyền duyệt kho. API sai hộ/site không trả chứng từ. Quyền bị thu hồi có hiệu lực với phiên hiện có qua authorize.

## Sở hữu dữ liệu và đồng thời

Inventory sở hữu `stock_documents`, `stock_document_lines`, `stock_freezes`, balance và movement. Catalog cung cấp snapshot SKU qua API nội bộ có chữ ký dịch vụ, không truy vấn chéo database. Finance không tạo payable từ kiểm kho hoặc điều chỉnh.

Các lệnh thay đổi tồn dùng khóa transaction theo tenant/warehouse/SKU và khóa hàng balance; nhiều SKU lấy khóa theo UUID tăng dần. Khóa advisory bảo vệ cả SKU chưa có balance. Nhập, bắt đầu kiểm, hủy, duyệt và điều chỉnh cùng dùng giao thức này. Freeze được kiểm dưới khóa; không kiểm ngoài transaction rồi ghi sau. Reservation > 0 chặn bắt đầu kiểm. Chưa có nghiệp vụ vận chuyển; khi bổ sung phải thêm điều kiện chứng từ đang xử lý vào cùng giao thức.

Lỗi nghiệp vụ có mã `STOCK_FROZEN`, `STOCK_RESERVED`, `INSUFFICIENT_STOCK` và message tiếng Việt riêng. UI chỉ hiển thị message. Sai dữ liệu 400; không có quyền 403 hoặc không tìm thấy scope 404; xung đột/trạng thái/thiếu tồn 409; phụ thuộc chưa sẵn sàng 503. Không có cơ chế bỏ qua quyền khi Business ngừng.

Migration 003 giữ nguyên receipt/line, mở rộng nguồn movement sang COUNT/ADJUSTMENT. Dữ liệu trước nâng cấp được tái lập số dư theo created_at/id và gắn `reconstructed=true`; UI ghi rõ số dư lịch sử tái lập. Không coi thứ tự tái lập là bằng chứng thứ tự commit cũ. Movement mới lưu số trước/sau từ hàng đã khóa. Tổng lượng/giá trị vẫn phải khớp balance. Sự kiện `inventory.stock-changed.v1` giữ schema hiện tại và dùng document ID làm correlationId; được lưu cùng transaction rồi publish qua Outbox, chờ consumer tương lai trong deferred queue. Chưa tuyên bố có Reporting.
