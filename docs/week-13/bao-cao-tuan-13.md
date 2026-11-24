# Báo cáo tiến độ tuần 13

Kỳ kế hoạch 14–20/12/2026. Ngày thực hiện và lập báo cáo 24/11/2026.

## Mục tiêu và kết quả

Tuần 13 dành cho việc rà soát sản phẩm, hoàn thiện báo cáo và chuẩn bị trình diễn. Để kiểm tra một ca bán từ đầu đến cuối, cửa hàng An Nhiên nhập một lô cà phê, bán theo khối lượng rồi nhận lại một phần hàng. Ba con số dùng để kết thúc phần trình diễn là doanh thu thuần, lượng có thể bán và tiền bàn giao cuối ca.

## Những phần đã hoàn thiện

- Tại POS, thu ngân chọn khách trước khi bán. Đơn giữ thông tin tại thời điểm lập. Chủ hộ có thể tra lịch sử theo khách và xử lý thông tin liên hệ.
- Chủ hộ ghi khoản trả nhà cung cấp theo tài khoản và phân bổ cho các khoản phải trả. Khi đảo một khoản chuyển khoản, số dư công nợ được phục hồi. Doanh thu và tiền phải bàn giao của thu ngân vẫn khớp với chứng từ tại quầy.
- Chủ hộ tra nhật ký theo mã chứng từ, cấp quyền hỗ trợ có thời hạn và thu hồi khi xong việc. Người vận hành có thể xem hàng đợi lỗi, chọn sự kiện và ghi lý do phát lại. Dịch vụ nhận kiểm tra mã sự kiện để tránh ghi tiền hoặc kho lần thứ hai.
- Cấu hình pilot tách quyền truy cập PostgreSQL và RabbitMQ theo dịch vụ. Người vận hành có lệnh thay hoặc quay lại image của một dịch vụ, đổi mật khẩu runtime và theo dõi các sự kiện tồn đọng. Nhật ký thao tác và bản sao lưu cấu hình được giữ trên máy vận hành.
- Khi một giao dịch thiếu kết quả từ dịch vụ khác, người có quyền có thể mở hồ sơ đối soát và kiểm tra lại tiến độ. Tiền và hàng được đối chiếu ở dịch vụ sở hữu trước khi đóng hồ sơ.

## Đối chiếu cuối ca

| Chỉ tiêu | Phép đối chiếu | Kết quả |
| --- | --- | --- |
| Thu tiền bán | 2 kg × 100.000 − 10.000 | 190.000 đồng |
| Hoàn cho khách | 0,5 kg × 95.000 | 47.500 đồng |
| Doanh thu thuần và lãi gộp | 190.000 − 47.500 − 60.000 giá vốn thuần | Doanh thu 142.500, lãi gộp 82.500 đồng |
| Tồn cuối ca | 10 − 2 + 0,5 kg, trong đó 0,5 kg cách ly | 8,5 kg thực tế, 8 kg có thể bán |
| Quỹ | 500.000 + 190.000 − 47.500 − 12.500 | Dự kiến 630.000, đếm 629.000, thiếu 1.000 đồng |

## Kiểm thử và bàn giao

GitHub Actions chạy 192 ca hồi quy trên commit c18bdff. Cả 192 ca đạt ngay lượt đầu, không bỏ qua ca nào. Hai job ARM64 kiểm đăng nhập và bán qua HTTPS, sau đó kiểm phục hồi PostgreSQL theo WAL. Trên cụm diễn tập cùng máy, RPO là 1,065 giây và RTO là 58,7 giây. Bản ghi sau điểm phục hồi bị loại, hai đơn bán đối chiếu được với tiền và kho. Ở lượt kiểm trên hai máy, nguồn chạy trên GitHub, đích chạy trên Docker Desktop. Thời gian thao tác ở máy đích là 193,3 giây, RPO 0,981 giây. Khoảng từ trước khi khởi động máy nguồn đến khi kiểm xong hai đơn trên máy đích là 438,1 giây. Đây là cận trên của RTO trong lượt thử. [Số đo trên hai máy](evidence/recovery-offhost.json)

Mốc nghiệm thu bản chạy trực tuyến còn cần tên miền, máy đích và giao dịch từ mạng ngoài.

Hồ sơ gồm báo cáo tổng kết, tài liệu trình bày, kịch bản thao tác, ảnh biên nhận, sổ quỹ, báo cáo bán hàng và giao diện vận hành. [Kịch bản và minh chứng](README.md) · [Kết quả kiểm thử](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/45331683397)
