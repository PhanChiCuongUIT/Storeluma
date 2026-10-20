# Giao diện kho

Menu **Kho hàng** dùng cùng shell, bộ chọn hộ và logo gốc. Bốn tab: Tồn kho, Thẻ kho, Kiểm kho, Điều chỉnh. CASHIER chỉ thấy hai tab tra cứu. Site luôn được chọn rõ; trạng thái tạm ngừng tắt lệnh ghi nhưng vẫn cho đọc và hủy phiếu chưa ghi sổ.

Tham khảo bố cục bảng, bộ lọc và chứng từ từ [Tabler Tables](https://preview.tabler.io/tables.html) và [Tabler Invoice](https://preview.tabler.io/invoice.html). React/CSS được viết cho nghiệp vụ hiện tại: màu xanh trầm, nền sáng, đường phân cách nhẹ, số căn theo cột, mã/tên hàng tách hai dòng. Không đưa tên đồ án hoặc môi trường chạy vào nhãn sản phẩm.

- Tồn kho: giải thích ngắn hiện có/giữ/cách ly/khả dụng; tìm và lọc phía server; badge đang kiểm; mở thẻ theo SKU; hiện thời điểm truy vấn.
- Thẻ kho: lọc loại và khoảng ngày theo giờ Việt Nam; trước/sau, delta, nguồn; mở chứng từ thật nếu có quyền. Số dư tái lập của dữ liệu cũ được đánh dấu.
- Lập phiếu: vùng tìm SKU và danh sách đã chọn; phân trang SKU, không hardcode sản phẩm. Đơn vị cơ sở rõ trên từng dòng.
- Kiểm kho: tiến trình nháp/đang kiểm/chờ duyệt/ghi sổ; thông báo phạm vi đang khóa; nhập riêng hàng tốt và cách ly, lưu trước khi gửi. Người duyệt có thể yêu cầu đếm lại; giao diện xác nhận trước khi ghi sổ/hủy/bắt đầu khóa.
- Điều chỉnh: chọn loại, lượng, chiều tăng/giảm và vốn bổ sung khi cần; checkbox xác nhận chất lượng khi giải phóng cách ly. Sửa nháp và lưu trước khi duyệt.
- Mobile: bảng cuộn trong vùng riêng, bộ lọc xuống dòng và form chuyển một cột; không để toàn trang tràn ngang.

Các trạng thái tải, danh sách trống, lỗi và thử lại dùng dữ liệu API. Khi chuyển tab, xóa ngay tập dòng của tab cũ để tránh render sai cấu trúc. Idempotency key được giữ lại khi retry cùng nội dung. Quyền và trường vốn được kiểm ở backend; việc ẩn nút không thay thế phân quyền.
