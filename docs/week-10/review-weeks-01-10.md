# Đối chiếu tiến độ tuần 1-10

Ngày rà soát: 16/11/2026. Căn cứ tiến độ là đề cương và báo cáo tuần 2-9 trong repository. Kết quả chạy phần mềm được ghi riêng tại [minh chứng kiểm thử](evidence/verification.md).

## 1. Kết quả theo tuần

| Tuần | Công việc theo đề cương | Sản phẩm và cách đối chiếu |
| --- | --- | --- |
| 1 | Đề cương, phạm vi, kế hoạch | Có đề cương PDF với kế hoạch 13 tuần, đối tượng và kết quả mong đợi. Đây là hồ sơ kế hoạch, không phải bằng chứng phần mềm đã chạy. |
| 2 | Khảo sát, yêu cầu ưu tiên | Có khảo sát tài liệu sản phẩm, 24 yêu cầu chức năng, 9 yêu cầu chất lượng và quy tắc nghiệp vụ. Chưa có phỏng vấn cửa hàng; không coi nghiên cứu tài liệu là khảo sát người dùng trực tiếp. |
| 3 | Phân tích, sơ đồ, phác thảo UI | Có phân tích nhập/bán/trả/chốt ca, ranh giới dịch vụ, mô hình dữ liệu và phác thảo màn hình. Thiết kế được đối chiếu với các chức năng chạy thật từ tuần 4. |
| 4 | Nền hệ thống, đăng nhập, hộ/địa điểm | Có OIDC/TOTP, BFF/session/CSRF, thành viên và phạm vi địa điểm, tạo kho/quầy qua sự kiện. AUTH, W4 và W10 kiểm quyền, trạng thái và truy cập chéo hộ. |
| 5 | Danh mục, nhà cung cấp, nhập hàng | Có SKU, đơn vị, giá, nhà cung cấp, phiếu nhập và khoản phải trả. W5 và W10-12 kiểm snapshot, ghi sổ một lần, quy đổi và phát sinh công nợ. |
| 6 | Tồn, thẻ kho, kiểm kho | Có tồn thực tế/giữ/cách ly/khả dụng, nguồn chứng từ, kiểm đếm, khóa phạm vi, duyệt và điều chỉnh. W6 cùng migration Inventory kiểm lượng và giá trị. |
| 7 | Đơn bán, phối hợp kho/tài chính | Có báo giá máy chủ, đơn, giữ hàng, thu tiền mặt, xuất kho và Saga. W7 kiểm cạnh tranh, hủy, retry và phục hồi; W10-13/15 kiểm lại trên chuỗi nghiệp vụ. |
| 8 | POS, ca, biên nhận, trả hàng | Có thao tác quầy, in trình duyệt, trả từng phần, cách ly, hoàn tiền và chốt ca. W8 kiểm API/UI; W10-14/16/18 đối chiếu kho, tiền và quyền. |
| 9 | Báo cáo, thông báo, UI quản lý | Reporting/Notification có dữ liệu riêng, xuất CSV, công việc và liên kết nguồn; giao diện Việt/Anh, sáng/tối. W9, DISPLAY, UI và W10-17/19 kiểm dữ liệu, quyền tải và thao tác trình duyệt. |
| 10 | Kiểm quyền, tích hợp, sửa lỗi | Bổ sung 19 ca W10, chạy hồi quy, đối chiếu yêu cầu và ghi nhận giới hạn. Tám ca tích hợp sử dụng API thật từ nhập hàng đến chốt ca và xuất CSV. |

## 2. Truy vết 24 yêu cầu chức năng

Trạng thái phản ánh chức năng đang có, không thay thế nghiệm thu toàn bộ sản phẩm cuối kỳ. Phần đã có chủ yếu áp dụng cho khách lẻ, tiền mặt và một quầy mặc định tại mỗi địa điểm.

