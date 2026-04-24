// ===== 覆蓋 app.js 的函式 =====

// 遊戲來源選擇 + 標籤篩選
async function updateGameSource() {
  var tagSel = document.getElementById('gameTagFilter');
  if (tagSel) {
    var tags = await getAllTags();
    var cur = tagSel.value;
    tagSel.innerHTML = '<option value="all">所有標籤</option>';
    tags.forEach(function(t) {
      tagSel.innerHTML += '<option value="' + esc(t) + '"' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>';
    });
  }
}

async function getGameWords() {
  var source = document.getElementById('gameSource') ? document.getElementById('gameSource').value : 'permanent';
  var tagFilter = document.getElementById('gameTagFilter') ? document.getElementById('gameTagFilter').value : 'all';
  var words;
  if (source.indexOf('exam-') === 0) {
    words = currentGameWords.length > 0 ? currentGameWords : await dbGetByIndex('words', 'pool', source);
  } else if (source === 'due') {
    words = await getDueWords('permanent');
    if (words.length < 4) words = await dbGetByIndex('words', 'pool', 'permanent');
  } else {
    words = await dbGetByIndex('words', 'pool', 'permanent');
  }
  if (tagFilter !== 'all') {
    words = words.filter(function(w) { return w.tags && w.tags.indexOf(tagFilter) !== -1; });
  }
  if (words.length < 4) { alert('單字不夠，至少需要 4 個！'); return null; }
  return shuffleArray(words);
}

// 每日挑戰改回可選遊戲
function startDailyWithRole(role) {
  dailyRole = role;
  currentMode = 'kid';
  renderGameCards();
  document.getElementById('gamesTitle').textContent = (role === 'boy' ? '👦' : '👧') + ' 每日挑戰 — 選一個遊戲';
  var srcEl = document.getElementById('gameSource');
  if (srcEl) {
    srcEl.value = 'due';
    srcEl.parentElement.style.display = '';
  }
  updateGameSource();
  goTo('page-games');
}
