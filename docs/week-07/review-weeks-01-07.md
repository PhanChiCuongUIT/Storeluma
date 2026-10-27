# Rà soát tiến độ tuần 1-7

Ngày rà soát: **27/10/2026**. Phiên bản: **0.7.0**.

## Đối chiếu kế hoạch và sản phẩm

| Tuần | Đầu ra theo đề cương | Kết quả đối chiếu |
| --- | --- | --- |
| 1 | Đề cương, phạm vi và kế hoạch cá nhân | Đề cương có mục tiêu, phạm vi và lịch 13 tuần; dùng làm căn cứ phân chia công việc. |
| 2 | Khảo sát, yêu cầu và chức năng ưu tiên | [Báo cáo tuần 2](../week-02/bao-cao-tuan-02.md): khảo sát tài liệu sản phẩm, 24 yêu cầu chức năng, yêu cầu chất lượng và ưu tiên. Phạm vi khảo sát chưa gồm phỏng vấn cửa hàng. |
| 3 | Phân tích nghiệp vụ, sơ đồ và phác thảo UI | [Bộ thiết kế](../week-03/bao-cao-tuan-03.md): 14 nhóm nghiệp vụ, 13 sơ đồ, 7 mẫu màn hình, truy vết yêu cầu và tình huống kiểm tra thiết kế. |
| 4 | Nền hệ thống, đăng nhập, hộ/địa điểm, quyền | Keycloak/OIDC/TOTP, BFF, Business, provisioning kho/quầy, nhân sự, quyền theo hộ/site và audit; 20 W4 + 6 AUTH. |
| 5 | Danh mục, nhà cung cấp, nhập hàng | Catalog, đơn vị/giá, nhà cung cấp, nhập có snapshot, tồn và payable; 25 W5. Nhập tồn đầu không tạo công nợ. |
| 6 | Tồn, lịch sử nhập xuất và kiểm kho | Balance, thẻ kho, kiểm có freeze/duyệt, điều chỉnh/cách ly/xuất hủy; 25 W6 và migration giữ dữ liệu cũ. |
| 7 | Đơn bán và phối hợp kho, tài chính | Báo giá, nháp, giữ hàng, xác nhận tiền mặt, xuất bán, hủy và phục hồi Saga; 29 W7 sau bổ sung. Mở/đóng ca ở phạm vi tối thiểu phục vụ bán tiền mặt. |

Các đầu ra cốt lõi đến tuần 7 đã có và đủ làm nền cho tuần 8 trong phạm vi bán tiền mặt cho khách lẻ. Việc này chưa phải nghiệm thu toàn bộ các chức năng cuối kỳ hoặc môi trường production.

## Phát hiện và điều chỉnh

**Yêu cầu nháp lặp sau hết hạn báo giá.** Khi server đã lưu đơn nhưng trình duyệt chưa nhận được phản hồi, gửi lại cùng `Idempotency-Key` sau thời hạn 120 giây bị từ chối bằng `409 QUOTE_EXPIRED`. Ca W7-29 tái hiện lỗi trên phiên bản trước sửa. Tạo/sửa nháp nay đọc báo giá để kiểm tenant/site và quyền, rồi kiểm hạn khi thực hiện lần ghi mới trong transaction. Yêu cầu đã có kết quả trả lại đúng đơn/phiên bản. Nội dung khác với cùng key vẫn trả 409; báo giá cũ không tạo đơn mới; thu hồi quyền vẫn chặn replay.

**Phục hồi đơn chưa thu tiền.** Bổ sung W7-28: restart Sales khi đơn đã PREPARED, payment PENDING. Không tự thu tiền, không xuất hàng, không tăng lượng giữ. Sau xác nhận tiền vẫn dùng cùng payment/reservation và chỉ có một Saga, một ledger, một movement SALE.

**Tài liệu.** Sửa nhãn tiếng Việt bị lỗi mã hóa trong README tiếng Anh. Báo cáo tuần 7 thêm kết quả lần rà soát, sử dụng cùng mẫu chữ/bìa/bảng với tuần 2-6. Ảnh đơn hoàn tất được cập nhật từ kiểm thử giao diện sau sửa.

## Kết quả chạy thực tế

Môi trường cục bộ: Windows, Docker Linux containers, PostgreSQL 17, RabbitMQ 4.1, Keycloak 26.4.7, Node.js 24 và Chromium. Dữ liệu hiện có được giữ nguyên; bộ kiểm thử dùng dữ liệu nghiệp vụ riêng.

