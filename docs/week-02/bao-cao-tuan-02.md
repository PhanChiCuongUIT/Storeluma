# BÁO CÁO TIẾN ĐỘ TUẦN 2

## KHẢO SÁT NHU CẦU VÀ XÁC ĐỊNH YÊU CẦU HỆ THỐNG

**Đề tài:** Storeluma - Hệ thống microservices phục vụ hộ kinh doanh

**Sinh viên thực hiện:** Phan Chí Cường

**Mã số sinh viên:** 23520207

**Cán bộ hướng dẫn:** ThS. Trần Anh Dũng

**Thời gian báo cáo:** Từ ngày 28/09/2026 đến ngày 04/10/2026

**Ngày lập báo cáo:** 03/10/2026

<!-- PAGEBREAK -->

## 1 Mục tiêu và kết quả thực hiện trong tuần

### 1.1 Mục tiêu

Sau khi hoàn thành đề cương và kế hoạch thực hiện ở tuần 1, tuần 2 tập trung khảo sát nhu cầu quản lý của hộ kinh doanh bán lẻ, tìm hiểu các sản phẩm tương tự và xác định những chức năng cần ưu tiên cho Storeluma. Kết quả của tuần là danh sách yêu cầu ban đầu, phạm vi chức năng cốt lõi và các nội dung cần tiếp tục phân tích trong tuần 3 [1].

Các yêu cầu được xây dựng theo chuỗi công việc tại cửa hàng: thiết lập hàng hóa, nhập hàng, theo dõi tồn, bán tại quầy, ghi nhận thanh toán, trả hàng, chốt ca và xem báo cáo. Việc lựa chọn chức năng đồng thời xét đến thời lượng 13 tuần của đồ án và điều kiện một sinh viên thực hiện.

### 1.2 Công việc đã thực hiện

| Công việc | Cách thực hiện | Kết quả thu được |
| --- | --- | --- |
| Rà soát phạm vi đề tài | Đối chiếu mục tiêu, đối tượng và kế hoạch trong đề cương | Xác định phạm vi bán lẻ thông thường và nghiệp vụ cần khảo sát |
| Khảo sát sản phẩm tương tự | Đọc tài liệu chính thức của KiotViet, Sapo, MISA eShop, Nhanh.vn | Tổng hợp chức năng và so sánh theo năm nhóm tiêu chí |
| Tổng hợp nhu cầu | Phân tích công việc từng vai trò và tình huống nhập, bán, trả, chốt ca | Xác định sáu nhóm người sử dụng và mười nhóm nhu cầu ban đầu |
| Xây dựng yêu cầu | Chuyển nhu cầu thành chức năng, điều kiện chấp nhận và yêu cầu chất lượng | Lập 24 yêu cầu chức năng cốt lõi, chín yêu cầu phi chức năng và tám quy tắc nghiệp vụ |
| Xác định ưu tiên | Xét tính cần thiết, ảnh hưởng tới tiền và hàng, quan hệ phụ thuộc, khối lượng | Phân biệt chức năng bắt buộc, tám chức năng mở rộng và phần ngoài phạm vi học kỳ |
| Chuẩn bị tuần 3 | Xác định luồng cần phân tích sâu, câu hỏi còn mở và tình huống kiểm tra | Có đầu vào cho sơ đồ nghiệp vụ, thiết kế dữ liệu và phác thảo giao diện |

### 1.3 Phương pháp và phạm vi khảo sát

Trong tuần này, khảo sát được thực hiện bằng nghiên cứu tài liệu công khai và phân tích tình huống nghiệp vụ. Nguồn tham khảo là tài liệu do các nhà cung cấp phần mềm công bố, được truy cập ngày 03/10/2026. Những nguồn này giúp nhận diện chức năng đang được cung cấp và cách tổ chức công việc trên phần mềm.

Khảo sát chưa bao gồm phỏng vấn trực tiếp tại cửa hàng hoặc thử nghiệm trên tài khoản sản phẩm. Vì vậy, các nhu cầu dưới đây là kết quả phân tích ban đầu, sẽ được bổ sung khi có điều kiện trao đổi với người sử dụng. Việc so sánh tập trung vào chức năng được công bố, không đánh giá hiệu năng thực tế hoặc kiến trúc nội bộ của các sản phẩm.

## 2 Kết quả khảo sát sản phẩm tương tự

### 2.1 Các sản phẩm được khảo sát

**KiotViet.** Tài liệu hướng dẫn mô tả việc tìm hàng bằng tên, mã hàng hoặc mã vạch ngay trên màn hình bán [2]. Các nhóm quản lý gồm hàng hóa, kiểm kho, sổ quỹ, người dùng, chi nhánh và báo cáo [3]. Hướng dẫn kết ca trình bày số tiền đầu ca, giao dịch trong ca và đối chiếu cuối ca [4]; trả hàng có phiếu riêng và có thể tham chiếu giao dịch gốc [5]. Những nội dung này được tham khảo để tổ chức luồng bán hàng và tra cứu chứng từ.

