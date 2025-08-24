const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// --- НАСТРОЙКИ ---
const INPUT_FILE = './words_to_accent_TEST.txt';
const OUTPUT_FILE = './new_accents_TEST.json';
const CACHE_FILE = './accent_cache.json';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';

// --- ПАРАМЕТРЫ ---
const WORDS_PER_BATCH = 30;
const REQUEST_DELAY_MS = 2000; // Немного увеличим, т.к. UI медленнее API

// ======================================================================
// === НОВЫЙ МЕТОД: ПОЛНАЯ СИМУЛЯЦИЯ ПОЛЬЗОВАТЕЛЯ ===
// ======================================================================

async function processBatchViaUI(page, words) {
    const textBlock = words.join('\n');

    // 1. Находим и очищаем текстовое поле
    const textareaSelector = 'textarea[name="text"]';
    await page.waitForSelector(textareaSelector);
    // Очистка поля (evaluate используется для прямого манипулирования DOM)
    await page.evaluate(selector => { document.querySelector(selector).value = ''; }, textareaSelector);

    // 2. Впечатываем наш текст
    await page.type(textareaSelector, textBlock, { delay: 5 }); // Небольшая задержка для реализма

    // 3. Находим и нажимаем кнопку
    const buttonSelector = 'button.button-accent';
    await page.waitForSelector(buttonSelector);
    await page.click(buttonSelector);

    // 4. Ждем появления результата
    const resultSelector = 'div#text-accent-result';
    await page.waitForSelector(resultSelector, { timeout: 30000 }); // Ждем до 30 секунд

    // 5. Извлекаем результат прямо со страницы
    const resultsHtml = await page.evaluate(selector => {
        const resultDiv = document.querySelector(selector);
        return resultDiv ? resultDiv.innerHTML : '';
    }, resultSelector);
    
    // 6. Парсим HTML-ответ, чтобы извлечь слова
    const results = {};
    words.forEach(w => results[w] = []); // Инициализация

    const regex = /<span class="accent-word"[^>]*>([\s\S]*?)<\/span>/g;
    let match;
    while ((match = regex.exec(resultsHtml)) !== null) {
        // Внутри span могут быть вложенные теги, очищаем их
        const accentedWord = match[1].replace(/<[^>]+>/g, '').trim();
        // Находим, какому исходному слову он соответствует (убрав ударения)
        const originalWord = accentedWord.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
        
        if (results[originalWord]) {
            results[originalWord].push(accentedWord);
        }
    }
    
    return results;
}

// ======================================================================
// === ОСНОВНОЙ СКРИПТ (адаптирован под UI симуляцию) ===
// ======================================================================
async function main() {
    console.log('--- Запуск ФИНАЛЬНОГО бота (режим СИМУЛЯЦИИ ПОЛЬЗОВАТЕЛЯ) ---');

    if (!fs.existsSync(INPUT_FILE)) { console.error(`!!! ОШИБКА: Файл не найден: ${INPUT_FILE}`); return; }
    const allWords = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean);
    const accentCache = loadCache();
    
    const wordsToProcess = [...new Set(allWords)].filter(word => !accentCache[word]);
    
    console.log(`Всего слов: ${[...new Set(allWords)].length}, к обработке: ${wordsToProcess.length}`);
    if (wordsToProcess.length === 0) { console.log("Все слова обработаны."); saveFinalResults(accentCache); return; }

    process.on('SIGINT', () => { console.log("\nПрерывание..."); saveCache(accentCache); process.exit(0); });

    // --- ЗАПУСКАЕМ БРАУЗЕР ОДИН РАЗ И ДЕРЖИМ ЕГО ОТКРЫТЫМ ---
    console.log("Запускаю браузер...");
    const browser = await puppeteer.launch({ headless: true }); // headless: false для отладки
    const page = await browser.newPage();
    console.log(`Перехожу на страницу: ${PAGE_URL}`);
    await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 });
    try { await page.click('a[onclick*="writeCookie"]', { timeout: 5000 }); } catch (e) {}
    console.log("Страница загружена. Начинаю обработку пачек...");

    const batches = [];
    for (let i = 0; i < wordsToProcess.length; i += WORDS_PER_BATCH) {
        batches.push(wordsToProcess.slice(i, i + WORDS_PER_BATCH));
    }

    for (const [index, batch] of batches.entries()) {
        console.log(`[Пачка ${index + 1}/${batches.length}] Симулирую ввод ${batch.length} слов...`);
        try {
            const parsedResults = await processBatchViaUI(page, batch); // <-- Используем новый метод
            for (const word in parsedResults) {
                accentCache[word] = parsedResults[word];
                console.log(`  -> ${word}: ${parsedResults[word].length > 0 ? '✅' : '❌'}`);
            }
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        } catch (error) {
            console.error(`     🔥 Ошибка при симуляции для пачки: ${error.message}`);
            batch.forEach(word => { accentCache[word] = []; });
        }
    }

    console.log(`\nОбработка завершена.`);
    await browser.close();
    saveCache(accentCache);
    saveFinalResults(accentCache);
}


// ... (остальные функции: saveFinalResults, loadCache, saveCache)
function saveFinalResults(data) { console.log(`Сохраняю итоговый результат в ${OUTPUT_FILE}...`); const allWordsFromFile = [...new Set(fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean))]; const finalResults = {}; for (const word of allWordsFromFile) { if (data[word] !== undefined) { finalResults[word] = data[word]; } } fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalResults, null, 2)); console.log("✅ Финальный JSON-файл успешно сохранен."); }
function loadCache() { if (fs.existsSync(CACHE_FILE)) { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } catch (e) { return {}; } } return {}; }
function saveCache(cache) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }


main().catch(console.error);