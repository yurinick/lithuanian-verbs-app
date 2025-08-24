import json
import os
import unicodedata
import re

# === КОНСТАНТЫ И СЛОВАРИ-ПЕРЕВОДЧИКИ ===
TIESIOGINE_NUOSAKA_MAP = {
    "Esamasis laikas": "Present tense", "Būtasis kartinis laikas": "Past tense",
    "Būsimasis laikas": "Future tense", "Būtasis dažninis": "Past freq. tense"
}
CATEGORY_MAP = {
    "Tariamoji nuosaka": "Conditional mood", "Liepiamoji nuosaka": "Imperative mood"
}
PERSON_MAP = {
    "Aš": "Aš", "Tu": "Tu", "Jis/ji": "Jis/ji",
    "Mes": "Mes", "Jūs": "Jūs", "Jie/jos": "Jie/jos"
}
# ИСПРАВЛЕНО: Добавлены č и š
LITHUANIAN_CONSONANTS = "bcčdfghjklmnprsštvzž"

# --- ФИНАЛЬНЫЕ ПРАВИЛА ДЛЯ ОКОНЧАНИЙ ---
GOOD_ENDINGS_MES = ('me', 'mes', 'mė', 'mės')
BAD_ENDINGS_MES = ('mėme', 'mėmes', 'mėmė', 'mėmės')
GOOD_ENDINGS_JUS = ('te', 'tes', 'tė', 'tės')
BAD_ENDINGS_JUS = ('mėte', 'mėtes', 'mėtė', 'mėtės')

def has_accent(text):
    if not isinstance(text, str) or not text: return False
    normalized_text = unicodedata.normalize('NFD', text)
    return any(c in "\u0300\u0301\u0303" for c in normalized_text)

