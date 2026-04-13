/**
 * 客户管理系统：搜索、筛选、分析、报告生成
 */

const fs = require('fs');
const path = require('path');

// 演示数据库路径
const DATA_DIR = path.join(__dirname, '../data');
const CUSTOMERS_FILE = path.join(DATA_DIR, 'customers.json');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');

// 确保目录存在
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

// 初始化演示数据
function initializeDemoData() {
  ensureDirs();

  if (!fs.existsSync(CUSTOMERS_FILE)) {
    const demoCustomers = [
      { id: 1, name: '李明', email: 'liming@example.com', phone: '60123456789', industry: '保險', position: '保險代理人', region: '吉隆坡', status: '潛在客戶', score: 85 },
      { id: 2, name: '王芳', email: 'wangfang@example.com', phone: '60187654321', industry: '保險', position: '保險經紀', region: '巴生', status: '潛在客戶', score: 90 },
      { id: 3, name: '張偉', email: 'zhangwei@example.com', phone: '60198765432', industry: '金融', position: '基金經理', region: '吉隆坡', status: '已聯繫', score: 60 },
      { id: 4, name: '陳思語', email: 'chensiyu@example.com', phone: '60145678901', industry: '保險', position: '保險顧問', region: '槟城', status: '潛在客戶', score: 88 },
      { id: 5, name: '劉麗', email: 'liuli@example.com', phone: '60156789012', industry: '房產', position: '房地產經紀', region: '吉隆坡', status: '不感興趣', score: 30 },
      { id: 6, name: '楊超', email: 'yangchao@example.com', phone: '60167890123', industry: '保險', position: '保險培訓師', region: '新加坡', status: '潛在客戶', score: 95 },
      { id: 7, name: '何靜', email: 'hejing@example.com', phone: '60178901234', industry: '金融', position: '保險分析師', region: '吉隆坡', status: '潛在客戶', score: 82 },
      { id: 8, name: '周峰', email: 'zhoufeng@example.com', phone: '60189012345', industry: '保險', position: '保險銷售', region: '槟城', status: '已聯繫', score: 72 }
    ];

    fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(demoCustomers, null, 2));
    console.log('✅ 演示數據已初始化');
  }
}

// 讀取所有客戶
function getAllCustomers() {
  ensureDirs();
  initializeDemoData();

  const data = fs.readFileSync(CUSTOMERS_FILE, 'utf-8');
  return JSON.parse(data);
}

// 保存客戶數據
function saveCustomers(customers) {
  ensureDirs();
  fs.writeFileSync(CUSTOMERS_FILE, JSON.stringify(customers, null, 2));
}

// 搜索客戶
async function searchCustomers(query) {
  try {
    const customers = getAllCustomers();
    const lowerQuery = query.toLowerCase();

    const results = customers.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.email.toLowerCase().includes(lowerQuery) ||
      c.phone.includes(query) ||
      c.industry.toLowerCase().includes(lowerQuery) ||
      c.position.toLowerCase().includes(lowerQuery)
    );

    return {
      query,
      count: results.length,
      customers: results,
      formatted: `🔍 搜索結果 (共 ${results.length} 人)：\n\n${
        results.slice(0, 10).map((c, i) => `${i + 1}. ${c.name} - ${c.position} (${c.industry})`).join('\n')
      }`
    };
  } catch (err) {
    return { error: `搜索失敗: ${err.message}` };
  }
}

// 篩選客戶
async function filterCustomers(criteria) {
  try {
    const customers = getAllCustomers();

    let filtered = customers;

    // 按行業篩選
    if (criteria.industry) {
      filtered = filtered.filter(c => c.industry === criteria.industry);
    }

    // 按地區篩選
    if (criteria.region) {
      filtered = filtered.filter(c => c.region === criteria.region);
    }

    // 按狀態篩選
    if (criteria.status) {
      filtered = filtered.filter(c => c.status === criteria.status);
    }

    // 按評分篩選 (>= 指定分數)
    if (criteria.minScore) {
      filtered = filtered.filter(c => c.score >= criteria.minScore);
    }

    // 按職位篩選
    if (criteria.position) {
      filtered = filtered.filter(c => c.position.includes(criteria.position));
    }

    const summary = {
      total: filtered.length,
      byIndustry: {},
      byRegion: {},
      byStatus: {}
    };

    filtered.forEach(c => {
      summary.byIndustry[c.industry] = (summary.byIndustry[c.industry] || 0) + 1;
      summary.byRegion[c.region] = (summary.byRegion[c.region] || 0) + 1;
      summary.byStatus[c.status] = (summary.byStatus[c.status] || 0) + 1;
    });

    return {
      criteria,
      count: filtered.length,
      customers: filtered,
      summary,
      formatted: `✅ 篩選結果 (共 ${filtered.length} 人)：\n\n${
        filtered.slice(0, 10).map((c, i) => `${i + 1}. ${c.name} (${c.region}) - 評分: ${c.score}`).join('\n')
      }\n\n📊 統計：\n行業: ${JSON.stringify(summary.byIndustry)}`
    };
  } catch (err) {
    return { error: `篩選失敗: ${err.message}` };
  }
}

