require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const express = require('express');
const {
  addBossMessage, getBossMessages, clearBossMessages,
  addTask, markTaskDone, findPendingTaskByKeyword,
  getTasksByDate, getPendingTasks, getOverdueTasks,
  incrementRemindCount, formatTaskList, formatPendingReport
} = require('./tools/tasks');

const CLAUDE = process.env.CLAUDE_PATH || '/Users/wynn/.nvm/versions/node/v24.14.1/bin/claude';
const ON_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT;
const WORK_DIR = process.env.WORK_DIR || path.resolve(__dirname, '..');
const BOT_DIR = __dirname;

// ── Boss User ID（只有 Boss 的訊息會被收集為任務）────────
const BOSS_USER_ID = process.env.BOSS_USER_ID || '1168091068'; // 你的 Telegram user ID

// ── Data file paths（Railway Volume 掛載在 /data，本地用 BOT_DIR）─────────
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || BOT_DIR;
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const REVENUE_FILE = path.join(DATA_DIR, 'revenue.json');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');

// ── JSON file helpers ───────────────────────────────────
function readJsonFile(filePath, defaultValue) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), 'utf-8');
      return defaultValue;
    }
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Error reading ${filePath}:`, e.message);
    return defaultValue;
  }
}

function writeJsonFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error(`Error writing ${filePath}:`, e.message);
    return false;
  }
}

// Initialize data files if they don't exist
readJsonFile(CLIENTS_FILE, []);
readJsonFile(REVENUE_FILE, []);
readJsonFile(CONTENT_FILE, []);

// ── SOP Summaries ───────────────────────────────────────
const SOP_DATA = {
  '品牌定位': {
    title: '品牌定位 SOP',
    steps: [
      '1. 分析目标受众：年龄、痛点、消费习惯',
      '2. 竞品调研：找出3-5个竞品的定位差异',
      '3. 提炼核心价值主张（USP）：一句话说清你是谁',
      '4. 建立品牌视觉体系：logo、色彩、字体、调性',
      '5. 输出品牌手册，统一所有触点的表达'
    ]
  },
  '客户签约': {
    title: '客户签约流程 SOP',
    steps: [
      '1. 需求确认：与客户深入沟通，明确服务范围和预期',
      '2. 出报价方案：根据需求定制proposal，含时间线和费用',
      '3. 合同签署：发送合同，确认条款，双方签字',
      '4. 收取订金：签约后收取30-50%订金',
      '5. 项目启动：建群、安排kickoff会议、分配任务'
    ]
  },
  '内容制作': {
    title: '内容制作 SOP',
    steps: [
      '1. 选题策划：根据热点/痛点确定主题和角度',
      '2. 脚本撰写：写出分镜/文案，确认关键信息点',
      '3. 拍摄执行：按脚本拍摄，注意灯光、收音、构图',
      '4. 后期剪辑：剪辑、加字幕、配乐、调色',
      '5. 发布优化：选择最佳发布时间，撰写标题和标签'
    ]
  },
  '社媒运营': {
    title: '社媒运营 SOP',
    steps: [
      '1. 账号定位：明确平台选择和内容方向',
      '2. 内容日历：每周/每月规划发布内容排期',
      '3. 互动管理：及时回复评论和私信，维护社群',
      '4. 数据分析：每周复盘数据（播放量、互动率、涨粉）',
      '5. 迭代优化：根据数据调整内容策略和发布频率'
    ]
  },
  '项目交付': {
    title: '项目交付 SOP',
    steps: [
      '1. 交付物整理：汇总所有成果文件并归档',
      '2. 客户验收：提交给客户review，收集反馈',
      '3. 修改完善：根据反馈做最终修改（最多2轮）',
      '4. 尾款收取：验收通过后收取尾款',
      '5. 项目复盘：总结经验教训，更新案例库'
    ]
  }
};

// ── Weather API Configuration ──────────────────────────
const WEATHER_API = axios.create({ baseURL: 'https://api.open-meteo.com/v1' });

// City coordinates (latitude, longitude)
const CITY_COORDS = {
  '韓國': { lat: 37.5665, lon: 126.9780, name: '首爾, 韓國' },
  '漢城': { lat: 37.5665, lon: 126.9780, name: '首爾, 韓國' },
  '서울': { lat: 37.5665, lon: 126.9780, name: '首爾, 韓國' },
  '釜山': { lat: 35.0973, lon: 129.0331, name: '釜山, 韓國' },
  '大邱': { lat: 35.8722, lon: 128.6014, name: '大邱, 韓國' }
};

async function getWeather(location) {
  try {
    const coords = CITY_COORDS[location] || CITY_COORDS['韓國'];
    const res = await WEATHER_API.get('/forecast', {
      params: {
        latitude: coords.lat,
        longitude: coords.lon,
        current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum',
        timezone: 'Asia/Seoul'
      }
    });

    const current = res.data.current;
    const daily = res.data.daily;

    // Weather code to description mapping (WMO)
    const weatherDesc = {
      0: '晴天', 1: '多雲', 2: '陰天', 3: '陰天',
      45: '霧', 48: '霧', 51: '小雨', 53: '中等雨', 55: '大雨',
      61: '小雨', 63: '中等雨', 65: '大雨', 80: '陣雨', 81: '大陣雨', 82: '暴雨',
      85: '陣雪', 86: '暴雪', 95: '雷暴'
    };

    let text = `🌍 <b>${coords.name} 天氣預報</b>\n\n`;
    text += `<b>現在天氣：</b>\n`;
    text += `🌡️ 溫度：${current.temperature_2m}°C\n`;
    text += `💨 風速：${current.wind_speed_10m} km/h\n`;
    text += `💧 濕度：${current.relative_humidity_2m}%\n`;
    text += `☁️ 狀況：${weatherDesc[current.weather_code] || '未知'}\n\n`;

    text += `<b>今日預報：</b>\n`;
    text += `🔺 最高：${daily.temperature_2m_max[0]}°C\n`;
    text += `🔻 最低：${daily.temperature_2m_min[0]}°C\n`;
    text += `🌧️ 降雨量：${daily.precipitation_sum[0]} mm\n`;

    return text;
  } catch (e) {
    console.error('Weather API error:', e.message);
    return `❌ 無法獲取天氣信息：${e.message}`;
  }
}

// ── Browser instance (reusable) ─────────────────────────
let browser = null;
let browserPage = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({ headless: false }); // headless:false 讓你看到操作
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    browserPage = await context.newPage();
  }
  return browserPage;
}

async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    browserPage = null;
  }
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ALLOWED_CHATS = (process.env.TELEGRAM_CHAT_IDS || CHAT_ID || '').split(',').map(s => s.trim()).filter(Boolean);
const TEAMUP_TOKEN = process.env.TEAMUP_TOKEN;
const TEAMUP_CALENDAR = process.env.TEAMUP_CALENDAR;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TEAMUP_API = `https://api.teamup.com/${TEAMUP_CALENDAR}`;

// ── Operating Team 日曆（任務系統用）────────────────────
const OT_CALENDAR = process.env.OPERATING_TEAM_CALENDAR || 'kssh1zqukx5nk2htat';
const OT_TOKEN = process.env.OPERATING_TEAM_TOKEN || 'd64b9cef76aa72e2bec419fc40e55bc7b1537833b1191b205bc029a6061a8c91';
const OT_SUBCAL = parseInt(process.env.OPERATING_TEAM_SUBCAL || '15503793');
const OT_API = `https://api.teamup.com/${OT_CALENDAR}`;

const tg = axios.create({ baseURL: `https://api.telegram.org/bot${TELEGRAM_TOKEN}` });
const teamup = axios.create({ baseURL: TEAMUP_API, headers: { 'Teamup-Token': TEAMUP_TOKEN } });
const otTeamup = axios.create({ baseURL: OT_API, headers: { 'Teamup-Token': OT_TOKEN } });

// Initialize Anthropic client with web search
const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

let offset = 0;
const remindedEvents = new Set(); // 記錄已提醒過的事件，避免重複提醒

// ── Helpers ──────────────────────────────────────────────
function toDateStr(d) {
  // 使用馬來西亞時區（Asia/Kuala_Lumpur）而不是 UTC
  const year = d.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric' });
  const month = d.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', month: '2-digit' });
  const day = d.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', day: '2-digit' });
  return `${year}-${month}-${day}`;
}