**Sapo.** Tài liệu về kênh bán tại quầy thể hiện việc quản lý giao dịch trực tiếp tại cửa hàng [6]. Báo cáo tồn kho có bộ lọc chi nhánh và gắn với quyền xem dữ liệu [7]. Hướng dẫn đổi hàng phân biệt các thao tác trả hàng, nhận hàng và thanh toán [8]. Quản lý ca có bước mở ca, nhập số tiền đếm được khi đóng ca và xem giao dịch trong ca [9]. Đây là căn cứ tham khảo cho yêu cầu giới hạn dữ liệu theo địa điểm và phân tách các bước xử lý sau bán.

**MISA eShop.** Thông tin sản phẩm công bố khả năng quản lý bán hàng, tồn kho, đơn vị tính và cửa hàng hoặc chuỗi cửa hàng [10]. Hướng dẫn POS Android trình bày riêng báo cáo bán hàng, thu chi và bàn giao tiền mặt [11]; hệ thống tài liệu cũng có nhóm hướng dẫn đổi trả [12]. Storeluma tham khảo cách phân biệt kết quả bán hàng với số tiền cần bàn giao để xây dựng yêu cầu về ca và báo cáo.

**Nhanh.vn.** Tài liệu bán lẻ có các thao tác tạo, tìm, xem chi tiết giao dịch và tạo phiếu trả hàng [13]. Hướng dẫn kiểm kho phân biệt kiểm theo sản phẩm, danh mục và toàn kho; có bước đối chiếu số đếm với tồn hệ thống [14]. Danh mục báo cáo bao gồm doanh thu, tồn kho, thu chi và kết ca [15]. Những nội dung này được dùng để xây dựng yêu cầu kiểm đếm và tra cứu biến động hàng hóa.

### 2.2 Bảng so sánh chức năng

Các ô ghi nhận nội dung đã tìm thấy trong nguồn tương ứng. Mức độ chi tiết của tài liệu giữa các sản phẩm khác nhau; bảng không dùng để xếp hạng chất lượng sản phẩm.

| Tiêu chí | KiotViet | Sapo | MISA eShop | Nhanh.vn |
| --- | --- | --- | --- | --- |
| Bán tại quầy | Tìm bằng tên, mã hoặc mã vạch [2] | Có kênh bán trực tiếp tại cửa hàng [6] | Bán hàng và nhiều đơn vị tính [10] | Tạo, tìm và xem giao dịch bán lẻ [13] |
| Kho hàng | Quản lý hàng hóa và kiểm kho [3] | Báo cáo tồn theo chi nhánh được cấp quyền [7] | Quản lý và tra cứu tồn [10] | Kiểm theo sản phẩm, danh mục, toàn kho [14] |
| Trả hàng | Phiếu trả riêng, tham chiếu giao dịch gốc [5] | Luồng đổi trả có quyền nhận hàng, thanh toán [8] | Có hướng dẫn đổi trả trên máy tính [12] | Tạo phiếu trả từ giao dịch bán lẻ [13] |
| Ca và tiền | Mở ca, số đầu ca, đối chiếu cuối ca [4] | Mở, đóng ca và tiền đếm được [9] | Thu chi và bàn giao tiền trong ca [11] | Có báo cáo kết ca và thu chi [15] |
| Báo cáo | Doanh thu, lợi nhuận, tồn kho [3] | Lượng và giá trị tồn [7] | Bán hàng và thu chi [11] | Doanh thu, tồn kho, tiền [15] |

### 2.3 Kết luận rút ra cho đề tài

Từ khảo sát, các nghiệp vụ bán hàng, kho, trả hàng, quản lý ca và báo cáo được chọn làm các nhóm chức năng nền tảng. Storeluma cần hoàn thành một chuỗi thao tác liên tục, trong đó kết quả bán hàng có thể đối chiếu với tồn kho và tiền đã nhận. Các chức năng mở rộng chỉ được bổ sung sau khi chuỗi nghiệp vụ này ổn định.

Người dùng cần biết giao dịch đã hoàn tất, đang chờ xác nhận hay cần kiểm tra, đồng thời mở được chứng từ liên quan để tìm nguyên nhân. Đây là định hướng phát triển của đồ án, không phải kết luận rằng các sản phẩm đã khảo sát thiếu khả năng này.

## 3 Tổng hợp nhu cầu của người sử dụng

### 3.1 Đối tượng và bối cảnh sử dụng

