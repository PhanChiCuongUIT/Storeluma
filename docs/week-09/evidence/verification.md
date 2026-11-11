# Kết quả kiểm chứng tuần 9

- Bắt đầu: 10/11/2026 09:00:16, giờ Việt Nam.
- Lệnh: `npx playwright test --grep-invert "Week 4 foundation"`; 131 đạt, 0 lỗi, 0 bỏ qua trong tập đã chọn, 0 flaky; 883.6 giây.
- Lượt xác nhận cuối `npx playwright test tests/week09.spec.ts`: 13/13 đạt, bắt đầu 10/11/2026 09:15:21, không lỗi/bỏ qua/flaky. Có kiểm tra giới hạn tệp chờ và cạnh tranh cùng ID khác hộ.
- `npm run build`: đạt. `npm audit --omit=dev`: 0 lỗ hổng tại thời điểm kiểm tra.
- Môi trường: Windows, Docker Compose, PostgreSQL riêng mỗi dịch vụ, RabbitMQ, Keycloak/TOTP, Chromium.
- Ảnh thật: [bán hàng](screenshots/01-sales-report.png), [tồn kho](screenshots/02-stock-report.png), [thu chi](screenshots/03-cash-report.png), [công việc](screenshots/04-work-inbox.png), [390 px](screenshots/05-mobile-report.png).

Các nhóm W9-01 đến W9-13 kiểm tra số liệu, trả khác kỳ, vai trò/địa điểm, ngày, export, CSV, vòng đời công việc, rules, dữ liệu cũ/trùng, phục hồi snapshot, gián đoạn consumer, thu tiền chờ/chênh lệch ca và UI. MIG-01/MIG-02 bổ sung migration projection trên dữ liệu cũ. Các kiểm thử xác thực và tuần 5-8 tiếp tục chạy cùng đợt. Tập tuần 4 gồm 20 ca cần tạo thêm hộ; môi trường cục bộ đã có 19 hộ ở tài khoản kiểm thử nên giữ nguyên dữ liệu và thực hiện tập đó trên CI mới. Workflow CI không loại ca nào.

Giới hạn: chưa đo tải lớn, chưa production, chưa SMTP/push. Chi tiết kiến trúc, API và phạm vi chức năng được mô tả trong tài liệu tuần 9.

## Kiểm chứng bổ sung UI/UX ngày 11/11/2026

- `npm run typecheck` và build ứng dụng/Gateway: đạt.
- `npx playwright test tests/ui.spec.ts tests/auth.spec.ts`: 8/8 đạt, không bỏ qua hoặc retry. Chạy lại `tests/ui.spec.ts` sau điều chỉnh: 2/2 đạt.
- Đăng nhập và TOTP được kiểm tra ở 320, 390, 768 và 1440 px. Menu được kiểm tra thêm ở 680 và 700 px, gồm mở/đóng, Escape, tự đóng khi chọn mục và chuyển focus về nội dung.
- Rà soát trực tiếp 38 tổ hợp trang/viewport trên dữ liệu kiểm chứng: 10 trang ở 1440 và 390 px; thêm 6 trang nghiệp vụ ở 320, 680 và 768 px. Không tràn ngang toàn trang và không có lỗi JavaScript. Bảng Nhân sự đã sửa vùng chứa nhãn hỗ trợ đọc màn hình; W4-18 bổ sung kiểm tra hồi quy.
- Ảnh sau điều chỉnh: [đăng nhập](screenshots/06-login-refined.png), [TOTP](screenshots/07-otp-refined.png), [hàng hóa](screenshots/08-workspace-refined.png), [menu điện thoại](screenshots/09-mobile-refined.png).
- Kiểm tra bằng Chromium/viewport mô phỏng, chưa thử trên điện thoại vật lý. Kết quả kiểm thử nghiệp vụ ban đầu ở trên được giữ riêng với đợt kiểm tra giao diện này.
