# Trực nhật ATTS – Hướng dẫn đưa lên mạng

App gồm 2 file:
- `index.html`: toàn bộ app (đã có logo ATTS).
- `firestore.rules`: luật bảo vệ dữ liệu bằng mã PIN.

Thời gian làm: khoảng 20 phút. Chi phí: 0đ (gói Spark miễn phí của Firebase).

---

## Bước 1. Tạo project Firebase riêng

1. Vào https://console.firebase.google.com, bấm **Add project**.
2. Đặt tên: `truc-nhat-atts`. Tắt Google Analytics cho gọn.
3. Chờ tạo xong, bấm **Continue**.

## Bước 2. Bật Firestore và đăng nhập ẩn danh

1. Menu trái: **Build → Firestore Database → Create database**.
   - Location: `asia-southeast1 (Singapore)`.
   - Chọn **Start in production mode**.
2. Menu trái: **Build → Authentication → Get started**.
   - Tab **Sign-in method** → chọn **Anonymous** → bật **Enable** → **Save**.

Đăng nhập ẩn danh giúp mỗi điện thoại có một mã riêng. Nhân viên không phải tạo tài khoản.

## Bước 3. Lấy cấu hình và dán vào app

1. Bấm bánh răng cạnh **Project Overview → Project settings**.
2. Kéo xuống **Your apps** → bấm biểu tượng web `</>`.
3. Đặt tên app: `truc-nhat-web` → **Register app**.
4. Copy đoạn `const firebaseConfig = { ... }`.
5. Mở `index.html`, tìm dòng `DÁN CẤU HÌNH FIREBASE CỦA ANH VÀO ĐÂY`, thay cả khối `firebaseConfig` bằng đoạn vừa copy.

`apiKey` của Firebase web được phép công khai. Dữ liệu được bảo vệ bằng luật ở Bước 4, không phải bằng key.

## Bước 4. Dán luật bảo vệ

1. **Firestore Database → tab Rules**.
2. Xoá hết nội dung cũ, dán toàn bộ nội dung file `firestore.rules`.
3. Bấm **Publish**.

## Bước 5. Đặt mã PIN văn phòng

1. **Firestore Database → tab Data → Start collection**.
2. Collection ID: `secret` → **Next**.
3. Document ID: `pin`.
4. Thêm field: tên `value`, kiểu **string**, giá trị là mã PIN, ví dụ `2468`.
5. **Save**.

Muốn đổi PIN: sửa field `value`. Mọi máy cũ sẽ phải nhập PIN mới.

## Bước 6. Đưa lên GitHub Pages

1. Vào https://github.com, đăng nhập, bấm **New repository**.
   - Tên: `truc-nhat-atts`. Chọn **Public**. Tích **Add a README file**. Bấm **Create**.
2. Bấm **Add file → Upload files**, kéo `index.html` vào, bấm **Commit changes**.
   (Không cần upload `firestore.rules`, file này chỉ dán vào Firebase.)
3. **Settings → Pages**:
   - Source: **Deploy from a branch**.
   - Branch: `main`, thư mục `/ (root)` → **Save**.
4. Chờ 1–2 phút, link sẽ có dạng:
   `https://<ten-github-cua-anh>.github.io/truc-nhat-atts/`

## Bước 7. Cho phép tên miền GitHub đăng nhập Firebase

1. **Authentication → Settings → Authorized domains → Add domain**.
2. Nhập: `<ten-github-cua-anh>.github.io` → **Add**.

Thiếu bước này app sẽ báo "Không kết nối được dữ liệu".

## Bước 8. Dùng thử

1. Mở link, vào **Cài đặt**, thêm tên nhân viên. Máy sẽ hỏi PIN, nhập mã ở Bước 5.
2. Thêm việc: Đổ rác, Tưới cây (hằng ngày)...
3. Quay lại **Hôm nay**, bấm thử **Đã làm xong**, xem lượt chuyển sang người kế tiếp.
4. Gửi link + PIN vào nhóm Zalo văn phòng. Nên ghim link lên màn hình chính điện thoại.

---

## Sửa app sau này

Sửa `index.html` → vào repo GitHub → mở file `index.html` → biểu tượng bút chì → dán nội dung mới → **Commit**. Khoảng 1 phút sau link tự cập nhật. Dữ liệu trên Firebase giữ nguyên.

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| "Không kết nối được dữ liệu" | Kiểm tra Bước 2 (Anonymous đã bật), Bước 3 (đã dán config), Bước 7 (đã thêm domain). |
| "Mã PIN không đúng" dù nhập đúng | Field `value` ở Bước 5 phải là kiểu **string**, không phải number. |
| Bấm nút không lưu | Kiểm tra đã **Publish** luật ở Bước 4. |
