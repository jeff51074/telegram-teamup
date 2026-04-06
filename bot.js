require('dotenv').config();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { chromium } = require('playwright');
const Anthropic = require('@anthropic-ai/sdk');
const CLAUDE = '/Users/mannyaoleong/.local/bin/claude';
const WORK_DIR = '/Users/mannyaoleong/Downloads/VS CODE/my PROJECT';
const BOT_DIR = '/Users/mannyaoleong/Downloads/VS CODE/my PROJECT/telegram-teamup';

// ── Data file paths ─────────────────────────────────────
const CLIENTS_FILE = path.join(BOT_DIR, 'clients.json');
const REVENUE_FILE = path.join(BOT_DIR, 'revenue.json');
const CONTENT_FILE = path.join(BOT_DIR, 'content.json');

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
const TEAMUP_TOKEN = process.env.TEAMUP_TOKEN;
const TEAMUP_CALENDAR = process.env.TEAMUP_CALENDAR;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const TEAMUP_API = `https://api.teamup.com/${TEAMUP_CALENDAR}`;

const tg = axios.create({ baseURL: `https://api.telegram.org/bot${TELEGRAM_TOKEN}` });
const teamup = axios.create({ baseURL: TEAMUP_API, headers: { 'Teamup-Token': TEAMUP_TOKEN } });

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

function formatEvent(e) {
  const startDate = new Date(e.start_dt);
  const dateStr = startDate.toLocaleDateString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', month: 'numeric', day: 'numeric', weekday: 'short' });
  if (e.all_day) return `📅 ${dateStr} — ${e.title} (全天)`;
  const timeStr = startDate.toLocaleTimeString('zh-TW', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'
  });
  const endTime = new Date(e.end_dt).toLocaleTimeString('zh-TW', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'
  });
  return `🕐 ${dateStr} ${timeStr}-${endTime} — ${e.title}`;
}

async function getEvents(start, end) {
  const res = await teamup.get('/events', { params: { startDate: start, endDate: end } });
  return res.data.events || [];
}

// 子日曆：KL工作=14975029, Others=14989974, 会议=14971361, 顾客拍摄=14971396
const DEFAULT_SUBCAL = 14971361;

async function createEvent(title, startDt, endDt, allDay) {
  await teamup.post('/events', { subcalendar_id: DEFAULT_SUBCAL, title, start_dt: startDt, end_dt: endDt, all_day: allDay });
}

async function deleteEvent(eventId) {
  await teamup.delete(`/events/${eventId}`);
}

async function updateEvent(eventId, updates) {
  if (!updates.subcalendar_id) updates.subcalendar_id = DEFAULT_SUBCAL;
  await teamup.put(`/events/${eventId}`, updates);
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
async function send(text) {
  await tg.post('/sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML' });
}

// ── Ask Claude with Web Search ──────────────────────────
async function askClaudeWithSearch(question) {
  try {
    console.log('🔍 Asking Claude:', question);

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 2000,
      system: `你是一個有用的助手。用戶會問你任何問題，你應該盡量詳細和準確地回答。用中文回答。`,
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
function buildSystemPrompt() {
  const now = new Date();
  const todayStr = toDateStr(now);
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const timeStr = now.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });

  return `你是一个 Telegram 日历助手机器人。用户会用自然语言跟你说话，你需要理解他们的意图并返回 JSON 动作。

当前时间信息：
- 今天是 ${todayStr}（星期${dayOfWeek}），现在是 ${timeStr}（马来西亚时间 Asia/Kuala_Lumpur）

你必须且只能返回一个 JSON 对象（不要包含任何其他文字、不要用 markdown code block），格式如下：

1. 查询行程：
{"action":"get_events","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"你要回复用户的前缀文字"}

2. 新增行程：
{"action":"create_event","title":"行程标题","start_dt":"YYYY-MM-DDTHH:mm:00","end_dt":"YYYY-MM-DDTHH:mm:00","all_day":false,"reply":"确认新增的回复"}
- 如果是全天行程：start_dt 和 end_dt 用 "YYYY-MM-DD" 格式，all_day 设为 true
- 如果用户没说结束时间，默认持续1小时

3. 搜索行程（用于删除/修改前先搜索）：
{"action":"search_events","keyword":"关键词","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"搜索说明"}

4. 删除行程：
{"action":"delete_event","keyword":"关键词","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"确认删除的回复"}

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

规则：
- "下周三" 请根据今天日期计算出具体日期
- "后天" "大后天" 也请计算出具体日期
- 用户说中文时用中文回复，英文时用英文
- reply 字段支持 HTML 格式（<b>粗体</b>等）
- 如果用户的请求模糊，用 reply action 问清楚
- 你可以处理任何对话，不限于日历功能`;
}