def select_preferred_forms(tense, person, all_forms, compared_word=None):
    if not all_forms: return []

    # --- 1. Tiesioginė nuosaka (ИЗМЕНЕНИЙ НЕТ, КОД УЖЕ КОРРЕКТЕН) ---
    if tense in TIESIOGINE_NUOSAKA_MAP.values():
        # ИЗМЕНЕНО: Правило 1.2 для "Mes"
        if person == "Mes":
            preferred_endings = ('ame', 'amė', 'ames', 'amės', 'ome', 'omė', 'omes', 'omės', 'ime', 'imė', 'imes', 'imės')
            preferred_forms = [f for f in all_forms if f.endswith(preferred_endings)]
            
            if preferred_forms:
                return preferred_forms
            else:
                # Новый fallback: если нужных форм нет, возвращаем самую длинную
                return [sorted(all_forms, key=len, reverse=True)[0]]
            
        # ИЗМЕНЕНО: Правило 1.3 для "Jūs"    
        if person == "Jūs":
            preferred_endings = ('ate', 'atė', 'ates', 'atės', 'ote', 'otė', 'otes', 'otės', 'ite', 'itė', 'ites', 'itės')
            preferred_forms = [f for f in all_forms if f.endswith(preferred_endings)]

            if preferred_forms:
                return preferred_forms
            else:
                # Новый fallback: если нужных форм нет, возвращаем самую длинную
                return [sorted(all_forms, key=len, reverse=True)[0]]
            
        # --- ИЗМЕНЕНИЕ ЗДЕСЬ (Правило 1.1) ---
        # Проверяем, есть ли ровно две формы, одна из которых - усеченная версия другой
        if len(all_forms) == 2:
            short, long = sorted(all_forms, key=len)
            # Если длинная форма - это короткая + один символ, оставляем только длинную
            if len(long) == len(short) + 1 and long.startswith(short):
                return [long]
        # применяем старую логику: оставляем все, но ставим совпадающее слово первым.
        if compared_word and compared_word in all_forms:
            return [compared_word] + [f for f in all_forms if f != compared_word]
        return all_forms

    # --- 2. Liepiamoji nuosaka (ЕСТЬ ИЗМЕНЕНИЯ) ---
    elif tense == "Imperative mood":
        if person == "Tu":
            # Правило 2.1: оставляем формы на согласную
            consonant_forms = [f for f in all_forms if f.endswith(tuple(LITHUANIAN_CONSONANTS))]
            return consonant_forms if consonant_forms else all_forms
            
        # ИЗМЕНЕНО: Правило 2.3 для "Mes"
        if person == "Mes":
            preferred_endings = ('me', 'mė', 'mes', 'mės')
            preferred_forms = [f for f in all_forms if f.endswith(preferred_endings)]
            return preferred_forms if preferred_forms else all_forms

        # ИЗМЕНЕНО: Правило 2.4 для "Jūs"
        if person == "Jūs":
            preferred_endings = ('te', 'tė', 'tes', 'tės')
            preferred_forms = [f for f in all_forms if f.endswith(preferred_endings)]
            return preferred_forms if preferred_forms else all_forms
            
        return all_forms

    # --- 3. Tariamoji nuosaka (ЕСТЬ ИЗМЕНЕНИЯ) ---
    elif tense == "Conditional mood":
        # Правила 3.4 и 3.5 для "Mes" и "Jūs" (без изменений)
        if person == "Mes":
            long_forms = [f for f in all_forms if f.endswith(BAD_ENDINGS_MES)]
            short_forms = [f for f in all_forms if f.endswith(GOOD_ENDINGS_MES) and f not in long_forms]
            if short_forms: return short_forms
            if long_forms: return [re.sub(r'mė(?=(me|mes|mė|mės)$)', '', f) for f in long_forms]
            return all_forms

        if person == "Jūs":
            long_forms = [f for f in all_forms if f.endswith(BAD_ENDINGS_JUS)]
            short_forms = [f for f in all_forms if f.endswith(GOOD_ENDINGS_JUS) and f not in long_forms]
            if short_forms: return short_forms
            if long_forms: return [re.sub(r'mė(?=(te|tes|tė|tės)$)', '', f) for f in long_forms]
            return all_forms
        
        # ИЗМЕНЕНО: Новая сложная логика для Правил 3.1, 3.2, 3.3
         # --- Отдельная логика для "Tu" ---
        if person == "Tu":
            # ШАГ 1: Сначала отфильтровываем все нежелательные формы.
            filtered_forms = [f for f in all_forms if not f.endswith(('mei', 'mėi'))]
            
            # ШАГ 2: Теперь применяем всю остальную логику к очищенному списку.
            if len(filtered_forms) == 2:
                short, long = sorted(filtered_forms, key=len)
                if len(long) == len(short) + 1 and long.startswith(short):
                    return [long]

            if compared_word and compared_word in filtered_forms:
                return [compared_word] + [f for f in filtered_forms if f != compared_word]
            return filtered_forms

        if person in ["Aš", "Jis/ji", "Jie/jos"]:
            # Проверяем, есть ли ровно две формы, одна из которых - усеченная версия другой
            if len(all_forms) == 2:
                # Сортируем по длине, чтобы short был короче, а long - длиннее
                short, long = sorted(all_forms, key=len)
                # Если длинная форма - это короткая + один символ, оставляем только длинную
                if len(long) == len(short) + 1 and long.startswith(short):
                    return [long]
            
            # Если условие выше не выполнилось (форм не две или они сильно разные),
            # применяем старую логику: оставляем все, но ставим совпадающее слово первым.
            if compared_word and compared_word in all_forms:
                return [compared_word] + [f for f in all_forms if f != compared_word]
            return all_forms

        return all_forms
            
    return all_forms

