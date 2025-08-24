import json
import os
import unicodedata

def has_accent(text):
    if not isinstance(text, str) or not text: return False
    normalized_text = unicodedata.normalize('NFD', text)
    return any(c in "\u0300\u0301\u0303" for c in normalized_text)

def remove_accents(text):
    if not isinstance(text, str) or not text: return ""
    nfd_form = unicodedata.normalize('NFD', text)
    return "".join([char for char in nfd_form if not unicodedata.combining(char)])

# --- ОСНОВНОЙ БЛОК ВЫПОЛНЕНИЯ ---
if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    
    FINAL_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_final.json')
    OUTPUT_TXT_PATH = os.path.join(PROJECT_DIR, 'words_to_accent.txt')

    print("--- Фаза 3, Шаг 3.1: Создание отчета о недостающих ударениях (Версия 3) ---")
    print("   (с игнорированием 'tegu' форм)")

    if not os.path.exists(FINAL_JSON_PATH):
        print(f"!!! ОШИБКА: Итоговый файл '{os.path.basename(FINAL_JSON_PATH)}' не найден.")
        exit()

    print(f"Загружаю итоговый файл: {os.path.basename(FINAL_JSON_PATH)}")
    with open(FINAL_JSON_PATH, 'r', encoding='utf-8') as f:
        final_data = json.load(f)

    words_needing_accent = set()

    print(f"Анализирую {len(final_data)} глаголов...")
    
    for infinitive, verb_data in final_data.items():
        for tense, persons in verb_data.items():
            for person_data in persons:
                forms = person_data.get('forms', [])
                if not forms: continue
                
                base_forms = {f for f in forms if not has_accent(f)}
                accented_forms = {f for f in forms if has_accent(f)}
                unaccented_versions_of_accented_forms = {remove_accents(f) for f in accented_forms}
                
                for base_form in base_forms:
                    clean_base_form = base_form.strip()
                    
                    # --- ИСПРАВЛЕНИЕ ЗДЕСЬ ---
                    # Пропускаем пустые строки и формы с "tegu"
                    if not clean_base_form or clean_base_form.startswith("tegu "):
                        continue
                    # --- КОНЕЦ ИСПРАВЛЕНИЯ ---

                    if clean_base_form not in unaccented_versions_of_accented_forms:
                        words_needing_accent.add(clean_base_form)

    print(f"\nАнализ завершен. Найдено {len(words_needing_accent)} уникальных форм без ударения для отправки.")

    sorted_words = sorted(list(words_needing_accent))
    
    print(f"Сохраняю список в файл: {os.path.basename(OUTPUT_TXT_PATH)}...")
    with open(OUTPUT_TXT_PATH, 'w', encoding='utf-8') as f:
        f.write("\n".join(sorted_words))

    print("\n========================================================")
    print("✅ Фаза 3, Шаг 3.1 успешно завершена!")
    print(f"  - Создан файл со списком слов: {os.path.basename(OUTPUT_TXT_PATH)}")