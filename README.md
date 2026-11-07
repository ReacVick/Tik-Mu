# 🎵 TikTok Music Clean — Full-Stack Web Player (Render Ready)

Ứng dụng nghe nhạc TikTok sạch **không TikTok Shop, không quảng cáo, không Livestream**, tích hợp bộ xử lý âm thanh **Dolby Atmos 3D Web Audio DSP**, tự động nhận diện tỷ lệ video **9:16 / 16:9** và bộ cào dữ liệu đa tầng hoạt động ổn định trên Render (`https://tik-music.onrender.com`).

## ✨ Các tính năng & Bản vá quan trọng trong phiên bản này

1. **Khắc phục triệt để lỗi cào dữ liệu trên Render (`server.js` + `app.js`)**:
   - Đã sửa lỗi cú pháp ở `/api/stream/:id` và tích hợp **cơ chế tự động làm mới (Auto-Refresh) link CDN** khi link cũ hết hạn (`403 Forbidden`).
   - Loại bỏ sự phụ thuộc vào Puppeteer trên môi trường Render để tiết kiệm RAM (chỉ dùng ~80 MB RAM, chạy mượt trên gói Free 512 MB RAM của Render).
   - **Cơ chế Cào Đa Tầng (Hybrid Multi-Layer Scraping)**:
     - **Tầng 1 (Server Queue)**: Điều tiết tốc độ gọi API (`1.18s/request`) kèm tự động retry để không bao giờ bị chặn Rate Limit `429`.
     - **Tầng 2 (TikTok Embed V2 Fallback)**: Tự động bóc tách luồng phát từ trang nhúng `/embed/v2/:id` khi API chính bận.
     - **Tầng 3 (Client-Assisted Scraping + `/api/ingest`)**: Khi người dùng tìm kiếm trên điện thoại/máy tính, nếu IP Datacenter của Render bị giới hạn tạm thời, trình duyệt sẽ tự động lấy dữ liệu trực tiếp qua IP dân cư của người dùng và đồng bộ ngược về `/api/ingest` trên server.
2. **Sửa lỗi thanh bên trái (Sidebar) và Ô tìm kiếm trên điện thoại**:
   - Cô lập hoàn toàn sự kiện cảm ứng (`touchstart`, `touchmove`, `touchend`) bên trong `#sidebarLeft` để thao tác vuốt chuyển video ngoài màn hình chính không bao giờ nuốt sự kiện chạm của ô tìm kiếm, nút **Tìm**, hoặc các thẻ `#tag`.
   - Hỗ trợ bấm nút **Tìm**, nhấn phím **Enter / Search** trên bàn phím ảo điện thoại, hoặc chạm trực tiếp vào viên thuốc `#nhacchill` ở thanh trên cùng để mở nhanh ô tìm kiếm.
3. **Tối ưu bố cục giao diện trên điện thoại**:
   - Đưa nút đóng `✕` vào góc phải của thanh menu trái để nút `☰` không đè lên logo `TikTokMusic`.
   - Thu gọn và hạ thấp cụm nút bên phải (`Yêu thích`, `Lưu nhạc`, `Cùng nhạc`, `Đĩa xoay`) để không che khuất lời bài hát ở giữa màn hình.
4. **Xử lý thông minh tỷ lệ khung hình `9:16` và `16:9`**:
   - **Video dọc `9:16` (`width <= height`)**: Tự động hiển thị vừa khít màn hình dọc điện thoại và **ẩn nút phóng to** (không cần phóng to).
   - **Video ngang `16:9` (`width > height`)**: Hiển thị nút **⛶ Phóng to & xoay ngang** (cả ở dưới khung video và góc phải thanh tiến trình). Khi bấm sẽ kích hoạt Fullscreen API + khóa hướng ngang (`screen.orientation.lock('landscape')`) kết hợp **CSS Forced Landscape (`rotate(90deg)`)** đảm bảo xoay ngang toàn màn hình 100% trên cả iOS Safari, Android Chrome và cả khi điện thoại đang bật khóa xoay dọc.

## 🚀 Hướng dẫn đưa lên GitHub và Deploy lên Render

1. Giải nén toàn bộ các file trong gói `tik-music-clean-deploy.zip` vào thư mục repository GitHub của bạn:
   - `server.js`
   - `package.json`
   - `index.html`
   - `styles.css`
   - `app.js`
   - `catalog_bundle.js`
   - `feed_data.json`
   - `collect_catalog.js`
   - `build_full_database.js`
   - `test_user_scrape.js`
   - `render.yaml`
   - `Dockerfile`
   - `manifest.json`
   - `vercel.json`
   - `Chay-Web-Nhac.bat`
2. Đẩy code lên GitHub:
   ```bash
   git add .
   git commit -m "Fix Render scraping, mobile search drawer, and 16:9 landscape fullscreen"
   git push origin main
   ```
3. Trên **Render Dashboard** (`https://dashboard.render.com`):
   - Nếu dịch vụ `tik-music` đã kết nối sẵn với GitHub, Render sẽ tự động build và deploy lại.
   - Cấu hình chuẩn:
     - **Build Command**: `npm install`
     - **Start Command**: `node server.js`
   - (Tùy chọn) Bạn có thể chạy `node collect_catalog.js` trên máy tính cá nhân trước khi `git push` để làm giàu thêm kho nhạc mặc định trong `feed_data.json`.
