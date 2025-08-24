import sqlite3
import json
import os

def extract_conjugations_to_json(db_path, output_path):
    """
    Извлекает инфинитивы и JSON-спряжения из базы данных SQLite
    и сохраняет их в виде одного большого JSON-файла.

    Args:
        db_path (str): Путь к файлу базы данных SQLite.
        output_path (str): Путь для сохранения итогового JSON-файла.
    """
    print(f"\n--- Обработка базы данных: {os.path.basename(db_path)} ---")
    
    if not os.path.exists(db_path):
        print(f"!!! ОШИБКА: Файл базы данных не найден по пути: {db_path}")
        return

    # Словарь для хранения данных: { "infinitive": { ...parsed_json... } }
    all_conjugations = {}
    
    connection = None
    try:
        connection = sqlite3.connect(db_path)
        cursor = connection.cursor()
        
        query = "SELECT infinitive, conjugations FROM verbs WHERE conjugations IS NOT NULL AND conjugations != ''"
        print(f"Выполняю запрос...")
        
        cursor.execute(query)
        rows = cursor.fetchall()
        
        print(f"Найдено {len(rows)} строк для извлечения.")
        
        error_count = 0
        for infinitive, conjugations_str in rows:
            if infinitive in all_conjugations:
                print(f"  Предупреждение: Дубликат инфинитива '{infinitive}'. Предыдущее значение будет перезаписано.")
            
            try:
                # Сразу преобразуем строку JSON в объект Python
                all_conjugations[infinitive] = json.loads(conjugations_str)
            except json.JSONDecodeError:
                error_count += 1
                print(f"  Ошибка: Не удалось разобрать JSON для инфинитива '{infinitive}'. Запись пропущена.")
                
        if error_count > 0:
            print(f"Количество строк с ошибками JSON: {error_count}")

        # Сохраняем итоговый словарь в файл
        print(f"Сохраняю {len(all_conjugations)} глаголов в файл: {os.path.basename(output_path)}...")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(all_conjugations, f, ensure_ascii=False, indent=4)
            
        print(f"✅ Успешно сохранено.")

    except sqlite3.Error as e:
        print(f"!!! ОШИБКА БАЗЫ ДАННЫХ: {e}")
    finally:
        if connection:
            connection.close()

# --- ОСНОВНОЙ БЛОК ВЫПОЛНЕНИЯ ---
if __name__ == "__main__":
    # Указываем путь к папке проекта
    PROJECT_DIR = '/Users/yuri/Documents/[AI]/lithuanian-verbs-app/New'
    
    # Определяем все необходимые пути
    DB_BEFORE_PATH = os.path.join(PROJECT_DIR, 'verbs_BEFORE.sqlite')
    DB_AFTER_PATH = os.path.join(PROJECT_DIR, 'verbs_AFTER.sqlite')
    OUTPUT_BEFORE_PATH = os.path.join(PROJECT_DIR, 'conjugations_before.json')
    OUTPUT_AFTER_PATH = os.path.join(PROJECT_DIR, 'conjugations_after.json')

    print("--- Фаза 1, Шаг 1.1: Извлечение данных из баз ---")
    
    # Извлекаем данные из "ДО"
    extract_conjugations_to_json(DB_BEFORE_PATH, OUTPUT_BEFORE_PATH)
    
    # Извлекаем данные из "ПОСЛЕ"
    extract_conjugations_to_json(DB_AFTER_PATH, OUTPUT_AFTER_PATH)

    print("\n========================================================")
    print("✅ Фаза 1, Шаг 1.1 успешно завершена!")
    print("В вашей папке проекта теперь должны находиться два новых файла:")
    print(f"  - {os.path.basename(OUTPUT_BEFORE_PATH)}")
    print(f"  - {os.path.basename(OUTPUT_AFTER_PATH)}")
    print("Мы готовы к Шагу 1.2: Сведение и очистка ударений.")