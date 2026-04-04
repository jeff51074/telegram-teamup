const axios = require('axios');

const TEAMUP_TOKEN = '4a7a5bdfc1f618b76f87700817db4c4c95edbc1ce92cd75f1f02cb7bc16cceb7';
const TEAMUP_CALENDAR = 'kst7n3wpfz1m4wa1jc';
const TEAMUP_API = `https://api.teamup.com/${TEAMUP_CALENDAR}`;
const teamup = axios.create({ baseURL: TEAMUP_API, headers: { 'Teamup-Token': TEAMUP_TOKEN } });

// 子日曆：Others=14989974
const SUBCAL = 14989974;

// 重要日子定義
const EVENTS = [
  { month: 2,  day: 14, title: '💕 情人節',         reminderTitle: '🌹 提醒：下週情人節，記得訂花！' },
  { month: 9,  day: 14, title: '💍 結婚週年紀念日',  reminderTitle: '🌹 提醒：下週結婚週年，記得訂花！' },
  { month: 6,  day: 1,  title: '❤️ 週年紀念日',      reminderTitle: '🌹 提醒：下週週年紀念，記得訂花！' },
  { month: 8,  day: 12, title: '🎂 媽媽生日',        reminderTitle: '🎁 提醒：下週媽媽生日，記得準備禮物和訂花！' },
  { month: 9,  day: 15, title: '🎂 爸爸生日',        reminderTitle: '🎁 提醒：下週爸爸生日，記得準備禮物！' },
  { month: 1,  day: 10, title: '🎂 女兒生日',        reminderTitle: '🎁 提醒：下週女兒生日，記得準備禮物！' },
  { month: 11, day: 1,  title: '🎂 兒子生日',        reminderTitle: '🎁 提醒：下週兒子生日，記得準備禮物！' },
];

const START_YEAR = 2026;
const END_YEAR = 2035;

function pad(n) { return String(n).padStart(2, '0'); }

async function createEvent(title, date) {
  const dateStr = `${date.year}-${pad(date.month)}-${pad(date.day)}`;
  await teamup.post('/events', {
    subcalendar_id: SUBCAL,
    title,
    start_dt: dateStr,
    end_dt: dateStr,
    all_day: true,
  });
  console.log(`  ✅ ${dateStr} — ${title}`);
}

function getReminderDate(year, month, day) {
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() - 7);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

async function main() {
  let total = 0;

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    console.log(`\n📅 ${year} 年`);

    for (const ev of EVENTS) {
      // 新增正式日子
      await createEvent(ev.title, { year, month: ev.month, day: ev.day });
      total++;

      // 新增提前1週提醒
      const reminder = getReminderDate(year, ev.month, ev.day);
      await createEvent(ev.reminderTitle, reminder);
      total++;

      // 避免 API rate limit
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.log(`\n🎉 完成！共新增 ${total} 個事件（${total / 2} 個日子 + ${total / 2} 個提前提醒）`);
}

main().catch(e => { console.error('❌ 錯誤:', e.message); process.exit(1); });
