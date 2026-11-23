# Đối chiếu trước tuần 13

| Tuần | Đầu ra | Hồ sơ hoặc phép kiểm |
| --- | --- | --- |
| 1 | Phạm vi, sản phẩm và kế hoạch 13 tuần | [Đề cương](../../output/pdf/Storeluma_De_cuong_Do_an_2.pdf) |
| 2 | Khảo sát, quy tắc tiền/hàng và yêu cầu ưu tiên | [Hồ sơ khảo sát](../week-02/bao-cao-tuan-02.md) |
| 3 | Tác nhân, luồng nghiệp vụ, sơ đồ dữ liệu, phác thảo màn hình | [Hồ sơ thiết kế](../week-03/README.md) |
| 4 | Hộ, địa điểm, OIDC/TOTP, phạm vi quyền | AUTH, W4, W10-access và giao dịch xác thực qua staging |
| 5 | Hàng hóa, nhà cung cấp và nhập kho | W5, W10-integration và nhập hàng qua HTTPS trước/sau khôi phục |
| 6 | Tồn, thẻ kho, kiểm kê, điều chỉnh | W6, kiểm migration, đối chiếu giá vốn và tồn sau phát lại |
| 7 | Đơn, giữ hàng, thu tiền và xuất kho | W7 và W11-saga, đối chiếu đơn COMPLETED, saga DONE và sổ quỹ |
| 8 | POS, biên nhận, trả hàng và chốt ca | W8, W10-integration, kiểm lại thu và hoàn trong hồi quy |
| 9 | Báo cáo, công việc, xuất CSV | W9, UI và màn hình doanh thu của giao dịch sau phục hồi |
| 10 | Quyền và tích hợp xuyên dịch vụ | [19 ca tuần 10](../week-10/test-plan.md) |
| 11 | Mất phản hồi, giao lại sự kiện, worker hết lease | 10 ca tuần 11 trong hồi quy. [Số đo 600 đơn và 100 phiếu nhập](../week-11/evidence/verification.md) là kết quả của tuần 11 |
| 12 | HTTPS, phát hành, sao lưu và phục hồi | [Kết quả thực đo](evidence/verification.md). Đã kiểm trên AMD64 và ARM64. Giao dịch qua DNS công khai và phục hồi từ kho ngoài máy còn chờ hạ tầng |

Có thể chuẩn bị kịch bản trình diễn tuần 13 trên staging. Để xác nhận đầu ra “bản chạy trực tuyến”, cần cấp máy chủ và DNS, kiểm chứng chỉ từ Internet, bán hàng trên bản triển khai và khôi phục từ kho riêng trên máy thay thế. Những yêu cầu nghiệp vụ còn theo dõi được ghi trong [ma trận chi tiết](../week-10/review-weeks-01-10.md).
