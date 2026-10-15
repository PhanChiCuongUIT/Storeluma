# Storeluma

Đồ án 2 của Phan Chí Cường (23520207).

[Đề cương và kế hoạch thực hiện](output/pdf/Storeluma_De_cuong_Do_an_2.pdf) là sản phẩm tuần 1.

## Sản phẩm và báo cáo tuần 4

Nền ứng dụng chạy bằng Docker: đăng nhập mật khẩu + TOTP, hộ/địa điểm, khởi tạo kho/quầy qua RabbitMQ, thành viên và phân quyền theo hộ/địa điểm, nhật ký thao tác.

- [Hướng dẫn chạy, đăng nhập và trình diễn](docs/week-04/README.md).
- [Báo cáo PDF tuần 4](output/pdf/Storeluma_Bao_cao_Tuan_04.pdf).
- [Hợp đồng API và sự kiện](docs/week-04/api-contract.md).

Khởi động nhanh: `npm ci`, `npm run setup`, `docker compose up -d --build`; mở http://localhost:4100. Lấy thông tin tài khoản mẫu trên máy bằng `node tools/demo-login.mjs owner`.

## Báo cáo tuần 3

- [Báo cáo PDF để nộp giảng viên](output/pdf/Storeluma_Bao_cao_Tuan_03.pdf).
- [Nội dung, sơ đồ và mẫu màn hình](docs/week-03/bao-cao-tuan-03.md).
- [Tài liệu và sơ đồ tuần 3](docs/week-03/README.md).

Kết quả phân tích nghiệp vụ, 13 sơ đồ, 7 mẫu màn hình và đối chiếu 24 yêu cầu tuần 2. Kỳ kế hoạch 05/10-11/10/2026; báo cáo hoàn thiện ngày 14/10/2026.

## Báo cáo tuần 2

- [Báo cáo PDF để nộp giảng viên](output/pdf/Storeluma_Bao_cao_Tuan_02.pdf).
- [Bản nội dung có thể chỉnh sửa](docs/week-02/bao-cao-tuan-02.md).
- [Thông tin tài liệu tuần 2](docs/week-02/README.md).

Báo cáo tổng hợp công việc tuần 28/09–04/10/2026: khảo sát sản phẩm tương tự, nhu cầu ban đầu, yêu cầu và chức năng ưu tiên. Toàn bộ sản phẩm tuần 2 nằm trong cùng báo cáo; ngày lập là 03/10/2026.

## Cấu trúc dự án

| Thư mục | Nội dung |
| --- | --- |
| `apps/web` | Giao diện React và tài nguyên nhận diện Storeluma |
| `services` | Gateway và các dịch vụ nghiệp vụ, migration riêng |
| `packages/platform` | Hạ tầng dùng chung: xác thực, database, sự kiện |
| `infra/keycloak` | Theme xác thực tiếng Việt |
| `tests` | Kiểm thử tích hợp và giao diện bằng Playwright |
| `tools` | Thiết lập môi trường, truy cập tài khoản mẫu, cấu hình theme |
| `docs` | Báo cáo nội dung, thiết kế, API và minh chứng |
| `output/pdf` | Báo cáo hoàn chỉnh theo tuần |

## Kiểm tra

```powershell
npm run typecheck
npm run build
npx playwright install chromium
npm test
```

Cần khởi động các dịch vụ trước khi chạy `npm test`. Bộ kiểm thử chủ động dừng/khởi động một số dịch vụ và tạo dữ liệu kiểm thử. Xem [kết quả tuần 4](docs/week-04/evidence/verification.md) và [hướng dẫn chi tiết](docs/week-04/README.md).

Cấu hình bí mật được sinh riêng bằng `npm run setup`, không lưu trong Git. Môi trường hiện tại dùng Docker Compose trên máy cá nhân; phạm vi tuần 4 chưa bao gồm triển khai Internet/HTTPS. Các dịch vụ Catalog, Sales, Reporting và Notification mới có khung ứng dụng; chức năng nghiệp vụ được phát triển ở các tuần tiếp theo.
