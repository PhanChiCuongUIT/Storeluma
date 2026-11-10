# Hợp đồng API tuần 9

Tiền tố `/v1/tenants/:tenant`. Trình duyệt dùng session Gateway, mutation gửi CSRF; các command tạo/xuất/tiếp nhận/cấu hình gửi `idempotency-key`. Quyền được kiểm tra ở Business tại mỗi request.

| Phương thức và đường dẫn | Tham số/nội dung | Kết quả |
| --- | --- | --- |
| GET `reports/summary` | `from`, `to` dạng YYYY-MM-DD, `siteId?` | totals, daily, top, bySite, cash, freshness, costVisible |
| GET `reports/stock` | Ngày như trên, `siteId?`, `q?`, `offset?`, `limit?` | items, total, totals, freshness, pointInTime=CURRENT |
| POST `report-exports` | `{kind: sales\|stock\|cash, filters: {from,to,siteId?}}` | id, status=PENDING |
| GET `report-exports/:id` | ID yêu cầu của chính người dùng | status, error, expiresAt, dataAsOf |
| GET `report-exports/:id/download` | Tệp READY, chưa hết hạn, quyền không đổi | filename, csv, dataAsOf; frontend tạo Blob tải CSV |
| GET `work-items` | `siteId?`, `status?`, `kind?`, `offset?`, `limit?` | items, total, counts, freshness |
| POST `work-items/:id/acknowledge` | `{version}` | Công việc ACKNOWLEDGED |
| GET `notification-rules` | `siteId` | low_stock, pending_minutes, version |
| PATCH `notification-rules/:site` | `{lowStock, pendingMinutes, version}` | Cấu hình mới |

Khoảng ngày tối đa 366 ngày; `to` bao gồm cả ngày cuối theo giờ Việt Nam. Phân trang mặc định 50, tối đa 200. Tồn là số hiện tại, tham số ngày không tạo báo cáo tồn quá khứ. `kind` công việc gồm LOW_STOCK, PAYMENT_PENDING, REFUND_PENDING, ORDER_REVIEW, RETURN_APPROVAL, SHIFT_VARIANCE. `status` gồm ACTIVE (mặc định), OPEN, ACKNOWLEDGED, RESOLVED, ALL.

Lỗi: 400 sai dữ liệu; 403 thiếu quyền; 404 tài nguyên không thuộc người/hộ/phạm vi; 409 version hoặc idempotency xung đột; 410 tệp/snapshot hết hạn; 422 tệp chưa sẵn sàng hoặc vượt số công việc xuất đang chờ; 503 nguồn/quyền chưa sẵn sàng hoặc chưa bootstrap xong. Không trả thông tin giá vốn cho vai trò không có quyền.

Nội bộ từng dịch vụ nguồn: POST `/v1/internal/projections/snapshot`, body `{snapshotId?,offset?}`, trả `{snapshotId,asOf,items,nextOffset,total,done}`. Chỉ Reporting và Notification với chữ ký hợp lệ được gọi; không công bố qua Gateway.
