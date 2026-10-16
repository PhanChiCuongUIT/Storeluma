# Kiểm tra bản 0.5.0

- Môi trường: Windows, Docker Linux containers, PostgreSQL 17, RabbitMQ 4.1, Keycloak 26.4.7; Node.js 24 và Chromium.
- Bắt đầu: 16/10/2026 10:09:00 (Asia/Ho_Chi_Minh).
- Lệnh: `npm test`; thời gian 73.8 giây.
- Kết quả: **41/41 đạt**, gồm **21 ca tuần 5 + 20 ca hồi quy tuần 4**; không bỏ qua, không flaky.
- `npm run typecheck` và build Docker/Vite đã thành công cho mã được kiểm tra.
- Test HTTP, browser và database thật, có dừng/chạy lại Finance, Business, Catalog.

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
| W5-18 | Bảng thuộc đúng database dịch vụ; projection nhận đúng phiên bản Catalog. | Đạt |
| W5-19 | JWT người dùng hợp lệ nhưng giả chữ ký dịch vụ vẫn bị internal API trả 403. | Đạt |
| W5-20 | Tràn độ chính xác một dòng khiến toàn bộ ghi sổ rollback, không ghi dở các dòng khác. | Đạt |
| W5-21 | Hai hộ dùng cùng mã SKU/barcode/NCC được; khóa thành viên tác động phiên hiện tại. | Đạt |

Ảnh công khai chụp riêng trên bộ dữ liệu minh họa Hộ An Nhiên sau kiểm thử; các thao tác dùng backend thật. Ảnh kiểm thử thô và JSON máy chạy được giữ ngoài Git. Ngày báo cáo 23/10/2026 không thay ngày kiểm tra thực tế. Chưa kết luận về production, tải cao, disaster recovery hoặc toàn bộ nghiệp vụ cuối kỳ.
