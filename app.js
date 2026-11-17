'use strict';
/* TypeFlow — dependency-free browser application. Nothing is sent to a server. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const HISTORY_KEY = 'typeflow.results.v1';
  const THEME_KEY = 'typeflow.theme.v1';
  const CARET_KEY = 'typeflow.caret.v1';
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const safeHistory = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  };
  const appendHistory = (result) => {
    try {
      const history = safeHistory();
      history.push(result);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-300)));
    } catch { /* storage may be unavailable in private mode */ }
  };
  const correctCount = (expected, entered) => Array.from(entered).reduce((total, character, index) => total + (character === expected[index] ? 1 : 0), 0);
  const errorCount = (expected, entered) => Math.max(0, entered.length - correctCount(expected, entered));
  const accuracy = (expected, entered) => entered.length ? Math.round(correctCount(expected, entered) / entered.length * 100) : 100;
  const wpm = (expected, entered, seconds) => seconds > 0 ? Math.round((correctCount(expected, entered) / 5) / (seconds / 60)) : 0;

  function setupTheme() {
    let theme = 'dark';
    try { theme = localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { /* ignore */ }
    function apply(nextTheme) {
      document.body.classList.toggle('light', nextTheme === 'light');
      $$('[data-theme-toggle]').forEach(button => {
        button.textContent = nextTheme === 'light' ? '☾' : '☼';
        button.title = 'Switch to ' + (nextTheme === 'light' ? 'dark' : 'light') + ' theme';
        button.setAttribute('aria-label', button.title);
      });
      try { localStorage.setItem(THEME_KEY, nextTheme); } catch { /* ignore */ }
    }
    apply(theme);
    $$('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      theme = document.body.classList.contains('light') ? 'dark' : 'light';
      apply(theme);
    }));
  }

  // A single caret element is animated by the Web Animations API.
  // Each burst of keystrokes coalesces into the latest target on one paint frame,
  // and a new keystroke interrupts the previous movement from its CURRENT visual
  // position rather than restarting at the previous character. Inspired by the
  // publicly documented motion approach of open-source typing trainers.
  const promptViews = new WeakMap();
  const CARET_EASING = 'cubic-bezier(.42,0,.58,1)';

  function easingProgress(time) {
    // Invert the CSS cubic bezier x(t) to match the Web Animation's interpolated
    // position. This avoids a layout-reading getComputedStyle() on every key.
    const p = clamp(time, 0, 1);
    let t = p;
    for (let i = 0; i < 5; i++) {
      const x = 3*.42*(1-t)*(1-t)*t + 3*.58*(1-t)*t*t + t*t*t;
      const dx = 3*.42*(1-t)*(1-t) + 6*(.58-.42)*(1-t)*t + 3*(1-.58)*t*t;
      if (Math.abs(dx) < 0.0001) break;
      t = clamp(t - (x-p)/dx, 0, 1);
    }
    return 3*(1-t)*t*t + t*t*t;
  }

  function stopCaretMotion(view) {
    if (view.caretFrame !== null && view.caretFrame !== undefined) {
      cancelAnimationFrame(view.caretFrame);
      view.caretFrame = null;
    }
    if (view.activeCaretAnimation) {
      view.activeCaretAnimation.cancel();
      view.activeCaretAnimation = null;
    }
    view.activeMotion = null;
    view.pendingCaret = null;
  }

  function cacheCaretPositions(element, view) {
    stopCaretMotion(view);
    // All layout reads are done on initial render or resize, never on keypress.
    const rect = element.getBoundingClientRect();
    const scrollX = element.scrollLeft;
    const scrollY = element.scrollTop;
    view.locations = view.spans.map(node => {
      const r = node.getBoundingClientRect();
      return {x: r.left - rect.left + scrollX,
              y: r.top - rect.top + scrollY,
              height: r.height || 27};
    });
    view.viewportHeight = element.clientHeight;
    view.scrollY = element.scrollTop;
    view.lastAutoScrollLine = null;
    view.lastCaretY = null;
    view.lastCaretX = null;
    view.lastCaretIndex = null;
    view.lastCaretHeight = null;
  }

  function drawCaretFrame(view) {
    view.caretFrame = null;
    const pending = view.pendingCaret;
    view.pendingCaret = null;
    if (!pending || view.caret.hidden) return;
    const {x, y, height, index} = pending;
    const now = performance.now();
    const oldMotion = view.activeMotion;
    let fromX = view.lastCaretX === null ? x : view.lastCaretX;
    if (oldMotion && oldMotion.y === y) {
      const fraction = easingProgress((now - oldMotion.start) / oldMotion.duration);
      fromX = oldMotion.fromX + (oldMotion.toX - oldMotion.fromX) * fraction;
    }
    const lineJump = view.lastCaretY !== null && y !== view.lastCaretY;
    const largeJump = view.lastCaretIndex !== null && Math.abs(index - view.lastCaretIndex) > 3;

    if (view.activeCaretAnimation) {
      view.activeCaretAnimation.cancel();
      view.activeCaretAnimation = null;
    }
    // The DOM's base style is ALWAYS the destination; animations temporarily
    // interpolate above it. There is no class toggle and no CSS transition race.
    if (view.lastCaretHeight !== height) view.caret.style.height = height + 'px';
    const target = `translate3d(${x}px, ${y}px, 0)`;
    view.caret.style.transform = target;
    const mode = document.documentElement.dataset.caretMotion || 'smooth';
    const gap = view.lastMotionAt === null ? Infinity : now - view.lastMotionAt;
    const baseDuration = mode === 'instant' ? 0 : mode === 'fast' ? 55 : 85;
    // Adapt to rapid typing so animations never pile up behind the user's keys.
    const duration = Math.min(baseDuration, Math.max(36, gap * .85));
    const animate = duration > 0 && !lineJump && !largeJump &&
      Math.abs(fromX - x) > .2 && typeof view.caret.animate === 'function';
    if (animate) {
      view.activeCaretAnimation = view.caret.animate([
        {transform:`translate3d(${fromX}px, ${y}px, 0)`},
        {transform:target}
      ], {duration, easing:CARET_EASING, fill:'none'});
      view.activeMotion = {fromX, toX:x, y, duration, start:now};
    } else {
      view.activeMotion = null;
    }
    view.lastCaretX = x;
    view.lastCaretY = y;
    view.lastCaretIndex = index;
    view.lastCaretHeight = height;
    view.lastMotionAt = now;
  }

  function positionCaret(element, view, index) {
    if (!view || view.caret.hidden || !view.locations.length) return;
    const point = view.locations[Math.min(index, view.locations.length-1)];
    view.pendingCaret = {x:Math.max(0, point.x - 2), y:point.y,
                         height:point.height, index};
    // Coalesce multiple keystrokes before the next screen paint.
    if (view.caretFrame === null || view.caretFrame === undefined) {
      view.caretFrame = requestAnimationFrame(() => drawCaretFrame(view));
    }

    // Scroll only at a line boundary; never read DOM geometry during typing.
    const visibleTop = view.scrollY;
    const visibleBottom = visibleTop + view.viewportHeight;
    const pad = Math.max(8, point.height * .45);
    let nextScroll = null;
    if (point.y + point.height > visibleBottom - pad && view.lastAutoScrollLine !== point.y) {
      view.lastAutoScrollLine = point.y;
      nextScroll = Math.max(0, point.y + point.height - view.viewportHeight + point.height * 1.3);
    } else if (point.y < visibleTop + 3 && view.lastAutoScrollLine !== point.y) {
      view.lastAutoScrollLine = point.y;
      nextScroll = Math.max(0, point.y - point.height);
    }
    if (nextScroll !== null) {
      view.scrollY = nextScroll;
      element.scrollTop = nextScroll;
    }
  }

  function paintPrompt(element, expected, entered, finished = false) {
    let view = promptViews.get(element);
    if (!view || view.expected !== expected) {
      const fragment = document.createDocumentFragment();
      const spans = [];
      for (let i = 0; i < expected.length; i++) {
        const node = document.createElement('span');
        node.className = 'char';
        node.textContent = expected[i];
        fragment.appendChild(node);
        spans.push(node);
      }
      const caret = document.createElement('span');
      caret.className = 'flow-caret';
      caret.setAttribute('aria-hidden', 'true');
      fragment.appendChild(caret);
      element.replaceChildren(fragment);
      view = { expected, spans, caret, typed:'', correct:0,
               locations:[], viewportHeight:0, lineHeight:27, lastAutoScrollLine:null,
               caretFrame:null, activeCaretAnimation:null, activeMotion:null,
               pendingCaret:null, lastMotionAt:null };
      promptViews.set(element, view);
      if (!element.dataset.caretScrollBound) {
        element.addEventListener('scroll', () => { const current = promptViews.get(element); if (current) current.scrollY = element.scrollTop; }, {passive:true});
        element.dataset.caretScrollBound = 'yes';
      }
      cacheCaretPositions(element, view);
    }
    const old = view.typed;
    // Fast path for normal append / Backspace; atypical replacements fall back
    // to finding the first changed character.
    let firstDifference = Math.min(old.length, entered.length);
    if (!(entered.startsWith(old) || old.startsWith(entered))) {
      firstDifference = 0;
      while (firstDifference < Math.min(old.length, entered.length) &&
             old[firstDifference] === entered[firstDifference]) firstDifference++;
    }
    const stop = Math.max(old.length, entered.length);
    for (let i = firstDifference; i < stop; i++) {
      const character = view.spans[i];
      if (!character) continue;
      if (i < old.length && old[i] === expected[i]) view.correct--;
      if (i < entered.length && entered[i] === expected[i]) view.correct++;
      character.className = i >= entered.length ? 'char' :
        'char ' + (entered[i] === expected[i] ? 'correct' : 'incorrect');
    }
    view.typed = entered;
    view.caret.hidden = finished || entered.length >= expected.length;
    if (view.caret.hidden) stopCaretMotion(view);
    else positionCaret(element, view, entered.length);
    return view.correct;
  }
  window.addEventListener('resize', () => {
    document.querySelectorAll('.typing-text').forEach(element => {
      const view = promptViews.get(element);
      if (view) {
        cacheCaretPositions(element, view);
        positionCaret(element, view, view.typed.length);
      }
    });
  });
  function attachTypingBehavior(input, stage, getMode, onUpdate, tabSize = () => 2) {
    input.addEventListener('focus', () => stage.classList.add('is-active'));
    input.addEventListener('blur', () => { if (!input.value && !stage.classList.contains('is-done')) stage.classList.remove('is-active'); });
    stage.addEventListener('click', () => {
      if (!input.disabled) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
    input.addEventListener('click', () => input.setSelectionRange(input.value.length, input.value.length));
    input.addEventListener('paste', (event) => event.preventDefault());
    input.addEventListener('drop', (event) => event.preventDefault());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && getMode() === 'code') {
        event.preventDefault();
        input.value += ' '.repeat(tabSize());
        onUpdate();
      } else if (event.key === 'Home' || event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        // Keep the typing position at the end rather than editing older characters.
        event.preventDefault();
      }
    });
  }

  const wordBank = `time world sound dream light focus simple learn better today practice keyboard computer digital study design coding student idea quick calm growth future little music travel story skill work school space clean green start early open new good build typing speed accuracy minute seconds result journey daily people create creative user website challenge easy strong steady action level friend wonderful progress think write find read life home place human learn finger correct slowly build word flow type fresh great feel change point game play begin ending visual small big page lesson keyboard screen system browser technology color size shape online offline positive quality education accessible laptop personal useful software speed memory habit repeat complete exact clear look words phrase smooth rhythm hello world code developer project smart person success review next before end after improve trust update plan chart careful consistent enough every new skill better test training repeat attention mindful fast accurate measure device simple writing quickly choice focus courage purpose quiet calm study improve daily today happy work learn learn repeat focus develop solve practice computer keyboard key types word sentence story people worldwide`;
  const words = wordBank.trim().split(/\s+/);
  // Original TypeFlow passages; lengths mirror common quote-length groups.
  const quoteGroups = {
    "short": [
      "Every new skill begins with one careful attempt.",
      "A quiet mind can find a steady rhythm on a noisy day.",
      "Progress is built in ordinary moments, not only the exciting ones.",
      "Write slowly enough to stay accurate, then let your pace grow.",
      "A good habit makes the difficult work feel possible tomorrow."
    ],
    "medium": [
      "Learning to type is less about racing the clock and more about building trust between your hands and your ideas. At first every key seems far away, but with practice the keyboard becomes a familiar place.",
      "There is something satisfying about finding a rhythm and staying with it. The words stop feeling like obstacles, the cursor follows along, and your attention settles into the simple act of writing clearly.",
      "Some days you type quickly and make mistakes. Other days you slow down and discover that accuracy can be enjoyable on its own. Both kinds of practice teach you something about how you work.",
      "A well-designed tool should make room for the person using it. It should respond when asked, stay quiet when it is not needed, and help an ordinary task feel just a little more pleasant.",
      "You cannot learn every shortcut at once. Start with a few useful keys, repeat them until they feel natural, and add new ones when you are ready. Small steps are surprisingly powerful when they become habits."
    ],
    "long": [
      "At the start of a new project, the empty page can feel more intimidating than the complicated code that will eventually fill it. The trick is to create one small thing that works. Then make it clearer, faster, or easier to use. A button, a timer, and a readable paragraph might not sound impressive on their own, but each one is a promise to the person who will visit your site. Keeping those promises is how a simple project slowly becomes a useful product.",
      "When you learn a physical skill, your progress rarely moves in a straight line. On Monday you may feel fast and confident; on Tuesday every movement seems awkward. The change does not mean you have forgotten what you learned. Your hands and attention are still finding a reliable pattern. Try to notice how often you return to the right keys without looking down. Those quiet improvements matter as much as a new personal record, and they are easier to keep when the practice itself feels comfortable.",
      "The best learning spaces are not always filled with instructions, alerts, or bright colors. Sometimes a calm screen and a clear task are enough. A person opens the page, chooses what to practice, and begins without searching through menus. Useful feedback arrives at the right time: a gentle correction while typing, a result at the end, and a simple view of past progress. Everything else can wait until it genuinely helps."
    ],
    "thicc": [
      "Imagine sitting down at your computer after a long day. You have a few minutes before dinner, and you decide to practice typing instead of opening another distracting page. The screen is quiet. A single passage appears, and you start with the first word. Your fingers hesitate over a difficult combination, then find the next key. One small mistake makes you pause, but there is no reason to rush. You correct it and keep going. As the sentences unfold, you notice that your shoulders have relaxed and your eyes stay on the words instead of the keyboard. The experience is not a competition with strangers or a demand to become perfect. It is simply a chance to become a little more comfortable with a skill you use every day. When you finish, the result gives you information, not a judgment. Tomorrow, you can come back and try again.",
      "The story of a useful website often begins with an ordinary frustration. Someone notices that a task takes too many clicks, the controls are difficult to understand, or an animation feels just a moment slower than it should. Instead of accepting that discomfort, they ask what could change. The first version may be rough. The second might fix the colors. The third might improve the way the page responds to a keyboard. Little by little, the design becomes less noticeable because it stops getting in the way. This kind of improvement requires attention more than decoration. It asks the developer to watch, listen, and test the same actions again from the user's perspective. Good design is not the absence of personality; it is the presence of care in the details. When the interface finally feels natural, the person using it can focus on their own goal rather than the tool standing between them and that goal.",
      "In a classroom full of different learners, progress can be difficult to compare. One student arrives with years of experience, another has only just discovered the home row, and a third already types quickly but struggles with punctuation. A practice website cannot make those differences disappear, and it does not need to. Its purpose is to offer a starting point that anyone can use. A short passage can build confidence. A longer one can develop concentration. A code exercise can challenge the fingers with brackets, symbols, and unfamiliar spacing. Over time, the results may show higher speed, fewer errors, or simply a more consistent routine. All of those changes are worth noticing. Learning becomes easier to sustain when the next activity feels possible and the feedback makes sense. Even a small digital tool can contribute to that experience by being clear, accessible, and enjoyable to return to."
    ]
  };
  const codeSamples = {
    javascript: [
      'const scores = [92, 87, 95];\nconst total = scores.reduce((a, b) => a + b, 0);\nconsole.log(total / scores.length);',
      'function greet(name) {\n  return `Hello, ${name}!`;\n}\nconsole.log(greet("world"));',
      'const colors = ["red", "blue", "green"];\nfor (const color of colors) {\n  console.log(color);\n}',
      'document.querySelector("button").addEventListener("click", () => {\n  console.log("clicked");\n});'
    ],
    python: [
      'def greet(name):\n    print(f"Hello, {name}!")\n\ngreet("world")',
      'numbers = [4, 7, 10, 13]\nfor number in numbers:\n    if number % 2 == 0:\n        print(number)',
      'def average(values):\n    return sum(values) / len(values)\n\nprint(average([8, 9, 10]))',
      'words = ["learn", "type", "grow"]\nfor word in words:\n    print(word.upper())'
    ],
    cpp: [
      '#include <iostream>\nusing namespace std;\n\nint main() {\n  cout << "Hello, world!";\n  return 0;\n}',
      '#include <vector>\nusing namespace std;\n\nvector<int> numbers = {1, 2, 3, 4};\nfor (int n : numbers) {\n  cout << n << " ";\n}',
      'int square(int x) {\n  return x * x;\n}\n\nint result = square(7);',
      'for (int i = 0; i < 5; i++) {\n  if (i % 2 == 0) {\n    cout << i << endl;\n  }\n}'
    ],
    html: [
      '<main class="container">\n  <h1>Find your flow</h1>\n  <p>Practice a little every day.</p>\n</main>',
      '<form action="/search">\n  <label for="q">Search</label>\n  <input id="q" name="q" />\n</form>',
      '<nav aria-label="Main menu">\n  <a href="/home">Home</a>\n  <a href="/about">About</a>\n</nav>',
      '<ul class="items">\n  <li>Learn</li>\n  <li>Type</li>\n  <li>Improve</li>\n</ul>'
    ],
    css: [
      '.container {\n  display: flex;\n  gap: 12px;\n  align-items: center;\n}',
      'button:hover {\n  background: #4faa80;\n  color: #0b100d;\n  cursor: pointer;\n}',
      '@media (max-width: 600px) {\n  .grid {\n    grid-template-columns: 1fr;\n  }\n}',
      '.card {\n  padding: 24px;\n  border: 1px solid #444;\n  border-radius: 8px;\n}'
    ]
  };
  const languageNames = {javascript:'JavaScript',python:'Python',cpp:'C++',html:'HTML',css:'CSS'};
  // A code "word" means one whitespace-delimited code token. This deliberately
  // measures typing, not whether the generated fragment compiles.
  function codeWordPrompt(language, wordGoal) {
    const samples = codeSamples[language];
    const first = Math.floor(Math.random() * samples.length);
    let text = '', tokenMatches = [];
    let i = 0;
    while (tokenMatches.length < wordGoal && i < 120) {
      text += (text ? '\n\n' : '') + samples[(first + i) % samples.length];
      tokenMatches = Array.from(text.matchAll(/\S+/g));
      i++;
    }
    const lastToken = tokenMatches[wordGoal - 1];
    return lastToken ? text.slice(0, lastToken.index + lastToken[0].length) : text;
  }
  let lastQuote = null;
  function generatePrompt(mode, language, testType = 'time', wordGoal = 25, quoteLength = 'medium') {
    if (testType === 'words') {
      if (mode === 'words') return Array.from({length:wordGoal}, () => pick(words)).join(' ');
      if (mode === 'code') return codeWordPrompt(language, wordGoal);
    }
    if (mode === 'quotes') {
      const pool = quoteLength === 'all' ? Object.values(quoteGroups).flat() : quoteGroups[quoteLength];
      const options = pool.filter(text => text !== lastQuote);
      lastQuote = pick(options.length ? options : pool);
      return lastQuote;
    }
    if (mode === 'code') {
      // Rotate snippets; use multiple blocks so longer timed tests don't run out of text.
      const sampleSet = codeSamples[language];
      const first = Math.floor(Math.random() * sampleSet.length);
      return Array.from({length:5}, (_, i) => sampleSet[(first + i) % sampleSet.length]).join('\n\n');
    }
    return Array.from({length:230}, () => pick(words)).join(' ');
  }

  function setupTest() {
    const input = $('#typing-input');
    if (!input) return;
    const stage = $('#typing-stage');
    const prompt = $('#typing-text');
    const modal = $('#result-modal');
    const status = $('#typing-status');
    let mode = 'words', language = 'javascript', duration = 30;
    let testType = 'time', wordGoal = 25, quoteLength = 'medium';
    let caretMotion = 'smooth';
    try { const stored = localStorage.getItem(CARET_KEY); if (['instant','fast','smooth'].includes(stored)) caretMotion = stored; } catch {}
    document.documentElement.dataset.caretMotion = caretMotion;
    let expected = '', startedAt = null, animation = null, finished = false;
    let lastFocus = null, correctTyped = 0;
    let statsScheduled = false;
    let wordBoundaries = [];
    function completedWords(typed) {
      // Binary search over cached token end-positions: O(log n) even on long tests.
      let low = 0, high = wordBoundaries.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (wordBoundaries[mid] <= typed.length) low = mid + 1;
        else high = mid;
      }
      return low;
    }
    function elapsedSeconds() {
      if (startedAt === null) return 0;
      const elapsed = Math.max(0.001, (performance.now() - startedAt) / 1000);
      return mode !== 'quotes' && testType === 'time' ? Math.min(duration, elapsed) : elapsed;
    }
    const durationValue = remaining => Math.max(0, Math.ceil(remaining));
    const elapsedLabel = seconds => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
    function stats() {
      const typed = input.value;
      const elapsed = elapsedSeconds();
      $('#timer').textContent = mode !== 'quotes' && testType === 'time' ? durationValue(duration - elapsed) : elapsedLabel(elapsed);
      $('#wpm').textContent = startedAt === null ? 0 : Math.round((correctTyped / 5) / (Math.max(elapsed, .001) / 60));
      $('#accuracy').textContent = (typed.length ? Math.round(correctTyped / typed.length * 100) : 100) + '%';
      $('#errors').textContent = typed.length - correctTyped;
      $('#words-progress').textContent = `${completedWords(typed)} / ${wordGoal}`;
    }
    function refreshControls() {
      $$('[data-mode]').forEach(button => {
        const selected = button.dataset.mode === mode;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $$('[data-test-type]').forEach(button => {
        const selected = button.dataset.testType === testType;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.disabled = false;
        button.title = ''; 
      });
      $$('[data-duration]').forEach(button => {
        const selected = Number(button.dataset.duration) === duration;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $$('[data-word-goal]').forEach(button => {
        const selected = Number(button.dataset.wordGoal) === wordGoal;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $$('[data-language]').forEach(button => {
        const selected = button.dataset.language === language;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $('#test-type-options').classList.toggle('hidden', mode === 'quotes');
      $('#test-type-divider').classList.toggle('hidden', mode === 'quotes');
      $('#test-length-divider').classList.toggle('hidden', mode === 'quotes');
      $('#time-options').classList.toggle('hidden', mode === 'quotes' || testType !== 'time');
      $('#word-options').classList.toggle('hidden', mode === 'quotes' || testType !== 'words');
      $('#quote-options').classList.toggle('hidden', mode !== 'quotes');
      $$('[data-quote-length]').forEach(button => {
        const selected = button.dataset.quoteLength === quoteLength;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $$('[data-caret-motion]').forEach(button => {
        const selected = button.dataset.caretMotion === caretMotion;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      $('#language-picker').classList.toggle('hidden', mode !== 'code');
      $('#words-stat').classList.toggle('hidden', mode === 'quotes' || testType !== 'words');
      $('#timer-label').textContent = mode === 'quotes' || testType !== 'time' ? 'elapsed' : 'time';
      prompt.classList.toggle('code-text', mode === 'code');
      const tip = $('#typing-tip');
      if (tip) tip.textContent = mode === 'quotes'
        ? 'Type the entire passage. The clock counts up; there is no time limit.'
        : mode === 'code' && testType === 'words'
        ? 'Code words count whitespace-separated code tokens. A word test may end mid-snippet.'
        : 'focus on accuracy first. speed comes naturally.';
    }
    function reset(focus = false) {
      if (animation !== null) clearInterval(animation);
      animation = null; finished = false; startedAt = null; statsScheduled = false;
      expected = generatePrompt(mode, language, testType, wordGoal, quoteLength);
      correctTyped = 0;
      wordBoundaries = Array.from(expected.matchAll(/\S+/g), m => m.index + m[0].length);
      input.disabled = false; input.value = '';
      stage.classList.remove('is-done', 'is-active');
      status.textContent = 'ready when you are';
      prompt.scrollTop = 0;
      refreshControls();
      paintPrompt(prompt, expected, '');
      stats();
      modal.classList.add('hidden');
      if (focus) { input.focus({preventScroll:true}); stage.classList.add('is-active'); }
    }
    function finish() {
      if (finished || startedAt === null) return;
      finished = true;
      if (animation !== null) clearInterval(animation);
      animation = null;
      const typed = input.value;
      const elapsed = elapsedSeconds();
      const record = {
        date: new Date().toISOString(),
        mode, language: mode === 'code' ? language : null,
        testType: mode === 'quotes' ? 'quote' : testType, quoteLength: mode === 'quotes' ? quoteLength : null,
        wordGoal: mode !== 'quotes' && testType === 'words' ? wordGoal : null,
        duration: mode !== 'quotes' && testType === 'time' ? duration : null,
        elapsed: +elapsed.toFixed(2),
        wpm: wpm(expected, typed, Math.max(elapsed, 0.5)),
        accuracy: accuracy(expected, typed),
        errors: errorCount(expected, typed), characters: typed.length
      };
      appendHistory(record);
      stage.classList.add('is-done');
      input.disabled = true;
      paintPrompt(prompt, expected, typed, true);
      stats();
      status.textContent = 'session complete';
      $('#result-wpm').textContent = record.wpm;
      $('#result-accuracy').textContent = record.accuracy + '%';
      $('#result-errors').textContent = record.errors;
      $('#result-context').textContent = mode === 'quotes' ? `${quoteLength} quote` : testType === 'words' ? `${wordGoal}-word test` : `${duration}-second test`;
      lastFocus = document.activeElement;
      modal.classList.remove('hidden');
      $('#try-again').focus();
    }
    function tick() {
      if (finished || startedAt === null) return;
      stats();
      if (mode !== 'quotes' && testType === 'time' && elapsedSeconds() >= duration) finish();
    }
    function scheduleStats() {
      if (statsScheduled) return;
      statsScheduled = true;
      requestAnimationFrame(() => {
        statsScheduled = false;
        if (!finished) stats();
      });
    }
    function inputChanged() {
      if (finished) return;
      if (input.value.length > expected.length) input.value = input.value.slice(0, expected.length);
      if (startedAt === null && input.value.length) {
        startedAt = performance.now();
        status.textContent = mode === 'quotes' ? 'finish the quote' : testType === 'words' ? `type ${wordGoal} words` : 'keep going';
        animation = setInterval(tick, 100);
      }
      // Keep the critical typing path lean: only change colored spans and caret.
      correctTyped = paintPrompt(prompt, expected, input.value);
      scheduleStats();
      if (input.value.length === expected.length) finish();
    }
    input.addEventListener('input', inputChanged);
    attachTypingBehavior(input, stage, () => mode, inputChanged, () => mode === 'code' && language === 'python' ? 4 : 2);
    $$('[data-mode]').forEach(button => button.addEventListener('click', () => {
      mode = button.dataset.mode;
      reset(true);
    }));
    $$('[data-test-type]').forEach(button => button.addEventListener('click', () => {
      if (button.disabled) return;
      testType = button.dataset.testType;
      reset(true);
    }));
    $$('[data-quote-length]').forEach(button => button.addEventListener('click', () => { quoteLength = button.dataset.quoteLength; reset(true); }));
    $$('[data-caret-motion]').forEach(button => button.addEventListener('click', () => {
      caretMotion = button.dataset.caretMotion;
      document.documentElement.dataset.caretMotion = caretMotion;
      try { localStorage.setItem(CARET_KEY, caretMotion); } catch {}
      refreshControls();
      input.focus();
    }));
    $$('[data-duration]').forEach(button => button.addEventListener('click', () => { duration = Number(button.dataset.duration); reset(true); }));
    $$('[data-word-goal]').forEach(button => button.addEventListener('click', () => { wordGoal = Number(button.dataset.wordGoal); reset(true); }));
    $$('[data-language]').forEach(button => button.addEventListener('click', () => { language = button.dataset.language; reset(true); }));
    $('#restart-button').addEventListener('click', () => reset(true));
    $('#try-again').addEventListener('click', () => reset(true));
    function closeResult() {
      modal.classList.add('hidden');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }
    $('#close-result').addEventListener('click', closeResult);
    modal.addEventListener('click', event => { if (event.target === modal) closeResult(); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.classList.contains('hidden')) closeResult();
      if (!finished && modal.classList.contains('hidden') && event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey &&
          !['INPUT','TEXTAREA','BUTTON','SELECT'].includes(document.activeElement.tagName)) {
        // Do not swallow the first key when the page was not focused yet.
        event.preventDefault();
        input.focus({preventScroll:true});
        input.value += event.key;
        inputChanged();
      }
    });
    reset(true);
  }

  const lessons = [
    {title:'home row / left',description:'Rest your fingers on A S D F. Look at the screen, not the keyboard.',text:'asdf fdsa asdf dads fads sad fad asdf sad dad fad fads'},
    {title:'home row / right',description:'Keep your right fingers near J K L ;. Aim for relaxed, steady movement.',text:'jkl; ;lkj jkl; jkj lkj jkl; klj ;lkj jkj klj'},
    {title:'both hands',description:'Combine your home row keys. Prioritize accuracy over speed.',text:'asdf jkl; ask dad fall flask salad glad sad; flask jads'},
    {title:'simple words',description:'Find a comfortable rhythm as you type short everyday words.',text:'the and day look make feel good flow time word blue green bird life open world'},
    {title:'short sentences',description:'Practice punctuation, spacing, and the pace of complete sentences.',text:'Every small step matters. Find your flow and practice today. Accuracy comes before speed.'},
    {title:'developer keys',description:'Practice special characters common in code. Tab enters two spaces.',text:'<div>hello</div>\nconst x = 42;\nif (x > 10) {\n  console.log(x);\n}'}
  ];
  function setupPractice() {
    const input = $('#lesson-input'); if (!input) return;
    const stage = $('#lesson-stage'), prompt = $('#lesson-text');
    let current = 0;
    const rows = ['QWERTYUIOP', 'ASDFGHJKL;', 'ZXCVBNM,./'];
    function updateKeyboard(next) {
      const board = $('#keyboard');
      const fragment = document.createDocumentFragment();
      rows.forEach(row => {
        const line = document.createElement('div'); line.className = 'keyboard-row';
        Array.from(row).forEach(key => {
          const block = document.createElement('span');
          block.className = 'keyboard-key';
          if ('ASDFJKL;'.includes(key)) block.classList.add('home');
          if (key.toLowerCase() === next.toLowerCase()) block.classList.add('next');
          block.textContent = key;
          line.appendChild(block);
        });
        fragment.appendChild(line);
      });
      board.replaceChildren(fragment);
    }
    function reset(focus = false) {
      input.disabled = false; input.value = '';
      stage.classList.remove('is-active','is-done');
      const lesson = lessons[current];
      $('#practice-level').textContent = String(current + 1).padStart(2,'0') + ' / 06';
      $('#practice-title').textContent = lesson.title;
      $('#practice-description').textContent = lesson.description;
      $('#practice-accuracy').textContent = '100%';
      $('#practice-progress').style.width = '0%';
      $('#lesson-message').textContent = 'slow and accurate beats fast and messy.';
      prompt.classList.toggle('code-text', current === 5);
      prompt.scrollTop = 0;
      paintPrompt(prompt, lesson.text, '');
      updateKeyboard(lesson.text[0]);
      $$('[data-lesson]').forEach(button => {
        const selected = Number(button.dataset.lesson) === current;
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      if (focus) { input.focus({preventScroll:true}); stage.classList.add('is-active'); }
    }
    function inputChanged() {
      const expected = lessons[current].text;
      if (input.value.length > expected.length) input.value = input.value.slice(0, expected.length);
      const entered = input.value;
      $('#practice-accuracy').textContent = accuracy(expected, entered) + '%';
      $('#practice-progress').style.width = (entered.length / expected.length * 100) + '%';
      paintPrompt(prompt, expected, entered);
      updateKeyboard(expected[entered.length] || '');
      if (entered.length === expected.length) {
        input.disabled = true;
        stage.classList.add('is-done');
        paintPrompt(prompt, expected, entered, true);
        const result = accuracy(expected, entered);
        $('#lesson-message').textContent = 'lesson complete · ' + result + '% accuracy · ' + (result >= 95 ? 'great work!' : 'try again for a higher score');
      }
    }
    input.addEventListener('input', inputChanged);
    attachTypingBehavior(input, stage, () => current === 5 ? 'code' : 'words', inputChanged);
    $$('[data-lesson]').forEach(button => button.addEventListener('click', () => { current = Number(button.dataset.lesson); reset(true); }));
    $('#reset-lesson').addEventListener('click', () => reset(true));
    reset();
  }

  function setupProgress() {
    if (!$('#history-rows')) return;
    function draw() {
      const all = safeHistory().filter(row => row && Number.isFinite(row.wpm) && Number.isFinite(row.accuracy));
      const count = all.length;
      $('#total-tests').textContent = count;
      $('#best-wpm').textContent = count ? Math.max(...all.map(r => r.wpm)) : '—';
      $('#average-wpm').textContent = count ? Math.round(all.reduce((s,r) => s + r.wpm, 0) / count) : '—';
      $('#average-accuracy').textContent = count ? Math.round(all.reduce((s,r) => s + r.accuracy, 0) / count) + '%' : '—';
      const rows = $('#history-rows');
      rows.replaceChildren();
      if (!count) {
        const tr = document.createElement('tr'), td = document.createElement('td');
        td.colSpan = 5; td.className = 'history-empty';
        td.textContent = 'No sessions yet. Finish a typing test to see your results here.';
        tr.appendChild(td); rows.appendChild(tr);
      }
      all.slice(-15).reverse().forEach(record => {
        const tr = document.createElement('tr');
        const label = record.mode === 'code' && record.language ? 'code / ' + (languageNames[record.language] || record.language) : record.mode;
        const goalLabel = record.testType === 'quote' || record.mode === 'quotes' ? `${record.quoteLength || 'classic'} quote` : record.testType === 'words' ? `${record.wordGoal} words` : `${record.duration || 30}s`;
        const values = [new Date(record.date).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}),label,goalLabel,record.wpm,record.accuracy + '%'];
        values.forEach((value, index) => {
          const td = document.createElement('td');
          if (index === 3) {const strong = document.createElement('strong'); strong.textContent = value; td.appendChild(strong);}
          else td.textContent = value;
          tr.appendChild(td);
        });
        rows.appendChild(tr);
      });
      const chart = $('#speed-chart'); chart.replaceChildren();
      if (!count) {
        const empty = document.createElement('div'); empty.className = 'chart-empty';
        const title = document.createElement('strong'); title.textContent = 'your chart starts here.';
        const help = document.createElement('span'); help.textContent = 'Complete a test and your WPM history appears.';
        empty.append(title, help); chart.appendChild(empty); return;
      }
      const list = all.slice(-12), values = list.map(r => r.wpm), max = Math.max(20,...values);
      const top = Math.ceil(max/10)*10;
      const W = 920, H = 215, left = 45, right = 18, topPad = 22, bottom = 34;
      const x = i => list.length === 1 ? (W - left - right)/2 + left : left + i*(W - left - right)/(list.length-1);
      const y = v => H-bottom - (v/top)*(H-topPad-bottom);
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns,'svg'); svg.setAttribute('viewBox',`0 0 ${W} ${H}`); svg.setAttribute('class','chart-svg'); svg.setAttribute('aria-hidden','true');
      const add = (tag, attributes, text) => {
        const element = document.createElementNS(ns,tag);
        Object.entries(attributes).forEach(([key,value]) => element.setAttribute(key,value));
        if (text !== undefined) element.textContent = text;
        svg.appendChild(element);
        return element;
      };
      for (let step = 0; step <= 3; step++) {
        const value = (top/3)*step, sy=y(value);
        add('line',{x1:left,y1:sy,x2:W-right,y2:sy,stroke:'currentColor','stroke-opacity':'.18','stroke-dasharray':'4 7'});
        add('text',{x:1,y:sy+4,fill:'currentColor','font-size':'12'},String(Math.round(value)));
      }
      if (list.length > 1) {
        const path = values.map((value,index) => `${index===0?'M':'L'}${x(index)},${y(value)}`).join(' ');
        add('path',{d:path,fill:'none',stroke:'var(--accent)','stroke-width':'3','stroke-linecap':'round','stroke-linejoin':'round'});
      }
      values.forEach((value,index) => {
        add('circle',{cx:x(index),cy:y(value),r:4.5,fill:'var(--accent)'});
        if (list.length <= 7 || index === 0 || index === list.length-1) add('text',{x:x(index),y:H-7,'text-anchor':'middle',fill:'currentColor','font-size':'11'},'#'+(count-list.length+index+1));
      });
      chart.appendChild(svg);
    }
    $('#clear-history').addEventListener('click', () => {
      if (confirm('Delete all typing test results saved in this browser?')) {
        try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
        draw();
      }
    });
    draw();
  }

  setupTheme();
  setupTest();
  setupPractice();
  setupProgress();
})();
