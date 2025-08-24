import json
import os

# --- НАСТРОЙКИ ---
RETRY_FILE = './words_to_retry.txt'
CACHE_FILE = './accent_cache.json'

if __name__ == "__main__":
    print('--- Утилита очистки кэша для повторной обработки ---')

    # 1. Загружаем список слов, которые нужно удалить из кэша
    if not os.path.exists(RETRY_FILE):
        print(f"!!! ОШИБКА: Файл со списком для повтора не найден: {RETRY_FILE}")
        exit()
    with open(RETRY_FILE, 'r', encoding='utf-8') as f:
        # Используем set для сверхбыстрой проверки
        words_to_remove = set(line.strip() for line in f if line.strip())
    print(f"Найдено {len(words_to_remove)} слов, которые нужно очистить из кэша.")

    # 2. Загружаем кэш
    if not os.path.exists(CACHE_FILE):
        print(f"!!! ОШИБКА: Файл кэша не найден: {CACHE_FILE}")
        exit()
    with open(CACHE_FILE, 'r', encoding='utf-8') as f:
        accent_cache = json.load(f)
    
    initial_cache_size = len(accent_cache)
    print(f"Исходный размер кэша: {initial_cache_size} записей.")

    # 3. Удаляем ключи
    removed_count = 0
    for word in words_to_remove:
        if word in accent_cache:
            del accent_cache[word]
            removed_count += 1
            
    print(f"Удалено {removed_count} записей из кэша.")
    
    # 4. Сохраняем очищенный кэш
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(accent_cache, f, ensure_ascii=False, indent=2)
        
    final_cache_size = len(accent_cache)
    print(f"Финальный размер кэша: {final_cache_size} записей.")
    print(f"✅ Файл '{CACHE_FILE}' успешно очищен и сохранен.")