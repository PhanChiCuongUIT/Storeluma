# Sản phẩm tuần 4 - Storeluma 0.4.0

Kỳ kế hoạch: 12/10-18/10/2026. Hoàn thiện báo cáo ngày 15/10/2026.
Sinh viên: Phan Chí Cường - 23520207. GVHD: ThS. Trần Anh Dũng.

## Khởi động

Cần Node.js 24, Docker Desktop đang chạy Linux containers và các cổng 4100, 8180, 55432, 5673, 15673 còn trống. Chạy trong thư mục gốc dự án:

```powershell
npm ci
npm run setup
docker compose up -d --build
docker compose ps
```

Chờ `http://localhost:4100/health` trả trạng thái `ok`, rồi mở **http://localhost:4100**. Keycloak cần thêm thời gian khởi động lần đầu. `npm run setup` giữ nguyên cấu hình đã có; không tự đặt lại mật khẩu hay xóa dữ liệu. CSDL và hàng đợi dùng Docker volumes.

## Đăng nhập và trình diễn

```powershell
node tools/demo-login.mjs owner
```

Lệnh trên chỉ hiện thông tin tài khoản mẫu trên máy cá nhân. Nhập username/password ở Keycloak; ở bước tiếp theo nhập TOTP sáu chữ số. Nếu mã gần hết hạn, chạy lại lệnh để lấy mã mới. Có thể thay `owner` bằng `cashier` hoặc `outsider` và mở cửa sổ ẩn danh riêng. Tài khoản mẫu được tạo để kiểm thử, không dùng cho vận hành thực tế. Việc đặt bí mật TOTP cùng mật khẩu trên máy chỉ phục vụ demo; triển khai thật cần thiết bị xác thực riêng.

1. Chọn **Tạo hộ kinh doanh**, nhập tên hộ và địa điểm đầu tiên, mã `CH01`.
2. Theo dõi địa điểm từ **Đang khởi tạo** sang **Sẵn sàng** khi kho và quầy đều phản hồi.
3. Thêm địa điểm `CH02`, chọn nơi làm việc, thử tạm ngừng rồi kích hoạt lại.
4. Đăng nhập tài khoản `cashier` ở cửa sổ riêng, lấy mã tài khoản hiển thị cuối trang.
5. Chủ hộ mở **Nhân sự**, mời đúng mã tài khoản, chọn vai trò và địa điểm, xác nhận người nhận. Chuyển mã lời mời trực tiếp cho người nhận; mã chỉ hiện một lần.
6. `cashier` chọn **Nhận lời mời**. Sau khi nhận, tài khoản chỉ nhìn thấy địa điểm đã giao. Tên tài khoản không tự quyết định quyền: quyền nằm trong membership của từng hộ.
7. Chủ hộ thử khóa thành viên, mở lại hoặc thay đổi phạm vi; xem **Lịch sử thao tác**.
8. Chọn **Đăng xuất**. Phiên ứng dụng và phiên đăng nhập Keycloak được kết thúc qua chuyển hướng.

Phiên hiện tại tối đa 15 phút; chưa tự làm mới token. Khi hết phiên, đăng nhập lại.

## Kiểm thử

```powershell
npx playwright install chromium
npm run typecheck
npm run build
npm test
```

Bộ kiểm thử dùng dịch vụ thật và tài khoản mẫu. Nó tạo dữ liệu trình diễn mới, dừng/khởi động Finance và khởi động lại Business/Gateway để kiểm tra khả năng phục hồi; chỉ chạy trong môi trường cục bộ này, khi không đang trình diễn. Dữ liệu cũ được giữ lại. Mỗi tài khoản được giới hạn 20 hộ trong bản đồ án; nếu chạy nhiều lần và chạm giới hạn, cần môi trường thử nghiệm mới, không xóa volume chứa dữ liệu cần giữ.

- [Tổng hợp kết quả kiểm thử](evidence/verification.md).
- Chạy `npm test` để tạo kết quả JSON và báo cáo Playwright trên máy chạy.
- Ảnh thật: `evidence/screenshots/`.
- Hợp đồng API và sự kiện: [api-contract.md](api-contract.md).
- Báo cáo: [PDF tuần 4](../../output/pdf/Storeluma_Bao_cao_Tuan_04.pdf).

## Phạm vi triển khai

Gateway/BFF phục vụ React và phiên đăng nhập; Business xử lý hộ, địa điểm, thành viên, lời mời và nhật ký. Inventory mới tạo kho; Finance mới tạo quầy. PostgreSQL có database và tài khoản riêng cho mỗi dịch vụ; RabbitMQ chuyển sự kiện, Outbox/Inbox hỗ trợ gửi lại và chống xử lý trùng.

Catalog, Sales, Reporting, Notification hiện chỉ có khung ứng dụng, migration và health endpoint; chưa có nghiệp vụ. Có thể bật bằng `docker compose --profile full up -d --build`. Bộ kiểm thử tuần 4 tập trung vào bốn ứng dụng Gateway/Business/Inventory/Finance và ba thành phần hạ tầng.

Môi trường hiện tại dùng HTTP loopback và Keycloak `start-dev`. Chưa triển khai Internet/HTTPS, gửi email, tự đăng ký tài khoản, nghiệp vụ hàng hóa/bán hàng, tự làm mới phiên, kiểm thử tải, backup/restore hoặc vận hành production. Workflow CI tại `.github/workflows/verify.yml` đã được đẩy lên GitHub; kết quả CI chưa được xác minh trong lần rà soát này.

## Dừng ứng dụng

```powershell
docker compose down
```

Lệnh này giữ Docker volumes. Không thêm `-v` nếu cần giữ dữ liệu. Giữ `.env` và `infra/generated/` riêng trên máy; không nộp mật khẩu, TOTP, cấu hình realm có bí mật hoặc ảnh chứa mã lời mời. PDF và minh chứng đã chọn không chứa các giá trị này.

## Nhận diện và giao diện sản phẩm

Giao diện dùng logo gốc tại `apps/web/public/brand/Logo_Storeluma.png`. Các nhãn về học phần, tuần và môi trường phát triển đã được gỡ khỏi ứng dụng. Theme xác thực tiếng Việt nằm tại `infra/keycloak/themes/storeluma/`; Compose gắn cùng tài nguyên logo vào theme.

Môi trường tạo mới nhận theme qua `npm run setup`. Với database đã có từ bản trước, sau khi cập nhật và chạy Compose, dùng `node tools/configure-branding.mjs` để áp dụng theme. Công cụ chỉ cập nhật cấu hình trình bày của realm và không đổi tài khoản, mật khẩu hoặc luồng xác thực.

Minh chứng cập nhật gồm chín ảnh: trang vào ứng dụng, địa điểm chờ/sẵn sàng, phạm vi thu ngân, nhân sự, nhật ký, giao diện hẹp và hai bước xác thực. Bộ kiểm thử còn thao tác khóa/mở thành viên bằng biểu mẫu rồi đối chiếu quyền tại API.

## Rà soát điều kiện hoàn thành

Đối chiếu đề cương tuần 4 và YC01–YC03 của tuần 2 tại [bảng nhiệm vụ và kết quả kiểm tra](evidence/verification.md). Bộ kiểm thử bổ sung kiểm tra ngữ cảnh khi đổi trạng thái/quyền và luồng tạo hộ, mời, nhận nhân viên hoàn toàn bằng giao diện.
