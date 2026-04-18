require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');
const { exec } = require('child_process');

// ── 共用 TeamUp / Claude 設定 ────────────────────────────
const TEAMUP_TOKEN = process.env.TEAMUP_TOKEN;
const TEAMUP_CALENDAR = process.env.TEAMUP_CALENDAR;
const OT_TOKEN = process.env.OPERATING_TEAM_TOKEN;
const OT_CALENDAR = process.env.OPERATING_TEAM_CALENDAR;
const OT_SUBCAL = process.env.OPERATING_TEAM_SUBCAL;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const teamup = axios.create({
  baseURL: `https://api.teamup.com/${TEAMUP_CALENDAR}`,
  headers: { 'Teamup-Token': TEAMUP_TOKEN }
});
const otTeamup = axios.create({
  baseURL: `https://api.teamup.com/${OT_CALENDAR}`,
  headers: { 'Teamup-Token': OT_TOKEN }
});
const client_ai = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ── WhatsApp 群組 ID（支援多群，逗號分隔）────────────────
// 格式: 120363xxxxxxx@g.us,120363yyyyyyy@g.us
const WA_GROUP_IDS = (process.env.WA_GROUP_IDS || process.env.WA_GROUP_ID || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// 第一個群為主群（用來發每日提醒）
const WA_PRIMARY_GROUP = WA_GROUP_IDS[0] || '';
// Boss 私人號碼（私人提醒用）
const WA_BOSS_NUMBER = process.env.WA_BOSS_NUMBER || '';

// ── 員工名冊（持久化存儲）─────────────────────────────────
const fs = require('fs');
const STAFF_FILE = path.join(__dirname, 'wa-staff.json');

function loadStaff() {
  try {
    if (fs.existsSync(STAFF_FILE)) return JSON.parse(fs.readFileSync(STAFF_FILE, 'utf-8'));
  } catch (e) { console.error('loadStaff error:', e.message); }
  return {};
}
function saveStaff(data) {
  fs.writeFileSync(STAFF_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
// 格式: { "小明": "60123456789", "小紅": "60198765432" }
const staffRoster = loadStaff();

// 根據名字找號碼
function findStaffNumber(name) {
  const n = name.trim();
  return staffRoster[n] || null;
}

// 發訊息給員工
async function sendToStaff(phone, text) {
  const numberId = phone.replace(/\D/g, '') + '@c.us';
  try {
    const sent = await waClient.sendMessage(numberId, text);
    trackBotMsg(sent);
    return true;
  } catch (e) {
    console.error(`sendToStaff ${phone} error:`, e.message);
    return false;
  }
}

// ── 群組訊息緩衝（用於摘要）──────────────────────────────
const groupMsgBuffer = []; // { time, sender, text, group }
const MAX_BUFFER = 200;

function bufferGroupMsg(sender, text, groupName) {
  groupMsgBuffer.push({
    time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }),
    sender, text: text.substring(0, 200), group: groupName
  });
  if (groupMsgBuffer.length > MAX_BUFFER) groupMsgBuffer.shift();
}

// ── 私聊收件箱（記錄別人發給 Boss 的訊息）────────────────
const inboxBuffer = {}; // { "senderName": [{ time, text, phone }] }

function bufferInboxMsg(senderName, phone, text) {
  if (!inboxBuffer[senderName]) inboxBuffer[senderName] = [];
  inboxBuffer[senderName].push({
    time: new Date().toLocaleTimeString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' }),
    text: text.substring(0, 300),
    phone
  });
  // 每人最多保留 50 條
  if (inboxBuffer[senderName].length > 50) inboxBuffer[senderName].shift();
}

// ── 工具函數 ─────────────────────────────────────────────
function toDateStr(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Kuala_Lumpur' });
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
  if (e.all_day) return `📅 ${e.title}`;
  const start = new Date(e.start_dt);
  return `🕐 ${formatTime12h(start)} — ${e.title}`;
}

async function getEvents(start, end) {
  const res = await teamup.get('/events', { params: { startDate: start, endDate: end } });
  return res.data.events || [];
}

async function getOTEvents(start, end) {
  const res = await otTeamup.get('/events', { params: { startDate: start, endDate: end } });
  return res.data.events || [];
}

// ── Claude 系統提示 ──────────────────────────────────────
function buildPrompt(jeffMode = false, teamMode = false) {
  const now = new Date();
  const todayStr = toDateStr(now);
  const dayOfWeek = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  const timeStr = now.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', hour: '2-digit', minute: '2-digit' });

  const note = jeffMode
    ? '\n⭐ 此消息以 "jeff" 開頭，新增到 Jeff 個人行程日曆，使用 create_event，不要用 auto_tasks。'
    : teamMode
    ? '\n⭐ 此消息含「拍攝」，安排拍攝行程，使用 create_event 寫入 Operating Team 日曆，不要用 auto_tasks。'
    : '';

  return `你是一個 WhatsApp 工作助手機器人。今天是 ${todayStr}（星期${dayOfWeek}），現在是 ${timeStr}（馬來西亞時間）。${note}

只返回 JSON，不要其他文字：

1. 新增行程：{"action":"create_event","title":"標題","start_dt":"YYYY-MM-DDTHH:mm:00","end_dt":"YYYY-MM-DDTHH:mm:00","all_day":false,"reply":"確認"}
2. 查詢行程：{"action":"get_events","start":"YYYY-MM-DD","end":"YYYY-MM-DD","reply":"前綴"}
3. 建立任務：{"action":"auto_tasks","tasks":[{"title":"任務","assignee":"負責人","deadline":"HH:mm或YYYY-MM-DD","has_time":true}],"reply":"確認"}
4. 普通回覆：{"action":"reply","reply":"內容"}

規則：
- 沒說結束時間 → 默認1小時
- 沒說日期 → 今天
- 沒說負責人 → assignee 留空
- 閒聊/問題 → reply action`;
}

// ── 問 Claude ────────────────────────────────────────────
async function askClaude(question, jeffMode = false, teamMode = false) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Claude API timeout (30s)')), 30000)
  );
  const apiCall = client_ai.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1000,
    system: buildPrompt(jeffMode, teamMode),
    messages: [{ role: 'user', content: question }]
  });
  const response = await Promise.race([apiCall, timeout]);
  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }
  return text.trim();
}

