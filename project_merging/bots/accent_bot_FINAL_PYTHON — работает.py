import json
import os
import time
import unicodedata
import re
import signal

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.firefox.service import Service as FirefoxService
from selenium.webdriver.firefox.options import Options as FirefoxOptions
from webdriver_manager.firefox import GeckoDriverManager

# --- НАСТРОЙКИ ---
INPUT_FILE = './words_to_accent.txt'
OUTPUT_FILE = './new_accents.json'
CACHE_FILE = './accent_cache.json'
PAGE_URL = 'https://kalbu.vdu.lt/mokymosi-priemones/kirciuoklis/'

# --- ПАРАМЕТРЫ ---
TEST_MODE = True
WORDS_PER_BATCH = 20
REQUEST_DELAY_S = 2
BATCHES_BEFORE_PAUSE = 100
BATCH_DELAY_MINUTES = 1

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f: return json.load(f)
        except json.JSONDecodeError: return {}
    return {}

def save_cache(cache):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

def create_driver():
    print("   (Инициализирую Firefox драйвер...)")
    options = FirefoxOptions()
    options.headless = False # Поставьте True для работы в фоне
    service = FirefoxService(GeckoDriverManager().install())
    driver = webdriver.Firefox(service=service, options=options)
    print("   (Драйвер готов)")
    return driver

def process_batch_via_ui(driver, words):
    text_block = "\n".join(words)
    results = {w: [] for w in words}
    wait = WebDriverWait(driver, 20)
    
    textarea = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'textarea[name="text"]')))
    textarea.clear()
    textarea.send_keys(text_block)
    
    print("   (Текст вставлен, ожидаю автоматического результата...)")
    # Ждем, пока появится хотя бы одно слово
    wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, 'div#destination span.word')))

    # Находим все элементы-слова
    word_elements = driver.find_elements(By.CSS_SELECTOR, 'div#destination span.word')
    
    print(f"   (Найдено {len(word_elements)} слов с ударениями)")

    for element in word_elements:
        try:
            accented_word = element.text
            original_word = element.get_attribute('data-original')
            
            if original_word and original_word in results:
                if accented_word not in results[original_word]:
                    results[original_word].append(accented_word)
        except Exception as e:
            print(f"     ❗️ Ошибка при парсинге отдельного слова: {e}")
            
    return results

if __name__ == "__main__":
    print('--- Запуск ФИНАЛЬНОГО бота (v5 - "Глупый, но надежный") ---')

    all_words = []
    if os.path.exists(INPUT_FILE):
        with open(INPUT_FILE, 'r', encoding='utf-8') as f:
            all_words = [line.strip() for line in f if line.strip()]
    
    if not all_words: print(f"Файл '{INPUT_FILE}' пуст или не найден."); exit()

    accent_cache = load_cache()
    words_to_process = sorted(list(set(w for w in all_words if w not in accent_cache)))
    
    # Список слов, которые будут обработаны в этой сессии
    session_words = words_to_process
    if TEST_MODE:
        print("!!! РАБОТА В ТЕСТОВОМ РЕЖИМЕ !!!")
        session_words = words_to_process[:WORDS_PER_BATCH]

    print(f"Всего слов: {len(set(all_words))}, к обработке в этой сессии: {len(session_words)}")
    if not session_words: print("Все слова уже обработаны."); exit()

    driver_instance = None
    def signal_handler(sig, frame):
        print('\n!!! Прерывание. Сохраняю и закрываю...')
        if driver_instance: driver_instance.quit()
        save_cache(accent_cache)
        exit(0)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        driver_instance = create_driver()
        driver_instance.get(PAGE_URL)
        try:
            WebDriverWait(driver_instance, 5).until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'a[onclick*="writeCookie"]'))).click()
            print("   (Баннер cookie нажат)")
        except TimeoutException:
            print("   (Баннер cookie не найден)")

        batches = [session_words[i:i + WORDS_PER_BATCH] for i in range(0, len(session_words), WORDS_PER_BATCH)]
        
        for i, batch in enumerate(batches):
            print(f"[Пачка {i + 1}/{len(batches)}] Обрабатываю {len(batch)} слов...")
            try:
                parsed_results = process_batch_via_ui(driver_instance, batch)
                for word, accented_list in parsed_results.items():
                    accent_cache[word] = accented_list
                    print(f"  -> {word}: {'✅' if accented_list else '❌'}")
                time.sleep(REQUEST_DELAY_S)
            except Exception as e:
                print(f"     🔥 Ошибка при обработке пачки: {e}")
                # --- ОТЛАДКА: Сохраняем HTML страницы в момент ошибки ---
                try:
                    debug_file = 'debug_page_source.html'
                    with open(debug_file, 'w', encoding='utf-8') as f:
                        f.write(driver_instance.page_source)
                    print(f"     ✅ HTML страницы сохранен в файл: {debug_file}")
                except Exception as save_e:
                    print(f"     ❗️ Не удалось сохранить HTML для отладки: {save_e}")
                # --- КОНЕЦ ОТЛАДКИ ---
                for word in batch: accent_cache[word] = []
        
    finally:
        if driver_instance: print("Закрываю браузер..."); driver_instance.quit()
        
        print("\nОбработка завершена.")
        save_cache(accent_cache)
        
        # --- ИСПРАВЛЕНИЕ: СОХРАНЯЕМ ТОЛЬКО ТО, ЧТО ОБРАБОТАЛИ В ТЕСТЕ ---
        output_data = {}
        if TEST_MODE:
            # В тестовом режиме в финальный файл идут только слова из этой сессии
            for word in session_words:
                output_data[word] = accent_cache.get(word, [])
        else:
            # В полном режиме - все слова из исходного файла
            output_data = {word: accent_cache.get(word, []) for word in all_words}

        with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
            json.dump(output_data, f, ensure_ascii=False, indent=2)
        print(f"✅ Финальный результат сохранен в '{OUTPUT_FILE}'.")