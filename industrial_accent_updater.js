const sqlite3 = require('sqlite3').verbose();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- НАСТРОЙКИ ---
const DB_PATH = './verbs.sqlite';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';
const API_URL = 'https://kalbu.vdu.lt/ajax-call';

// --- ПАРАМЕТРЫ "ВЕЖЛИВОСТИ" ---
const REQUEST_DELAY_MS = 2000;
const BATCH_SIZE = 150;
const BATCH_DELAY_MINUTES = 5;

// ======================================================================
// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (ФИНАЛЬНАЯ ВЕРСИЯ) ===
// ======================================================================

async function getNonceWithPuppeteer() {
    console.log("   (Запускаю бронированный браузер...)");
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });

        // --- ИСПРАВЛЕНИЕ №1: Правильный поиск и клик по баннеру ---
        try {
            console.log("   (Ищу баннер согласия на куки...)");
            // Этот селектор ищет ссылку <a>, у которой в атрибуте onclick есть текст 'writeCookie'
            const acceptButtonSelector = 'a[onclick*="writeCookie"]';
            await page.waitForSelector(acceptButtonSelector, { timeout: 5000 });
            await page.click(acceptButtonSelector);
            console.log("   (Баннер найден и нажат!)");
            // Даем странице мгновение на обработку клика
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
            console.log("   (Баннер согласия не найден или уже принят, продолжаю...)");
        }

        const pageHtml = await page.content();
        
        // --- ИСПРАВЛЕНИЕ №2: Регулярное выражение сделано нечувствительным к регистру (флаг 'i') ---
        const match = pageHtml.match(/"nonce":"([^"]+)"/i); 
        
        if (match && match[1]) {
            console.log("   (Nonce успешно получен!)");
            return match[1];
        }

        // Отладка на случай, если что-то все равно пойдет не так
        console.error("!!! КРИТИЧЕСКАЯ ОШИБКА: Nonce НЕ НАЙДЕН.");
        await page.screenshot({ path: 'debug_screenshot.png' });
        fs.writeFileSync('debug_page.html', pageHtml);
        console.error("!!! Сохранены новые debug-файлы. Изучите их.");
        throw new Error('Не удалось найти nonce.');

    } catch (error) {
        console.error("Ошибка в getNonceWithPuppeteer:", error.message);
        throw error;
    } finally {
        if (browser) {
            await browser.close();
            console.log("   (Браузер закрыт)");
        }
    }
}

async function postAccentRequest(nonce, word) {
    const fetch = require('node-fetch');
    const body = new URLSearchParams({ action: 'word_accent', nonce, word });
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': PAGE_URL,
            'Origin': 'https://kalbu.vdu.lt',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
        },
        body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/**
 * @param {object} apiResponse - Ответ от fetch в формате JSON.
 * @param {('2'|'3'|null)} [contextHint=null] - Подсказка о лице ('2' или '3').
 * @returns {string[]|null} - МАССИВ слов с ударениями или null.
 */
function extractVerbForm(apiResponse, contextHint = null) {
    try {
        if (typeof apiResponse.message !== 'string') return null;
        const innerJson = JSON.parse(apiResponse.message);
        if (!innerJson.accentInfo || !Array.isArray(innerJson.accentInfo)) return null;

        const allBlocks = innerJson.accentInfo;
        if (allBlocks.length === 0) return null;

        // --- НОВАЯ, БОЛЕЕ ГИБКАЯ ЛОГИКА ---

        // 1. Собираем ВСЕ варианты в один удобный массив
        const allVariants = [];
        allBlocks.forEach(block => {
            if (block.accented && block.information) {
                block.information.forEach((info, index) => {
                    if (block.accented[index]) {
                        allVariants.push({ word: block.accented[index], mi: info.mi || '' });
                    }
                });
            }
        });

        if (allVariants.length === 0) return null;

        // 2. Сначала пытаемся найти идеальный вариант среди ГЛАГОЛОВ
        const verbVariants = allVariants.filter(v => v.mi.includes('vksm.'));

        if (verbVariants.length > 0) {
            if (contextHint && verbVariants.length > 1) {
                const searchTag = `${contextHint} asm.`;
                const preferredVariant = verbVariants.find(v => v.mi.includes(searchTag));
                if (preferredVariant) return [preferredVariant.word]; // Возвращаем массив
            }
            // Если контекст не помог, берем все варианты из первого глагольного блока
            const firstVerbBlock = allBlocks.find(b => b.information?.some(i => i.mi?.includes('vksm.')));
            if (firstVerbBlock) return firstVerbBlock.accented;
        }

        // 3. ПЛАН Б: Если глаголов не найдено, но есть другие варианты (наш случай с "nėši")
        // Просто берем все варианты из самого первого блока, который нам прислали.
        if (allBlocks[0].accented && allBlocks[0].accented.length > 0) {
            return allBlocks[0].accented;
        }

        // Если ничего не подошло
        return null;

    } catch (error) {
        console.error("Ошибка при парсинге ответа от API:", error);
        return null;
    }
}

