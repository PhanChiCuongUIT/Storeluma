# Minh chứng kiểm thử tuần 11

Lượt hồi quy bắt đầu lúc 09:30:35 ngày 22/11/2026 (giờ Việt Nam), kéo dài 19.2 phút. Chạy `npm test` trên cơ sở dữ liệu Compose mới, với PostgreSQL, RabbitMQ, Keycloak và các dịch vụ nghiệp vụ. 189 ca đạt ngay lượt đầu, 0 ca lỗi, 0 ca bỏ qua. Bản dựng TypeScript/Vite thành công. Kiểm tra phụ thuộc runtime bằng npm audit ghi nhận 0 lỗ hổng tại ngày chạy.

| Bộ kiểm thử | Số ca đạt |
| --- | ---: |
| [appearance.spec.ts](../../../tests/appearance.spec.ts) | 5 |
| [architecture.spec.ts](../../../tests/architecture.spec.ts) | 1 |
| [auth.spec.ts](../../../tests/auth.spec.ts) | 6 |
| [migration-finance.spec.ts](../../../tests/migration-finance.spec.ts) | 1 |
| [migration.spec.ts](../../../tests/migration.spec.ts) | 1 |
| [ui.spec.ts](../../../tests/ui.spec.ts) | 2 |
| [week04.spec.ts](../../../tests/week04.spec.ts) | 20 |
| [week05.spec.ts](../../../tests/week05.spec.ts) | 25 |
| [week06.spec.ts](../../../tests/week06.spec.ts) | 25 |
| [week07.spec.ts](../../../tests/week07.spec.ts) | 29 |
| [week08.spec.ts](../../../tests/week08.spec.ts) | 31 |
| [week09.spec.ts](../../../tests/week09.spec.ts) | 14 |
| [week10-access.spec.ts](../../../tests/week10-access.spec.ts) | 11 |
| [week10-integration.spec.ts](../../../tests/week10-integration.spec.ts) | 8 |
| [week11-messaging.spec.ts](../../../tests/week11-messaging.spec.ts) | 4 |
| [week11-saga.spec.ts](../../../tests/week11-saga.spec.ts) | 6 |

## Phép đo độc lập trên Compose

- Tải nền 10.000 SKU và 10.000 đơn nháp. Mười phiên đăng nhập, 600 lượt bán tiền mặt, 0 lỗi. P95 tra SKU 142.6 ms, nhận lệnh 98.1 ms và hoàn tất đơn 2212.4 ms.
- Mất kết nối Finance trong khi ghi 100 phiếu nhập. Tính từ lệnh khởi động lại, ghi đủ 100 khoản phải trả trong 2.41 giây. Tổng công nợ 40.000.000 đồng khớp 1.000 đơn vị hàng đã nhập.
- Sau 600 đơn, sổ quỹ có 600 dòng thu, tổng 60.000.000 đồng. Thẻ kho có 600 dòng xuất, tổng giá vốn 24.000.000 đồng. Báo cáo tổng hợp ghi lãi gộp 36.000.000 đồng.

Số đo chi tiết, cấu hình và phạm vi áp dụng nằm trong [báo cáo tuần](../bao-cao-tuan-11.md). Có thể lặp lại trên tập dữ liệu riêng theo [hướng dẫn đo tải](../../../benchmarks/README.md).
