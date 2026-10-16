# Phiên đăng nhập - bản 0.5.0

## Phân biệt lượt đăng nhập và phiên sử dụng

- Lượt đăng nhập là thời gian chờ hoàn tất mật khẩu/TOTP và nhận callback, có hiệu lực 5 phút. Mỗi lượt có `state`, `nonce`, PKCE verifier và cookie `sl_login_<hash>` riêng, HttpOnly, SameSite=Lax, path `/auth`. Dữ liệu phía server được mã hóa và có namespace khóa riêng với phiên người dùng.
- Phiên sử dụng bắt đầu sau khi xác minh thành công. Cookie `sl_session` chỉ đại diện cho phiên người dùng; token được giữ ở Gateway. Phiên tối đa 15 phút và không vượt thời hạn access token; chưa tự gia hạn bằng refresh token.
- Đăng nhập không cấp quyền nghiệp vụ mới. Các API vẫn kiểm membership, vai trò và phạm vi địa điểm hiện tại.

## Hành vi hiện tại

| Yêu cầu | Kết quả |
| --- | --- |
| GET `/auth/login` khi chưa có phiên | Chuyển về host của `WEB_ORIGIN` trước khi đặt cookie; tạo lượt chờ riêng rồi chuyển Keycloak. |
| GET `/auth/login` khi đã có phiên hợp lệ | Về `/`, giữ nguyên phiên. Muốn đổi tài khoản thì đăng xuất trước. |
| GET `/auth/callback` hợp lệ | Lấy đúng cookie theo state, tiêu thụ lượt chờ nguyên tử một lần, xác minh code/PKCE/state/nonce, tạo phiên và chuyển `/`. |
| Callback cũ khi vẫn đăng nhập | Về `/`, giữ phiên hiện tại. Không đổi tài khoản dựa vào callback cũ. |
| Callback thiếu cookie, sai state, đã dùng hoặc hết hạn | Nếu không có phiên hợp lệ, chuyển `/?auth=expired`; hiển thị nút bắt đầu đăng nhập lại. Không cấp phiên và không tự lặp redirect đăng nhập. |
| Callback có code không hợp lệ | Chỉ kết thúc lượt chờ tương ứng, chuyển `/?auth=failed`; không cấp phiên. |
| API với phiên sử dụng hết hạn | 401; giao diện yêu cầu đăng nhập lại. |

Thông báo chỉ dùng hai mã lỗi cố định `expired`/`failed`, không phản chiếu nội dung query vào HTML. Gateway không ghi code, state, token hoặc mật khẩu vào log lỗi callback.

## Lỗi đã xác minh và sửa

Trước sửa, callback gọi xóa `sl_session` trước khi xác định đây có phải lượt chờ không. Kiểm thử đã tái hiện: đăng nhập thành công, mở lại callback cũ, bị trả màn hình văn bản và mất phiên. Một cookie dùng cho cả lượt chờ và phiên người dùng cũng khiến bắt đầu lượt mới ghi đè lượt trước. Khi vào qua IP nhưng callback về hostname, cookie có thể nằm ở host khác.

Bản sửa tách lượt chờ, bảo toàn phiên người dùng còn hạn và đưa lỗi về giao diện đăng nhập có thao tác phục hồi. Không bỏ kiểm tra OIDC và không tăng thời hạn access token để xử lý lỗi.

Sáu ca `AUTH-01`–`AUTH-06` trong `tests/auth.spec.ts` kiểm hết hạn, mở lại callback, hai lượt độc lập, state/trình duyệt khác, code sai và khác host. Năm ca hồi quy `W4-01`, `02`, `03`, `17`, `18` kiểm đăng nhập/TOTP, token không ra trình duyệt, CSRF, phiên hết hạn và đăng xuất. Kết quả và thời điểm nằm trong [minh chứng](evidence/verification.md). Kiểm thử chờ mã TOTP mới cho mỗi lượt thay vì tắt cơ chế chống dùng lại mã của Keycloak.

Các kết quả 45 ca nghiệp vụ trước sửa và 11 ca kiểm tra liên quan sau sửa là các lần chạy cục bộ riêng. Báo cáo tuần 4 giữ hợp đồng lịch sử bản 0.4.0; bảng trên là cập nhật hiện hành. Kết quả chạy toàn bộ trên GitHub được lưu riêng trong [workflow Verify Storeluma](https://github.com/PhanChiCuongUIT/Storeluma/actions/workflows/verify.yml).

## Kiểm thử TOTP trên CI

[Lần chạy 38920230894](https://github.com/PhanChiCuongUIT/Storeluma/actions/runs/38920230894) build thành công, đạt sáu ca AUTH và 20 ca tuần 4, rồi thất bại ở đăng nhập chuẩn bị tuần 5. Hai bộ tuần 4 và 5 dùng lại mã TOTP của cùng tài khoản trong một cửa sổ 30 giây; Keycloak từ chối mã đã dùng. 24 ca còn lại của nhóm tuần 5 không chạy do nhóm có thứ tự phụ thuộc.

Các bộ AUTH, tuần 4 và tuần 5 hiện dùng chung `tests/helpers/totp.ts`: mỗi lần nhập TOTP chờ cửa sổ mới, rồi sinh mã ngay trước khi điền. Không phụ thuộc vào bộ trước chạy nhanh hay chậm và không chờ bù ở cuối một file riêng lẻ. Ba tài khoản độc lập trong bước chuẩn bị được đăng nhập song song; thời hạn của riêng hook chuẩn bị là 180 giây để gồm thời gian chờ dịch vụ và mã mới. Thời hạn ca kiểm thử, số ca, kiểm tra bảo mật và chính sách không tự retry vẫn giữ nguyên. Chỉ chạy một tiến trình kiểm thử trên cùng bộ tài khoản.

Tham khảo các kiểm tra của thư viện: [openid-client AuthorizationCodeGrantChecks](https://github.com/panva/openid-client/blob/main/docs/interfaces/AuthorizationCodeGrantChecks.md).

Đã kiểm tra thêm bằng tài khoản trong bộ dữ liệu trình diễn với mã TOTP hiện tại: đăng nhập thành công, phiên Gateway trả HTTP 200. Nếu tab cũ còn hiện thông báo văn bản, mở lại http://localhost:4100/ và bắt đầu lượt đăng nhập mới.