/**
 * Проверяет, содержит ли строка знаки ударения, используя Unicode-нормализацию.
 * @param {string} text - Входная строка.
 * @returns {boolean} - true, если ударение найдено.
 */
function hasAccent(text) {
    if (!text) return false;
    // NFD (Normalization Form D) разбирает 'ã' на 'a' + '̃'
    const normalizedText = text.normalize('NFD');
    // Ищем любой из трех "присоединяемых" знаков ударения
    return /[\u0300\u0301\u0303]/.test(normalizedText);
}

// ======================================================================
// === ОСНОВНОЙ СКРИПТ (без изменений) ===
// ======================================================================
async function main() {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
    console.log('Подключено к базе данных.');

    const query = `
    SELECT DISTINCT word, column_name FROM (
        SELECT infinitive AS word,  'infinitive'  AS column_name FROM verbs WHERE infinitive_accented IS NULL
        UNION
        SELECT present_3rd AS word, 'present_3rd' AS column_name FROM verbs WHERE present_3rd_accented IS NULL
        UNION
        SELECT past_3rd AS word,    'past_3rd'    AS column_name FROM verbs WHERE past_3rd_accented IS NULL
    ) WHERE word IS NOT NULL AND word != '' AND word NOT LIKE '% %'
`;

    const allWords = await new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    if (allWords.length === 0) {
        console.log("Все слова уже обработаны. Завершение работы.");
        db.close();
        return;
    }
    console.log(`Всего найдено ${allWords.length} уникальных необработанных словоформ для обновления.`);

    let nonce = await getNonceWithPuppeteer();

    for (let i = 0; i < allWords.length; i++) {
    if (i > 0 && i % BATCH_SIZE === 0) {
        // ...
    }

    const { word, column_name } = allWords[i];
    
    // --- НОВАЯ УМНАЯ ПРОВЕРКА ---
    if (hasAccent(word)) {
        console.log(`   ⏭️ Пропускаю [${i + 1}/${allWords.length}] (${column_name}) -> "${word}", так как оно уже содержит ударение.`);
        continue; // Немедленно переходим к следующему слову
    }
    // -----------------------------

    console.log(`[${i + 1}/${allWords.length}] (${column_name}) -> "${word}"`);


        try {
            const result = await postAccentRequest(nonce, word);
            const accentedWord = extractVerbForm(result);

            if (accentedWord) { // accentedWord - теперь это массив, например ["áidi", "aĩdi"]
    const accentedString = accentedWord.join(', '); // Превращаем в строку "áidi, aĩdi"
    const accented_column = `${column_name}_accented`;
    const updateQuery = `UPDATE verbs SET ${accented_column} = ? WHERE ${column_name} = ? AND (${accented_column} IS NULL OR ${accented_column} = '')`;
    
    await new Promise((resolve, reject) => {
        db.run(updateQuery, [accentedString, word], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
    console.log(`   ✅ Обновлено: "${accentedString}"`);
            } else {
                // --- НОВЫЙ БЛОК ---
    // Если ударение не найдено, ставим метку, чтобы больше не спрашивать
    console.log(`   ❌ Не удалось получить ударение. Ответ: ${JSON.stringify(result)}`);
    const accented_column = `${column_name}_accented`;
    const updateQuery = `UPDATE verbs SET ${accented_column} = '[NO_ACCENT_FOUND]' WHERE ${column_name} = ?`;
    await new Promise((resolve, reject) => {
        db.run(updateQuery, [word], (err) => err ? reject(err) : resolve());
    });
    console.log(`   📝 Помечено как ненайденное.`);
            }

        } catch (error) {
            console.error(`   🔥 Ошибка при обработке слова "${word}": ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));
    }

    console.log("Полная обработка завершена.");
    db.close();
}

main().catch(console.error);