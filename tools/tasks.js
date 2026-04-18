/**
 * 任務管理工具 — 即時偵測任務 → 自動建立 → 累積提醒 → 員工回報完成
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const BOSS_MSGS_FILE = path.join(DATA_DIR, 'boss_messages.json');

// ── JSON helpers ──────────────────────────────────────────
function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return fallback; }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ── Boss message buffer ───────────────────────────────────
function addBossMessage(text, from) {
  const msgs = readJson(BOSS_MSGS_FILE, []);
  msgs.push({ text, from: from || 'Boss', time: new Date().toISOString() });
  writeJson(BOSS_MSGS_FILE, msgs);
}
function getBossMessages() { return readJson(BOSS_MSGS_FILE, []); }
function clearBossMessages() { writeJson(BOSS_MSGS_FILE, []); }

// ── Task CRUD ─────────────────────────────────────────────
function getTasks() { return readJson(TASKS_FILE, []); }

function addTask({ title, assignee, deadline, calendarEventId, date }) {
  const tasks = getTasks();
  const task = {
    id: Date.now().toString(),
    title,
    assignee: assignee || '',
    deadline: deadline || '',
    status: 'pending',       // pending | done
    calendarEventId: calendarEventId || null,
    date: date || new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    completedAt: null,
    completedBy: null,
    remindCount: 0           // 被提醒過幾次
  };
  tasks.push(task);
  writeJson(TASKS_FILE, tasks);
  return task;
}

function markTaskDone(taskId, completedBy) {
  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return null;
  task.status = 'done';
  task.completedAt = new Date().toISOString();
  task.completedBy = completedBy || 'unknown';
  writeJson(TASKS_FILE, tasks);
  return task;
}

// 用關鍵字模糊匹配找到待辦任務（員工說「信用卡問好了」→ 匹配「問信用卡」）
function findPendingTaskByKeyword(keyword) {
  const tasks = getTasks();
  const pending = tasks.filter(t => t.status === 'pending');
  const kw = keyword.toLowerCase();

  // 精確包含
  let match = pending.find(t => t.title.toLowerCase().includes(kw));
  if (match) return match;

  // 拆字匹配（至少2個字匹配）
  const kwChars = [...new Set(kw.replace(/\s/g, ''))];
  let bestMatch = null;
  let bestScore = 0;
  for (const t of pending) {
    const titleLower = t.title.toLowerCase();
    const score = kwChars.filter(c => titleLower.includes(c)).length;
    if (score >= 2 && score > bestScore) {
      bestScore = score;
      bestMatch = t;
    }
  }
  return bestMatch;
}

function getTasksByDate(date) {
  return getTasks().filter(t => t.date === date);
}

function getPendingTasks() {
  return getTasks().filter(t => t.status === 'pending');
}

// 取得逾期任務（建立日期早於今天且未完成）
function getOverdueTasks() {
  const today = new Date().toISOString().slice(0, 10);
  return getTasks().filter(t => t.status === 'pending' && t.date < today);
}

// 增加提醒次數
function incrementRemindCount(taskIds) {
  const tasks = getTasks();
  for (const t of tasks) {
    if (taskIds.includes(t.id)) {
      t.remindCount = (t.remindCount || 0) + 1;
    }
  }
  writeJson(TASKS_FILE, tasks);
}

// ── Format tasks for Telegram ─────────────────────────────
function formatTaskList(tasks, showStatus = true) {
  if (!tasks.length) return '沒有任務';
  const today = new Date().toISOString().slice(0, 10);
  return tasks.map((t, i) => {
    const status = t.status === 'done' ? '✅' : '⬜';
    const assignee = t.assignee ? ` → <b>${t.assignee}</b>` : '';
    const deadline = t.deadline ? ` ⏰${t.deadline}` : '';
    const completedInfo = t.status === 'done' && t.completedBy
      ? ` (${t.completedBy} 已完成)` : '';

    // 逾期標記
    let overdueTag = '';
    if (t.status === 'pending' && t.date < today) {
      const daysLate = Math.floor((new Date(today) - new Date(t.date)) / 86400000);
      overdueTag = ` 🔴 逾期${daysLate}天`;
    }

    if (showStatus) {
      return `${status} ${i + 1}. ${t.title}${assignee}${deadline}${overdueTag}${completedInfo}`;
    }
    return `${i + 1}. ${t.title}${assignee}${deadline}${overdueTag}`;
  }).join('\n');
}

// 格式化累積待辦報告
function formatPendingReport() {
  const pending = getPendingTasks();
  if (!pending.length) return null;

  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = pending.filter(t => t.date === today);
  const overdue = pending.filter(t => t.date < today);

  let text = `📋 <b>待辦任務總覽</b>（共 ${pending.length} 項未完成）\n\n`;

  if (overdue.length) {
    text += `🔴 <b>逾期未完成（${overdue.length} 項）：</b>\n`;
    text += formatTaskList(overdue) + '\n\n';
  }

  if (todayTasks.length) {
    text += `📌 <b>今日任務（${todayTasks.length} 項）：</b>\n`;
    text += formatTaskList(todayTasks) + '\n\n';
  }

  if (overdue.length) {
    text += `⚠️ 有 ${overdue.length} 項逾期任務，請盡快處理！`;
  }

  return { text, pending, overdue, todayTasks };
}

module.exports = {
  addBossMessage, getBossMessages, clearBossMessages,
  getTasks, addTask, markTaskDone, findPendingTaskByKeyword,
  getTasksByDate, getPendingTasks, getOverdueTasks,
  incrementRemindCount, formatTaskList, formatPendingReport,
  TASKS_FILE, BOSS_MSGS_FILE
};
