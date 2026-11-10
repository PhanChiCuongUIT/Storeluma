# Kết quả kiểm chứng tuần 9

- Bắt đầu: 10/11/2026 09:00:16, giờ Việt Nam.
- Lệnh: `npx playwright test --grep-invert "Week 4 foundation"`; 131 đạt, 0 lỗi, 0 bỏ qua trong tập đã chọn, 0 flaky; 883.6 giây.
- Lượt xác nhận cuối `npx playwright test tests/week09.spec.ts`: 13/13 đạt, bắt đầu 10/11/2026 09:15:21, không lỗi/bỏ qua/flaky. Có kiểm tra giới hạn tệp chờ và cạnh tranh cùng ID khác hộ.
- `npm run build`: đạt. `npm audit --omit=dev`: 0 lỗ hổng tại thời điểm kiểm tra.
- Môi trường: Windows, Docker Compose, PostgreSQL riêng mỗi dịch vụ, RabbitMQ, Keycloak/TOTP, Chromium.
- Ảnh thật: [bán hàng](screenshots/01-sales-report.png), [tồn kho](screenshots/02-stock-report.png), [thu chi](screenshots/03-cash-report.png), [công việc](screenshots/04-work-inbox.png), [390 px](screenshots/05-mobile-report.png).

Các nhóm W9-01 đến W9-13 kiểm tra số liệu, trả khác kỳ, vai trò/địa điểm, ngày, export, CSV, vòng đời công việc, rules, dữ liệu cũ/trùng, phục hồi snapshot, gián đoạn consumer, thu tiền chờ/chênh lệch ca và UI. MIG-01/MIG-02 bổ sung migration projection trên dữ liệu cũ. Các kiểm thử xác thực và tuần 5-8 tiếp tục chạy cùng đợt. Tập tuần 4 gồm 20 ca cần tạo thêm hộ; môi trường cục bộ đã có 19 hộ ở tài khoản kiểm thử nên giữ nguyên dữ liệu và thực hiện tập đó trên CI mới. Workflow CI không loại ca nào.

Giới hạn: chưa đo tải lớn, chưa production, chưa SMTP/push. Chi tiết kiến trúc, API và phạm vi chức năng được mô tả trong tài liệu tuần 9.
