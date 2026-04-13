/**
 * PPT 自动生成系统
 * 支持营销、报告、产品演示等多种模板
 */

const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const PPTX_DIR = path.join(DATA_DIR, 'presentations');

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PPTX_DIR)) fs.mkdirSync(PPTX_DIR, { recursive: true });
}

// 营销推广 PPT 模板
async function generateMarketingPPT(title, content = {}) {
  try {
    ensureDirs();
    const pres = new PptxGenJS();
    
    // 设置默认样式
    const layoutProps = { name: 'LAYOUT1', width: 10, height: 7.5 };
    pres.defineLayout(layoutProps);

    // 第1页：标题页
    let slide = pres.addSlide();
    slide.background = { color: '1F4E78' };
    slide.addText(title || '产品营销方案', {
      x: 0.5, y: 2.5, w: 9, h: 1.5,
      fontSize: 54, bold: true, color: 'FFFFFF',
      align: 'center'
    });
    slide.addText(new Date().getFullYear() + ' 年度计划', {
      x: 0.5, y: 4.2, w: 9, h: 0.8,
      fontSize: 24, color: '90CAF9',
      align: 'center'
    });

    // 第2页：概述
    slide = pres.addSlide();
    slide.addText('市场概述', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: '1F4E78'
    });
    const overviewPoints = content.overview || [
      '• 目标市场：东南亚地区，年增长率15%',
      '• 主要竞争对手：3-5家同行业龙头',
      '• 市场机会：数字化转型浪潮',
      '• 我们的优势：价格低、服务好、响应快'
    ];
    slide.addText(overviewPoints.join('\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 16, color: '333333',
      valign: 'top'
    });

    // 第3页：产品特性
    slide = pres.addSlide();
    slide.addText('产品特性 & 优势', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: '1F4E78'
    });
    const features = content.features || [
      '✓ AI 驱动的智能化解决方案',
      '✓ 24/7 不间断服务支持',
      '✓ 支持多语言和多平台集成',
      '✓ 企业级安全与数据保护',
      '✓ 灵活的定价模型'
    ];
    slide.addText(features.join('\n'), {
      x: 1, y: 1.5, w: 8.5, h: 5,
      fontSize: 16, color: '333333',
      valign: 'top'
    });

    // 第4页：价格方案
    slide = pres.addSlide();
    slide.addText('价格方案', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: '1F4E78'
    });
    const pricing = [
      { plan: '基础版', price: '¥99/月', users: '1-5人' },
      { plan: '专业版', price: '¥299/月', users: '6-20人' },
      { plan: '企业版', price: '¥999/月', users: '21+人' }
    ];
    
    // 绘制价格表
    let yPos = 1.5;
    pricing.forEach(p => {
      slide.addShape(pres.ShapeType.rect, {
        x: 0.5, y: yPos, w: 9, h: 1.2,
        fill: { color: 'F0F0F0' },
        line: { color: '1F4E78', width: 2 }
      });
      slide.addText(`${p.plan} | ${p.price} | ${p.users}`, {
        x: 0.7, y: yPos + 0.2, w: 8.5, h: 0.8,
        fontSize: 14, color: '1F4E78', bold: true
      });
      yPos += 1.4;
    });

    // 第5页：客户案例
    slide = pres.addSlide();
    slide.addText('客户成功案例', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: '1F4E78'
    });
    const cases = content.cases || [
      '案例1：某科技公司 - 效率提升 40%，成本降低 30%',
      '案例2：某电商平台 - 用户增长 120%，转化率增加 45%',
      '案例3：某金融机构 - 自动化率达 85%，人力成本节省 50%'
    ];
    slide.addText(cases.join('\n\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 14, color: '333333',
      valign: 'top'
    });

    // 第6页：行动计划
    slide = pres.addSlide();
    slide.addText('行动计划 & 下一步', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: '1F4E78'
    });
    const nextSteps = [
      'Q2 2026: 完成产品优化，发布2.0版本',
      'Q3 2026: 拓展5个新市场，增加50+客户',
      'Q4 2026: 融资轮次，目标估值$50M'
    ];
    slide.addText(nextSteps.join('\n\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 16, bold: true, color: '1F4E78',
      valign: 'top'
    });

    // 第7页：联系方式
    slide = pres.addSlide();
    slide.background = { color: '1F4E78' };
    slide.addText('谢谢！', {
      x: 0.5, y: 2, w: 9, h: 1,
      fontSize: 60, bold: true, color: 'FFFFFF',
      align: 'center'
    });
    slide.addText('联系我们：contact@company.com | +60-3-XXXX-XXXX', {
      x: 0.5, y: 4, w: 9, h: 0.8,
      fontSize: 18, color: '90CAF9',
      align: 'center'
    });

    // 保存文件
    const timestamp = Date.now();
    const filename = `presentation_${timestamp}.pptx`;
    const filepath = path.join(PPTX_DIR, filename);
    
    pres.save({ path: filepath });

    return {
      title,
      filename,
      filepath,
      slides: 7,
      formatted: `✅ <b>PPT 已生成</b>\n\n📊 标题：${title}\n📄 页数：7 页\n📁 文件：${filename}\n\n包含内容：\n• 标题页\n• 市场概述\n• 产品特性\n• 价格方案\n• 客户案例\n• 行动计划\n• 联系方式`
    };
  } catch (err) {
    console.error('PPT 生成失败:', err.message);
    return { error: `生成 PPT 失败: ${err.message}` };
  }
}

