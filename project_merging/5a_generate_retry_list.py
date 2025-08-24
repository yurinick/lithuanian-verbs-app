import json
import os

# --- НАСТРОЙКИ ---
INPUT_FILE = './words_to_accent.txt'
CACHE_FILE = './accent_cache.json'
RETRY_FILE = './words_to_retry.txt'

if __name__ == "__main__":
    print('--- Анализ кэша и создание списка для повторной попытки ---')

    # 1. Загружаем полный список слов, которые должны были быть обработаны
    if not os.path.exists(INPUT_FILE):
        print(f"!!! ОШИБКА: Исходный файл не найден: {INPUT_FILE}")
        exit()
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        all_words = set(line.strip() for line in f if line.strip())
    print(f"Найдено {len(all_words)} уникальных слов в исходном задании.")

    # 2. Загружаем кэш с результатами
    if not os.path.exists(CACHE_FILE):
        print(f"!!! ОШИБКА: Файл кэша не найден: {CACHE_FILE}")
        print("!!! Убедитесь, что основной бот завершил свою работу.")
        exit()
    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        accent_cache = json.load(f)
    print(f"Загружено {len(accent_cache)} записей из кэша.")

    # 3. Находим слова, которые нужно обработать заново
    words_to_retry = []
    for word in all_words:
        # Слово нужно повторить, если:
        # 1. Его вообще нет в кэше (скрипт мог прерваться раньше).
        # 2. Оно есть в кэше, но его результат - пустой список [] (признак ошибки).
        if word not in accent_cache or not accent_cache[word]:
            words_to_retry.append(word)

    print(f"\nНайдено {len(words_to_retry)} слов для повторной попытки.")

    if not words_to_retry:
        print("Отличная работа! Повторная обработка не требуется.")
    else:
        # 4. Сохраняем отсортированный список в файл
        with open(RETRY_FILE, 'w', encoding='utf-8') as f:
            f.write("\n".join(sorted(words_to_retry)))
        print(f"✅ Список для повторной обработки сохранен в файл: {RETRY_FILE}")