# Kiểm chứng phiên bản 0.7.0

- Cục bộ: Windows/Docker Linux containers; PostgreSQL 17, RabbitMQ 4.1, Keycloak 26.4.7, Node.js 24, Chromium.
- Build/TypeScript: đạt. `npm audit --omit=dev`: 0 lỗ hổng tại ngày kiểm tra.
- Tuần 7 + migration: bắt đầu 26/10/2026 16:25:02 (Asia/Ho_Chi_Minh), 188.5 giây: **28/28 đạt** (27 W7 + 1 MIG).
- Hồi quy riêng: bắt đầu 26/10/2026 10:49:16, 332.8 giây: **56/56 đạt** (6 AUTH + 25 W5 + 25 W6).
- Kiểm lại UI W7-21/22 sau chỉnh bố cục và trạng thái ca: bắt đầu 26/10/2026 16:44:35, 38.8 giây: **2/2 đạt**; bao gồm phiên khác đóng ca trước khi mở form.
- Các lượt kiểm thử cục bộ đều không có ca bị bỏ qua, flaky hoặc retry.
- CI đầy đủ trên Ubuntu/Docker mới: **104/104 đạt**. Commit `9e3e4b9fdb20ed100993ac9318118f77f5ab13f9`. [GitHub Actions](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/40300242656).

| Mã | Nội dung | Kết quả |
| --- | --- | --- |
| W7-01 | Quote do server tính, gộp dòng cùng đơn vị, phân bổ giảm giá đúng đồng. | Đạt |
| W7-02 | Giới hạn giảm 5% của thu ngân, vai trò và cô lập hộ. | Đạt |
| W7-03 | Lặp tạo nháp cùng key không nhân đôi; hủy nháp không đổi kho/tiền. | Đạt |
| W7-04 | Quote hết hạn chặn checkout, không tạo giao dịch thu tiền. | Đạt |
| W7-05 | Giá Catalog thay đổi cần lấy quote và xác nhận lại. | Đạt |
| W7-06 | Giữ PREPARED, xác nhận tiền thật, một ledger và vốn đúng. | Đạt |
| W7-07 | Replay checkout/commit giữ cùng ID, không trừ kho lần hai. | Đạt |
| W7-08 | Hủy void payment trước release PREPARED; không thu sau hủy. | Đạt |
| W7-09 | Đơn nhiều dòng thiếu hàng không giữ dở dòng còn lại. | Đạt |
| W7-10 | 20 đơn tranh một đơn vị tồn: chỉ một đơn được bán. | Đạt |
| W7-11 | SKU đang kiểm kho chặn checkout mà chưa thu tiền. | Đạt |
| W7-12 | PREPARED không hết hạn khi đang chờ người dùng thu tiền. | Đạt |
| W7-13 | Chặn đóng ca có payment chờ; đầu ca không thành doanh thu. | Đạt |
| W7-14 | Confirm và cancel cạnh tranh cho một kết quả cuối nhất quán. | Đạt |
| W7-15 | Finance gián đoạn: giữ hàng, phục hồi cùng payment ID. | Đạt |
| W7-16 | Đã thu tiền, Inventory ngừng và Sales restart: tiếp tục xuất một lần. | Đạt |
| W7-17 | Saga đã tiếp nhận hoàn tất dù người thực hiện bị đổi quyền. | Đạt |
| W7-18 | Ẩn vốn theo API và quyền mở nguồn SALE từ thẻ kho. | Đạt |
| W7-19 | Chặn internal endpoint từ Gateway và token dịch vụ giả. | Đạt |
| W7-20 | Sự kiện hoàn tất duy nhất, Sales không được kết nối DB Inventory. | Đạt |
| W7-21 | UI thật từ tìm hàng đến thu tiền; làm mới quote; màn hình 390 px. | Đạt |
| W7-22 | Đóng ca ghi tiền đếm/chênh lệch và chặn checkout ca cũ. | Đạt |
| W7-23 | ACTIVE hết hạn giải phóng lượng; không prepare lại lượt hết hạn. | Đạt |
| W7-24 | FAILED chặn create đến muộn; không commit/release sớm PREPARED. | Đạt |
| W7-25 | Khác đơn vị cùng SKU: một movement, tổng giảm giá/vốn chính xác. | Đạt |
| W7-26 | Broker ngừng vẫn hoàn tất cash; Outbox gửi lại khi phục hồi. | Đạt |
| W7-27 | Quy đổi không chính xác và tổng tràn số trả 400 trước khi lưu quote. | Đạt |

MIG-01 kiểm migration 001/002 có dữ liệu → 003 kiểm kho → 004 giữ hàng, giữ lịch sử; chạy đồng thời/lặp và rollback lỗi. Các thay đổi trực tiếp DB trong test chỉ dành cho fixture hết hạn và bất biến, không thay thế nghiệp vụ qua API. Kiểm cạnh tranh chạy 20 đơn trên một đơn vị tồn; không phải kiểm chứng tải production.

Ảnh minh chứng được chụp từ ứng dụng với bộ dữ liệu thử nghiệm; thao tác qua API và UI.

Đã cập nhật dependency theo bản vá [body-parser](https://github.com/expressjs/body-parser/security/advisories/GHSA-27r3-jxmh-p828) và [multer](https://github.com/expressjs/multer/security/advisories/GHSA-q7qp-rjg7-q26m); không hạ phiên bản framework. CI bổ sung audit runtime và lưu ảnh tuần 7. Chưa có CD production, provider thanh toán điện tử, khôi phục mất DB hay nghiệp vụ trả hàng.

## Rà soát bổ sung ngày 27/10/2026

Xem [đối chiếu tuần 1-7](../review-weeks-01-07.md): 85/85 ca hồi quy trước sửa; 29/29 ca tuần 7 sau sửa; bổ sung W7-28 và W7-29. Bộ CI hiện tại gồm 106 ca. Các kết quả ở trên là mốc kiểm chứng ngày 26/10, được giữ để đối chiếu.