function formatTime12h(date) {
  let h = parseInt(date.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', hour12: false }));
  const m = parseInt(date.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', minute: '2-digit' }));
  const period = h >= 12 ? 'pm' : 'am';
  if (h > 12) h -= 12;
  if (h === 0) h = 12;
  return m === 0 ? `${h}${period}` : `${h}:${String(m).padStart(2, '0')}${period}`;
}

function formatEvent(e) {
  const startDate = new Date(e.start_dt);
  const dateStr = startDate.toLocaleDateString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', month: 'numeric', day: 'numeric', weekday: 'short' });
  let line;
  if (e.all_day) {
    line = `📅 ${dateStr} — ${e.title} (全天)`;
  } else {
    const timeStr = formatTime12h(startDate);
    const endTime = formatTime12h(new Date(e.end_dt));
    line = `🕐 ${dateStr} ${timeStr}-${endTime} — ${e.title}`;
  }
  if (e.notes) line += `\n   📝 ${e.notes.replace(/<[^>]*>/g, '').trim()}`;
  return line;
}

async function getEvents(start, end) {
  const res = await teamup.get('/events', { params: { startDate: start, endDate: end } });
  return res.data.events || [];
}

// 子日曆：KL工作=14975029, Others=14989974, 会议=14971361, 顾客拍摄=14971396
const DEFAULT_SUBCAL = 14971361;

async function createEvent(title, startDt, endDt, allDay, notes = '') {
  const body = { subcalendar_id: DEFAULT_SUBCAL, title, start_dt: startDt, end_dt: endDt, all_day: allDay };
  if (notes) body.notes = notes;
  await teamup.post('/events', body);
}

async function deleteEvent(eventId) {
  await teamup.delete(`/events/${eventId}`);
}

async function updateEvent(eventId, updates) {
  if (!updates.subcalendar_id) updates.subcalendar_id = DEFAULT_SUBCAL;
  await teamup.put(`/events/${eventId}`, updates);
}

// ── 重複行程檢測 ──────────────────────────────────────
// 返回重複組（每組是同一個行程的多個副本）
function findDuplicateGroups(events) {
  const used = new Set();
  const groups = [];
  for (let i = 0; i < events.length; i++) {
    if (used.has(i)) continue;
    const group = [events[i]];
    const aTitle = events[i].title.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
    const aDate = events[i].start_dt.substring(0, 10);
    for (let j = i + 1; j < events.length; j++) {
      if (used.has(j)) continue;
      const bTitle = events[j].title.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, '');
      const bDate = events[j].start_dt.substring(0, 10);
      if (aDate !== bDate) continue;
      if (aTitle.includes(bTitle) || bTitle.includes(aTitle)) {
        group.push(events[j]);
        used.add(j);
      }
    }
    if (group.length > 1) {
      used.add(i);
      groups.push(group);
    }
  }
  return groups;
}

// ── Client helpers ──────────────────────────────────────
const CLIENT_STATUS_MAP = {
  'lead': '潜在客户', 'contacted': '已联系', 'proposal': '已报价',
  'signed': '已签约', 'completed': '已完成'
};
const CLIENT_STATUS_EMOJI = {
  'lead': '🔵', 'contacted': '🟡', 'proposal': '🟠', 'signed': '🟢', 'completed': '✅'
};

function formatClientList(clients) {
  if (!clients.length) return '暂无客户记录';
  const grouped = {};
  for (const status of ['lead', 'contacted', 'proposal', 'signed', 'completed']) {
    const inStatus = clients.filter(c => c.status === status);
    if (inStatus.length) grouped[status] = inStatus;
  }
  let text = '';
  for (const [status, list] of Object.entries(grouped)) {
    const emoji = CLIENT_STATUS_EMOJI[status] || '⚪';
    text += `\n${emoji} <b>${CLIENT_STATUS_MAP[status] || status}</b> (${list.length})\n`;
    for (const c of list) {
      text += `  - ${c.name}`;
      if (c.company) text += ` (${c.company})`;
      if (c.budget) text += ` | 预算:${c.budget}`;
      if (c.service_type) text += ` | ${c.service_type}`;
      text += '\n';
    }
  }
  return text;
}

// ── Content helpers ─────────────────────────────────────
const CONTENT_STATUS_MAP = {
  'idea': '创意', 'scripting': '写脚本', 'filming': '拍摄中',
  'editing': '剪辑中', 'published': '已发布'
};
const CONTENT_STATUS_EMOJI = {
  'idea': '💡', 'scripting': '📝', 'filming': '🎬', 'editing': '✂️', 'published': '📢'
};

function formatContentList(contents) {
  if (!contents.length) return '暂无内容记录';
  const grouped = {};
  for (const status of ['idea', 'scripting', 'filming', 'editing', 'published']) {
    const inStatus = contents.filter(c => c.status === status);
    if (inStatus.length) grouped[status] = inStatus;
  }
  let text = '';
  for (const [status, list] of Object.entries(grouped)) {
    const emoji = CONTENT_STATUS_EMOJI[status] || '⚪';
    text += `\n${emoji} <b>${CONTENT_STATUS_MAP[status] || status}</b> (${list.length})\n`;
    for (const c of list) {
      text += `  - ${c.topic}`;
      if (c.platform) text += ` | ${c.platform}`;
      if (c.created_date) text += ` | ${c.created_date}`;
      text += '\n';
    }
  }
  return text;
}

// ── Revenue helpers ─────────────────────────────────────
function formatRevenueReport(entries, periodLabel) {
  if (!entries.length) return `${periodLabel}暂无收入记录`;
  let total = 0;
  const byType = {};
  let text = `📊 <b>${periodLabel}收入报告</b>\n\n`;
  for (const e of entries) {
    total += e.amount;
    byType[e.type] = (byType[e.type] || 0) + e.amount;
    text += `  - ${e.client} | RM${e.amount.toLocaleString()} | ${e.type} | ${e.date}\n`;
  }
  text += `\n<b>总计：RM${total.toLocaleString()}</b>\n`;
  if (Object.keys(byType).length > 1) {
    text += '\n按类型：\n';
    for (const [type, amt] of Object.entries(byType)) {
      text += `  ${type}: RM${amt.toLocaleString()}\n`;
    }
  }
  return text;
}

// ── Send message ─────────────────────────────────────────
async function send(text, chatId) {
  await tg.post('/sendMessage', { chat_id: chatId || CHAT_ID, text, parse_mode: 'HTML' });
}

// 發送帶 inline 按鈕的訊息
async function sendWithButtons(text, buttons, chatId) {
  await tg.post('/sendMessage', {
    chat_id: chatId || CHAT_ID,
    text,
    parse_mode: 'HTML',
    reply_markup: JSON.stringify({ inline_keyboard: buttons })
  });
}

// ── AI 任務整理：把 Boss 訊息整理成結構化任務 ─────────────
async function summarizeBossMessages(chatId) {
  const msgs = getBossMessages();
  if (!msgs.length) {
    await send('📭 目前沒有收集到新的任務訊息', chatId);
    return;
  }

  const now = new Date();
  const todayStr = toDateStr(now);

  // 把所有 boss 訊息組合成一段文字給 Claude 分析
  const msgText = msgs.map(m => {
    const t = new Date(m.time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
    return `[${t}] ${m.from}: ${m.text}`;
  }).join('\n');

  const prompt = `你是一個任務整理助手。以下是團隊今天在群裡的所有訊息（包含誰說的）：

${msgText}

請從這些訊息中提取所有任務/工作指令，忽略閒聊和非任務相關的內容。

你必須只返回一個 JSON 數組（不要包含任何其他文字），格式如下：
[
  {
    "title": "任務標題（簡潔明確）",
    "assignee": "負責人（如果老闆有指定的話，沒指定就留空）",
    "deadline": "截止時間（如果有提到的話，格式 HH:mm 或 YYYY-MM-DD，沒提到就留空）",
    "has_time": true/false（是否有明確的時間點，如果有就加入日曆）
  }
]

今天日期：${todayStr}
如果沒有任何任務，返回空數組 []`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    });

    let answer = '';
    for (const block of response.content) {
      if (block.type === 'text') answer += block.text;
    }

    // 解析 JSON
    const jsonMatch = answer.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      await send('❌ 無法解析任務，請稍後再試', chatId);
      return;
    }

    const taskItems = JSON.parse(jsonMatch[0]);
    if (!taskItems.length) {
      await send('🤔 從訊息中沒有找到明確的任務指令', chatId);
      return;
    }

    // 建立任務 + 日曆事件
    const createdTasks = [];
    for (const item of taskItems) {
      // 如果有明確時間，也加到 TeamUp 日曆
      let calendarEventId = null;
      if (item.has_time && item.deadline) {
        try {
          let startDt, endDt;
          if (item.deadline.includes(':') && !item.deadline.includes('-')) {
            // 只有時間 HH:mm → 今天的那個時間
            startDt = `${todayStr}T${item.deadline}:00`;
            const [h, m] = item.deadline.split(':').map(Number);
            const endH = h + 1;
            endDt = `${todayStr}T${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
          } else {
            startDt = `${item.deadline}T09:00:00`;
            endDt = `${item.deadline}T10:00:00`;
          }
          const res = await otTeamup.post('/events', {
            subcalendar_id: OT_SUBCAL,
            title: `📌 ${item.title}${item.assignee ? ' → ' + item.assignee : ''}`,
            start_dt: startDt,
            end_dt: endDt,
            all_day: false
          });
          calendarEventId = res.data?.event?.id || null;
        } catch (e) {
          console.error('Calendar create error:', e.message);
        }
      }

      const task = addTask({
        title: item.title,
        assignee: item.assignee || '',
        deadline: item.deadline || '',
        calendarEventId,
        date: todayStr
      });
      createdTasks.push(task);
    }

    // 發送任務清單 + inline 按鈕
    let text = `📋 <b>今日任務整理</b>（從 ${msgs.length} 條訊息中提取）\n\n`;
    const buttons = [];
    for (let i = 0; i < createdTasks.length; i++) {
      const t = createdTasks[i];
      const assignee = t.assignee ? ` → <b>${t.assignee}</b>` : '';
      const deadline = t.deadline ? ` ⏰ ${t.deadline}` : '';
      const calendar = t.calendarEventId ? ' 📅' : '';
      text += `⬜ ${i + 1}. ${t.title}${assignee}${deadline}${calendar}\n`;

      // 每個任務一行按鈕
      buttons.push([{
        text: `✅ 完成: ${t.title.substring(0, 30)}`,
        callback_data: `task_done_${t.id}`
      }]);
    }

    text += `\n👆 完成後點按鈕回報`;

    await sendWithButtons(text, buttons, chatId);

    // 清空 boss 訊息緩存
    clearBossMessages();

    console.log(`✅ 已整理 ${createdTasks.length} 個任務`);
  } catch (e) {
    console.error('Task summary error:', e.message);
    await send(`❌ 任務整理失敗：${e.message}`, chatId);
  }
}

// ── Ask Claude with Web Search ──────────────────────────
async function askClaudeWithSearch(question, jeffMode = false, teamMode = false) {
  try {
    console.log('🔍 Asking Claude:', question);

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      system: buildSystemPrompt(jeffMode, teamMode),  // ✅ 使用正確的系統提示（包含日期信息）
      messages: [
        {
          role: 'user',
          content: question
        }
      ]
    });

    // Extract text from response
    let answer = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        answer += block.text;
      }
    }

    console.log('✅ Claude response received');
    return answer || '❌ 無法獲得回答';
  } catch (e) {
    console.error('❌ Claude API error:', e.message);
    return `❌ 調用 Claude API 失敗：${e.message}`;
  }
}

// ── Build system prompt for Claude ───────────────────────
function buildSystemPrompt(jeffMode = false, teamMode = false) {
  const now = new Date();
  const todayStr = toDateStr(now);
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const timeStr = now.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });

  const calendarNote = jeffMode
    ? `\n⭐ 重要：此消息以 "jeff" 開頭，代表要加入 Jeff 的個人行程日曆（不是 Operating Team 日曆）。新增行程時使用 create_event action（個人日曆），不要用 auto_tasks。`
    : teamMode
    ? `\n⭐ 重要：此消息含「拍攝/拍摄」關鍵字，代表是拍攝行程安排。使用 create_event action 寫入 Operating Team 日曆，不要用 auto_tasks 任務系統。`
    : '';

  return `你是一个 Telegram 日历助手机器人。用户会用自然语言跟你说话，你需要理解他们的意图并返回 JSON 动作。${calendarNote}

当前时间信息：
- 今天是 ${todayStr}（星期${dayOfWeek}），现在是 ${timeStr}（马来西亚时间 Asia/Kuala_Lumpur）

你必须且只能返回一个 JSON 对象（不要包含任何其他文字、不要用 markdown code block），格式如下：

1. 查询 Jeff 个人行程：
{"action":"get_events","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"你要回复用户的前缀文字"}

1b. 查询团队行程（用户说"团队行程/团队日历/Operating Team/拍摄行程查看/团队今天/团队明天"）：
{"action":"get_team_events","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"你要回复用户的前缀文字"}

2. 新增行程：
{"action":"create_event","title":"行程标题","start_dt":"YYYY-MM-DDTHH:mm:00","end_dt":"YYYY-MM-DDTHH:mm:00","all_day":false,"notes":"地点、备注、提醒事项等细节","reply":"确认新增的回复"}
- 如果是全天行程：start_dt 和 end_dt 用 "YYYY-MM-DD" 格式，all_day 设为 true
- 如果用户没说结束时间，默认持续1小时
- notes 字段：把地点、需要带的东西、注意事项等细节都写进去（没有细节就省略这个字段）

3. 搜索行程（用于删除/修改前先搜索）：
{"action":"search_events","keyword":"关键词","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"搜索说明"}

4. 删除单个行程：
{"action":"delete_event","keyword":"关键词","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"确认删除的回复"}
- 如果用户说"全部删除/都删掉/一起删"，加 "delete_all":true

4b. 批量删除多个不同行程（用户一次列出多个要删的）：
{"action":"delete_events_bulk","keywords":["关键词1","关键词2","关键词3"],"start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"批量删除中..."}

5. 修改行程：
{"action":"update_event","keyword":"关键词","start":"YYYY-MM-DD","end":"YYYY-MM-DD","updates":{"title":"新标题"},"reply":"确认修改的回复"}
- updates 可包含：title, start_dt, end_dt, all_day

6. 执行 Claude Code 任务（非日历相关的请求）：
{"action":"claude_code","prompt":"要执行的指令","reply":"处理中的回复"}

7. 浏览器自动化（用户用简单语言就能操控浏览器）：
{"action":"browser","steps":[...],"reply":"处理中的回复"}

steps 里每个对象的 do 值：
- goto：打开网址 → {"do":"goto","url":"https://..."}
- screenshot：截图 → {"do":"screenshot"}
- click：点击 → {"do":"click","selector":"CSS选择器"}
- fill：输入文字 → {"do":"fill","selector":"CSS选择器","value":"内容"}
- text：抓取文字 → {"do":"text","selector":"CSS选择器"}
- wait：等待 → {"do":"wait","ms":毫秒数}
- scroll：滚动 → {"do":"scroll","direction":"down或up"}
- back/forward：上一页/下一页
- close：关闭浏览器

用户说话的自然语言对照（你要自己判断意图）：
- "开google" / "打开youtube" / "去百度" → goto + screenshot
- "搜xxx" / "找xxx" / "search xxx" → goto谷歌/对应网站 + fill搜索框 + click搜索按钮 + screenshot
- "截图" / "给我看" / "现在画面" → screenshot
- "点那个按钮" / "按登录" → click + screenshot
- "输入xxx" / "打xxx" → fill
- "看看内容" / "页面写什么" / "抓取文字" → text + 用 body 选择器
- "往下滑" / "滚动" → scroll
- "关掉" / "关浏览器" / "关闭" → close
- "返回" / "上一页" → back

重要：用户不会说CSS选择器，你要根据常见网站结构猜测合理的selector。
例如谷歌搜索框是 textarea[name=q]，搜索按钮可以用 input[name=btnK]。
如果不确定selector，先用 goto + screenshot 让用户看到画面再说。

8. 普通对话回复：
{"action":"reply","reply":"你的回复内容"}

9. 新增客户：
{"action":"add_client","name":"客户名","company":"公司名","whatsapp":"电话","status":"lead","service_type":"服务类型","budget":"预算","notes":"备注","reply":"确认回复"}
- status 可选值：lead / contacted / proposal / signed / completed
- 用户说 "新增客户 ABC公司 预算5万" → 提取信息填入对应字段

10. 客户列表：
{"action":"list_clients","reply":"客户列表"}
- 用户说 "客户列表" / "pipeline" / "客户管道" → 列出所有客户

11. 更新客户状态：
{"action":"update_client_status","keyword":"客户名关键词","status":"新状态","notes":"备注（可选）","reply":"确认回复"}
- 用户说 "更新 ABC 状态为已签约" → keyword="ABC", status="signed"
- 状态中文对照：潜在客户=lead, 已联系=contacted, 已报价=proposal, 已签约=signed, 已完成=completed

12. 查询 SOP：
{"action":"get_sop","keyword":"SOP关键词","reply":"回复"}
- 可用的SOP：品牌定位、客户签约、内容制作、社媒运营、项目交付
- 用户说 "SOP 品牌定位" / "怎么做客户签约" → 返回对应SOP

13. 记录收入：
{"action":"add_revenue","client":"客户名","amount":5000,"type":"收入类型","notes":"备注","reply":"确认回复"}
- 用户说 "收入 ABC公司 RM5000 顾问费" → client="ABC公司", amount=5000, type="顾问费"

14. 收入报告：
{"action":"revenue_report","period":"month","reply":"收入报告"}
- period: "month"=本月, "week"=本周, "all"=全部
- 用户说 "本月收入" / "收入报告" → period="month"

15. 新增内容任务：
{"action":"add_content","topic":"内容主题","platform":"发布平台","status":"idea","notes":"备注","reply":"确认回复"}
- status 可选值：idea / scripting / filming / editing / published
- 用户说 "新内容 主题:品牌定位误区 平台:小红书 状态:待拍" → topic="品牌定位误区", platform="小红书", status="filming"
- 状态中文对照：创意/想法=idea, 写脚本=scripting, 拍摄中/待拍=filming, 剪辑中=editing, 已发布=published

16. 内容列表：
{"action":"list_content","reply":"内容列表"}
- 用户说 "内容列表" / "内容管道" → 列出所有内容任务

17. 更新内容状态：
{"action":"update_content","keyword":"内容主题关键词","status":"新状态","notes":"备注（可选）","reply":"确认回复"}
- 用户说 "更新 品牌定位误区 状态为已发布" → keyword="品牌定位误区", status="published"

18. 天气查询：
{"action":"weather","location":"位置","reply":"天气信息"}
- 支持的位置：韓國/漢城/首爾、釜山、大邱（默认首爾）
- 用户说 "查韓國天氣" / "今天首爾天氣如何" / "釜山天氣" → location="韓國" 或 "釜山"

19. 整理任務（Boss 说 "整理任务" / "总结今天" / "任务清单" / "summary"）：
{"action":"summarize_tasks","reply":"正在整理任務..."}

20. 查看待办任務：
{"action":"list_pending_tasks","reply":"待办任务"}
- 用户说 "待办" / "还有什么没做" / "任务进度" → 列出未完成的任务

21. ⭐ 即時任務偵測（非常重要！）：
当消息包含任务/工作指令时，自动创建任务：
{"action":"auto_tasks","tasks":[{"title":"任務標題","assignee":"負責人","deadline":"HH:mm或YYYY-MM-DD","has_time":true}],"reply":"回复确认"}

判断规则：
- "記得去問信用卡" → tasks:[{title:"問信用卡"}]
- "拆解影片" → tasks:[{title:"拆解影片"}]
- "Joey 幫我剪那個 reel" → tasks:[{title:"剪 reel",assignee:"Joey"}]
- "明天之前把報價單發出去" → tasks:[{title:"發報價單",deadline:"明天的日期"}]
- 如果没说日期/时间 → 默认今天，has_time=false
- 如果没说负责人 → assignee 留空
- 閒聊、問問題、查行程 等非任務內容 → 不要用此 action
- 一条消息可能包含多个任务

22. 員工完成回報：
当有人说完成了某件事时，匹配任务并标记完成：
{"action":"complete_task","keyword":"匹配关键词","reply":"确认完成的回复"}
- "信用卡問好了" → keyword="信用卡"
- "影片剪好了" → keyword="影片"
- "做好了"/"完成了"/"搞定"/"OK了" + 关键词
- 如果无法确定是哪个任务 → 用 reply action 问清楚

规则：
- "下周三" 请根据今天日期计算出具体日期
- "后天" "大后天" 也请计算出具体日期
- 用户说中文时用中文回复，英文时用英文
- reply 字段支持 HTML 格式（<b>粗体</b>等）
- 如果用户的请求模糊，用 reply action 问清楚
- 你可以处理任何对话，不限于日历功能
- ⭐ 任务检测优先：每条消息都要先判断是否包含任务指令，如果有就用 auto_tasks`;
}

// ── Execute action from Claude's response ────────────────
async function executeAction(actionJson, replyTo) {
  // 包裝 send，自動帶入 replyTo
  const reply = (text) => send(text, replyTo);
  const replyWithButtons = (text, buttons) => sendWithButtons(text, buttons, replyTo);

  let parsed;
  try {
    // Try to extract JSON from response (handle possible markdown wrapping)
    const jsonMatch = actionJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ 無法從回覆中提取 JSON');
      console.error('回覆內容:', actionJson.substring(0, 200));
      throw new Error('No JSON found');
    }

    const jsonStr = jsonMatch[0];
    console.log('✅ 提取的 JSON:', jsonStr.substring(0, 100));
    parsed = JSON.parse(jsonStr);
    console.log('✅ JSON 解析成功，action:', parsed.action);
  } catch (e) {
    // If Claude didn't return valid JSON, treat it as a direct reply
    console.error('❌ JSON 解析失敗:', e.message);
    await reply(actionJson.substring(0, 4000) || '❌ 无法理解，请再说一次');
    return;
  }

  const { action } = parsed;

  if (action === 'get_events') {
    const events = await getEvents(parsed.start, parsed.end);
    if (!events.length) {
      await reply(parsed.reply || '没有找到行程 ✅');
    } else {
      const list = events.map(formatEvent).join('\n');
      await reply(`${parsed.reply || '📆 行程如下：'}\n\n${list}`);
      // 自動檢測重複行程
      const dupGroups = findDuplicateGroups(events);
      for (const group of dupGroups) {
        let msg = `⚠️ <b>發現 ${group.length} 個相似行程：</b>\n\n`;
        group.forEach((e, i) => {
          msg += `${i + 1}️⃣ ${formatEvent(e)}\n\n`;
        });
        msg += `要保留哪一個？（其餘刪除）`;
        const buttons = group.map((e, i) => [{
          text: `${i + 1}️⃣ 只保留「${e.title.substring(0, 20)}」`,
          callback_data: `dup_pick_${e.id}_${group.filter((_, j) => j !== i).map(x => x.id).join('_')}`
        }]);
        buttons.push([{ text: '✌️ 全部保留', callback_data: 'dup_keep_both' }]);
        await replyWithButtons(msg, buttons);
      }
    }
  }
  else if (action === 'get_team_events') {
    const events = await getOTEvents(parsed.start, parsed.end);
    if (!events.length) {
      await reply(parsed.reply || '📭 沒有團隊行程');
    } else {
      const sorted = events.sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
      const list = sorted.map(formatEvent).join('\n');
      await reply(`${parsed.reply || '📅 團隊行程：'}\n\n${list}`);
    }
  }
  else if (action === 'create_event') {
    // 重複檢測：查同一天是否有相似行程
    const eventDate = parsed.start_dt.substring(0, 10);
    const existingEvents = await getEvents(eventDate, eventDate);
    const newTitle = parsed.title.toLowerCase();
    const duplicates = existingEvents.filter(e => {
      const oldTitle = e.title.toLowerCase();
      // 標題包含關係 或 超過50%文字重疊
      if (oldTitle.includes(newTitle) || newTitle.includes(oldTitle)) return true;
      const words1 = newTitle.split(/[\s,，.。]+/).filter(w => w.length > 1);
      const words2 = oldTitle.split(/[\s,，.。]+/).filter(w => w.length > 1);
      if (words1.length === 0 || words2.length === 0) return false;
      const overlap = words1.filter(w => words2.some(w2 => w2.includes(w) || w.includes(w2)));
      return overlap.length / Math.max(words1.length, words2.length) > 0.5;
    });

    if (duplicates.length > 0) {
      // 先建立新行程，拿到 ID
      const newEventRes = await teamup.post('/events', {
        subcalendar_id: DEFAULT_SUBCAL, title: parsed.title,
        start_dt: parsed.start_dt, end_dt: parsed.end_dt,
        all_day: parsed.all_day, ...(parsed.notes ? { notes: parsed.notes } : {})
      });
      const newEvent = newEventRes.data.event;
      const allEvents = [newEvent, ...duplicates];
      let msg = `⚠️ <b>新增行程後發現 ${allEvents.length} 個相似行程：</b>\n\n`;
      allEvents.forEach((e, i) => {
        msg += `${i + 1}️⃣ ${formatEvent(e)}${i === 0 ? ' 🆕' : ''}\n\n`;
      });
      msg += `要保留哪一個？（其餘刪除）`;
      const buttons = allEvents.map((e, i) => [{
        text: `${i + 1}️⃣ 只保留「${e.title.substring(0, 20)}」${i === 0 ? ' 🆕' : ''}`,
        callback_data: `dup_pick_${e.id}_${allEvents.filter((_, j) => j !== i).map(x => x.id).join('_')}`
      }]);
      buttons.push([{ text: '✌️ 全部保留', callback_data: 'dup_keep_both' }]);
      await replyWithButtons(msg, buttons);
    } else {
      await createEvent(parsed.title, parsed.start_dt, parsed.end_dt, parsed.all_day, parsed.notes || '');
      let confirmMsg = parsed.reply || `✅ 已新增：${parsed.title}`;
      if (parsed.notes) confirmMsg += `\n📝 備注：${parsed.notes}`;
      await reply(confirmMsg);
    }
  }
  else if (action === 'search_events') {
    const events = await getEvents(parsed.start, parsed.end);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = keyword
      ? events.filter(e => e.title.toLowerCase().includes(keyword))
      : events;
    if (!matched.length) {
      await reply(`没有找到包含「${parsed.keyword}」的行程`);
    } else {
      const list = matched.map((e, i) => `${i + 1}. ${formatEvent(e)} [ID:${e.id}]`).join('\n');
      await reply(`${parsed.reply || '🔍 搜索结果：'}\n\n${list}`);
    }
  }
  else if (action === 'delete_event') {
    const events = await getEvents(parsed.start, parsed.end);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = events.filter(e => e.title.toLowerCase().includes(keyword));
    if (!matched.length) {
      await reply(`没有找到包含「${parsed.keyword}」的行程，无法删除`);
    } else if (matched.length === 1) {
      await deleteEvent(matched[0].id);
      await reply(parsed.reply || `✅ 已删除：${matched[0].title}`);
    } else if (parsed.delete_all) {
      // 批量刪除所有匹配
      for (const e of matched) await deleteEvent(e.id);
      await reply(`✅ 已刪除 ${matched.length} 個行程：\n${matched.map(e => `• ${e.title}`).join('\n')}`);
    } else {
      const list = matched.map((e, i) => `${i + 1}. ${formatEvent(e)}`).join('\n');
      await reply(`找到 ${matched.length} 個匹配的行程：\n\n${list}\n\n要全部刪除嗎？說「確認刪除 ${parsed.keyword}」`);
    }
  }
  else if (action === 'delete_events_bulk') {
    // 批量刪除多個不同關鍵詞
    const keywords = parsed.keywords || [];
    const start = parsed.start || toDateStr(new Date());
    const end = parsed.end || toDateStr(new Date(Date.now() + 30 * 86400000));
    const events = await getEvents(start, end);
    const deleted = [];
    const notFound = [];
    for (const kw of keywords) {
      const matched = events.filter(e => e.title.toLowerCase().includes(kw.toLowerCase()));
      if (matched.length) {
        for (const e of matched) { await deleteEvent(e.id); deleted.push(e.title); }
      } else {
        notFound.push(kw);
      }
    }
    let msg = '';
    if (deleted.length) msg += `✅ 已刪除 ${deleted.length} 個：\n${deleted.map(t => `• ${t}`).join('\n')}`;
    if (notFound.length) msg += `\n\n⚠️ 找不到：${notFound.join('、')}`;
    await reply(msg || '沒有找到任何行程');
  }
  else if (action === 'update_event') {
    const events = await getEvents(parsed.start, parsed.end);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = events.filter(e => e.title.toLowerCase().includes(keyword));
    if (!matched.length) {
      await reply(`没有找到包含「${parsed.keyword}」的行程，无法修改`);
    } else if (matched.length === 1) {
      await updateEvent(matched[0].id, parsed.updates);
      await reply(parsed.reply || `✅ 已修改：${matched[0].title}`);
    } else {
      const list = matched.map((e, i) => `${i + 1}. ${formatEvent(e)}`).join('\n');
      await reply(`找到多个匹配的行程，请说明要修改哪一个：\n\n${list}`);
    }
  }
  else if (action === 'browser') {
    await reply(parsed.reply || '🌐 正在操作浏览器...');
    try {
      const page = await getBrowser();
      const results = [];
      for (const step of parsed.steps) {
        switch (step.do) {
          case 'goto':
            await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            results.push(`✅ 已打开 ${step.url}`);
            break;
          case 'screenshot': {
            const path = `/tmp/browser_${Date.now()}.png`;
            await page.screenshot({ path, fullPage: false });
            await tg.post('/sendPhoto', (() => {
              const form = new (require('form-data'))();
              form.append('chat_id', CHAT_ID);
              form.append('photo', require('fs').createReadStream(path));
              return form;
            })(), { headers: { 'Content-Type': 'multipart/form-data' } });
            results.push('📸 已截图');
            break;
          }
          case 'click':
            await page.click(step.selector, { timeout: 5000 });
            results.push(`✅ 已点击 ${step.selector}`);
            break;
          case 'fill':
            await page.fill(step.selector, step.value, { timeout: 5000 });
            results.push(`✅ 已输入「${step.value}」`);
            break;
          case 'text': {
            const content = await page.textContent(step.selector, { timeout: 5000 });
            const trimmed = (content || '').trim().substring(0, 2000);
            results.push(`📄 内容：${trimmed}`);
            break;
          }
          case 'wait':
            await page.waitForTimeout(step.ms || 1000);
            results.push(`⏳ 等待 ${step.ms || 1000}ms`);
            break;
          case 'scroll':
            await page.evaluate((dir) => {
              window.scrollBy(0, dir === 'up' ? -500 : 500);
            }, step.direction || 'down');
            results.push(`✅ 已滚动${step.direction === 'up' ? '上' : '下'}`);
            break;
          case 'back':
            await page.goBack();
            results.push('✅ 已返回');
            break;
          case 'forward':
            await page.goForward();
            results.push('✅ 已前进');
            break;
          case 'close':
            await closeBrowser();
            results.push('✅ 浏览器已关闭');
            break;
        }
      }
      if (results.length) await reply(results.join('\n'));
    } catch (e) {
      await reply(`❌ 浏览器操作失败：${e.message}`);
    }
  }
  else if (action === 'claude_code') {
    if (ON_RAILWAY) {
      await reply('⚙️ Claude Code 功能需在本地伺服器執行，Railway 環境不支持。');
      return;
    }
    await reply(parsed.reply || '⚙️ Claude Code 执行中...');
    execFile(
      CLAUDE,
      ['-p', parsed.prompt, '--output-format', 'text'],
      { cwd: WORK_DIR, timeout: 120000, maxBuffer: 1024 * 1024 },
      async (err, stdout, stderr) => {
        if (err) {
          await reply(`❌ Claude Code 执行失败：${err.message.substring(0, 500)}`);
          return;
        }
        const result = (stdout || '').trim();
        if (!result) {
          await reply('✅ Claude Code 已执行完毕（无输出）');
          return;
        }
        // Telegram 消息上限 4096 字，分段发送
        const MAX_LEN = 3900;
        if (result.length <= MAX_LEN) {
          await reply(`✅ <b>Claude Code 结果：</b>\n\n${result}`);
        } else {
          const parts = Math.ceil(result.length / MAX_LEN);
          for (let i = 0; i < parts; i++) {
            const chunk = result.substring(i * MAX_LEN, (i + 1) * MAX_LEN);
            await reply(`📄 (${i + 1}/${parts})\n\n${chunk}`);
          }
        }
      }
    );
  }
  // ── Client Pipeline ───────────────────────────────────
  else if (action === 'add_client') {
    const clients = readJsonFile(CLIENTS_FILE, []);
    const newClient = {
      id: Date.now().toString(),
      name: parsed.name || '未命名',
      company: parsed.company || '',
      whatsapp: parsed.whatsapp || '',
      status: parsed.status || 'lead',
      service_type: parsed.service_type || '',
      budget: parsed.budget || '',
      notes: parsed.notes || '',
      created_date: toDateStr(new Date())
    };
    clients.push(newClient);
    if (writeJsonFile(CLIENTS_FILE, clients)) {
      await reply(parsed.reply || `✅ 已新增客户：${newClient.name}${newClient.company ? ' (' + newClient.company + ')' : ''}`);
    } else {
      await reply('❌ 保存客户数据失败');
    }
  }
  else if (action === 'list_clients') {
    const clients = readJsonFile(CLIENTS_FILE, []);
    const text = formatClientList(clients);
    await reply(`👥 <b>客户管道</b>（共 ${clients.length} 个客户）\n${text}`);
  }
  else if (action === 'update_client_status') {
    const clients = readJsonFile(CLIENTS_FILE, []);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = clients.filter(c =>
      c.name.toLowerCase().includes(keyword) ||
      (c.company && c.company.toLowerCase().includes(keyword))
    );
    if (!matched.length) {
      await reply(`没有找到包含「${parsed.keyword}」的客户`);
    } else if (matched.length === 1) {
      matched[0].status = parsed.status || matched[0].status;
      if (parsed.notes) matched[0].notes = parsed.notes;
      if (writeJsonFile(CLIENTS_FILE, clients)) {
        const statusLabel = CLIENT_STATUS_MAP[matched[0].status] || matched[0].status;
        await reply(parsed.reply || `✅ 已更新 ${matched[0].name} 状态为：${statusLabel}`);
      } else {
        await reply('❌ 保存客户数据失败');
      }
    } else {
      const list = matched.map((c, i) => `${i + 1}. ${c.name}${c.company ? ' (' + c.company + ')' : ''} - ${CLIENT_STATUS_MAP[c.status] || c.status}`).join('\n');
      await reply(`找到多个匹配的客户，请说明要更新哪一个：\n\n${list}`);
    }
  }
  // ── SOP ───────────────────────────────────────────────
  else if (action === 'get_sop') {
    const keyword = (parsed.keyword || '').toLowerCase();
    let found = null;
    for (const [key, sop] of Object.entries(SOP_DATA)) {
      if (key.includes(keyword) || keyword.includes(key)) {
        found = sop;
        break;
      }
    }
    if (!found) {
      // Try partial match
      for (const [key, sop] of Object.entries(SOP_DATA)) {
        for (const char of keyword) {
          if (key.includes(char) && keyword.length > 1) {
            found = sop;
            break;
          }
        }
        if (found) break;
      }
    }
    if (found) {
      const text = `📋 <b>${found.title}</b>\n\n${found.steps.join('\n')}`;
      await reply(text);
    } else {
      const available = Object.keys(SOP_DATA).join('、');
      await reply(`没有找到相关SOP。可用的SOP：${available}`);
    }
  }
  // ── Revenue ───────────────────────────────────────────
  else if (action === 'add_revenue') {
    const revenue = readJsonFile(REVENUE_FILE, []);
    const entry = {
      id: Date.now().toString(),
      client: parsed.client || '未知',
      amount: Number(parsed.amount) || 0,
      type: parsed.type || '其他',
      notes: parsed.notes || '',
      date: toDateStr(new Date())
    };
    revenue.push(entry);
    if (writeJsonFile(REVENUE_FILE, revenue)) {
      await reply(parsed.reply || `✅ 已记录收入：${entry.client} RM${entry.amount.toLocaleString()} (${entry.type})`);
    } else {
      await reply('❌ 保存收入数据失败');
    }
  }
  else if (action === 'revenue_report') {
    const revenue = readJsonFile(REVENUE_FILE, []);
    const now = new Date();
    let filtered = revenue;
    let periodLabel = '全部';

    if (parsed.period === 'month') {
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      filtered = revenue.filter(r => r.date && r.date.startsWith(monthStr));
      periodLabel = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    } else if (parsed.period === 'week') {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoStr = toDateStr(weekAgo);
      filtered = revenue.filter(r => r.date && r.date >= weekAgoStr);
      periodLabel = '本周';
    }

    await reply(formatRevenueReport(filtered, periodLabel));
  }
  // ── Content Pipeline ──────────────────────────────────
  else if (action === 'add_content') {
    const contents = readJsonFile(CONTENT_FILE, []);
    const entry = {
      id: Date.now().toString(),
      topic: parsed.topic || '未命名',
      platform: parsed.platform || '',
      status: parsed.status || 'idea',
      notes: parsed.notes || '',
      created_date: toDateStr(new Date())
    };
    contents.push(entry);
    if (writeJsonFile(CONTENT_FILE, contents)) {
      await reply(parsed.reply || `✅ 已新增内容：${entry.topic}${entry.platform ? ' (' + entry.platform + ')' : ''}`);
    } else {
      await reply('❌ 保存内容数据失败');
    }
  }
  else if (action === 'list_content') {
    const contents = readJsonFile(CONTENT_FILE, []);
    const text = formatContentList(contents);
    await reply(`🎬 <b>内容管道</b>（共 ${contents.length} 个内容）\n${text}`);
  }
  else if (action === 'update_content') {
    const contents = readJsonFile(CONTENT_FILE, []);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = contents.filter(c => c.topic.toLowerCase().includes(keyword));
    if (!matched.length) {
      await reply(`没有找到包含「${parsed.keyword}」的内容`);
    } else if (matched.length === 1) {
      matched[0].status = parsed.status || matched[0].status;
      if (parsed.notes) matched[0].notes = parsed.notes;
      if (writeJsonFile(CONTENT_FILE, contents)) {
        const statusLabel = CONTENT_STATUS_MAP[matched[0].status] || matched[0].status;
        await reply(parsed.reply || `✅ 已更新「${matched[0].topic}」状态为：${statusLabel}`);
      } else {
        await reply('❌ 保存内容数据失败');
      }
    } else {
      const list = matched.map((c, i) => `${i + 1}. ${c.topic} - ${CONTENT_STATUS_MAP[c.status] || c.status}`).join('\n');
      await reply(`找到多个匹配的内容，请说明要更新哪一个：\n\n${list}`);
    }
  }
  else if (action === 'weather') {
    try {
      const location = parsed.location || '韓國';
      const weatherInfo = await getWeather(location);
      await reply(weatherInfo);
    } catch (e) {
      await reply(`❌ 天气查询失败：${e.message}`);
    }
  }
  // ── Task Management ────────────────────────────────────
  else if (action === 'summarize_tasks') {
    await summarizeBossMessages();
  }
  else if (action === 'list_pending_tasks') {
    const report = formatPendingReport();
    if (!report) {
      await reply('✅ 所有任務都已完成！沒有待辦事項');
    } else {
      const buttons = report.pending.map(t => [{
        text: `✅ 完成: ${t.title.substring(0, 30)}`,
        callback_data: `task_done_${t.id}`
      }]);
      await replyWithButtons(report.text, buttons);
    }
  }
  // ── 即時任務建立 ──────────────────────────────────────
  else if (action === 'auto_tasks') {
    const taskItems = parsed.tasks || [];
    if (!taskItems.length) {
      await reply(parsed.reply || '🤔');
      return;
    }

    const todayStr = toDateStr(new Date());
    const createdTasks = [];

    for (const item of taskItems) {
      // 所有任務都寫入 Operating Team 日曆
      let calendarEventId = null;
      try {
        let startDt, endDt, allDay;

        if (item.has_time && item.deadline && item.deadline.includes(':') && !item.deadline.includes('-')) {
          // 有具體時間（如 14:00）
          startDt = `${todayStr}T${item.deadline}:00`;
          const [h, m] = item.deadline.split(':').map(Number);
          endDt = `${todayStr}T${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
          allDay = false;
        } else if (item.deadline && item.deadline.includes('-')) {
          // 有日期（如 2026-04-15）
          startDt = `${item.deadline}T09:00:00`;
          endDt = `${item.deadline}T10:00:00`;
          allDay = false;
        } else {
          // 沒有時間 → 全天任務放今天
          startDt = todayStr;
          endDt = todayStr;
          allDay = true;
        }

        const res = await otTeamup.post('/events', {
          subcalendar_id: OT_SUBCAL,
          title: `📌 ${item.title}${item.assignee ? ' → ' + item.assignee : ''}`,
          start_dt: startDt,
          end_dt: endDt,
          all_day: allDay
        });
        calendarEventId = res.data?.event?.id || null;
        console.log(`✅ 任務寫入日曆: ${item.title}`);
      } catch (e) {
        console.error('Calendar create error:', e.message);
      }

      const task = addTask({
        title: item.title,
        assignee: item.assignee || '',
        deadline: item.deadline || '',
        calendarEventId,
        date: (item.deadline && item.deadline.includes('-')) ? item.deadline : todayStr
      });
      createdTasks.push(task);
    }

    // 發送確認 + 按鈕
    let text = parsed.reply || `📌 已建立 ${createdTasks.length} 個任務：\n\n`;
    const buttons = [];
    for (const t of createdTasks) {
      const assignee = t.assignee ? ` → <b>${t.assignee}</b>` : '';
      const deadline = t.deadline ? ` ⏰${t.deadline}` : '';
      const cal = t.calendarEventId ? ' 📅' : '';
      text += `⬜ ${t.title}${assignee}${deadline}${cal}\n`;
      buttons.push([{
        text: `✅ 完成: ${t.title.substring(0, 30)}`,
        callback_data: `task_done_${t.id}`
      }]);
    }
    await replyWithButtons(text, buttons);
  }
  // ── 員工完成回報 ──────────────────────────────────────
  else if (action === 'complete_task') {
    const keyword = parsed.keyword || '';
    const task = findPendingTaskByKeyword(keyword);
    if (task) {
      markTaskDone(task.id, 'team');
      await reply(`✅ 已完成任務：<b>${task.title}</b>\n\n` + (parsed.reply || '好的，已標記完成！'));

      // 檢查是否全部完成
      const pending = getPendingTasks();
      if (pending.length === 0) {
        await reply('🎉🎉🎉 所有任務都完成了！太棒了！');
      } else {
        await reply(`📋 還剩 ${pending.length} 項待辦任務`);
      }
    } else {
      // 找不到匹配的任務，列出所有待辦讓員工選
      const pending = getPendingTasks();
      if (pending.length === 0) {
        await reply('✅ 目前沒有待辦任務了！');
      } else {
        let text = `🤔 找不到「${keyword}」相關的任務。\n目前的待辦任務：\n\n`;
        text += formatTaskList(pending);
        const buttons = pending.map(t => [{
          text: `✅ 完成: ${t.title.substring(0, 30)}`,
          callback_data: `task_done_${t.id}`
        }]);
        await replyWithButtons(text, buttons);
      }
    }
  }
  else if (action === 'reply') {
    await reply(parsed.reply || '🤔');
  }
  else {
    await reply(parsed.reply || '❓ 不太明白你的意思，可以再说清楚一点吗？');
  }
}

// ── Server Control Commands (Boss only, private chat) ────
const { exec } = require('child_process');
function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve((stdout || '') + (stderr || '') || (err ? err.message : '(no output)'));
    });
  });
}

