# Hợp đồng API và sự kiện - phiên bản 0.4.0

Base URL cục bộ: `http://localhost:4100`. JSON UTF-8. Các đường dẫn `/v1` đi qua Gateway và cần cookie `sl_session`. Business xác minh JWT RS256, issuer, audience `storeluma-api` và client `storeluma-web`; không nhận danh tính từ header tự khai.

Mọi POST/PATCH phía trình duyệt cần Origin đúng base URL và `X-CSRF-Token` lấy từ `GET /auth/session`. Tạo hộ/địa điểm cần `Idempotency-Key` gồm 16-128 ký tự chữ, số, `_`, `-`; dùng UUID là phù hợp. Gửi lại cùng nội dung, cùng khóa trả kết quả cũ; đổi nội dung nhưng giữ khóa bị 409. Tên tối đa 120 ký tự; địa chỉ/liên hệ tối đa 250.

## Đăng nhập

| Phương thức, đường dẫn | Kết quả |
|---|---|
| GET `/auth/login` | 302 đến Keycloak, Authorization Code + PKCE S256, state, nonce |
| GET `/auth/callback` | Xác minh code, tạo phiên mới và 302 về `/`; 400 nếu callback không hợp lệ |
| GET `/auth/session` | 200 `{user,csrf,context?,expiresAt}`; không trả access/id token; 401 nếu hết phiên |
| POST `/auth/logout` | 200 `{redirectUrl}`; frontend chuyển đến URL này để kết thúc Keycloak session |
| GET `/health` | 200 khi sẵn sàng, 503 nếu chưa sẵn sàng |

## Hộ và địa điểm

Ký hiệu `{tenantId}`, `{siteId}`, `{id}` là UUID. Đối tượng Site phản ánh bảng dữ liệu: `id,tenant_id,code,name,address,status,warehouse_id,register_id,warehouse_ready,register_ready,version,created_at`.

| Phương thức, đường dẫn | Nội dung / quyền / phản hồi thành công |
|---|---|
| GET `/v1/me` | Danh tính đã xác minh và memberships của tài khoản; 200 |
| POST `/v1/tenants` | `{name,contact?,site:{code,name,address?}}`; tài khoản đã đăng nhập; 201 `{tenantId,site}` |
| GET `/v1/tenants/{tenantId}/sites` | Thành viên ACTIVE; OWNER xem toàn hộ, vai trò khác chỉ xem site được giao; 200 Site[] |
| GET `/v1/tenants/{tenantId}/sites/{siteId}` | Kiểm tra cùng hộ và phạm vi; 200 Site |
| POST `/v1/tenants/{tenantId}/sites` | `{code,name,address?}`; OWNER; 201 Site đang PROVISIONING |
| PATCH `/v1/tenants/{tenantId}/sites/{siteId}` | `{name,address,status,version}`; OWNER hoặc MANAGER đúng site; 200 Site mới |
| POST `/v1/context` | `{tenantId,siteId}`; thành viên đúng phạm vi và site ACTIVE; 201 `{tenantId,siteId,role,siteName}` |

Mã site: `[A-Z0-9_-]{2,32}`, duy nhất trong hộ. PATCH chỉ nhận `ACTIVE` hoặc `SUSPENDED` và yêu cầu kho/quầy đã sẵn sàng. `version` là số nguyên dương từ lần đọc gần nhất. Mọi tài khoản đã xác thực có thể tạo hộ của riêng mình; đây là luồng khởi tạo chủ hộ đầu tiên, không cấp quyền ở hộ khác.

## Nhân sự và nhật ký

Membership gồm `id,tenant_id,subject_id,role,status,site_ids,version`. Các vai trò cấp được: `MANAGER`, `CASHIER`, `STOCK`, `ACCOUNTANT`; `OWNER` được tạo khi tạo hộ, không cấp qua lời mời.

| Phương thức, đường dẫn | Nội dung / quyền / phản hồi |
|---|---|
| GET `/v1/tenants/{tenantId}/memberships` | OWNER; 200 Membership[] |
| POST `/v1/tenants/{tenantId}/invitations` | OWNER; `{targetSubjectId,role,siteIds,ownerConfirmed:true}`; 201 `{id,token,expiresInHours:48}` |
| POST `/v1/invitations/accept` | Đúng tài khoản người nhận; `{token}`; 201 Membership |
| PATCH `/v1/tenants/{tenantId}/memberships/{id}` | OWNER; `{role,status,siteIds,version}`; 200 Membership |
| GET `/v1/tenants/{tenantId}/audit` | OWNER; 200 tối đa 50 sự kiện gần nhất |

`siteIds`: 1-30 UUID, phải cùng hộ; server loại phần tử lặp. Membership `status`: ACTIVE/BLOCKED. Không sửa bất kỳ OWNER hoặc chính mình qua API thay đổi thành viên. Lời mời chỉ dùng một lần, lưu hash, đối chiếu người nhận và kiểm tra người mời vẫn là OWNER hoạt động. Không dùng email chưa xác minh để tự cấp quyền.

## Lỗi

400: sai cấu trúc/giá trị. 401: chưa đăng nhập, token hoặc phiên không hợp lệ. 403: CSRF/Origin sai, bị khóa hoặc vai trò không đủ quyền. 404: tài nguyên không thuộc hộ/phạm vi, lời mời không thuộc người nhận. 409: khóa thao tác xung đột, mã site trùng, version cũ, site chưa sẵn sàng, lời mời hết hạn/đã dùng. 503: Gateway không kết nối được dịch vụ. Lỗi JSON có trường `message`; không phụ thuộc hình thức stack trace nội bộ.

## Sự kiện bất đồng bộ

Exchange topic durable `storeluma`; các queue `business`, `inventory`, `finance`. Các loại sự kiện: `site.provision.requested`, `warehouse.ready`, `register.ready`, `site.activated`.

```json
{
  "id": "UUID của sự kiện",
  "type": "site.provision.requested",
  "version": 1,
  "tenantId": "UUID",
  "siteId": "UUID",
  "warehouseId": "UUID",
  "registerId": "UUID",
  "occurredAt": "thời gian ISO 8601 UTC"
}
```

Ví dụ trên mô tả trường, các chuỗi giải thích phải thay bằng UUID/ISO thật khi gửi. Ghi thay đổi nghiệp vụ và Outbox cùng transaction; publish có confirm; chỉ ghi delivered sau confirm. Consumer ghi Inbox và thay đổi dữ liệu cùng transaction, ACK sau commit. Retry có thể giao lại cùng sự kiện; Inbox theo event ID cùng ràng buộc duy nhất site ngăn tạo kho/quầy trùng. Business đối chiếu đúng warehouse/register đã phân bổ trước khi chấp nhận ready. Mô hình giao ít nhất một lần, không tuyên bố exactly-once xuyên dịch vụ.