Đối tượng hướng tới là hộ kinh doanh bán lẻ hàng hóa thông thường. Một hộ có thể quản lý nhiều địa điểm; tại mỗi địa điểm có kho, quầy và nhân viên được phân công. Giao diện chính gồm trang quản lý và màn hình bán tại quầy. Ở cửa hàng nhỏ, một người có thể kiêm nhiều vai trò nhưng phạm vi quyền vẫn cần được xác định theo công việc.

| Vai trò | Công việc chính cần hỗ trợ | Phạm vi trách nhiệm |
| --- | --- | --- |
| Chủ hộ | Thiết lập cửa hàng, nhân viên, quyền; xem kết quả và duyệt xử lý | Các địa điểm thuộc hộ của mình |
| Quản lý cửa hàng | Điều phối hàng hóa, giá, nhập kho, trả hàng và chênh lệch | Địa điểm và hành động được chủ hộ giao |
| Thu ngân | Mở ca, tìm hàng, lập đơn, nhận tiền, in, yêu cầu trả, chốt ca | Quầy và địa điểm được phân công |
| Nhân viên kho | Nhận hàng, xem tồn, kiểm đếm, đề nghị điều chỉnh | Kho được giao; không tự xác nhận hoàn tiền |
| Người phụ trách tài chính | Ghi thu chi, theo dõi phải trả, đối chiếu tiền và ca | Dữ liệu tài chính theo quyền |
| Quản trị viên nền tảng | Theo dõi dịch vụ, hỗ trợ xử lý lỗi kỹ thuật | Vận hành; đọc dữ liệu hộ cần quyền hỗ trợ phù hợp |

### 3.2 Danh sách nhu cầu ban đầu

Mã NC được dùng để nối nhu cầu với yêu cầu chức năng YC ở mục 4. Các tình huống là cơ sở phân tích cho đề tài, chưa được xem là kết quả khảo sát đại diện cho toàn bộ hộ kinh doanh.

| Mã | Nhu cầu và tình huống đặt ra | Yêu cầu liên quan |
| --- | --- | --- |
| NC01 | Phân công và giới hạn dữ liệu: nhân viên chỉ làm tại nơi được giao, người thiếu quyền không xem giá vốn | YC01-03, YC23-24 |
| NC02 | Tìm đúng hàng, đơn vị, giá: có bán lẻ/thùng; đổi giá vẫn giữ lịch sử giao dịch | YC04-05, YC12, YC17 |
| NC03 | Nhập hàng có căn cứ: nhận hàng và trả tiền nhà cung cấp có thể khác thời điểm | YC06-07, YC19 |
| NC04 | Biết lượng có thể bán: phân biệt hàng giữ cho đơn và hàng hỏng với hàng sẵn bán | YC08-10, YC13 |
| NC05 | Biết kết quả thanh toán: mất kết nối sau khi bấm thanh toán làm người bán chưa rõ kết quả | YC13-15, YC22-23 |
| NC06 | Trả hàng đúng tiền và lượng: khách trả một phần đơn đã giảm giá, hàng nhận lại có thể hỏng | YC16-17 |
| NC07 | Đối chiếu tiền trong ca: tiền đếm khác tiền dự kiến hoặc còn giao dịch chưa rõ | YC11, YC19-20 |
| NC08 | Xem báo cáo và việc cần xử lý: phân biệt doanh thu, tiền thu, lãi gộp, thời điểm cập nhật | YC21-22 |
| NC09 | Tra cứu khách khi cần: tìm lịch sử mua nhưng vẫn bán được cho khách lẻ không lưu hồ sơ | YC18 |
| NC10 | Tìm nguyên nhân và phục hồi: giao dịch gián đoạn hoặc gửi lại cần có dấu vết và cách tiếp tục | YC23-24, YC13-16 |

## 4 Yêu cầu chức năng ban đầu

Danh mục gồm 24 yêu cầu cốt lõi. Mỗi yêu cầu có điều kiện chấp nhận ban đầu để làm căn cứ phân tích và kiểm thử ở các tuần sau. Các điều kiện mô tả hành vi mong muốn, chưa phải kết quả chạy phần mềm.

### 4.1 Quản lý hộ kinh doanh và nhân sự

| Mã | Yêu cầu | Điều kiện chấp nhận ban đầu |
| --- | --- | --- |
| YC01 | Đăng nhập và chọn ngữ cảnh | Đăng nhập, chọn hộ và địa điểm được cấp quyền; không đọc được dữ liệu hộ khác |
| YC02 | Quản lý hộ và địa điểm | Chủ hộ tạo, cập nhật địa điểm; thêm địa điểm không tạo hộ mới; chỉ giao dịch khi kho/quầy ở đó sẵn sàng |
| YC03 | Mời nhân viên và phân quyền | Gán vai trò, nơi làm việc, quyền; khóa quyền ngăn thao tác mới nhưng giữ lịch sử |

