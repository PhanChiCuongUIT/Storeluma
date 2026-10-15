# Hoàn thiện giao diện tuần 4

Ngày cập nhật: 15/10/2026. Giao diện triển khai từ phác thảo tuần 3, trong phạm vi hộ kinh doanh, địa điểm, nhân sự và nhật ký.

## Tham khảo bố cục

- [Tabler](https://github.com/tabler/tabler), [bản xem trước](https://preview.tabler.io/): nền trung tính, thanh điều hướng, nhóm chỉ số và khoảng cách giữa các vùng nội dung.
- [shadcn/ui dashboard blocks](https://ui.shadcn.com/blocks?category=dashboard): tổ chức thanh công cụ, bảng dữ liệu và thao tác theo ngữ cảnh.

Chỉ tham khảo cách tổ chức giao diện. Phần triển khai dùng React/CSS của dự án, không sao chép template hay thêm phụ thuộc Tabler/shadcn. Logo tiếp tục dùng tài nguyên Storeluma gốc.

## Thay đổi đã triển khai

- Thống nhất nền sáng, chữ, đường viền, nút, biểu mẫu và màu trạng thái. Nội dung tiếng Việt theo nghiệp vụ.
- Thanh điều hướng giữ hộ đang chọn; chỉ hiện nhân sự và nhật ký cho chủ hộ.
- Tìm địa điểm theo tên, mã hoặc địa chỉ; hỗ trợ tiếng Việt không dấu. Lọc theo trạng thái qua danh sách chọn hoặc ô thống kê.
- Chuyển dạng thẻ/danh sách. Thống kê và kết quả chỉ dùng địa điểm backend trả về trong phạm vi được cấp quyền.
- Đánh dấu nơi đang làm việc; địa điểm chưa sẵn sàng hoặc tạm ngừng không chọn được.
- Bảng nhân sự gom vai trò, phạm vi và trạng thái; mã tài khoản mở khi cần. Nhật ký hiển thị thời gian Việt Nam và đối tượng liên quan.
- Sao chép mã tài khoản và mã lời mời bằng thao tác thật. Hộp thoại giữ focus, hỗ trợ Tab/Shift+Tab, Escape và trả focus về nút mở.
- Bố cục điện thoại xếp lại điều hướng, bộ lọc và thẻ. Bảng rộng cuộn trong vùng nội dung.

## Kiểm tra

W4-16 kiểm tra biểu mẫu, tìm không dấu, kết quả rỗng, bộ lọc, đổi cách xem, bàn phím, logo, nhật ký và chiều rộng 390 px. Các ca còn lại kiểm tra quyền và dữ liệu qua backend thật. Xem [kết quả kiểm thử](evidence/verification.md).

Báo cáo tuần 3 giữ các phác thảo ban đầu; báo cáo tuần 4 cập nhật ảnh giao diện đã triển khai. Các màn hình cho nghiệp vụ các tuần sau vẫn là thiết kế, chưa tính là chức năng hoàn thành.
