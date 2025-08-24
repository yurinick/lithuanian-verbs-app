import json
import os
from collections import OrderedDict
import unicodedata

def flatten_and_clean_forms(forms_list):
    """
    "Выпрямляет" список форм, распаковывая вложенные списки,
    и гарантирует, что все элементы являются строками.
    """
    flat_list = []
    if not isinstance(forms_list, list):
        return [] # Возвращаем пустой список, если на входе не список
        
    for item in forms_list:
        if isinstance(item, list):
            # Если элемент - это список, распаковываем его
            for sub_item in item:
                if isinstance(sub_item, str):
                    flat_list.append(sub_item)
        elif isinstance(item, str):
            # Если элемент - это строка, просто добавляем его
            flat_list.append(item)
    return flat_list

def has_accent(text):
    """
    Проверяет, содержит ли строка акцентологические знаки литовского языка.
    """
    if not isinstance(text, str) or not text:
        return False
    normalized_text = unicodedata.normalize('NFD', text)
    return any(c in "\u0300\u0301\u0303" for c in normalized_text)

def reconcile_verb_accents(verb_data_before, verb_data_after):
    """
    Применяет логику очистки и слияния для одного глагола.
    """
    cleaned_verb_data = json.loads(json.dumps(verb_data_after))

    for tense, persons in verb_data_after.items():
        for i, person_data_after in enumerate(persons):
            person_data_before = None
            if tense in verb_data_before and i < len(verb_data_before[tense]):
                 person_data_before = verb_data_before[tense][i]

            # --- ИСПРАВЛЕНИЕ: Применяем нашу новую функцию очистки ---
            forms_after_raw = person_data_after.get('forms', [])
            forms_before_raw = person_data_before.get('forms', []) if person_data_before else []

            forms_after = set(flatten_and_clean_forms(forms_after_raw))
            forms_before = set(flatten_and_clean_forms(forms_before_raw))
            # --- КОНЕЦ ИСПРАВЛЕНИЯ ---

            base_forms = {f for f in forms_after if not has_accent(f)}
            old_accented_forms = {f for f in forms_before if has_accent(f)}
            newly_parsed_accented_forms = {f for f in forms_after if has_accent(f)} - old_accented_forms

            final_forms = list(base_forms)
            if newly_parsed_accented_forms:
                final_forms.extend(sorted(list(newly_parsed_accented_forms)))
            elif old_accented_forms:
                final_forms.extend(sorted(list(old_accented_forms)))
            
            cleaned_verb_data[tense][i]['forms'] = list(OrderedDict.fromkeys(final_forms))

    return cleaned_verb_data

# --- ОСНОВНОЙ БЛОК ВЫПОЛНЕНИЯ ---
if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    
    BEFORE_JSON = os.path.join(PROJECT_DIR, 'conjugations_before.json')
    AFTER_JSON = os.path.join(PROJECT_DIR, 'conjugations_after.json')
    OUTPUT_JSON = os.path.join(PROJECT_DIR, 'conjugations_accents_cleaned.json')

    print("--- Фаза 1, Шаг 1.2: Сведение и очистка ударений (Версия 3) ---")

    print(f"Загружаю файл 'ДО': {os.path.basename(BEFORE_JSON)}")
    with open(BEFORE_JSON, 'r', encoding='utf-8') as f:
        data_before = json.load(f)

    print(f"Загружаю файл 'ПОСЛЕ': {os.path.basename(AFTER_JSON)}")
    with open(AFTER_JSON, 'r', encoding='utf-8') as f:
        data_after = json.load(f)
        
    print(f"Найдено {len(data_before)} глаголов 'ДО' и {len(data_after)} глаголов 'ПОСЛЕ'.")

    final_cleaned_data = {}
    
    processed_count = 0
    for infinitive, verb_data_after in data_after.items():
        if infinitive not in data_before:
            final_cleaned_data[infinitive] = verb_data_after
            continue
        
        verb_data_before = data_before[infinitive]
        
        cleaned_verb = reconcile_verb_accents(verb_data_before, verb_data_after)
        final_cleaned_data[infinitive] = cleaned_verb
        
        processed_count += 1
        if processed_count % 500 == 0:
            print(f"  Обработано {processed_count}/{len(data_after)} глаголов...")


    print(f"\nОбработка завершена. Сохраняю {len(final_cleaned_data)} глаголов в итоговый файл...")

    with open(OUTPUT_JSON, 'w', encoding='utf-8') as f:
        json.dump(final_cleaned_data, f, ensure_ascii=False, indent=4)

    print("\n========================================================")
    print("✅ Фаза 1, Шаг 1.2 успешно завершена!")
    print("В вашей папке проекта создан новый файл:")
    print(f"  - {os.path.basename(OUTPUT_JSON)}")
    print("Этот файл содержит данные с очищенными ударениями согласно вашим правилам.")
    print("Мы готовы к Фазе 2: Работа со спряжениями.")