### 4.2 Quản lý hàng hóa và kho

| Mã | Yêu cầu | Điều kiện chấp nhận ban đầu |
| --- | --- | --- |
| YC04 | Sản phẩm và biến thể | Tạo, tìm, cập nhật hàng và mã SKU; ngừng bán vẫn giữ lịch sử chứng từ |
| YC05 | Đơn vị và giá bán | Khai báo đơn vị cơ sở, hệ số quy đổi, giá; chứng từ hoàn tất giữ đơn vị và giá lúc bán |
| YC06 | Nhà cung cấp | Lưu thông tin tối thiểu, tra cứu, ngừng giao dịch; giữ tham chiếu trên phiếu nhập cũ |
| YC07 | Nhận hàng và phiếu nhập | Ghi nhà cung cấp, kho, hàng, lượng, giá; xác nhận tăng tồn một lần; trả tiền là bước riêng |
| YC08 | Tồn và lịch sử nhập xuất | Hiển thị tồn thực tế, lượng giữ, cách ly, có thể bán; mở chứng từ nguồn theo quyền |
| YC09 | Kiểm kho và duyệt lệch | Lưu lượng hệ thống, số đếm; có duyệt trước khi điều chỉnh; tránh giao dịch làm đổi số đang kiểm |
| YC10 | Điều chỉnh và hàng hỏng | Có lý do, người duyệt; phân biệt cách ly với xuất hủy; không đưa hàng hỏng vào lượng có thể bán |

### 4.3 Bán hàng và xử lý sau bán

| Mã | Yêu cầu | Điều kiện chấp nhận ban đầu |
| --- | --- | --- |
| YC11 | Mở ca bán hàng | Chọn quầy, người phụ trách, tiền đầu ca; một quầy chỉ có một ca hoạt động; tiền đầu ca không tính doanh thu |
| YC12 | Giỏ hàng và báo giá | Tìm hoặc quét mã, chọn đơn vị, lượng, khách, giảm giá theo quyền; hệ thống kiểm giá và tính tổng |
| YC13 | Thanh toán và hoàn tất đơn | Hoàn tất khi tiền xác nhận và kho ghi xuất; thiếu hàng không thu; bấm lặp không tạo giao dịch trùng |
| YC14 | Xác nhận và đối soát tiền | Lưu phương thức, số tiền, bằng chứng; có trạng thái chờ khi chưa rõ và thao tác đối soát theo quyền |
| YC15 | Hủy đơn chưa hoàn tất | Kiểm trạng thái tiền, hàng trước khi hủy; đơn hoàn tất được xử lý qua trả hàng |
| YC16 | Trả hàng và hoàn tiền | Tham chiếu đơn gốc, kiểm lượng còn được trả, tính theo giá sau giảm; ghi riêng nhận hàng và hoàn tiền |
| YC17 | In và tra cứu biên nhận | Tìm đơn cũ, xem, in lại không tạo đơn mới; phân biệt biên nhận nội bộ với hóa đơn điện tử |
| YC18 | Khách hàng cơ bản | Lưu thông tin khi cần, xem lịch sử theo quyền; không bắt tạo hồ sơ cho mọi đơn bán lẻ |

### 4.4 Tài chính, báo cáo và vận hành

| Mã | Yêu cầu | Điều kiện chấp nhận ban đầu |
| --- | --- | --- |
| YC19 | Thu chi và trả nhà cung cấp | Ghi loại tiền, tài khoản, chứng từ; phân biệt trả tiền nhập hàng với chi phí hoạt động; sửa sai có dấu vết |
| YC20 | Chốt ca và xác nhận lệch | Tính tiền dự kiến, ghi số đếm, lý do lệch, người xác nhận; còn tiền mặt chưa rõ thì chưa chốt |
| YC21 | Xem và xuất báo cáo | Lọc thời gian, địa điểm; doanh thu, tiền thu, lãi gộp, hàng bán, tồn có thời điểm cập nhật và giới hạn quyền |
| YC22 | Thông báo và việc cần xử lý | Tồn thấp, giao dịch chờ, lệch ca có liên kết chứng từ; đã xem khác với xử lý xong |
| YC23 | Lịch sử và xử lý phát sinh | Xem người, thời điểm, hành động, chứng từ; điều chỉnh hoặc phục hồi có lý do và quyền |
| YC24 | Quản trị vận hành | Theo dõi dịch vụ, hộ, lỗi xử lý; khôi phục công việc gián đoạn có kiểm soát, không ghi trùng tiền/hàng |

## 5 Quy tắc nghiệp vụ và yêu cầu phi chức năng

### 5.1 Quy tắc nghiệp vụ ban đầu

