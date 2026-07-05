# BrowserOS — editor engine spike (M7-C)

Изолированное сравнение CodeMirror 6 и Monaco 0.57.0. **Выбран CodeMirror 6 для
следующего шага интеграции.** В BrowserOS по-прежнему используется textarea;
корневые package.json/package-lock.json и production source не меняются.

Зависимости кандидатов установлены только в этой private-папке. Собственные
package.json и lockfile фиксируют версии; Vite, TypeScript и Playwright берутся из
корневого проекта. Специальный React wrapper или bundler plugin не требуется.

## Повторить

Из корня BrowserOS (Node совместимый с корневым lockfile):

```bash
npm ci
npm ci --prefix tools/editor-spike --ignore-scripts
npx playwright install chromium
npm run lint --prefix tools/editor-spike
npm run typecheck --prefix tools/editor-spike
npm run build --prefix tools/editor-spike
npm run measure --prefix tools/editor-spike
```

measure.mjs запускает локальный HTTP сервер на свободном порту, headless Chromium,
проверяет оба кандидата и закрывает сервер/браузер в finally. results.json содержит
результат текущего прогона; timing зависит от машины и перезаписывается при запуске.
dist и node_modules игнорируются Git. После установки кандидатов root lint
проверяет browser TypeScript spike; его строгая компиляция запускается отдельно.

Посмотреть вручную:

```bash
npm run preview --prefix tools/editor-spike
```

Открыть http://127.0.0.1:4175. Кнопка Save и Ctrl/Cmd+S только увеличивают счётчик;
прототип не записывает VFS, не исполняет код, не заменяет приложение Code Editor.

## Измеренный результат, 06.10.2026

Node24.18.0, Chromium153.0.8010.12, root Vite8.3.2. Детали/пути всех полученных assets
в results.json. Размеры — сумма уникальных JS/CSS/font/worker ресурсов после клика;
начальный harness исключён. Gzip рассчитан offline gzipSync, сервер отдаёт raw.

| Проверка                                    |               CodeMirror |       Monaco |
| ------------------------------------------- | -----------------------: | -----------: |
| Cold payload raw                            |                421 912 B | 11 590 063 B |
| Оценка gzip                                 |                141 235 B |  2 709 514 B |
| Клик → ready UI                             |                   121 ms |       145 ms |
| Клик → initial diagnostics ready            | 122 ms (без diagnostics) |       306 ms |
| Замена multiline 1 MiB + 2 animation frames |                    50 ms |        48 ms |
| Вызовы mount/dispose                        |                    11/11 |        11/11 |
| Живые owned models/views после dispose      |                      0/0 |          0/0 |
| Общие workers после цикла                   |                        0 |            1 |
| Горизонтальный overflow при 375px           |                      нет |          нет |

Это один локальный прогон без network/CPU throttling, не универсальный benchmark.
Monaco использует стандартный public entry + настоящие JS/TS language services,
CodeMirror — выбранные editing/search/history/JS/TS syntax extensions без semantic
language service. Функции не эквивалентны: дополнительный вес Monaco покупает более
широкие возможности. Не заявляем, что это минимально возможный размер Monaco.
11 dispose и стабильные счётчики не доказывают отсутствие heap leaks. Workers Monaco
пулит на уровне движка, поэтому model.dispose не означает worker.terminate.

## Что проверяет harness

- В boot нет engine/worker fetch; импорт происходит после выбора кандидата.
- Unicode editing, undo, find, light/dark reconfiguration, Ctrl/Cmd+S bridge.
- Synthetic composition blocks save. Это не проверка настоящей ОС IME.
- External replace не вызывает onChange и сбрасывает старую историю undo.
- Tab выводит фокус на Save; Monaco настроен tabFocusMode, CodeMirror не перехватывает Tab.
- Узкий viewport и bounded multiline 1 MiB; actual TypeScript syntax worker для Monaco.
- 11 mount/dispose, owned model/view cleanup, bounded worker/shared-model counters.
- Отказ lazy chunk у каждого кандидата сохраняет editable textarea/черновик.
- Позднее завершение import после dispose не создаёт новый редактор.

Настоящий touchscreen/мобильная клавиатура, Firefox/WebKit, VoiceOver, forced colors,
контраст syntax palette, heap/timer profiling не проверены. Narrow desktop Chromium
не равен поддержке мобильных браузеров. Импорт failure — smoke fallback, ещё не
production error boundary или тест связи с document session.

Uniform CRLF probe: default CodeMirror projection нормализует в LF, Monaco
сохраняет CRLF. Canonical buffer prototype не переписан. В Node проверен способ
сохранения uniform CRLF через EditorState.lineSeparator + sliceDoc; это ещё не
production bridge. M7-D обязан проверить browser round-trip LF/CRLF и явно решить
политику mixed line endings (например, оставить textarea), без скрытого преобразования.

## Решение и следующий шаг

CodeMirror покрывает выбранный scope без language-server/worker слоя и оставляет
меньше интеграционной работы одному разработчику. Monaco стоит пересмотреть при
обязательной семантике TypeScript, IntelliSense, minimap/diff/LSP. BrowserOS остаётся
владельцем buffer/revision/save/conflict/close; engine — проекция с UI undo/selection.

M7-D: ленивый React adapter через custom hook, состояние undo/selection по tab ID,
активный EditorView и dispose, scoped theme/grammar, внешний reload без edit echo,
load-failure textarea, доступная метка Code и Tab escape. Проверить настоящие
Files→Editor→Terminal→reload/dirty close/conflict с движком. Детальный ADR-007 и
план находятся в локальной docs/ (по существующему .gitignore).

Источники: [CodeMirror базовый пример](https://codemirror.net/examples/basic/),
[Tab и keyboard trap](https://codemirror.net/examples/tab/),
[официальные возможности CodeMirror](https://github.com/codemirror/website/blob/main/site/index.html),
[Monaco FAQ](https://github.com/microsoft/monaco-editor#faq),
[Vite workers](https://vite.dev/guide/features.html#web-workers).