// ── Natural language → server action detector ────────────
function detectServerIntent(msg) {
  const t = msg.toLowerCase();
  if (/重啟|restart|重新啟動|重開|reboot/.test(t)) return 'restart';
  if (/log|日誌|記錄|看一下錯誤|出錯了嗎/.test(t)) return 'logs';
  if (/狀態|status|pm2|跑了嗎|還在嗎|有沒有問題/.test(t)) return 'status';
  if (/更新|update|pull|拉取|最新代碼/.test(t)) return 'update';
  if (/磁碟|硬碟|空間|disk|storage/.test(t)) return 'disk';
  return null;
}

// ── Command Handler ──────────────────────────────────────
async function handle(text, replyTo, jeffMode = false, teamMode = false) {
  const msg = text.trim();

  // ── Server control: only for Boss private chat ─────────
  const isPrivateChat = replyTo && !String(replyTo).startsWith('-');
  if (isPrivateChat) {
    // Support both slash commands and natural language
    const slashCmd = msg.startsWith('/') ? msg.toLowerCase().split(' ')[0].slice(1) : null;
    const nlIntent = slashCmd ? slashCmd : detectServerIntent(msg);

    if (nlIntent === 'status') {
      const out = await runCmd('source ~/.nvm/nvm.sh 2>/dev/null; pm2 list --no-color');
      return send(`⚙️ <b>Bot 狀態</b>\n<pre>${out.substring(0, 3000)}</pre>`, replyTo);
    }

    if (nlIntent === 'restart') {
      await send('🔄 重啟中...', replyTo);
      const out = await runCmd('source ~/.nvm/nvm.sh 2>/dev/null; pm2 restart all && pm2 save');
      return send(`✅ <b>重啟完成</b>\n<pre>${out.substring(0, 1000)}</pre>`, replyTo);
    }

    if (nlIntent === 'logs') {
      const linesMatch = msg.match(/(\d+)\s*(行|lines?)/i);
      const lines = linesMatch ? linesMatch[1] : '40';
      const out = await runCmd(`source ~/.nvm/nvm.sh 2>/dev/null; pm2 logs jeff-pa-bot --lines ${lines} --nostream --no-color 2>&1`);
      return send(`📋 <b>最近 ${lines} 行 logs</b>\n<pre>${out.substring(0, 3500)}</pre>`, replyTo);
    }

    if (nlIntent === 'update') {
      await send('📦 拉取最新代碼並重啟...', replyTo);
      const botDir = path.resolve(__dirname);
      const out = await runCmd(`cd "${botDir}" && git pull 2>&1; source ~/.nvm/nvm.sh 2>/dev/null; pm2 restart jeff-pa-bot && pm2 save`);
      return send(`✅ <b>更新完成</b>\n<pre>${out.substring(0, 2000)}</pre>`, replyTo);
    }

    if (nlIntent === 'disk') {
      const out = await runCmd('df -h ~ 2>&1');
      return send(`💾 <b>磁碟空間</b>\n<pre>${out.substring(0, 1000)}</pre>`, replyTo);
    }

    if (nlIntent === 'help') {
      return send(
        `🛠 <b>伺服器控制</b>（直接說就好）\n\n` +
        `• 「重啟 bot」— 重啟所有 bot\n` +
        `• 「看 logs」— 查看最近40行日誌\n` +
        `• 「bot 狀態」— PM2 運行狀態\n` +
        `• 「更新代碼」— git pull + 重啟\n` +
        `• 「磁碟空間」— 查看空間`,
        replyTo
      );
    }
  }

  await send('💭 思考中...', replyTo);

  // 用 Claude API 理解用户意图並返回 JSON action
  const answer = await askClaudeWithSearch(msg, jeffMode, teamMode);

  // 執行 Claude 返回的 action（新增日程、查询行程等）
  await executeAction(answer, replyTo);
}