1. **Phạm vi dữ liệu:** dữ liệu nghiệp vụ thuộc một hộ; dữ liệu địa điểm được giới hạn theo nơi và quyền được giao. Quyền lập chứng từ không mặc nhiên kèm quyền duyệt.
2. **Lịch sử chứng từ:** thay tên hàng, giá, đơn vị không thay đổi giao dịch hoàn tất. Chứng từ đã ghi sổ được sửa sai bằng nghiệp vụ có liên kết và dấu vết.
3. **Tồn khả dụng:** lượng có thể bán bằng tồn thực tế trừ lượng giữ cho đơn và hàng cách ly. Không bán vượt lượng có thể bán trong phạm vi cốt lõi.
4. **Nhập và thanh toán:** hàng thực nhận được xác nhận mới tăng tồn. Lập phiếu nhập chưa có nghĩa đã chi tiền; tồn đầu kỳ không tự tạo khoản phải trả nhà cung cấp.
5. **Hoàn tất đơn:** cần xác nhận đủ tiền và ghi nhận xuất kho. Mất kết nối hoặc hết thời gian chờ không đủ kết luận thất bại; tra cứu giao dịch cũ trước khi xử lý tiếp.
6. **Trả và hoàn:** lượng trả không vượt phần còn được trả; hoàn theo giá và giảm giá gốc. Hàng hỏng nhận lại được tách khỏi hàng có thể bán.
7. **Tiền trong ca:** tiền dự kiến cuối ca bằng tiền đầu ca cộng tiền mặt vào quầy trừ tiền mặt ra quầy. Phân biệt thanh toán điện tử và khoản ngoài quầy.
8. **Báo cáo:** doanh thu, tiền thực thu, giá vốn, lãi gộp là các chỉ tiêu riêng. Báo cáo ghi thời điểm cập nhật; yêu cầu gửi lại không tăng tổng lần thứ hai.

### 5.2 Yêu cầu phi chức năng

| Mã | Nhóm yêu cầu | Nội dung và cách kiểm tra dự kiến |
| --- | --- | --- |
| CL01 | Bảo mật và quyền | Kiểm quyền tại máy chủ theo hộ, địa điểm, hành động; kiểm truy cập chéo hộ/nơi và xem vốn trái quyền |
| CL02 | Chính xác | Tính tiền VND và lượng chính xác; đối chiếu tổng đơn, tồn, tiền, hoàn trả; kiểm làm tròn và giới hạn lượng |
| CL03 | Phục hồi | Yêu cầu gửi lại hoặc dịch vụ khởi động lại có thể tra và tiếp tục giao dịch cũ; không thu, hoàn, ghi kho hai lần |
| CL04 | Hiệu năng | Mục tiêu ban đầu với 10 phiên: tìm hàng p95 dưới 800 ms, hoàn tất bán tiền mặt p95 dưới 3 giây; chốt tải/môi trường đo khi thiết kế kiểm thử |
| CL05 | Dễ sử dụng | Tiếng Việt, trạng thái rõ; thao tác chính dùng được trên màn hình 1366 x 768 và tablet; hỗ trợ máy quét dạng bàn phím |
| CL06 | Bảo trì | Dịch vụ theo trách nhiệm, API và dữ liệu riêng; kiểm thử, khởi động lại và phát hành từng dịch vụ |
| CL07 | Vận hành và sao lưu | Triển khai HTTPS, bí mật tách khỏi mã nguồn; sao lưu ngoài máy chạy và thử khôi phục trước trình diễn cuối kỳ |
| CL08 | Truy vết | Ghi mã giao dịch, thời điểm, người thao tác, trạng thái để tìm lỗi; không ghi mật khẩu/thông tin xác thực vào nhật ký |
| CL09 | Riêng tư | Chỉ thu thông tin khách cần thiết, giới hạn xuất dữ liệu; nếu có trợ lý AI thì không gửi dữ liệu kinh doanh riêng tới API miễn phí |

Đây là yêu cầu đặt ra cho quá trình xây dựng. Việc đánh giá đạt hay chưa đạt dựa trên kiểm thử sau khi triển khai. p95 là mức thời gian mà 95% yêu cầu trong tập đo không vượt quá.

## 6 Xác định chức năng ưu tiên và phạm vi

### 6.1 Căn cứ lựa chọn

Chức năng được ưu tiên khi cần để hoàn thành một công việc hằng ngày, làm đầu vào cho chức năng khác hoặc bảo vệ tính đúng của tiền, hàng và quyền. Phần có nhiều nhánh nghiệp vụ, cần hợp đồng nhà cung cấp hoặc chưa có đủ dữ liệu được bố trí sau phần cốt lõi.

