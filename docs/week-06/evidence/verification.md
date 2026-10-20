# Kiểm chứng phiên bản 0.6.0

- Cục bộ: Windows/Docker Linux containers, PostgreSQL 17, RabbitMQ 4.1, Keycloak 26.4.7, Node.js 24, Chromium.
- Typecheck và build: đạt.
- Tuần 6: `npx playwright test tests/week06.spec.ts`, bắt đầu 20/10/2026 17:11:31 (Asia/Ho_Chi_Minh), 48.4 giây: **22/22 đạt**.
- Hồi quy riêng: AUTH + tuần 5, bắt đầu 20/10/2026 17:14:43, 279.7 giây: **31/31 đạt**.
- Hai lần chạy trên không skipped/flaky và không retry; không nhận là một lượt chạy đủ 53 ca.
- CI trên Ubuntu với Docker mới: **73/73 đạt** (6 AUTH + 20 W4 + 25 W5 + 22 W6), commit `881ee644d55d91099a53e1040438a458b81a79ae`. [GitHub Actions](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/39407137328).

| Mã | Kiểm tra | Kết quả |
| --- | --- | --- |
| W6-01 | Giữ định danh nguồn nhập và số dư trước/sau; delta khớp lượng và giá trị. | Đạt |
| W6-02 | Cô lập hộ/site; CASHIER chỉ đọc lượng; backend loại trường vốn và chặn chứng từ. | Đạt |
| W6-03 | Nháp không đổi tồn; kiểm SKU thuộc hộ, scope kho, trùng dòng và idempotency. | Đạt |
| W6-04 | Bắt đầu kiểm snapshot và khóa đúng scope; kho khác vẫn nhận hàng được. | Đạt |
| W6-05 | Nhập và điều chỉnh bị chặn khi SKU đang kiểm; không có ghi một phần. | Đạt |
| W6-06 | Nhập đủ scope, lượng không âm; version cũ bị từ chối; chưa duyệt chưa đổi tồn. | Đạt |
| W6-07 | 100 đếm 97: bốn lệnh duyệt chỉ ghi -3 một lần; mở khóa và không tạo nợ. | Đạt |
| W6-08 | Phiếu ghi sổ không sửa/hủy; quản lý không nhận giá vốn ẩn trong JSON. | Đạt |
| W6-09 | Site ngừng chặn ghi mới nhưng vẫn hủy kiểm được; tồn giữ nguyên. | Đạt |
| W6-10 | Hai phiên kiểm và nhập/bắt đầu kiểm đồng thời được tuần tự hóa, kể cả balance mới. | Đạt |
| W6-11 | Tăng tồn từ 0 cần vốn; người duyệt trả lại để đếm lại, giữ nguyên khóa. | Đạt |
| W6-12 | Cách ly, giải phóng có xác nhận và xuất hủy giữ đúng bucket/giá trị. | Đạt |
| W6-13 | Fixture reserved chặn kiểm và xuất vượt phần khả dụng; chưa coi là luồng bán. | Đạt |
| W6-14 | Correction tính bình quân chính xác; giảm hết đưa giá trị và avgCost về 0. | Đạt |
| W6-15 | STOCK chỉ sửa nháp của mình; quản lý đúng site; tài chính chỉ đọc vốn. | Đạt |
| W6-16 | Lọc thẻ kho theo SKU/loại/ngày; phân trang không trùng; không lẫn kho. | Đạt |
| W6-17 | Lỗi tràn số dòng sau hoàn tác mọi cập nhật dòng trước và movement. | Đạt |
| W6-18 | Khởi động lại Inventory giữ freeze; hủy xong mới ghi sổ phiếu nhập chờ. | Đạt |
| W6-19 | UI tạo phiếu, nhập số đếm, gửi duyệt, ghi sổ và mở chứng từ từ thẻ kho. | Đạt |
| W6-20 | UI sửa/ghi sổ điều chỉnh; bảng tồn và màn hình 390 px không tràn trang. | Đạt |
| W6-21 | Làm tròn phần xuất ở nửa đồng; sửa số lượng không xóa giá vốn bị ẩn. | Đạt |
| W6-22 | Toàn bộ movement cộng lại khớp balance; phiếu kho không tạo payable. | Đạt |

Ảnh chính chụp UI thật trên bộ dữ liệu trình diễn riêng; tất cả thao tác đi qua API. JSON máy chạy, tài khoản và công cụ seed được giữ ngoài Git. Bìa dùng ngày báo cáo 30/10/2026 theo kỳ kế hoạch, không thay thời điểm kiểm tra thực tế. Bộ kiểm thử reserved dùng fixture DB để thử điều kiện khóa và bất biến, chưa chứng minh luồng bán/reserve thực tế. Chưa có kết quả production, tải cao, disaster recovery hoặc các nghiệp vụ tuần 7 trở đi.
