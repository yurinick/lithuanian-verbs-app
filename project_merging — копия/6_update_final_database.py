import json
import os
import sqlite3
import shutil

# --- НАСТРОЙКИ ---
# Исходная база, которую мы используем как шаблон
SOURCE_DB_PATH = './verbs_BEFORE.sqlite'
# Финальный, обогащенный JSON, который мы будем записывать
ENRICHED_JSON_PATH = './conjugations_fully_enriched.json'
# Название для нашей новой, чистой базы данных
FINAL_DB_PATH = './verbs_FINAL.sqlite'

if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/project_merging'
    # Устанавливаем полные пути
    source_db = os.path.join(PROJECT_DIR, SOURCE_DB_PATH)
    enriched_json = os.path.join(PROJECT_DIR, ENRICHED_JSON_PATH)
    final_db = os.path.join(PROJECT_DIR, FINAL_DB_PATH)

    print("--- Финальный этап: Запись обогащенных данных в новую базу SQLite ---")

    # --- 1. Проверка наличия файлов ---
    if not os.path.exists(source_db):
        print(f"!!! ОШИБКА: Исходная база данных '{source_db}' не найдена.")
        exit()
    if not os.path.exists(enriched_json):
        print(f"!!! ОШИБКА: Файл с обогащенными данными '{enriched_json}' не найден.")
        exit()

    # --- 2. Создание новой базы данных ---
    print(f"Создаю новую базу данных '{os.path.basename(final_db)}' на основе шаблона...")
    # Копируем исходную базу, чтобы сохранить всю структуру и все остальные данные
    shutil.copyfile(source_db, final_db)
    print("   Новая база данных успешно создана.")

    # --- 3. Загрузка обогащенных данных ---
    print(f"Загружаю данные из '{os.path.basename(enriched_json)}'...")
    with open(enriched_json, 'r', encoding='utf-8') as f:
        enriched_data = json.load(f)
    print(f"   Загружено {len(enriched_data)} глаголов для обновления.")

    # --- 4. Обновление записей в новой базе ---
    print("Начинаю обновление записей в базе данных...")
    
    connection = None
    updated_count = 0
    failed_count = 0
    try:
        connection = sqlite3.connect(final_db)
        cursor = connection.cursor()

        # Начинаем транзакцию для ускорения массовых обновлений
        cursor.execute("BEGIN TRANSACTION;")

        for infinitive, verb_data in enriched_data.items():
            # Преобразуем объект Python обратно в строку JSON для записи в базу
            json_string = json.dumps(verb_data, ensure_ascii=False)
            
            # Используем параметризованный запрос для безопасности
            update_query = "UPDATE verbs SET conjugations = ? WHERE infinitive = ?"
            
            cursor.execute(update_query, (json_string, infinitive))
            
            # Проверяем, была ли запись реально обновлена
            if cursor.rowcount > 0:
                updated_count += 1
            else:
                failed_count += 1
                print(f"   ❗️ Предупреждение: Не удалось найти глагол '{infinitive}' в базе для обновления.")

        # Завершаем транзакцию
        connection.commit()
        
        print("\nОбновление завершено.")
        print(f"   ✅ Успешно обновлено: {updated_count} записей.")
        if failed_count > 0:
            print(f"   ❌ Не удалось обновить: {failed_count} записей (не найдены в базе).")

    except sqlite3.Error as e:
        print(f"!!! КРИТИЧЕСКАЯ ОШИБКА БАЗЫ ДАННЫХ: {e}")
        # Откатываем изменения в случае ошибки
        if connection:
            connection.rollback()
    finally:
        if connection:
            connection.close()

    print("\n========================================================")
    print("🎉🎉🎉 ПРОЕКТ УСПЕШНО ЗАВЕРШЕН! 🎉🎉🎉")
    print(f"Ваша новая, чистая и обогащенная база данных готова:")
    print(f"  - {os.path.basename(final_db)}")