// ── 執行 Action ──────────────────────────────────────────
async function executeAction(actionJson, replyFn) {
  let parsed;
  try {
    const match = actionJson.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(match ? match[0] : actionJson);
  } catch {
    return replyFn('🤔 ' + actionJson);
  }

  const action = parsed.action;
  const todayStr = toDateStr(new Date());

  if (action === 'reply') {
    await replyFn(parsed.reply || '✅');

  } else if (action === 'create_event') {
    try {
      await teamup.post('/events', {
        title: parsed.title,
        start_dt: parsed.start_dt,
        end_dt: parsed.end_dt,
        all_day: parsed.all_day || false
      });
      await replyFn(parsed.reply || `✅ 已新增行程：${parsed.title}`);
    } catch (e) {
      await replyFn(`❌ 新增失敗：${e.message}`);
    }

  } else if (action === 'get_events') {
    try {
      const events = await getEvents(parsed.start, parsed.end);
      if (!events.length) return replyFn(`📅 ${parsed.start} 沒有行程`);
      const sorted = events.sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
      const list = sorted.map(e => formatEvent(e)).join('\n');
      await replyFn(`${parsed.reply || '📅 行程：'}\n\n${list}`);
    } catch (e) {
      await replyFn(`❌ 查詢失敗：${e.message}`);
    }

  } else if (action === 'auto_tasks') {
    const tasks = parsed.tasks || [];
    if (!tasks.length) return replyFn('🤔 沒有偵測到任務');

    const created = [];
    for (const item of tasks) {
      let startDt, endDt, allDay;
      if (item.has_time && item.deadline && item.deadline.includes(':') && !item.deadline.includes('-')) {
        startDt = `${todayStr}T${item.deadline}:00`;
        const [h, m] = item.deadline.split(':').map(Number);
        endDt = `${todayStr}T${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
        allDay = false;
      } else if (item.deadline && item.deadline.includes('-')) {
        startDt = `${item.deadline}T09:00:00`;
        endDt = `${item.deadline}T10:00:00`;
        allDay = false;
      } else {
        startDt = todayStr; endDt = todayStr; allDay = true;
      }
      try {
        await otTeamup.post('/events', {
          subcalendar_id: OT_SUBCAL,
          title: `📌 ${item.title}${item.assignee ? ' → ' + item.assignee : ''}`,
          start_dt: startDt, end_dt: endDt, all_day: allDay
        });
      } catch (e) { console.error('Calendar error:', e.message); }
      created.push(item);
    }

    let msg = parsed.reply || `📌 已建立 ${created.length} 個任務：\n`;
    msg += created.map(t => `• ${t.title}${t.assignee ? ' → ' + t.assignee : ''}${t.deadline ? ' ⏰' + t.deadline : ''}`).join('\n');
    await replyFn(msg);

    // 自動通知負責人（如果在員工名冊中）
    for (const t of created) {
      if (t.assignee) {
        const phone = findStaffNumber(t.assignee);
        if (phone) {
          await sendToStaff(phone,
            `📌 *你有新任務*\n\n` +
            `任務：*${t.title}*\n` +
            (t.deadline ? `截止：${t.deadline}\n` : '') +
            `\n請及時完成！`
          );
          console.log(`📤 已自動通知 ${t.assignee}（${phone}）新任務`);
        }
      }
    }

  } else {
    await replyFn(parsed.reply || '✅');
  }
}

// ── 伺服器指令工具 ───────────────────────────────────────
function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve((stdout || '') + (stderr || '') || (err ? err.message : '(no output)'));
    });
  });
}

function detectServerIntent(msg) {
  const t = msg.toLowerCase();
  if (/重啟|restart|重新啟動|重開|reboot/.test(t)) return 'restart';
  if (/log|日誌|記錄|看一下錯誤|出錯了嗎/.test(t)) return 'logs';
  if (/狀態|status|pm2|跑了嗎|還在嗎|有沒有問題|正常嗎/.test(t)) return 'status';
  if (/更新|update|pull|拉取|最新代碼/.test(t)) return 'update';
  if (/磁碟|硬碟|空間|disk|storage/.test(t)) return 'disk';
  return null;
}

// ── 處理伺服器控制（僅限 Boss 私聊）────────────────────
async function handleServerControl(text, replyFn) {
  const intent = detectServerIntent(text);

  if (intent === 'status') {
    const out = await runCmd('source ~/.nvm/nvm.sh 2>/dev/null; pm2 list --no-color');
    return replyFn(`⚙️ *Bot 狀態*\n\`\`\`\n${out.substring(0, 2000)}\n\`\`\``);
  }
  if (intent === 'restart') {
    await replyFn('🔄 重啟中...');
    const out = await runCmd('source ~/.nvm/nvm.sh 2>/dev/null; pm2 restart all && pm2 save');
    return replyFn(`✅ *重啟完成*\n\`\`\`\n${out.substring(0, 800)}\n\`\`\``);
  }
  if (intent === 'logs') {
    const linesMatch = text.match(/(\d+)\s*(行|lines?)/i);
    const lines = linesMatch ? linesMatch[1] : '30';
    const out = await runCmd(`source ~/.nvm/nvm.sh 2>/dev/null; pm2 logs jeff-pa-bot --lines ${lines} --nostream --no-color 2>&1`);
    return replyFn(`📋 *最近 ${lines} 行 logs*\n\`\`\`\n${out.substring(0, 2500)}\n\`\`\``);
  }
  if (intent === 'update') {
    await replyFn('📦 更新中...');
    const botDir = path.resolve(__dirname);
    const out = await runCmd(`cd "${botDir}" && git pull 2>&1; source ~/.nvm/nvm.sh 2>/dev/null; pm2 restart all && pm2 save`);
    return replyFn(`✅ *更新完成*\n\`\`\`\n${out.substring(0, 1500)}\n\`\`\``);
  }
  if (intent === 'disk') {
    const out = await runCmd('df -h ~ 2>&1');
    return replyFn(`💾 *磁碟空間*\n\`\`\`\n${out.substring(0, 800)}\n\`\`\``);
  }
  return null; // 不是伺服器指令
}

// ── 處理訊息 ─────────────────────────────────────────────
async function handle(text, replyFn, jeffMode = false, teamMode = false) {
  await replyFn('💭 思考中...');
  const answer = await askClaude(text, jeffMode, teamMode);
  await executeAction(answer, replyFn);
}

// ── 防無限循環：處理鎖 ──────────────────────────────────
const chatProcessing = new Set(); // 正在處理的聊天 ID（鎖）
const botSentIds = new Set();

function trackBotMsg(sentMsg) {
  if (sentMsg && sentMsg.id) {
    botSentIds.add(sentMsg.id._serialized);
    setTimeout(() => botSentIds.delete(sentMsg.id._serialized), 300000);
  }
}

// ── WhatsApp Client ──────────────────────────────────────
const waClient = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wa-session') }),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

waClient.on('qr', (qr) => {
  console.log('\n📱 用手機 WhatsApp 掃描以下 QR Code：\n');
  qrcode.generate(qr, { small: true });
});

waClient.on('ready', () => {
  console.log('✅ WhatsApp Bot 已連線！');

  // 延遲3秒等 WhatsApp 同步，再抓群組列表
  setTimeout(async () => {
    try {
      const chats = await waClient.getChats();
      const groups = chats.filter(c => c.isGroup);
      const lines = groups.map(g => `${g.name} | ${g.id._serialized}`);
      fs.writeFileSync(path.join(__dirname, 'wa-groups.txt'), lines.join('\n'), 'utf-8');
      console.log(`\n📋 找到 ${groups.length} 個群組，已寫入 wa-groups.txt`);
      groups.forEach(g => console.log(`  [GROUP] ${g.name} | ${g.id._serialized}`));
      if (!WA_GROUP_IDS.length) {
        console.log('\n⚠️  請把 Group ID 加入 .env：WA_GROUP_IDS=id1,id2\n');
      } else {
        console.log(`\n✅ 監聽 ${WA_GROUP_IDS.length} 個群組`);
        WA_GROUP_IDS.forEach(id => console.log(`  → ${id}`));
      }
    } catch (e) {
      console.error('getChats error:', e.message);
    }
  }, 3000);
});

// message_create 可以收到所有訊息（包括自己發的）
waClient.on('message_create', async (msg) => {
  try {
    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const groupId = chat.id._serialized;
    const text = msg.body.trim();

    // ── 防無限循環 ────────────────────────────────────────
    if (botSentIds.has(msg.id._serialized)) return;
    // 該聊天正在處理中 → 這是 bot 自己的回覆，忽略
    if (chatProcessing.has(chat.id._serialized)) return;

    // ── 私聊處理（Boss 專用）— 在 hasQuotedMsg 過濾之前處理 ──
    if (!isGroup && WA_BOSS_NUMBER) {
      const contactId = chat.id._serialized;
      const bossBase = WA_BOSS_NUMBER.replace('@c.us', '');

      // 嘗試多種方式匹配 Boss（支援 @c.us 和 @lid 格式）
      let isBoss = contactId === WA_BOSS_NUMBER || contactId.includes(bossBase)
        || msg.from === WA_BOSS_NUMBER || msg.from.includes(bossBase);

      // @lid 格式：透過 contact 對象取得真實號碼
      if (!isBoss) {
        try {
          const contact = await msg.getContact();
          const contactNum = contact.number || contact.id?.user || '';
          isBoss = contactNum.includes(bossBase) || bossBase.includes(contactNum);
          if (isBoss) console.log(`📩 [Boss 匹配] via contact.number=${contactNum}`);
        } catch (e) { /* ignore */ }
      }

      // Boss 帳號 = Bot 帳號，所以 msg.fromMe = true 代表是 Boss 打的指令
      if (!isBoss && msg.fromMe) {
        isBoss = true;
      }

      // Debug
      console.log(`📩 [私聊偵測] from=${msg.from} | chatId=${contactId} | fromMe=${msg.fromMe} | isBoss=${isBoss} | text="${text.substring(0, 30)}"`);

      // 不是 Boss（別人發來的訊息）→ 記錄到收件箱
      if (!isBoss) {
        try {
          const contact = await msg.getContact();
          const senderName = contact.pushname || contact.name || contact.number || msg.from.split('@')[0];
          const phone = contact.number || msg.from.replace(/@.*/, '');
          bufferInboxMsg(senderName, phone, text);
          console.log(`📥 [收件箱] ${senderName}(${phone}): ${text.substring(0, 40)}`);
        } catch (e) { /* ignore */ }
        return;
      }
      // Boss 私聊：不過濾 hasQuotedMsg（允許回覆 bot 訊息）

      console.log(`📨 WA 私聊 [Boss]: ${text.substring(0, 50)}`);

      const replyFn = async (content) => {
        const sent = await waClient.sendMessage(WA_BOSS_NUMBER, content);
        trackBotMsg(sent);
      };

      // ── 群組管理指令 ──────────────────────────────────
      if (/查群組|list group|我的群|哪些群|show group/i.test(text)) {
        try {
          const chats = await waClient.getChats();
          const groups = chats.filter(c => c.isGroup);
          let reply = `📋 *你的所有群組*\n\n`;
          groups.forEach(g => {
            const active = WA_GROUP_IDS.includes(g.id._serialized) ? ' ✅' : '';
            reply += `${active || '⬜'} *${g.name}*\n  \`${g.id._serialized}\`\n\n`;
          });
          reply += `✅ = 已啟用 | ⬜ = 未啟用\n\n發「加群組 [ID]」來啟用`;
          await replyFn(reply);
        } catch (e) {
          await replyFn(`❌ 查詢失敗：${e.message}`);
        }
        return;
      }

      const addMatch = text.match(/加群組\s+(\S+@g\.us)/i);
      if (addMatch) {
        const newId = addMatch[1].trim();
        if (!WA_GROUP_IDS.includes(newId)) {
          WA_GROUP_IDS.push(newId);
          await replyFn(`✅ 已加入群組：\`${newId}\`\n\n目前啟用群組（${WA_GROUP_IDS.length}）：\n${WA_GROUP_IDS.join('\n')}`);
        } else {
          await replyFn(`⚠️ 這個群組已經啟用了`);
        }
        return;
      }

      const removeMatch = text.match(/移除群組\s+(\S+@g\.us)/i);
      if (removeMatch) {
        const rmId = removeMatch[1].trim();
        const idx = WA_GROUP_IDS.indexOf(rmId);
        if (idx > -1) {
          WA_GROUP_IDS.splice(idx, 1);
          await replyFn(`✅ 已移除群組：\`${rmId}\`\n\n目前啟用群組（${WA_GROUP_IDS.length}）：\n${WA_GROUP_IDS.join('\n') || '(無)'}`);
        } else {
          await replyFn(`⚠️ 找不到這個群組 ID`);
        }
        return;
      }

      // ── 員工管理指令 ──────────────────────────────────────
      const addStaffMatch = text.match(/加員工\s+(\S+)\s+(\d{8,15})/i) || text.match(/加员工\s+(\S+)\s+(\d{8,15})/i);
      if (addStaffMatch) {
        const name = addStaffMatch[1].trim();
        const phone = addStaffMatch[2].trim();
        staffRoster[name] = phone;
        saveStaff(staffRoster);
        await replyFn(`✅ 已新增員工：*${name}* → ${phone}`);
        return;
      }

      const rmStaffMatch = text.match(/移除員工\s+(\S+)/i) || text.match(/移除员工\s+(\S+)/i) || text.match(/刪除員工\s+(\S+)/i);
      if (rmStaffMatch) {
        const name = rmStaffMatch[1].trim();
        if (staffRoster[name]) {
          delete staffRoster[name];
          saveStaff(staffRoster);
          await replyFn(`✅ 已移除員工：*${name}*`);
        } else {
          await replyFn(`⚠️ 找不到員工「${name}」`);
        }
        return;
      }

      if (/查員工|查员工|員工列表|员工列表|list staff/i.test(text)) {
        const names = Object.keys(staffRoster);
        if (names.length === 0) {
          await replyFn(`📋 還沒有員工\n\n發「加員工 小明 60123456789」來新增`);
        } else {
          let reply = `📋 *員工名冊（${names.length} 人）*\n\n`;
          reply += names.map(n => `• *${n}* → ${staffRoster[n]}`).join('\n');
          reply += `\n\n「加員工 名字 號碼」新增\n「移除員工 名字」刪除`;
          await replyFn(reply);
        }
        return;
      }

      // ── 發訊息給員工 ──────────────────────────────────────
      const sendMatch = text.match(/發給\s*(\S+)\s+([\s\S]+)/i) || text.match(/发给\s*(\S+)\s+([\s\S]+)/i)
        || text.match(/通知\s*(\S+)\s+([\s\S]+)/i) || text.match(/提醒\s*(\S+)\s+([\s\S]+)/i);
      if (sendMatch) {
        const name = sendMatch[1].trim();
        const content = sendMatch[2].trim();
        const phone = findStaffNumber(name);
        if (!phone) {
          await replyFn(`⚠️ 找不到員工「${name}」\n\n目前有：${Object.keys(staffRoster).join('、') || '(無)'}\n發「加員工 ${name} 手機號碼」來新增`);
          return;
        }
        const ok = await sendToStaff(phone, `📩 *來自 Boss 的訊息：*\n\n${content}`);
        await replyFn(ok ? `✅ 已發送給 *${name}*（${phone}）` : `❌ 發送失敗，請確認號碼是否正確`);
        return;
      }

      // ── 群組摘要（今日群聊重點）────────────────────────────
      if (/群摘要|群总结|群組摘要|群組總結|group summary/i.test(text)) {
        if (groupMsgBuffer.length === 0) {
          await replyFn(`📭 暫無群組訊息記錄`);
          return;
        }
        // 用 Claude 摘要群訊
        try {
          await replyFn('💭 摘要中...');
          const recent = groupMsgBuffer.slice(-80);
          const chatLog = recent.map(m => `[${m.time}] ${m.sender}: ${m.text}`).join('\n');
          const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000));
          const apiCall = client_ai.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 800,
            system: '你是群組訊息摘要助手。用中文簡潔地整理以下群聊記錄的重點，列出：1.重要決定 2.待辦事項 3.需要注意的問題。如果沒有重要內容就說「沒有特別重要的訊息」。',
            messages: [{ role: 'user', content: chatLog }]
          });
          const resp = await Promise.race([apiCall, timeout]);
          let summary = '';
          for (const b of resp.content) { if (b.type === 'text') summary += b.text; }
          await replyFn(`📊 *群組訊息摘要*（最近 ${recent.length} 條）\n\n${summary.trim()}`);
        } catch (e) {
          await replyFn(`❌ 摘要失敗：${e.message.substring(0, 80)}`);
        }
        return;
      }

      // ── 收件箱：今日訊息摘要 ──────────────────────────────
      if (/今日訊息|今日讯息|收件箱|inbox|誰找我|谁找我|未讀|未读/i.test(text)) {
        const senders = Object.keys(inboxBuffer);
        if (senders.length === 0) {
          await replyFn(`📭 今天還沒有人發私訊給你`);
          return;
        }
        // 用 AI 摘要
        try {
          await replyFn('💭 整理中...');
          let chatLog = '';
          for (const name of senders) {
            const msgs = inboxBuffer[name];
            chatLog += `\n【${name}】(${msgs[0].phone})：\n`;
            chatLog += msgs.map(m => `  [${m.time}] ${m.text}`).join('\n');
          }
          const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000));
          const apiCall = client_ai.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 1000,
            system: '你是訊息摘要助手。整理以下私聊記錄，按每個人分類：1.他說了什麼（簡短摘要）2.是否需要回覆 3.建議回覆內容（簡短）。格式清晰，用中文。',
            messages: [{ role: 'user', content: chatLog }]
          });
          const resp = await Promise.race([apiCall, timeout]);
          let summary = '';
          for (const b of resp.content) { if (b.type === 'text') summary += b.text; }
          await replyFn(`📬 *今日私訊摘要*（${senders.length} 人）\n\n${summary.trim()}\n\n💡 回覆方式：「回覆 名字 內容」`);
        } catch (e) {
          // fallback: 不用 AI，直接列出
          let reply = `📬 *今日私訊*（${senders.length} 人）\n\n`;
          for (const name of senders) {
            const msgs = inboxBuffer[name];
            reply += `👤 *${name}*（${msgs[0].phone}）— ${msgs.length} 條\n`;
            reply += msgs.slice(-3).map(m => `  [${m.time}] ${m.text.substring(0, 60)}`).join('\n');
            reply += '\n\n';
          }
          reply += `💡 回覆方式：「回覆 名字 內容」`;
          await replyFn(reply);
        }
        return;
      }

      // ── 回覆私訊：回覆 名字 內容 ──────────────────────────
      const replyMatch = text.match(/回[覆復复]\s*(\S+)\s+([\s\S]+)/i);
      if (replyMatch) {
        const name = replyMatch[1].trim();
        const content = replyMatch[2].trim();

        // 先找收件箱裡的人
        const inboxEntry = inboxBuffer[name];
        if (inboxEntry && inboxEntry.length > 0) {
          const phone = inboxEntry[0].phone;
          const numberId = phone.replace(/\D/g, '') + '@c.us';
          try {
            const sent = await waClient.sendMessage(numberId, content);
            trackBotMsg(sent);
            await replyFn(`✅ 已回覆 *${name}*（${phone}）`);
          } catch (e) {
            await replyFn(`❌ 發送失敗：${e.message.substring(0, 80)}`);
          }
          return;
        }

        // 再找員工名冊
        const phone = findStaffNumber(name);
        if (phone) {
          const ok = await sendToStaff(phone, content);
          await replyFn(ok ? `✅ 已回覆 *${name}*（${phone}）` : `❌ 發送失敗`);
          return;
        }

        await replyFn(`⚠️ 找不到「${name}」\n\n收件箱有：${Object.keys(inboxBuffer).join('、') || '(無)'}\n員工有：${Object.keys(staffRoster).join('、') || '(無)'}`);
        return;
      }

      // ── 清空收件箱 ──────────────────────────────────────
      if (/清空收件|清收件|clear inbox/i.test(text)) {
        Object.keys(inboxBuffer).forEach(k => delete inboxBuffer[k]);
        await replyFn(`✅ 收件箱已清空`);
        return;
      }

      // 伺服器控制優先
      const handled = await handleServerControl(text, replyFn).catch(e => {
        console.error('Server control error:', e.message);
        return null;
      });
      if (handled !== null) return;

      // 其他功能（行程查詢等）
      const isJeffPrivate = /^jeff\b/i.test(text) && /今天|明天|後天|下週|下周|週[一二三四五六日]|周[一二三四五六日]|\d+(am|pm|：|:|\s*點)|\d{1,2}\/\d{1,2}/i.test(text);
      const isQuery = /查|行程|任務|待辦|總結|今天|明天|schedule/i.test(text);
      if (isJeffPrivate || isQuery) {
        handle(text, replyFn, isJeffPrivate, false).catch(e => {
          console.error('Private handle error:', e.message);
          replyFn(`❌ 錯誤：${e.message.substring(0, 100)}`);
        });
      } else {
        replyFn(
          `🤖 *WhatsApp Bot 私聊指令*\n\n` +
          `*📬 收件箱：*\n` +
          `• 「今日訊息」— AI 摘要今天誰找你\n` +
          `• 「回覆 名字 內容」— 回覆對方\n` +
          `• 「清空收件」— 清空收件箱\n\n` +
          `*👥 員工管理：*\n` +
          `• 「加員工 小明 60123456789」\n` +
          `• 「移除員工 小明」• 「查員工」\n\n` +
          `*📩 發訊息：*\n` +
          `• 「發給 小明 明天帶道具」\n` +
          `• 「提醒/通知 小明 3pm開會」\n\n` +
          `*📊 摘要：*\n` +
          `• 「群摘要」— AI 群聊重點\n\n` +
          `*⚙️ 群組/伺服器：*\n` +
          `• 「查群組」•「加群組」•「移除群組」\n` +
          `• 「bot 狀態」•「重啟 bot」•「看 logs」\n\n` +
          `*📅 查詢：*\n` +
          `• 「今天行程」• 「查任務」`
        );
      }
      return;
    }

    // 群組訊息：忽略引用回覆（防止無限循環）
    if (msg.hasQuotedMsg) return;

    // 未設定群組時：靜默忽略
    if (!WA_GROUP_IDS.length) return;

    // 只處理指定群組
    if (!WA_GROUP_IDS.includes(groupId)) return;

    // 緩衝群組訊息（用於摘要功能）
    if (text) {
      const contact = await msg.getContact();
      const senderName = contact.pushname || contact.name || msg.from.split('@')[0];
      bufferGroupMsg(senderName, text, chat.name || groupId);
    }

    // 觸發條件（跟 Telegram 一樣，支持自然語言）
    const isTaskMsg  = /任[務务]|新增.*任|安排.*做|提醒.*做|加[入個个]/.test(text) && !/待[辦办]/.test(text) && !/總結|总结|未完成|進度|进度/.test(text);
    const isTeamMsg  = /拍[攝摄]|拍片|filming|shoot|拍攝行程|拍摄行程/.test(text);
    const isJeffMsg  = /^jeff\b/i.test(text) && /今天|明天|後天|下週|下周|週[一二三四五六日]|周[一二三四五六日]|\d+(am|pm|：|:|\s*點)|\d{1,2}\/\d{1,2}/i.test(text);
    const isSummaryMsg = /待[辦办]|總結|总结|未完成|[没沒]完成|還有[什啥]麼|还有[什啥]么|進度|进度|做完了[嗎吗]|剩[什啥][麼么]/.test(text);
    const isQueryMsg = /查(任[務务]|進度|行程|今天|明天|本週|本周)|看行程|今天行程|明天行程|有[什啥][麼么]安排|行程表|schedule/i.test(text);

    if (!isTaskMsg && !isTeamMsg && !isJeffMsg && !isSummaryMsg && !isQueryMsg) return;

    const mode = isJeffMsg ? '[Jeff]' : isTeamMsg ? '[拍攝]' : isSummaryMsg ? '[待辦總結]' : isQueryMsg ? '[查詢]' : '[任務]';
    console.log(`📨 WA: ${text.substring(0, 50)} ${mode}`);

    const replyFn = async (content) => {
      const sent = await msg.reply(content);
      trackBotMsg(sent);
    };

    // 待辦/总结 → 查詢今日行程和任務
    if (isSummaryMsg) {
      (async () => {
        try {
          await replyFn('💭 查詢中...');
          const todayStr = toDateStr(new Date());
          const otEvents = await getOTEvents(todayStr, todayStr);
          const sorted = otEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
          let reply = `📋 *今日任務總結*\n\n`;
          if (sorted.length > 0) {
            reply += sorted.map(e => `  ${formatEvent(e)}`).join('\n');
          } else {
            reply += `今天還沒有任務 📭`;
          }
          await replyFn(reply);
        } catch (e) {
          console.error('Summary error:', e.message);
          await replyFn(`❌ 查詢失敗：${e.message.substring(0, 100)}`);
        }
      })();
      return;
    }

    handle(text, replyFn, isJeffMsg, isTeamMsg).catch(e => {
      console.error('Error:', e.message);
      msg.reply(`❌ 錯誤：${e.message.substring(0, 100)}`).then(trackBotMsg);
    });

  } catch (e) {
    console.error('Message error:', e.message);
  }
});

