/**
 * 文檔自動生成系統
 * 自動生成報價單、合同、發票
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const DOCS_DIR = path.join(DATA_DIR, 'documents');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DOCS_DIR)) fs.mkdirSync(DOCS_DIR, { recursive: true });
}

// 生成報價單
async function generateQuote(clientName, items = [], discount = 0) {
  try {
    ensureDirs();
    const now = new Date();
    const quoteNumber = `QT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-5)}`;

    const defaultItems = items.length > 0 ? items : [
      { description: '專業設計服務', quantity: 1, unitPrice: 5000 },
      { description: 'UI/UX設計', quantity: 1, unitPrice: 3000 },
      { description: '開發費用', quantity: 1, unitPrice: 8000 }
    ];

    let subtotal = 0;
    defaultItems.forEach(item => {
      subtotal += item.quantity * item.unitPrice;
    });

    const discountAmount = subtotal * (discount / 100);
    const total = subtotal - discountAmount;

    const quote = `報 價 單

報價編號：${quoteNumber}
生成日期：${now.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}

客戶信息
───────────────────
客戶名稱：${clientName}
報價有效期：30天

詳細項目
───────────────────`;

    let itemsText = '';
    defaultItems.forEach((item, idx) => {
      itemsText += `\n${idx + 1}. ${item.description}
   數量：${item.quantity} × ${item.unitPrice.toLocaleString('zh-CN')} = ${(item.quantity * item.unitPrice).toLocaleString('zh-CN')}`;
    });

    const quote_content = quote + itemsText + `

金額匯總
───────────────────
小計：￥${subtotal.toLocaleString('zh-CN')}
折扣（${discount}%）：-￥${discountAmount.toLocaleString('zh-CN')}
總金額：￥${total.toLocaleString('zh-CN')}

條款與條件
───────────────────
• 本報價單自簽發之日起30天內有效
• 定金：總金額的30%
• 尾款：項目完成時支付
• 支付方式：銀行轉帳或支付寶

備註
───────────────────
如有任何疑問，歡迎與我們聯繫。

生成系統：自動報價系統
`;

    const filename = `quote_${quoteNumber}.txt`;
    const filepath = path.join(DOCS_DIR, filename);
    fs.writeFileSync(filepath, quote_content);

    return {
      quoteNumber,
      clientName,
      total,
      filename,
      formatted: `📄 <b>報價單已生成</b>\n\n報價編號：${quoteNumber}\n客戶：${clientName}\n總金額：￥${total.toLocaleString('zh-CN')}\n📁 文件：${filename}`
    };
  } catch (err) {
    return { error: `生成報價單失敗: ${err.message}` };
  }
}

// 生成合同
async function generateContract(clientName, projectName, amount, startDate = null, duration = 30) {
  try {
    ensureDirs();
    const now = new Date();
    const contractNumber = `CT-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-5)}`;
    const start = startDate ? new Date(startDate) : now;
    const end = new Date(start);
    end.setDate(end.getDate() + duration);

    const contract = `合 同 書

合同編號：${contractNumber}
簽訂日期：${now.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}

甲方（服務提供方）
───────────────────
公司名稱：AI助手服務公司
聯絡人：自動系統

乙方（客戶）
───────────────────
客戶名稱：${clientName}

項目信息
───────────────────
項目名稱：${projectName}
項目期限：${duration}天
開始日期：${start.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}
完成日期：${end.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}

合作條款
───────────────────
1. 服務範圍
   • 專業項目規劃與設計
   • 技術開發與實施
   • 品質保證與測試
   • 客戶支持與維護

2. 付款條款
   • 總金額：￥${amount.toLocaleString('zh-CN')}
   • 定金：￥${Math.round(amount * 0.3).toLocaleString('zh-CN')}（簽訂合同時支付）
   • 中期款：￥${Math.round(amount * 0.4).toLocaleString('zh-CN')}（項目進度50%時）
   • 尾款：￥${Math.round(amount * 0.3).toLocaleString('zh-CN')}（項目完成時）

3. 責任與義務
   甲方責任：
   • 按時交付高質量的服務
   • 保守客戶商業機密
   • 提供技術支持與指導

   乙方責任：
   • 按時支付相關費用
   • 提供必要的項目信息
   • 配合項目實施

4. 保密條款
   雙方承諾對項目涉及的所有信息保密。

5. 違約責任
   任何一方未按本合同履行義務，應承擔相應責任。

6. 合同生效
   本合同自雙方簽署之日起生效。

簽署確認
───────────────────
甲方代表：_______________    日期：_______________
乙方代表：_______________    日期：_______________

備註
───────────────────
本合同一式兩份，甲乙雙方各持一份。

生成系統：自動合同生成系統
`;

    const filename = `contract_${contractNumber}.txt`;
    const filepath = path.join(DOCS_DIR, filename);
    fs.writeFileSync(filepath, contract);

    return {
      contractNumber,
      clientName,
      projectName,
      amount,
      filename,
      formatted: `📑 <b>合同已生成</b>\n\n合同編號：${contractNumber}\n客戶：${clientName}\n項目：${projectName}\n金額：￥${amount.toLocaleString('zh-CN')}\n期限：${duration}天`
    };
  } catch (err) {
    return { error: `生成合同失敗: ${err.message}` };
  }
}

// 生成發票
async function generateInvoice(clientName, items = [], invoiceDate = null) {
  try {
    ensureDirs();
    const now = invoiceDate ? new Date(invoiceDate) : new Date();
    const invoiceNumber = `INV-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${Date.now().toString().slice(-5)}`;

    const defaultItems = items.length > 0 ? items : [
      { description: '設計服務費', quantity: 1, unitPrice: 5000 },
      { description: '開發費用', quantity: 1, unitPrice: 8000 }
    ];

    let subtotal = 0;
    defaultItems.forEach(item => {
      subtotal += item.quantity * item.unitPrice;
    });

    const tax = subtotal * 0.13; // 13% 稅率
    const total = subtotal + tax;
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = `發 票

發票編號：${invoiceNumber}
開票日期：${now.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}
到期日期：${dueDate.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}

發票人信息
───────────────────
公司名稱：AI助手服務公司
統一編號：88888888
地址：馬來西亞，吉隆坡
電話：+60-3-XXXX-XXXX

收票人信息
───────────────────
客戶名稱：${clientName}

發票詳情
───────────────────`;

    let itemsText = '';
    defaultItems.forEach((item, idx) => {
      itemsText += `\n${idx + 1}. ${item.description}
   數量：${item.quantity} × ￥${item.unitPrice.toLocaleString('zh-CN')} = ￥${(item.quantity * item.unitPrice).toLocaleString('zh-CN')}`;
    });

    const invoice_content = invoice + itemsText + `

金額明細
───────────────────
小計：￥${subtotal.toLocaleString('zh-CN')}
稅金（13%）：￥${tax.toFixed(2).toLocaleString('zh-CN')}
總金額：￥${total.toLocaleString('zh-CN')}

付款信息
───────────────────
銀行轉帳
銀行名稱：馬來西亞銀行
賬戶號碼：XXXX-XXXX-XXXX-XXXX
SWIFT Code：XXXXX

支付寶/微信
賬號：[待配置]

備註
───────────────────
如有疑問，請在30天內與我們聯繫。

生成系統：自動發票系統
`;

    const filename = `invoice_${invoiceNumber}.txt`;
    const filepath = path.join(DOCS_DIR, filename);
    fs.writeFileSync(filepath, invoice_content);

    return {
      invoiceNumber,
      clientName,
      total,
      dueDate: dueDate.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' }),
      filename,
      formatted: `💰 <b>發票已生成</b>\n\n發票編號：${invoiceNumber}\n客戶：${clientName}\n總金額：￥${total.toLocaleString('zh-CN')}\n到期日期：${dueDate.toLocaleString('zh-TW', { timeZone: 'Asia/Kuala_Lumpur' })}\n📁 文件：${filename}`
    };
  } catch (err) {
    return { error: `生成發票失敗: ${err.message}` };
  }
}

module.exports = {
  generateQuote,
  generateContract,
  generateInvoice
};