| Mã | Phần đã có và bằng chứng | Phần còn thiếu hoặc giới hạn |
| --- | --- | --- |
| YC01 | OIDC/TOTP, session, ngữ cảnh hộ/địa điểm; AUTH, W4, DISPLAY | Chưa tự đăng ký, khôi phục mật khẩu qua email hoặc tự gia hạn phiên. |
| YC02 | Tạo hộ, địa điểm, chờ kho/quầy sẵn sàng; W4 | Hạ tầng kiểm chứng là Compose trên một máy. |
| YC03 | Mời, sửa vai trò/site, khóa và thu hồi quyền; W4, W10-01 đến 10 | Chưa có quyền hỗ trợ có thời hạn cho vận hành nền tảng. |
| YC04 | Product/SKU, mã vạch, trạng thái, tìm kiếm; W5 | Nhập CSV là phần mở rộng chưa triển khai. |
| YC05 | Đơn vị, giá, quy đổi bất biến và snapshot; W5, W7-25, W8-25 | Thay quy cách bằng đơn vị mới, không sửa hệ số của chứng từ cũ. |
| YC06 | Nhà cung cấp, ngừng giao dịch, lịch sử phiếu nhập; W5 | Không suy ra đã thanh toán từ lịch sử nhập. |
| YC07 | Nhập PURCHASE/OPENING_STOCK, tồn và payable; W5, W10-12 | Thanh toán payable là nghiệp vụ còn thiếu của YC19. |
| YC08 | Số dư, thẻ kho, nguồn và giới hạn vốn; W6, W10-01 đến 07 | Tồn báo cáo là hiện tại, không phải tồn lịch sử theo ngày. |
| YC09 | Kiểm đếm, freeze, duyệt, đếm lại và hủy; W6 | Cần tiếp tục thử lỗi kéo dài và quy mô dữ liệu lớn. |
| YC10 | Điều chỉnh, cách ly, giải phóng, xuất hủy; W6, W8-10 | Chuyển kho và trả nhà cung cấp thuộc phần mở rộng chưa có. |
| YC11 | Mở ca, số đầu ca, chặn trùng; W7, W8 | Một quầy mặc định mỗi địa điểm, chưa cấu hình nhiều quầy. |
| YC12 | Tìm/quét, giỏ, đơn vị, giảm giá, báo giá máy chủ; W7, W8 | Chưa chọn khách có hồ sơ; chưa hoàn thành toàn bộ yêu cầu này. |
| YC13 | Tiền mặt, giữ/xuất kho, hoàn tất đúng nguồn; W7, W10-13 | Chưa thanh toán điện tử hoặc bán chịu. |
| YC14 | Xác nhận tiền, truy vết trạng thái và retry; W7, W8-31, W10-13 | Chưa có bàn đối soát tổng hợp hoặc bằng chứng từ đối tác thanh toán. |
| YC15 | Hủy trước hoàn tất, giải phóng giữ hàng an toàn; W7, W10-15 | Không dùng hủy đơn để đảo giao dịch đã hoàn tất. |
| YC16 | Yêu cầu/duyệt trả, nhập bán được/cách ly, hoàn tiền; W8, W10-14 | Hoàn tiền mặt theo số thực thu, chưa hoàn qua đối tác điện tử. |
| YC17 | Biên nhận snapshot, in/in lại và 80 mm; W8, DISPLAY | Chưa kiểm máy in vật lý; không phải hóa đơn điện tử. |
| YC18 | Chưa triển khai hồ sơ và lịch sử mua theo khách | Cần bổ sung tìm/tạo/chọn khách, quyền xem và xử lý dữ liệu cá nhân; không coi bán khách lẻ là đáp ứng YC18. |
| YC19 | Thu/chi quầy, đảo phiếu, payable; W5, W8, W10-12/16 | Chưa có tài khoản tiền ngoài quầy, trả nhà cung cấp và phân bổ thanh toán vào công nợ. |
| YC20 | Sổ tiền, đếm, lý do lệch, duyệt; W8, W10-18 | Chỉ áp dụng các khoản đã gắn với ca; chưa vận hành nhiều quầy. |
| YC21 | Bán/trả, tồn, tiền quầy, vốn theo quyền, CSV; W9, W10-17/19 | Nhất quán cuối cùng; chưa báo cáo thuế hoặc chi phí hoạt động đầy đủ. |
| YC22 | Công việc tồn thấp, chờ tiền, đơn REVIEW, trả chờ duyệt, lệch ca; W9, W10-18 | Trong ứng dụng; chưa email/push ngoài hệ thống. |
| YC23 | Audit Business có UI, chứng từ nguồn và lịch sử Saga; W4, W7-8 | Chưa tra cứu audit toàn dịch vụ và đối soát/phục hồi hợp nhất. |
| YC24 | Health, Compose, CI, retry/dead-letter và test phục hồi | Chưa đủ quản trị vận hành, cảnh báo, HTTPS, sao lưu ngoài máy và thử khôi phục. |

## 3. Yêu cầu chất lượng tuần 2

