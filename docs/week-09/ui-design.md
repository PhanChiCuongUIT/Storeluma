# Thiết kế giao diện tuần 9

Tham khảo cách tổ chức dashboard, thẻ số liệu và bảng trong [Tabler](https://preview.tabler.io/) và [tài liệu components](https://docs.tabler.io/ui/components). Giữ logo gốc, màu xanh và cấu trúc điều hướng Storeluma; không thêm framework giao diện.

Báo cáo đặt bộ lọc địa điểm và khoảng ngày ở đầu, sau đó là mốc đối chiếu, các chỉ số chính, biểu đồ theo ngày và bảng chi tiết. Ba tab phân biệt kết quả bán hàng, tồn hiện tại và thu chi tại quầy. Màu xanh biểu diễn bán hàng; màu vàng biểu diễn trả hàng. Có bảng số liệu từng ngày để đọc giá trị chính xác mà không phụ thuộc màu hoặc chiều cao cột.

Hộp công việc phân biệt chưa tiếp nhận, đã tiếp nhận và đã giải quyết. Mỗi mục có loại, nguồn, địa điểm, thời điểm, dữ kiện cần xử lý và nút mở nguồn. Cấu hình nhắc việc nằm cùng trang và chỉ xuất hiện với người có quyền. Tiếp nhận không đóng công việc; trạng thái giải quyết được xác định từ dữ liệu nguồn.

Giao diện dùng API thật, trạng thái chờ/lỗi và kiểm tra version. Tệp xuất có bước tạo và tải riêng, tải lại phải qua API kiểm tra quyền. Ở màn hình hẹp, thẻ chuyển thành hai cột, bộ lọc xuống dòng và bảng cuộn trong vùng của bảng. Các thao tác có nhãn truy cập bàn phím và trạng thái focus.

Ảnh giao diện và kết quả kiểm tra nằm trong [evidence](evidence/verification.md).
