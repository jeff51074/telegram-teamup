/**
 * 網絡功能工具：天氣、新聞、搜索、匯率
 */

const axios = require('axios');
const cheerio = require('cheerio');

// 天氣查詢 (OpenWeatherMap免費API)
async function getWeather(city) {
  try {
    // 使用免費的天氣API (開放天氣數據)
    const res = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: getCoordinates(city).lat,
        longitude: getCoordinates(city).lon,
        current: 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m',
        timezone: 'Asia/Kuala_Lumpur'
      }
    });

    const { temperature_2m, weather_code, wind_speed_10m, relative_humidity_2m } = res.data.current;
    const weatherDesc = getWeatherDescription(weather_code);

    return {
      city,
      temperature: temperature_2m,
      description: weatherDesc,
      humidity: relative_humidity_2m,
      windSpeed: wind_speed_10m,
      formatted: `📍 ${city}\n🌡️ 溫度：${temperature_2m}°C\n☁️ 天氣：${weatherDesc}\n💨 風速：${wind_speed_10m} m/s\n💧 濕度：${relative_humidity_2m}%`
    };
  } catch (err) {
    console.error('天氣查詢錯誤:', err.message);
    return null;
  }
}

// 城市座標對應表
function getCoordinates(city) {
  const coordinates = {
    '吉隆坡': { lat: 3.1390, lon: 101.6869 },
    'kl': { lat: 3.1390, lon: 101.6869 },
    '马来西亚': { lat: 4.2105, lon: 101.6964 },
    '吉隆玻': { lat: 3.1390, lon: 101.6869 },
    '巴生': { lat: 3.0598, lon: 101.5183 },
    '槟城': { lat: 5.3667, lon: 100.3036 },
    'penang': { lat: 5.3667, lon: 100.3036 },
    '新加坡': { lat: 1.3521, lon: 103.8198 },
    '曼谷': { lat: 13.7563, lon: 100.5018 }
  };
  return coordinates[city.toLowerCase()] || { lat: 3.1390, lon: 101.6869 }; // 默認吉隆坡
}

function getWeatherDescription(code) {
  const descriptions = {
    0: '晴朗',
    1: '晴朗',
    2: '多雲',
    3: '陰雲',
    45: '霧',
    48: '霧',
    51: '小雨',
    53: '中雨',
    55: '大雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    80: '陣雨',
    81: '陣雨',
    82: '強陣雨',
    85: '陣雪',
    86: '陣雪',
    95: '雷暴'
  };
  return descriptions[code] || '未知';
}

// 新聞查詢 (使用BBC News API)
async function getNews(keyword = 'technology') {
  try {
    // 使用NewsAPI (免費版本，無需key也可以基本查詢)
    // 或者使用開放的新聞端點
    const newsUrls = {
      'technology': 'https://feeds.bbci.co.uk/news/technology/rss.xml',
      'business': 'https://feeds.bbci.co.uk/news/business/rss.xml',
      'world': 'https://feeds.bbci.co.uk/news/world/rss.xml',
      'science': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml'
    };

    const rssUrl = newsUrls[keyword.toLowerCase()] || 'https://feeds.bbci.co.uk/news/rss.xml';

    const res = await axios.get(rssUrl, { timeout: 5000 });
    const $ = cheerio.load(res.data);
    const articles = [];

    $('item').slice(0, 5).each((i, elem) => {
      const title = $(elem).find('title').text();
      const description = $(elem).find('description').text();
      const pubDate = $(elem).find('pubDate').text();

      if (title) {
        articles.push({
          title: title.trim(),
          description: description.substring(0, 50).trim(),
          pubDate
        });
      }
    });

    if (articles.length === 0) {
      return { formatted: `📰 無法獲取 "${keyword}" 的新聞，請稍後重試` };
    }

    const formatted = articles
      .map((a, i) => `${i + 1}. ${a.title}`)
      .join('\n');

    return {
      keyword,
      count: articles.length,
      formatted: `📰 最新${keyword}新聞 (共${articles.length}條)：\n\n${formatted}`
    };
  } catch (err) {
    console.error('新聞查詢錯誤:', err.message);
    return { formatted: '📰 新聞查詢暫時不可用，請稍後重試' };
  }
}

// 網頁搜索 (DuckDuckGo API)
async function webSearch(query) {
  try {
    const res = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json'
      }
    });

    const results = [];

    // 從AbstractText和RelatedTopics提取結果
    if (res.data.Abstract) {
      results.push({
        title: query,
        description: res.data.Abstract,
        url: res.data.AbstractURL
      });
    }

    if (res.data.RelatedTopics && res.data.RelatedTopics.length > 0) {
      res.data.RelatedTopics.slice(0, 4).forEach(topic => {
        if (topic.Text) {
          results.push({
            title: topic.FirstURL ? new URL(topic.FirstURL).hostname : 'Web',
            description: topic.Text.substring(0, 100)
          });
        }
      });
    }

    if (results.length === 0) {
      return { error: `無法找到 "${query}" 的搜索結果` };
    }

    const formatted = results
      .slice(0, 5)
      .map((r, i) => `${i + 1}. <b>${r.title}</b>\n${r.description}`)
      .join('\n\n');

    return {
      query,
      results,
      formatted: `🔍 搜索結果："${query}"\n\n${formatted}`
    };
  } catch (err) {
    console.error('搜索錯誤:', err.message);
    return { error: '搜索失敗，請重試' };
  }
}

// 匯率查詢 (exchangerate.host 免費API)
async function getExchangeRate(from = 'USD', to = 'MYR') {
  try {
    const res = await axios.get(`https://api.exchangerate.host/latest`, {
      params: {
        base: from.toUpperCase(),
        symbols: to.toUpperCase()
      }
    });

    if (!res.data.rates) {
      return { error: `無法獲取 ${from} 到 ${to} 的匯率` };
    }

    const rate = res.data.rates[to.toUpperCase()];
    const formatted = `💱 匯率\n${from.toUpperCase()} → ${to.toUpperCase()}\n1 ${from.toUpperCase()} = ${rate.toFixed(4)} ${to.toUpperCase()}`;

    return {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      rate: rate.toFixed(4),
      formatted
    };
  } catch (err) {
    console.error('匯率查詢錯誤:', err.message);
    return { error: '匯率查詢失敗' };
  }
}

module.exports = {
  getWeather,
  getNews,
  webSearch,
  getExchangeRate
};