| Mã | Kết quả rà soát | Giới hạn |
| --- | --- | --- |
| CL01 - Phân quyền | Năm vai trò, hộ/site, ẩn vốn, quyền sở hữu ca, thu hồi quyền và xuất CSV có test qua API thật | Không coi việc ẩn nút UI là biện pháp phân quyền. |
| CL02 - Chính xác tiền/hàng | Fixed-point, giới hạn hoàn, giảm giá, cạnh tranh, một movement/ledger theo nguồn và migration có test | Chỉ kết luận cho đầu vào và luồng đã kiểm; không thay thế đo tải. |
| CL03 - Phục hồi | Có Outbox/Inbox, retry, Saga, replay, dừng dịch vụ/broker trong W5/7/8/9 | Chưa đo mục tiêu 100 sự kiện/60 giây hoặc đầy đủ tình huống lỗi kéo dài. |
| CL04 - Hiệu năng | Chưa đo bộ tải 10 phiên, 10.000 SKU/đơn và p95 theo mục tiêu | Thời gian chạy 179 test không phải bằng chứng đạt p95. |
| CL05 - Thao tác | UI thật, đăng nhập/TOTP, Việt/Anh, sáng/tối, bàn phím, viewport hẹp và CSV | Chưa nghiên cứu khả dụng với nhân viên cửa hàng hoặc máy in vật lý. |
| CL06 - Tách dịch vụ | Gateway và bảy dịch vụ nghiệp vụ, database/account riêng, API nội bộ có chữ ký, RabbitMQ | PostgreSQL/broker cùng máy; runtime hiện còn quyền migration ở database của chính nó. |
| CL07 - Sao lưu | Chưa có kết quả backup/restore ngoài máy | Công việc tuần 12; phải đo RPO/RTO khi triển khai. |
| CL08 - Truy vết | ID chứng từ, correlation, audit và nguồn số liệu có trong luồng | Chưa có giám sát tập trung và màn hình audit hợp nhất. |
| CL09 - Dữ liệu cá nhân | Phiên phía server, CSRF, quyền đọc và tệp xuất được kiểm; bí mật tách khỏi Git | YC18 chưa có nên chưa thể nghiệm thu vòng đời hồ sơ khách. |

## 4. Kiến trúc microservices và CI

Business giữ quyền và phạm vi; Catalog giữ hàng/giá; Inventory giữ tồn; Sales điều phối bán/trả; Finance giữ tiền; Reporting và Notification giữ dữ liệu tổng hợp. Gateway chuyển tiếp yêu cầu trình duyệt bằng phiên server. Các dịch vụ không dùng query chéo database để lấy nghiệp vụ.

ARCH-01 kiểm chín tài khoản database (bảy dịch vụ, Gateway và Keycloak) chỉ CONNECT database của chính mình, không có superuser, tạo role/database hoặc replication. Các test W5/7/8/9 kiểm sự kiện, namespace nội bộ, nguồn dữ liệu và khôi phục khi dịch vụ bị dừng. Điều này là bằng chứng cho ranh giới dữ liệu và giao tiếp ở môi trường kiểm chứng; chưa chứng minh đáp ứng toàn bộ vận hành production.

CI chạy build, audit runtime, Compose mới và toàn bộ test, không loại các tuần cũ. Artifact bổ sung ảnh tuần 10 cùng JSON kết quả và trạng thái container; đồng thời giữ ảnh xác thực và tuần 4-5 được chụp trong chính lượt CI, bên cạnh ảnh trong tài liệu. Chưa bổ sung CD khi chưa có môi trường triển khai, DNS/HTTPS và quy trình phục hồi được kiểm chứng.

## 5. Kết luận theo tiến độ và chuẩn bị tuần 11

Các đầu ra kế hoạch của tuần 1-3 đã có. Luồng hiện có của tuần 4-9 được kiểm lại trong tuần 10; phạm vi kiểm thử gồm phân quyền, tích hợp tiền/hàng/báo cáo, migration và giao diện. Kết quả cụ thể phải đọc cùng minh chứng kiểm thử, không suy rộng thành hoàn tất mọi yêu cầu YC01-YC24.

Tuần 11 tiếp tục trên bản đã kiểm chứng, ưu tiên:

1. Thử mất phản hồi sau commit, chết worker trước ACK, worker cũ trở lại sau lease và chạy hai worker; đo thời gian hội tụ, đếm tác động tiền/hàng.
2. Lập và thực hiện phép đo tải có dữ liệu/cấu hình rõ, báo cáo p95/p99, lỗi và backlog.
3. Bổ sung các khoảng trống P0 theo quan hệ phụ thuộc: hồ sơ/chọn khách (YC12/18), tài khoản tiền và trả nhà cung cấp (YC19), tra cứu/đối soát có quyền (YC14/23). Mỗi phần cần UI thật, API và test riêng; không đổi thành P1 chỉ để chốt tiến độ.
4. Chuẩn bị đầu vào vận hành tuần 12: quyền migration/runtime, bí mật và broker theo dịch vụ, HTTPS, phát hành và backup/restore ngoài máy.

Chưa mở rộng CSV import, chuyển kho, đặt nhập, bán chịu, offline hoặc tích hợp hóa đơn trước khi phần cốt lõi và điều kiện nghiệm thu của từng phần được đáp ứng.
