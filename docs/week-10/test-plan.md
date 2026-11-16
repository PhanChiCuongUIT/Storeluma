# Ma trận kiểm thử tuần 10

Các ca dùng Chromium, Keycloak/TOTP và API thật qua Gateway. Nhóm phân quyền tạo hai hộ và ba địa điểm; nhóm tích hợp tạo một hộ riêng, hai địa điểm và một ca. Mọi fixture W10 được tạo qua API, không sửa trực tiếp bảng nghiệp vụ.

| Mã | Yêu cầu | Thao tác | Kết quả cần đạt |
| --- | --- | --- | --- |
| W10-01 | YC01/03/08/21 | OWNER đọc 15 API của bảy dịch vụ | Được đọc, xem lượng và vốn đúng. |
| W10-02 | YC03/08/21 | MANAGER đọc cùng nhóm API | Chỉ API được cấp; không có trường vốn tồn/lợi nhuận trái quyền. |
| W10-03 | YC03/08 | CASHIER đọc cùng nhóm API | Xem được lượng; bị chặn tài chính/quản trị ngoài vai trò. |
| W10-04 | YC03/08 | STOCK đọc cùng nhóm API | Xem kho theo quyền; không xem vốn, bán hàng hay tài chính. |
| W10-05 | YC03/08/21 | ACCOUNTANT đọc cùng nhóm API | Xem vốn, phải trả và báo cáo; không quản trị nhân sự. |
| W10-06 | YC01/03 | Đổi tenant, ID đối tượng và giả header | Không đọc/ghi chéo hộ; lệnh bị từ chối không tạo sản phẩm. |
| W10-07 | YC03/07 | Đọc/ghi chứng từ địa điểm ngoài phạm vi | 403/404; phiếu nháp không bị ghi sổ; không gán site của hộ khác. |
| W10-08 | YC03/04/07 | Hạ quyền trong session rồi replay | Lệnh ghi và response đã lưu vẫn kiểm quyền; không nhân đôi dữ liệu. |
| W10-09 | YC03 | Khóa membership rồi đọc/ghi | Tất cả API đã chọn bị chặn; mở khóa khôi phục quyền hợp lệ. |
| W10-10 | YC03 | Đổi tập site được giao | Mất quyền site cũ ngay; vẫn đọc danh mục chung của hộ. |
| W10-11 | YC01/03 | Gọi API nội bộ từ browser, kèm chữ ký giả | Gateway trả 404, không chuyển tiếp thao tác nội bộ. |
| W10-12 | YC07/19 | Hai lần ghi sổ cùng phiếu PURCHASE/key | Một movement và payable 400.000đ; chưa chi tiền. |
| W10-13 | YC13/14 | Thu hồi quyền trước confirm, cấp lại và gửi đồng thời | Chưa quyền không thu; có quyền chỉ một dòng thu 190.000đ, một dòng xuất, đơn COMPLETED. |
| W10-14 | YC16/17/21 | Trả 0,5 gói cách ly; chặn cashier tự duyệt; đổi quyền hoàn và replay | Hoàn 47.500đ một lần, tồn 8,5/cách ly 0,5/khả dụng 8; snapshot đơn gốc không đổi. |
| W10-15 | YC15 | Hủy checkout đang chờ tiền | Payment FAILED, đơn CANCELLED, giải phóng giữ hàng; không thêm ledger/doanh thu. |
| W10-16 | YC03/19 | Replay chi quầy sau khóa hoặc chuyển site | Chặn theo quyền mới; cấp lại trả đúng phiếu cũ; chỉ chi 12.500đ một lần. |
| W10-17 | YC03/21 | Xuất CSV quản lý, đổi kế toán, khóa người dùng | Không tải tệp người khác; tệp cũ bị chặn khi quyền đổi; tệp mới mới có vốn. |
| W10-18 | YC20/22 | Chốt ca lệch và duyệt | Dự kiến 630.000đ, đếm 629.000đ; công việc lệch xuất hiện rồi giải quyết, ledger không đổi. |
| W10-19 | YC21/CL05 | Mở báo cáo, tải CSV thật, xem tồn/tiền và viewport 390 px | UI khớp API, CSV có số đúng, không lỗi JavaScript/tràn ngang. |

## Số liệu đối chiếu của nhóm tích hợp

Nhập 10 gói × 40.000đ = 400.000đ. Bán 2 gói × 100.000đ, giảm 10.000đ → thu 190.000đ, vốn bán 80.000đ. Trả 0,5 gói → hoàn 47.500đ, giảm vốn 20.000đ. Doanh thu thuần 142.500đ, vốn thuần 60.000đ, lãi gộp 82.500đ. Tiền đầu ca 500.000đ + thu 190.000đ − hoàn 47.500đ − chi 12.500đ = 630.000đ; dòng tiền phát sinh 130.000đ. Giá trị tồn còn 340.000đ, bao gồm hàng cách ly.

## Chạy lại

Sau khi build và khởi động đủ dịch vụ trong môi trường kiểm thử riêng:

```sh
npx playwright test tests/week10-access.spec.ts tests/week10-integration.spec.ts
npm test
```

Chạy một tiến trình test cho mỗi bộ tài khoản. Lượt hồi quy đầy đủ cần database mới và thư mục fixture riêng. Bộ test có thao tác dừng/khởi động dịch vụ, không chạy trên dữ liệu sử dụng hằng ngày. Nhóm tích hợp là chuỗi có thứ tự; nếu một bước lỗi, các bước phụ thuộc bị bỏ qua và lượt chạy đó không được ghi nhận là đạt.
