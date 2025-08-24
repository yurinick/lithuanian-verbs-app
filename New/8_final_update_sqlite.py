import json
import os
import sqlite3
import shutil
import time

# --- НАСТРОЙКИ ---
# Финальный, исправленный JSON, который мы будем записывать
CORRECTED_JSON_PATH = './conjugations_tegu_fixed.json'
# База данных, которую мы будем обновлять
DATABASE_TO_UPDATE_PATH = './verbs_AFTER.sqlite'

if __name__ == "__main__":
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/New'
    # Устанавливаем полные пути
    corrected_json = os.path.join(PROJECT_DIR, CORRECTED_JSON_PATH)
    db_to_update = os.path.join(PROJECT_DIR, DATABASE_TO_UPDATE_PATH)

    print("--- Финальный этап: Перезапись данных в SQLite ---")

    # --- 1. Проверка наличия файлов ---
    if not os.path.exists(db_to_update):
        print(f"!!! ОШИБКА: База данных '{db_to_update}' не найдена.")
        exit()
    if not os.path.exists(corrected_json):
        print(f"!!! ОШИБКА: Файл с исправленными данными '{corrected_json}' не найден.")
        exit()

    # --- 2. Автоматическое создание резервной копии ---
    backup_path = f"{db_to_update}.backup_{int(time.time())}"
    print(f"Создаю резервную копию базы данных: '{os.path.basename(backup_path)}'...")
    shutil.copyfile(db_to_update, backup_path)
    print("   Резервная копия успешно создана.")

    # --- 3. Загрузка исправленных данных ---
    print(f"Загружаю данные из '{os.path.basename(corrected_json)}'...")
    with open(corrected_json, 'r', encoding='utf-8') as f:
        corrected_data = json.load(f)
    print(f"   Загружено {len(corrected_data)} глаголов для обновления.")

    # --- 4. Обновление записей в базе ---
    print(f"Начинаю обновление записей в '{os.path.basename(db_to_update)}'...")
    
    connection = None
    updated_count = 0
    failed_count = 0
    try:
        connection = sqlite3.connect(db_to_update)
        cursor = connection.cursor()
        cursor.execute("BEGIN TRANSACTION;")

        for infinitive, verb_data in corrected_data.items():
            json_string = json.dumps(verb_data, ensure_ascii=False)
            update_query = "UPDATE verbs SET conjugations = ? WHERE infinitive = ?"
            cursor.execute(update_query, (json_string, infinitive))
            
            if cursor.rowcount > 0:
                updated_count += 1
            else:
                failed_count += 1
                print(f"   ❗️ Предупреждение: Не удалось найти глагол '{infinitive}' в базе для обновления.")

        connection.commit()
        
        print("\nОбновление завершено.")
        print(f"   ✅ Успешно обновлено: {updated_count} записей.")
        if failed_count > 0:
            print(f"   ❌ Не удалось обновить: {failed_count} записей (не найдены в базе).")

    except sqlite3.Error as e:
        print(f"!!! КРИТИЧЕСКАЯ ОШИБКА БАЗЫ ДАННЫХ: {e}")
        if connection:
            connection.rollback()
    finally:
        if connection:
            connection.close()

    print("\n========================================================")
    print("🎉🎉🎉 ПРОЕКТ УСПЕШНО ЗАВЕРШЕН! 🎉🎉🎉")
    print("Ваша база данных была успешно обновлена исправленными данными.")