// ── Webhook Server (替代 Polling) ──────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
// Railway 會自動設置 RAILWAY_ENVIRONMENT_URL
const RAILWAY_URL = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_ENVIRONMENT_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL || (RAILWAY_URL ? `https://${RAILWAY_URL}/webhook` : 'https://telegram-teamup.up.railway.app/webhook');

app.use(express.json());

// ✅ Webhook 端點：接收 Telegram 推送的訊息
app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    // ── 處理 callback_query（員工點按鈕）──────────────
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data || '';
      const userName = cb.from.first_name || cb.from.username || 'unknown';
      const chatId = cb.message?.chat?.id;

      if (data.startsWith('task_done_')) {
        const taskId = data.replace('task_done_', '');
        const task = markTaskDone(taskId, userName);
        if (task) {
          // 回覆 callback
          await tg.post('/answerCallbackQuery', {
            callback_query_id: cb.id,
            text: `✅ ${userName} 完成了: ${task.title}`
          });
          // 在群裡通知
          await send(`✅ <b>${userName}</b> 已完成任務：<b>${task.title}</b>`, chatId);

          // 檢查是否所有今日任務都完成了
          const todayTasks = getTasksByDate(task.date);
          const allDone = todayTasks.every(t => t.status === 'done');
          if (allDone && todayTasks.length > 0) {
            await send(`🎉🎉🎉 太棒了！今天 ${todayTasks.length} 個任務全部完成！`, chatId);
          }
        } else {
          await tg.post('/answerCallbackQuery', {
            callback_query_id: cb.id,
            text: '❌ 找不到這個任務（可能已經完成了）'
          });
        }
      }

      res.json({ ok: true });
      return;
    }

    // ── 處理文字訊息 ─────────────────────────────────
    const message = update.message;
    if (!message || !message.text) {
      res.json({ ok: true });
      return;
    }

    // 只處理特定聊天的訊息（支持多群組 + 私聊）
    const chatIdStr = String(message.chat.id);
    const isPrivate = message.chat.type === 'private';
    if (!isPrivate && !ALLOWED_CHATS.includes(chatIdStr)) {
      console.log(`⏭️ 跳過群組: ${message.chat.title || 'unknown'} | ID: ${chatIdStr}`);
      res.json({ ok: true });
      return;
    }

    const userId = String(message.from?.id || '');
    const msgText = message.text.trim();
    const replyTo = chatIdStr;
    const chatLabel = isPrivate ? '私聊' : (message.chat.title || '群組');

    console.log('📨 接收到訊息:', msgText, `(from: ${userId}, chat: ${chatIdStr}, ${chatLabel})`);

    // ── 收集所有人的訊息（用於備份/批次整理）────────────
    const fromName = message.from?.first_name || message.from?.username || 'unknown';
    addBossMessage(msgText, fromName);
    console.log(`📝 已收集訊息 [${fromName}]: ${msgText.substring(0, 50)}...`);

    // 異步處理訊息（不阻塞 webhook 回覆）
    handle(msgText, replyTo).catch(err => {
      console.error('❌ 訊息處理錯誤:', err.message);
      send(`❌ 错误：${err.message.substring(0, 200)}`, replyTo).catch(e => console.error('發送錯誤:', e.message));
    });

    // 立即回覆 200 OK，告訴 Telegram 已收到
    res.json({ ok: true });
  } catch (e) {
    console.error('Webhook 錯誤:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// 健康檢查端點
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 設置 Webhook
async function setupWebhook() {
  try {
    console.log('🔧 設置 Webhook...');
    const response = await tg.post('/setWebhook', {
      url: WEBHOOK_URL,
      drop_pending_updates: true
    });

    if (response.data.ok) {
      console.log('✅ Webhook 已設置:', WEBHOOK_URL);
    } else {
      console.error('❌ 設置 Webhook 失敗:', response.data);
    }
  } catch (e) {
    console.error('❌ 設置 Webhook 錯誤:', e.message);
  }
}

// ── 取得 Operating Team 任務（當日）──────────────────────
async function getOTEvents(start, end) {
  try {
    const res = await otTeamup.get('/events', { params: { startDate: start, endDate: end } });
    return res.data.events || [];
  } catch (e) {
    console.error('OT events error:', e.message);
    return [];
  }
}

// ── 發今日私人行程給 Boss 私聊 ──────────────────────────
async function sendPersonalSchedule(label) {
  const today = toDateStr(new Date());
  const events = await getEvents(today, today);
  const sorted = events.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
  let msg = `${label}\n\n`;
  if (sorted.length > 0) {
    msg += `📅 今天共 ${sorted.length} 個行程：\n`;
    msg += sorted.map(e => `  ${formatEvent(e)}`).join('\n');
  } else {
    msg += `📅 今天沒有行程，輕鬆一天 😌`;
  }
  await send(msg, BOSS_USER_ID);
}

// ── 明日行程預覽發給 Boss 私聊 ────────────────────────────
async function sendTomorrowPreview() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateStr(tomorrow);
  const events = await getEvents(tomorrowStr, tomorrowStr);
  const sorted = events.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
  const label = tomorrow.toLocaleDateString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', day: 'numeric', weekday: 'long' });
  let msg = `🌙 <b>明日行程預覽</b>\n📅 ${label}\n\n`;
  if (sorted.length > 0) {
    msg += sorted.map(e => `  ${formatEvent(e)}`).join('\n');
    msg += '\n\n早點休息，明天加油 💪';
  } else {
    msg += `明天沒有行程，好好休息 😴`;
  }
  await send(msg, BOSS_USER_ID);
}

// ── 當日事項提醒（顯示所有未完成任務：逾期 + 今日 + 未來）──────────────
async function dailyItemsReminder(label, emoji) {
  const todayStr = toDateStr(new Date());
  const allPending = getPendingTasks();
  const overdue = allPending.filter(t => t.date && t.date < todayStr);
  const todayTasks = allPending.filter(t => !t.date || t.date === todayStr);
  const future = allPending.filter(t => t.date && t.date > todayStr);
  const allToShow = [...overdue, ...todayTasks, ...future];

  let message = `${emoji} <b>${label}</b>\n\n`;

  if (allToShow.length > 0) {
    message += `📋 <b>待辦任務（${allToShow.length} 項）：</b>\n`;

    if (overdue.length > 0) {
      message += `\n🔴 <b>逾期未完成（${overdue.length} 項）：</b>\n`;
      message += overdue.map(t => {
        const daysLate = Math.floor((new Date(todayStr) - new Date(t.date)) / 86400000);
        const remind = t.remindCount > 0 ? ` ⚠️ 已提醒${t.remindCount}次` : '';
        return `  🔴 ${t.title}${t.assignee ? ' → ' + t.assignee : ''} (逾期${daysLate}天)${remind}`;
      }).join('\n') + '\n';
    }

    if (todayTasks.length > 0) {
      message += `\n📌 <b>今日任務（${todayTasks.length} 項）：</b>\n`;
      message += todayTasks.map(t => {
        const remind = t.remindCount > 0 ? ` ⚠️ 已提醒${t.remindCount}次` : '';
        return `  🔸 ${t.title}${t.assignee ? ' → ' + t.assignee : ''}${remind}`;
      }).join('\n') + '\n';
    }

    if (future.length > 0) {
      message += `\n🗓️ <b>未來任務（${future.length} 項）：</b>\n`;
      message += future.map(t => {
        const remind = t.remindCount > 0 ? ` ⚠️ 已提醒${t.remindCount}次` : '';
        return `  🔹 ${t.title}${t.assignee ? ' → ' + t.assignee : ''} (${t.date})${remind}`;
      }).join('\n');
    }

    // 完成按鈕只給今日和未來任務（逾期任務只展示提醒）
    const actionable = [...todayTasks, ...future];
    const buttons = actionable.map(t => [{
      text: `✅ 完成: ${t.title.substring(0, 30)}`,
      callback_data: `task_done_${t.id}`
    }]);
    if (buttons.length > 0) {
      await sendWithButtons(message, buttons);
    } else {
      await send(message);
    }
    incrementRemindCount(allToShow.map(t => t.id));
  } else {
    message += `📋 沒有待辦任務 ✅\n\n今天輕鬆！`;
    await send(message);
  }
}

// ── 6pm 每日總結（完成事項 + 明日預覽）──────────────────
async function dailyEndSummary() {
  const now = new Date();
  const todayStr = toDateStr(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = toDateStr(tomorrow);

  let message = `📊 <b>今日收工總結</b>\n\n`;

  // 今日完成的任務
  const todayTasks = getTasksByDate(todayStr);
  const todayDone = todayTasks.filter(t => t.status === 'done');

  if (todayDone.length > 0) {
    message += `✅ <b>今日完成（${todayDone.length} 項）：</b>\n`;
    message += todayDone.map(t => `  ✅ ${t.title}${t.completedBy ? ' — ' + t.completedBy : ''}`).join('\n');
    message += '\n\n';
  } else {
    message += `✅ 今天沒有完成的任務\n\n`;
  }

  // 未完成的任務（包含逾期，按逾期/今日/未來分組）
  const allPending6pm = getPendingTasks();
  const overdue6pm = allPending6pm.filter(t => t.date && t.date < todayStr);
  const today6pm = allPending6pm.filter(t => !t.date || t.date === todayStr);
  const future6pm = allPending6pm.filter(t => t.date && t.date > todayStr);
  const pending6pm = [...overdue6pm, ...today6pm, ...future6pm];
  if (pending6pm.length > 0) {
    message += `⚠️ <b>未完成任務（${pending6pm.length} 項）：</b>\n`;
    if (overdue6pm.length > 0) {
      message += `\n🔴 逾期（${overdue6pm.length} 項）：\n`;
      message += overdue6pm.map(t => {
        const daysLate = Math.floor((new Date(todayStr) - new Date(t.date)) / 86400000);
        return `  🔴 ${t.title}${t.assignee ? ' → ' + t.assignee : ''} (逾期${daysLate}天)`;
      }).join('\n') + '\n';
    }
    if (today6pm.length > 0) {
      message += `\n📌 今日（${today6pm.length} 項）：\n`;
      message += today6pm.map(t => `  🔸 ${t.title}${t.assignee ? ' → ' + t.assignee : ''}`).join('\n') + '\n';
    }
    if (future6pm.length > 0) {
      message += `\n🗓️ 未來（${future6pm.length} 項）：\n`;
      message += future6pm.map(t => `  🔹 ${t.title}${t.assignee ? ' → ' + t.assignee : ''} (${t.date})`).join('\n') + '\n';
    }
    message += `\n⚠️ 未完成任務會累積到明天！\n\n`;
  }

  // 明日 Jeff 個人行程
  const tomorrowJeffEvents = await getEvents(tomorrowStr, tomorrowStr);
  const sortedTomorrowJeff = tomorrowJeffEvents
    .filter(e => e.start_dt)
    .sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));

  // 明日 Operating Team 行程
  const tomorrowOTEvents = await getOTEvents(tomorrowStr, tomorrowStr);
  const sortedTomorrowOT = tomorrowOTEvents
    .filter(e => e.start_dt)
    .sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));

  // 明日待辦任務（task system）
  const tomorrowTasks = getTasksByDate(tomorrowStr).filter(t => t.status !== 'done');

  const tomorrowLabel = tomorrow.toLocaleDateString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', day: 'numeric', weekday: 'long' });

  message += `🌙 <b>明日預覽</b>（${tomorrowLabel}）\n`;

  if (sortedTomorrowJeff.length > 0) {
    message += `\n🗓 <b>Jeff 行程：</b>\n`;
    message += sortedTomorrowJeff.map(e => `  ${formatEvent(e)}`).join('\n');
  }

  if (sortedTomorrowOT.length > 0) {
    message += `\n\n📅 <b>團隊行程：</b>\n`;
    message += sortedTomorrowOT.map(e => `  ${formatEvent(e)}`).join('\n');
  }

  if (tomorrowTasks.length > 0) {
    message += `\n\n📋 <b>待辦任務：</b>\n`;
    message += tomorrowTasks.map(t => `  🔸 ${t.title}${t.assignee ? ' → ' + t.assignee : ''}`).join('\n');
  }

  if (sortedTomorrowJeff.length === 0 && sortedTomorrowOT.length === 0 && tomorrowTasks.length === 0) {
    message += `  明天暫無安排，輕鬆一天 😌`;
  }

  message += '\n\n辛苦了，明天繼續加油 💪';

  // 如果有未完成任務，加按鈕
  if (pending6pm.length > 0) {
    const buttons = pending6pm.map(t => [{
      text: `✅ 完成: ${t.title.substring(0, 30)}`,
      callback_data: `task_done_${t.id}`
    }]);
    await sendWithButtons(message, buttons);
    incrementRemindCount(pending6pm.map(t => t.id));
  } else {
    await send(message);
  }
}

