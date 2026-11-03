# Kiểm chứng phiên bản 0.8.0

- Windows, Docker Linux containers, Node.js 24, PostgreSQL 17, RabbitMQ 4.1, Keycloak 26.4.7 và Chromium.
- Build/TypeScript đạt; audit runtime: 0 lỗ hổng tại lượt kiểm tra.
- Bắt đầu **01/11/2026 22:45:18 (Asia/Ho_Chi_Minh)**, 779.6 giây: **116/116 đạt**, không skipped/flaky/retry.
- Thành phần: 6 AUTH + 2 MIG + 25 W5 + 25 W6 + 29 W7 + 29 W8. Đây là một lượt liên tục sau các chỉnh sửa nghiệp vụ; phần hiển thị biên nhận được kiểm lại ở lượt UI bên dưới.
- Kiểm lại UI và chụp vùng thao tác bắt đầu 02/11/2026 10:08:17: W8-26 đến W8-29 **4/4 đạt**, không retry; kết quả riêng không cộng thành số ca nghiệp vụ mới.
- 17 kiểm tra đối chiếu dữ liệu đạt: tồn/thẻ kho, lượng giữ, vốn, tiền thu/hoàn, ca, sự kiện và database isolation.
- Tại lần bàn giao ban đầu, CI cấu hình chạy **136 ca** trên Docker mới, gồm thêm 20 W4. Kết quả gắn với từng commit: [Verify Storeluma](https://github.com/PhanChiCuongUIT/Storeluma/actions/workflows/verify.yml). Lượt cục bộ 116 ca ở trên không được cộng thành kết quả CI.

| Mã | Kiểm chứng | Kết quả |
| --- | --- | --- |
| W8-01 | Biên nhận chỉ từ đơn hoàn tất; snapshot, in lại và quyền xem. | Đạt |
| W8-02 | Tiền hoàn theo dòng sau giảm giá; chưa duyệt chưa đổi tồn/tiền. | Đạt |
| W8-03 | Một phiếu đang xử lý trên mỗi đơn; lặp key không nhân đôi. | Đạt |
| W8-04 | Chặn vượt lượng, dòng lạ, dòng trùng và payload không hợp lệ. | Đạt |
| W8-05 | Quyền duyệt, tách người lập/duyệt; ngoại lệ chủ hộ duy nhất. | Đạt |
| W8-06 | Nhận hàng trước hoàn tiền; xác nhận đồng thời và chặn đóng ca. | Đạt |
| W8-07 | Lặp nhận/hoàn không tạo thêm movement, ledger hoặc sự kiện. | Đạt |
| W8-08 | Trả nốt lượng còn lại, giữ nguyên đơn và vốn gốc. | Đạt |
| W8-09 | Lượng lẻ: làm tròn lũy kế, trả đủ khớp tiền/vốn ban đầu. | Đạt |
| W8-10 | Hàng cách ly giữ giá trị tồn, không tăng lượng khả dụng. | Đạt |
| W8-11 | Đang kiểm kho chặn nhận trả; tiếp tục sau khi hết khóa. | Đạt |
| W8-12 | Finance gián đoạn sau nhận hàng: phục hồi một lần hoàn. | Đạt |
| W8-13 | Khởi động lại Sales: tiếp tục Saga đã lưu, không lặp hàng/tiền. | Đạt |
| W8-14 | Inventory gián đoạn: chưa hoàn tiền trước khi nhận hàng. | Đạt |
| W8-15 | Trả quá 7 ngày bắt buộc lý do duyệt ngoại lệ. | Đạt |
| W8-16 | Hủy phiếu chưa duyệt giải phóng lượng có thể trả. | Đạt |
| W8-17 | Vai trò, cô lập hộ, chặn API nội bộ và ẩn giá vốn. | Đạt |
| W8-18 | Đối soát đầu ca 500.000 + bán 200.000 - hoàn 50.000 - chi 20.000. | Đạt |
| W8-19 | Chênh lệch cần xác nhận; tiền ca đã đóng giữ nguyên. | Đạt |
| W8-20 | Đảo thu/chi bằng chứng từ mới ở ca mở, không sửa ca cũ. | Đạt |
| W8-21 | Đóng ca cạnh tranh ghi tiền: một thứ tự commit nhất quán. | Đạt |
| W8-22 | Trả đơn của ca cũ; hoàn tiền tại ca mới cùng địa điểm. | Đạt |
| W8-23 | RabbitMQ gián đoạn: Outbox gửi lại, không lặp hiệu ứng. | Đạt |
| W8-24 | Đổi quyền sau duyệt không làm mất Saga đã tiếp nhận. | Đạt |
| W8-25 | Đổi tên hàng không đổi biên nhận; lọc ngày từ bao gồm/đến loại trừ. | Đạt |
| W8-26 | POS thật: F2, quét/gộp dòng, thu tiền, biên nhận 80 mm và in lại. | Đạt |
| W8-27 | UI lập phiếu, duyệt, cách ly và xác nhận hoàn từng phần. | Đạt |
| W8-28 | UI chi quầy, chốt ca, xác nhận lệch; lịch sử ca đúng bố cục. | Đạt |
| W8-29 | UI 390/768 px không tràn; mở ca từ tab khác hiện đúng form. | Đạt |

MIG-01 nâng Inventory tới 005 với dữ liệu cũ, concurrent startup/replay và rollback lỗi. MIG-02 nâng Finance 001-004 tới 005, giữ closed shift/payment/ledger, kiểm một nguồn ledger và refund âm.

Ảnh được chụp từ ứng dụng thật trong lượt kiểm lại UI. In được kiểm qua window.print và CSS print 80 mm, chưa qua máy in vật lý. Kiểm phục hồi dừng dịch vụ/khởi động lại và broker outage không thay thế kiểm backup/restore hoặc tải production. Bộ test tuần 4 chạy ở CI môi trường mới; không dùng lượt cục bộ này để khẳng định 136 ca đã đạt.


## Rà soát ngày 03/11/2026

Hai ca W8-30/W8-31 tái hiện lỗi trên bản trước sửa: danh sách trả ca người khác và bốn lệnh có kết quả lưu trả 201 thay vì 403. Sau sửa, lượt riêng đạt 2/2; sau đó chạy hồi quy liên tục bắt đầu **03/11/2026 17:28:56 (Asia/Ho_Chi_Minh)**: **118/118 đạt** trong 789.0 giây, không skipped/flaky/retry.

| Bộ kiểm thử | Số ca đạt cục bộ |
| --- | --- |
| AUTH | 6 |
| Migration Inventory/Finance | 2 |
| Tuần 5 | 25 |
| Tuần 6 | 25 |
| Tuần 7 | 29 |
| Tuần 8 | 31 |
| Tổng | 118 |

W8-30 kiểm lọc ca tại API, trạng thái quầy không có tiền/ghi chú, chặn mở ca trùng trên UI, quyền đọc OWNER/MANAGER/ACCOUNTANT và CASHIER. W8-31 kiểm quyền trước cache cho xác nhận thu, chuẩn bị/xác nhận hoàn và đóng ca; vẫn replay hợp lệ sau đóng, chỉ ghi một lần thu và hoàn. Ảnh `10-cashier-shift-scope.png` được chụp từ ứng dụng trong lượt riêng W8-30 ngày 03/11; lượt 118 ca kiểm lại cùng thao tác.

Build/TypeScript đạt. Đối chiếu dữ liệu sau chạy **17/17 đạt**: tồn/thẻ kho/giá vốn, reservation, đơn và payment, refund và hàng trả, ledger, ca đóng, khoản phải trả, sự kiện và quyền CONNECT giữa các database. Runtime dependency audit: 0 lỗ hổng tại lượt kiểm tra.

Môi trường cục bộ hiện có dữ liệu tích lũy; 20 W4 được dành cho CI môi trường mới để không tăng hộ vượt giới hạn tài khoản thử nghiệm. Workflow hiện chạy **138 ca** (118 trên cộng 20 W4). Kiểm tra kết quả của đúng commit tại [Verify Storeluma](https://github.com/PhanChiCuongUIT/Storeluma/actions/workflows/verify.yml); các số 116/136 ở phần trước là phạm vi của lần bàn giao ban đầu.

Các lượt riêng và lượt hồi quy không cộng dồn thành số ca mới. Không suy ra tải production, khả năng nhiều replica, máy in thật hoặc backup/restore từ các kết quả này. Xem [đối chiếu tuần 1-8](../review-weeks-01-08.md) để biết yêu cầu còn thiếu.
