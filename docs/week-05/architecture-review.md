# Đối chiếu tiến độ tuần 3–5 và kiến trúc

Rà soát bản 0.5.0 ngày 16/10/2026. Đối chiếu đề cương, yêu cầu tuần 2, thiết kế tuần 3 và sản phẩm tuần 4–5. Kết quả chạy và thời điểm cụ thể nằm trong [minh chứng kiểm thử](evidence/verification.md).

## Phạm vi theo tuần

| Tuần | Đầu ra yêu cầu | Đối chiếu sản phẩm |
| --- | --- | --- |
| 3, 05–11/10 | Phân tích, thiết kế và mẫu màn hình đầu tiên | Báo cáo có 14 nhóm nghiệp vụ, 13 sơ đồ, 7 mẫu màn hình và liên kết 24 yêu cầu. Đây là thiết kế; không đồng nghĩa POS, kiểm kho, trả hàng đã được triển khai. |
| 4, 12–18/10 | Dựng dự án, đăng nhập, hộ và địa điểm; quyền cơ bản | Gateway/BFF, Keycloak với TOTP, Business, quyền theo hộ/địa điểm, lời mời và khởi tạo kho/quầy. Bộ W4-01–20 kiểm tra trên hệ thống thật. |
| 5, 19–25/10 | Danh mục, nhà cung cấp, nhập hàng | Catalog, NCC/phiếu nhập thuộc Inventory, khoản phải trả thuộc Finance; UI thao tác API thật. Bộ W5-01–25 kiểm tra nghiệp vụ, quyền, lỗi dịch vụ và UI. |

Thiết kế RS01 được đối chiếu bằng nhập kho và phát sinh nợ trong W5-05–10; RS11 bằng cô lập hộ/quyền và thu hồi membership; RS12 bằng Inbox, idempotency và phiên bản projection. RS02–10 về bán, trả hàng, giữ hàng và chốt ca là phạm vi tuần sau. Màn hình thẻ kho và kiểm kho bắt đầu tuần 6; chưa coi balance API phục vụ nhập hàng là toàn bộ nghiệp vụ quản lý kho.

## Ranh giới dịch vụ

| Tiêu chí | Hiện trạng và bằng chứng |
| --- | --- |
| Triển khai và dữ liệu riêng | Gateway, Business, Catalog, Inventory, Finance có tiến trình/container riêng và database/tài khoản riêng. Dùng chung PostgreSQL server cục bộ; không dùng chung bảng nghiệp vụ. W5-18 kiểm tra cả kết nối chéo bị từ chối bằng tài khoản dịch vụ. |
| Quyền sở hữu nghiệp vụ | Business giữ hộ/site/membership; Catalog giữ hàng/đơn vị/giá; Inventory giữ NCC/nhập/tồn; Finance giữ phải trả. Không có truy vấn SQL xuyên database trong mã nghiệp vụ. |
| Giao tiếp đồng bộ | API nội bộ kiểm actor JWT và chữ ký caller ràng buộc method/path/body. Business kiểm quyền hiện tại; Catalog kiểm SKU khi nhập. Dịch vụ phụ thuộc ngừng thì từ chối thao tác, không bỏ qua kiểm quyền. |
| Giao tiếp bất đồng bộ | Ghi sổ nhập commit dữ liệu và Outbox cùng transaction. Finance commit Inbox và payable cùng transaction riêng. Không có transaction phân tán gộp hai database. |
| Chống lặp và đồng thời | Idempotency-Key, version, khóa bản ghi và thứ tự khóa balance; Inbox và unique theo tenant/receipt. W5-07, 09, 20 kiểm đồng thời, phát lại và rollback nhiều dòng. |
| Khả năng hồi phục | W5-08, 15, 23–25 thử ngừng dịch vụ/broker, thiếu binding, retry và hàng đợi lỗi. Publisher chỉ đánh dấu đã gửi khi confirm thành công và không nhận basic.return. |
| Trạng thái người dùng | Nháp/đã ghi sổ/hủy; lỗi kết nối công nợ phân biệt với chưa đồng bộ, có thời điểm truy vấn. Các trường tài chính chỉ trả cho vai trò được cấp. |

