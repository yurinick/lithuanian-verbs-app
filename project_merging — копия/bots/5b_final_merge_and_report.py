import json
import os
import unicodedata

# --- КОНСТАНТЫ ---
ACCENTED_TEGU = "tegù"

def has_accent(text):
    if not isinstance(text, str) or not text: return False
    normalized_text = unicodedata.normalize('NFD', text)
    return any(c in "\u0300\u0301\u0303" for c in normalized_text)

def remove_accents(text):
    if not isinstance(text, str) or not text: return ""
    nfd_form = unicodedata.normalize('NFD', text)
    return "".join([char for char in nfd_form if not unicodedata.combining(char)])

def create_master_accent_lookup(cache_data, source_data):
    """
    НОВАЯ ФУНКЦИЯ: Создает единый словарь ударений из ДВУХ источников.
    """
    lookup = {}
    print("Создаю 'мастер-словарь' ударений...")
    
    # 1. Загружаем из кэша (с фильтрацией)
    for word, accent_info_list in cache_data.items():
        if not isinstance(accent_info_list, list): continue
        word_norm = unicodedata.normalize('NFC', word)
        
        all_forms = [unicodedata.normalize('NFC', e['accented']) for e in accent_info_list if isinstance(e, dict) and 'accented' in e]
        vksm_forms = [unicodedata.normalize('NFC', e['accented']) for e in accent_info_list if isinstance(e, dict) and 'info' in e and 'vksm.' in e.get('info', '')]
        
        final_forms = list(dict.fromkeys(vksm_forms if vksm_forms else all_forms))
        if final_forms:
            lookup[word_norm] = final_forms

    print(f"   Шаг 1: Загружено {len(lookup)} слов из кэша.")

    # 2. Дополняем данными из исходного файла (conjugations_final.json)
    source_added = 0
    for infinitive, verb_data in source_data.items():
        for tense, persons in verb_data.items():
            for person_data in persons:
                accented_forms = {f for f in person_data.get('forms', []) if has_accent(f)}
                for acc_form in accented_forms:
                    base_form = remove_accents(acc_form)
                    if base_form not in lookup: # Добавляем, только если еще не было в кэше
                        lookup[base_form] = [acc_form]
                        source_added += 1

    print(f"   Шаг 2: Добавлено {source_added} слов из исходных данных.")
    print(f"Итоговый размер 'мастер-словаря': {len(lookup)} слов.")
    return lookup

# --- ОСНОВНОЙ БЛОК ВЫПОЛНЕНИЯ ---
if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    FINAL_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_final.json')
    CACHE_PATH = os.path.join(PROJECT_DIR, 'accent_cache.json')
    ENRICHED_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_fully_enriched.json')
    REPORT_PATH = os.path.join(PROJECT_DIR, 'final_report_unprocessed.txt')

    print("--- Финальная фаза: Слияние данных и создание отчета (Версия 6 - Финальная) ---")

    with open(FINAL_JSON_PATH, 'r', encoding='utf-8') as f: final_data = json.load(f)
    with open(CACHE_PATH, 'r', encoding='utf-8') as f: accent_cache_raw = json.load(f)

    # --- Создаем единый, полный словарь ударений ---
    master_accent_lookup = create_master_accent_lookup(accent_cache_raw, final_data)
    
    enriched_data = json.loads(json.dumps(final_data))
    report_lines = []

    print(f"\nНачинаю обогащение {len(enriched_data)} глаголов...")
    for infinitive, verb_data in enriched_data.items():
        for tense, persons in verb_data.items():
            for person_data in persons:
                original_forms = person_data.get('forms', [])
                person = person_data.get('person')
                if not original_forms: continue
                
                new_forms_set = set(original_forms)
                base_forms_to_process = [f for f in original_forms if not has_accent(f)]
                
                for base_form in base_forms_to_process:
                    base_form_norm = unicodedata.normalize('NFC', base_form)
                    
                    accented_versions = []
                    if base_form_norm.startswith("tegu "):
                        base_verb = base_form_norm.split(' ', 1)[1]
                        found_accents = master_accent_lookup.get(base_verb)
                        if found_accents:
                            accented_versions = [f"{ACCENTED_TEGU} {acc}" for acc in found_accents]
                    else:
                        accented_versions = master_accent_lookup.get(base_form_norm, [])

                    if accented_versions:
                        new_forms_set.update(accented_versions)
                    else:
                        report_line = f"{infinitive} - {tense} - {person} - {base_form}"
                        report_lines.append(report_line)

                person_data['forms'] = sorted(list(new_forms_set), key=lambda x: (not has_accent(x), x))

    print("\nОбогащение завершено.")
    print(f"Сохраняю полностью обогащенные данные в: {os.path.basename(ENRICHED_JSON_PATH)}")
    with open(ENRICHED_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(enriched_data, f, ensure_ascii=False, indent=4)

    if report_lines:
        print(f"Найдено {len(report_lines)} форм, которые не удалось обработать.")
        print(f"Сохраняю финальный отчет в: {os.path.basename(REPORT_PATH)}")
        with open(REPORT_PATH, 'w', encoding='utf-8') as f:
            f.write("Инфинитив - Время - Местоимение - Форма глагола\n")
            f.write("="*50 + "\n")
            f.write("\n".join(sorted(report_lines)))
    else:
        print("Отличная работа! Все формы были успешно обработаны.")
        
    print("\n========================================================")
    print("✅ Все этапы обработки данных успешно завершены!")
    print(f"  - Создан финальный файл для импорта в БД: {os.path.basename(ENRICHED_JSON_PATH)}")