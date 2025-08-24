const sqlite3 = require('sqlite3').verbose();
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const fetch = require('node-fetch');

puppeteer.use(StealthPlugin());

// --- НАСТРОЙКИ ---
const DB_PATH = './verbs.sqlite';
const API_URL = 'https://kalbu.vdu.lt/ajax-call';
const PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/';
const CACHE_FILE = './accent_cache.json';

// --- ПАРАМЕТРЫ "ВЕЖЛИВОСТИ" ---
const REQUEST_DELAY_MS = 1500;
const BATCH_SIZE = 150;
const BATCH_DELAY_MINUTES = 5;

// ======================================================================
// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
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

function hasAccent(text) {
    if (typeof text !== 'string' || text.length === 0) {
        return false;
    }
    const normalizedText = text.normalize('NFD');
    return /[\u0300\u0301\u0303]/.test(normalizedText);
}

function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        } catch (e) {
            console.error("Ошибка чтения файла кэша, начинаем с пустого.", e);
            return {};
        }
    }
    return {};
}

function saveCache(cache) {
    console.log(`\nСохраняю ${Object.keys(cache).length} слов в кэш...`);
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    console.log("Кэш успешно сохранен.");
}

// ======================================================================
// === ОБРАБОТЧИК ПРЕРЫВАНИЯ (CTRL+C) ===
// ======================================================================
function setupExitHandlers(db, cache) {
    const handler = () => {
        console.log("\nПолучен сигнал прерывания. Завершаю работу и сохраняю прогресс...");
        saveCache(cache);
        if (db) db.close();
        process.exit(0);
    };
    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
}

// ======================================================================
// === ОСНОВНОЙ СКРИПТ ===
// ======================================================================
async function main() {
    const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE);
    console.log('Подключено к базе данных.');
    
    const accentCache = loadCache();
    console.log(`Загружено ${Object.keys(accentCache).length} слов из кэша.`);

    setupExitHandlers(db, accentCache); // <--- Включаем "автосохранение"

    const query = "SELECT id_num, conjugations FROM verbs WHERE conjugations IS NOT NULL AND conjugations != ''";
    const allRows = await new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    if (allRows.length === 0) {
        console.log("Не найдено строк.");
        db.close();
        return;
    }
    console.log(`Найдено ${allRows.length} строк для обработки.`);

    let nonce = await getNonceWithPuppeteer();
    let updatesMade = 0;
    let requestsInBatch = 0;

    for (const [rowIndex, row] of allRows.entries()) {
        let conjugationsObj;
        try {
            conjugationsObj = JSON.parse(row.conjugations);
        } catch (e) {
            console.error(`[${row.id_num}] Ошибка парсинга JSON, пропуск.`);
            continue;
        }
        
        let needsUpdate = false;
        console.log(`[${rowIndex + 1}/${allRows.length}] Обрабатываю глагол ID: ${row.id_num}`);

        for (const tense in conjugationsObj) {
            for (const personForm of conjugationsObj[tense]) {
                const originalForms = personForm.forms;
                const newForms = new Set(originalForms);

                const formsToProcess = originalForms.filter(form => {
                    if (typeof form !== 'string' || form.length === 0) return false;
                    return !hasAccent(form) && !accentCache[form];
                });

                for (const form of formsToProcess) {
                    if (requestsInBatch > 0 && requestsInBatch % BATCH_SIZE === 0) {
                        saveCache(accentCache);
                        console.log(`--- Обработана пачка из ${BATCH_SIZE} запросов. "Засыпаю" на ${BATCH_DELAY_MINUTES} минут... ---`);
                        await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MINUTES * 60 * 1000));
                        nonce = await getNonceWithPuppeteer();
                    }

                    console.log(`  -> Запрос для слова: "${form}"`);

                    try {
                        requestsInBatch++;
                        const result = await postAccentRequest(nonce, form);
                        const accentedWords = extractVerbForm(result);
                        
                        if (accentedWords && accentedWords.length > 0) {
                            accentedWords.forEach(variant => newForms.add(variant));
                            accentCache[form] = accentedWords;
                            needsUpdate = true;
                            console.log(`     ✅ Получено: "${accentedWords.join(', ')}"`);
                        } else {
                            accentCache[form] = '[NO_ACCENT_FOUND]';
                            console.log(`     ❌ Не найдено.`);
                        }
                        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY_MS));

                    } catch (error) {
                        console.error(`     🔥 Ошибка: ${error.message}`);
                        accentCache[form] = '[ERROR]';
                    }
                }
                personForm.forms = Array.from(newForms);
            }
        }

        if (needsUpdate) {
            const updatedJsonString = JSON.stringify(conjugationsObj);
            const updateQuery = "UPDATE verbs SET conjugations = ? WHERE id_num = ?";
            await new Promise((resolve, reject) => {
                db.run(updateQuery, [updatedJsonString, row.id_num], (err) => err ? reject(err) : resolve());
            });
            updatesMade++;
            console.log(`   -> ✅ JSON для глагола ID ${row.id_num} обновлен в базе.`);
        }
    }

    console.log(`\nОбработка завершена. Всего обновлено строк: ${updatesMade}.`);
    saveCache(accentCache);
    console.log("Финальный кэш сохранен.");
    db.close();
}

main().catch(console.error);