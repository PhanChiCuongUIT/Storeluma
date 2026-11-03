# POS, trả hàng và đối chiếu ca

## Ranh giới dịch vụ

| Dịch vụ | Trách nhiệm |
| --- | --- |
| Business | Quyền theo hộ/site và chính sách tách người duyệt |
| Catalog | Tìm SKU/mã vạch và báo giá hiện hành |
| Sales | Snapshot đơn, biên nhận, yêu cầu trả, phân bổ tiền/vốn và ReturnSaga |
| Inventory | Nhận hàng trả, số lượng cách ly, giá trị tồn và movement RETURN |
| Finance | Refund, tiền thực chi, ca, cash entry, ledger và xác nhận chênh lệch |

Không có truy vấn hoặc khóa ngoại xuyên database. Gateway chặn toàn bộ namespace nội bộ. Lệnh workflow có chữ ký ràng buộc caller, audience, tenant, method, path và body hash; Sales cho Inventory/Finance truy vấn phiếu đã duyệt. Mỗi bước ghi nghiệp vụ và Outbox trong transaction của chính dịch vụ; network call ở ngoài transaction.

## Trả hàng và tiền hoàn

Return có trạng thái REQUESTED → APPROVED → REFUND_PENDING → COMPLETED; chỉ REQUESTED được CANCELLED. Đơn bán gốc luôn giữ COMPLETED. Sales khóa order khi phân bổ lượng; một đơn chỉ có một phiếu trả đang xử lý. Quy tắc này ngăn hai yêu cầu cùng chiếm lượng và giữ thứ tự tính phần lẻ. Phiếu đã hủy không chiếm lượng.

Mỗi dòng chỉ xuất hiện một lần trên phiếu. Lượng trả dùng đơn vị bán gốc, quy đổi chính xác tối đa ba chữ số lẻ. Tiền hoàn là chênh lệch số làm tròn HALF_UP giữa lũy kế sau và trước: `round(net × returnedAfter / sold) - round(net × returnedBefore / sold)`. Vốn dùng cùng phép tính trên snapshot cost gốc; lần trả cuối nhận phần dư. Giá và giảm giá Catalog hiện tại không tham gia tính lại tiền hoàn.

OWNER/MANAGER duyệt; CASHIER chỉ lập yêu cầu. Khi có từ hai người đủ quyền duyệt trong site, người duyệt phải khác người lập. OWNER là người đủ quyền duyệt duy nhất được tự duyệt và có audit riêng. Quá hạn mặc định bảy ngày tính khi lập yêu cầu cần lý do duyệt ngoại lệ. Request chưa duyệt có thể hủy; phiếu đã nhận hàng không được hủy để đảo hàng vật lý.

Inventory lấy nội dung đã duyệt từ Sales, khóa theo tenant/warehouse/SKU như nhập hàng và kiểm kho. SKU đang freeze giữ phiếu APPROVED chờ thử lại. Nhận SELLABLE tăng lượng có thể bán; QUARANTINE tăng tồn và cách ly, giữ vốn đến khi xử lý chất lượng/xuất hủy. Mỗi returnId được nhận đúng một lần; movement có dòng nguồn và liên kết về đơn bán.

Finance chỉ tạo refund sau khi xác minh phiếu duyệt và chứng từ nhận kho. Khóa payment gốc khi kiểm tổng refund đã thành công hoặc đang chờ; tổng không vượt số thực thu. Refund PENDING chưa tự sinh tiền chi. Người dùng chọn ca OPEN bằng bước prepare rồi xác nhận `cashPaid:true` sau khi giao tiền thật. Refund có thể thuộc ca mới khác ca bán gốc, nhưng phải cùng site. Tiền hoàn ghi ledger âm, không sửa payment thu gốc hoặc số chốt ca cũ. Refund đã gắn ca và còn PENDING chặn close. Refund chưa gắn ca có thể chờ ca kế tiếp.

ReturnSaga lưu stage RECEIVE/REFUND/DONE, refundId cố định, kết quả và lỗi gần nhất. Worker claim lease 20 giây, có token ngăn worker cũ ghi đè, thử lại tối đa giãn cách 30 giây. Sau khi kho nhận, lỗi Finance giữ REFUND_PENDING. Không tạo refundId khác hoặc đảo tồn để che giấu kết quả chưa rõ. Khi Finance xác nhận SUCCEEDED, Sales mới hoàn tất phiếu và phát sự kiện.

## API người dùng

Các đường dẫn có tiền tố `/v1/tenants/:tenant`. POST cần `Idempotency-Key` 16-64 ký tự. Cùng key/body trả lại kết quả cũ; khác body trả 409. Version cũ bị từ chối. Decimal/money truyền bằng chuỗi; trường ngoài DTO bị từ chối.

