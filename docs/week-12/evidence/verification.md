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

### Bản phát hành ngày 23/11/2026

Hai lượt chạy kiểm tra cùng commit `169e868`.

| Lượt chạy | verify | https-staging | recovery | publish-pilot |
| --- | --- | --- | --- | --- |
| [Push lên main](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/45103619042) | Đạt | Đạt | Đạt | Bỏ qua theo cấu hình |
| [Phát hành ARM64](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/45103621710) | Đạt | Đạt | Đạt | Đạt |

Lượt phát hành đạt 189/189 ca hồi quy trong 16 phút 30 giây. Diễn tập phục hồi ghi nhận RPO 1,118 giây, RTO 90,5 giây, 25 sự kiện phát lại và hai đơn đã đối chiếu. Job cuối xuất chín image lên GHCR, tải lại để so sánh và ghi digest của 12 image vào manifest. Việc phát hành được kích hoạt thủ công trên nhánh `main`.
