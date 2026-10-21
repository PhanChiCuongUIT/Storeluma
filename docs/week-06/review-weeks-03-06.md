# Rà soát tiến độ tuần 3-6

Ngày rà soát: **21/10/2026**. Phiên bản sản phẩm: **0.6.0**. Đây là kết quả kiểm tra bổ sung; ngày và kết quả trong báo cáo các tuần vẫn giữ theo lần thực hiện trước.

## Đối chiếu đầu ra

| Tuần | Yêu cầu trong đề cương | Sản phẩm và kiểm chứng |
| --- | --- | --- |
| 3 | Phân tích nghiệp vụ, sơ đồ, phác thảo UI | [Bộ thiết kế](../week-03/bao-cao-tuan-03.md): 14 nhóm nghiệp vụ, 13 sơ đồ, 7 mẫu màn hình, ma trận 24 yêu cầu và 12 tình huống rà soát. Phân biệt mẫu thiết kế với chức năng đã chạy. |
| 4 | Nền dự án, đăng nhập, hộ/địa điểm và quyền cơ bản | Gateway/BFF, Keycloak mật khẩu + TOTP, Business, site provisioning và quyền theo hộ/site. 20 ca W4 và 6 ca AUTH bao phủ phiên, ngữ cảnh, quyền, thao tác UI, sự kiện và khôi phục. |
| 5 | Danh mục, nhà cung cấp, nhập hàng | Catalog, NCC/nhập thuộc Inventory, payable thuộc Finance; 25 ca W5 kiểm chính xác lượng/tiền, snapshot, idempotency, cô lập dữ liệu, UI và lỗi liên dịch vụ. |
| 6 | Tồn, lịch sử nhập xuất, kiểm kho | Tồn/thẻ kho, kiểm có khóa phạm vi, duyệt chênh lệch, điều chỉnh/cách ly/xuất hủy. 25 ca W6 và 1 ca migration; các lệnh thay đổi tồn đi qua cùng cơ chế khóa. |

Không phát hiện thiếu chức năng cốt lõi chặn tiến độ trong phạm vi đã rà soát. Lịch sử xuất hiện tại gồm xuất hủy/điều chỉnh giảm; xuất bán và reservation từ đơn bán triển khai cùng luồng bán tuần 7. POS/ca/trả hàng thuộc tuần 8, Reporting/Notification nghiệp vụ thuộc tuần 9. Không tính các khung dịch vụ chưa có nghiệp vụ là chức năng hoàn thành.

## Ranh giới microservices

- Business, Catalog, Inventory và Finance có tiến trình, database và tài khoản riêng. Dùng chung máy PostgreSQL trong Compose không đồng nghĩa dùng chung bảng nghiệp vụ. W4-15 và W5-18 kiểm quyền kết nối database; mã runtime không truy vấn SQL chéo database.
- Business sở hữu quyền; Catalog sở hữu sản phẩm/SKU/đơn vị/giá; Inventory sở hữu NCC/nhập/tồn/kiểm/điều chỉnh; Finance sở hữu quầy và phải trả. Gateway phục vụ UI/BFF và định tuyến.
- HTTP nội bộ xác minh JWT người dùng cùng chữ ký caller gắn method/path/body. Thiếu Business thì từ chối thao tác. Phiếu kiểm đã lưu dùng snapshot trong Inventory để tiếp tục đếm khi Catalog ngừng; lập phiếu mới cần Catalog xác thực SKU.
- Phiếu, balance, movement, audit và Outbox ghi cùng transaction Inventory. Finance dùng Inbox và unique theo chứng từ để tránh tạo nợ lặp. Kiểm kho/điều chỉnh không tạo payable.
- Nhập và kiểm/điều chỉnh lấy khóa theo tenant/kho/SKU, kể cả balance chưa tồn tại. Kiểm kho giữ freeze qua restart, duyệt chỉ ghi chênh lệch một lần; hủy chỉ gỡ khóa. Các lệnh reserve/commit/release tương lai phải tuân thủ cùng cơ chế.
- Broker chuyển sự kiện theo cơ chế có thể giao lại; một Outbox/movement không có nghĩa chỉ giao thông điệp đúng một lần. Publisher confirm/mandatory và Inbox xử lý các trường hợp mất phản hồi, giao lại, thiếu binding và retry.

