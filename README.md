# Storeluma

Storeluma là ứng dụng quản lý hoạt động kinh doanh dành cho chủ hộ và nhân viên, được xây dựng theo kiến trúc microservices. Phiên bản hiện tại tập trung vào quản lý hộ kinh doanh, địa điểm và quyền truy cập của nhân sự.

## Chức năng hiện có

- Đăng nhập bằng mật khẩu và mã xác thực TOTP qua Keycloak; đăng xuất và kết thúc phiên.
- Tạo hộ kinh doanh, thêm địa điểm, tạm ngừng hoặc kích hoạt lại địa điểm.
- Tự động khởi tạo kho và quầy cho địa điểm qua sự kiện RabbitMQ, hiển thị trạng thái sẵn sàng trên giao diện.
- Chọn hộ và địa điểm làm việc theo phạm vi được cấp quyền.
- Mời nhân viên, nhận lời mời, quản lý vai trò, phạm vi địa điểm và khóa hoặc mở lại thành viên.
- Xem lịch sử thao tác trong hộ kinh doanh.
- Giao diện tiếng Việt, hỗ trợ màn hình máy tính và điện thoại.

## Công nghệ và kiến trúc

| Thành phần | Công nghệ / vai trò |
| --- | --- |
| Giao diện | React, TypeScript, Vite |
| Backend | NestJS, Gateway/BFF và các dịch vụ nghiệp vụ |
| Xác thực | Keycloak, OpenID Connect, TOTP |
| Dữ liệu | PostgreSQL, database và tài khoản riêng cho từng dịch vụ |
| Sự kiện | RabbitMQ, Outbox/Inbox để gửi lại và chống xử lý trùng |
| Môi trường chạy | Docker Compose |
| Kiểm thử | Playwright |

Gateway phục vụ giao diện và quản lý phiên đăng nhập. Business xử lý hộ kinh doanh, địa điểm, thành viên và nhật ký. Inventory và Finance tiếp nhận sự kiện để tạo kho và quầy.

Catalog, Sales, Reporting và Notification hiện có khung dịch vụ, migration và health endpoint; chưa triển khai nghiệp vụ hàng hóa, bán hàng, báo cáo hoặc thông báo.

## Cài đặt và chạy

Yêu cầu Node.js 24 trở lên và Docker có hỗ trợ Linux containers. Các cổng `4100`, `8180`, `55432`, `5673`, `15673` cần còn trống.

```sh
git clone https://github.com/PhanChiCuongUIT/Storeluma.git
cd Storeluma
npm ci
npm run setup
docker compose up -d --build
docker compose ps
```

Chờ các dịch vụ sẵn sàng, sau đó mở [http://localhost:4100](http://localhost:4100). Có thể kiểm tra Gateway tại [http://localhost:4100/health](http://localhost:4100/health).

Lệnh `npm run setup` sinh cấu hình và tài khoản mẫu trên máy, giữ nguyên cấu hình đã có. Các tệp `.env` và `infra/generated/` chứa thông tin riêng của môi trường và không được lưu trong Git.

### Đăng nhập

Lấy thông tin tài khoản chủ hộ và mã TOTP để chạy thử:

```sh
node tools/demo-login.mjs owner
```

Đăng nhập bằng tên tài khoản, mật khẩu và mã TOTP được hiển thị. Nếu mã hết hạn, chạy lại lệnh để lấy mã mới. Có thể thay `owner` bằng `cashier` hoặc `outsider` để kiểm tra quyền truy cập bằng tài khoản khác.

Sau khi đăng nhập, tạo hộ kinh doanh và địa điểm đầu tiên. Khi địa điểm chuyển sang **Sẵn sàng**, chọn địa điểm làm việc và quản lý nhân viên trong mục **Nhân sự**. Quyền truy cập phụ thuộc vào vai trò và địa điểm được cấp trong từng hộ.

### Dừng ứng dụng

```sh
docker compose down
```

Dữ liệu được lưu trong Docker volumes và vẫn được giữ sau khi dừng ứng dụng.

## Kiểm tra mã nguồn và chức năng

```sh
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Cần khởi động các dịch vụ trước khi chạy `npm test`. Bộ kiểm thử sử dụng backend và cơ sở dữ liệu thật, tạo dữ liệu kiểm thử và dừng/khởi động một số dịch vụ để kiểm tra khả năng phục hồi. Chạy bộ kiểm thử trong môi trường riêng dành cho phát triển và kiểm thử.

## Cấu trúc dự án

| Đường dẫn | Nội dung |
| --- | --- |
| `apps/web` | Giao diện và tài nguyên Storeluma |
| `services` | Gateway, các dịch vụ nghiệp vụ và migration |
| `packages/platform` | Thành phần dùng chung cho dữ liệu, HTTP và sự kiện |
| `infra/keycloak` | Theme đăng nhập tiếng Việt |
| `tests` | Kiểm thử tích hợp và giao diện |
| `tools` | Công cụ thiết lập môi trường và cấu hình ứng dụng |
| `compose.yaml` | Cấu hình các dịch vụ và hạ tầng Docker |

## Trạng thái phát triển

Ứng dụng hiện chạy bằng Docker Compose trên máy cá nhân, dùng HTTP và Keycloak ở chế độ phát triển. Tài khoản mẫu phục vụ kiểm thử. Phiên đăng nhập có thời hạn 15 phút; khi hết phiên, người dùng cần đăng nhập lại.

Chưa triển khai môi trường production, HTTPS, tự đăng ký tài khoản, gửi email, tự làm mới phiên hoặc quy trình sao lưu và khôi phục dữ liệu. Các nghiệp vụ hàng hóa và bán hàng chưa có trong phiên bản hiện tại.
