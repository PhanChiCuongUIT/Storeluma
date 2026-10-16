# Kết quả kiểm thử tuần 4

Ngày kiểm tra: 15/10/2026. Phiên bản: 0.4.0.

Môi trường: Chromium, PostgreSQL, RabbitMQ, Keycloak và các dịch vụ Storeluma chạy bằng Docker Compose. Bộ kiểm thử dùng tài khoản và dữ liệu mẫu; không giả lập phản hồi API.

## Đối chiếu nhiệm vụ

Phạm vi căn cứ vào tuần 4 trong [đề cương](../../../output/pdf/Storeluma_De_cuong_Do_an_2.pdf), yêu cầu YC01–YC03 trong [báo cáo tuần 2](../../week-02/bao-cao-tuan-02.md) và đầu việc chuyển tiếp trong [báo cáo tuần 3](../../week-03/bao-cao-tuan-03.md).

| Nhiệm vụ | Sản phẩm thực tế | Minh chứng | Kết quả |
| --- | --- | --- | --- |
| Dựng nền dự án | React, Gateway và dịch vụ NestJS, Docker Compose, migration, cấu hình riêng | Build, typecheck; W4-14, W4-15 | Đạt trong môi trường cục bộ |
| Đăng nhập và ngữ cảnh | Keycloak, mật khẩu + TOTP, phiên phía máy chủ, chọn hộ/địa điểm, đăng xuất | W4-01–03, W4-05–06, W4-17–19 | Đạt |
| Hộ và địa điểm | Tạo hộ, thêm/sửa/tạm ngừng địa điểm, khởi tạo kho/quầy bằng sự kiện | W4-04–08, W4-13, W4-16, W4-20 | Đạt |
| Quyền cơ bản | Lời mời đúng người, vai trò và phạm vi địa điểm, khóa/mở thành viên, bảo vệ chủ hộ | W4-09–12, W4-16, W4-19–20 | Đạt |
| Kiểm tra và bàn giao | Mã nguồn, hướng dẫn chạy, hợp đồng API, báo cáo và ảnh giao diện | Bộ kiểm thử và tài liệu trong thư mục tuần 4 | Đã cập nhật |

## Kết quả lần chạy cuối

**20/20 ca đạt**, không bỏ qua và không flaky. Thời gian: **34.9 giây**. Build và kiểm tra kiểu TypeScript đạt. Thời điểm bắt đầu (UTC): `2026-10-15T14:37:23.002Z`.

| Ca kiểm thử | Kết quả | Thời gian |
| --- | --- | --- |
| W4-01 Password + TOTP, server session, no browser tokens | Đạt | 0.08 s |
| W4-02 Unauthenticated and forged identity denied | Đạt | 0.54 s |
| W4-03 Missing CSRF and foreign Origin denied | Đạt | 0.05 s |
| W4-04 Concurrent create retry creates one tenant and first site | Đạt | 0.22 s |
| W4-05 Warehouse and register acknowledge before ACTIVE | Đạt | 0.54 s |
| W4-06 Different tenant and forged tenant/subject headers denied | Đạt | 0.09 s |
| W4-07 Finance outage keeps new site pending, old site stays active | Đạt | 4.59 s |
| W4-08 Replayed event does not duplicate warehouse/register | Đạt | 0.19 s |
| W4-09 Invitation requires owner confirmation and exact recipient; one use | Đạt | 0.20 s |
| W4-10 Cashier limited to assigned site and cannot grant rights | Đạt | 0.47 s |
| W4-11 Block takes effect in existing session; stale permission update rejected | Đạt | 0.18 s |
| W4-12 Owner cannot remove own final ownership | Đạt | 0.07 s |
| W4-13 Site optimistic locking and suspension gate | Đạt | 0.14 s |
| W4-14 Restart retains data, context and audit | Đạt | 2.04 s |
| W4-15 Database roles cannot connect to another service database | Đạt | 0.02 s |
| W4-16 Browser creates site, renders staff and audit; mobile layout | Đạt | 5.35 s |
| W4-17 Expired server session rejected | Đạt | 0.05 s |
| W4-18 Logout deletes BFF session and ends Keycloak login | Đạt | 0.45 s |
| W4-19 Selected context follows site status and membership scope | Đạt | 8.12 s |
| W4-20 Browser creates tenant, invites and accepts the assigned employee | Đạt | 5.24 s |

## Kết quả rà soát bổ sung