def parse_morphology_data(morphology_verb_data):
    parsed_data = {}
    for section in morphology_verb_data.get("morphology_sections", []):
        if section.get("part_of_speech") == "dalyvis": continue
        category = section.get("category")
        table = section.get("table", {}).get("headers", [])
        if not category or not table: continue

        if category == "Tiesioginė nuosaka":
            header_row, *person_rows = table
            for person_row in person_rows:
                person = PERSON_MAP.get(person_row[0])
                if not person: continue
                for i, tense_lit in enumerate(header_row[1:], 1):
                    tense = TIESIOGINE_NUOSAKA_MAP.get(tense_lit)
                    if not tense: continue
                    forms_raw = [f.strip() for f in person_row[i].split(',') if f.strip() != "-"]
                    if not parsed_data.get(tense): parsed_data[tense] = {}
                    parsed_data[tense][person] = forms_raw
        elif category in CATEGORY_MAP:
            tense = CATEGORY_MAP[category]
            if not parsed_data.get(tense): parsed_data[tense] = {}
            for person_row in table:
                if len(person_row) < 2: continue
                person = PERSON_MAP.get(person_row[0])
                if not person: continue
                forms_raw = [f.strip() for f in person_row[1].split(',') if f.strip() != "-"]
                parsed_data[tense][person] = forms_raw

    # --- ИСПРАВЛЕННАЯ ЛОГИКА ---
    # Пытаемся получить формы для "Jis/ji" в настоящем времени
    present_jis_forms = parsed_data.get("Present tense", {}).get("Jis/ji")
    
    # Только если они существуют, мы создаем и присваиваем tegu-форму
    if present_jis_forms:
        # Усовершенствованная логика выбора базовой формы
        if len(present_jis_forms) > 1:
            base_form = sorted(present_jis_forms, key=len, reverse=True)[0]
        else:
            base_form = present_jis_forms[0]

        tegu_form = [f"tegu {base_form}"]

        # Убеждаемся, что словарь для повелительного наклонения существует
        if not parsed_data.get("Imperative mood"):
            parsed_data["Imperative mood"] = {}
            
        # Принудительно устанавливаем/перезаписываем правильные формы
        # Этот код теперь находится в безопасном месте
        parsed_data["Imperative mood"]["Jis/ji"] = tegu_form
        parsed_data["Imperative mood"]["Jie/jos"] = tegu_form

    return parsed_data

