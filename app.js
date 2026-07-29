(() => {
  "use strict";

  const data = window.AZU_DATA;
  if (!data || !Array.isArray(data.words)) {
    document.body.innerHTML = "<p style='padding:2rem'>无法读取 data.json，请确认文件与 index.html 在同一文件夹。</p>";
    return;
  }

  const requiredFields = ["term", "phonetic", "meaning", "example", "exampleZh"];
  const invalidBuiltIn = data.words.filter((word) => requiredFields.some((field) => !String(word[field] || "").trim()));
  if (invalidBuiltIn.length) {
    document.body.innerHTML = `<p style="padding:2rem">词汇数据检查失败：${invalidBuiltIn.length} 条记录缺少音标、释义或双语例句。</p>`;
    return;
  }

  const STORAGE_KEY = "azuEnglishState.v2";
  const DEFAULT_SETTINGS = { accent: "en-US", voiceName: "", rate: 0.82 };
  const categoryMap = Object.fromEntries(data.categories.map((item) => [item.id, item.label]));
  const categoryIcons = {
    mining: "矿", processing: "选", equipment: "机", maintenance: "修",
    safety: "安", reporting: "报", communication: "联", management: "项"
  };
  const $ = (id) => document.getElementById(id);

  let state = loadState();
  let allWords = [];
  let wordsById = {};
  let learnList = [];
  let learnIndex = 0;
  let reviewQueue = [];
  let reviewIndex = 0;
  let availableVoices = [];

  function emptyState() {
    return {
      learned: {},
      favorites: [],
      customWords: [],
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEY)
        || localStorage.getItem("azuEnglishState.v1")
        || "null"
      );
      return {
        learned: saved?.learned || {},
        favorites: Array.isArray(saved?.favorites) ? saved.favorites : [],
        customWords: Array.isArray(saved?.customWords) ? saved.customWords : [],
        settings: { ...DEFAULT_SETTINGS, ...(saved?.settings || {}) }
      };
    } catch {
      return emptyState();
    }
  }

  function refreshWordData() {
    state.customWords = state.customWords.filter((word) =>
      requiredFields.every((field) => String(word[field] || "").trim())
      && categoryMap[word.category]
    );
    allWords = [...data.words, ...state.customWords];
    wordsById = Object.fromEntries(allWords.map((word) => [word.id, word]));
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    updateGlobalStats();
  }

  function isLearned(id) {
    return Boolean(state.learned[id]);
  }

  function isFavorite(id) {
    return state.favorites.includes(id);
  }

  function learnedIds() {
    return Object.keys(state.learned).filter((id) => wordsById[id]);
  }

  function fillCategorySelect(select, includeAll = true) {
    select.innerHTML = "";
    if (includeAll) select.add(new Option("全部分类", "all"));
    data.categories.forEach((category) => select.add(new Option(category.label, category.id)));
  }

  function updateGlobalStats() {
    const learned = learnedIds().length;
    const due = getDueWords().length;
    $("learnedCount").textContent = learned;
    $("totalCount").textContent = allWords.length;
    $("learnedPageCount").textContent = learned;
    $("dueCount").textContent = due;
    $("sourceWordCount").textContent = allWords.length;
    $("reviewDot").classList.toggle("show", due > 0);
  }

  function currentLearnWord() {
    return learnList[learnIndex] || allWords[0];
  }

  function renderLearn() {
    const word = currentLearnWord();
    if (!word) return;
    const total = Math.max(learnList.length, 1);
    $("learnPosition").textContent = `${Math.min(learnIndex + 1, total)} / ${total}`;
    $("learnProgress").style.width = `${((learnIndex + 1) / total) * 100}%`;
    $("learnCategoryLabel").textContent = $("learnCategory").value === "all"
      ? "全部分类" : categoryMap[$("learnCategory").value];
    $("learnBadge").textContent = categoryMap[word.category];
    $("learnTerm").textContent = word.term;
    $("learnPhonetic").textContent = word.phonetic;
    $("learnMeaning").textContent = word.meaning;
    $("learnUsage").textContent = word.usage || "—";
    $("learnExample").textContent = word.example;
    $("learnExampleZh").textContent = word.exampleZh;
    $("learnAnswer").hidden = true;
    $("revealLearn").hidden = false;

    const learned = isLearned(word.id);
    $("markLearned").textContent = learned ? "✓ 已学" : "标记已学";
    $("markLearned").classList.toggle("learned", learned);
    $("favoriteButton").textContent = isFavorite(word.id) ? "★" : "☆";
    $("favoriteButton").classList.toggle("active", isFavorite(word.id));
  }

  function filterLearn(category) {
    learnList = category === "all"
      ? [...allWords]
      : allWords.filter((word) => word.category === category);
    learnIndex = 0;
    renderLearn();
  }

  function moveLearn(direction) {
    if (!learnList.length) return;
    learnIndex = (learnIndex + direction + learnList.length) % learnList.length;
    renderLearn();
  }

  function markCurrentLearned() {
    const word = currentLearnWord();
    if (!word) return;
    if (isLearned(word.id)) {
      delete state.learned[word.id];
    } else {
      state.learned[word.id] = newLearnedRecord();
    }
    saveState();
    renderLearn();
    renderCategories();
  }

  function newLearnedRecord() {
    return {
      learnedAt: Date.now(),
      nextReview: Date.now(),
      interval: 0,
      level: 0,
      reviews: 0
    };
  }

  function toggleFavorite() {
    const word = currentLearnWord();
    if (!word) return;
    state.favorites = isFavorite(word.id)
      ? state.favorites.filter((item) => item !== word.id)
      : [...state.favorites, word.id];
    saveState();
    renderLearn();
  }

  function refreshVoices() {
    if (!("speechSynthesis" in window)) return;
    availableVoices = speechSynthesis.getVoices().filter((voice) =>
      voice.lang.toLowerCase().startsWith("en")
    );
    const accent = state.settings.accent;
    const select = $("voiceSelect");
    select.innerHTML = "";
    select.add(new Option("自动选择最佳英语语音", ""));
    availableVoices
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((voice) => {
        const option = new Option(`${voice.name} · ${voice.lang}`, voice.name);
        select.add(option);
      });
    select.value = availableVoices.some((voice) => voice.name === state.settings.voiceName)
      ? state.settings.voiceName : "";
    $("accentSelect").value = accent;
  }

  function preferredVoice() {
    if (state.settings.voiceName) {
      const selected = availableVoices.find((voice) => voice.name === state.settings.voiceName);
      if (selected) return selected;
    }

    const accent = state.settings.accent.toLowerCase();
    const preferredNames = accent === "en-gb"
      ? ["Daniel", "Serena", "Sonia", "Google UK English Female", "Google UK English Male"]
      : ["Samantha", "Ava", "Alex", "Aria", "Google US English"];
    const candidates = availableVoices.filter((voice) => voice.lang.toLowerCase() === accent);
    for (const name of preferredNames) {
      const match = candidates.find((voice) => voice.name.toLowerCase().includes(name.toLowerCase()));
      if (match) return match;
    }
    return candidates.find((voice) => voice.default) || candidates[0]
      || availableVoices.find((voice) => voice.default) || availableVoices[0];
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      window.alert("当前浏览器不支持系统语音，请换用 Chrome、Safari 或 Edge。");
      return;
    }
    speechSynthesis.cancel();
    const speechText = String(text)
      .replace(/\s*\/\s*/g, " or ")
      .replace(/&/g, " and ")
      .replace(/[()[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const utterance = new SpeechSynthesisUtterance(speechText);
    utterance.lang = state.settings.accent;
    utterance.rate = Number(state.settings.rate) || DEFAULT_SETTINGS.rate;
    utterance.pitch = 1;
    const voice = preferredVoice();
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  }

  function renderExamples() {
    const query = $("exampleSearch").value.trim().toLowerCase();
    const category = $("exampleCategory").value;
    const filtered = allWords.filter((word) => {
      const inCategory = category === "all" || word.category === category;
      const haystack = `${word.term} ${word.phonetic} ${word.meaning} ${word.example} ${word.exampleZh} ${word.usage}`.toLowerCase();
      return inCategory && (!query || haystack.includes(query));
    });

    $("exampleResultCount").textContent = `找到 ${filtered.length} 条，显示前 ${Math.min(filtered.length, 100)} 条`;
    $("exampleList").innerHTML = filtered.slice(0, 100).map((word) => `
      <article class="example-card">
        <header>
          <div>
            <span class="category-badge">${escapeHtml(categoryMap[word.category])}</span>
            <h3>${escapeHtml(word.term)}</h3>
            <p class="phonetic">${escapeHtml(word.phonetic)}</p>
            <p class="meaning">${escapeHtml(word.meaning)}</p>
          </div>
          <button class="mini-speak" data-speak="${escapeAttr(word.term)}" type="button" aria-label="朗读 ${escapeAttr(word.term)}">🔊</button>
        </header>
        <blockquote>
          ${escapeHtml(word.example)}
          <small>${escapeHtml(word.exampleZh)}</small>
        </blockquote>
      </article>
    `).join("");
  }

  function getDueWords() {
    const now = Date.now();
    return learnedIds()
      .filter((id) => (state.learned[id].nextReview || 0) <= now)
      .map((id) => wordsById[id]);
  }

  function prepareReview(forceAll = false) {
    reviewQueue = forceAll ? learnedIds().map((id) => wordsById[id]) : getDueWords();
    reviewIndex = 0;
    renderReview();
  }

  function renderReview() {
    const hasWords = reviewQueue.length > 0 && reviewIndex < reviewQueue.length;
    $("reviewEmpty").hidden = hasWords;
    $("reviewCard").hidden = !hasWords;
    $("reviewAll").hidden = learnedIds().length === 0;
    if (!hasWords) {
      updateGlobalStats();
      return;
    }

    const word = reviewQueue[reviewIndex];
    $("reviewBadge").textContent = categoryMap[word.category];
    $("reviewPosition").textContent = `${reviewIndex + 1} / ${reviewQueue.length}`;
    $("reviewTerm").textContent = word.term;
    $("reviewPhonetic").textContent = word.phonetic;
    $("reviewMeaning").textContent = word.meaning;
    $("reviewExample").textContent = word.example;
    $("reviewExampleZh").textContent = word.exampleZh;
    $("reviewAnswer").hidden = true;
    $("reviewRatings").hidden = true;
    $("revealReview").hidden = false;
  }

  function rateReview(rating) {
    const word = reviewQueue[reviewIndex];
    const item = state.learned[word?.id];
    if (!word || !item) return;

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    item.reviews = (item.reviews || 0) + 1;
    if (rating === "again") {
      item.level = Math.max(0, (item.level || 0) - 1);
      item.interval = 0;
      item.nextReview = now + 5 * 60 * 1000;
    } else if (rating === "hard") {
      item.level = Math.max(1, item.level || 0);
      item.interval = Math.max(1, Math.round((item.interval || 1) * 1.5));
      item.nextReview = now + item.interval * day;
    } else {
      item.level = (item.level || 0) + 1;
      const schedule = [1, 3, 7, 14, 30, 60];
      item.interval = schedule[Math.min(item.level - 1, schedule.length - 1)];
      item.nextReview = now + item.interval * day;
    }
    saveState();
    reviewIndex += 1;
    renderReview();
    renderCategories();
  }

  function renderLearned() {
    const query = $("learnedSearch").value.trim().toLowerCase();
    const category = $("learnedCategory").value;
    const words = learnedIds()
      .map((id) => wordsById[id])
      .filter((word) => (category === "all" || word.category === category)
        && (!query || `${word.term} ${word.phonetic} ${word.meaning}`.toLowerCase().includes(query)))
      .sort((a, b) => a.term.localeCompare(b.term));

    $("learnedEmpty").hidden = learnedIds().length > 0;
    $("learnedList").innerHTML = words.slice(0, 150).map((word) => `
      <article class="word-row">
        <div>
          <span class="category-badge">${escapeHtml(categoryMap[word.category])}</span>
          <h3>${escapeHtml(word.term)}</h3>
          <p class="phonetic">${escapeHtml(word.phonetic)}</p>
          <p>${escapeHtml(word.meaning)}</p>
        </div>
        <div class="word-row-actions">
          <button class="remove-word" data-remove="${word.id}" type="button">移出已学</button>
          ${word.custom ? `<button class="remove-word delete" data-delete-custom="${word.id}" type="button">删除单词</button>` : ""}
        </div>
      </article>
    `).join("");
  }

  function renderCategories() {
    const counts = Object.fromEntries(data.categories.map((category) => [category.id, { total: 0, learned: 0 }]));
    allWords.forEach((word) => {
      counts[word.category].total += 1;
      if (isLearned(word.id)) counts[word.category].learned += 1;
    });

    $("categoryGrid").innerHTML = data.categories.map((category) => {
      const item = counts[category.id];
      const percent = item.total ? Math.round((item.learned / item.total) * 100) : 0;
      return `
        <button class="category-card" data-category="${category.id}" type="button">
          <span class="category-icon">${categoryIcons[category.id] || "A"}</span>
          <h3>${escapeHtml(category.label)}</h3>
          <p>${item.learned} / ${item.total} 已学</p>
          <span class="mini-track"><i style="width:${percent}%"></i></span>
        </button>
      `;
    }).join("");
  }

  function refreshAllViews() {
    const category = $("learnCategory").value || "all";
    filterLearn(category);
    renderExamples();
    renderLearned();
    renderCategories();
    updateGlobalStats();
  }

  function removeLearned(id) {
    delete state.learned[id];
    saveState();
    renderLearned();
    renderCategories();
  }

  function deleteCustomWord(id) {
    const word = wordsById[id];
    if (!word?.custom || !window.confirm(`确定删除手动添加的“${word.term}”吗？`)) return;
    state.customWords = state.customWords.filter((item) => item.id !== id);
    delete state.learned[id];
    state.favorites = state.favorites.filter((item) => item !== id);
    refreshWordData();
    saveState();
    refreshAllViews();
  }

  function openSettings() {
    $("accentSelect").value = state.settings.accent;
    $("rateRange").value = state.settings.rate;
    $("rateValue").textContent = `${Number(state.settings.rate).toFixed(2)}×`;
    refreshVoices();
    $("settingsDialog").showModal();
  }

  function openAddWord() {
    $("addWordError").textContent = "";
    $("addWordDialog").showModal();
  }

  function addCustomWord(event) {
    event.preventDefault();
    const term = $("customTerm").value.trim();
    const phonetic = $("customPhonetic").value.trim();
    const meaning = $("customMeaning").value.trim();
    const category = $("customCategory").value;
    const example = $("customExample").value.trim();
    const exampleZh = $("customExampleZh").value.trim();
    const duplicate = allWords.some((word) => word.term.trim().toLowerCase() === term.toLowerCase());
    if (duplicate) {
      $("addWordError").textContent = "这个单词或短语已经存在。";
      return;
    }

    const id = `c${Date.now()}`;
    const word = {
      id, term, phonetic, meaning, category, example, exampleZh,
      usage: "", note: "手动添加", sources: ["手动添加"], custom: true
    };
    state.customWords.push(word);
    if ($("customLearned").checked) state.learned[id] = newLearnedRecord();
    refreshWordData();
    saveState();
    $("addWordForm").reset();
    $("customLearned").checked = true;
    $("addWordDialog").close();
    refreshAllViews();
    switchView("learned");
  }

  function clearProgress() {
    if (!window.confirm("确定清除全部学习、复习和收藏记录吗？手动添加的单词会保留。")) return;
    state.learned = {};
    state.favorites = [];
    saveState();
    refreshAllViews();
  }

  function deleteAllCustomWords() {
    if (!state.customWords.length) {
      window.alert("目前没有手动添加的单词。");
      return;
    }
    if (!window.confirm(`确定删除全部 ${state.customWords.length} 个手动添加的单词吗？`)) return;
    const customIds = new Set(state.customWords.map((word) => word.id));
    state.customWords = [];
    customIds.forEach((id) => delete state.learned[id]);
    state.favorites = state.favorites.filter((id) => !customIds.has(id));
    refreshWordData();
    saveState();
    refreshAllViews();
  }

  function resetEverything() {
    if (!window.confirm("确定恢复到初始状态吗？这会清除学习记录、收藏、发音设置和全部手动添加单词。")) return;
    state = emptyState();
    refreshWordData();
    saveState();
    refreshVoices();
    refreshAllViews();
    $("settingsDialog").close();
  }

  function switchView(viewName) {
    document.querySelectorAll(".view").forEach((view) =>
      view.classList.toggle("active", view.id === `view-${viewName}`)
    );
    document.querySelectorAll(".bottom-nav button").forEach((button) =>
      button.classList.toggle("active", button.dataset.view === viewName)
    );
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (viewName === "review") prepareReview(false);
    if (viewName === "learned") renderLearned();
    if (viewName === "categories") renderCategories();
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function bindEvents() {
    $("learnCategory").addEventListener("change", (event) => filterLearn(event.target.value));
    $("previousWord").addEventListener("click", () => moveLearn(-1));
    $("nextWord").addEventListener("click", () => moveLearn(1));
    $("markLearned").addEventListener("click", markCurrentLearned);
    $("favoriteButton").addEventListener("click", toggleFavorite);
    $("revealLearn").addEventListener("click", () => {
      $("learnAnswer").hidden = false;
      $("revealLearn").hidden = true;
    });
    $("speakLearn").addEventListener("click", () => speak(currentLearnWord().term));

    $("exampleSearch").addEventListener("input", renderExamples);
    $("exampleCategory").addEventListener("change", renderExamples);
    $("exampleList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-speak]");
      if (button) speak(button.dataset.speak);
    });

    $("revealReview").addEventListener("click", () => {
      $("reviewAnswer").hidden = false;
      $("reviewRatings").hidden = false;
      $("revealReview").hidden = true;
    });
    $("speakReview").addEventListener("click", () => {
      if (reviewQueue[reviewIndex]) speak(reviewQueue[reviewIndex].term);
    });
    $("reviewRatings").addEventListener("click", (event) => {
      const button = event.target.closest("[data-rating]");
      if (button) rateReview(button.dataset.rating);
    });
    $("reviewAll").addEventListener("click", () => prepareReview(true));

    $("learnedSearch").addEventListener("input", renderLearned);
    $("learnedCategory").addEventListener("change", renderLearned);
    $("learnedList").addEventListener("click", (event) => {
      const removeButton = event.target.closest("[data-remove]");
      const deleteButton = event.target.closest("[data-delete-custom]");
      if (deleteButton) deleteCustomWord(deleteButton.dataset.deleteCustom);
      else if (removeButton) removeLearned(removeButton.dataset.remove);
    });

    $("categoryGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      $("learnCategory").value = button.dataset.category;
      filterLearn(button.dataset.category);
      switchView("learn");
    });

    document.querySelector(".bottom-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-view]");
      if (button) switchView(button.dataset.view);
    });

    $("settingsButton").addEventListener("click", openSettings);
    $("accentSelect").addEventListener("change", (event) => {
      state.settings.accent = event.target.value;
      state.settings.voiceName = "";
      saveState();
      refreshVoices();
    });
    $("voiceSelect").addEventListener("change", (event) => {
      state.settings.voiceName = event.target.value;
      saveState();
    });
    $("rateRange").addEventListener("input", (event) => {
      state.settings.rate = Number(event.target.value);
      $("rateValue").textContent = `${state.settings.rate.toFixed(2)}×`;
      saveState();
    });
    $("testVoice").addEventListener("click", () => speak("Welcome to Azu English."));
    $("clearProgress").addEventListener("click", clearProgress);
    $("deleteCustomWords").addEventListener("click", deleteAllCustomWords);
    $("resetEverything").addEventListener("click", resetEverything);

    $("addWordButton").addEventListener("click", openAddWord);
    $("closeAddWord").addEventListener("click", () => $("addWordDialog").close());
    $("addWordForm").addEventListener("submit", addCustomWord);

    if ("speechSynthesis" in window) {
      speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    }
  }

  function initialize() {
    refreshWordData();
    [$("learnCategory"), $("exampleCategory"), $("learnedCategory")].forEach((select) =>
      fillCategorySelect(select)
    );
    fillCategorySelect($("customCategory"), false);
    $("rateRange").value = state.settings.rate;
    $("rateValue").textContent = `${Number(state.settings.rate).toFixed(2)}×`;
    refreshVoices();
    updateGlobalStats();
    filterLearn("all");
    renderExamples();
    renderLearned();
    renderCategories();
    bindEvents();
  }

  initialize();
})();