waClient.on('disconnected', (reason) => {
  console.log('❌ WhatsApp 斷線：', reason);
});

// ── 發送到主群的工具函數 ─────────────────────────────────
async function sendToGroup(text) {
  if (!WA_PRIMARY_GROUP) return;
  try {
    const sent = await waClient.sendMessage(WA_PRIMARY_GROUP, text);
    trackBotMsg(sent);
  } catch (e) {
    console.error('sendToGroup error:', e.message);
  }
}

// ── 發送私人訊息給 Boss ───────────────────────────────────
async function sendToBoss(text) {
  if (!WA_BOSS_NUMBER) return;
  try {
    const sent = await waClient.sendMessage(WA_BOSS_NUMBER, text);
    trackBotMsg(sent);
  } catch (e) {
    console.error('sendToBoss error:', e.message);
  }
}

// ── 去重工具：按標題去重 ─────────────────────────────────
function dedupeEvents(events) {
  const seen = new Set();
  return events.filter(e => {
    const key = (e.title || '').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── 分類事項：行程 vs 任務（📌開頭）────────────────────
function categorizeEvents(events) {
  const tasks = events.filter(e => (e.title || '').includes('📌') || e.all_day);
  const schedule = events.filter(e => !(e.title || '').includes('📌') && !e.all_day);
  return { tasks, schedule };
}

// ── 格式化提醒訊息（去重 + 分類）─────────────────────────
function buildReminderMsg(events, label, emoji) {
  const deduped = dedupeEvents(events);
  const { tasks, schedule } = categorizeEvents(deduped);
  const sorted = (arr) => arr.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));

  let msg = `${emoji} *${label}*\n\n`;

  if (sorted(schedule).length > 0) {
    msg += `📅 *行程（${sorted(schedule).length} 項）：*\n`;
    msg += sorted(schedule).map(e => `  ${formatEvent(e)}`).join('\n') + '\n\n';
  }

  if (tasks.length > 0) {
    msg += `📋 *待辦任務（${tasks.length} 項）：*\n`;
    msg += tasks.map(e => `  🔸 ${(e.title || '').replace('📌 ', '')}`).join('\n') + '\n';
  }

  if (deduped.length === 0) {
    msg += `沒有安排，輕鬆！ 😌`;
  }

  return msg;
}

// ── 提前1小時提醒（WhatsApp 版）──────────────────────────
const waRemindedEvents = new Set();
async function waEventPreReminder() {
  try {
    const today = toDateStr(new Date());
    const events = await getEvents(today, today);
    const now = new Date();

    for (const e of events) {
      if (e.all_day) continue;
      const startTime = new Date(e.start_dt);
      const diffMin = (startTime - now) / 60000;
      const remindKey = `${e.id}_${e.start_dt}`;
      if (diffMin > 0 && diffMin >= 55 && diffMin <= 65 && !waRemindedEvents.has(remindKey)) {
        waRemindedEvents.add(remindKey);
        const timeStr = startTime.toLocaleTimeString('zh-TW', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur'
        });
        await sendToBoss(`⏰ *提前1小時提醒*\n\n🕐 ${timeStr} 你有一個行程：\n*${e.title}*\n\n請做好準備！`);
      }
    }

    // 清理過期記錄
    for (const key of waRemindedEvents) {
      const dt = key.split('_').slice(1).join('_');
      if (new Date(dt) < new Date(now - 7200000)) {
        waRemindedEvents.delete(key);
      }
    }
  } catch (e) { console.error('WA pre-reminder error:', e.message); }
}