Đáp ứng kiến trúc microservices trong phạm vi đang triển khai. Các phụ thuộc đồng bộ vào Business/Catalog là lựa chọn ưu tiên quyền và hàng hợp lệ; vì vậy nhập mới bị chặn khi các dịch vụ này ngừng. Finance ngừng hoặc RabbitMQ tạm dừng không đảo ngược phiếu đã commit trong Inventory.

## Chỉnh sửa sau rà soát

1. Khi mở lại phiếu nháp, tải toàn bộ đơn vị hiện tại từ Catalog. Trước đó bộ chọn chỉ có đơn vị đã lưu. W5-22 thực hiện đổi đơn vị trên giao diện và đối chiếu lượng cơ sở trong backend.
2. Tách đích nhận lỗi theo dịch vụ. Trước đó exchange lỗi kiểu fanout có thể đưa cùng thông điệp vào nhiều hàng đợi lỗi. Bây giờ chuyển có confirm đến đúng queue, rồi mới ack bản gốc; W5-23 kiểm cả thông điệp sai và hết retry.
3. Thêm mandatory/return và thời hạn confirm; Outbox giữ trạng thái chưa gửi khi không có tuyến nhận. W5-24 gỡ rồi gắn lại binding, xác nhận cuối cùng chỉ có một khoản nợ.
4. Củng cố nối lại broker/channel, xử lý hủy consumer và giới hạn retry header sai. W5-25 dừng/chạy RabbitMQ, xác nhận một movement và một payable sau phục hồi.
5. Giữ sự kiện của consumer tuần sau trong `storeluma.deferred`; không tuyên bố đã có nghiệp vụ Reporting. Cần theo dõi dung lượng và kế hoạch phát lại khi bổ sung consumer.

Không xóa chứng từ, hàng đợi cũ hay dữ liệu người dùng khi nâng cấp. Bộ kiểm thử tạo thêm dữ liệu kiểm tra và thông điệp lỗi có chủ đích trên môi trường chạy thử.

## Giới hạn cần tiếp tục hoàn thiện

- Một máy Docker, HTTP, Keycloak `start-dev`; chưa có kết quả triển khai production, tải cao hay phục hồi sau mất ổ đĩa.
- Tài khoản runtime còn sở hữu database/chạy migration. Cần tách migration role, rotation danh tính dịch vụ, credential và ACL RabbitMQ theo dịch vụ khi hoàn thiện vận hành.
- Shared package cung cấp hạ tầng dùng chung; Dockerfile hiện build toàn workspace. Có thể tối ưu artifact và pipeline phát hành từng dịch vụ về sau.
- Chưa có TLS, backup/restore đã diễn tập, cảnh báo queue/dead queue hoặc tự động xử lý thông điệp lỗi. Không áp dụng TTL/xóa lịch sử chỉ để giảm dung lượng.
- Sales, Reporting và Notification là khung cho tuần sau. CI/CD, HTTPS và sao lưu/khôi phục thuộc tuần 12; các phép thử ở đây chưa thay thế kiểm thử tải/bảo mật toàn hệ thống.

Báo cáo tuần 3–4 giữ kết quả tại thời điểm lập. Kết quả hồi quy trên bản 0.5.0 và sửa lỗi chung được ghi tại tuần 5, tránh biến báo cáo cũ thành mô tả sản phẩm tương lai.

Sau đợt 45 ca nêu trên, tiếp tục sửa callback đăng nhập theo phản ánh khi sử dụng: tách lượt chờ và phiên người dùng, bảo toàn phiên khi mở callback cũ, thêm đường phục hồi. Sáu ca mới và năm ca hồi quy đăng nhập được chạy riêng; xem [chi tiết phiên đăng nhập](auth-session.md). Không dùng kết quả 45 ca trước đó để khẳng định đã chạy lại toàn bộ nghiệp vụ sau sửa callback.

Tham khảo cơ chế xác nhận và trả thông điệp: [RabbitMQ Consumer Acknowledgements and Publisher Confirms](https://www.rabbitmq.com/docs/confirms), [Dead Letter Exchanges](https://www.rabbitmq.com/docs/dlx). Xác nhận từ broker không chứng minh consumer đã xử lý nghiệp vụ; bằng chứng cuối cùng còn đối chiếu database Finance.
