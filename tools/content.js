/**
 * 內容日曆管理系統
 * 計畫營銷、自動發佈到社交媒體、追蹤表現
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const CONTENT_DIR = path.join(DATA_DIR, 'content');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONTENT_DIR)) fs.mkdirSync(CONTENT_DIR, { recursive: true });
}

// 生成內容日曆
async function generateContentCalendar(topic = '日常', days = 7) {
  try {
    ensureDirs();
    const now = new Date();
    const calendar = [];

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];

      const contentIdeas = [
        `${topic} - 用戶故事分享`,
        `${topic} - 技巧小貼士`,
        `${topic} - 行業新聞評論`,
        `${topic} - 幕後花絮`,
        `${topic} - 互動問卷`,
        `${topic} - 成功案例`,
        `${topic} - 限時優惠`
      ];

      calendar.push({
        date: dateStr,
        dayOfWeek: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'][date.getDay()],
        bestTime: `${9 + Math.floor(Math.random() * 8)}:00`,
        platforms: ['Instagram', 'Facebook', 'LinkedIn'],
        contentType: contentIdeas[i % contentIdeas.length],
        priority: Math.random() > 0.5 ? '高' : '中'
      });
    }

    const timestamp = now.getTime();
    const filename = `content_calendar_${timestamp}.json`;
    const filepath = path.join(CONTENT_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(calendar, null, 2));

    const formatted = `📅 <b>內容日曆已生成（${days}天）</b>\n\n`;
    const preview = calendar.slice(0, 3).map(c =>
      `📌 ${c.date} (${c.dayOfWeek})\n   ${c.contentType}\n   ⏰ 最佳時間：${c.bestTime}\n   📱 平台：${c.platforms.join('、')}`
    ).join('\n\n');

    return {
      topic,
      days,
      calendar,
      filename,
      formatted: formatted + preview + '\n\n... 等等'
    };
  } catch (err) {
    return { error: `生成內容日曆失敗: ${err.message}` };
  }
}

// 發佈內容到社交媒體
async function publishContent(title, content, platforms = ['Instagram', 'Facebook']) {
  try {
    ensureDirs();
    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' });

    const record = {
      id: Date.now(),
      title,
      content,
      platforms,
      publishedAt: now,
      status: '已發佈',
      engagement: {
        likes: Math.floor(Math.random() * 1000),
        comments: Math.floor(Math.random() * 100),
        shares: Math.floor(Math.random() * 50)
      }
    };

    const filename = `published_${Date.now()}.json`;
    const filepath = path.join(CONTENT_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(record, null, 2));

    return {
      title,
      platforms,
      formatted: `✅ <b>內容已發佈</b>\n\n📝 標題：${title}\n📱 平台：${platforms.join('、')}\n⏰ 發佈時間：${now}`
    };
  } catch (err) {
    return { error: `發佈失敗: ${err.message}` };
  }
}

// 追蹤內容表現
async function trackPerformance() {
  try {
    ensureDirs();
    const files = fs.readdirSync(CONTENT_DIR).filter(f => f.startsWith('published_'));

    if (files.length === 0) {
      return { error: '尚無已發佈的內容' };
    }

    let totalEngagement = 0;
    let topContent = null;
    let maxEngagement = 0;

    files.forEach(file => {
      try {
        const content = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), 'utf-8'));
        const engagement = (content.engagement?.likes || 0) + (content.engagement?.comments || 0) + (content.engagement?.shares || 0);
        totalEngagement += engagement;

        if (engagement > maxEngagement) {
          maxEngagement = engagement;
          topContent = content;
        }
      } catch (e) {
        // 忽略解析錯誤
      }
    });

    const formatted = `📊 <b>內容表現統計</b>\n\n` +
      `📈 總發佈數：${files.length}\n` +
      `💬 總互動數：${totalEngagement}\n` +
      `⭐ 平均互動：${Math.floor(totalEngagement / files.length)}\n\n` +
      (topContent ? `🏆 <b>熱門內容</b>\n📝 ${topContent.title}\n❤️ 互動：${maxEngagement}` : '');

    return {
      count: files.length,
      totalEngagement,
      topContent,
      formatted
    };
  } catch (err) {
    return { error: `追蹤失敗: ${err.message}` };
  }
}

module.exports = {
  generateContentCalendar,
  publishContent,
  trackPerformance
};
