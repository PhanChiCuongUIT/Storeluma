# Giao diện POS và công việc cuối ca

Giao diện dùng cấu trúc thẻ, tiêu đề, trạng thái và bảng số tiền để người dùng theo dõi cùng một công việc. Tham khảo [Tabler Invoice](https://preview.tabler.io/invoice.html) cho bảng dòng hàng và phần tổng; [Tabler Card](https://docs.tabler.io/ui/components/card) cho khối số liệu và hành động. Không thêm thư viện giao diện vào runtime; giữ hệ màu, logo và thành phần Storeluma hiện có.

## Bán hàng

Ba mục Bán hàng, Trả hàng, Ca thu ngân nằm trong Đơn bán. Địa điểm và trạng thái ca được giữ ở đầu màn hình. Khi lập đơn, hàng và số lượng nằm bên trái; tổng tiền, giảm giá và hành động thanh toán ở bên phải. F2 tập trung tìm hàng; Enter thêm mã quét khớp chính xác. Đơn hoàn tất có hành động in, lập phiếu trả và bán đơn tiếp theo. Danh sách lọc mã, trạng thái và ngày.

## Sau bán

Phiếu trả cho chọn từng dòng, lượng và tình trạng bán lại/cách ly, kèm lý do. Màn hình tách rõ chờ duyệt, chờ nhận hàng, chờ hoàn tiền và hoàn tất. Xác nhận chi tiền yêu cầu checkbox riêng. Khi gián đoạn, hiển thị nguyên nhân và giữ phiếu hiện tại; không tạo lại giao dịch. Danh sách phiếu trả giúp quản lý tiếp nhận yêu cầu từ nhân viên khác.

## Ca thu ngân

Lịch sử ca bên trái; bên phải gồm đầu ca, thu bán hàng, hoàn khách và thu/chi khác, rồi số tiền dự kiến và ledger. Chốt ca yêu cầu số đếm; chênh lệch có lý do và bước quản lý xác nhận. Phiếu đảo giữ liên kết chứng từ gốc, ghi vào ca mới khi ca cũ đã đóng.

## Biên nhận và màn hình nhỏ

Bản xem in là một trang giấy 80 mm, dùng logo gốc, dòng hàng, giảm giá, tiền thực thu, tiền khách đưa và tiền thừa. Bản in lại được đánh dấu. Khi in, ẩn toàn bộ thanh điều hướng và nút thao tác. Trên điện thoại, các khối xếp dọc; bảng dài cuộn trong vùng riêng, không kéo tràn toàn trang. Đã bố trí nhãn nhập rõ ràng, thông báo lỗi và nút có trạng thái chờ; kết quả chạy giao diện nằm trong minh chứng kiểm thử.
