const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// --- НАСТРОЙКИ ---
const DB_PATH = './verbs.sqlite';
const REPORT_FILE = './conflicts_report.txt';

// ======================================================================
// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
// ======================================================================
function removeAccents(text) {
    if (!text) return '';
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// --- НОВАЯ ЛОГИКА: Группы эквивалентных местоимений ---
const personGroups = {
    'G1': ['Aš'],
    'G2': ['Tu'],
    'G3': ['Jis/ji', 'Jie/jos'], // Jis/ji и Jie/jos считаются одной группой
    'G4': ['Mes'],
    'G5': ['Jūs']
};

// Функция для определения, к какой группе относится местоимение
function getPersonGroup(person) {
    for (const group in personGroups) {
        if (personGroups[group].includes(person)) {
            return group;
        }
    }
    return person; // Если местоимение не найдено в группах, используем его как есть
}

// ======================================================================
// === ОСНОВНОЙ СКРИПТ АНАЛИЗА ===
// ======================================================================
async function main() {
    const db = new sqlite3.Database(DB_PATH);
    console.log('Подключено к базе данных для анализа...');

    const query = "SELECT infinitive, conjugations FROM verbs WHERE conjugations IS NOT NULL AND conjugations != ''";
    const allRows = await new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => err ? reject(err) : resolve(rows));
    });

    console.log(`Найдено ${allRows.length} строк. Анализирую...`);
    
    // Карта для хранения всех использований каждого базового слова
    const wordMap = new Map();

    for (const row of allRows) {
        let conjugationsObj;
        try {
            conjugationsObj = JSON.parse(row.conjugations);
        } catch (e) { continue; }

        for (const tense in conjugationsObj) {
            for (const personForm of conjugationsObj[tense]) {
                const person = personForm.person;
                // --- ИСПРАВЛЕНИЕ №1: Собираем только уникальные базовые формы ---
                const uniqueBaseWords = new Set(personForm.forms.map(removeAccents).filter(Boolean));

                for (const baseWord of uniqueBaseWords) {
                    if (!wordMap.has(baseWord)) {
                        wordMap.set(baseWord, []);
                    }
                    
                    let contextEntry = wordMap.get(baseWord).find(
                        e => e.person === person && e.infinitive === row.infinitive
                    );

                    if (!contextEntry) {
                        contextEntry = {
                            person: person,
                            infinitive: row.infinitive,
                            originalWords: new Set()
                        };
                        wordMap.get(baseWord).push(contextEntry);
                    }
                    
                    personForm.forms.forEach(f => contextEntry.originalWords.add(f));
                }
            }
        }
    }
    
    console.log(`Анализ завершен. Найдено ${wordMap.size} уникальных базовых словоформ.`);
    console.log("Ищу конфликты...");

    const conflicts = [];
    for (const [baseWord, contexts] of wordMap.entries()) {
        // --- ИСПРАВЛЕНИЕ №2: Используем группы местоимений ---
        const uniqueGroups = new Set(contexts.map(c => getPersonGroup(c.person)));

        if (uniqueGroups.size > 1) {
            conflicts.push({ baseWord, contexts });
        }
    }

    if (conflicts.length === 0) {
        console.log("Поздравляю! Конфликтов не найдено.");
    } else {
        console.log(`Найдено ${conflicts.length} конфликтных слов. Генерирую отчет...`);
        let reportString = `ОТЧЕТ О КОНФЛИКТАХ СЛОВОФОРМ\n=================================\n\n`;
        
        for (const conflict of conflicts) {
            reportString += `--- Конфликт для слова: "${conflict.baseWord}" ---\n`;
            // --- ИСПРАВЛЕНИЕ №3: Выводим уникальные формы ---
            for (const context of conflict.contexts) {
                const words = Array.from(context.originalWords).join(', ');
                reportString += `  - Местоимение: ${context.person.padEnd(8)} | Слова: ${words.padEnd(30)} | (Инфинитив: ${context.infinitive})\n`;
            }
            reportString += `\n`;
        }
        
        fs.writeFileSync(REPORT_FILE, reportString);
        console.log(`Отчет успешно сохранен в файл: ${REPORT_FILE}`);
    }

    db.close();
}

main().catch(console.error);