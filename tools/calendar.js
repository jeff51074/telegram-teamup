/**
 * TeamUp日曆工具 (現有功能抽取)
 */

const axios = require('axios');

module.exports = function createCalendarTools(teamup, formatEventWithTimeRange) {
  return {
    // 新增事件
    createEvent: async (title, startDt, endDt) => {
      try {
        const response = await teamup.post('/events', {
          subcalendar_id: 14971361,
          title,
          start_dt: startDt,
          end_dt: endDt,
          all_day: false
        });

        return {
          title,
          startDt,
          endDt,
          formatted: `✅ 已新增: ${title} (${formatEventWithTimeRange(startDt, endDt)})`
        };
      } catch (err) {
        return { error: `新增事件失敗: ${err.message}` };
      }
    },

    // 查詢事件
    getEvents: async (start, end) => {
      try {
        const res = await teamup.get('/events', { params: { startDate: start, endDate: end } });
        const events = res.data.events || [];
        const sorted = events
          .filter(e => e.start_dt)
          .sort((a, b) => new Date(a.start_dt) - new Date(b.start_dt));

        return {
          start,
          end,
          events: sorted,
          formatted: sorted.map(e => `${formatEventWithTimeRange(e.start_dt, e.end_dt)} — ${e.title}`).join('\n')
        };
      } catch (err) {
        return { error: `查詢事件失敗: ${err.message}` };
      }
    },

    // 刪除事件
    deleteEvent: async (eventId) => {
      try {
        await teamup.delete(`/events/${eventId}`);
        return {
          eventId,
          formatted: `✅ 已刪除事件`
        };
      } catch (err) {
        return { error: `刪除事件失敗: ${err.message}` };
      }
    }
  };
};
