const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

// --- НОВЫЕ НАСТРОЙКИ ---
const INPUT_FILE = './words_to_accent.txt';
const OUTPUT_FILE = './new_accents.json';
const CACHE_FILE = './accent_cache.json';
const API_URL = 'https://kalbu.vdu.lt/ajax-call';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';

// --- ПАРАМЕТРЫ ПРОИЗВОДИТЕЛЬНОСТИ И "ВЕЖЛИВОСТИ" ---
const WORDS_PER_BATCH = 20;    // <--- СКОЛЬКО СЛОВ ОТПРАВЛЯТЬ ЗА РАЗ (можно увеличить до 30-40)
const REQUEST_DELAY_MS = 2000; // Пауза между пачками
const BATCH_DELAY_MINUTES = 1; // Пауза после 100 пачек
const BATCHES_BEFORE_PAUSE = 100;

// --- Вспомогательные функции ---
// ... (getNonceWithPuppeteer, loadCache, saveCache)

// ======================================================================
// === НОВАЯ ЛОГИКА ПАКЕТНОЙ ОБРАБОТКИ ===
// ======================================================================

async function postBatchAccentRequest(nonce, words) {
    // Объединяем слова через пробел, как это делает сайт
    const textBlock = words.join(' ');
    const body = new URLSearchParams({ action: 'text_accent', nonce, text: textBlock });
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest', 'Referer': PAGE_URL, 'Origin': 'https://kalbu.vdu.lt',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        body
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

function parseBatchResponse(response, originalWords) {
    const results = {};
    originalWords.forEach(word => { results[word] = []; }); // Инициализируем

    try {
        if (typeof response.message !== 'string') return results;
        const innerJson = JSON.parse(response.message);

        if (!innerJson.accentInfo || !Array.isArray(innerJson.accentInfo)) return results;

        innerJson.accentInfo.forEach(block => {
            const originalWord = block.word;
            if (!results[originalWord]) return; // Пропускаем, если слово не из нашего запроса

            const verbForms = [];
            // Сначала ищем явные глаголы
            if (block.information && Array.isArray(block.information)) {
                block.information.forEach((info, index) => {
                    if (info.mi && info.mi.includes('vksm.') && block.accented[index]) {
                        verbForms.push(block.accented[index]);
                    }
                });
            }

            // Если нашли глагольные формы, используем только их
            if (verbForms.length > 0) {
                results[originalWord] = [...new Set([...results[originalWord], ...verbForms])];
            } else if (block.accented && block.accented.length > 0) {
                // Если глаголов нет, но есть хоть какие-то варианты, берем их (План Б)
                results[originalWord] = [...new Set([...results[originalWord], ...block.accented])];
            }
        });

        return results;

    } catch (error) {
        console.error("Ошибка при разборе ответа от API:", error);
        return results;
    }
}


// ======================================================================
// === ОСНОВНОЙ СКРИПТ (с пакетной обработкой) ===
// ======================================================================
async function main() {
    console.log('--- Запуск БЫСТРОГО бота для расстановки ударений (пакетный режим) ---');

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`!!! ОШИБКА: Входной файл не найден: ${INPUT_FILE}`);
        return;
    }
    const allWords = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean);
    const accentCache = loadCache();
    
    const wordsToProcess = [...new Set(allWords)].filter(word => !accentCache[word]);
    
    console.log(`Всего уникальных слов в файле: ${[...new Set(allWords)].length}`);
    console.log(`Загружено слов из кэша: ${Object.keys(accentCache).length}`);
    console.log(`Осталось обработать новых слов: ${wordsToProcess.length}`);

    if (wordsToProcess.length === 0) {
        console.log("Все слова уже обработаны. Завершаю работу.");
        saveFinalResults(accentCache);
        return;
    }

    process.on('SIGINT', () => {
        console.log("\nПолучен сигнал прерывания. Сохраняю кэш и выхожу...");
        saveCache(accentCache);
        process.exit(0);
    });

    console.log("Запускаю браузер для получения сессии...");
    let nonce = await getNonceWithPuppeteer();
    let batchCounter = 0;

    // Делим слова на пачки
    const batches = [];
    for (let i = 0; i < wordsToProcess.length; i += WORDS_PER_BATCH) {
        batches.push(wordsToProcess.slice(i, i + WORDS_PER_BATCH));
    }

    // Обрабатываем пачки
    for (const [index, batch] of batches.entries()) {
        if (batchCounter > 0 && batchCounter % BATCHES_BEFORE_PAUSE === 0) {
            saveCache(accentCache);
            console.log(`--- Обработано ${BATCHES_BEFORE_PAUSE} пачек. Пауза на ${BATCH_DELAY_MINUTES} мин... ---`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MINUTES * 60 * 1000));
            nonce = await getNonceWithPuppeteer(); // Обновляем nonce на всякий случай
        }
        
        console.log(`[Пачка ${index + 1}/${batches.length}] Отправляю ${batch.length} слов...`);

        try {
            batchCounter++;
            const response = await postBatchAccentRequest(nonce, batch);
            const parsedResults = parseBatchResponse(response, batch);
            
            // Обновляем кэш результатами
            for (const word in parsedResults) {
                accentCache[word] = parsedResults[word];
                const resultStr = parsedResults[word].length > 0 ? `✅ ${parsedResults[word].join(', ')}` : '❌ Не найдено';
                console.log(`  -> ${word}: ${resultStr}`);
            }

            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        } catch (error) {
            console.error(`     🔥 Ошибка при обработке пачки: ${error.message}`);
            // В случае ошибки помечаем всю пачку как "необработанную" в кэше
            batch.forEach(word => { accentCache[word] = []; });
            if (error.message.includes('HTTP 500')) {
                 console.log("     Похоже, nonce устарел. Получаю новый...");
                 nonce = await getNonceWithPuppeteer();
            }
        }
    }

    console.log(`\nОбработка завершена.`);
    saveCache(accentCache);
    saveFinalResults(accentCache);
}

function saveFinalResults(data) {
    // Эта функция остается без изменений
    console.log(`Сохраняю итоговый результат в ${OUTPUT_FILE}...`);
    const allWordsFromFile = [...new Set(fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean))];
    const finalResults = {};
    for (const word of allWordsFromFile) {
        if (data[word]) {
            finalResults[word] = data[word];
        }
    }
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalResults, null, 2));
    console.log("✅ Финальный JSON-файл успешно сохранен.");
}

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (копипаст, без изменений) ---
// ...
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