// ── 提前1小時提醒 ───────────────────────────────────────
async function eventPreReminder() {
  try {
    const today = toDateStr(new Date());
    const events = await getEvents(today, today);
    const now = new Date();

    for (const e of events) {
      if (e.all_day) continue; // 全天事件不做提前提醒

      const startTime = new Date(e.start_dt);
      const diffMs = startTime - now;
      const diffMin = diffMs / 60000;

      // 提前55~65分鐘內（即大約1小時前）且尚未提醒過
      const remindKey = `${e.id}_${e.start_dt}`;
      if (diffMin > 0 && diffMin >= 55 && diffMin <= 65 && !remindedEvents.has(remindKey)) {
        remindedEvents.add(remindKey);
        const timeStr = startTime.toLocaleTimeString('zh-TW', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'
        });
        await send(`⏰ <b>提前1小時提醒</b>\n\n🕐 ${timeStr} 你有一個行程：\n<b>${e.title}</b>\n\n請做好準備！`, BOSS_USER_ID);
      }
    }

    // 清理過期的提醒記錄（已過去超過2小時的事件）
    for (const key of remindedEvents) {
      const dt = key.split('_').slice(1).join('_');
      if (new Date(dt) < new Date(now - 7200000)) {
        remindedEvents.delete(key);
      }
    }
  } catch (e) {
    console.error('Pre-reminder error:', e.message);
  }
}

