const axios = require('axios');

const TEAMUP_TOKEN = '4a7a5bdfc1f618b76f87700817db4c4c95edbc1ce92cd75f1f02cb7bc16cceb7';
const TEAMUP_CALENDAR = 'kst7n3wpfz1m4wa1jc';
const TEAMUP_API = `https://api.teamup.com/${TEAMUP_CALENDAR}`;
const teamup = axios.create({ baseURL: TEAMUP_API, headers: { 'Teamup-Token': TEAMUP_TOKEN } });

const SUBCAL = 14989974; // Others

function pad(n) { return String(n).padStart(2, '0'); }

async function main() {
  let total = 0;

  for (let year = 2026; year <= 2035; year++) {
    // 正式日子：10月23日
    const dateStr = `${year}-10-23`;
    await teamup.post('/events', {
      subcalendar_id: SUBCAL, title: '🎂 老婆生日', start_dt: dateStr, end_dt: dateStr, all_day: true
    });
    console.log(`  ✅ ${dateStr} — 🎂 老婆生日`);
    total++;

    // 提前1週提醒：10月16日
    const reminderStr = `${year}-10-16`;
    await teamup.post('/events', {
      subcalendar_id: SUBCAL, title: '🌹 提醒：下週老婆生日，記得訂花和準備禮物！', start_dt: reminderStr, end_dt: reminderStr, all_day: true
    });
    console.log(`  ✅ ${reminderStr} — 🌹 提醒：下週老婆生日，記得訂花和準備禮物！`);
    total++;

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n🎉 完成！共新增 ${total} 個事件`);
}

main().catch(e => { console.error('❌ 錯誤:', e.message); process.exit(1); });