Mức bắt buộc thể hiện phạm vi dự kiến phải hoàn thành trong đồ án, không có nghĩa xây dựng ngay trong tuần 2. Mức mở rộng chỉ được triển khai khi phần bắt buộc ổn định và tiến độ còn cho phép.

### 6.2 Các nhóm chức năng bắt buộc

| Nhóm | Yêu cầu | Lý do ưu tiên |
| --- | --- | --- |
| Tài khoản và tổ chức | YC01-03 | Xác định người dùng, hộ, nơi và quyền trước nghiệp vụ |
| Danh mục và kho | YC04-10 | Cung cấp hàng, giá, tồn, chứng từ đầu vào cho bán hàng |
| Bán hàng và sau bán | YC11-18 | Hoàn thành từ mở ca tới bán, biên nhận, khách, trả hàng |
| Tiền và kết quả | YC19-22 | Đối chiếu tiền, chốt ca, báo cáo, xử lý việc còn chờ |
| Truy vết và vận hành | YC23-24 | Giải thích giao dịch và phục hồi khi dịch vụ gặp lỗi |

Giai đoạn đầu ưu tiên trình diễn bán bằng tiền mặt. Thanh toán điện tử dùng môi trường thử nghiệm hoặc mô phỏng có nhãn rõ khi chưa đủ điều kiện kết nối thực tế. Xác nhận và đối soát trạng thái vẫn thuộc yêu cầu cốt lõi.

### 6.3 Các chức năng mở rộng

| Mã | Chức năng | Lý do bố trí sau phần cốt lõi |
| --- | --- | --- |
| MR01 | Nhập danh mục từ CSV | Cần kiểm lỗi từng dòng và chống nhập trùng |
| MR02 | Chuyển hàng giữa kho | Thêm giao/nhận, hàng đang chuyển, xử lý thiếu; làm sau khi tồn tại một điểm ổn định |
| MR03 | Bán chịu và thu nợ khách | Cần hạn mức, duyệt nợ, theo dõi thu nợ riêng với doanh thu |
| MR04 | Hóa đơn điện tử | Phụ thuộc hồ sơ, tài khoản, chi phí, giao diện kết nối nhà cung cấp |
| MR05 | Lưu nháp mất mạng | Cần đồng bộ, kiểm giá/tồn thay đổi; giới hạn ở khôi phục giỏ nháp |
| MR06 | Trả nhà cung cấp | Cần đối chiếu phiếu nhập, hàng trả, giảm nợ và tiền hoàn |
| MR07 | Trợ lý hướng dẫn | Phụ thuộc thời gian, tài liệu, hạn mức, chính sách dữ liệu; không tham gia đường bán |
| MR08 | Đặt nhập và nhận từng phần | Cần lượng đặt/nhận/còn lại; bổ sung sau nhập hàng trực tiếp |

### 6.4 Phần chưa thuộc phạm vi học kỳ

Chưa đặt mục tiêu xây ứng dụng mua hàng riêng cho khách, đồng bộ sàn thương mại điện tử, kế toán chuyên sâu, tích điểm thành viên, dự báo nhập hàng hoặc lô/hạn dùng theo ngành chuyên biệt. Không hoàn tất bán khi mất mạng. Kết nối thanh toán và hóa đơn thật chỉ xem xét khi có điều kiện phù hợp.

Công nghệ tiếp tục theo định hướng đề cương: ứng dụng web, các dịch vụ có trách nhiệm và dữ liệu riêng, giao tiếp qua API hoặc thông điệp, đóng gói container. Mô hình dữ liệu, ranh giới dịch vụ và giao diện chi tiết được phân tích ở giai đoạn tiếp theo.

## 7 Tình huống nghiệp vụ dùng để kiểm tra yêu cầu

Các tình huống làm rõ đầu ra mong muốn và chuẩn bị phân tích tuần 3. Số liệu là ví dụ minh họa, chưa phải kết quả kiểm thử hệ thống.

### 7.1 Nhập hàng, bán, trả hàng và chốt ca

Giả sử nhập 10 chai hàng A, giá nhập 10.000 đồng/chai, giá bán 20.000 đồng/chai; chưa trả tiền nhà cung cấp. Thu ngân mở ca với 500.000 đồng. Trong ca chỉ có giao dịch dưới đây, thanh toán và hoàn đều bằng tiền mặt; hàng trả đủ điều kiện bán lại.