// ── 每周总结 (Sunday 8pm Malaysia time) ─────────────────
async function weeklySummary() {
  try {
    const now = new Date();
    const today = toDateStr(now);

    // Calculate week range (Monday to Sunday)
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(monday.getDate() - mondayOffset);
    const mondayStr = toDateStr(monday);

    // Events this week
    let eventsCount = 0;
    try {
      const events = await getEvents(mondayStr, today);
      eventsCount = events.length;
    } catch (e) {
      console.error('Weekly summary events error:', e.message);
    }

    // New clients this week
    const clients = readJsonFile(CLIENTS_FILE, []);
    const newClients = clients.filter(c => c.created_date && c.created_date >= mondayStr && c.created_date <= today);

    // Revenue this week
    const revenue = readJsonFile(REVENUE_FILE, []);
    const weekRevenue = revenue.filter(r => r.date && r.date >= mondayStr && r.date <= today);
    const totalRevenue = weekRevenue.reduce((sum, r) => sum + (r.amount || 0), 0);

    // Content published this week
    const contents = readJsonFile(CONTENT_FILE, []);
    const published = contents.filter(c => c.status === 'published');

    let text = `📊 <b>每周总结</b>（${mondayStr} ~ ${today}）\n\n`;
    text += `📅 本周行程：${eventsCount} 个\n`;
    text += `👥 新客户：${newClients.length} 个`;
    if (newClients.length) {
      text += `（${newClients.map(c => c.name).join('、')}）`;
    }
    text += '\n';
    text += `💰 本周收入：RM${totalRevenue.toLocaleString()}`;
    if (weekRevenue.length) {
      text += `（${weekRevenue.length} 笔）`;
    }
    text += '\n';
    text += `📢 已发布内容：${published.length} 个`;
    if (published.length) {
      text += `（${published.map(c => c.topic).slice(0, 5).join('、')}）`;
    }
    text += '\n\n💪 继续加油！';

    await send(text);
  } catch (e) {
    console.error('Weekly summary error:', e.message);
  }
}

