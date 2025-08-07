/**
 * 東京都江東区の天気予報をSlackに自動投稿するNode.jsスクリプト
 * 
 * 実行スケジュール (GitHub Actions):
 * - 金曜日15時: 翌月曜日の天気予報
 * - 水曜日15時: 翌日の天気予報
 */

// ===== 設定エリア =====
const CONFIG = {
  AREA_CODE: "130000", // 東京都のエリアコード
  SLACK_WEBHOOK_URL: process.env.SLACK_WEBHOOK_URL, // 環境変数から取得
  BOT_NAME: "天気予報Bot",
  BOT_ICON: ":sunny:"
};

/**
 * メイン関数 - GitHub Actionsから実行される
 */
async function main() {
  try {
    console.log("=== 天気予報取得開始 ===");
    
    // 1. 実行期間チェック（7月〜9月のみ）
    if (!isExecutionPeriod()) {
      console.log("実行期間外（7月〜9月以外）のため、処理を終了します。");
      console.log("=== 実行期間外のため終了 ===");
      return;
    }
    
    // 2. 設定チェック
    if (!CONFIG.SLACK_WEBHOOK_URL) {
      throw new Error("Slack Webhook URLが設定されていません。環境変数SLACK_WEBHOOK_URLを設定してください。");
    }
    
    // 3. 実行日を判定して対象日を決定
    const targetInfo = getTargetDateInfo();
    console.log(`対象日: ${targetInfo.label} (${targetInfo.dateString})`);
    
    // 4. 気象庁APIから天気予報を取得
    const weatherData = await getWeatherData();
    
    // 5. 最高気温をチェック
    const maxTempInfo = getMaxTemperature(weatherData, targetInfo);
    console.log(`最高気温: ${maxTempInfo.tempText} (数値: ${maxTempInfo.tempValue})`);
    
    // 6. 35℃超えの場合のみSlackに投稿
    if (maxTempInfo.tempValue > 35) {
      console.log("🔥 最高気温が35℃を超えています！Slackに投稿します。");
      
      // 天気予報メッセージを作成（猛暑警告付き）
      const message = createWeatherMessage(weatherData, targetInfo, maxTempInfo, true);
      console.log("作成されたメッセージ:", message);
      
      // Slackに投稿
      await postToSlack(message);
      
      console.log("=== 猛暑警告投稿完了 ===");
    } else {
      console.log(`✅ 最高気温は${maxTempInfo.tempText}で35℃以下のため、投稿をスキップします。`);
      console.log("=== 天気予報チェック完了（投稿なし） ===");
    }
    
  } catch (error) {
    console.error("エラーが発生しました:", error.toString());
    
    // エラー通知をSlackに送信
    const errorMessage = `⚠️ 天気予報Botでエラーが発生しました\n\`\`\`${error.toString()}\`\`\``;
    await postToSlack(errorMessage);
    
    throw error;
  }
}

/**
 * 実行期間チェック（7月〜9月のみ実行）
 * @returns {boolean} 実行期間内かどうか
 */
function isExecutionPeriod() {
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // getMonth()は0-11なので+1
  const currentYear = now.getFullYear();
  
  // 7月、8月、9月のみ実行
  const isValidMonth = currentMonth >= 7 && currentMonth <= 9;
  
  console.log(`現在: ${currentYear}年${currentMonth}月`);
  console.log(`実行期間チェック: ${isValidMonth ? "期間内（7-9月）" : "期間外"}`);
  
  return isValidMonth;
}

/**
 * 実行曜日に基づいて対象日の情報を取得
 * @returns {Object} 対象日の情報
 */
function getTargetDateInfo() {
  const today = new Date();
  const weekday = today.getDay(); // 0=日曜日, 1=月曜日, ..., 6=土曜日
  
  let targetDate, dateIndex, label;
  
  if (weekday === 5) { // 金曜日
    // 翌月曜日 (3日後)
    targetDate = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    dateIndex = 2; // 今日=0, 明日=1, 明後日=2
    label = "月曜日";
    
  } else if (weekday === 3) { // 水曜日
    // 翌日 (1日後)
    targetDate = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    dateIndex = 1; // 今日=0, 明日=1
    label = "明日";
    
  } else {
    // デフォルト（テスト用）
    targetDate = new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000);
    dateIndex = 1;
    label = "明日（テスト）";
  }
  
  const dateString = formatDate(targetDate, "M月d日(E)");
  
  return {
    date: targetDate,
    dateIndex: dateIndex,
    label: label,
    dateString: dateString
  };
}

/**
 * 日付をフォーマットする関数（Utilities.formatDateの代替）
 * @param {Date} date - フォーマットする日付
 * @param {string} format - フォーマット文字列
 * @returns {string} フォーマット済み日付文字列
 */
