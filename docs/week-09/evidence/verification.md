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
- Bộ lọc Kho và Đơn bán được kiểm tra thêm tại 320, 390, 680, 768 và 1440 px: 10/10 tổ hợp đạt; các tab Bán hàng, Trả hàng và Ca thu ngân không làm tràn trang. Ảnh bổ sung: [đơn bán](screenshots/10-sales-filters-refined.png), [kho](screenshots/11-stock-filters-refined.png).
- Kiểm tra bằng Chromium/viewport mô phỏng, chưa thử trên điện thoại vật lý. Kết quả kiểm thử nghiệp vụ ban đầu ở trên được giữ riêng với đợt kiểm tra giao diện này.


## Ngôn ngữ, chế độ hiển thị và hồi quy ngày 12/11/2026

- Lượt `npm test` ban đầu: 153 đạt, 1 lỗi kiểm tra, 5 ca phụ thuộc chưa chạy. W8-26 so sánh cả tên hàng và tiền trong cùng ô nên báo khác nhau khi đổi `85.000` thành `85,000`; đã sửa phép đối chiếu để chỉ lấy tên hàng, tiếp tục kiểm tra nhãn và nền giấy.
- Chạy xác nhận toàn bộ `npx playwright test tests/week08.spec.ts`: **31/31 đạt**, không bỏ qua hoặc retry/flaky. Ghép kết quả cuối của các nhóm: **159/159 ca đã được xác nhận đạt**; tổng thời gian hai lượt 1302.3 giây. Môi trường Docker Compose mới với volume kiểm thử riêng; giữ nguyên volume đang sử dụng. Gồm toàn bộ các ca xác thực, kiến trúc, migration và tuần 4-9.
- DISPLAY-01–04: bảng dịch và tham số, không dịch tên dữ liệu, lựa chọn theo hệ thống, lưu qua tải lại, OIDC/TOTP tiếng Anh, đổi ngôn ngữ Keycloak, lỗi đăng nhập, xác nhận đăng xuất và giữ bản nháp biểu mẫu.
- W8-26: biên nhận tiếng Anh giữ tên hàng, nền trắng khi xem và in từ chế độ tối. W9-14: nhãn CSV tiếng Anh, dữ liệu hàng giữ nguyên, kiểm tra chủ sở hữu tệp và từ chối locale không hỗ trợ.
- Rà soát 160 tổ hợp: 10 trang × 2 ngôn ngữ × 2 chế độ màu × 4 chiều rộng (320, 390, 768, 1440 px). Không tràn ngang toàn trang, không lỗi JavaScript. Ảnh được chụp sau khi dữ liệu tải xong.
- `npm run typecheck`, `npm run build`: đạt. `npm audit --omit=dev`: 0 lỗ hổng ở thời điểm kiểm tra.
- Compose bổ sung readiness của Keycloak trước Gateway; probe HTTP nội bộ trả 200 trên image 26.4.7. Cổng quản trị health không công bố ra host.
- Ảnh: [đăng nhập English/tối](screenshots/12-login-dark-english.png), [TOTP tiếng Việt/tối](screenshots/13-otp-dark-vietnamese.png), [danh mục English/tối](screenshots/14-catalog-dark-english.png), [báo cáo điện thoại/tối](screenshots/15-reports-dark-mobile.png).

Kết quả dùng Chromium trên Windows và môi trường Compose. Chưa kiểm tra điện thoại/máy in vật lý hoặc triển khai production. Các kết quả lịch sử phía trên được giữ riêng theo lần kiểm chứng.


## Nút tùy chọn và logo tối ngày 12/11/2026

- Thay ô select bằng nút biểu tượng dùng chung ở ứng dụng và Keycloak. Menu có trạng thái đang chọn, hỗ trợ bàn phím và tự căn trong viewport. Chế độ theo hệ thống vẫn tự cập nhật biểu tượng và logo.
- Logo sáng và tối cùng 1254 × 1254 px. DISPLAY-05 đối chiếu kích thước PNG và khung hiển thị trước/sau chuyển theme; DISPLAY-02 kiểm tra logo khi hệ thống đổi màu; DISPLAY-04 kiểm tra tài nguyên logo trên Keycloak.
- Tập xác thực/UI: 8/8 đạt. Tập hiển thị chạy xác nhận sau điều chỉnh: 5/5 đạt, không bỏ qua hoặc retry. Lượt đầu còn một locator kiểm thử trỏ đồng thời vào nút và menu cùng nhãn; đã đổi sang vai trò button và chạy lại toàn bộ tập hiển thị.
- Kiểm tra menu ở 320, 390, 768 và 1440 px, trước và sau đăng nhập. Enter, phím mũi tên, Home/End, Escape, Tab và bấm ngoài được kiểm tra tự động. Đăng nhập TOTP, thông báo lỗi và đăng xuất tiếp tục hoạt động.
- Rà soát lại 160 tổ hợp trang/ngôn ngữ/theme/viewport: không tràn ngang toàn trang hoặc lỗi JavaScript. Các ảnh 12-15 đã thay bằng giao diện mới; [ảnh menu lựa chọn](screenshots/16-appearance-menu.png) bổ sung trạng thái mở.
- Typecheck và build Gateway/ứng dụng đạt. Không đổi dịch vụ nghiệp vụ, cơ sở dữ liệu hoặc dữ liệu người dùng. Kết quả hồi quy toàn hệ thống của lần trước được giữ riêng ở trên; lần này tập trung kiểm tra phần giao diện và xác thực bị tác động.

Lượt CI đầu sau thay đổi đạt 155 ca; W4-16 dừng do locator theo `alt` khớp cả hai ảnh logo sáng/tối, khiến bốn ca phụ thuộc chưa chạy. Đã sửa phép kiểm tra sang ảnh được công bố trong cây truy cập, yêu cầu đúng một logo đang hiển thị và ảnh đã tải. Kiểm tra riêng locator ở cả sáng, tối và theo hệ thống đều đạt; workflow tiếp tục chạy toàn bộ 160 ca trên commit sửa lỗi, không loại ca kiểm thử.
