const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// --- НАСТРОЙКИ ---
const DB_PATH = './verbs.sqlite';
const CACHE_FILE = './accent_cache.json';

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function hasAccent(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    const normalizedText = text.normalize('NFD');
    return /[\u0300\u0301\u0303]/.test(normalizedText);
}

function removeAccents(text) {
    if (!text) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function loadCache() {
    if (fs.existsSync(CACHE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        } catch (e) { return {}; }
    }
    return {};
}

function saveCache(cache) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// ======================================================================
// === ОСНОВНОЙ СКРИПТ "АРХЕОЛОГ" ===
// ======================================================================
async function main() {
    const db = new sqlite3.Database(DB_PATH);
    console.log('Подключено к базе данных для построения кэша...');

    const accentCache = loadCache();
    console.log(`Загружено ${Object.keys(accentCache).length} слов из существующего кэша.`);

    // 1. Обработка простых колонок
    console.log("Анализирую простые колонки (infinitive, present_3rd, past_3rd)...");
    const simpleColumnsQuery = `
        SELECT infinitive, infinitive_accented,
               present_3rd, present_3rd_accented,
               past_3rd, past_3rd_accented
        FROM verbs
    `;
    const simpleRows = await new Promise((resolve, reject) => {
        db.all(simpleColumnsQuery, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    for (const row of simpleRows) {
        const pairs = [
            { original: row.infinitive, accented: row.infinitive_accented },
            { original: row.present_3rd, accented: row.present_3rd_accented },
            { original: row.past_3rd, accented: row.past_3rd_accented }
        ];
        for (const pair of pairs) {
            if (pair.original && pair.accented && pair.accented !== '[NO_ACCENT_FOUND]' && pair.accented !== '[ERROR]') {
                // accented может содержать несколько вариантов через запятую
                const accentedVariants = pair.accented.split(',').map(s => s.trim());
                accentCache[pair.original] = accentedVariants;
            }
        }
    }
    console.log(`После анализа простых колонок в кэше ${Object.keys(accentCache).length} слов.`);

    // 2. Обработка JSON-колонки conjugations
    console.log("Анализирую JSON-колонку 'conjugations' (это может занять время)...");
    const jsonQuery = "SELECT conjugations FROM verbs WHERE conjugations IS NOT NULL AND conjugations != ''";
    const jsonRows = await new Promise((resolve, reject) => {
        db.all(jsonQuery, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    for (const row of jsonRows) {
        let conjugationsObj;
        try {
            conjugationsObj = JSON.parse(row.conjugations);
        } catch (e) { continue; }

        for (const tense in conjugationsObj) {
            for (const personForm of conjugationsObj[tense]) {
                const forms = personForm.forms;
                const cleanForms = forms.filter(f => !hasAccent(f) && typeof f === 'string');
                const accentedForms = forms.filter(f => hasAccent(f) && typeof f === 'string');

                for (const cleanForm of cleanForms) {
                    const partners = accentedForms.filter(af => removeAccents(af) === cleanForm);
                    if (partners.length > 0) {
                        accentCache[cleanForm] = partners;
                    }
                }
            }
        }
    }

    console.log(`После анализа JSON в кэше стало ${Object.keys(accentCache).length} слов.`);

    // 3. Сохраняем финальный, объединенный кэш
    saveCache(accentCache);
    console.log(`Финальный кэш успешно построен и сохранен в ${CACHE_FILE}.`);

    db.close();
}

main().catch(console.error);