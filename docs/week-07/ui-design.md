# Giao diện đơn bán

Tham khảo bố cục bảng, form và khối tổng tiền của [Tabler Form elements](https://preview.tabler.io/form-elements.html) và [Tabler Invoice](https://preview.tabler.io/invoice.html). Giao diện được viết bằng React/CSS và nối với API hiện có; không lấy dữ liệu mẫu của template làm dữ liệu sản phẩm.

- Duy trì logo gốc, thanh điều hướng và hệ màu của các tuần trước. Menu **Đơn bán** hiển thị theo vai trò.
- Đầu trang chọn địa điểm và hiển thị ca đang mở. Mở ca nhập tiền đầu ca; đóng ca tải lại tổng tiền hiện tại, nhập thực đếm và lý do chênh lệch.
- Danh sách tìm mã, lọc trạng thái và phân trang; mỗi đơn mở được chi tiết thực.
- Form gồm khu tìm hàng/giỏ bên trái và tổng tiền bên phải; chọn đơn vị, sửa lượng, bỏ dòng, giảm giá, ghi chú. Tổng chỉ có sau khi server trả báo giá.
- Đơn nháp cho sửa/lấy lại giá. Báo giá hết hạn phải cập nhật, kể cả giỏ không đổi; một thao tác mới có key mới sau khi lần trước đã thành công.
- Thu tiền tách hai bước: bắt đầu phối hợp kho rồi xác nhận đã thực nhận tiền. Hiển thị tiền khách đưa và tiền trả lại; checkbox chưa chọn thì nút xác nhận bị khóa.
- Chờ xử lý và REVIEW tự cập nhật, hướng dẫn giữ nguyên đơn để tiếp tục. Đơn hoàn tất hiển thị thu tiền và xuất kho; không có nút sửa chứng từ đã ghi nhận.
- Hủy có lý do; nếu tiền đã được ghi nhận trong một yêu cầu cạnh tranh, đơn vẫn hoàn tất. Đóng ca không thay thế việc xử lý đơn chờ.
- Trên 390 px, giỏ và tổng tiền xếp một cột, bảng cuộn trong vùng riêng; trang không tràn ngang. Nhãn ngắn bằng tiếng Việt, focus rõ, có thông báo `alert/status`.
- Thẻ kho bổ sung **Xuất bán**; người có quyền mở đơn gốc. Nhân viên kho xem lượng và nguồn nhưng không mở đơn bán; giá vốn bị loại từ backend theo quyền.

Ảnh trong `evidence/screenshots/` được chụp từ ứng dụng và dữ liệu thật qua backend. Danh mục và tài khoản trình diễn nằm trong cấu hình cục bộ, không nằm trong mã giao diện.
