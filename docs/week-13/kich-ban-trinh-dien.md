# Trình diễn một ca bán tại cửa hàng An Nhiên

Chủ hộ muốn biết sau khi khách trả lại một phần hàng, kho còn bao nhiêu cà phê, doanh thu còn bao nhiêu và thu ngân phải bàn giao bao nhiêu tiền. Kịch bản dùng một địa điểm, một mặt hàng bán theo kilôgam và một ca tiền mặt. Tất cả số tiền dưới đây tính bằng đồng.

## Chuẩn bị quầy

Chủ hộ tạo hộ và địa điểm, chờ địa điểm hoạt động, mời một nhân viên làm thu ngân tại đó. Thu ngân chấp nhận lời mời. Mở hai phiên trình duyệt riêng cho chủ hộ và thu ngân, chọn cùng hộ và địa điểm. Dùng một mặt hàng mới để dễ đối chiếu thẻ kho, và một ca mới để tách số tiền của buổi trình diễn.

| Dữ liệu | Giá trị |
| --- | --- |
| Địa điểm | An Nhiên - Nguyễn Trãi |
| Hàng hóa | Cà phê hạt rang mộc, đơn vị kg |
| Nhà cung cấp | Nhà cung cấp An Phú |
| Giá nhập và giá bán mỗi kg | Nhập 40.000, bán 100.000 |
| Tiền đầu ca | 500.000 |

## Các bước tại quầy

| Bước | Người thao tác | Thao tác và điểm dừng để đối chiếu |
| --- | --- | --- |
| 1. Nhập kho | Chủ hộ | Tại **Nhập hàng**, lập phiếu mua 10 kg từ An Phú rồi **Ghi sổ**. Mở thẻ kho và khoản phải trả của nhà cung cấp. Kho tăng 10 kg, giá trị 400.000. Khoản phải trả là 400.000. |
| 2. Bán tại quầy | Thu ngân | Mở ca với 500.000. Chọn 2 kg cà phê, giảm 10.000 trên cả đơn. Khi hệ thống chờ nhận tiền, kiểm số phải thu 190.000. Sau khi nhận tiền, chọn **Xác nhận đã thu tiền**, mở **Xem / in biên nhận**. Kho còn 8 kg. |
| 3. Trả một phần | Thu ngân → Chủ hộ → Thu ngân | Từ đơn đã bán, chọn **Lập phiếu trả**, nhập 0,5 kg, chọn nhận cách ly và ghi lý do. Chủ hộ duyệt nhận hàng. Thu ngân chuẩn bị hoàn trên ca, giao tiền rồi xác nhận. Giảm giá được phân bổ cho hàng trả nên số hoàn là 47.500. Biên nhận bán ban đầu vẫn ghi theo giao dịch gốc. |
| 4. Hủy trước khi thu tiền | Thu ngân | Lập đơn khác cho 1 kg, chuyển sang chờ thu rồi hủy khi khách đổi ý. Lượng giữ về 0. Địa điểm vẫn chỉ có một đơn đã bán, quỹ chưa phát sinh thêm dòng thu. |
| 5. Chi và chốt ca | Thu ngân → Chủ hộ | Tại **Ca thu ngân → Thu / chi quầy**, chi 12.500 tiền vận chuyển. Chọn **Chốt ca**, nhập số đếm thực tế 629.000 và ghi lý do thiếu 1.000. Chủ hộ kiểm chứng từ, xem việc chênh lệch ca và xác nhận xử lý. |
| 6. Đọc kết quả | Chủ hộ | Vào **Báo cáo**, chọn đúng địa điểm và kỳ chứa giao dịch. Mở lần lượt báo cáo bán hàng, **Tồn kho hiện tại**, **Thu chi tại quầy**. Xuất CSV bán hàng và đối chiếu doanh thu thuần với màn hình. |

## Số liệu phải giải thích được

| Chỉ tiêu | Phép tính | Kết quả |
| --- | --- | ---: |
| Doanh thu thuần | 190.000 bán − 47.500 trả | 142.500 |
| Giá vốn thuần | (2 − 0,5) × 40.000 | 60.000 |
| Lãi gộp | 142.500 − 60.000 | 82.500 |
| Tồn thực tế | 10 − 2 + 0,5 | 8,5 kg |
| Tồn có thể bán | 8,5 thực tế − 0,5 cách ly | 8 kg |
| Giá trị tồn | 8,5 × 40.000 | 340.000 |
| Tiền thuần phát sinh tại quầy | 190.000 − 47.500 − 12.500 | 130.000 |
| Tiền dự kiến bàn giao | 500.000 đầu ca + 130.000 | 630.000 |
| Chênh lệch kiểm đếm | 629.000 thực đếm − 630.000 dự kiến | −1.000 |

Trong đơn bán, Sales theo dõi tiến độ giao dịch, Inventory giữ và xuất hàng, Finance ghi thu tiền. Khi trả hàng, có thể kiểm chứng từ hoàn và dòng nhập cách ly riêng. Reporting nhận thay đổi qua sự kiện. Kết thúc phần trình diễn khi số liệu trên báo cáo khớp với chứng từ ở cùng địa điểm.
