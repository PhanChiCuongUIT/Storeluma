# Thiết kế giao diện tuần 9

Tham khảo cách tổ chức dashboard, thẻ số liệu và bảng trong [Tabler](https://preview.tabler.io/) và [tài liệu components](https://docs.tabler.io/ui/components). Giữ logo gốc, màu xanh và cấu trúc điều hướng Storeluma; không thêm framework giao diện.

Báo cáo đặt bộ lọc địa điểm và khoảng ngày ở đầu, sau đó là mốc đối chiếu, các chỉ số chính, biểu đồ theo ngày và bảng chi tiết. Ba tab phân biệt kết quả bán hàng, tồn hiện tại và thu chi tại quầy. Màu xanh biểu diễn bán hàng; màu vàng biểu diễn trả hàng. Có bảng số liệu từng ngày để đọc giá trị chính xác mà không phụ thuộc màu hoặc chiều cao cột.

Hộp công việc phân biệt chưa tiếp nhận, đã tiếp nhận và đã giải quyết. Mỗi mục có loại, nguồn, địa điểm, thời điểm, dữ kiện cần xử lý và nút mở nguồn. Cấu hình nhắc việc nằm cùng trang và chỉ xuất hiện với người có quyền. Tiếp nhận không đóng công việc; trạng thái giải quyết được xác định từ dữ liệu nguồn.

Giao diện dùng API thật, trạng thái chờ/lỗi và kiểm tra version. Tệp xuất có bước tạo và tải riêng, tải lại phải qua API kiểm tra quyền. Ở màn hình hẹp, thẻ chuyển thành hai cột, bộ lọc xuống dòng và bảng cuộn trong vùng của bảng. Các thao tác có nhãn truy cập bàn phím và trạng thái focus.

Ảnh giao diện và kết quả kiểm tra nằm trong [evidence](evidence/verification.md).

## Hoàn thiện giao diện dùng chung

Đợt rà soát ngày 11/11/2026 bổ sung các điều chỉnh cho giao diện hiện có:

- Trang vào ứng dụng, đăng nhập và nhập mã xác thực dùng cùng logo gốc, nền sáng, phông chữ và kích thước ô nhập. Hai bước xác thực có tiêu đề, chỉ dẫn và thông báo lỗi riêng; mã TOTP hỗ trợ bàn phím số và tự điền mã trên thiết bị có hỗ trợ.
- Menu chia thành Tổng quan, Kinh doanh và Cửa hàng. Menu trên điện thoại có nút mở/đóng, tự đóng khi chọn mục, hỗ trợ Escape và chuyển focus về nội dung. Danh sách trên máy tính cuộn độc lập khi chiều cao màn hình thấp.
- Tab, bộ lọc, tiêu đề bảng, nút và trạng thái được thống nhất giữa hàng hóa, nhập hàng, kho, đơn bán, báo cáo và công việc. Bảng rộng giữ vùng cuộn riêng để không làm tràn toàn trang.
- Liên kết Đến nội dung chính cho phép bỏ qua menu bằng bàn phím. Những mục hiện có tiếp tục tuân theo vai trò và dùng API nghiệp vụ.

Nguồn tham khảo bố cục: [shadcn/ui login-03](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/login-03/page.tsx), [shadcn/ui sidebar-07](https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/blocks/sidebar-07/components/app-sidebar.tsx), [Tabler](https://github.com/tabler/tabler) và [mẫu đăng nhập Tabler](https://preview.tabler.io/sign-in.html). Áp dụng cách phân cấp nội dung, nhóm điều hướng và khoảng cách; phần triển khai sử dụng React/CSS hiện có, không thêm framework hoặc mẫu dữ liệu vào sản phẩm.

## Ngôn ngữ và chế độ hiển thị

Đợt hoàn thiện ngày 12/11/2026 bổ sung tiếng Việt/English và sáng/tối/theo hệ thống. Thanh lựa chọn có mặt trước và sau đăng nhập; lựa chọn được lưu bằng cookie cùng host và được áp dụng từ đầu trang. Với chế độ theo hệ thống, trang cập nhật khi trình duyệt nhận thay đổi chế độ màu của thiết bị.

Ứng dụng sử dụng bảng dịch cho nội dung giao diện, trạng thái, thông báo nghiệp vụ và nhãn truy cập. Tên hàng, địa điểm, hộ kinh doanh, ghi chú và dữ liệu nhập không được dịch. Thay đổi ngôn ngữ không tải lại ứng dụng hoặc xóa bản nháp biểu mẫu. Số tiền giữ đơn vị VND; kỳ báo cáo giữ múi giờ Việt Nam. CSV lưu ngôn ngữ lúc yêu cầu xuất, chỉ dịch nhãn cột và dòng tổng hợp.

Keycloak kế thừa `keycloak.v2`, dùng message bundle Việt/Anh và bộ chọn ngôn ngữ của chính Keycloak. Màu sắc và lựa chọn hiển thị được chia sẻ qua tài nguyên mount trong Compose, theo [cơ chế theme của Keycloak](https://www.keycloak.org/ui-customization/themes). Không thay thế xử lý biểu mẫu hoặc kiểm tra mã TOTP. Các trang lỗi, hết hạn, xác thực và xác nhận đăng xuất dùng cùng palette; cấu hình TOTP và cập nhật mật khẩu có nhãn tiếng Việt tương ứng khi được yêu cầu bởi tài khoản.

Chế độ tối phân biệt nền làm việc, thẻ, đường viền, chữ chính và trạng thái. Logo tối dùng chữ Store sáng trên nền xanh đậm; chế độ sáng giữ ảnh gốc. Hai ảnh cùng kích thước 1254 × 1254 px, dùng chung khung hiển thị và vị trí căn ảnh. Biên nhận giữ logo gốc và nền trắng cả khi xem và in.

Thanh tùy chọn dùng nút mặt trời/mặt trăng và nút quả địa cầu kèm VI/EN, thay cho ô select. Nhấn nút mở menu có dấu chọn ở giá trị hiện tại. Menu hỗ trợ Enter, Space, phím mũi tên, Home/End, Escape, Tab và bấm ngoài để đóng; vị trí được căn lại để không vượt mép màn hình. Ngôn ngữ ở trang xác thực vẫn chuyển bằng URL do Keycloak cung cấp.

Tham khảo [nút đổi theme của shadcn/ui](https://v3.shadcn.com/docs/dark-mode/vite), [mã nguồn shadcn/ui](https://github.com/shadcn-ui/ui) và [Menu Button Pattern của W3C](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/). Thành phần JavaScript/CSS được dùng chung ở ứng dụng và theme xác thực, không bổ sung thư viện giao diện.
