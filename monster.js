// ===== 每日小怪物 =====
// 進入「小寶貝模式 / 挑戰模式」時（每天每個小孩第一次）跳出，守著一個單字。
// 打敗它 = 用「該模式」的單字版遊戲練那個字。
// 跳過（等一下）不算完成，今天稍後再進模式還會跳；只有真的打敗才標記完成。

var monsterWord = null;    // 今天怪物守的單字
var monsterMode = 'kid';   // 觸發時的模式（baby / kid）
var monsterChild = 'boy';  // 觸發時的小孩（標記完成時用，避免 currentChild 被改動）
var monsterEmojis = ['👹', '👾', '🐉', '👻', '🦖', '🧟', '🦑', '🤖'];

// 進入模式時呼叫
async function maybeShowDailyMonster(child, mode) {
  monsterMode = mode || 'kid';
  monsterChild = child;
  var key = 'monsterDone-' + child;
  var s = await dbGet('settings', key);
  var today = getTodayStr();
  if (s && s.value === today) {
    // 今天這個小孩已經打敗過了 → 直接進遊戲選單
    if (typeof proceedToGames === 'function') proceedToGames();
    return;
  }

  var word = await pickMonsterWord();
  if (!word) { if (typeof proceedToGames === 'function') proceedToGames(); return; }

  monsterWord = word;
  showMonsterModal(word);
}

async function pickMonsterWord() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  if (!words.length) return null;
  var due = [], fresh = [];
  for (var i = 0; i < words.length; i++) {
    var p = await getProgressFor(words[i].id);
    if (!p) { fresh.push(words[i]); continue; }
    p = fsrsUpgrade(p);
    if (!p.reps || p.reps === 0) { fresh.push(words[i]); continue; }
    if (p.due && p.due <= Date.now()) due.push(words[i]);
  }
  if (due.length > 0) return due[Math.floor(Math.random() * due.length)];
  if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)];
  return words[Math.floor(Math.random() * words.length)];
}