| Bước | Thao tác | Kết quả mong muốn |
| --- | --- | --- |
| 1 | Xác nhận nhận 10 chai | Tồn 10; phải trả nhà cung cấp 100.000 đồng; chưa chi tiền |
| 2 | Mở ca 500.000 đồng | Có số dư đầu ca; doanh thu chưa tăng |
| 3 | Bán 2 chai, giảm đơn 4.000 đồng | Thu 36.000 đồng; sau xác nhận tiền và xuất hàng, tồn còn 8 |
| 4 | In biên nhận, in lại khi cần | Cùng giao dịch, tổng 36.000 đồng; không thu/xuất thêm |
| 5 | Trả 1 chai, được duyệt hoàn | Hoàn 18.000 đồng theo giảm giá phân bổ; tồn lên 9 |
| 6 | Chốt ca, xem báo cáo | Tiền dự kiến 518.000 đồng; doanh thu thuần 18.000, giá vốn thuần 10.000, lãi gộp 8.000 đồng |

Nếu số đếm khác 518.000 đồng, hệ thống ghi lệch và lý do để người có quyền xác nhận. Điều chỉnh lệch không đổi doanh thu của đơn đã bán. Tình huống liên quan YC07-08, YC11-14, YC16-17 và YC20-21.

### 7.2 Hai người cùng bán mặt hàng còn một đơn vị

Hai thu ngân cùng tạo đơn cho hàng chỉ còn một đơn vị có thể bán. Chỉ một giao dịch được nhận lượng hàng đó; giao dịch còn lại nhận thông báo thiếu tồn và không thu tiền. Tồn phải luôn không âm. Tình huống làm rõ YC08, YC13 và CL02.

### 7.3 Mất kết nối sau thao tác thanh toán

Thu ngân bấm thanh toán nhưng mất kết nối trước khi nhận kết quả. Khi có mạng, hệ thống tra giao dịch đang xử lý để biết trạng thái tiền và hàng. Nếu tiền đã xác nhận thì tiếp tục hoàn thành hoặc chuyển người có quyền kiểm tra; không yêu cầu khách trả lần nữa chỉ vì chưa có phản hồi. Tình huống liên quan YC13-14, YC22-23 và CL03.

## 8 Sản phẩm tuần 2 và đánh giá tiến độ

### 8.1 Sản phẩm hoàn thành

| Sản phẩm | Nội dung cụ thể | Vị trí |
| --- | --- | --- |
| Khảo sát sản phẩm tương tự | Bốn sản phẩm, năm nhóm tiêu chí, nguồn chính thức | Mục 2, tài liệu tham khảo |
| Đối tượng và nhu cầu | Sáu vai trò, mười nhu cầu, liên kết với chức năng | Mục 3 |
| Yêu cầu chức năng | 24 yêu cầu có điều kiện chấp nhận | Mục 4 |
| Yêu cầu chất lượng, nghiệp vụ | Tám quy tắc, chín yêu cầu phi chức năng | Mục 5 |
| Danh mục ưu tiên | Nhóm bắt buộc, tám phần mở rộng, ngoài phạm vi | Mục 6 |
| Đầu vào phân tích tiếp | Ba tình huống, câu hỏi khảo sát bổ sung, kế hoạch tuần 3 | Mục 7, 9, phụ lục |

### 8.2 Đánh giá tiến độ và vấn đề cần làm rõ

Kết quả tuần 2 đáp ứng đầu ra khảo sát tài liệu, xác định yêu cầu ban đầu và chức năng ưu tiên theo kế hoạch. Phạm vi cốt lõi có liên kết từ nhu cầu tới chức năng và điều kiện chấp nhận, tạo cơ sở cho phân tích tuần 3.

Cần tiếp tục làm rõ ngành hàng và cửa hàng tham khảo cụ thể; cách kiêm nhiệm vai trò; chính sách giảm giá, trả hàng, duyệt chênh lệch; thiết bị tại quầy; phương thức thanh toán và ngân sách. Tính phù hợp với thao tác thực tế sẽ được kiểm tra thêm khi có điều kiện quan sát hoặc trao đổi với người sử dụng.

Khối lượng xử lý đồng thời tiền, tồn và quyền là rủi ro chính. Để kiểm soát tiến độ, chức năng cốt lõi được phát triển theo luồng hoàn chỉnh; phần mở rộng được chọn sau khi đánh giá luồng chính. Nếu cần đổi phạm vi, nội dung ảnh hưởng sẽ được trao đổi với cán bộ hướng dẫn trước khi điều chỉnh kế hoạch.

## 9 Kế hoạch thực hiện tuần 3

Tuần 3 diễn ra từ 05/10/2026 đến 11/10/2026, tập trung phân tích nghiệp vụ, xây dựng sơ đồ và phác thảo giao diện theo đề cương [1].

