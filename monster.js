// ===== 每日小怪物 =====
// 選小孩後（每天每個小孩第一次）跳出，守著一個單字。
// 打敗它 = 玩一場「單字版」遊戲練那個字。

var monsterWord = null;   // 今天怪物守的單字
var monsterEmojis = ['👹', '👾', '🐉', '👻', '🦖', '🧟', '🦑', '🤖'];

// 選小孩時呼叫：判斷今天該小孩是否要跳怪物
async function maybeShowDailyMonster(child) {
  var key = 'lastMonsterDate-' + child;
  var s = await dbGet('settings', key);
  var today = getTodayStr();
  if (s && s.value === today) return; // 今天這個小孩已經看過了

  // 智慧選字：優先今日待複習(due)，沒有就選全新沒學過的字
  var word = await pickMonsterWord();
  if (!word) return; // 沒單字可選就不跳

  monsterWord = word;
  // 標記今天已跳
  await dbPut('settings', { key: key, value: today });
  showMonsterModal(word, child);
}

async function pickMonsterWord() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  if (!words.length) return null;

  // 先找 due 字（要複習的）
  var due = [];
  var fresh = [];
  for (var i = 0; i < words.length; i++) {
    var p = await getProgressFor(words[i].id);
    if (!p) { fresh.push(words[i]); continue; }
    p = fsrsUpgrade(p);
    if (!p.reps || p.reps === 0) { fresh.push(words[i]); continue; }
    if (p.due && p.due <= Date.now()) due.push(words[i]);
  }
  if (due.length > 0) return due[Math.floor(Math.random() * due.length)];
  if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)];
  // 都沒有就隨機一個
  return words[Math.floor(Math.random() * words.length)];
}

function showMonsterModal(word, child) {
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
      '<div class="monster-creature" id="monsterCreature">' + emoji + '</div>' +
      '<div class="monster-speech">「想過關？先學會我守的單字！」</div>' +
      '<div class="monster-word-card">' +
        (img ? '<img class="monster-word-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '<div class="monster-word">' + esc(word.word) + '</div>' +
        '<div class="monster-meaning">' + esc(word.meaning) + '</div>' +
        '<button class="monster-speak" onclick="speakWord(\'' + esc(word.word) + '\', 0.7)">🔊 聽發音</button>' +
      '</div>' +
      '<button class="monster-fight-btn" onclick="startMonsterBattle()">⚔️ 去打敗它！</button>' +
      '<button class="btn-ghost" onclick="hideModal(\'modal-monster\')">等一下再說</button>' +
    '</div>';
  modal.hidden = false;
  // 進場念一次
  setTimeout(function() { speakWord(word.word, 0.7); }, 400);
}

// 打怪物：依單字熟練度選一個適合的「單字版」遊戲
async function startMonsterBattle() {
  hideModal('modal-monster');
  if (!monsterWord) return;
  currentMode = 'kid';

  var s = await getWordStability(monsterWord.id);
  // 依熟練度選遊戲（新字用看圖選字，熟字用拼字/讀句）
  var gameType;
  if (s < 3) gameType = 'listen';
  else if (s < 15) gameType = 'spelling';
  else gameType = 'cloze';

  // 需要例句的遊戲，若該字沒例句就退回 listen
  if ((gameType === 'cloze') && !(monsterWord.sentences && monsterWord.sentences.length)) gameType = 'spelling';

  goTo('page-game');
  document.getElementById('gameTitle').textContent = '⚔️ 打敗小怪物';
  document.getElementById('gameScore').textContent = '';
  var area = document.getElementById('gameArea');
  area.innerHTML = '';

  // 用怪物 + 3 個干擾字組一題
  var allWords = await dbGetByIndex('words', 'pool', 'permanent');
  var others = shuffleArray(allWords.filter(function(w){ return w.id !== monsterWord.id; })).slice(0, 3);

  monsterBattleRound(area, monsterWord, others, gameType);
}

// 單題怪物戰
function monsterBattleRound(area, target, others, gameType) {
  var options = shuffleArray([target].concat(others));
  var emoji = monsterEmojis[Math.floor(Math.random() * monsterEmojis.length)];

  function onResult(isCorrect) {
    updateProgress(target.id, isCorrect, gameType, { mistakes: isCorrect ? 0 : 1 });
    if (isCorrect) {
      // 打敗怪物動畫
      showMonsterDefeated();
    } else {
      // 答錯：怪物嘲笑，再給一次
      var c = document.getElementById('mbCreature');
      if (c) { c.classList.add('monster-laugh'); setTimeout(function(){ c.classList.remove('monster-laugh'); }, 600); }
    }
  }

  // 依 gameType 渲染（這裡用通用的「看圖/讀句選字」單題）
  var img = getRandomImage(target);
  var promptHtml, optsHtml;

  if (gameType === 'spelling') {
    // 拼字版：交給 spelling 的單字模式較複雜，這裡簡化成「看圖選字」
    gameType = 'listen';
  }

  if (gameType === 'cloze' && target.sentences && target.sentences.length) {
    var sentence = target.sentences.find(function(s){ return s && s.trim(); });
    var blanked = sentence.replace(new RegExp('\\b' + target.word + '\\b', 'gi'), '______');
    promptHtml = '<div class="mb-sentence">' + esc(blanked) +
      ' <button class="cloze-speak" onclick="speakWord(\'' + esc(sentence) + '\',0.7)">🔊</button></div>';
    optsHtml = options.map(function(o){ return '<button class="mb-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>'; }).join('');
    setTimeout(function(){ speakWord(sentence, 0.7); }, 400);
  } else {
    // 看圖選字
    promptHtml = (img ? '<img class="mb-image" src="' + img + '" alt="">' : '<div class="mb-meaning">' + esc(target.meaning) + '</div>') +
      '<button class="cloze-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.7)">🔊</button>';
    optsHtml = options.map(function(o){ return '<button class="mb-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>'; }).join('');
  }

  area.innerHTML =
    '<div class="mb-container">' +
      '<div class="mb-creature" id="mbCreature">' + emoji + '</div>' +
      '<div class="mb-prompt">' + promptHtml + '</div>' +
      '<div class="mb-opts">' + optsHtml + '</div>' +
    '</div>';

  area.querySelectorAll('.mb-opt').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ok = parseInt(btn.dataset.id) === target.id;
      btn.classList.add(ok ? 'correct' : 'wrong');
      if (ok) {
        speakWord(target.word);
        area.querySelectorAll('.mb-opt').forEach(function(b){ b.style.pointerEvents = 'none'; });
      }
      onResult(ok);
    });
  });
}

function showMonsterDefeated() {
  var area = document.getElementById('gameArea');
  var div = document.createElement('div');
  div.className = 'monster-defeated';
  div.innerHTML = '<div class="monster-defeated-emoji">💥</div><div class="monster-defeated-text">打敗小怪物了！🎉</div>';
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('show'); }, 30);
  setTimeout(function() {
    div.classList.remove('show');
    setTimeout(function() { div.remove(); goTo('page-home'); }, 400);
  }, 2200);
}
