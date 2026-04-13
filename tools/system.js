/**
 * 系統控制工具：打開應用、截圖、文件整理、執行Shell腳本
 */

const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');

const execPromise = util.promisify(exec);

// 打開Mac應用
async function openApp(appName) {
  try {
    // 應用別名
    const appAliases = {
      'chrome': 'Google Chrome',
      '谷歌': 'Google Chrome',
      'firefox': 'Firefox',
      'safari': 'Safari',
      'edge': 'Microsoft Edge',
      'vscode': 'Visual Studio Code',
      'vs': 'Visual Studio Code',
      'figma': 'Figma',
      'photoshop': 'Adobe Photoshop',
      'ps': 'Adobe Photoshop',
      'notion': 'Notion',
      'slack': 'Slack',
      'discord': 'Discord',
      'telegram': 'Telegram',
      'whatsapp': 'WhatsApp',
      'finder': 'Finder',
      'terminal': 'Terminal',
      'iterm': 'iTerm'
    };

    // 查找實際應用名稱
    const realAppName = appAliases[appName.toLowerCase()] || appName;

    await execPromise(`open -a "${realAppName}"`);

    return {
      app: appName,
      status: 'success',
      formatted: `✅ 已打開 "${appName}"`
    };
  } catch (err) {
    return { error: `打開應用失敗: ${err.message}` };
  }
}

// 打開URL (在預設瀏覽器中打開)
async function openUrl(url) {
  try {
    // 確保URL有http://或https://前綴
    let fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fullUrl = `https://${url}`;
    }

    await execPromise(`open "${fullUrl}"`);

    return {
      url: fullUrl,
      status: 'success',
      formatted: `✅ 已在瀏覽器打開 "${url}"`
    };
  } catch (err) {
    return { error: `打開URL失敗: ${err.message}` };
  }
}

// 關閉應用
async function closeApp(appName) {
  try {
    await execPromise(`pkill -f "${appName}"`);
    return {
      app: appName,
      status: 'success',
      formatted: `✅ 已關閉 "${appName}"`
    };
  } catch (err) {
    return { error: `關閉應用失敗: ${err.message}` };
  }
}

// 截圖並發送 (返回圖片路徑，由主程序發送到Telegram)
async function takeScreenshot() {
  try {
    const screenshotPath = `/tmp/screenshot_${Date.now()}.png`;

    // macOS screencapture 命令
    await execPromise(`screencapture -x "${screenshotPath}"`);

    // 等待文件寫入
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!fs.existsSync(screenshotPath)) {
      return { error: '截圖失敗' };
    }

    return {
      path: screenshotPath,
      status: 'success',
      formatted: `📸 截圖已準備好`
    };
  } catch (err) {
    return { error: `截圖失敗: ${err.message}` };
  }
}

// 整理文件 (將下載文件夾按文件類型整理)
async function organizeFiles(sourceDir = '~/Downloads') {
  try {
    const expandedPath = sourceDir.replace('~', require('os').homedir());

    if (!fs.existsSync(expandedPath)) {
      return { error: `目錄不存在: ${sourceDir}` };
    }

    // 文件類型分類
    const categories = {
      'Images': ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'],
      'Documents': ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt'],
      'Videos': ['.mp4', '.mov', '.avi', '.mkv', '.flv'],
      'Audio': ['.mp3', '.wav', '.m4a', '.aac'],
      'Archives': ['.zip', '.rar', '.7z', '.tar', '.gz'],
      'Code': ['.js', '.ts', '.py', '.java', '.cpp', '.html', '.css']
    };

    const files = fs.readdirSync(expandedPath);
    let organized = 0;

    files.forEach(file => {
      const filePath = path.join(expandedPath, file);
      const ext = path.extname(file).toLowerCase();

      // 跳過目錄
      if (fs.statSync(filePath).isDirectory()) return;

      // 查找分類
      for (const [category, extensions] of Object.entries(categories)) {
        if (extensions.includes(ext)) {
          const categoryDir = path.join(expandedPath, category);

          // 創建分類目錄
          if (!fs.existsSync(categoryDir)) {
            fs.mkdirSync(categoryDir);
          }

          // 移動文件
          const newPath = path.join(categoryDir, file);
          if (!fs.existsSync(newPath)) {
            fs.renameSync(filePath, newPath);
            organized++;
          }
          break;
        }
      }
    });

    return {
      directory: expandedPath,
      organized,
      formatted: `✅ 已整理 ${organized} 個文件`
    };
  } catch (err) {
    return { error: `文件整理失敗: ${err.message}` };
  }
}

// 執行Shell腳本 (僅執行預先定義的腳本，安全性考慮)
async function runShell(scriptName) {
  try {
    // 預定義的安全腳本路徑
    const safeScripts = {
      'backup': '/Users/mannyaoleong/scripts/backup.sh',
      'cleanup': '/Users/mannyaoleong/scripts/cleanup.sh',
      'update': '/Users/mannyaoleong/scripts/update.sh'
    };

    const scriptPath = safeScripts[scriptName.toLowerCase()];
    if (!scriptPath) {
      return { error: `未知腳本: "${scriptName}"，可用腳本: ${Object.keys(safeScripts).join(', ')}` };
    }

    if (!fs.existsSync(scriptPath)) {
      return { error: `腳本不存在: ${scriptPath}` };
    }

    const { stdout, stderr } = await execPromise(`bash "${scriptPath}"`);

    return {
      script: scriptName,
      output: stdout || stderr,
      formatted: `✅ 已執行腳本 "${scriptName}"\n\n${stdout || stderr}`
    };
  } catch (err) {
    return { error: `執行腳本失敗: ${err.message}` };
  }
}

// 執行任意Shell命令 (謹慎使用，需要明確用戶意圖)
async function executeCommand(command) {
  try {
    // 安全檢查：禁止危險命令
    const dangerousPatterns = ['rm -rf', 'rm -f /', 'dd if=', 'mkfs', 'shutdown', 'reboot'];
    const isDangerous = dangerousPatterns.some(pattern => command.toLowerCase().includes(pattern));

    if (isDangerous) {
      return { error: '⚠️ 該命令過於危險，已拒絕執行' };
    }

    const { stdout, stderr } = await execPromise(command, { timeout: 10000 });

    return {
      command,
      output: stdout || stderr,
      formatted: `✅ 命令執行完成\n\n${stdout || stderr}`
    };
  } catch (err) {
    return { error: `命令執行失敗: ${err.message}` };
  }
}

module.exports = {
  openApp,
  openUrl,
  closeApp,
  takeScreenshot,
  organizeFiles,
  runShell,
  executeCommand
};