| Công việc dự kiến | Sản phẩm cần đạt |
| --- | --- |
| Phân tích người dùng và chức năng cốt lõi | Sơ đồ use case theo vai trò và mô tả các use case chính |
| Làm rõ nhập, bán, trả, chốt ca | Bước xử lý, điều kiện, nhánh lỗi và activity diagram |
| Phân tích tương tác dịch vụ | Sequence diagram cho bán, trả và xử lý gián đoạn |
| Xác định đối tượng dữ liệu, trách nhiệm | Mô hình miền, dữ liệu ban đầu, phạm vi sở hữu từng dịch vụ |
| Phác thảo màn hình | Đăng nhập/chọn nơi, hàng hóa, nhập/tồn, POS, giao dịch, quỹ/ca |
| Rà soát thiết kế với yêu cầu tuần 2 | Cập nhật điểm chưa rõ, kiểm độ phủ, chuẩn bị dựng dự án tuần 4 |

## Phụ lục Câu hỏi phục vụ khảo sát bổ sung

Bộ câu hỏi được chuẩn bị để trao đổi với chủ hộ, thu ngân hoặc người phụ trách kho khi có điều kiện. Mỗi buổi ghi ngày, vai trò, bối cảnh cửa hàng và câu trả lời; có thể dùng mã người tham gia để hạn chế thông tin cá nhân.

1. Cửa hàng bán nhóm hàng nào, có bao nhiêu địa điểm, ai phụ trách bán, kho và thu chi?
2. Hàng, đơn vị, giá, lượng đang ghi nhận thế nào? Việc nào mất thời gian tra cứu?
3. Khi nhận hàng, kiểm lượng và giá ra sao? Nhận và trả tiền có khác thời điểm không?
4. Kiểm kho khi nào, xử lý hàng hỏng và lệch thế nào, ai duyệt?
5. Một lần bán từ tìm hàng tới nhận tiền, in biên nhận diễn ra thế nào? Ai được giảm giá?
6. Khi chưa biết thanh toán thành công chưa, nhân viên dựa vào thông tin nào để xử lý?
7. Khi trả một phần đơn, xác định tiền hoàn, người duyệt, chất lượng hàng ra sao?
8. Đầu/cuối ca có đếm tiền không? Thu chi nào thuộc quầy, ai xác nhận lệch?
9. Chủ hộ cần chỉ tiêu nào cuối ngày? Ai được xem giá vốn và lãi?
10. Ba nhóm chức năng nào cần trước, vì sao? Có tình huống gần đây minh họa không?

## Tài liệu tham khảo

[1] Phan Chí Cường. Đề cương chi tiết Đồ án 2 Storeluma Hệ thống microservices phục vụ hộ kinh doanh. Ngày 27/09/2026.

Các tài liệu trực tuyến được truy cập ngày 03/10/2026. Tên tài liệu có liên kết tới trang nguồn.

[2] KiotViet. [Tra cứu sản phẩm](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-tra-cuu-san-pham/tra-cuu-san-pham/).

[3] KiotViet. [Tổng quan các nhóm giải pháp](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-he-thong-giai-phap-kiotviet/tong-quan-cac-nhom-giai-phap-kiotviet/).

[4] KiotViet. [Kết ca ngành bán buôn bán lẻ](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-ket-ca/ket-ca/).

[5] KiotViet. [Trả hàng ngành bán buôn bán lẻ](https://www.kiotviet.vn/huong-dan-su-dung-kiotviet/retail-tra-hang/tra-hang/).

[6] Sapo. [Tổng quan kênh bán tại quầy cửa hàng](https://help.sapo.vn/tong-quan-kenh-ban-tai-quay-cua-hang).

[7] Sapo. [Xem báo cáo tồn kho](https://help.sapo.vn/xem-bao-cao-ton-kho-tren-phan-mem-quan-ly-ban-hang-sapo).

[8] Sapo. [Tạo đơn đổi hàng chi tiết](https://help.sapo.vn/tao-don-doi-hang-chi-tiet-tren-phan-mem-quan-ly-ban-hang-sapo).

[9] Sapo. [Quản lý ca bán hàng](https://help.sapo.vn/quan-ly-ca-ban-hang).

[10] MISA eShop. [Giải pháp quản lý bán hàng](https://eshop.misa.vn/ld/eshop3).

[11] MISA eShop. [Báo cáo bán hàng thu chi bàn giao tiền theo ca trên POS Android](https://helpeshop.misa.vn/kb/bao-cao-ban-hang-thu-chi-ban-giao-tien-theo-ca-tren-may-pos-android).

[12] MISA eShop. [Đổi và trả hàng](https://helpeshop.misa.vn/ac/tra-hang).

[13] Nhanh.vn. [Bán lẻ](https://pos.manual.nhanh.vn/pos/kenh-ban/cua-hang/ban-le).

[14] Nhanh.vn. [Kiểm kho](https://pos.manual.nhanh.vn/pos/kho-hang/kiem-kho).

[15] Nhanh.vn. [Báo cáo](https://pos.manual.nhanh.vn/pos/bao-cao/bao-cao).