// 生成報告
async function generateReport(reportType = 'all') {
  try {
    const customers = getAllCustomers();
    const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' });
    const filename = `report_${Date.now()}.txt`;
    const filepath = path.join(REPORTS_DIR, filename);

    let reportContent = '';

    if (reportType === 'all' || reportType === 'summary') {
      reportContent += `📊 客戶管理系統報告\n`;
      reportContent += `生成時間: ${timestamp}\n`;
      reportContent += `\n`;
      reportContent += `📈 總體統計:\n`;
      reportContent += `總客戶數: ${customers.length}\n`;

      const byStatus = {};
      const byIndustry = {};
      const byRegion = {};

      customers.forEach(c => {
        byStatus[c.status] = (byStatus[c.status] || 0) + 1;
        byIndustry[c.industry] = (byIndustry[c.industry] || 0) + 1;
        byRegion[c.region] = (byRegion[c.region] || 0) + 1;
      });

      reportContent += `\n客戶狀態:\n`;
      Object.entries(byStatus).forEach(([status, count]) => {
        reportContent += `  • ${status}: ${count}\n`;
      });

      reportContent += `\n按行業分類:\n`;
      Object.entries(byIndustry).forEach(([industry, count]) => {
        reportContent += `  • ${industry}: ${count}\n`;
      });

      reportContent += `\n按地區分類:\n`;
      Object.entries(byRegion).forEach(([region, count]) => {
        reportContent += `  • ${region}: ${count}\n`;
      });
    }

    if (reportType === 'all' || reportType === 'potential') {
      reportContent += `\n\n🎯 潛在客戶名單 (評分 >= 80):\n`;
      const potential = customers
        .filter(c => c.status === '潛在客戶' && c.score >= 80)
        .sort((a, b) => b.score - a.score);

      potential.forEach((c, i) => {
        reportContent += `${i + 1}. ${c.name}\n`;
        reportContent += `   行業: ${c.industry} | 職位: ${c.position}\n`;
        reportContent += `   地區: ${c.region} | 評分: ${c.score}\n`;
        reportContent += `   郵箱: ${c.email} | 電話: ${c.phone}\n\n`;
      });
    }

    fs.writeFileSync(filepath, reportContent);

    return {
      type: reportType,
      filename,
      path: filepath,
      formatted: `✅ 報告已生成\n📄 文件: ${filename}\n📍 路徑: ${filepath}`
    };
  } catch (err) {
    return { error: `生成報告失敗: ${err.message}` };
  }
}

// 添加客戶
async function addCustomer(customerData) {
  try {
    const customers = getAllCustomers();
    const newId = Math.max(...customers.map(c => c.id), 0) + 1;

    const newCustomer = {
      id: newId,
      name: customerData.name,
      email: customerData.email || '',
      phone: customerData.phone || '',
      industry: customerData.industry || '未分類',
      position: customerData.position || '',
      region: customerData.region || '未知',
      status: customerData.status || '潛在客戶',
      score: customerData.score || 50
    };

    customers.push(newCustomer);
    saveCustomers(customers);

    return {
      customer: newCustomer,
      formatted: `✅ 已添加客戶: ${newCustomer.name}`
    };
  } catch (err) {
    return { error: `添加客戶失敗: ${err.message}` };
  }
}

// 更新客戶狀態
async function updateCustomerStatus(customerId, newStatus) {
  try {
    const customers = getAllCustomers();
    const customer = customers.find(c => c.id === customerId);

    if (!customer) {
      return { error: `客戶不存在 (ID: ${customerId})` };
    }

    customer.status = newStatus;
    saveCustomers(customers);

    return {
      customer,
      formatted: `✅ 已更新 ${customer.name} 的狀態為: ${newStatus}`
    };
  } catch (err) {
    return { error: `更新失敗: ${err.message}` };
  }
}

// 獲取高價值客戶列表
async function getTopCustomers(limit = 10) {
  try {
    const customers = getAllCustomers();
    const sorted = customers
      .filter(c => c.status === '潛在客戶')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const formatted = sorted
      .map((c, i) => `${i + 1}. ${c.name} (${c.industry}) - 評分: ${c.score}`)
      .join('\n');

    return {
      count: sorted.length,
      customers: sorted,
      formatted: `⭐ 高價值客戶 Top ${limit}:\n\n${formatted}`
    };
  } catch (err) {
    return { error: `獲取頂級客戶失敗: ${err.message}` };
  }
}

module.exports = {
  initializeDemoData,
  getAllCustomers,
  searchCustomers,
  filterCustomers,
  generateReport,
  addCustomer,
  updateCustomerStatus,
  getTopCustomers
};
