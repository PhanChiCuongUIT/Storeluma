# Kết quả kiểm chứng tuần 10

## Lượt hồi quy đầy đủ

- Bắt đầu: **16/11/2026 09:48:09**, giờ Việt Nam; thời gian **1103.9 giây**.
- Lệnh: `npm test`, không loại file hoặc nhóm test; **179/179 đạt, 0 lỗi, 0 bỏ qua, 0 flaky**. Cấu hình retries=0.
- Môi trường: Windows, Node.js 24, Chromium, Docker Linux containers; PostgreSQL 17, RabbitMQ 4.1, Keycloak/TOTP và các backend thật.
- Dùng Compose project và volume mới, tách dữ liệu đang sử dụng; các ca migration tạo database riêng và kiểm tra nâng cấp dữ liệu cũ.
- `npm run build`: đạt, gồm TypeScript backend/frontend và Vite. `npm audit --omit=dev`: **0 lỗ hổng** tại lần kiểm tra 16/11/2026.

## Các lượt riêng và phạm vi

- Nửa đầu: 11/11 ca phân quyền; CI của commit `52f1331` đạt 171/171: [GitHub Actions](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/43612328843).
- Nửa sau: 8/8 ca tích hợp mới đạt khi chạy riêng, sau đó được chạy lại trong lượt 179 ca ở trên. Không cộng hai lần các ca chạy lại.
- W10 gồm 19 ca: [ma trận đầu vào, thao tác và kết quả](../test-plan.md). Có kiểm response cùng movement, payable, ledger, trạng thái nguồn và số liệu báo cáo; fixture W10 tạo qua API, không sửa dữ liệu bằng SQL.
- Ảnh sau lượt đầy đủ: [bán hàng](screenshots/01-sales.png), [tồn](screenshots/02-stock.png), [tiền quầy](screenshots/03-cash.png), [390 px](screenshots/04-mobile.png).
- CI hiện chạy toàn bộ test trên Ubuntu mới và lưu ảnh tuần 10 trong artifact. Trạng thái của commit bàn giao được công bố bởi check GitHub Actions gắn với commit đó.

## Giới hạn

Chưa đo tải/p95, chưa nghiệm thu máy in vật lý, HTTPS, backup/restore hoặc production. Hồ sơ khách, trả nhà cung cấp và đối soát hợp nhất còn thiếu; xem [đối chiếu tuần 1-10](../review-weeks-01-10.md). Kết quả test không được hiểu là đã hoàn tất mọi yêu cầu cuối kỳ.
