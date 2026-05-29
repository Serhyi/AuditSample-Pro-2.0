/**
 * Коефіцієнти надійності для аудиторської вибірки.
 *
 * MUS та інші методи, що базуються на кількості грошових помилок, моделюють
 * число помилок розподілом Пуассона. Тому розмір вибірки масштабується
 * reliability factor з таблиці Пуассона при нульових очікуваних помилках
 * (а НЕ z-значенням нормального розподілу). Для 95% довіри це ≈3.0, тоді як
 * z-score нормального розподілу — лише 1.96.
 *
 * Класичні змінні методи (CVS, Random, Cluster) моделюють похибку нормально,
 * тому для побудови довірчого інтервалу там використовується z-score.
 *
 * Винесено в один модуль, щоб усунути дублювання таблиць у samplingEngine,
 * SamplingService, resultsUtils та mus.
 */

/**
 * Reliability factor (коефіцієнт надійності) з таблиці Пуассона при нульових
 * очікуваних помилках. Використовується для MUS-подібних методів.
 */
export function getReliabilityFactor(confidenceLevel: number): number {
    switch (confidenceLevel) {
        case 70: return 1.20;
        case 80: return 1.61;
        case 90: return 2.31;
        case 95: return 3.00;
        case 99: return 4.61;
        default: return 3.00; // 95% за замовчуванням
    }
}

/**
 * z-значення стандартного нормального розподілу (двосторонній інтервал).
 * Використовується для класичних змінних методів (CVS, Random, Cluster).
 */
export function getZScore(confidenceLevel: number): number {
    switch (confidenceLevel) {
        case 70: return 1.04;
        case 80: return 1.28;
        case 90: return 1.64;
        case 95: return 1.96;
        case 99: return 2.58;
        default: return 1.96; // 95% за замовчуванням
    }
}

/**
 * Expansion factor (коефіцієнт розширення) за таблицею AICPA для MUS.
 *
 * Коли аудитор очікує ненульові помилки, знаменник формули розміру вибірки
 * зменшується на Expected Misstatement × Expansion Factor. Цей коефіцієнт
 * враховує невизначеність прогнозу помилок: чим вища довіра, тим більший
 * запас закладається.
 *
 *   n = (Population Value × RF) / (TM − Expected Misstatement × EF)
 */
export function getExpansionFactor(confidenceLevel: number): number {
    switch (confidenceLevel) {
        case 70: return 1.20;
        case 80: return 1.30;
        case 90: return 1.50;
        case 95: return 1.60;
        case 99: return 1.90;
        default: return 1.60; // 95% за замовчуванням
    }
}
