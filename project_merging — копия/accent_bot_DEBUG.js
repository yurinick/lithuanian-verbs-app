const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

// --- НАСТРОЙКИ ДЛЯ ОТЛАДКИ ---
const INPUT_FILE = './words_to_accent_TEST.txt'; // Работаем с тем же тестовым файлом
const OUTPUT_FILE = './new_accents_DEBUG.json'; // Пишем в отдельный файл
const CACHE_FILE = './accent_cache.json';
const API_URL = 'https://kalbu.vdu.lt/ajax-call';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';
const REQUEST_DELAY_MS = 1000;

// --- Вспомогательные функции (без изменений) ---
// ... (getNonceWithPuppeteer, postAccentRequest, extractVerbForm, loadCache, saveCache)

// ======================================================================
// === ОТЛАДОЧНЫЙ СКРИПТ (обработка по одному слову) ===
// ======================================================================
async function main() {
    console.log('--- Запуск ОТЛАДОЧНОГО бота (режим "одно слово за раз") ---');
    
    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`!!! ОШИБКА: Входной файл не найден: ${INPUT_FILE}`);
        return;
    }
    const allWords = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean);
    const accentCache = loadCache();
    
    const wordsToProcess = [...new Set(allWords)].filter(word => !accentCache[word]);
    
    console.log(`Всего уникальных слов в файле: ${[...new Set(allWords)].length}`);
    console.log(`Осталось обработать (без учета кэша): ${wordsToProcess.length}`);

    if (wordsToProcess.length === 0) {
        console.log("Все слова уже в кэше. Завершаю.");
        return;
    }
    
    console.log("Запускаю браузер для получения сессии...");
    let nonce = await getNonceWithPuppeteer();

    // Обрабатываем слова ПО ОДНОМУ
    for (const [index, word] of wordsToProcess.entries()) {
        console.log(`[Слово ${index + 1}/${wordsToProcess.length}] Отправляю: "${word}"`);

        try {
            const result = await postAccentRequest(nonce, word); // Используем одиночный запрос
            const accentedWords = extractVerbForm(result);
            
            if (accentedWords && accentedWords.length > 0) {
                accentCache[word] = accentedWords;
                console.log(`     ✅ Получено: "${accentedWords.join(', ')}"`);
            } else {
                accentCache[word] = [];
                console.log(`     ❌ Не найдено.`);
            }
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        } catch (error) {
            console.error(`     🔥🔥🔥 КРИТИЧЕСКАЯ ОШИБКА НА СЛОВЕ: "${word}" 🔥🔥🔥`);
            console.error(`     🔥 Сообщение: ${error.message}`);
            console.log("     Прерываю работу. Последнее слово перед ошибкой - наш виновник.");
            saveCache(accentCache); // Сохраняем прогресс перед выходом
            return; // Завершаем скрипт
        }
    }

    console.log(`\nОтладка завершена успешно. Все слова обработаны.`);
    saveCache(accentCache);
}

// ... (здесь должны быть все вспомогательные функции из предыдущего скрипта)
async function getNonceWithPuppeteer() { /* ... */ }
async function postAccentRequest(nonce, word) { /* ... */ }
function extractVerbForm(apiResponse) { /* ... */ }
function loadCache() { /* ... */ }
function saveCache(cache) { /* ... */ }

// ... (скопируйте их сюда из accent_bot_batch.js)
async function getNonceWithPuppeteer() {
    console.log("   (Запускаю сессию в браузере...)");
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
        try {
            const acceptButtonSelector = 'a[onclick*="writeCookie"]';
            await page.waitForSelector(acceptButtonSelector, { timeout: 5000 });
            await page.click(acceptButtonSelector);
            await new Promise(resolve => setTimeout(resolve, 500));
        } catch (e) {}
        const pageHtml = await page.content();
        const match = pageHtml.match(/"nonce":"([^"]+)"/i); 
        if (match && match[1]) {
            console.log("   (Nonce успешно получен!)");
            return match[1];
        }
        throw new Error('Не удалось найти nonce.');
    } catch (error) {
        console.error("Ошибка в getNonceWithPuppeteer:", error.message);
        throw error;
    } finally {
        if (browser) await browser.close();
    }
}
async function postAccentRequest(nonce, word) {
    const body = new URLSearchParams({ action: 'word_accent', nonce, word });
    const response = await fetch(API_URL, {
        method: 'POST', headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest',
            'Referer': PAGE_URL, 'Origin': 'https://kalbu.vdu.lt',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }, body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}
function extractVerbForm(apiResponse) {
    try {
        if (typeof apiResponse.message !== 'string') return null;
        const innerJson = JSON.parse(apiResponse.message);
        if (!innerJson.accentInfo || !Array.isArray(innerJson.accentInfo)) return null;
        const allBlocks = innerJson.accentInfo;
        if (allBlocks.length === 0) return null;
        const verbVariants = [];
        allBlocks.forEach(block => {
            if (block.accented) {
                verbVariants.push(...block.accented);
            }
        });
        return verbVariants.length > 0 ? verbVariants : null;
    } catch (error) {
        return null;
    }
}
function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } 
        catch (e) { return {}; }
    }
    return {};
}
function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

main().catch(console.error);