function formatDate(date, format) {
  const options = { 
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  };
  
  const formatter = new Intl.DateTimeFormat('ja-JP', options);
  const parts = formatter.formatToParts(date);
  
  const month = parts.find(part => part.type === 'month').value;
  const day = parts.find(part => part.type === 'day').value;
  const weekday = parts.find(part => part.type === 'weekday').value;
  
  return `${month}月${day}日(${weekday})`;
}

/**
 * 気象庁APIから天気予報データを取得
 * @returns {Object} 天気予報データ
 */
async function getWeatherData() {
  console.log("気象庁APIから天気予報を取得中...");
  
  const forecastUrl = `https://www.jma.go.jp/bosai/forecast/data/forecast/${CONFIG.AREA_CODE}.json`;
  const overviewUrl = `https://www.jma.go.jp/bosai/forecast/data/overview_forecast/${CONFIG.AREA_CODE}.json`;
  
  try {
    // 天気予報データを取得
    const forecastResponse = await fetch(forecastUrl);
    
    if (!forecastResponse.ok) {
      throw new Error(`気象庁API(forecast)エラー: ${forecastResponse.status}`);
    }
    
    // 概要データを取得
    const overviewResponse = await fetch(overviewUrl);
    
    if (!overviewResponse.ok) {
      throw new Error(`気象庁API(overview)エラー: ${overviewResponse.status}`);
    }
    
    const forecastData = await forecastResponse.json();
    const overviewData = await overviewResponse.json();
    
    console.log("天気予報データの取得が完了しました");
    
    return {
      forecast: forecastData,
      overview: overviewData
    };
    
  } catch (error) {
    console.error("気象庁APIの取得でエラーが発生:", error);
    throw new Error(`気象庁APIの取得に失敗しました: ${error.toString()}`);
  }
}

/**
 * 最高気温を取得して数値判定する
 * @param {Object} weatherData - 気象庁APIからのデータ
 * @param {Object} targetInfo - 対象日の情報
 * @returns {Object} 気温情報（文字列と数値）
 */
function getMaxTemperature(weatherData, targetInfo) {
  try {
    const forecastData = weatherData.forecast;
    
    // 気温データを取得
    let tempText = "データなし";
    let tempValue = -999; // 数値が取得できない場合のデフォルト値
    
    if (forecastData[0].timeSeries.length > 2) {
      const tempSeries = forecastData[0].timeSeries[2];
      
      for (const area of tempSeries.areas) {
        if (area.area.name === "東京" && area.temps && area.temps[targetInfo.dateIndex]) {
          const tempStr = area.temps[targetInfo.dateIndex];
          
          if (tempStr && tempStr !== "") {
            tempText = `${tempStr}℃`;
            tempValue = parseInt(tempStr, 10);
            
            // 数値変換の確認
            if (isNaN(tempValue)) {
              console.warn(`気温の数値変換に失敗: "${tempStr}"`);
              tempValue = -999;
            }
          }
          break;
        }
      }
    }
    
    console.log(`気温取得結果: テキスト="${tempText}", 数値=${tempValue}`);
    
    return {
      tempText: tempText,
      tempValue: tempValue
    };
    
  } catch (error) {
    console.error("気温取得でエラーが発生:", error);
    return {
      tempText: "取得エラー",
      tempValue: -999
    };
  }
}

/**
 * 天気予報メッセージを作成
 * @param {Object} weatherData - 気象庁APIからのデータ
 * @param {Object} targetInfo - 対象日の情報
 * @param {Object} maxTempInfo - 最高気温の情報
 * @param {boolean} isHeatWarning - 猛暑警告かどうか
 * @returns {string} Slack投稿用メッセージ
 */
