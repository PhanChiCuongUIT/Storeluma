# Đối chiếu đầu ra tuần 1–11

| Tuần | Đầu ra theo tiến độ | Căn cứ rà soát |
| --- | --- | --- |
| 1 | Phạm vi và kế hoạch 13 tuần | [Đề cương](../../output/pdf/Storeluma_De_cuong_Do_an_2.pdf), mục Kế hoạch thực hiện |
| 2 | Khảo sát tài liệu, chức năng ưu tiên, quy tắc nghiệp vụ | [Báo cáo khảo sát](../week-02/bao-cao-tuan-02.md), 24 yêu cầu chức năng và 9 yêu cầu chất lượng |
| 3 | Phân tích nghiệp vụ, ranh giới dịch vụ, sơ đồ và phác thảo màn hình | [Hồ sơ thiết kế](../week-03/README.md), đối chiếu với các luồng chạy được ở tuần 4–9 |
| 4 | Đăng nhập, hộ, địa điểm và phân quyền | AUTH, W4, W10-access. Kiểm phiên OIDC/TOTP, phạm vi hộ/địa điểm và thu hồi quyền |
| 5 | Danh mục, nhà cung cấp, phiếu nhập | W5, W10 và phép thử 100 phiếu tuần 11. So khớp phiếu nhập, thẻ kho và khoản phải trả |
| 6 | Tồn, thẻ kho, kiểm kê và điều chỉnh | W6 và migration Inventory. Kiểm khóa phạm vi, lệch kiểm đếm, số lượng và giá trị |
| 7 | Đơn bán và phối hợp Sales, Inventory, Finance | W7 và W11-05..08. Kiểm giữ hàng, thu tiền, hủy, mất phản hồi và quyền ghi sau khi lease hết hạn |
| 8 | POS, biên nhận, trả hàng và chốt ca | W8, W10 và W11-09..10. Kiểm số tiền đã thu/hoàn, khu cách ly và số đếm chốt ca |
| 9 | Báo cáo, thông báo, giao diện quản lý | W9, DISPLAY và UI. Đối chiếu chỉ tiêu bán/trả, tệp CSV, công việc theo quyền và giao diện di động |
| 10 | Kiểm quyền và tích hợp | [19 ca theo kế hoạch](../week-10/test-plan.md), gồm 11 ca phân quyền và 8 ca liên dịch vụ |
| 11 | Thử lỗi và củng cố luồng bán, trả, nhập hàng | W11-01..10, phép đo có tải và phục hồi 100 phiếu. Kết quả định lượng trong [báo cáo tuần](bao-cao-tuan-11.md) |

Ba tuần đầu được đối chiếu bằng hồ sơ. Các chức năng từ tuần 4 được chạy lại với xác thực, cơ sở dữ liệu và broker thật. Bộ hồi quy cũng kiểm nâng cấp dữ liệu cũ và quyền truy cập database của từng dịch vụ.

Phạm vi nghiệp vụ đã kiểm là bán tiền mặt cho khách lẻ và một quầy mặc định tại mỗi địa điểm. Hồ sơ khách hàng, thanh toán công nợ nhà cung cấp và đối soát hợp nhất tiếp tục được theo dõi trong [ma trận yêu cầu](../week-10/review-weeks-01-10.md). Tuần 12 dùng bộ hồi quy này để kiểm lại bản triển khai khi cấu hình HTTPS, phát hành và diễn tập sao lưu/khôi phục.