if __name__ == "__main__":
    PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
    CLEANED_JSON = os.path.join(PROJECT_DIR, 'conjugations_accents_cleaned.json')
    MORPHOLOGY_JSON = os.path.join(PROJECT_DIR, 'morphology_results_advanced.json')
    FINAL_JSON = os.path.join(PROJECT_DIR, 'conjugations_final.json')
    REPORT_FILE = os.path.join(PROJECT_DIR, 'report_form_corrections.txt')

    print("--- Фаза 2, Шаг 2.1: Коррекция базовых форм ---")
    print("   (с учетом всех правил из анализа)")

    with open(CLEANED_JSON, 'r', encoding='utf-8') as f: data_to_correct = json.load(f)
    with open(MORPHOLOGY_JSON, 'r', encoding='utf-8') as f: source_of_truth = json.load(f)

    final_data = {}
    corrections_log = []
    
    normalized_source_of_truth = {
        unicodedata.normalize('NFD', k).encode('ascii', 'ignore').decode('utf-8'): v 
        for k, v in source_of_truth.items()
    }
    
    print(f"Начинаю сверку {len(data_to_correct)} глаголов...")
    
    for infinitive, verb_data in data_to_correct.items():
        norm_infinitive = unicodedata.normalize('NFD', infinitive).encode('ascii', 'ignore').decode('utf-8')
        if norm_infinitive not in normalized_source_of_truth:
            final_data[infinitive] = verb_data
            continue
        truth_data_raw = parse_morphology_data(normalized_source_of_truth[norm_infinitive])
        corrected_verb_data = json.loads(json.dumps(verb_data))

        # --- НОВАЯ ЛОГИКА: Идем по эталонным данным, а не по исходным ---
        for tense, persons_dict in truth_data_raw.items(): # <--- Этот цикл все еще внутри `for infinitive...`
            if not persons_dict: continue

            for person, truth_forms_raw in persons_dict.items():
                if not truth_forms_raw: continue
                
                # --- 1. Найти существующую запись (если она есть) ---
                existing_person_data = None
                existing_person_index = -1
                if tense in corrected_verb_data:
                    for i, p_data in enumerate(corrected_verb_data[tense]):
                        if p_data.get('person') == person:
                            existing_person_data = p_data
                            existing_person_index = i
                            break
                
                # --- 2. Собрать информацию из существующей записи ---
                current_base_forms = []
                accented_forms = []
                compared_word = None
                if existing_person_data:
                    current_forms = existing_person_data.get('forms', [])
                    current_base_forms = [f for f in current_forms if not has_accent(f)]
                    accented_forms = [f for f in current_forms if has_accent(f)]
                    if current_base_forms:
                        compared_word = current_base_forms[0]
                
                # --- 3. Получить правильные базовые формы ---
                preferred_truth_forms = select_preferred_forms(tense, person, truth_forms_raw, compared_word=compared_word)

                # --- 4. Сравнить и залогировать изменения ---
                if set(current_base_forms) != set(preferred_truth_forms):
                     log_entry = (
                        f"Глагол: {infinitive}, Время: {tense}, Лицо: {person}\n"
                        f"  - БЫЛО (базовые): {current_base_forms if existing_person_data else '[ОТСУТСТВОВАЛО]'}\n"
                        f"  - СТАЛО (эталон): {preferred_truth_forms}\n"
                    )
                     corrections_log.append(log_entry)

                # --- 5. Собрать финальный список форм (УЛУЧШЕННАЯ ЛОГИКА) ---
                
                # Сначала создаем финальный список только из правильных базовых форм,
                # удаляя дубликаты с сохранением порядка.
                final_forms = list(dict.fromkeys(preferred_truth_forms))

                # Теперь добавляем акцентированные формы, ТОЛЬКО ЕСЛИ их базовая версия
                # уже присутствует в нашем списке правильных форм `final_forms`.
                for acc_form in accented_forms:
                    # Убираем "мягкие" акценты (тильду, акут, гравис) для сравнения
                    unaccented_form = ''.join(c for c in unicodedata.normalize('NFD', acc_form) if not unicodedata.combining(c))
                    
                    if unaccented_form in final_forms and acc_form not in final_forms:
                        final_forms.append(acc_form)

                ordered_new_forms = final_forms

                # --- 6. Обновить существующую запись или СОЗДАТЬ НОВУЮ ---
                if existing_person_data:
                    corrected_verb_data[tense][existing_person_index]['forms'] = ordered_new_forms
                else:
                    if tense not in corrected_verb_data:
                        corrected_verb_data[tense] = []
                    new_entry = {
                        "person": person,
                        "forms": ordered_new_forms,
                        "translation": "" # Добавляем пустое поле для консистентности
                    }
                    corrected_verb_data[tense].append(new_entry)

        final_data[infinitive] = corrected_verb_data

    print(f"\nСверка завершена. Найдено {len(corrections_log)} расхождений.")
    print(f"Сохраняю итоговые данные в {os.path.basename(FINAL_JSON)}...")
    with open(FINAL_JSON, 'w', encoding='utf-8') as f: json.dump(final_data, f, ensure_ascii=False, indent=4)
    print(f"Сохраняю отчет об исправлениях в {os.path.basename(REPORT_FILE)}...")
    with open(REPORT_FILE, 'w', encoding='utf-8') as f:
        f.write("Отчет о расхождениях базовых форм\n(с применением детальных грамматических правил v9)\n")
        f.write(f"Всего найдено исправлений: {len(corrections_log)}\n")
        f.write("=======================================\n\n")
        f.writelines(corrections_log)
    print("\n========================================================")
    print("✅ Фаза 2, Шаг 2.1 успешно завершена!")
    print(f"  - Создан итоговый файл: {os.path.basename(FINAL_JSON)}")
    print(f"  - Создан отчет об исправлениях: {os.path.basename(REPORT_FILE)}")
    print("Мы готовы к Фазе 3: Обновление базы данных и финальная отчетность.")