function showMonsterModal(word) {
  var modal = document.getElementById('modal-monster');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-monster';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  var emoji = monsterEmojis[Math.floor(Math.random() * monsterEmojis.length)];
  var img = getRandomImage(word);
  modal.innerHTML =
    '<div class="monster-modal">' +
      '<div class="monster-title">👀 今天出現一隻小怪物！</div>' +
      '<div class="monster-creature">' + emoji + '</div>' +
      '<div class="monster-speech">「想過關？先學會我守的單字！」</div>' +
      '<div class="monster-word-card">' +
        (img ? '<img class="monster-word-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '<div class="monster-word">' + esc(word.word) + '</div>' +
        '<div class="monster-meaning">' + esc(word.meaning) + '</div>' +
        '<button class="monster-speak" onclick="speakWord(\'' + esc(word.word) + '\', 0.7)">🔊 聽發音</button>' +
      '</div>' +
      '<button class="monster-fight-btn" onclick="startMonsterBattle()">⚔️ 去打敗它！</button>' +
      '<button class="btn-ghost" onclick="monsterSkip()">等一下再說</button>' +
    '</div>';
  modal.hidden = false;
  setTimeout(function() { speakWord(word.word, 0.7); }, 400);
}

// 跳過：不標記完成（今天稍後再進模式還會跳），直接進遊戲選單
function monsterSkip() {
  hideModal('modal-monster');
  if (typeof proceedToGames === 'function') proceedToGames();
}

// 打怪物：依「模式 + 單字熟練度」選一個單字版遊戲
async function startMonsterBattle() {
  hideModal('modal-monster');
  if (!monsterWord) { if (typeof proceedToGames === 'function') proceedToGames(); return; }

  var gameType;
  if (monsterMode === 'baby') {
    // 小寶貝模式：只用看圖選字（聽音+看圖）
    gameType = 'listen-baby';
  } else {
    // 挑戰模式：依熟練度選
    var s = await getWordStability(monsterWord.id);
    if (s < 3) gameType = 'listen-kid';
    else if (s < 15) gameType = 'cloze';
    else gameType = 'cloze';
    // cloze 需要例句，沒有就退回看圖選字
    if (gameType === 'cloze' && !(monsterWord.sentences && monsterWord.sentences.length)) gameType = 'listen-kid';
  }

  goTo('page-game');
  document.getElementById('gameTitle').textContent = '⚔️ 打敗小怪物';
  document.getElementById('gameScore').textContent = '';
  var area = document.getElementById('gameArea');
  area.innerHTML = '';

  var allWords = await dbGetByIndex('words', 'pool', 'permanent');
  var others = shuffleArray(allWords.filter(function(w){ return w.id !== monsterWord.id; })).slice(0, 3);

  monsterBattleRound(area, monsterWord, others, gameType);
}

function monsterBattleRound(area, target, others, gameType) {
  var options = shuffleArray([target].concat(others));
  var emoji = monsterEmojis[Math.floor(Math.random() * monsterEmojis.length)];
  var img = getRandomImage(target);
  var promptHtml, optsHtml;

  if (gameType === 'cloze' && target.sentences && target.sentences.length) {
    var sentence = target.sentences.find(function(s){ return s && s.trim(); });
    var blanked = sentence.replace(new RegExp('\\b' + target.word + '\\b', 'gi'), '______');
    promptHtml = '<div class="mb-sentence">' + esc(blanked) +
      ' <button class="cloze-speak" onclick="speakWord(\'' + esc(sentence) + '\',0.7)">🔊</button></div>';
    optsHtml = options.map(function(o){ return '<button class="mb-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>'; }).join('');
    setTimeout(function(){ speakWord(sentence, 0.7); }, 400);
  } else if (gameType === 'listen-baby') {
    // 小寶貝：聽音 + 選圖（選項用圖片）
    promptHtml = '<button class="baby-speak baby-speak-big" onclick="speakWord(\'' + esc(target.word) + '\',0.6)">🔊</button>' +
      '<div class="mb-word-small">' + esc(target.word) + '</div>';
    optsHtml = options.map(function(o){
      var oimg = getRandomImage(o);
      return '<button class="mb-opt mb-opt-img" data-id="' + o.id + '">' +
        (oimg ? '<img src="' + oimg + '" alt="' + esc(o.meaning) + '">' : '<span>' + esc(o.meaning) + '</span>') +
        '</button>';
    }).join('');
    setTimeout(function(){ speakWord(target.word, 0.6); }, 400);
    setTimeout(function(){ speakWord(target.word, 0.5); }, 1600);
  } else {
    // 挑戰看圖選字
    promptHtml = (img ? '<img class="mb-image" src="' + img + '" alt="">' : '<div class="mb-meaning">' + esc(target.meaning) + '</div>') +
      '<button class="cloze-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.7)">🔊</button>';
    optsHtml = options.map(function(o){ return '<button class="mb-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>'; }).join('');
  }

  area.innerHTML =
    '<div class="mb-container">' +
      '<div class="mb-creature" id="mbCreature">' + emoji + '</div>' +
      '<div class="mb-prompt">' + promptHtml + '</div>' +
      '<div class="mb-opts ' + (gameType === 'listen-baby' ? 'mb-opts-img' : '') + '">' + optsHtml + '</div>' +
    '</div>';

  area.querySelectorAll('.mb-opt').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ok = parseInt(btn.dataset.id) === target.id;
      btn.classList.add(ok ? 'correct' : 'wrong');
      speakWord(target.word);
      updateProgress(target.id, ok, gameType === 'cloze' ? 'cloze' : 'listen', { mistakes: ok ? 0 : 1 });
      if (ok) {
        area.querySelectorAll('.mb-opt').forEach(function(b){ b.style.pointerEvents = 'none'; });
        markMonsterDone();
        setTimeout(showMonsterDefeated, 600);
      } else {
        var c = document.getElementById('mbCreature');
        if (c) { c.classList.add('monster-laugh'); setTimeout(function(){ c.classList.remove('monster-laugh'); }, 600); }
        btn.style.pointerEvents = 'none';
      }
    });
  });
}

// 標記今天這個小孩已打敗怪物
async function markMonsterDone() {
  await dbPut('settings', { key: 'monsterDone-' + monsterChild, value: getTodayStr() });
}

function showMonsterDefeated() {
  var div = document.createElement('div');
  div.className = 'monster-defeated';
  div.innerHTML = '<div class="monster-defeated-emoji">💥</div><div class="monster-defeated-text">打敗小怪物了！🎉</div>';
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('show'); }, 30);
  setTimeout(function() {
    div.classList.remove('show');
    setTimeout(function() { div.remove(); if (typeof proceedToGames === 'function') proceedToGames(); }, 400);
  }, 2200);
}