- W4-19 tái hiện lỗi phiên vẫn trả địa điểm đã chọn sau khi địa điểm tạm ngừng. Gateway đã kiểm tra lại ngữ cảnh theo dữ liệu Business, bỏ lựa chọn khi trạng thái hoặc quyền không còn hợp lệ. Giao diện cập nhật vai trò/phạm vi theo chu kỳ khoảng 2,5 giây và bỏ kết quả tải cũ khi đổi hộ. API tiếp tục kiểm quyền từng yêu cầu.
- W4-19 còn kiểm tra quản lý sửa địa điểm được giao nhưng không sửa nơi ngoài phạm vi; thu ngân, nhân viên kho và tài chính bị từ chối sửa. Khóa thành viên đang có phiên chặn cả lệnh ghi.
- W4-20 tạo hộ, chọn nơi làm việc, mời và nhận nhân viên bằng biểu mẫu trên trình duyệt, rồi đối chiếu phạm vi và nhật ký tại API. Đã tách nhãn trường mã lời mời khỏi giá trị mã để trình đọc màn hình nhận đúng tên; thêm thông báo khi chưa chọn địa điểm cho nhân viên.
- W4-16 kiểm tra tạo địa điểm, tìm kiếm tiếng Việt không dấu, kết quả rỗng, xóa bộ lọc, lọc trạng thái, đổi dạng thẻ/danh sách; Tab/Shift+Tab giữ focus trong hộp thoại, Escape đóng và trả focus về nút mở. Đồng thời kiểm tra khóa/mở quyền, logo, nhật ký và màn hình 390 px không tràn ngang.

- Lần chạy đầu khi hoàn thiện giao diện phát hiện tác vụ tải danh tính có thể ghi đè hộ vừa chọn. Đã dùng cập nhật trạng thái theo lựa chọn mới nhất; W4-16 kiểm tra giữ đúng hộ trước thao tác tạo địa điểm và sửa quyền. Lần chạy lại toàn bộ đạt 20/20.
- Kiểm tra bổ sung trên Chromium: sao chép mã tài khoản đúng giá trị, lọc địa điểm tạm ngừng và không tràn ngang ở 320, 390, 768, 1280 px. Sau chỉnh CSS cho 320 px, build đạt và kiểm tra bổ sung đạt; bố cục 390 px trở lên không thay đổi. Chưa thay thế kiểm tra trên thiết bị thật.

Chín ảnh trong [screenshots/](screenshots/) được chụp lại từ lần chạy đạt. Hai ảnh xác thực được chụp trước khi nhập mật khẩu hoặc mã TOTP. Không đưa mã lời mời vào ảnh công khai.

## Chạy lại

Từ thư mục gốc dự án, sau khi khởi động Docker Compose:

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Bộ kiểm thử tạo dữ liệu mới, dừng/khởi động Finance và khởi động lại Business/Gateway. Kết quả chi tiết nằm tại `docs/week-04/evidence/playwright-results.json`, `playwright-report/` và `test-results/` trên máy chạy; các tệp này được bỏ qua bởi Git.

Kết luận đạt áp dụng cho nhiệm vụ nền hệ thống và quyền cơ bản của tuần 4. Danh mục/nhập hàng bắt đầu từ tuần 5; kiểm thử tải, nhiều trình duyệt, sao lưu/phục hồi và triển khai HTTPS/production chưa được nghiệm thu. Workflow đã có trên GitHub, nhưng kết quả CI chưa được xác minh trong lần rà soát này.

## Kiểm tra bổ sung giao diện đăng nhập - 16/10/2026

Phạm vi thay đổi: trang mở đầu React và CSS theme Keycloak. Gom logo/nội dung, đồng bộ chữ, ô nhập, nút và trạng thái focus. Không thay đổi logic xác thực.

Build và TypeScript đạt. Kiểm tra trực tiếp bằng Chromium với backend thật đạt: mở trang đăng nhập; màn hình 320/390/768 px không tràn ngang; hiện/ẩn mật khẩu; báo sai tài khoản/mật khẩu; đăng nhập đúng bằng mật khẩu + TOTP; đăng xuất; không có lỗi JavaScript trên trang. Không chạy lại toàn bộ 20 ca trong đợt sửa trình bày này; kết quả toàn bộ phía trên thuộc ngày 15/10/2026.

Đã thay ảnh 01-login, 08-credentials và 09-totp. Ảnh tài khoản/TOTP được chụp trước khi nhập bí mật. Các ảnh nghiệp vụ khác giữ từ lần kiểm thử toàn bộ trước.
