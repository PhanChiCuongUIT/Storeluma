# Giao diện hàng hóa và nhập hàng

Tiếp nối bộ giao diện tuần 4, sử dụng logo gốc ở `apps/web/public/brand/Logo_Storeluma.png`, nền sáng, thanh điều hướng cố định, bảng dữ liệu và nhãn trạng thái ngắn bằng tiếng Việt.

Tham khảo ngày 16/10/2026: [Tabler Tables](https://preview.tabler.io/tables.html), [Tabler Invoice](https://preview.tabler.io/invoice.html), [mã nguồn Tabler](https://github.com/tabler/tabler). Tham khảo cách bố trí thanh công cụ, khoảng cách dòng, chi tiết chứng từ và căn phải các cột tiền. Giao diện được tự triển khai bằng React/CSS hiện có, không sao chép mẫu hoặc thêm thư viện Tabler.

| Màn hình | Thao tác thật |
| --- | --- |
| Hàng hóa | Tìm tên/mã/barcode, lọc, phân trang, tạo sản phẩm với SKU đầu tiên; quản lý nhóm hàng |
| Chi tiết sản phẩm | Thêm biến thể, đổi tên/barcode/trạng thái SKU; thêm đơn vị và sửa giá; hiển thị quy đổi |
| Nhà cung cấp | Tìm mã/tên/điện thoại, sửa liên hệ, ngừng giao dịch; xem lịch sử nhập và công nợ theo quyền |
| Nhập hàng | Chọn địa điểm, tìm/lọc phiếu; chọn hàng và đơn vị qua Catalog, lưu/sửa/hủy nháp |
| Chi tiết phiếu | Xem snapshot, lượng cơ sở và tổng; xác nhận ghi sổ; trạng thái tồn và đồng bộ công nợ |

Hộp thoại dùng `dialog.showModal()` để quản lý focus và chặn tương tác nền. Khi đang lưu, khóa nút và chặn Escape; lỗi giữ nội dung để người dùng sửa/thử lại. Khóa idempotency được giữ cho cùng nội dung khi thử lại trong biểu mẫu. Backend vẫn kiểm toàn bộ quyền và dữ liệu.

Tìm kiếm gửi tới API có phân trang, bộ chọn hàng/nhà cung cấp cũng có tìm và tải thêm. Các bảng cho phép cuộn ngang trong vùng riêng khi màn hình nhỏ; không làm tràn ngang toàn trang. Chuyển hộ hoặc thay vai trò/phiên bản quyền sẽ tạo lại vùng nghiệp vụ để bỏ dữ liệu cũ.

Giá nhập theo đơn vị đã chọn; tổng dự tính dùng số nguyên chính xác, máy chủ tính lại trước lưu. Dữ liệu công nợ hiển thị thời điểm kiểm tra; mất kết nối Finance hiển thị chưa xác định, không chuyển thành số 0. Không có nhãn môi trường phát triển, tuần thực hiện hoặc thông tin sinh viên trong giao diện sản phẩm.
