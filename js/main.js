import { createSQLiteHTTPPool } from "sqlite-wasm-http";

window.addEventListener('load', async () => {
    
    let pool;
    const DB_URL = 'https://yurinick.github.io/lithuanian-verbs-app/verbs.sqlite';
    const TENSE_TRANSLATIONS = {
        "Present tense": "Настоящее время", "Past tense": "Прошедшее время",
        "Future tense": "Будущее время", "Conditional mood": "Сослагательное наклонение",
        "Imperative mood": "Повелительное наклонение", "Past freq. tense": "Прошедшее многократное время"
    };
    const mainTableHeaders = ['id_num', 'p_val', 'hash_val', 'infinitive', 'present_3rd', 'past_3rd', 'question', 'translation'];

    // DOM elements
    const searchInput = document.getElementById('searchInput');
    const tableHead = document.getElementById('table-head');
    const tableBody = document.getElementById('table-body');
    const loadingIndicator = document.getElementById('loading-indicator');
    const noResultsMessage = document.getElementById('no-results-message');
    const errorContainer = document.getElementById('error-container');
    const recordCount = document.getElementById('record-count');
    const modalOverlay = document.getElementById('modal-overlay');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    const modalCloseButton = document.getElementById('modal-close-button');
    const showError = (message) => { 
        if (errorContainer) {
            errorContainer.textContent = message; 
            errorContainer.classList.remove('hidden'); 
        }
    };

    // Telegram
    try {
        const tg = window.Telegram.WebApp;
        tg.ready();
        const applyTheme = () => document.body.classList.toggle('dark', tg.colorScheme === 'dark');
        tg.onEvent('themeChanged', applyTheme);
        applyTheme();
        if (tg.MainButton) {
            tg.MainButton.setText('Закрыть').setTextColor('#ffffff').setColor('#0ea5e9').show();
            tg.onEvent('mainButtonClicked', () => tg.close());
        }
    } catch (e) { console.log("Not in Telegram environment."); }

    
    async function startApp() {
        try {
            if (loadingIndicator) loadingIndicator.textContent = 'Connecting to database...';
            
            pool = await createSQLiteHTTPPool({
                httpOptions: {
                    url: DB_URL,
                    workerUrl: new URL("./sqlite.worker.js", import.meta.url).toString(),
                    wasmUrl: new URL("./sql-wasm.wasm", import.meta.url).toString()
                }
            });

            await pool.open(DB_URL);

            if (loadingIndicator) loadingIndicator.textContent = 'Loading initial data...';
            const initialData = await pool.exec('SELECT * FROM verbs ORDER BY id_num LIMIT 500;');
            renderTable(initialData);

        } catch (e) {
            console.error('Database initialization failed:', e);
            showError('Failed to initialize database. Please check console for details.');
        } finally {
            if (loadingIndicator) loadingIndicator.classList.add('hidden');
        }
    }
    
    // ... all other functions
    let debounceTimer;
    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(async () => {
                if (!pool) return;
                const searchTerm = event.target.value.trim();
                if (!searchTerm) {
                    const initialData = await pool.exec('SELECT * FROM verbs ORDER BY id_num LIMIT 500;');
                    renderTable(initialData); return;
                }
                const searchQuery = searchTerm.split(' ').filter(Boolean).map(word => `${word}*`).join(' ');
                const results = await pool.exec(
                    `SELECT v.* FROM verbs_fts fts JOIN verbs v ON fts.rowid = v.rowid WHERE fts.verbs_fts MATCH ? ORDER BY rank`, 
                    [searchQuery]
                );
                renderTable(results);
            }, 300);
        });
    }

    function renderTable(dataToRender) {
        if (tableHead) tableHead.innerHTML = ''; 
        if (tableBody) tableBody.innerHTML = '';
        const headerRow = document.createElement('tr');
        const displayHeaders = ['№', 'P', '#', 'Инфинитив', '3 л. наст. вр.', '3 л. прош. вр.', 'Вопрос', 'Перевод'];
        displayHeaders.forEach((headerText) => {
            const th = document.createElement('th');
            th.className = 'px-2 py-3 text-center text-xs font-semibold text-sky-700 dark:text-sky-300 uppercase tracking-wider';
            th.textContent = headerText;
            headerRow.appendChild(th);
        });
        if (tableHead) tableHead.appendChild(headerRow);
        dataToRender.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-150 even:bg-gray-50 dark:even:bg-gray-700';
            if (row.conjugations) {
                tr.classList.add('cursor-pointer');
                tr.addEventListener('click', () => showModalForVerb(row));
            }
            mainTableHeaders.forEach(headerKey => {
                const td = document.createElement('td');
                td.className = 'px-2 py-2 text-center text-gray-700 dark:text-gray-300 break-words';
                if (['infinitive', 'present_3rd', 'past_3rd', 'translation'].includes(headerKey)) {
                    td.classList.add('text-left');
                }
                td.textContent = row[headerKey] || '';
                tr.appendChild(td);
            });
            if (tableBody) tableBody.appendChild(tr);
        });
        if (noResultsMessage) noResultsMessage.classList.toggle('hidden', dataToRender.length === 0);
        if (recordCount) recordCount.textContent = `Showing ${dataToRender.length} results.`;
    }

    const normalizeForMatch = (str) => str ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
    const getPreferredForm = (formsArray) => {
        if (!formsArray || formsArray.length === 0) return '-';
        const formWithDiacritics = formsArray.find(form => form !== normalizeForMatch(form));
        return formWithDiacritics || formsArray[0];
    };

    function showModalForVerb(rowData) {
        const verbInfo = JSON.parse(rowData.conjugations || '{}');
        if (modalTitle) modalTitle.textContent = `${rowData.infinitive} - ${rowData.translation}`;
        if (modalBody) modalBody.innerHTML = '';
        const tenses = {
            "Present tense": verbInfo["Present tense"], "Past tense": verbInfo["Past tense"],
            "Future tense": verbInfo["Future tense"], "Conditional mood": verbInfo["Conditional mood"],
            "Imperative mood": verbInfo["Imperative mood"], "Past freq. tense": verbInfo["Past freq. tense"]
        };
        const mainTenses = ["Present tense", "Past tense", "Future tense", "Conditional mood"];
        const persons = ["Aš", "Tu", "Jis/ji", "Mes", "Jūs", "Jie/jos"];
        let tableHTML = `<div class="overflow-x-auto"><table class="min-w-full text-sm divide-y divide-gray-200 dark:divide-gray-700 mb-4">`;
        tableHTML += `<thead class="bg-gray-50 dark:bg-gray-700"><tr><th class="px-2 py-1"></th>`;
        mainTenses.forEach(tense => {
            tableHTML += `<th class="px-2 py-1 text-left text-xs font-semibold text-sky-700 dark:text-sky-300">${TENSE_TRANSLATIONS[tense] || tense}</th>`;
        });
        tableHTML += `</tr></thead><tbody class="divide-y divide-gray-200 dark:divide-gray-700">`;
        persons.forEach((person, personIndex) => {
            tableHTML += `<tr class="hover:bg-gray-100 dark:hover:bg-gray-600 even:bg-gray-50 dark:even:bg-gray-600">`;
            tableHTML += `<td class="px-2 py-1 font-semibold">${person}</td>`;
            mainTenses.forEach(tense => {
                const tenseData = tenses[tense];
                const item = tenseData && tenseData[personIndex] ? tenseData[personIndex] : null;
                const form = item ? getPreferredForm(item.forms) : '-';
                tableHTML += `<td class="px-2 py-1">${form}</td>`;
            });
            tableHTML += `</tr>`;
        });
        tableHTML += `</tbody></table></div>`;
        ["Imperative mood", "Past freq. tense"].forEach(tense => {
            if (tenses[tense] && tenses[tense].length > 0) {
                let tenseHTML = `<h3 class="text-lg font-semibold mt-4 mb-2 text-sky-600 dark:text-sky-400">${TENSE_TRANSLATIONS[tense] || tense}</h3>`;
                tenseHTML += `<table class="min-w-full text-sm"><tbody class="divide-y divide-gray-200 dark:divide-gray-700">`;
                tenses[tense].forEach(row => {
                    tenseHTML += `<tr class="hover:bg-gray-100 dark:hover:bg-gray-600 even:bg-gray-50 dark:even:bg-gray-600"><td class="px-2 py-1 w-1/4 font-semibold">${row.person}</td><td class="px-2 py-1">${getPreferredForm(row.forms)}</td></tr>`;
                });
                tenseHTML += `</tbody></table>`;
                if (modalBody) modalBody.innerHTML += tenseHTML;
            }
        });
        if (modalOverlay) modalOverlay.classList.remove('hidden');
    }

    function closeModal() { if (modalOverlay) modalOverlay.classList.add('hidden'); }
    if (modalCloseButton) modalCloseButton.addEventListener('click', closeModal);
    if (modalOverlay) modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modalOverlay && !modalOverlay.classList.contains('hidden')) closeModal(); });

    startApp();
});