function createWeatherMessage(weatherData, targetInfo, maxTempInfo, isHeatWarning = false) {
  try {
    const forecastData = weatherData.forecast;
    const overviewData = weatherData.overview;
    
    // 時系列データを取得
    const timeSeries = forecastData[0].timeSeries[0];
    
    // 東京地方のデータを検索
    let tokyoArea = null;
    for (const area of timeSeries.areas) {
      if (area.area.name === "東京地方") {
        tokyoArea = area;
        break;
      }
    }
    
    if (!tokyoArea) {
      throw new Error("東京地方のデータが見つかりませんでした");
    }
    
    // 対象日の天気を取得
    let weather = "データなし";
    if (tokyoArea.weathers && tokyoArea.weathers[targetInfo.dateIndex]) {
      weather = tokyoArea.weathers[targetInfo.dateIndex];
    }
    
    // 天気絵文字を選択
    const weatherEmoji = getWeatherEmoji(weather);
    
    // 発表時刻を整形
    let publishTime = "不明";
    if (overviewData.reportDatetime) {
      const reportDate = new Date(overviewData.reportDatetime);
      publishTime = formatDate(reportDate, "M月d日 H時mm分発表");
    }
    
    // 猛暑警告の場合は特別なメッセージを作成
    if (isHeatWarning) {
      const message = `🔥🚨 **猛暑警告** 🚨🔥

⚠️ **${targetInfo.label}（${targetInfo.dateString}）は猛暑が予想されます！** ⚠️

🌡️ **最高気温**: ${maxTempInfo.tempText} 
☁️ **天気**: ${weather}

35度を超える予報が発表されましたので、特段の事情がない限り在宅勤務を推奨します。
進捗会にて意向確認させていただきます。本日チーム会が開催されない場合、こちらのメッセージに返信するかたちで@山田さん宛へ在宅勤務の申し出を16時までに行ってください。

📍 **対象地域**: 東京都江東区
📅 **発表**: ${publishTime}

via 気象庁API`;

      return message;
    } else {
      // 通常の天気予報メッセージ
      const message = `${weatherEmoji} **${targetInfo.label}（${targetInfo.dateString}）の天気予報** ${weatherEmoji}

🌡️ **最高気温**: ${maxTempInfo.tempText}
☁️ **天気**: ${weather}

📍 **対象地域**: 東京都江東区
📅 **発表**: ${publishTime}

via 気象庁API`;

      return message;
    }
    
  } catch (error) {
    console.error("メッセージ作成でエラーが発生:", error);
    throw new Error(`メッセージの作成に失敗しました: ${error.toString()}`);
  }
}

/**
 * 天気の文字列から適切な絵文字を選択
 * @param {string} weatherText - 天気の文字列
 * @returns {string} 絵文字
 */
function getWeatherEmoji(weatherText) {
  if (!weatherText || weatherText === "データなし") {
    return "🌤️";
  }
  
  if (weatherText.includes("晴")) {
    if (weatherText.includes("雨")) {
      return "🌦️";
    } else if (weatherText.includes("曇") || weatherText.includes("くもり")) {
      return "⛅";
    } else {
      return "☀️";
    }
  } else if (weatherText.includes("曇") || weatherText.includes("くもり")) {
    if (weatherText.includes("雨")) {
      return "🌧️";
    } else {
      return "☁️";
    }
  } else if (weatherText.includes("雨")) {
    return "🌧️";
  } else if (weatherText.includes("雪")) {
    return "❄️";
  } else {
    return "🌤️";
  }
}

/**
 * Slackにメッセージを投稿
 * @param {string} message - 投稿するメッセージ
 */
async function postToSlack(message) {
  console.log("Slackに投稿中...");
  
  const payload = {
    text: message,
    username: CONFIG.BOT_NAME,
    icon_emoji: CONFIG.BOT_ICON
  };
  
  try {
    const response = await fetch(CONFIG.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`Slack投稿エラー: ${response.status} - ${responseText}`);
    }
    
    console.log("Slackへの投稿が完了しました");
    
  } catch (error) {
    console.error("Slack投稿でエラーが発生:", error);
    throw new Error(`Slackへの投稿に失敗しました: ${error.toString()}`);
  }
}

// ===== テスト用関数 =====

/**
 * テスト実行用関数（手動テスト時に使用）
 */
async function testRun() {
  console.log("=== テスト実行開始 ===");
  
  try {
    await main();
    console.log("=== テスト実行完了 ===");
  } catch (error) {
    console.error("=== テスト実行でエラー ===", error);
  }
}

/**
 * 期間チェックを無視したテスト実行（年中テスト可能）
 */
async function testRunIgnorePeriod() {
  console.log("=== 期間チェック無視テスト実行開始 ===");
  
  try {
    console.log("⚠️ 期間チェック（7-9月制限）を無視してテスト実行します");
    
    // 設定チェック
    if (!CONFIG.SLACK_WEBHOOK_URL) {
      throw new Error("Slack Webhook URLが設定されていません。環境変数SLACK_WEBHOOK_URLを設定してください。");
    }
    
    // 実行日を判定して対象日を決定
    const targetInfo = getTargetDateInfo();
    console.log(`対象日: ${targetInfo.label} (${targetInfo.dateString})`);
    
    // 気象庁APIから天気予報を取得
    const weatherData = await getWeatherData();
    
    // 最高気温をチェック
    const maxTempInfo = getMaxTemperature(weatherData, targetInfo);
    console.log(`最高気温: ${maxTempInfo.tempText} (数値: ${maxTempInfo.tempValue})`);
    
    // 35℃超えの場合のみSlackに投稿
    if (maxTempInfo.tempValue > 35) {
      console.log("🔥 最高気温が35℃を超えています！Slackに投稿します。");
      
      // 天気予報メッセージを作成（猛暑警告付き）
      const message = createWeatherMessage(weatherData, targetInfo, maxTempInfo, true);
      console.log("作成されたメッセージ:", message);
      
      // Slackに投稿
      await postToSlack(message);
      
      console.log("=== 猛暑警告投稿完了 ===");
    } else {
      console.log(`✅ 最高気温は${maxTempInfo.tempText}で35℃以下のため、投稿をスキップします。`);
      console.log("=== 天気予報チェック完了（投稿なし） ===");
    }
    
    console.log("=== 期間チェック無視テスト実行完了 ===");
    
  } catch (error) {
    console.error("=== 期間チェック無視テスト実行でエラー ===", error);
  }
}

