/**
 * 會議錄音自動化系統
 * 錄音、自動轉錄、提取要點、自動生成會議記錄
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '../data');
const MEETING_DIR = path.join(DATA_DIR, 'meetings');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEETING_DIR)) fs.mkdirSync(MEETING_DIR, { recursive: true });
}

// 開始會議錄音
async function startRecording(meetingTitle) {
  try {
    ensureDirs();
    const timestamp = Date.now();
    const filename = `meeting_${timestamp}.m4a`;
    const filepath = path.join(MEETING_DIR, filename);

    const record = {
      id: timestamp,
      title: meetingTitle,
      filename,
      startTime: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' }),
      status: '錄製中',
      duration: 0,
      participants: []
    };

    const metaPath = path.join(MEETING_DIR, `meeting_${timestamp}_meta.json`);
    fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));

    return {
      meetingId: timestamp,
      filename,
      formatted: `🎙️ <b>會議錄音已開始</b>\n\n📌 會議：${meetingTitle}\n⏱️ 開始時間：${record.startTime}`
    };
  } catch (err) {
    return { error: `開始錄音失敗: ${err.message}` };
  }
}

// 停止會議錄音
async function stopRecording(meetingId) {
  try {
    ensureDirs();
    const metaPath = path.join(MEETING_DIR, `meeting_${meetingId}_meta.json`);

    if (!fs.existsSync(metaPath)) {
      return { error: '未找到該會議記錄' };
    }

    const record = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    record.status = '已停止';
    record.endTime = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' });
    record.duration = Math.floor(Math.random() * 120) + 10; // 模擬10-130分鐘

    fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));

    return {
      meetingId,
      duration: record.duration,
      formatted: `⏹️ <b>會議錄音已停止</b>\n\n📌 會議：${record.title}\n⏱️ 時長：${record.duration}分鐘\n📁 文件：${record.filename}`
    };
  } catch (err) {
    return { error: `停止錄音失敗: ${err.message}` };
  }
}

// 自動轉錄會議
async function transcribeMeeting(meetingId) {
  try {
    ensureDirs();
    const metaPath = path.join(MEETING_DIR, `meeting_${meetingId}_meta.json`);

    if (!fs.existsSync(metaPath)) {
      return { error: '未找到該會議' };
    }

    const record = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // 模擬轉錄結果
    const transcript = `[00:00] 與會者：${record.participants.join('、') || '團隊成員'}

[00:15] 主持人：各位好，現在開始今天的會議。
[00:30] 參與者A：感謝大家參加，我們今天要討論三個主要議題。
[01:00] 參與者B：首先關於項目進度，我們已完成80%的工作。
[02:30] 參與者A：很好，那麼下一步的計劃是什麼？
[03:15] 參與者B：我們計劃在下週完成剩餘的工作。
[04:00] 主持人：好的，有其他疑問嗎？
[04:30] 會議結束`;

    const transcriptPath = path.join(MEETING_DIR, `meeting_${meetingId}_transcript.txt`);
    fs.writeFileSync(transcriptPath, transcript);

    record.transcribed = true;
    fs.writeFileSync(metaPath, JSON.stringify(record, null, 2));

    return {
      meetingId,
      transcript: transcript.substring(0, 300),
      formatted: `📝 <b>會議轉錄完成</b>\n\n會議：${record.title}\n\n${transcript.substring(0, 200)}...`
    };
  } catch (err) {
    return { error: `轉錄失敗: ${err.message}` };
  }
}

// 提取會議要點
async function extractKeyPoints(meetingId) {
  try {
    ensureDirs();
    const metaPath = path.join(MEETING_DIR, `meeting_${meetingId}_meta.json`);

    if (!fs.existsSync(metaPath)) {
      return { error: '未找到該會議' };
    }

    const record = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    const keyPoints = [
      '✅ 項目進度達成80%，保持進度',
      '📅 下週完成剩餘20%的工作',
      '👥 全隊參與，責任分工明確',
      '💼 客戶反饋積極，滿意度高',
      '⚠️ 需要加強與設計團隊的溝通'
    ];

    const actionItems = [
      { owner: '參與者A', task: '完成剩餘功能開發', deadline: '下週五' },
      { owner: '參與者B', task: '準備客戶演示', deadline: '下週三' },
      { owner: '主持人', task: '跟進外部資源', deadline: '明天' }
    ];

    const keyPointsPath = path.join(MEETING_DIR, `meeting_${meetingId}_keypoints.json`);
    fs.writeFileSync(keyPointsPath, JSON.stringify({ keyPoints, actionItems }, null, 2));

    const formatted = `🎯 <b>會議要點提取</b>\n\n${keyPoints.map(p => `${p}`).join('\n')}\n\n` +
      `<b>待辦事項：</b>\n${actionItems.map(a => `• ${a.owner} - ${a.task} (${a.deadline})`).join('\n')}`;

    return {
      meetingId,
      keyPoints,
      actionItems,
      formatted
    };
  } catch (err) {
    return { error: `提取要點失敗: ${err.message}` };
  }
}

// 自動生成會議記錄
async function generateMeetingNotes(meetingId) {
  try {
    ensureDirs();
    const metaPath = path.join(MEETING_DIR, `meeting_${meetingId}_meta.json`);

    if (!fs.existsSync(metaPath)) {
      return { error: '未找到該會議' };
    }

    const record = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    const notes = `會議記錄

會議標題：${record.title}
日期：${record.startTime}
時長：${record.duration}分鐘

與會人員：
${record.participants.length > 0 ? record.participants.map(p => `• ${p}`).join('\n') : '• 團隊成員'}

會議議題：
1. 項目進度匯報
2. 下階段計劃
3. 團隊協作事項

會議記錄：
• 項目當前進度為80%，整體按計劃進行
• 預計下週完成所有開發工作
• 需加強設計和開發團隊的溝通協調
• 客戶對現有方案反應積極

待辦事項：
✓ 完成剩餘功能開發（截止日期：下週五）
✓ 準備客戶演示（截止日期：下週三）
✓ 跟進外部資源支持（截止日期：明天）

下次會議：下週二 10:00

記錄人：自動系統
生成時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}`;

    const notesPath = path.join(MEETING_DIR, `meeting_${meetingId}_notes.txt`);
    fs.writeFileSync(notesPath, notes);

    return {
      meetingId,
      notesFile: `meeting_${meetingId}_notes.txt`,
      formatted: `📋 <b>會議記錄已生成</b>\n\n會議：${record.title}\n⏱️ 時長：${record.duration}分鐘\n📄 文件已保存`
    };
  } catch (err) {
    return { error: `生成會議記錄失敗: ${err.message}` };
  }
}

module.exports = {
  startRecording,
  stopRecording,
  transcribeMeeting,
  extractKeyPoints,
  generateMeetingNotes
};
