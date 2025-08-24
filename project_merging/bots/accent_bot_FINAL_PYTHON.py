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
TEST_MODE = False
WORDS_PER_BATCH = 50
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
    print("   (Перезагружаю страницу для чистоты эксперимента...)")
    driver.refresh()
    # После перезагрузки нужно снова нажать на баннер
    try:
        WebDriverWait(driver, 5).until(EC.element_to_be_clickable((By.CSS_SELECTOR, 'a[onclick*="writeCookie"]'))).click()
    except TimeoutException:
        pass # Баннера может и не быть
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
    
    print(f"   (Найдено {len(word_elements)} слов. Начинаю сбор морфологии...)")

    for element in word_elements:
        try:
            accented_word = element.text
            original_word = element.get_attribute('data-original')
            
            if original_word and original_word in results:
                # Кликаем на слово, чтобы появилась информация (через JavaScript, чтобы избежать перекрытия)
                driver.execute_script("arguments[0].click();", element)
                
                # Ждем, пока информация обновится для текущего слова
                info_div_selector = (By.ID, 'rezf1')
                time.sleep(0.1) # Небольшая пауза, чтобы избежать гонки с AJAX
                wait.until(EC.text_to_be_present_in_element(info_div_selector, accented_word))
                
                # Забираем информацию
                morph_info = driver.find_element(*info_div_selector).text
                
                # Сохраняем в новой структуре
                new_entry = {"accented": accented_word, "info": morph_info}

                if new_entry not in results[original_word]:
                    results[original_word].append(new_entry)

        except Exception as e:
            print(f"     ❗️ Ошибка при парсинге морфологии слова '{original_word}': {e}")
            
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