// 报告 PPT 模板
async function generateReportPPT(title, reportData = {}) {
  try {
    ensureDirs();
    const pres = new PptxGenJS();
    
    const layoutProps = { name: 'LAYOUT1', width: 10, height: 7.5 };
    pres.defineLayout(layoutProps);

    // 标题页
    let slide = pres.addSlide();
    slide.background = { color: '2E5090' };
    slide.addText(title || '周度报告', {
      x: 0.5, y: 2.5, w: 9, h: 1.5,
      fontSize: 54, bold: true, color: 'FFFFFF',
      align: 'center'
    });
    slide.addText(new Date().toLocaleDateString('zh-TW'), {
      x: 0.5, y: 4.2, w: 9, h: 0.8,
      fontSize: 20, color: '90CAF9',
      align: 'center'
    });

    // 执行摘要
    slide = pres.addSlide();
    slide.addText('执行摘要', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 40, bold: true, color: '2E5090'
    });
    const summary = reportData.summary || [
      '本周成果：完成 85% 的计划任务',
      '关键指标：收入增长 15%，客户满意度 92%',
      '主要挑战：资源紧张，需要加强团队协作',
      '下周计划：继续推进核心项目，完成客户演示'
    ];
    slide.addText(summary.join('\n\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 14, color: '333333'
    });

    // 关键数字
    slide = pres.addSlide();
    slide.addText('关键绩效指标 (KPI)', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 40, bold: true, color: '2E5090'
    });
    const kpis = [
      { label: '销售额', value: '¥2,450,000', change: '+15%' },
      { label: '新客户', value: '127', change: '+22%' },
      { label: '客户满意度', value: '92%', change: '+5%' },
      { label: '项目完成率', value: '85%', change: '-3%' }
    ];
    
    let yPos = 1.5;
    kpis.forEach((kpi, idx) => {
      slide.addShape(pres.ShapeType.rect, {
        x: 0.5 + (idx % 2) * 4.8, y: yPos + Math.floor(idx / 2) * 2, w: 4.5, h: 1.8,
        fill: { color: idx % 2 === 0 ? '4CAF50' : '2196F3' },
        line: { type: 'none' }
      });
      slide.addText(kpi.label, {
        x: 0.7 + (idx % 2) * 4.8, y: yPos + 0.2 + Math.floor(idx / 2) * 2, w: 4, h: 0.4,
        fontSize: 12, color: 'FFFFFF', bold: true
      });
      slide.addText(kpi.value, {
        x: 0.7 + (idx % 2) * 4.8, y: yPos + 0.7 + Math.floor(idx / 2) * 2, w: 4, h: 0.6,
        fontSize: 28, color: 'FFFFFF', bold: true
      });
      slide.addText(kpi.change, {
        x: 0.7 + (idx % 2) * 4.8, y: yPos + 1.3 + Math.floor(idx / 2) * 2, w: 4, h: 0.4,
        fontSize: 14, color: 'FFFFFF'
      });
    });

    // 行动项
    slide = pres.addSlide();
    slide.addText('待办事项 & 行动项', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 40, bold: true, color: '2E5090'
    });
    const actions = reportData.actions || [
      '✓ 完成客户 A 的项目交付 (截止：周三)',
      '✓ 准备下月财务预算报告 (截止：周五)',
      '✓ 组织团队建设活动 (安排中)',
      '✓ 更新项目管理系统 (进行中)'
    ];
    slide.addText(actions.join('\n\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 14, color: '333333'
    });

    // 结束页
    slide = pres.addSlide();
    slide.background = { color: '2E5090' };
    slide.addText('感谢！', {
      x: 0.5, y: 3, w: 9, h: 1,
      fontSize: 50, bold: true, color: 'FFFFFF',
      align: 'center'
    });

    const timestamp = Date.now();
    const filename = `report_${timestamp}.pptx`;
    const filepath = path.join(PPTX_DIR, filename);
    
    pres.save({ path: filepath });

    return {
      title,
      filename,
      filepath,
      slides: 5,
      formatted: `✅ <b>报告 PPT 已生成</b>\n\n📊 标题：${title}\n📄 页数：5 页\n📁 文件：${filename}`
    };
  } catch (err) {
    return { error: `生成报告 PPT 失败: ${err.message}` };
  }
}

