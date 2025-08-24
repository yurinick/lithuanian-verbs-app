import json
import os
import unicodedata

# --- КОНСТАНТЫ ---
# Ваше гениальное уточнение, реализованное как константа
ACCENTED_TEGU = "tegù"

def has_accent(text):
    """Проверяет, содержит ли строка акцентологические знаки."""
    if not isinstance(text, str) or not text: return False
    normalized_text = unicodedata.normalize('NFD', text)
    return any(c in "\u0300\u0301\u0303" for c in normalized_text)

# --- ОСНОВНОЙ БЛОК ВЫПОЛНЕНИЯ ---
if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    
    FINAL_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_final.json')
    NEW_ACCENTS_PATH = os.path.join(PROJECT_DIR, 'new_accents.json')
    ENRICHED_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_fully_enriched.json')
    REPORT_PATH = os.path.join(PROJECT_DIR, 'report_unaccented_tegu.txt')

    print("--- Фаза 3, Шаг 3.3: Слияние новых ударений ---")

    # --- 1. Загрузка исходных файлов ---
    print(f"Загружаю исправленные формы из: {os.path.basename(FINAL_JSON_PATH)}")
    with open(FINAL_JSON_PATH, 'r', encoding='utf-8') as f:
        final_data = json.load(f)

    print(f"Загружаю новые ударения из: {os.path.basename(NEW_ACCENTS_PATH)}")
    with open(NEW_ACCENTS_PATH, 'r', encoding='utf-8') as f:
        new_accents = json.load(f)
    print(f"Загружено {len(new_accents)} новых акцентированных слов.")

    # --- 2. Основной цикл обогащения ---
    # Создаем глубокую копию для изменений
    enriched_data = json.loads(json.dumps(final_data))
    unresolved_tegu_forms = []

    print(f"Начинаю обогащение {len(enriched_data)} глаголов...")
    for infinitive, verb_data in enriched_data.items():
        for tense, persons in verb_data.items():
            for person_data in persons:
                original_forms = person_data.get('forms', [])
                if not original_forms:
                    continue
                
                new_forms_list = []
                for form in original_forms:
                    # --- Логика для каждой формы ---
                    
                    # Случай 1: Форма уже имеет ударение. Просто добавляем.
                    if has_accent(form):
                        new_forms_list.append(form)
                        continue
                    
                    # Случай 2: Это 'tegu' конструкция
                    if form.startswith("tegu "):
                        base_verb = form.split(' ', 1)[1]
                        # Ищем ударение для базового глагола
                        accented_versions = new_accents.get(base_verb)
                        
                        # Сначала всегда добавляем исходную, неакцентированную форму
                        new_forms_list.append(form)
                        
                        if accented_versions:
                            # Собираем новые формы с `tegù`
                            for acc_verb in accented_versions:
                                new_forms_list.append(f"{ACCENTED_TEGU} {acc_verb}")
                        else:
                            # Если ударения для базового глагола нет, логируем
                            unresolved_tegu_forms.append(form)
                        continue
                        
                    # Случай 3: Обычное слово без ударения
                    accented_versions = new_accents.get(form)
                    
                    # Сначала добавляем исходную базовую форму
                    new_forms_list.append(form)
                    
                    if accented_versions:
                        # Добавляем все найденные варианты с ударениями
                        new_forms_list.extend(accented_versions)
                
                # Заменяем старый список форм на новый, удаляя дубликаты с сохранением порядка
                person_data['forms'] = list(dict.fromkeys(new_forms_list))

    # --- 3. Сохранение результатов ---
    print("\nОбогащение завершено.")
    print(f"Сохраняю полностью обогащенные данные в: {os.path.basename(ENRICHED_JSON_PATH)}")
    with open(ENRICHED_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(enriched_data, f, ensure_ascii=False, indent=4)

    if unresolved_tegu_forms:
        print(f"Найдено {len(unresolved_tegu_forms)} 'tegu'-форм, для которых не удалось найти ударение.")
        print(f"Сохраняю отчет в: {os.path.basename(REPORT_PATH)}")
        with open(REPORT_PATH, 'w', encoding='utf-8') as f:
            f.write("Следующие 'tegu'-формы не были акцентированы, так как для их базовой части не найдено ударения:\n")
            f.write("\n".join(sorted(list(set(unresolved_tegu_forms)))))
    else:
        print("Все 'tegu'-формы были успешно обработаны.")
        
    print("\n========================================================")
    print("✅ Фаза 3, Шаг 3.3 успешно завершена!")
    print(f"  - Создан финальный файл: {os.path.basename(ENRICHED_JSON_PATH)}")
    print("Этот файл готов для записи в базу данных.")