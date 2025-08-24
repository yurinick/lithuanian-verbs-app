const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// --- НАСТРОЙКИ ---
const DB_PATH = './verbs.sqlite';
const REPORT_FILE = './duplicate_accents_report.txt';

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
function removeAccents(text) {
    if (typeof text !== 'string' || text.length === 0) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function hasAccent(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    const normalizedText = text.normalize('NFD');
    return /[\u0300\u0301\u0303]/.test(normalizedText);
}

// ======================================================================
// === ОСНОВНОЙ СКРИПТ-ФИЛЬТР (ФИНАЛЬНАЯ ЛОГИКА) ===
// ======================================================================
async function main() {
    const db = new sqlite3.Database(DB_PATH);
    console.log('Подключено к базе данных для поиска дубликатов ударений...');

    const query = "SELECT id_num, infinitive, conjugations FROM verbs WHERE conjugations IS NOT NULL AND conjugations != ''";
    const allRows = await new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    console.log(`Найдено ${allRows.length} строк. Анализирую JSON...`);
    
    const conflicts = [];

    for (const row of allRows) {
        let conjugationsObj;
        try {
            conjugationsObj = JSON.parse(row.conjugations);
        } catch (e) { continue; }

        for (const tense in conjugationsObj) {
            for (const personForm of conjugationsObj[tense]) {
                const forms = personForm.forms;
                if (!Array.isArray(forms) || forms.length <= 1) continue;

                const baseForms = new Set(forms.map(f => removeAccents(f)).filter(Boolean));

                for (const baseForm of baseForms) {
                    const allVariants = forms.filter(f => removeAccents(f) === baseForm);
                    
                    // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ ---
                    // Отбираем только те варианты, которые ДЕЙСТВИТЕЛЬНО содержат ударение
                    const accentedVariants = allVariants.filter(v => hasAccent(v));

                    // Нормализуем все варианты к единой форме (NFC) и кладем в Set, чтобы найти уникальные
const uniqueNormalizedVariants = new Set(
    accentedVariants.map(v => v.normalize('NFC'))
);
                    // Регистрируем конфликт, только если есть БОЛЕЕ ОДНОГО УНИКАЛЬНОГО варианта
if (uniqueNormalizedVariants.size > 1) {
    conflicts.push({
        infinitive: row.infinitive,
        person: personForm.person,
        baseForm: baseForm,
        // В отчет записываем оригинальные, "грязные" варианты для анализа
        variants: accentedVariants 
    });
}
                }
            }
        }
    }

    if (conflicts.length === 0) {
        console.log("Поздравляю! Конфликтов с несколькими вариантами ударений не найдено.");
    } else {
        console.log(`Найдено ${conflicts.length} случаев. Генерирую отчет...`);
        let reportString = `ОТЧЕТ О СЛОВОФОРМАХ С НЕСКОЛЬКИМИ ВАРИАНТАМИ УДАРЕНИЙ\n=========================================================\n\n`;
        
        const groupedConflicts = conflicts.reduce((acc, curr) => {
            const key = `${curr.infinitive}-${curr.baseForm}-${curr.person}`;
            if (!acc[key]) {
                acc[key] = { ...curr, variants: new Set() };
            }
            curr.variants.forEach(v => acc[key].variants.add(v));
            return acc;
        }, {});

        let conflictCounter = 1;
        for (const key in groupedConflicts) {
    const conflict = groupedConflicts[key];
    
    // Собираем все части в одну строку
    const reportLine = `№${String(conflictCounter).padEnd(4)} | Инфинитив: ${conflict.infinitive.padEnd(20)} | Форма: "${conflict.baseForm}" (${conflict.person.padEnd(8)}) | Варианты: ${Array.from(conflict.variants).join(' / ')}\n`;
    
    reportString += reportLine;
    conflictCounter++;
}
        
        fs.writeFileSync(REPORT_FILE, reportString);
        console.log(`Отчет успешно сохранен в файл: ${REPORT_FILE}`);
    }

    db.close();
}

main().catch(console.error);