# Tuần 13 · Rà soát sản phẩm và chuẩn bị trình diễn

Kỳ kế hoạch 14–20/12/2026. Lượt diễn tập đầu tiên thực hiện ngày 23/11/2026 trên cụm Docker Compose riêng, dùng dữ liệu cửa hàng giả lập. Phần rà soát tập trung vào một ca có đủ tiền bán, tiền hoàn và chi phí tại quầy.

[Kịch bản thao tác, vai trò và số liệu đối chiếu](kich-ban-trinh-dien.md)

## Kết quả diễn tập

Tám ca kiểm thử liên tiếp dùng chung một hộ, hai địa điểm và một ca bán. Lượt kiểm tra kéo dài 54,8 giây, cả 8 ca đều đạt. Chủ hộ và thu ngân đăng nhập bằng mật khẩu và TOTP. Giao dịch được ghi qua API của ứng dụng. Trên Chromium, lượt thử mở báo cáo, tải CSV, xem lại biên nhận và mở ca đã chốt. Dữ liệu thu tiền và hoàn tiền được đối chiếu với cùng đơn bán. [Bộ kiểm thử giao dịch](../../tests/week10-integration.spec.ts)

| Chứng từ hoặc màn hình | Kết quả đối chiếu | Ảnh của lần chạy |
| --- | --- | --- |
| Biên nhận | Hai kg cà phê giá 100.000 đồng/kg, giảm 10.000 đồng, thu 190.000 đồng. Sau khi trả một phần, biên nhận gốc vẫn ghi số đã thu. | [Biên nhận bán hàng](evidence/bien-nhan.png) |
| Tồn cuối ca | Còn 8,5 kg trị giá 340.000 đồng. Trong đó 0,5 kg cách ly và 8 kg có thể bán. Đơn thứ hai hủy trước khi thu tiền đã giải phóng lượng giữ. | [Tồn kho tại địa điểm](evidence/ton-cuoi-ca.png) |
| Ca thu ngân | Ba dòng phát sinh gồm thu 190.000, hoàn 47.500 và chi 12.500 đồng. Ca dự kiến 630.000, thực đếm 629.000. Chủ hộ đã xác nhận thiếu 1.000 đồng. | [Ca đã chốt và chứng từ thu tiền](evidence/chot-ca.png) |
| Báo cáo bán hàng | Một đơn hoàn tất, một phiếu trả hoàn tất. Doanh thu thuần 142.500 và lãi gộp 82.500 đồng. Tệp CSV tải từ giao diện khớp cả hai chỉ tiêu. | [Báo cáo của cùng địa điểm](evidence/bao-cao-ban-hang.png) |

## Phạm vi đã rà soát

| Nội dung | Bằng chứng và giới hạn |
| --- | --- |
| Luồng nghiệp vụ từ nhập đến chốt ca | Đối chiếu công nợ hình thành khi nhập, tồn, khoản thu, tiền hoàn và kết quả sau chốt ca. Kịch bản dùng tiền mặt và khách lẻ. |
| Quyền theo vai trò | Thu ngân lập phiếu trả, chủ hộ duyệt. Việc đổi quyền trong lúc một giao dịch đang chờ được kiểm lại tại dịch vụ. |
| HTTPS và phát hành | Staging đã kiểm TLS, đăng nhập và bán qua HTTPS. Bản ARM64 đã phát hành lên GHCR. Chờ máy chủ và DNS để xác nhận chứng chỉ và thực hiện một giao dịch từ Internet. [Minh chứng tuần 12](../week-12/evidence/verification.md) |
| Sao lưu và khôi phục | Đã khôi phục theo WAL, phát lại sự kiện và đối chiếu hai đơn trên cụm diễn tập. Ngày 24/11 có thêm lượt khôi phục từ runner GitHub sang Docker Desktop độc lập. Xem [kết quả trên hai máy](evidence/recovery-offhost.json). Kho triển khai của cửa hàng còn cần nghiệm thu. |

## Hồ sơ cuối kỳ

- [Báo cáo tiến độ tuần 13](../../output/pdf/Storeluma_Bao_cao_Tuan_13.pdf)
- [Báo cáo tổng kết Đồ án 2](../../output/pdf/Storeluma_Bao_cao_Do_an_2.pdf)
- [Tài liệu trình bày](../../output/pdf/Storeluma_Trinh_bay_Do_an_2.pdf)
- [Công việc trong tuần và kết quả kiểm thử](bao-cao-tuan-13.md)
- [Hồ sơ khách hàng tại quầy](evidence/customers.png) và [tra chứng từ, cấp quyền hỗ trợ](evidence/operations.png)
