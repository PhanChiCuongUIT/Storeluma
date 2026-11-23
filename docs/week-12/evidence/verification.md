# Minh chứng tuần 12

Ngày 22/11/2026, commit `b368364` chạy đạt ba job kiểm chứng. Hồi quy đạt 189/189 trong 17,8 phút, 0 lỗi, 0 bỏ qua và 0 flaky. Job HTTPS xác nhận đăng nhập TOTP, hoàn tất đơn tiền mặt và đăng xuất. Job recovery kiểm khôi phục toàn cụm rồi bán thêm một đơn qua HTTPS. [GitHub Actions](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/45009874189)

| Cùng kịch bản | Docker AMD64 | GitHub ARM64 |
| --- | ---: | ---: |
| Khoảng từ giao dịch đánh dấu còn giữ đến sự cố (RPO) | 2,517 giây | 1,119 giây |
| Thời gian từ sự cố đến giao dịch mới đã đối chiếu (RTO) | 119 giây | 90,4 giây |
| Bản ghi Outbox được đưa vào hàng chờ phát lại | 25 | 25 |
| Đơn đối chiếu sau phục hồi | 2 | 2 |

Mỗi đơn bán một đơn vị 100.000 đồng với giá vốn 40.000 đồng. Đơn đầu phát sinh sau full backup và trước restore point. PostgreSQL giữ đúng bản đánh dấu trước mốc, loại bản sau mốc. Sau khi dựng broker mới, mỗi payment vẫn có một dòng thu, mỗi đơn có một dòng xuất. Hộ thử thứ hai đăng nhập và bán được trên cụm đã phục hồi. [Ảnh báo cáo sau khôi phục](screenshots/ban-hang-sau-khoi-phuc.png)

Repository SFTP được mã hóa, có volume riêng và nằm trên cùng Docker engine của từng lượt. Kho OCI của môi trường đích, truy cập công khai và thời gian cấp máy thay thế sẽ được kiểm khi đã có hạ tầng. Các số đo trong bảng áp dụng cho dữ liệu thử.