| Lượt kiểm tra | Thời điểm bắt đầu (Asia/Ho_Chi_Minh) | Kết quả |
| --- | --- | --- |
| AUTH + MIG + W5 + W6 + W7 trước sửa | 27/10/2026 13:30:47 | 85/85 đạt; 509.5 giây. Gồm 28 W7 tại thời điểm chạy. |
| Tái hiện W7-29 trước sửa | 27/10/2026 13:39:28 | 1 ca thất bại đúng lỗi QUOTE_EXPIRED khi gửi lại nháp đã lưu. |
| Toàn bộ W7 sau sửa | 27/10/2026 13:40:44 | 29/29 đạt; 185.7 giây. Bao gồm W7-28/29 và UI desktop/390 px. |
| Build, TypeScript | 27/10/2026 | Đạt sau sửa. |
| Kiểm tra thư viện runtime | 27/10/2026 | `npm audit --omit=dev`: 0 lỗ hổng được công cụ ghi nhận. |
| Đối chiếu dữ liệu và quyền database | 27/10/2026 | 9/9 kiểm tra đạt. |

Hai lượt kiểm thử đạt ở trên không có ca bị bỏ qua, flaky hoặc retry. Đây là hai lượt độc lập; kết quả 85 ca được ghi trước bản sửa. Bộ CI hiện tại gồm **106 ca**: 6 AUTH + 1 MIG + 20 W4 + 25 W5 + 25 W6 + 29 W7. [Verify Storeluma](https://github.com/PhanChiCuongUIT/Storeluma/actions/workflows/verify.yml) chạy toàn bộ trên Docker mới, kèm JSON/HTML, ảnh, trạng thái container và kết quả audit/build cho từng commit.

Đối chiếu dữ liệu đọc riêng từng database, không thêm truy vấn chéo vào mã ứng dụng:

- Tổng movement khớp số lượng và giá trị tồn; tồn khả dụng không âm, bình quân vốn đúng.
- Lượng reserved khớp tổng reservation ACTIVE/PREPARED.
- Payment SUCCEEDED có đúng một ledger với số tiền tương ứng; payment chưa thành công không có ledger.
- Tổng các dòng đơn khớp tiền hàng, giảm giá và phải trả; mỗi đơn COMPLETED có một sự kiện hoàn tất.
- 53 đơn hoàn tất khớp payment, reservation, movement và tổng vốn theo dữ liệu kiểm tra.
- 44 phiếu mua đã ghi sổ khớp khoản phải trả; không ghi trùng theo phiếu.
- Kiểm quyền CONNECT giữa sáu database ứng dụng: tài khoản dịch vụ không được kết nối database dịch vụ khác.

## Kiến trúc microservices

Business sở hữu quyền/hộ/site; Catalog sở hữu hàng/đơn vị/giá; Inventory sở hữu nhập, kho, kiểm và reservation; Finance sở hữu payable, ca, payment và ledger; Sales sở hữu đơn và Saga. Gateway phục vụ BFF và định tuyến. Mỗi dịch vụ chạy tiến trình/container và database/role riêng; không sử dụng bảng hoặc khóa ngoại xuyên database.

Giao tiếp người dùng kiểm JWT và quyền hiện hành qua Business. Lệnh worker dùng chữ ký dịch vụ ràng buộc caller, audience, tenant, method, path và body; Gateway không công khai namespace nội bộ. Saga đã tiếp nhận có thể tiếp tục sau khi người thực hiện mất phiên/quyền, nhưng hành động mới vẫn phải được cấp quyền.

Reserve/prepare/commit/release dùng cùng khóa SKU với nhập và kiểm kho. PREPARED không tự hết hạn. Finance xác nhận tiền trước khi Inventory commit; Sales chỉ hoàn tất sau kết quả kho. Hủy phải void tiền trước khi giải phóng hàng. ID ổn định và lưu bước Saga hỗ trợ phục hồi khi mất phản hồi hoặc restart.

Thay đổi dữ liệu và Outbox ghi trong cùng transaction địa phương. Publisher confirm, mandatory routing, Inbox, retry và hàng đợi lỗi hạn chế mất hoặc nhân đôi hiệu ứng. Kiểm thử đã bao gồm ngừng Finance, Inventory, Business, Catalog, RabbitMQ và restart Sales/Inventory.

## Công việc tiếp theo và giới hạn

- Tuần 8: hoàn thiện thao tác POS, quản lý ca, biên nhận/in lại, trả hàng và hoàn tiền; giữ snapshot giá/vốn và giới hạn trả/hoàn từ đơn gốc. Bổ sung kiểm thử trả đồng thời, hoàn một phần, restart giữa nhận hàng trả và hoàn tiền, đóng ca cạnh tranh với thu tiền.
- Tuần 9: read model báo cáo, thông báo và giao diện quản lý. Reporting/Notification hiện là khung dịch vụ; sự kiện được giữ chờ consumer.
- Giai đoạn kiểm thử/vận hành: thử nhiều replica, tải lớn, HTTPS, phát hành độc lập, quyền migration tách runtime, credential broker theo service, backup/restore và replay archive. Hiện chưa có chứng cứ production, tải lớn hoặc khôi phục mất database.
- CI đang phù hợp với phần triển khai đến tuần 7. CD và môi trường trực tuyến nằm trong giai đoạn vận hành; không cần thêm Kubernetes để hoàn thành phạm vi hiện tại.