// 产品演示 PPT 模板
async function generateProductPPT(productName, specs = {}) {
  try {
    ensureDirs();
    const pres = new PptxGenJS();
    
    const layoutProps = { name: 'LAYOUT1', width: 10, height: 7.5 };
    pres.defineLayout(layoutProps);

    // 标题页
    let slide = pres.addSlide();
    slide.background = { color: 'FF6B35' };
    slide.addText(productName || '新产品发布', {
      x: 0.5, y: 2.5, w: 9, h: 1.5,
      fontSize: 54, bold: true, color: 'FFFFFF',
      align: 'center'
    });
    slide.addText('Product Launch 2026', {
      x: 0.5, y: 4.2, w: 9, h: 0.8,
      fontSize: 24, color: 'FFD700',
      align: 'center'
    });

    // 产品介绍
    slide = pres.addSlide();
    slide.addText('产品介绍', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: 'FF6B35'
    });
    const description = specs.description || [
      `${productName} 是一款革命性的解决方案`,
      '• 采用最新的 AI 技术',
      '• 用户界面简洁直观',
      '• 支持团队协作和实时同步',
      '• 云端存储，随处可得'
    ];
    slide.addText(description.join('\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 14, color: '333333'
    });

    // 核心功能
    slide = pres.addSlide();
    slide.addText('核心功能', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: 'FF6B35'
    });
    const features = specs.features || [
      '🔧 功能1：智能自动化',
      '📊 功能2：实时数据分析',
      '🔐 功能3：企业级安全',
      '🌍 功能4：全球多语言支持'
    ];
    slide.addText(features.join('\n\n'), {
      x: 0.5, y: 1.5, w: 9, h: 5,
      fontSize: 16, color: '333333'
    });

    // 定价
    slide = pres.addSlide();
    slide.addText('立即获取', {
      x: 0.5, y: 0.5, w: 9, h: 0.6,
      fontSize: 44, bold: true, color: 'FF6B35'
    });
    slide.addText('现在购买享受 30% 优惠！\n\n起价：¥99/月\n\n前 100 名客户额外赠送 3 个月免费使用权', {
      x: 0.5, y: 1.8, w: 9, h: 4,
      fontSize: 20, color: 'FF6B35', bold: true,
      align: 'center', valign: 'middle'
    });

    // 联系方式
    slide = pres.addSlide();
    slide.background = { color: 'FF6B35' };
    slide.addText('联系我们', {
      x: 0.5, y: 2.5, w: 9, h: 1,
      fontSize: 50, bold: true, color: 'FFFFFF',
      align: 'center'
    });
    slide.addText('sales@company.com | www.company.com', {
      x: 0.5, y: 4, w: 9, h: 0.8,
      fontSize: 18, color: 'FFD700',
      align: 'center'
    });

    const timestamp = Date.now();
    const filename = `product_${timestamp}.pptx`;
    const filepath = path.join(PPTX_DIR, filename);
    
    pres.save({ path: filepath });

    return {
      productName,
      filename,
      filepath,
      slides: 5,
      formatted: `✅ <b>产品演示 PPT 已生成</b>\n\n🎯 产品：${productName}\n📄 页数：5 页\n📁 文件：${filename}`
    };
  } catch (err) {
    return { error: `生成产品 PPT 失败: ${err.message}` };
  }
}

module.exports = {
  generateMarketingPPT,
  generateReportPPT,
  generateProductPPT
};
