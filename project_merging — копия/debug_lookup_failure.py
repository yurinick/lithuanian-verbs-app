import json
import os
import unicodedata

def preprocess_new_accents(accent_cache_data):
    """Та же функция, что и раньше, для создания словаря."""
    lookup = {}
    for word, accent_info_list in accent_cache_data.items():
        if not isinstance(accent_info_list, list): continue
        word_norm = unicodedata.normalize('NFC', word)
        verb_forms = []
        for entry in accent_info_list:
            if isinstance(entry, dict) and "info" in entry and "accented" in entry:
                if 'vksm.' in entry['info']:
                    verb_forms.append(unicodedata.normalize('NFC', entry['accented']))
        if verb_forms:
            if word_norm not in lookup: lookup[word_norm] = []
            lookup[word_norm].extend(verb_forms)
    for word, forms in lookup.items():
        lookup[word] = list(dict.fromkeys(forms))
    return lookup

if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    FINAL_JSON_PATH = os.path.join(PROJECT_DIR, 'conjugations_final.json')
    CACHE_PATH = os.path.join(PROJECT_DIR, 'accent_cache.json')

    print("--- ДИАГНОСТИКА: Поиск причины сбоя слияния ---")

    with open(FINAL_JSON_PATH, 'r', encoding='utf-8') as f: final_data = json.load(f)
    with open(CACHE_PATH, 'r', encoding='utf-8') as f: accent_cache_raw = json.load(f)

    accent_lookup = preprocess_new_accents(accent_cache_raw)
    
    # Получаем список всех ключей из кэша для поиска
    all_cache_keys = list(accent_lookup.keys())

    print("\n--- Начинаю поиск несоответствий. Показываю первые 5... ---\n")
    
    failures_found = 0
    failures_to_show = 5

    # Проходим по всем данным, чтобы найти сбойные слова
    for infinitive, verb_data in final_data.items():
        if failures_found >= failures_to_show: break
        for tense, persons in verb_data.items():
            if failures_found >= failures_to_show: break
            for person_data in persons:
                if failures_found >= failures_to_show: break
                
                original_forms = person_data.get('forms', [])
                base_forms_to_process = [f for f in original_forms if not unicodedata.normalize('NFD', f).strip() or not any(c in "\u0300\u0301\u0303" for c in unicodedata.normalize('NFD', f))]

                for base_form in base_forms_to_process:
                    base_form_norm = unicodedata.normalize('NFC', base_form).strip()
                    
                    # Если поиск не удался
                    if base_form_norm not in accent_lookup:
                        print(f"--- #{failures_found + 1} НЕСООТВЕТСТВИЕ НАЙДЕНО ---")
                        print(f"Слово, которое мы ищем: '{base_form_norm}'")
                        print(f"  - Его внутреннее представление: {repr(base_form_norm)}")
                        
                        # Пытаемся найти похожий ключ в кэше
                        found_similar = False
                        for key in all_cache_keys:
                            if key.strip() == base_form_norm:
                                print(f"\nНАЙДЕН ПОХОЖИЙ КЛЮЧ В КЭШЕ: '{key}'")
                                print(f"  - Его внутреннее представление: {repr(key)}")
                                print("  - ПРИЧИНА СБОЯ: Вероятно, скрытые пробелы или невидимые символы.")
                                found_similar = True
                                break
                        
                        if not found_similar:
                            print("\nПохожих ключей в кэше не найдено. Проблема может быть в другом.")

                        print("-" * 30 + "\n")
                        failures_found += 1
                        if failures_found >= failures_to_show:
                            break
    
    if failures_found == 0:
        print("Странно, диагностика не выявила несоответствий. Проблема может быть сложнее.")