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
