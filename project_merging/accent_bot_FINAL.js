const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

// --- НАСТРОЙКИ ---
const INPUT_FILE = './words_to_accent_TEST.txt';
const OUTPUT_FILE = './new_accents_TEST.json';
const CACHE_FILE = './accent_cache.json';
const API_URL = 'https://kalbu.vdu.lt/ajax-call';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';

// --- ПАРАМЕТРЫ ---
const WORDS_PER_BATCH = 30;
const REQUEST_DELAY_MS = 1500;
const BATCH_DELAY_MINUTES = 1;
const BATCHES_BEFORE_PAUSE = 100;

// ======================================================================
// === ИЗМЕНЕННАЯ ФУНКЦИЯ ЗАПРОСА ===
// ======================================================================

async function postBatchAccentRequest(nonce, words) {
    // --- ИЗМЕНЕНИЕ ЗДЕСЬ: join('\n') вместо join(' ') ---
    const textBlock = words.join('\n');
    
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

// --- НОВАЯ ФУНКЦИЯ РАЗБОРА ОТВЕТА ---
function parseBatchResponse(response, originalWords) {
    const results = {};
    originalWords.forEach(word => { results[word] = []; });

    try {
        if (typeof response.message !== 'string') return results;
        const innerJson = JSON.parse(response.message);

        // Ответ для text_accent имеет другую структуру
        if (!innerJson.textParts || !Array.isArray(innerJson.textParts)) return results;

        innerJson.textParts.forEach(part => {
            // Нас интересуют только части типа "WORD"
            if (part.type === "WORD") {
                const originalWord = part.string;
                const accentedWord = part.accented;
                
                // Проверяем, что это слово из нашего запроса и у него есть ударение
                if (results[originalWord] && accentedWord) {
                    // Используем Set для избежания дубликатов
                    const currentAccents = new Set(results[originalWord]);
                    currentAccents.add(accentedWord);
                    results[originalWord] = Array.from(currentAccents);
                }
            }
        });
        return results;
    } catch (error) {
        console.error("Ошибка при разборе ответа от API:", error);
        return results;
    }
}


// ======================================================================
// === ОСНОВНОЙ СКРИПТ (гибридный режим больше не нужен) ===
// ======================================================================
async function main() {
    console.log('--- Запуск ФИНАЛЬНОГО бота (исправленный пакетный режим) ---');

    if (!fs.existsSync(INPUT_FILE)) { console.error(`!!! ОШИБКА: Файл не найден: ${INPUT_FILE}`); return; }
    const allWords = fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean);
    const accentCache = loadCache();
    
    const wordsToProcess = [...new Set(allWords)].filter(word => !accentCache[word]);
    
    console.log(`Всего уникальных слов в файле: ${[...new Set(allWords)].length}`);
    console.log(`Загружено слов из кэша: ${Object.keys(accentCache).length}`);
    console.log(`Осталось обработать новых слов: ${wordsToProcess.length}`);

    if (wordsToProcess.length === 0) { console.log("Все слова обработаны."); saveFinalResults(accentCache); return; }

    process.on('SIGINT', () => { console.log("\nПрерывание. Сохраняю кэш..."); saveCache(accentCache); process.exit(0); });

    console.log("Запускаю браузер для получения сессии...");
    let nonce = await getNonceWithPuppeteer();
    let batchCounter = 0;

    const batches = [];
    for (let i = 0; i < wordsToProcess.length; i += WORDS_PER_BATCH) {
        batches.push(wordsToProcess.slice(i, i + WORDS_PER_BATCH));
    }

    for (const [index, batch] of batches.entries()) {
        if (batchCounter > 0 && batchCounter % BATCHES_BEFORE_PAUSE === 0) {
            saveCache(accentCache);
            console.log(`--- Обработано ${BATCHES_BEFORE_PAUSE} пачек. Пауза на ${BATCH_DELAY_MINUTES} мин... ---`);
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MINUTES * 60 * 1000));
            nonce = await getNonceWithPuppeteer();
        }
        
        console.log(`[Пачка ${index + 1}/${batches.length}] Отправляю ${batch.length} слов...`);

        try {
            batchCounter++;
            const response = await postBatchAccentRequest(nonce, batch);
            const parsedResults = parseBatchResponse(response, batch);
            
            for (const word in parsedResults) {
                accentCache[word] = parsedResults[word];
                const resultStr = parsedResults[word].length > 0 ? `✅ ${parsedResults[word].join(', ')}` : '❌';
                console.log(`  -> ${word}: ${resultStr}`);
            }
            await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

        } catch (error) {
            console.error(`     🔥 Ошибка при обработке пачки: ${error.message}`);
            batch.forEach(word => { accentCache[word] = []; });
        }
    }

    console.log(`\nОбработка завершена.`);
    saveCache(accentCache);
    saveFinalResults(accentCache);
}

// ... вспомогательные функции getNonce, save/loadCache, saveFinalResults ...
function saveFinalResults(data) { console.log(`Сохраняю итоговый результат в ${OUTPUT_FILE}...`); const allWordsFromFile = [...new Set(fs.readFileSync(INPUT_FILE, 'utf-8').split('\n').filter(Boolean))]; const finalResults = {}; for (const word of allWordsFromFile) { if (data[word]) { finalResults[word] = data[word]; } } fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalResults, null, 2)); console.log("✅ Финальный JSON-файл успешно сохранен."); }
async function getNonceWithPuppeteer() { console.log("   (Запускаю сессию в браузере...)"); let browser; try { browser = await puppeteer.launch({ headless: true }); const page = await browser.newPage(); await page.goto(PAGE_URL, { waitUntil: 'networkidle0', timeout: 60000 }); try { const acceptButtonSelector = 'a[onclick*="writeCookie"]'; await page.waitForSelector(acceptButtonSelector, { timeout: 5000 }); await page.click(acceptButtonSelector); await new Promise(resolve => setTimeout(resolve, 500)); } catch (e) {} const pageHtml = await page.content(); const match = pageHtml.match(/"nonce":"([^"]+)"/i); if (match && match[1]) { console.log("   (Nonce успешно получен!)"); return match[1]; } throw new Error('Не удалось найти nonce.'); } catch (error) { console.error("Ошибка в getNonceWithPuppeteer:", error.message); throw error; } finally { if (browser) await browser.close(); } }
function loadCache() { if (fs.existsSync(CACHE_FILE)) { try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8')); } catch (e) { return {}; } } return {}; }
function saveCache(cache) { fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2)); }

main().catch(console.error);