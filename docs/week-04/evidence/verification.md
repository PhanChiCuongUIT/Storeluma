# Kết quả kiểm thử tuần 4

Ngày kiểm tra: 15/10/2026. Phiên bản: 0.4.0.

Môi trường: Chromium, PostgreSQL, RabbitMQ, Keycloak và các dịch vụ Storeluma chạy bằng Docker Compose. Bộ kiểm thử dùng tài khoản và dữ liệu mẫu riêng; không giả lập phản hồi API.

Kết quả: **18/18 ca đạt**, không bỏ qua và không flaky. Thời gian toàn bộ lần chạy: **20.5 giây**. Build và kiểm tra kiểu TypeScript đạt.

| Ca kiểm thử | Kết quả | Thời gian |
| --- | --- | --- |
| W4-01 Password + TOTP, server session, no browser tokens | Đạt | 0.10 s |
| W4-02 Unauthenticated and forged identity denied | Đạt | 0.49 s |
| W4-03 Missing CSRF and foreign Origin denied | Đạt | 0.06 s |
| W4-04 Concurrent create retry creates one tenant and first site | Đạt | 0.24 s |
| W4-05 Warehouse and register acknowledge before ACTIVE | Đạt | 0.60 s |
| W4-06 Different tenant and forged tenant/subject headers denied | Đạt | 0.09 s |
| W4-07 Finance outage keeps new site pending, old site stays active | Đạt | 4.35 s |
| W4-08 Replayed event does not duplicate warehouse/register | Đạt | 0.24 s |
| W4-09 Invitation requires owner confirmation and exact recipient; one use | Đạt | 0.23 s |
| W4-10 Cashier limited to assigned site and cannot grant rights | Đạt | 0.42 s |
| W4-11 Block takes effect in existing session; stale permission update rejected | Đạt | 0.15 s |
| W4-12 Owner cannot remove own final ownership | Đạt | 0.05 s |
| W4-13 Site optimistic locking and suspension gate | Đạt | 0.17 s |
| W4-14 Restart retains data, context and audit | Đạt | 3.06 s |
| W4-15 Database roles cannot connect to another service database | Đạt | 0.02 s |
| W4-16 Browser creates site, renders staff and audit; mobile layout | Đạt | 4.61 s |
| W4-17 Expired server session rejected | Đạt | 0.04 s |
| W4-18 Logout deletes BFF session and ends Keycloak login | Đạt | 0.44 s |

W4-16 còn kiểm tra ảnh logo tải thành công và khóa/mở quyền thành viên bằng biểu mẫu, sau đó đối chiếu quyền truy cập tại API. Chín ảnh trong [screenshots/](screenshots/) được chụp từ bản chạy sau khi hoàn thiện nhận diện Storeluma; hai ảnh xác thực được chụp trước khi nhập mật khẩu hoặc mã TOTP.

## Chạy lại

Từ thư mục gốc dự án, sau khi khởi động Docker Compose:

```powershell
npx playwright install chromium
npm test
```

Bộ kiểm thử tạo dữ liệu mới, dừng/khởi động Finance và khởi động lại Business/Gateway. Kết quả chi tiết được tạo tại `docs/week-04/evidence/playwright-results.json`, `playwright-report/` và `test-results/` trên máy chạy. Các tệp này được bỏ qua bởi Git; workflow CI lưu chúng thành artifact của lần chạy.

Kết quả trên xác nhận các luồng nền trong tuần 4. Chưa bao gồm kiểm thử tải, nhiều trình duyệt, sao lưu/phục hồi hay nghiệm thu triển khai production. Các ca thử tương ứng được giải thích trong báo cáo tuần 4.