// ── 每日自動提醒（跟 Telegram 同步，無打勾按鈕）─────────
function scheduleWAReminders() {
  setInterval(async () => {
    const now = new Date();
    const h = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', hour12: false }));
    const m = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur', minute: '2-digit' }));

    const todayStr = toDateStr(now);
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = toDateStr(tomorrow);

    // 9am — 群組: 今日工作清單 | 私聊: Jeff 個人行程
    if (h === 9 && m === 0) {
      try {
        const otEvents = await getOTEvents(todayStr, todayStr);
        await sendToGroup(buildReminderMsg(otEvents, '早安！今日工作清單', '☀️'));
      } catch (e) { console.error('9am group reminder error:', e.message); }
      try {
        const jeffEvents = dedupeEvents(await getEvents(todayStr, todayStr));
        const sorted = jeffEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
        let msg = `☀️ *9am 今日個人行程*\n\n`;
        msg += sorted.length > 0 ? sorted.map(e => `  ${formatEvent(e)}`).join('\n') : `今天沒有個人行程`;
        await sendToBoss(msg);
      } catch (e) { console.error('9am boss reminder error:', e.message); }
    }

    // 10am — 私聊: Jeff 個人行程
    if (h === 10 && m === 0) {
      try {
        const jeffEvents = dedupeEvents(await getEvents(todayStr, todayStr));
        const sorted = jeffEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
        let msg = `🌤️ *10am 今日個人行程*\n\n`;
        msg += sorted.length > 0 ? sorted.map(e => `  ${formatEvent(e)}`).join('\n') : `今天沒有個人行程`;
        await sendToBoss(msg);
      } catch (e) { console.error('10am reminder error:', e.message); }
    }

    // 11am — 私聊: Jeff 個人行程
    if (h === 11 && m === 0) {
      try {
        const jeffEvents = dedupeEvents(await getEvents(todayStr, todayStr));
        const sorted = jeffEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
        let msg = `☀️ *11am 今日個人行程*\n\n`;
        msg += sorted.length > 0 ? sorted.map(e => `  ${formatEvent(e)}`).join('\n') : `今天沒有個人行程`;
        await sendToBoss(msg);
      } catch (e) { console.error('11am reminder error:', e.message); }
    }

    // 2pm — 下午待辦進度（去重）
    if (h === 14 && m === 0) {
      try {
        const otEvents = await getOTEvents(todayStr, todayStr);
        await sendToGroup(buildReminderMsg(otEvents, '下午提醒 — 待辦進度', '🌤️'));
      } catch (e) { console.error('2pm reminder error:', e.message); }
    }

    // 6pm — 收工總結 + 明日預覽
    if (h === 18 && m === 0) {
      try {
        const tomorrowLabel = tomorrow.toLocaleDateString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', day: 'numeric', weekday: 'long' });

        // 今日事項
        const todayEvents = dedupeEvents(await getOTEvents(todayStr, todayStr));

        // 明日預覽
        const jeffEvents = dedupeEvents(await getEvents(tomorrowStr, tomorrowStr));
        const sortedJeff = jeffEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
        const otEvents = dedupeEvents(await getOTEvents(tomorrowStr, tomorrowStr));
        const sortedOT = otEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));

        let msg = `📊 *今日收工總結*\n\n`;
        msg += `📋 今日共 ${todayEvents.length} 項事項\n\n`;

        msg += `🌙 *明日預覽*（${tomorrowLabel}）\n\n`;

        if (sortedJeff.length > 0) {
          msg += `🗓 *Jeff 行程：*\n`;
          msg += sortedJeff.map(e => `  ${formatEvent(e)}`).join('\n') + '\n\n';
        }
        if (sortedOT.length > 0) {
          msg += `📅 *團隊行程：*\n`;
          msg += sortedOT.map(e => `  ${formatEvent(e)}`).join('\n') + '\n\n';
        }
        if (sortedJeff.length === 0 && sortedOT.length === 0) {
          msg += `明天暫無安排，輕鬆一天 😌\n\n`;
        }
        msg += `辛苦了，明天繼續加油 💪`;
        await sendToGroup(msg);
      } catch (e) { console.error('6pm reminder error:', e.message); }
    }

    // 8pm — 私聊: 明日個人行程預覽
    if (h === 20 && m === 0) {
      try {
        const tomorrowLabel = tomorrow.toLocaleDateString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur', month: 'long', day: 'numeric', weekday: 'long' });
        const jeffEvents = dedupeEvents(await getEvents(tomorrowStr, tomorrowStr));
        const sortedJeff = jeffEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));
        const otEvents = dedupeEvents(await getOTEvents(tomorrowStr, tomorrowStr));
        const sortedOT = otEvents.filter(e => e.start_dt).sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));

        let msg = `🌙 *明日行程預覽*\n📅 ${tomorrowLabel}\n\n`;
        if (sortedJeff.length > 0) {
          msg += `🗓 *個人行程：*\n`;
          msg += sortedJeff.map(e => `  ${formatEvent(e)}`).join('\n') + '\n\n';
        }
        if (sortedOT.length > 0) {
          msg += `📅 *團隊行程：*\n`;
          msg += sortedOT.map(e => `  ${formatEvent(e)}`).join('\n') + '\n\n';
        }
        if (sortedJeff.length === 0 && sortedOT.length === 0) {
          msg += `明天暫無安排，好好休息 😌`;
        }
        await sendToBoss(msg);
      } catch (e) { console.error('8pm reminder error:', e.message); }
    }

    // 每分鐘檢查提前1小時提醒
    waEventPreReminder().catch(e => console.error('WA pre-reminder error:', e.message));

  }, 60000);

  // 啟動時立即檢查一次
  waEventPreReminder().catch(e => console.error('WA pre-reminder error:', e.message));

  console.log('⏰ WhatsApp 每日提醒：9/10/11am 行程 | 2pm 待辦 | 6pm 總結 | 8pm 預覽');
  console.log('⏰ 活動前1小時提醒已啟動');
}

console.log('🚀 啟動 WhatsApp Bot...');
waClient.on('ready', () => {
  scheduleWAReminders();
});
waClient.initialize();
