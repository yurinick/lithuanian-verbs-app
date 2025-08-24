const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- НАСТРОЙКИ ---
const INPUT_FILE = './words_to_accent_TEST.txt'; // <-- Начнем с теста
const OUTPUT_FILE = './new_accents_TEST.json'; // <-- И тестового вывода
const CACHE_FILE = './accent_cache.json';
const API_URL = 'https://kalbu.vdu.lt/ajax-call';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';

// --- ПАРАМЕТРЫ ---
const WORDS_PER_BATCH = 30;
const REQUEST_DELAY_MS = 1500;
const BATCH_DELAY_MINUTES = 1;
const BATCHES_BEFORE_PAUSE = 100;

// ======================================================================
// === НОВЫЙ МЕТОД: ВЫПОЛНЕНИЕ ЗАПРОСА ВНУТРИ БРАУЗЕРА ===
// ======================================================================

async function postBatchWithPuppeteer(page, nonce, words) {
    const textBlock = words.join('\n');
    
    // page.evaluate выполняет код в контексте открытой страницы
    const result = await page.evaluate((apiUrl, nonce, text) => {
        const body = new URLSearchParams({ action: 'text_accent', nonce, text });
        // Используем fetch, который доступен внутри браузера
        return fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest',
            },
            body
        }).then(response => {
            if (!response.ok) {
                // Если ошибка, возвращаем текст ошибки
                return response.text().then(text => Promise.reject(`HTTP ${response.status}: ${text}`));
            }
            return response.json();
        });
    }, API_URL, nonce, textBlock);

    return result;
}

// ... (остальные вспомогательные функции, как parseBatchResponse, остаются)
function parseBatchResponse(response, originalWords) { /* ... тот же код ... */ }

// ======================================================================
// === ОСНОВНОЙ СКРИПТ (адаптирован под постоянную сессию браузера) ===
// ======================================================================
async function main() {
    console.log('--- Запуск ФИНАЛЬНОГО бота (режим Puppeteer) ---');

    if (!fs.existsSync(INPUT_FILE)) { console.error(`!!! ОШИБКА: Файл не найден: ${INPUT_FILE}`); return; }
    const allWords = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean);
    const accentCache = loadCache();
    
    const wordsToProcess = [...new Set(allWords)].filter(word => !accentCache[word]);
    
    console.log(`Всего слов: ${[...new Set(allWords)].length}, к обработке: ${wordsToProcess.length}`);
    if (wordsToProcess.length === 0) { console.log("Все слова обработаны."); saveFinalResults(accentCache); return; }

    process.on('SIGINT', () => { console.log("\nПрерывание..."); saveCache(accentCache); process.exit(0); });

    // --- ЗАПУСКАЕМ БРАУЗЕР ОДИН РАЗ И ДЕРЖИМ ЕГО ОТКРЫТЫМ ---
    console.log("Запускаю браузер...");
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    console.log(`Перехожу на страницу: ${PAGE_URL}`);
    await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    try { await page.click('a[onclick*="writeCookie"]', { timeout: 5000 }); } catch (e) {}

    let pageHtml = await page.content();
    let match = pageHtml.match(/"nonce":"([^"]+)"/i);
    if (!match || !match[1]) throw new Error("Не удалось получить Nonce!");
    let nonce = match[1];
    console.log("Nonce получен. Начинаю обработку пачек...");

    let batchCounter = 0;
    const batches = [];
    for (let i = 0; i < wordsToProcess.length; i += WORDS_PER_BATCH) {
        batches.push(wordsToProcess.slice(i, i + WORDS_PER_BATCH));
    }

    for (const [index, batch] of batches.entries()) {
        if (batchCounter > 0 && batchCounter % BATCHES_BEFORE_PAUSE === 0) {
            saveCache(accentCache);
            console.log(`--- Пауза на ${BATCH_DELAY_MINUTES} мин... ---`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MINUTES * 60 * 1000));
        }
        
        console.log(`[Пачка ${index + 1}/${batches.length}] Отправляю ${batch.length} слов...`);

        try {
            batchCounter++;
            const response = await postBatchWithPuppeteer(page, nonce, batch); // <-- Используем новый метод
            const parsedResults = parseBatchResponse(response, batch);
            
            for (const word in parsedResults) {
                accentCache[word] = parsedResults[word];
                console.log(`  -> ${word}: ${parsedResults[word].length > 0 ? '✅' : '❌'}`);
            }
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        } catch (error) {
            console.error(`     🔥 Ошибка при обработке пачки: ${error}`);
            console.log("     Пытаюсь обновить страницу и Nonce...");
            // Если ошибка, возможно, сессия устарела. Обновляем страницу.
            await page.reload({ waitUntil: "networkidle0" });
            pageHtml = await page.content();
            match = pageHtml.match(/"nonce":"([^"]+)"/i);
            if(match && match[1]) { nonce = match[1]; console.log("     Новый Nonce получен!"); }
            batch.forEach(word => { accentCache[word] = []; }); // Помечаем пачку как провальную, чтобы не повторять
        }
    }

    console.log(`\nОбработка завершена.`);
    await browser.close(); // <-- Закрываем браузер в самом конце
    saveCache(accentCache);
    saveFinalResults(accentCache);
}


// ... (остальные функции: parseBatchResponse, saveFinalResults, loadCache, saveCache)
function parseBatchResponse(response, originalWords) { const results = {}; originalWords.forEach(word => { results[word] = []; }); try { if (typeof response.message !== 'string') return results; const innerJson = JSON.parse(response.message); if (!innerJson.textParts || !Array.isArray(innerJson.textParts)) return results; innerJson.textParts.forEach(part => { if (part.type === "WORD") { const originalWord = part.string; const accentedWord = part.accented; if (results[originalWord] && accentedWord) { const currentAccents = new Set(results[originalWord]); currentAccents.add(accentedWord); results[originalWord] = Array.from(currentAccents); } } }); return results; } catch (error) { console.error("Ошибка при разборе ответа от API:", error); return results; } }
function saveFinalResults(data) { console.log(`Сохраняю итоговый результат в ${OUTPUT_FILE}...`); const allWordsFromFile = [...new Set(fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean))]; const finalResults = {}; for (const word of allWordsFromFile) { if (data[word] !== undefined) { finalResults[word] = data[word]; } } fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalResults, null, 2)); console.log("✅ Финальный JSON-файл успешно сохранен."); }
function loadCache() { if (fs.existsSync(CACHE_FILE)) { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } catch (e) { return {}; } } return {}; }
function saveCache(cache) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }


main().catch(console.error);