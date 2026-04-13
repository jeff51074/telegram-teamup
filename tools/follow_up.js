const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const FOLLOW_UP_FILE = path.join(DATA_DIR, 'follow_ups.json');
const INTERACTIONS_FILE = path.join(DATA_DIR, 'interactions.json');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getAllFollowUps() {
  ensureDirs();
  if (!fs.existsSync(FOLLOW_UP_FILE)) {
    fs.writeFileSync(FOLLOW_UP_FILE, JSON.stringify([], null, 2));
  }
  const data = fs.readFileSync(FOLLOW_UP_FILE, 'utf-8');
  return JSON.parse(data);
}

function saveFollowUps(followUps) {
  fs.writeFileSync(FOLLOW_UP_FILE, JSON.stringify(followUps, null, 2));
}

async function trackFollowUp(customerId, status = '待跟進', notes = '') {
  try {
    const followUps = getAllFollowUps();
    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' });

    const existingIndex = followUps.findIndex(f => f.customerId === customerId);
    if (existingIndex >= 0) {
      followUps[existingIndex].status = status;
      followUps[existingIndex].lastFollowUpTime = now;
      followUps[existingIndex].notes = notes;
      followUps[existingIndex].followUpCount = (followUps[existingIndex].followUpCount || 0) + 1;
    } else {
      followUps.push({
        id: Date.now(),
        customerId,
        status,
        lastFollowUpTime: now,
        notes,
        createdAt: now,
        followUpCount: 1
      });
    }
    saveFollowUps(followUps);
    return {
      customerId, status,
      formatted: `✅ 已更新客户 ${customerId} 的跟進狀態為：${status}\n📝 備註：${notes}`
    };
  } catch (err) {
    return { error: `追蹤失敗: ${err.message}` };
  }
}

async function getFollowUpDue() {
  try {
    const followUps = getAllFollowUps();
    const due = followUps.filter(f => f.status === '待跟進' && (f.followUpCount || 0) < 5);
    const list = due.map((f, i) => `${i + 1}. 客戶${f.customerId} - 跟進${f.followUpCount || 1}次`).join('\n');
    return {
      count: due.length,
      followUps: due,
      formatted: `🎯 需要跟進的客戶 (共${due.length}人):\n\n${list || '暫無需跟進的客戶'}`
    };
  } catch (err) {
    return { error: `獲取失敗: ${err.message}` };
  }
}

async function recordInteraction(customerId, interactionType, details = '') {
  try {
    ensureDirs();
    if (!fs.existsSync(INTERACTIONS_FILE)) {
      fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify([], null, 2));
    }
    const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf-8'));
    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' });
    interactions.push({
      id: Date.now(),
      customerId,
      type: interactionType,
      details,
      timestamp: now
    });
    fs.writeFileSync(INTERACTIONS_FILE, JSON.stringify(interactions, null, 2));
    return {
      customerId, type: interactionType,
      formatted: `✅ 已記錄與客戶 ${customerId} 的互動\n📞 類型：${interactionType}\n📝 詳情：${details}`
    };
  } catch (err) {
    return { error: `記錄失敗: ${err.message}` };
  }
}

async function getInteractionHistory(customerId) {
  try {
    ensureDirs();
    if (!fs.existsSync(INTERACTIONS_FILE)) {
      return { history: [], formatted: '暫無互動記錄' };
    }
    const interactions = JSON.parse(fs.readFileSync(INTERACTIONS_FILE, 'utf-8'));
    const history = interactions.filter(i => i.customerId == customerId).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const list = history.map((i, idx) => `${idx + 1}. [${i.type}] ${i.timestamp}\n   ${i.details}`).join('\n\n');
    return {
      customerId, count: history.length, history,
      formatted: `📞 客戶 ${customerId} 的互動歷史 (共${history.length}次):\n\n${list || '暫無記錄'}`
    };
  } catch (err) {
    return { error: `獲取失敗: ${err.message}` };
  }
}

async function getConversionStatus() {
  try {
    const followUps = getAllFollowUps();
    const stats = {
      total: followUps.length,
      pending: followUps.filter(f => f.status === '待跟進').length,
      contacted: followUps.filter(f => f.status === '已聯繫').length,
      converted: followUps.filter(f => f.status === '已轉化').length,
      abandoned: followUps.filter(f => f.status === '已放棄').length
    };
    const rate = stats.total > 0 ? ((stats.converted / stats.total) * 100).toFixed(2) : 0;
    const formatted = `📊 轉化狀態統計\n\n總客戶數：${stats.total}\n待跟進：${stats.pending}\n已聯繫：${stats.contacted}\n已轉化：${stats.converted} (${rate}%)\n已放棄：${stats.abandoned}`;
    return { stats, rate, formatted };
  } catch (err) {
    return { error: `獲取失敗: ${err.message}` };
  }
}

module.exports = { trackFollowUp, getFollowUpDue, recordInteraction, getInteractionHistory, getConversionStatus };
