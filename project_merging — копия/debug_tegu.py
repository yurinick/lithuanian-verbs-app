import json
import os
import unicodedata

def preprocess_new_accents(accent_cache_data):
    """
    Та же функция предобработки, что и в основном скрипте.
    Мы используем ее, чтобы симулировать реальные условия.
    """
    lookup = {}
    for word, accent_info_list in accent_cache_data.items():
        if not isinstance(accent_info_list, list): continue
        word_norm = unicodedata.normalize('NFC', word)
        
        all_accented_forms = []
        preferred_verb_forms = []
        
        for entry in accent_info_list:
            if isinstance(entry, dict) and "accented" in entry:
                accented_form = unicodedata.normalize('NFC', entry['accented'])
                all_accented_forms.append(accented_form)
                if "info" in entry and 'vksm.' in entry['info']:
                    preferred_verb_forms.append(accented_form)

        final_forms = preferred_verb_forms if preferred_verb_forms else all_accented_forms
        
        if final_forms:
            if word_norm not in lookup: lookup[word_norm] = []
            lookup[word_norm].extend(final_forms)
            
    for word, forms in lookup.items():
        lookup[word] = list(dict.fromkeys(forms))
    return lookup

if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    CACHE_PATH = os.path.join(PROJECT_DIR, 'accent_cache.json')

    # --- ВАШИ 5 ПРИМЕРОВ ДЛЯ ДИАГНОСТИКИ ---
    words_to_diagnose = [
        "tegu abejoja",
        "tegu abejoja", # Дубликат для полноты картины
        "tegu absorbuoja",
        "tegu absorbuoja",
        "tegu abstrahuoja"
    ]

    print("--- ДИАГНОСТИКА: Поиск причины сбоя для 'tegu' форм ---")

    # 1. Загружаем и предобрабатываем кэш, как это делает основной скрипт
    print(f"\n1. Загружаю кэш из: {os.path.basename(CACHE_PATH)}")
    with open(CACHE_PATH, 'r', encoding='utf-8') as f: 
        accent_cache_raw = json.load(f)
    
    print("2. Создаю поисковый словарь 'accent_lookup' (фильтрую глаголы и т.д.)...")
    accent_lookup = preprocess_new_accents(accent_cache_raw)
    print(f"   Словарь создан. Содержит {len(accent_lookup)} ключей.")

    # 3. Начинаем диагностику по вашим словам
    print("\n3. Начинаю пошаговую диагностику ваших примеров:\n")

    for i, tegu_form in enumerate(words_to_diagnose):
        print(f"--- Пример #{i+1} ---")
        print(f"Исходная форма: '{tegu_form}'")

        # Шаг А: Разбираем конструкцию
        base_verb = tegu_form.split(' ', 1)[1]
        print(f"   А. Извлекаю базовый глагол для поиска: '{base_verb}'")
        
        # Шаг Б: Пытаемся найти базовый глагол в нашем поисковом словаре
        print(f"   Б. Ищу ключ '{base_verb}' в словаре 'accent_lookup'...")
        
        found_accents = accent_lookup.get(base_verb)
        
        # Шаг В: Делаем вывод
        if found_accents:
            print(f"   В. ✅ УСПЕХ! Ключ '{base_verb}' найден.")
            print(f"      Результат из кэша: {found_accents}")
        else:
            print(f"   В. ❌ ПРОВАЛ! Ключ '{base_verb}' НЕ НАЙДЕН в 'accent_lookup'.")
            
            # Дополнительная диагностика: А есть ли он в сыром кэше?
            if base_verb in accent_cache_raw:
                print("      ДИАГНОЗ: Ключ ЕСТЬ в сыром кэше, но был отфильтрован моей функцией.")
                print("               Это значит, что для него не нашлось вариантов с 'vksm.', и не было fallback-логики.")
            else:
                print("      ДИАГНОЗ: Ключа НЕТ даже в сыром файле accent_cache.json.")
                print("               Это значит, что бот по какой-то причине не обработал это слово.")
        
        print("-" * 20 + "\n")