/**
 * 気温チェック専用のテスト関数
 */
async function testTemperatureCheck() {
  console.log("=== 気温チェックテスト開始 ===");
  
  try {
    // 期間チェック
    if (!isExecutionPeriod()) {
      console.log("⚠️ 現在は実行期間外（7-9月以外）ですが、テストを続行します");
    }
    
    // 設定チェック
    if (!CONFIG.SLACK_WEBHOOK_URL) {
      throw new Error("Slack Webhook URLが設定されていません。");
    }
    
    // 対象日の情報を取得
    const targetInfo = getTargetDateInfo();
    console.log(`対象日: ${targetInfo.label} (${targetInfo.dateString})`);
    
    // 天気予報データを取得
    const weatherData = await getWeatherData();
    
    // 気温情報を取得・表示
    const maxTempInfo = getMaxTemperature(weatherData, targetInfo);
    console.log(`=== 気温情報 ===`);
    console.log(`表示用文字列: ${maxTempInfo.tempText}`);
    console.log(`数値: ${maxTempInfo.tempValue}`);
    console.log(`35℃超え判定: ${maxTempInfo.tempValue > 35 ? "はい（投稿対象）" : "いいえ（投稿なし）"}`);
    
    // メッセージ確認（投稿はしない）
    if (maxTempInfo.tempValue > 35) {
      const message = createWeatherMessage(weatherData, targetInfo, maxTempInfo, true);
      console.log("=== 投稿予定メッセージ ===");
      console.log(message);
    } else {
      console.log("35℃以下のため投稿はスキップされます");
    }
    
    console.log("=== 気温チェックテスト完了 ===");
    
  } catch (error) {
    console.error("=== 気温チェックテストでエラー ===", error);
  }
}

/**
 * 強制投稿テスト（35℃チェックと期間チェックを無視して投稿）
 */
async function testForcePost() {
  console.log("=== 強制投稿テスト開始 ===");
  
  try {
    console.log("⚠️ 期間チェック（7-9月制限）と35℃チェックを無視してテスト実行します");
    
    // 設定チェック
    if (!CONFIG.SLACK_WEBHOOK_URL) {
      throw new Error("Slack Webhook URLが設定されていません。");
    }
    
    // 対象日の情報を取得
    const targetInfo = getTargetDateInfo();
    console.log(`対象日: ${targetInfo.label} (${targetInfo.dateString})`);
    
    // 天気予報データを取得
    const weatherData = await getWeatherData();
    
    // 気温情報を取得
    const maxTempInfo = getMaxTemperature(weatherData, targetInfo);
    console.log(`気温: ${maxTempInfo.tempText}`);
    
    // 35℃チェックを無視して強制投稿
    const isHeatWarning = maxTempInfo.tempValue > 35;
    const message = createWeatherMessage(weatherData, targetInfo, maxTempInfo, isHeatWarning);
    
    console.log("=== 投稿メッセージ ===");
    console.log(message);
    
    // Slackに投稿
    await postToSlack(message);
    
    console.log("=== 強制投稿テスト完了 ===");
    
  } catch (error) {
    console.error("=== 強制投稿テストでエラー ===", error);
  }
}

/**
 * 実行期間チェックのテスト関数
 */
function testExecutionPeriod() {
  console.log("=== 実行期間チェックテスト開始 ===");
  
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  
  console.log(`現在の日時: ${currentYear}年${currentMonth}月${currentDate.getDate()}日`);
  
  const isValid = isExecutionPeriod();
  console.log(`実行期間判定: ${isValid ? "✅ 期間内（実行される）" : "❌ 期間外（実行されない）"}`);
  
  // 各月の判定結果を表示
  console.log("=== 月別実行可否 ===");
  for (let month = 1; month <= 12; month++) {
    const willExecute = month >= 7 && month <= 9;
    const status = willExecute ? "実行" : "スキップ";
    console.log(`${month}月: ${status}`);
  }
  
  console.log("=== 実行期間チェックテスト完了 ===");
}

// エントリーポイント
if (require.main === module) {
  main().catch(error => {
    console.error("メイン実行でエラーが発生:", error);
    process.exit(1);
  });
}

module.exports = {
  main,
  testRun,
  testRunIgnorePeriod,
  testTemperatureCheck,
  testForcePost,
  testExecutionPeriod
};