// ── 發送待辦提醒到群裡 ──────────────────────────────────
async function sendTaskReminder(label) {
  const report = formatPendingReport();
  if (!report || report.pending.length === 0) return;

  const buttons = report.pending.map(t => [{
    text: `✅ 完成: ${t.title.substring(0, 30)}`,
    callback_data: `task_done_${t.id}`
  }]);
  await sendWithButtons(`⏰ <b>${label}</b>\n\n${report.text}`, buttons);
  incrementRemindCount(report.pending.map(t => t.id));
}

function scheduleReminders() {
  // 防止同一分鐘重複觸發（bot 重啟後多個 interval 同時跑）
  const firedKeys = new Set();

  setInterval(() => {
    const now = new Date();
    const klTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    const h = klTime.getHours();
    const m = klTime.getMinutes();
    const day = klTime.getDay(); // 0=Sunday
    const dateStr = klTime.toISOString().substring(0, 10);
    const fireKey = (label) => {
      const k = `${dateStr}_${label}`;
      if (firedKeys.has(k)) return false;
      firedKeys.add(k);
      return true;
    };

    // ── 9am — 今日行程（私人，發到私聊）
    if (h === 9 && m === 0 && fireKey('9am')) {
      dailyItemsReminder('早上開工 — 今日事項', '☀️')
        .catch(e => console.error('9am reminder error:', e.message));
      sendPersonalSchedule('☀️ 9am 今日行程').catch(e => console.error(e.message));
    }

    // ── 10am — 再次提醒今日行程
    if (h === 10 && m === 0 && fireKey('10am')) {
      sendPersonalSchedule('🌤️ 10am 今日行程').catch(e => console.error(e.message));
    }

    // ── 11am — 再次提醒今日行程
    if (h === 11 && m === 0 && fireKey('11am')) {
      sendPersonalSchedule('☀️ 11am 今日行程').catch(e => console.error(e.message));
    }

    // ── 2pm — 下午待辦提醒 → 工作群
    if (h === 14 && m === 0 && fireKey('2pm')) {
      dailyItemsReminder('下午提醒 — 待辦進度', '🌤️')
        .catch(e => console.error('Afternoon reminder error:', e.message));
    }

    // ── 6pm — 收工總結 → 工作群（只發 dailyEndSummary，不自動 summarize boss messages）
    if (h === 18 && m === 0 && fireKey('6pm')) {
      dailyEndSummary().catch(e => console.error('Evening summary error:', e.message));
    }

    // ── 8pm — 明日行程預覽 → Boss 私聊
    if (h === 20 && m === 0 && fireKey('8pm')) {
      sendTomorrowPreview().catch(e => console.error('Tomorrow preview error:', e.message));
    }

    // Weekly summary: Sunday 8pm
    if (day === 0 && h === 20 && m === 30 && fireKey('weekly')) {
      weeklySummary().catch(e => console.error('Weekly summary error:', e.message));
    }
  }, 60000);

  // 每分鐘檢查事件提前1小時提醒
  setInterval(() => {
    eventPreReminder().catch(e => console.error('Pre-reminder error:', e.message));
  }, 60000);

  eventPreReminder().catch(e => console.error('Pre-reminder error:', e.message));

  console.log('⏰ 每日提醒：9/10/11am 行程 | 2pm 待辦 | 6pm 收工 | 8pm 明日預覽');
  console.log('⏰ 事項提前1小時提醒已啟動');
  console.log('📊 每周总结：每周日 20:00');
}