| Method / path | Nội dung |
| --- | --- |
| GET `/orders` | Thêm `from`, `to` ISO datetime; từ ngày bao gồm, đến thời điểm loại trừ; giữ lọc mã/status/site |
| GET `/orders/:id/receipt` | Chỉ đơn COMPLETED; snapshot không có giá vốn, trạng thái thanh toán và số lượt chuẩn bị in |
| POST `/orders/:id/receipt/prints` | `{}`; lưu snapshot lần đầu, tăng printNumber, lần tiếp theo `reprint:true`; audit yêu cầu in |
| POST `/orders/:id/returns` | `{reason,lines:[{orderLineId,quantity,disposition:SELLABLE hoặc QUARANTINE}]}` |
| GET `/orders/:id/returns` | Lịch sử, lượng đã trả và returnStatus NONE/PARTIAL/FULL |
| GET `/returns` | `siteId`, `status?`; tối đa 100 phiếu gần nhất |
| GET `/returns/:id` | Phiếu, tiến độ, lỗi hiện tại và trạng thái refund đã đồng bộ |
| POST `/returns/:id/approve` | `{version,note}`; note bắt buộc khi quá hạn |
| POST `/returns/:id/cancel` | `{version,reason}`; chỉ REQUESTED; thu ngân hủy phiếu mình lập |
| GET `/refunds/:id` | Trạng thái Finance hiện tại trong scope |
| POST `/refunds/:id/prepare` | `{version,shiftId}`; gắn refund PENDING vào ca đang mở |
| POST `/refunds/:id/confirm` | `{version,shiftId,cashPaid:true}`; ghi tiền chi một lần |
| GET `/shifts?siteId=...` | `{items,activeShift}`; 50 ca gần nhất trong quyền đọc; CASHIER chỉ nhận ca của mình. `activeShift` chỉ gồm id/site_id/register_id/cashier_id/status/opened_at, hoặc null, để biết quầy đang bận mà không lộ tiền của ca khác |
| GET `/shifts/:id` | Ca, tổng các nhóm tiền, 200 dòng ledger gần nhất, khoản đang chờ; snapshot đọc REPEATABLE READ |
| POST `/shifts/:id/cash-entries` | `{kind:IN hoặc OUT,amountVnd,reason}`; thu/chi khác tại quầy, không là doanh thu bán hàng |
| POST `/cash-entries/:id/reverse` | `{shiftId,reason}`; OWNER/MANAGER; một lần đảo vào ca OPEN cùng site |
| POST `/shifts/:id/approve-variance` | `{version,note}`; OWNER/MANAGER, policy tách người; không đổi counted/expected |

Các API mở/đóng ca, quote, draft, checkout và xác nhận thu tiền giữ hợp đồng tuần 7. Close khóa cùng shift với tạo payment, xác nhận thu/hoàn và cash entry; kiểm pending payment/refund rồi tính tổng và đóng trong một transaction. Ca chuyển từ OPEN sang CLOSED nguyên tử dưới khóa, không để lại trạng thái CLOSING trung gian đã commit. Close không sửa doanh thu để làm số đếm khớp quỹ. Ca CLOSED không mở lại; correction đi qua entry đảo ở ca hiện tại.

Danh sách ca và thông tin quầy đang hoạt động được đọc trong cùng snapshot REPEATABLE READ. OWNER/MANAGER/ACCOUNTANT đọc lịch sử theo quyền tại địa điểm; CASHIER không nhận số tiền, chênh lệch hoặc ghi chú của ca người khác. Xác nhận thu tiền, chuẩn bị/xác nhận hoàn tiền và đóng ca kiểm quyền sở hữu ca trước cả khi trả lại kết quả idempotency đã lưu. Người có quyền vẫn nhận lại kết quả cũ sau khi ca đóng; thao tác lặp không ghi thêm tiền.

## Biên nhận và POS

Quét bằng bàn phím + Enter chỉ thêm khi có một mã SKU/barcode khớp chính xác; F2 đưa focus vào ô tìm. Cùng SKU/đơn vị tăng lượng trong giỏ. Server vẫn chịu trách nhiệm báo giá, giới hạn giảm, tồn và thanh toán.

Biên nhận chỉ cho phép sau hoàn tất kho và xác minh tiền. Snapshot nội dung bán bất biến; tên/địa chỉ cơ sở được chụp ở lần chuẩn bị in đầu tiên. Print endpoint ghi nhận yêu cầu chuẩn bị bản in, không chứng minh máy in đã in ra giấy. In lại có dấu BẢN IN LẠI; lỗi/hủy hộp thoại in không lặp checkout. CSS in 80 mm; browser hỗ trợ in hoặc lưu PDF. Biên nhận ghi rõ không phải hóa đơn điện tử; `invoiceStatus=NOT_ISSUED`, `taxStatus=NOT_CONFIGURED`.

## Sự kiện và migration

Thêm `sales.return-completed.v1` và `finance.refund-succeeded.v1`, cùng envelope v1; giữ ở `storeluma.deferred` chờ Reporting/Notification. Return event có orderLineId, qtyBase, refundVnd, costVnd và disposition; refund event có paymentId, returnId, shiftId và số tiền dương, còn ledger tiền chi âm.

Migration Sales 003 tạo returns/sagas/receipts; Inventory 005 tạo return_receipts và loại movement RETURN; Finance 005 tạo refund/cash entry, thêm duyệt lệch ca và ràng buộc mỗi dòng ledger chỉ có một nguồn. Lịch sử đã có không bị ghi lại. Không reset volume khi nâng cấp.

## Phạm vi còn lại

Chỉ tiền mặt, khách lẻ, quầy mặc định của site. Chưa có provider thanh toán điện tử, bán nợ, offline checkout, đổi hàng trực tiếp, hóa đơn điện tử hoặc thu/chi ngoài quầy. Chưa kiểm máy in vật lý, nhiều replica, tải lớn hay phục hồi mất database. Báo cáo/thông báo nghiệp vụ tiếp tục ở tuần 9; không coi ledger ca là dashboard doanh thu toàn hệ thống.
