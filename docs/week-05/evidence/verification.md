# Kiểm tra bản 0.5.0

- Môi trường: Windows, Docker Linux containers, PostgreSQL 17, RabbitMQ 4.1, Keycloak 26.4.7; Node.js 24 và Chromium.
- Bắt đầu: 16/10/2026 17:14:52 (Asia/Ho_Chi_Minh).
- Lệnh: `npm test`; thời gian 119.7 giây.
- Kết quả: **45/45 đạt**, gồm **25 ca tuần 5 + 20 ca hồi quy tuần 4**; không bỏ qua, không flaky.
- `npm run typecheck` và build Docker/Vite đã thành công cho mã được kiểm tra.
- Test HTTP, browser và database thật, có dừng/chạy lại Finance, Business, Catalog và RabbitMQ; thử mất binding và hàng đợi lỗi.

| Mã | Nội dung | Kết quả |
| --- | --- | --- |
| W5-01 | Phép tính chính xác; 2 thùng × 24 = 48; HALF_UP; không mất số nguyên lớn. | Đạt |
| W5-02 | Tạo sản phẩm/SKU/đơn vị nguyên tử; trùng mã, retry, tìm barcode, phân trang. | Đạt |
| W5-03 | Quy đổi dương; giá dạng chuỗi; kiểm version và lưu lịch sử giá. | Đạt |
| W5-04 | Nhà cung cấp duy nhất; cô lập hộ; CSRF; chặn internal route và JWT giả. | Đạt |
| W5-05 | Nháp lưu snapshot đúng; không tạo movement hay payable; chặn trường tự gán tổng. | Đạt |
| W5-06 | STOCK lập nháp trong phạm vi, không ghi sổ/tồn đầu kỳ và không sửa nháp người khác. | Đạt |
| W5-07 | Năm lệnh ghi sổ đồng thời, gồm khóa giống/khác, chỉ một movement và một payable. | Đạt |
| W5-08 | Dừng Finance, nhập vẫn thành công; chạy lại tạo nợ; bình quân cập nhật đúng. | Đạt |
| W5-09 | Phát lại sự kiện cùng ID và ID mới không nhân bản công nợ theo receipt. | Đạt |
| W5-10 | Tồn đầu kỳ tăng tồn nhưng không tạo nợ, kể cả sau khi Finance xử lý sự kiện. | Đạt |
| W5-11 | Đổi tên SKU/nhà cung cấp không sửa snapshot; POSTED không sửa/hủy. | Đạt |
| W5-12 | Nhà cung cấp/sản phẩm/đơn vị ngừng hoặc site tạm ngừng chặn nhập mới. | Đạt |
| W5-13 | Sửa nháp bằng version cũ bị từ chối; hủy nháp không tăng tồn. | Đạt |
| W5-14 | Quản lý chỉ ghi sổ đúng site; tài chính đọc nợ/giá vốn nhưng không nhập hàng. | Đạt |
| W5-15 | Business gián đoạn: từ chối truy cập; Catalog gián đoạn: phiếu vẫn nháp, không tăng tồn. | Đạt |
| W5-16 | Giao diện tạo sản phẩm, nhà cung cấp, phiếu nháp và ghi sổ qua backend thật. | Đạt |
| W5-17 | Chiều rộng 390 px không tràn trang; thu ngân không có UI nhập hoặc sửa danh mục. | Đạt |
| W5-18 | Tài khoản bị chặn kết nối DB khác; bảng đúng dịch vụ; projection nhận đúng phiên bản. | Đạt |
| W5-19 | JWT người dùng hợp lệ nhưng giả chữ ký dịch vụ vẫn bị internal API trả 403. | Đạt |
| W5-20 | Tràn độ chính xác một dòng khiến toàn bộ ghi sổ rollback, không ghi dở các dòng khác. | Đạt |
| W5-21 | Hai hộ dùng cùng mã SKU/barcode/NCC được; khóa thành viên tác động phiên hiện tại. | Đạt |
| W5-22 | Mở lại nháp trên UI, tải đủ đơn vị và đổi quy cách; lưu 2 thùng thành 48 đơn vị cơ sở. | Đạt |
| W5-23 | Thông điệp sai và hết retry chỉ vào hàng đợi lỗi của Finance, không phát sang dịch vụ khác. | Đạt |
| W5-24 | Mất tuyến nhận không đánh dấu Outbox đã gửi; phục hồi tuyến xử lý đúng một công nợ. | Đạt |
| W5-25 | Dừng RabbitMQ, nhập vẫn commit; khởi động broker đồng bộ lại, không nhân đôi movement/nợ. | Đạt |

Ảnh chính chụp trên bộ dữ liệu Hộ An Nhiên; ảnh sửa đơn vị nháp lấy từ ca W5-22 trên hộ kiểm thử An Mộc. Các thao tác dùng backend thật. Ảnh kiểm thử thô và JSON máy chạy được giữ ngoài Git. Ngày báo cáo 23/10/2026 không thay ngày kiểm tra thực tế. Chưa kết luận về production, tải cao, disaster recovery hoặc toàn bộ nghiệp vụ cuối kỳ.