// ── Execute action from Claude's response ────────────────
async function executeAction(actionJson) {
  let parsed;
  try {
    // Try to extract JSON from response (handle possible markdown wrapping)
    const jsonMatch = actionJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    // If Claude didn't return valid JSON, treat it as a direct reply
    await send(actionJson.substring(0, 4000) || '❌ 无法理解，请再说一次');
    return;
  }

  const { action } = parsed;

  if (action === 'get_events') {
    const events = await getEvents(parsed.start, parsed.end);
    if (!events.length) {
      await send(parsed.reply || '没有找到行程 ✅');
    } else {
      const list = events.map(formatEvent).join('\n');
      await send(`${parsed.reply || '📆 行程如下：'}\n\n${list}`);
    }
  }
  else if (action === 'create_event') {
    await createEvent(parsed.title, parsed.start_dt, parsed.end_dt, parsed.all_day);
    await send(parsed.reply || `✅ 已新增：${parsed.title}`);
  }
  else if (action === 'search_events') {
    const events = await getEvents(parsed.start, parsed.end);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = keyword
      ? events.filter(e => e.title.toLowerCase().includes(keyword))
      : events;
    if (!matched.length) {
      await send(`没有找到包含「${parsed.keyword}」的行程`);
    } else {
      const list = matched.map((e, i) => `${i + 1}. ${formatEvent(e)} [ID:${e.id}]`).join('\n');
      await send(`${parsed.reply || '🔍 搜索结果：'}\n\n${list}`);
    }
  }
  else if (action === 'delete_event') {
    const events = await getEvents(parsed.start, parsed.end);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = events.filter(e => e.title.toLowerCase().includes(keyword));
    if (!matched.length) {
      await send(`没有找到包含「${parsed.keyword}」的行程，无法删除`);
    } else if (matched.length === 1) {
      await deleteEvent(matched[0].id);
      await send(parsed.reply || `✅ 已删除：${matched[0].title}`);
    } else {
      const list = matched.map((e, i) => `${i + 1}. ${formatEvent(e)}`).join('\n');
      await send(`找到多个匹配的行程，请说明要删除哪一个：\n\n${list}`);
    }
  }
  else if (action === 'update_event') {
    const events = await getEvents(parsed.start, parsed.end);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = events.filter(e => e.title.toLowerCase().includes(keyword));
    if (!matched.length) {
      await send(`没有找到包含「${parsed.keyword}」的行程，无法修改`);
    } else if (matched.length === 1) {
      await updateEvent(matched[0].id, parsed.updates);
      await send(parsed.reply || `✅ 已修改：${matched[0].title}`);
    } else {
      const list = matched.map((e, i) => `${i + 1}. ${formatEvent(e)}`).join('\n');
      await send(`找到多个匹配的行程，请说明要修改哪一个：\n\n${list}`);
    }
  }
  else if (action === 'browser') {
    await send(parsed.reply || '🌐 正在操作浏览器...');
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
      if (results.length) await send(results.join('\n'));
    } catch (e) {
      await send(`❌ 浏览器操作失败：${e.message}`);
    }
  }
  else if (action === 'claude_code') {
    await send(parsed.reply || '⚙️ Claude Code 执行中...');
    execFile(
      CLAUDE,
      ['-p', parsed.prompt, '--output-format', 'text'],
      { cwd: WORK_DIR, timeout: 120000, maxBuffer: 1024 * 1024 },
      async (err, stdout, stderr) => {
        if (err) {
          await send(`❌ Claude Code 执行失败：${err.message.substring(0, 500)}`);
          return;
        }
        const result = (stdout || '').trim();
        if (!result) {
          await send('✅ Claude Code 已执行完毕（无输出）');
          return;
        }
        // Telegram 消息上限 4096 字，分段发送
        const MAX_LEN = 3900;
        if (result.length <= MAX_LEN) {
          await send(`✅ <b>Claude Code 结果：</b>\n\n${result}`);
        } else {
          const parts = Math.ceil(result.length / MAX_LEN);
          for (let i = 0; i < parts; i++) {
            const chunk = result.substring(i * MAX_LEN, (i + 1) * MAX_LEN);
            await send(`📄 (${i + 1}/${parts})\n\n${chunk}`);
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
      await send(parsed.reply || `✅ 已新增客户：${newClient.name}${newClient.company ? ' (' + newClient.company + ')' : ''}`);
    } else {
      await send('❌ 保存客户数据失败');
    }
  }
  else if (action === 'list_clients') {
    const clients = readJsonFile(CLIENTS_FILE, []);
    const text = formatClientList(clients);
    await send(`👥 <b>客户管道</b>（共 ${clients.length} 个客户）\n${text}`);
  }
  else if (action === 'update_client_status') {
    const clients = readJsonFile(CLIENTS_FILE, []);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = clients.filter(c =>
      c.name.toLowerCase().includes(keyword) ||
      (c.company && c.company.toLowerCase().includes(keyword))
    );
    if (!matched.length) {
      await send(`没有找到包含「${parsed.keyword}」的客户`);
    } else if (matched.length === 1) {
      matched[0].status = parsed.status || matched[0].status;
      if (parsed.notes) matched[0].notes = parsed.notes;
      if (writeJsonFile(CLIENTS_FILE, clients)) {
        const statusLabel = CLIENT_STATUS_MAP[matched[0].status] || matched[0].status;
        await send(parsed.reply || `✅ 已更新 ${matched[0].name} 状态为：${statusLabel}`);
      } else {
        await send('❌ 保存客户数据失败');
      }
    } else {
      const list = matched.map((c, i) => `${i + 1}. ${c.name}${c.company ? ' (' + c.company + ')' : ''} - ${CLIENT_STATUS_MAP[c.status] || c.status}`).join('\n');
      await send(`找到多个匹配的客户，请说明要更新哪一个：\n\n${list}`);
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
      await send(text);
    } else {
      const available = Object.keys(SOP_DATA).join('、');
      await send(`没有找到相关SOP。可用的SOP：${available}`);
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
      await send(parsed.reply || `✅ 已记录收入：${entry.client} RM${entry.amount.toLocaleString()} (${entry.type})`);
    } else {
      await send('❌ 保存收入数据失败');
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

    await send(formatRevenueReport(filtered, periodLabel));
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
      await send(parsed.reply || `✅ 已新增内容：${entry.topic}${entry.platform ? ' (' + entry.platform + ')' : ''}`);
    } else {
      await send('❌ 保存内容数据失败');
    }
  }
  else if (action === 'list_content') {
    const contents = readJsonFile(CONTENT_FILE, []);
    const text = formatContentList(contents);
    await send(`🎬 <b>内容管道</b>（共 ${contents.length} 个内容）\n${text}`);
  }
  else if (action === 'update_content') {
    const contents = readJsonFile(CONTENT_FILE, []);
    const keyword = (parsed.keyword || '').toLowerCase();
    const matched = contents.filter(c => c.topic.toLowerCase().includes(keyword));
    if (!matched.length) {
      await send(`没有找到包含「${parsed.keyword}」的内容`);
    } else if (matched.length === 1) {
      matched[0].status = parsed.status || matched[0].status;
      if (parsed.notes) matched[0].notes = parsed.notes;
      if (writeJsonFile(CONTENT_FILE, contents)) {
        const statusLabel = CONTENT_STATUS_MAP[matched[0].status] || matched[0].status;
        await send(parsed.reply || `✅ 已更新「${matched[0].topic}」状态为：${statusLabel}`);
      } else {
        await send('❌ 保存内容数据失败');
      }
    } else {
      const list = matched.map((c, i) => `${i + 1}. ${c.topic} - ${CONTENT_STATUS_MAP[c.status] || c.status}`).join('\n');
      await send(`找到多个匹配的内容，请说明要更新哪一个：\n\n${list}`);
    }
  }
  else if (action === 'weather') {
    try {
      const location = parsed.location || '韓國';
      const weatherInfo = await getWeather(location);
      await send(weatherInfo);
    } catch (e) {
      await send(`❌ 天气查询失败：${e.message}`);
    }
  }
  else if (action === 'reply') {
    await send(parsed.reply || '🤔');
  }
  else {
    await send(parsed.reply || '❓ 不太明白你的意思，可以再说清楚一点吗？');
  }
}

// ── Command Handler ──────────────────────────────────────
async function handle(text) {
  const msg = text.trim();
  await send('💭 思考中...');

  // 用 Claude API 理解用户意图並返回 JSON action
  const answer = await askClaudeWithSearch(msg);

  // 執行 Claude 返回的 action（新增日程、查询行程等）
  await executeAction(answer);
}

// ── Polling Loop ─────────────────────────────────────────
async function poll() {
  try {
    const res = await tg.get('/getUpdates', { params: { offset, timeout: 30 }, timeout: 35000 });
    for (const update of res.data.result) {
      offset = update.update_id + 1;
      const text = update.message?.text;
      if (text && String(update.message.chat.id) === CHAT_ID) {
        // 獨立處理每條訊息，即使一條出錯也不影響其他訊息
        handle(text).catch(err => {
          console.error('❌ 訊息處理錯誤:', err.message);
          send(`❌ 错误：${err.message.substring(0, 200)}`).catch(e => console.error('發送錯誤:', e.message));
        });
      }
    }
  } catch (e) {
    if (e.response && e.response.status === 409) {
      console.error('⚠️ Poll 409: 另一個實例在運行，5秒後重試...');
      setTimeout(poll, 5000);
      return;
    }
    console.error('⚠️ Poll 錯誤:', e.message);
    // 任何錯誤都不要中斷，5秒後繼續重試
    setTimeout(poll, 5000);
    return;
  }
  setTimeout(poll, 1000);
}

// ── 每日自動提醒 ─────────────────────────────────────────
async function dailyReminder() {
  const today = toDateStr(new Date());
  const events = await getEvents(today, today);
  const now = new Date();
  const hour = now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', hour12: false });

  if (!events.length) {
    await send(`☀️ <b>${hour}:00 提醒</b>\n\n今天沒有行程，好好休息！`);
  } else {
    const list = events.map(formatEvent).join('\n');
    await send(`☀️ <b>${hour}:00 每日提醒</b>\n\n📆 今天共 ${events.length} 個行程：\n\n${list}`);
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
        await send(`⏰ <b>提前1小時提醒</b>\n\n🕐 ${timeStr} 你有一個行程：\n<b>${e.title}</b>\n\n請做好準備！`);
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

function scheduleReminders() {
  const REMINDER_HOURS = [9, 10, 11]; // 早上 9, 10, 11 點

  setInterval(() => {
    const now = new Date();
    const klTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
    const h = klTime.getHours();
    const m = klTime.getMinutes();
    const day = klTime.getDay(); // 0=Sunday

    if (REMINDER_HOURS.includes(h) && m === 0) {
      dailyReminder().catch(e => console.error('Reminder error:', e.message));
    }

    // Weekly summary: Sunday 8pm Malaysia time
    if (day === 0 && h === 20 && m === 0) {
      weeklySummary().catch(e => console.error('Weekly summary error:', e.message));
    }
  }, 60000); // 每分鐘檢查一次

  // 每分鐘檢查是否有事件即將在1小時後開始
  setInterval(() => {
    eventPreReminder().catch(e => console.error('Pre-reminder error:', e.message));
  }, 60000);

  // 啟動時也立即檢查一次
  eventPreReminder().catch(e => console.error('Pre-reminder error:', e.message));

  console.log('⏰ 每日提醒已設定：9:00, 10:00, 11:00 (馬來西亞時間)');
  console.log('⏰ 事項提前1小時提醒已啟動（每分鐘檢查）');
  console.log('📊 每周总结已設定：每周日 20:00 (馬來西亞時間)');
}

console.log('🤖 Telegram Teamup Bot 已启动（自然语言模式）！');
console.log('💬 直接用自然语言跟 bot 说话即可');
console.log('📋 功能：日历 | 客户管道 | SOP | 收入追踪 | 内容管道 | 浏览器 | Claude Code');
console.log('⚡ [2026-04-06] 已重新部署和測試');
send('🤖 Bot 已上線！直接用自然語言跟我說話就行～\n⏰ 每天 9am/10am/11am 自動提醒今天行程\n🔔 每個行程開始前1小時自動通知你\n📊 每週日晚8點發送每週總結\n\n新功能：👥客戶管道 | 📋SOP | 💰收入追踪 | 🎬內容管道').catch(() => {});
scheduleReminders();
poll();