// ── Polling 模式（內網伺服器用）──────────────────────
async function startPolling() {
  let offset = 0;
  console.log('🔄 Polling 模式已啟動...');

  // 先刪除 webhook
  await tg.post('/deleteWebhook', { drop_pending_updates: true });

  while (true) {
    try {
      const res = await tg.get('/getUpdates', { params: { offset, timeout: 30 }, timeout: 35000 });
      const updates = res.data.result || [];

      for (const update of updates) {
        offset = update.update_id + 1;

        // 處理 callback_query
        if (update.callback_query) {
          const cb = update.callback_query;
          const data = cb.data || '';
          const userName = cb.from.first_name || cb.from.username || 'unknown';
          const chatId = cb.message?.chat?.id;

          if (data.startsWith('task_done_')) {
            const taskId = data.replace('task_done_', '');
            const task = markTaskDone(taskId, userName);
            if (task) {
              await tg.post('/answerCallbackQuery', { callback_query_id: cb.id, text: `✅ ${userName} 完成了: ${task.title}` });
              await send(`✅ <b>${userName}</b> 已完成任務：<b>${task.title}</b>`, chatId);
              const todayTasks = getTasksByDate(task.date);
              if (todayTasks.every(t => t.status === 'done') && todayTasks.length > 0) {
                await send(`🎉🎉🎉 太棒了！今天 ${todayTasks.length} 個任務全部完成！`, chatId);
              }
            } else {
              await tg.post('/answerCallbackQuery', { callback_query_id: cb.id, text: '❌ 找不到這個任務（可能已經完成了）' });
            }
          }
          // 重複行程處理按鈕 — 保留選中的，刪除其餘
          else if (data.startsWith('dup_pick_')) {
            const ids = data.replace('dup_pick_', '').split('_');
            const keepId = ids[0];
            const deleteIds = ids.slice(1);
            try {
              let deleted = 0;
              for (const did of deleteIds) {
                await deleteEvent(did);
                deleted++;
              }
              await tg.post('/answerCallbackQuery', { callback_query_id: cb.id, text: `✅ 已刪除 ${deleted} 個重複` });
              await send(`✅ 已保留選中的行程，刪除了 ${deleted} 個重複`, chatId);
            } catch (e) {
              await tg.post('/answerCallbackQuery', { callback_query_id: cb.id, text: '❌ 刪除失敗：' + e.message });
            }
          }
          else if (data === 'dup_keep_both') {
            await tg.post('/answerCallbackQuery', { callback_query_id: cb.id, text: '✌️ 全部保留了' });
            await send(`✌️ 好的，全部保留`, chatId);
          }
          continue;
        }

        // 處理文字訊息
        const message = update.message;
        if (!message || !message.text) continue;

        const chatId = String(message.chat.id);
        const userId = String(message.from?.id || '');
        const isGroup = ALLOWED_CHATS.includes(chatId);
        const isBossPrivate = userId === BOSS_USER_ID && message.chat.type === 'private';

        // 只接受允許的群組 或 Boss 私聊
        if (!isGroup && !isBossPrivate) {
          if (message.chat.type !== 'private') {
            console.log(`⏭️ 跳過群組: ${message.chat.title || 'unknown'} | ID: ${chatId}`);
          }
          continue;
        }

        const msgText = message.text.trim();

        // 群組觸發條件（支持自然語言同義詞）：
        //   任務/任务/安排/提醒/新增 → 建立任務
        //   團隊/团队/團隊行程/团队安排 → Operating Team 日曆
        //   jeff開頭 + 時間 → Jeff 個人行程
        //   待辦/待办/總結/总结/未完成/進度/做完了嗎/還有什麼 → 顯示待辦
        //   查/看行程/今天行程/有什麼安排 → 查詢
        const isTaskMsg  = isGroup && /任[務务]|新增.*任|安排.*做|提醒.*做|加[入個个]任/.test(msgText) && !/待[辦办]/.test(msgText) && !/總結|总结|未完成|進度|进度/.test(msgText);
        const isTeamMsg  = isGroup && /拍[攝摄]|拍片|filming|shoot|拍攝行程|拍摄行程/.test(msgText);
        const isJeffMsg  = isGroup && /^jeff[,，\s]/i.test(msgText) && /今天|明天|後天|下週|下周|週[一二三四五六日]|周[一二三四五六日]|\d+(am|pm|：|:|\s*[點点])|\d{1,2}\/\d{1,2}|早上|上午|下午|傍晚|旁晚|晚上|中午|\d+号/i.test(msgText);
        const isSummaryMsg = isGroup && /待[辦办]|總結|总结|未完成|[没沒]完成|還有[什啥]麼|还有[什啥]么|進度|进度|做完了[嗎吗]|剩[什啥][麼么]/.test(msgText);
        const isQueryMsg = isGroup && /查(任[務务]|進度|行程|今天|明天|本週|本周|这周|這週|这星期|這星期)|看行程|今天行程|明天行程|这周行程|這週行程|本周行程|本週行程|有[什啥][麼么]安排|行程表|schedule|Team行程|團隊行程|团队行程|团队日历|團隊日曆|operating team/i.test(msgText);
        const isDeleteMsg = isGroup && /刪除|删除|移除|remove|取消行程|cancel/.test(msgText);
        if (isGroup && !isTaskMsg && !isTeamMsg && !isJeffMsg && !isSummaryMsg && !isQueryMsg && !isDeleteMsg) continue;

        const modeLabel = isJeffMsg ? '[Jeff行程]' : isTeamMsg ? '[拍攝行程]' : isSummaryMsg ? '[待辦總結]' : isQueryMsg ? '[查詢]' : isDeleteMsg ? '[刪除]' : '[任務]';
        console.log(`📨 接收到訊息: ${msgText} (from: ${userId}, chat: ${chatId}, ${isGroup ? '群組' : '私聊'} ${modeLabel})`);

        // 回覆到來源聊天（私聊回私聯，群組回群組）
        const replyTo = isGroup ? chatId : chatId;

        // 待辦/总结 → 直接顯示未完成任務
        if (isSummaryMsg) {
          (async () => {
            try {
              const todayStr = toDateStr(new Date());
              const allPending = getPendingTasks();
              const overdue = getOverdueTasks();
              const todayTasks = getTasksByDate(todayStr);
              const todayDone = todayTasks.filter(t => t.status === 'done');

              // 按日期分組未完成任務
              const grouped = {};
              for (const t of allPending) {
                const d = t.date || '未定';
                if (!grouped[d]) grouped[d] = [];
                grouped[d].push(t);
              }
              const sortedDates = Object.keys(grouped).sort();

              let msg = `📋 <b>所有未完成任務（${allPending.length} 項）</b>\n\n`;

              if (overdue.length > 0) {
                msg += `🔴 <b>逾期（${overdue.length}）：</b>\n`;
                msg += overdue.map(t => `  • ${t.title}${t.assignee ? ' → ' + t.assignee : ''} <i>(${t.date})</i>`).join('\n') + '\n\n';
              }

              for (const d of sortedDates) {
                if (d < todayStr) continue; // 逾期已顯示
                const label = d === todayStr ? '今天' : d;
                msg += `📅 <b>${label}（${grouped[d].length}）：</b>\n`;
                msg += grouped[d].map(t => `  • ${t.title}${t.assignee ? ' → ' + t.assignee : ''}`).join('\n') + '\n\n';
              }

              if (todayDone.length > 0) {
                msg += `✅ <b>今日已完成（${todayDone.length}）：</b>\n`;
                msg += todayDone.map(t => `  • ${t.title}${t.doneBy ? ' (' + t.doneBy + ')' : ''}`).join('\n') + '\n\n';
              }

              if (allPending.length === 0 && todayDone.length === 0) {
                msg += `沒有任何待辦任務 ✨`;
              } else if (allPending.length === 0) {
                msg += `🎉 所有任務都完成了！`;
              }

              if (allPending.length > 0) {
                const buttons = allPending.map(t => [{
                  text: `✅ 完成: ${t.title.substring(0, 30)}`,
                  callback_data: `task_done_${t.id}`
                }]);
                await sendWithButtons(msg, buttons, replyTo);
              } else {
                await send(msg, replyTo);
              }
            } catch (e) {
              console.error('Summary error:', e.message);
              await send(`❌ 查詢失敗：${e.message}`, replyTo);
            }
          })();
          continue;
        }

        handle(msgText, replyTo, isJeffMsg, isTeamMsg).catch(err => {
          console.error('❌ 訊息處理錯誤:', err.message);
          send(`❌ 错误：${err.message.substring(0, 200)}`, replyTo).catch(() => {});
        });
      }
    } catch (err) {
      if (err.code !== 'ECONNABORTED') {
        console.error('Polling 錯誤:', err.message);
      }
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ── 啟動 ──────────────────────────────────────────────
const USE_POLLING = process.env.USE_POLLING === 'true' || !WEBHOOK_URL.startsWith('https://');

console.log('🤖 Jeff PA Bot 已启动！');
console.log('💬 直接用自然语言跟 bot 说话即可');
console.log('📋 功能：日历 | 客户管道 | SOP | 收入追踪 | 内容管道 | 浏览器 | Claude Code');

if (USE_POLLING) {
  console.log('⚡ Polling 模式（內網伺服器）');
  scheduleReminders();
  // 啟動訊息不發到群組
  startPolling();
} else {
  console.log('⚡ Webhook 模式');
  app.listen(PORT, async () => {
    console.log(`✅ Webhook 服務已啟動在 http://0.0.0.0:${PORT}`);
    await setupWebhook();
    scheduleReminders();
    console.log('✅ Bot 已上線（Webhook 模式）');
  });
}
