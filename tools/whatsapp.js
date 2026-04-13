const axios = require('axios');

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;

const twilio = axios.create({
  baseURL: `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}`,
  auth: { username: TWILIO_ACCOUNT_SID, password: TWILIO_AUTH_TOKEN }
});

async function sendWhatsAppMessage(to, message) {
  try {
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
    const fromNumber = `whatsapp:${TWILIO_WHATSAPP_NUMBER}`;
    const response = await twilio.post('/Messages.json', {
      From: fromNumber,
      To: toNumber,
      Body: message
    });
    return {
      to, message, sid: response.data.sid, status: response.data.status,
      formatted: `✅ WhatsApp消息已发送\n📱 收信人: ${to}\n💬 ${message.substring(0, 50)}...`
    };
  } catch (err) {
    return { error: `发送失败: ${err.message}` };
  }
}

async function getMessages(limit = 10) {
  try {
    const response = await twilio.get('/Messages.json', { params: { Limit: limit, PageSize: limit } });
    const messages = response.data.messages || [];
    return {
      count: messages.length, messages,
      formatted: `📱 最新消息 (${messages.length}条):\n\n${
        messages.slice(0, 5).map((m, i) => `${i + 1}. ${m.from}\n${m.body.substring(0, 50)}`).join('\n\n')
      }`
    };
  } catch (err) {
    return { error: `获取失败: ${err.message}` };
  }
}

module.exports = { sendWhatsAppMessage, getMessages };
