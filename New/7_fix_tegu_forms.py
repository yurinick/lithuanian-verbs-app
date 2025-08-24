import json
import os
import unicodedata
import copy

# --- КОНСТАНТЫ ---
ACCENTED_TEGU = "tegù"

# --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (из предыдущих скриптов) ---
def has_accent(text):
    if not isinstance(text, str) or not text: return False
    normalized_text = unicodedata.normalize('NFD', text)
    return any(c in "\u0300\u0301\u0303" for c in normalized_text)

def update_or_create_person(persons_list, target_person, new_forms, translation=""):
    """
    Находит запись для лица в списке и обновляет ее.
    Если не находит - создает новую.
    """
    for person_data in persons_list:
        if person_data.get('person') == target_person:
            person_data['forms'] = new_forms
            return # Нашли и обновили, выходим

    # Если цикл завершился, а мы ничего не нашли - создаем новую запись
    persons_list.append({
        "person": target_person,
        "forms": new_forms,
        "translation": translation # Сохраняем пустой перевод для консистентности
    })

# --- ОСНОВНОЙ БЛОК ВЫПОЛНЕНИЯ ---
if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/New'
    INPUT_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_after.json')
    OUTPUT_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_tegu_fixed.json')

    print("--- Утилита для исправления 'tegu' форм ---")

    if not os.path.exists(INPUT_JSON_PATH):
        print(f"!!! ОШИБКА: Файл для исправления не найден: {INPUT_JSON_PATH}")
        exit()

    print(f"Загружаю данные из: {os.path.basename(INPUT_JSON_PATH)}")
    with open(INPUT_JSON_PATH, 'r', encoding='utf-8') as f:
        data_to_fix = json.load(f)

    # Создаем глубокую копию, чтобы безопасно вносить изменения
    corrected_data = copy.deepcopy(data_to_fix)
    
    corrections_made = 0
    warnings = 0

    print(f"Начинаю проверку и исправление {len(corrected_data)} глаголов...")

    for infinitive, verb_data in corrected_data.items():
        # --- 1. Найти источник (Present Tense -> Jis/ji) ---
        present_tense_forms = verb_data.get("Present tense", [])
        jis_ji_present_data = next((p for p in present_tense_forms if p.get("person") == "Jis/ji"), None)

        if not jis_ji_present_data or not jis_ji_present_data.get("forms"):
            print(f"   ❗️ Предупреждение: Не найдена эталонная форма 'Present tense -> Jis/ji' для глагола '{infinitive}'. Пропускаю.")
            warnings += 1
            continue

        # --- 2. Извлечь базовую и акцентированную формы ---
        all_source_forms = jis_ji_present_data['forms']
        source_base_forms = [f for f in all_source_forms if not has_accent(f)]
        source_accented_forms = [f for f in all_source_forms if has_accent(f)]

        if not source_base_forms:
            print(f"   ❗️ Предупреждение: Не найдена базовая (неакцентированная) форма в 'Present tense -> Jis/ji' для глагола '{infinitive}'. Пропускаю.")
            warnings += 1
            continue
        
        # Выбираем самую длинную базовую форму как самую "правильную"
        source_base_form = sorted(source_base_forms, key=len, reverse=True)[0]

        # --- 3. Сконструировать правильный список форм ---
        new_base_form = f"tegu {source_base_form}"
        new_accented_forms = [f"{ACCENTED_TEGU} {acc}" for acc in source_accented_forms]
        final_forms_list = sorted(list(dict.fromkeys([new_base_form] + new_accented_forms)))

        # --- 4. Найти цель (Imperative mood) и перезаписать/создать ---
        # setdefault - идеальный метод: он или возвращает существующий список, или создает пустой
        imperative_mood_list = verb_data.setdefault("Imperative mood", [])
        
        # Получаем перевод из существующей записи, если она есть
        existing_translation = ""
        for p_data in imperative_mood_list:
            if p_data.get("person") in ["Jis/ji", "Jie/jos"]:
                existing_translation = p_data.get("translation", "")
                break
        
        update_or_create_person(imperative_mood_list, "Jis/ji", final_forms_list, translation=existing_translation)
        update_or_create_person(imperative_mood_list, "Jie/jos", final_forms_list, translation=existing_translation)
        corrections_made += 1

    print("\nИсправление завершено.")
    if corrections_made > 0:
        print(f"   ✅ Исправлены 'tegu'-формы для {corrections_made} глаголов.")
    if warnings > 0:
        print(f"   ❗️ Обнаружено {warnings} предупреждений (пропущенных глаголов).")
    
    print(f"Сохраняю полностью исправленные данные в: {os.path.basename(OUTPUT_JSON_PATH)}")
    with open(OUTPUT_JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(corrected_data, f, ensure_ascii=False, indent=4)
        
    print("\n========================================================")
    print("✅ Скрипт успешно завершил работу!")
    print(f"  - Создан исправленный файл: {os.path.basename(OUTPUT_JSON_PATH)}")
    print("Теперь вы можете использовать этот файл для финального обновления вашей базы данных.")