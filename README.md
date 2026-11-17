# TypeFlow — Minimalist Typing Practice Website

An original, distraction-free touch typing and **code typing** website made for Web Programming (IN206).

## Run the website

1. Unzip this project.
2. Open `index.html` in Chrome, Edge or Firefox. No installation or internet required.
3. Alternatively, in this folder run `python -m http.server 8000` and visit http://localhost:8000/.

All files are local and require **no third-party dependencies**.

## Features

- **Test** — words, quotes and code, 15 / 30 / 60-second tests **or 10 / 25 / 50 / 100-word tests**, plus completion-based quotes in five length options, live WPM / accuracy / error counts, automatic results when time expires or the last word is typed, restart.
- **Low-latency caret** — character positions are measured once when creating a prompt, not during typing; the cursor uses configurable 0 / 22 / 72 ms compositor transitions. Only changed character spans are repainted. Honors reduced-motion settings.
- **New color theme** — almost-black forest background with calm green highlights.
- **Code mode** — choose JavaScript, Python, C++, HTML, or CSS; type real code snippets with punctuation, spaces and line breaks. Pressing Tab inserts indentation: four spaces for Python, two for other code languages. This is *typing practice*, not a compiler or coding course.
- **Practice** — six guided beginner exercises, live feedback, next-key highlighting.
- **Progress** — browser-local history, averages, personal best, speed chart, clear history.
- **About** — explains the connection to UN SDG 4: free and self-paced learning opportunities.
- Responsive minimalist design inspired by the focus-first philosophy of typing websites; self-contained dark and light themes.

## WPM calculations

- Accuracy = correctly typed characters at their current positions / all currently typed characters × 100.
- WPM = (correctly typed characters / 5) / elapsed minutes.
- Errors = count of currently incorrect character positions. Backspace removes an error from this count.
- Timing starts on the first character entered. Timed tests end when the timer runs out. Word-count tests (Words and Code modes) finish after the selected number of whitespace-separated words/tokens are typed; their time is measured upward. In Code mode the prompt may end mid-snippet, which is intentional because this is typing practice, not compilation. Quotes instead finish when the full passage is typed; their elapsed time counts upward. Quote lengths: short (1–100 characters), medium (101–300), long (301–600), thicc (601+) and all.
- Scores are practice metrics, not standardized measurements. If users finish a very short test, WPM may vary more than in a full-length session.

## How it works

| File | Purpose |
|---|---|
| `index.html` | Typing test interface and results dialogue |
| `practice.html` | Guided lessons and visual keyboard |
| `progress.html` | Personal history, aggregate metrics and chart |
| `about.html` | Mission, features and SDG 4 rationale |
| `assets/style.css` | Design system, desktop/mobile layouts, light mode |
| `assets/app.js` | Typing engine, code snippets, timer, storage, analytics |

## Data and privacy

Only browser `localStorage` is used to persist results and theme. No registration, database, APIs, trackers, or accounts. Deleting site data removes local progress. Browsers may restrict localStorage on `file://`; the local HTTP server option avoids inconsistent restrictions.

## Before the November 27 proposal / progress demo

- Test word, quote and each of the five code languages.
- Test 15-second timer end, reset, result dialog, and Progress page.
- Show the practice page and the SDG 4 section.
- Add your own name / student ID to your slides and take screenshots of the actual running project.
- Be ready to explain how JavaScript events, WPM, accuracy and localStorage work.

UN SDG 4 background: https://sdgs.un.org/goals/goal4

## Limitations

This is a prototype; there is no multiplayer, account syncing, login, backend or code execution. Best experience is with a physical keyboard. For the class demo, validate behavior in your browser and screen size first.

## Changes in v3

- Much darker forest-black interface with green accents across the site.
- Smooth animated thin caret without the per-keystroke DOM rebuild and caret blink.
- Time / Words selector for the Words and Code modes; choose 10, 25, 50 or 100 words.
- Elapsed timer and live number of completed words in word-count mode.
- Progress history labels distinguish 30s tests from 25-word tests. Previous local history is still readable.

## Changes in v4

- Reduced caret transform time from 95 ms to 48 ms for a snappier response.
- Removed per-keystroke `getBoundingClientRect()` reads; caret coordinates are cached at prompt creation and on window resize.
- Counts correct typed characters incrementally to avoid scanning the entire input repeatedly while typing.
- **Code Mode now supports word-count tests (10, 25, 50, 100)** for all five languages, as well as timed tests. A code word means a consecutive run of non-whitespace characters; punctuation attached to it is included.
- In v4, quotes were still timed; v5 replaces this with completion-based quote lengths.

## Quick manual verification

1. Open the index page. Set **Code → Words → 10**, select **C++** and type until the result modal opens.
2. Try switching to Python, JavaScript, HTML, CSS and verify each displays a 10-token prompt.
3. Set **Code → Time → 15**, start typing and verify it ends after 15 seconds.
4. Switch to **Words → Words → 25** and finish the last word.
5. Check **Progress** for results. Clear history only if desired.

For best performance, run the website in a desktop browser (Chrome/Edge/Firefox); any remaining lag might depend on browser rendering, extensions, or OS settings.

## Changes in v5

- Quotes now have All, Short, Medium, Long, and Thicc length controls, selecting original full passages rather than repeating sentences.
- Quote tests are completion-based with elapsed time, and show quote length in results and progress history.
- Caret offers Instant (0 ms), Fast (22 ms, default), and Smooth (72 ms) modes, saved locally. Moves between lines snap directly; DOM coordinate reads remain outside the typing hot path.
- Timer uses 100 ms intervals rather than continuous animation frames; input stats are deferred to the next paint.
- Existing Code Words and timed modes preserved.
- Initial page focus and the global printable-key handler avoid losing the first keystroke.


## v6 — responsive caret experiment
- Reviewed side-by-side user recordings with Monkeytype and TypeFlow.
- Cursor position is now coalesced to one update per animation frame.
- The previous caret animation is interrupted and a fresh animation starts from the *predicted on-screen position*, without layout reads on input.
- Native Web Animations API interpolates the transform on the browser compositor.
- Smooth: adaptive 36–85 ms; Fast: adaptive 36–55 ms; Instant: 0 ms.
- Existing test modes, Quote lengths, and Code Words modes are unchanged.
- Animation is an approximation, not a copy of Monkeytype's implementation.
