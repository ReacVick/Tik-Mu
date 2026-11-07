/**
 * test_user_scrape.js - Kiểm tra nhanh tính năng cào kênh @username hoặc từ khóa
 * Cách chạy: node test_user_scrape.js @itslowkey._y
 */

const axios = require('axios');

async function testScrape() {
  const target = process.argv[2] || '#nhacchill';
  console.log(`🔍 Đang kiểm tra cào dữ liệu cho: ${target}`);
  try {
    const isUser = target.startsWith('@');
    const url = isUser
      ? 'https://www.tikwm.com/api/user/posts'
      : 'https://www.tikwm.com/api/feed/search';
    const params = isUser
      ? { unique_id: target.replace(/^@/, ''), count: 10, cursor: 0 }
      : { keywords: target, count: 10, cursor: 0 };

    const res = await axios.get(url, { params, timeout: 12000 });
    const videos = res.data?.data?.videos || [];
    console.log(`✅ Kết quả: Tìm thấy ${videos.length} video.`);
    videos.slice(0, 5).forEach((v, i) => {
      const w = v.width || 720;
      const h = v.height || 1280;
      console.log(`  [${i + 1}] ID: ${v.video_id} | Tỷ lệ: ${w > h ? '16:9' : '9:16'} (${w}x${h}) | @${v.author?.unique_id}: ${(v.title || '').slice(0, 60)}`);
    });
  } catch (err) {
    console.error('❌ Lỗi khi kiểm tra:', err.message);
  }
}

testScrape();
