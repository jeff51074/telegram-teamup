const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

async function generateWeeklyReport() {
  try {
    ensureDirs();
    const customerFile = path.join(DATA_DIR, 'customers.json');
    const followUpFile = path.join(DATA_DIR, 'follow_ups.json');

    const customers = fs.existsSync(customerFile) ? JSON.parse(fs.readFileSync(customerFile, 'utf-8')) : [];
    const followUps = fs.existsSync(followUpFile) ? JSON.parse(fs.readFileSync(followUpFile, 'utf-8')) : [];

    const now = new Date();
    const stats = {
      total: customers.length,
      converted: followUps.filter(f => f.status === '已轉化').length,
      pending: followUps.filter(f => f.status === '待跟進').length,
      abandoned: followUps.filter(f => f.status === '已放棄').length
    };

    const rate = stats.total > 0 ? ((stats.converted / stats.total) * 100).toFixed(2) : 0;

    let reportContent = `📊 週銷售報告\n`;
    reportContent += `生成時間：${now.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n`;
    reportContent += `💰 轉化情況\n總客戶數：${stats.total}\n已轉化：${stats.converted}\n轉化率：${rate}%\n待跟進：${stats.pending}\n已放棄：${stats.abandoned}\n\n`;
    reportContent += `🎯 下週計劃\n繼續跟進${stats.pending}個待跟進客戶\n重點關注高價值客戶的轉化\n分析已放棄客戶的原因`;

    const timestamp = now.getTime();
    const filename = `weekly_report_${timestamp}.txt`;
    const filepath = path.join(REPORTS_DIR, filename);
    fs.writeFileSync(filepath, reportContent);

    return {
      type: 'weekly',
      filename,
      path: filepath,
      stats,
      formatted: `✅ 週報告已生成\n📄 文件：${filename}\n\n${reportContent}`
    };
  } catch (err) {
    return { error: `生成報告失敗: ${err.message}` };
  }
}

async function generateMonthlyReport() {
  try {
    ensureDirs();
    const now = new Date();
    const stats = { total: 0, converted: 0 };
    const filename = `monthly_report_${now.getTime()}.txt`;
    const filepath = path.join(REPORTS_DIR, filename);
    fs.writeFileSync(filepath, `📊 月度銷售報告\n${now.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}`);
    return { type: 'monthly', filename, path: filepath, formatted: `✅ 月報告已生成\n📄 文件：${filename}` };
  } catch (err) {
    return { error: `生成報告失敗: ${err.message}` };
  }
}

module.exports = { generateWeeklyReport, generateMonthlyReport };