Các giới hạn vận hành còn lại: một máy Docker, HTTP, Keycloak start-dev, runtime DB còn quyền chạy migration và broker credential dùng chung môi trường. Tách quyền migration, credential broker theo service, TLS, monitoring, backup/restore và phát hành độc lập tiếp tục ở giai đoạn vận hành. Chưa có bằng chứng production hoặc tải lớn.

## Kiểm thử bổ sung

| Mã | Tình huống và kết quả cần bảo đảm |
| --- | --- |
| MIG-01 | Dựng schema 001/002 trong database thử riêng, có phiếu nhập/chi tiết/movement và balance. Nâng 003 bằng chính migration runner, hai tiến trình khởi động đồng thời và chạy lại không đổi số liệu hay ID. Migration lỗi hoàn tác cả DDL/version; khởi động lại vẫn giữ dữ liệu. Database thử được tạo và xóa riêng, không reset dữ liệu ứng dụng. |
| W6-23 | Giảm vai trò, khóa thành viên và chuyển site trong phiên hiện có. Lệnh thử lại cùng idempotency key vẫn phải qua quyền hiện tại. Người mất quyền không đọc/duyệt/hủy trái phép; chủ hộ có thể hủy kiểm để mở khóa. |
| W6-24 | Catalog ngừng thì tạo phiếu mới thất bại, không lưu phiếu hoặc kết quả idempotency dở; phiếu đã có snapshot vẫn nhập số đếm/gửi duyệt được. Business ngừng thì đọc/duyệt bị từ chối và freeze giữ nguyên. Phục hồi rồi thử lại cùng key chỉ tạo một movement. |
| W6-25 | RabbitMQ ngừng khi duyệt kiểm: phiếu/tồn/Outbox vẫn commit, freeze được gỡ; retry không nhân đôi. Broker hoạt động lại thì Outbox được xác nhận gửi, không phát sinh payable. |

Ngày 21/10/2026, trên Windows/Docker Linux containers:

- Build (bao gồm kiểm tra kiểu TypeScript backend/frontend): đạt.
- `npx playwright test tests/migration.spec.ts`: **1/1 đạt**.
- `npx playwright test tests/week06.spec.ts`: **25/25 đạt**; không bỏ qua, không retry/flaky.
- Hai lần chạy trên là riêng biệt. Bộ đầy đủ trên CI gồm **77 ca**: 6 AUTH + 1 MIG + 20 W4 + 25 W5 + 25 W6. Mỗi commit được kiểm tra bằng [Verify Storeluma](https://github.com/PhanChiCuongUIT/Storeluma/actions/workflows/verify.yml); kết quả JSON/HTML và ảnh được đính kèm vào đúng workflow run.

Không chạy lại toàn bộ W4 trên bộ dữ liệu trình diễn đã gần giới hạn số hộ của tài khoản bootstrap. CI dựng môi trường mới để chạy toàn bộ; không tăng quota hoặc xóa dữ liệu người dùng nhằm làm test đạt.

## Điều chỉnh CI theo phạm vi hiện tại

- Giữ build và tích hợp trên PostgreSQL/RabbitMQ/Keycloak thật, không bỏ ca cũ để giảm thời gian. Migration test nằm trong `npm test` nên chạy ở mọi push/PR.
- Token chỉ có `contents: read`; checkout không lưu credential. Ba action được cố định bằng commit SHA lấy từ repository chính thức.
- Cho phép chạy thủ công; lượt mới trên cùng ref hủy lượt cũ. Job có thời hạn 25 phút, không tự retry test để che kết quả không ổn định.
- Sau kiểm tra, lưu trạng thái container cùng báo cáo Playwright, ảnh và ngữ cảnh lỗi trong artifact 7 ngày; luôn thực hiện bước dừng Compose. Không đính kèm `.env`, realm hoặc tài khoản sinh tự động.

Tham khảo: [GitHub workflow permissions và concurrency](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [cố định action bằng SHA](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions).

Đề cương đặt việc **hoàn thiện CI/CD, HTTPS, sao lưu và khôi phục ở tuần 12**. Đợt rà soát này củng cố CI cho chức năng hiện có; chưa thêm deploy, máy chủ hoặc tuyên bố vận hành production. Mã nghiệp vụ và giao diện không thay đổi trong đợt này, nên ảnh/báo cáo tuần 3-6 vẫn phản ánh đúng sản phẩm ở thời điểm lập.
