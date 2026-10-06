(() => {
  'use strict';

  const TOTAL_TRIALS = 10;
  const TICK_MS = 100;

  const HANGUL_SYLLABLE_START = 0xac00;
  const HANGUL_SYLLABLE_END = 0xd7a3;
  const HANGUL_VOWEL_COUNT = 21;
  const HANGUL_FINAL_COUNT = 28;

  // 두벌식에서 2타로 입력되는 겹모음과 겹받침
  const COMPOUND_VOWEL_INDEXES = new Set([9, 10, 11, 14, 15, 16, 19]);
  const COMPOUND_FINAL_INDEXES = new Set([
    3, 5, 6, 9, 10, 11, 12, 13, 14, 15, 18
  ]);

  const CSV_COLUMNS = [
    'trial',
    'condition',
    'sentence_id',
    'sentence',
    'typed_text',
    'typing_speed',
    'accuracy',
    'elapsed_seconds'
  ];

  const elements = {
    loadingPanel: document.getElementById('loading-panel'),
    loadingMessage: document.getElementById('loading-message'),
    loadControl: document.getElementById('load-control'),
    sentenceFile: document.getElementById('sentence-file'),
    app: document.getElementById('experiment-app'),
    trialNumber: document.getElementById('trial-number'),
    conditionBadge: document.getElementById('condition-badge'),
    visualEffects: document.getElementById('visual-effects'),
    sentenceText: document.getElementById('sentence-text'),
    typingInput: document.getElementById('typing-input'),
    speedValue: document.getElementById('speed-value'),
    accuracyValue: document.getElementById('accuracy-value'),
    elapsedValue: document.getElementById('elapsed-value'),
    trialStatus: document.getElementById('trial-status'),
    resultsSection: document.getElementById('results-section'),
    resultsBody: document.getElementById('results-body'),
    downloadButton: document.getElementById('download-csv'),
    downloadStatus: document.getElementById('download-status')
  };

  let trials = [];
  let results = [];
  let trialIndex = 0;
  let currentTrial = null;

  let startTime = null;
  let timerId = null;
  let visualTimerId = null;

  let isComposing = false;
  let phase = 'loading';

  // ------------------------------
  // 실험 준비
  // ------------------------------

  function shuffle(items) {
    const shuffled = items.slice();

    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    return shuffled;
  }

  function validateSentences(data) {
    if (!Array.isArray(data)) {
      throw new Error('문장 파일의 최상위 값은 JSON 배열이어야 합니다.');
    }

    const valid = data.filter((item) => (
      item &&
      Number.isFinite(Number(item.id)) &&
      typeof item.text === 'string' &&
      item.text.trim().length > 0
    ));

    if (valid.length < TOTAL_TRIALS) {
      throw new Error(
        `사용 가능한 문장이 ${TOTAL_TRIALS}개보다 적습니다. sentences.json을 확인해 주세요.`
      );
    }

    return valid;
  }

  function makeTrialList(sentenceData) {
    const conditions = shuffle([
      'OFF', 'OFF', 'OFF', 'OFF', 'OFF',
      'ON', 'ON', 'ON', 'ON', 'ON'
    ]);

    const selectedSentences = shuffle(sentenceData).slice(0, TOTAL_TRIALS);

    return conditions.map((condition, index) => ({
      trial: index + 1,
      condition,
      sentence: selectedSentences[index]
    }));
  }

  function showLoadingError(message) {
    elements.loadingMessage.textContent = message;
    elements.loadControl.hidden = false;
  }

  function beginExperiment(sentenceData) {
    try {
      const validSentences = validateSentences(sentenceData);

      trials = makeTrialList(validSentences);
      results = [];
      trialIndex = 0;
      phase = 'ready';

      elements.loadingPanel.hidden = true;
      elements.app.hidden = false;
      elements.resultsSection.hidden = true;

      showTrial();
    } catch (error) {
      showLoadingError(error.message || '문장 자료를 읽을 수 없습니다.');
    }
  }

  function clearTimers() {
    if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }

    if (visualTimerId !== null) {
      window.clearTimeout(visualTimerId);
      visualTimerId = null;
    }
  }

  function clearVisualEffects() {
    elements.visualEffects.replaceChildren();
  }

  function showTrial() {
    clearTimers();
    clearVisualEffects();

    if (trialIndex >= TOTAL_TRIALS) {
      showResults();
      return;
    }

    currentTrial = trials[trialIndex];
    startTime = null;
    isComposing = false;
    phase = 'ready';

    elements.trialNumber.textContent = String(currentTrial.trial);
    elements.conditionBadge.textContent = `시각 요소 ${currentTrial.condition}`;
    elements.conditionBadge.classList.toggle('is-on', currentTrial.condition === 'ON');

    elements.sentenceText.textContent = currentTrial.sentence.text;
    elements.typingInput.value = '';
    elements.typingInput.disabled = false;

    elements.speedValue.textContent = '0';
    elements.accuracyValue.textContent = '0';
    elements.elapsedValue.textContent = '0.0';
    elements.trialStatus.textContent = '첫 글자를 입력하세요.';

    window.requestAnimationFrame(() => {
      if (phase === 'ready') {
        elements.typingInput.focus({ preventScroll: true });
      }
    });
  }

  // ------------------------------
  // 타수 / 정확도 / 시간 계산
  // ------------------------------

  function editDistance(left, right) {
    const a = Array.from(left);
    const b = Array.from(right);
    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];

      for (let j = 1; j <= b.length; j += 1) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;

        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + substitutionCost
        );
      }

      previous = current;
    }

    return previous[b.length];
  }

  function getAccuracy(typedText, targetText) {
    const targetLength = Array.from(targetText).length;

    if (targetLength === 0) {
      return 0;
    }

    const distance = editDistance(typedText, targetText);

    return Math.max(0, (targetLength - distance) / targetLength * 100);
  }

  function countTypingStrokes(text) {
    let strokeCount = 0;

    for (const character of text) {
      const codePoint = character.codePointAt(0);

      if (codePoint >= HANGUL_SYLLABLE_START && codePoint <= HANGUL_SYLLABLE_END) {
        const syllableIndex = codePoint - HANGUL_SYLLABLE_START;
        const vowelIndex = Math.floor(
          (syllableIndex % (HANGUL_VOWEL_COUNT * HANGUL_FINAL_COUNT)) /
          HANGUL_FINAL_COUNT
        );
        const finalIndex = syllableIndex % HANGUL_FINAL_COUNT;

        strokeCount += 1;
        strokeCount += COMPOUND_VOWEL_INDEXES.has(vowelIndex) ? 2 : 1;

        if (finalIndex > 0) {
          strokeCount += COMPOUND_FINAL_INDEXES.has(finalIndex) ? 2 : 1;
        }
      } else {
        strokeCount += 1;
      }
    }

    return strokeCount;
  }

  function getElapsedSeconds(now = performance.now()) {
    if (startTime === null) {
      return 0;
    }

    return Math.max(0, (now - startTime) / 1000);
  }

  function getTypingSpeed(typedText, elapsedSeconds) {
    const typingStrokes = countTypingStrokes(typedText);

    if (typingStrokes === 0) {
      return 0;
    }

    return typingStrokes * 60 / Math.max(elapsedSeconds, 1);
  }

  function roundTo(value, digits) {
    const scale = 10 ** digits;
    return Math.round((value + Number.EPSILON) * scale) / scale;
  }

  function updateMetrics() {
    if (!currentTrial || (phase !== 'ready' && phase !== 'typing') || isComposing) {
      return;
    }

    const typedText = elements.typingInput.value;

    // 첫 글자가 입력된 순간부터 시간과 시각 자극을 시작한다.
    if (startTime === null && typedText.length > 0) {
      startTime = performance.now();
      phase = 'typing';
      timerId = window.setInterval(updateMetrics, TICK_MS);
      elements.trialStatus.textContent = '입력 중…';

      startVisualEffects();
    }

    const elapsed = getElapsedSeconds();
    const speed = getTypingSpeed(typedText, elapsed);
    const accuracy = getAccuracy(typedText, currentTrial.sentence.text);

    elements.speedValue.textContent = String(Math.round(speed));
    elements.accuracyValue.textContent = String(Math.round(accuracy));
    elements.elapsedValue.textContent = elapsed.toFixed(1);
  }

  function finishTrial() {
    if (!currentTrial || (phase !== 'ready' && phase !== 'typing')) {
      return;
    }

    const typedText = elements.typingInput.value;
    const typedLength = Array.from(typedText).length;
    const targetLength = Array.from(currentTrial.sentence.text).length;

    if (startTime === null) {
      elements.trialStatus.textContent = '문장을 입력한 뒤 Enter를 눌러주세요.';
      return;
    }

    if (typedLength < targetLength) {
      elements.trialStatus.textContent = '문장을 끝까지 입력한 뒤 Enter를 눌러주세요.';
      return;
    }

    if (typedLength > targetLength) {
      elements.trialStatus.textContent =
        '입력이 목표 문장보다 깁니다. 오타를 확인하고 수정해 주세요.';
      return;
    }

    clearTimers();
    clearVisualEffects();

    const elapsedSeconds = getElapsedSeconds();
    const typingSpeed = getTypingSpeed(typedText, elapsedSeconds);
    const accuracy = getAccuracy(typedText, currentTrial.sentence.text);

    results.push({
      trial: currentTrial.trial,
      condition: currentTrial.condition,
      sentence_id: currentTrial.sentence.id,
      sentence: currentTrial.sentence.text,
      typed_text: typedText,
      typing_speed: roundTo(typingSpeed, 2),
      accuracy: roundTo(accuracy, 2),
      elapsed_seconds: roundTo(elapsedSeconds, 3)
    });

    trialIndex += 1;
    currentTrial = null;
    phase = 'between';

    elements.typingInput.disabled = true;

    // 별도 대기 없이 다음 문장으로 바로 넘어간다.
    showTrial();
  }

  // ------------------------------
  // 랜덤 시각 자극
  // ------------------------------

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  function randomInteger(min, max) {
    return Math.floor(randomBetween(min, max + 1));
  }

  function getRandomFireworkType() {
    const types = ['burst', 'ring', 'spark'];
    return types[randomInteger(0, types.length - 1)];
  }

  function createFirework() {
    if (
      phase !== 'typing' ||
      !currentTrial ||
      currentTrial.condition !== 'ON'
    ) {
      return;
    }

    const layerRect = elements.visualEffects.getBoundingClientRect();

    if (layerRect.width <= 0 || layerRect.height <= 0) {
      scheduleNextVisualEffect();
      return;
    }

    // 특정 영역을 지정하지 않고 실험 카드 전체에서 위치를 뽑는다.
    const x = randomBetween(24, Math.max(24, layerRect.width - 24));
    const y = randomBetween(24, Math.max(24, layerRect.height - 24));

    const firework = document.createElement('div');
    const type = getRandomFireworkType();
    const life = randomBetween(700, 1300);

    firework.className = 'firework';
    firework.style.left = `${x}px`;
    firework.style.top = `${y}px`;
    firework.style.setProperty('--life', `${life}ms`);
    firework.style.setProperty('--core-size', `${randomBetween(5, 9)}px`);
    firework.style.setProperty('--ring-size', `${randomBetween(32, 70)}px`);

    if (type === 'burst') {
      createBurstParticles(firework);
    } else if (type === 'ring') {
      createRingEffect(firework);
    } else {
      createSparkEffect(firework);
    }

    elements.visualEffects.appendChild(firework);

    window.setTimeout(() => {
      firework.remove();
    }, life + 100);
  }

  function createBurstParticles(parent) {
    const particleCount = randomInteger(7, 11);

    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement('span');
      const angle = (360 / particleCount) * index + randomBetween(-12, 12);

      particle.className = 'firework-particle';
      particle.style.setProperty('--angle', `${angle}deg`);
      particle.style.setProperty('--distance', `${randomBetween(18, 45)}px`);
      particle.style.setProperty('--particle-size', `${randomBetween(3, 6)}px`);

      parent.appendChild(particle);
    }

    const core = document.createElement('span');
    core.className = 'firework-core';
    parent.appendChild(core);
  }

  function createRingEffect(parent) {
    const core = document.createElement('span');
    const ring = document.createElement('span');

    core.className = 'firework-core';
    ring.className = 'firework-ring';

    parent.appendChild(core);
    parent.appendChild(ring);

    const particleCount = randomInteger(4, 7);

    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement('span');
      const angle = (360 / particleCount) * index;

      particle.className = 'firework-particle';
      particle.style.setProperty('--angle', `${angle}deg`);
      particle.style.setProperty('--distance', `${randomBetween(12, 30)}px`);
      particle.style.setProperty('--particle-size', '4px');

      parent.appendChild(particle);
    }
  }

  function createSparkEffect(parent) {
    const core = document.createElement('span');
    core.className = 'firework-core';
    parent.appendChild(core);

    const sparkCount = randomInteger(5, 9);

    for (let index = 0; index < sparkCount; index += 1) {
      const spark = document.createElement('span');
      const angle = randomBetween(0, 360);

      spark.className = 'spark';
      spark.style.setProperty('--angle', `${angle}deg`);
      spark.style.setProperty('--distance', `${randomBetween(24, 65)}px`);
      spark.style.setProperty('--spark-size', `${randomBetween(2, 5)}px`);

      parent.appendChild(spark);
    }
  }

  function scheduleNextVisualEffect() {
    if (
      phase !== 'typing' ||
      !currentTrial ||
      currentTrial.condition !== 'ON'
    ) {
      return;
    }

    const delay = randomBetween(650, 1700);

    visualTimerId = window.setTimeout(() => {
      visualTimerId = null;
      createFirework();
      scheduleNextVisualEffect();
    }, delay);
  }

  function startVisualEffects() {
    if (!currentTrial || currentTrial.condition !== 'ON') {
      return;
    }

    clearVisualEffects();

    // 첫 자극도 매번 다른 시점에 나타나도록 약간의 랜덤 지연을 둔다.
    visualTimerId = window.setTimeout(() => {
      visualTimerId = null;
      createFirework();
      scheduleNextVisualEffect();
    }, randomBetween(400, 1100));
  }

  // ------------------------------
  // 결과 / CSV
  // ------------------------------

  function showResults() {
    clearTimers();
    clearVisualEffects();

    phase = 'complete';
    currentTrial = null;
    elements.typingInput.disabled = true;

    elements.trialStatus.textContent =
      '모든 실험을 마쳤습니다. 결과를 확인하고 CSV를 다운로드하세요.';

    elements.resultsBody.replaceChildren();

    results.forEach((result) => {
      const row = document.createElement('tr');

      [
        String(result.trial),
        result.condition,
        result.typing_speed.toFixed(2),
        `${result.accuracy.toFixed(2)}%`,
        result.elapsed_seconds.toFixed(3)
      ].forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      });

      elements.resultsBody.appendChild(row);
    });

    elements.resultsSection.hidden = false;
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadCsv() {
    if (results.length !== TOTAL_TRIALS) {
      return;
    }

    const rows = [CSV_COLUMNS.join(',')];

    results.forEach((result) => {
      rows.push(
        CSV_COLUMNS.map((column) => csvEscape(result[column])).join(',')
      );
    });

    const blob = new Blob(
      [`\uFEFF${rows.join('\r\n')}`],
      { type: 'text/csv;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    anchor.href = url;
    anchor.download = `typing_results_${timestamp}.csv`;

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    elements.downloadStatus.textContent =
      'CSV 다운로드를 시작했습니다.';
  }

  // ------------------------------
  // 입력 이벤트
  // ------------------------------

  elements.typingInput.addEventListener('paste', (event) => {
    event.preventDefault();
    elements.trialStatus.textContent =
      '붙여넣기는 사용할 수 없습니다. 직접 입력해 주세요.';
  });

  elements.typingInput.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  elements.typingInput.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.trialStatus.textContent =
      '붙여넣기는 사용할 수 없습니다. 직접 입력해 주세요.';
  });

  // 한글 IME 조합 중에는 중간 글자를 실험 데이터로 계산하지 않는다.
  elements.typingInput.addEventListener('compositionstart', () => {
    isComposing = true;
  });

  elements.typingInput.addEventListener('compositionend', () => {
    isComposing = false;
    window.setTimeout(updateMetrics, 0);
  });

  elements.typingInput.addEventListener('input', (event) => {
    if (isComposing || event.isComposing) {
      return;
    }

    updateMetrics();
  });

  elements.typingInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }

    // 한글 조합 중 Enter가 들어오는 경우 실험을 종료하지 않는다.
    if (isComposing || event.isComposing || event.keyCode === 229) {
      return;
    }

    event.preventDefault();
    finishTrial();
  });

  elements.downloadButton.addEventListener('click', downloadCsv);

  elements.sentenceFile.addEventListener('change', async (event) => {
    const file = event.target.files && event.target.files[0];

    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      beginExperiment(JSON.parse(text));
    } catch (error) {
      showLoadingError(
        `문장 파일을 읽지 못했습니다: ${
          error.message || 'JSON 형식을 확인해 주세요.'
        }`
      );
    }
  });

  // 일반적인 실행 환경에서는 sentences.json을 자동으로 읽는다.
  // file://로 직접 열었을 때 fetch가 막히면 파일 선택 방식으로 전환한다.
  async function loadSentenceFile() {
    try {
      const response = await fetch('./sentences.json');

      if (!response.ok) {
        throw new Error(`sentences.json 요청 실패 (${response.status})`);
      }

      beginExperiment(await response.json());
    } catch (error) {
      showLoadingError('sentences.json을 자동으로 불러오지 못했습니다.');
    }
  }

  loadSentenceFile();
})();