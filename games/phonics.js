// ===== 拼讀遊戲（Phonics）=====
// 小寶貝（baby）：「首音聽辨」— 聽單字，選出開頭的字母（例：聽 ball → 選 b）
//   訓練聽出字首的音（phonemic awareness），不需要會拼字。
// 挑戰（kid）：「看字拼讀」— 看到單字先自己念，再按喇叭對答案，最後選出意思對的圖
//   用常見字母組合（sh、ch、th、ee、oo…）標色，幫助把字拆成音塊。
// 註：瀏覽器語音念單一字母通常會念「字母名」（B=bee），不是字母音，
//     所以這裡一律用「整個單字」與「示範字」發音，不單獨念字母。

var PHONICS_ROUNDS = 8;

// 字母的示範字（讓孩子聽「字母的音」而不是字母名）
var PHONICS_KEY_WORDS = {
  a: 'apple', b: 'ball', c: 'cat', d: 'dog', e: 'egg', f: 'fish', g: 'goat', h: 'hat', i: 'insect', j: 'jam',
  k: 'kite', l: 'lion', m: 'moon', n: 'nose', o: 'octopus', p: 'pig', q: 'queen', r: 'rabbit', s: 'sun', t: 'tiger',
  u: 'umbrella', v: 'van', w: 'water', x: 'fox', y: 'yellow', z: 'zebra'
};

// 常見字母組合（長的先比對）
var PHONICS_CHUNKS = ['tch', 'igh', 'sh', 'ch', 'th', 'wh', 'ph', 'ck', 'ng', 'qu',
  'ee', 'ea', 'oo', 'ai', 'ay', 'oa', 'ow', 'ou', 'oi', 'oy', 'ar', 'or', 'er', 'ir', 'ur'];

// 小寶貝：首字母容易混淆時用「聽起來不同」的干擾字母
var PHONICS_EASY_LETTERS = 'bcdfghjklmnprstvwz'.split('');

// 把單字切成拼讀音塊：[{t:'sh', chunk:true}, {t:'i'}, {t:'p'}]
function phonicsSplit(word) {
  var w = String(word || '').toLowerCase();
  var out = [];
  var i = 0;
  while (i < w.length) {
    var hit = null;
    for (var k = 0; k < PHONICS_CHUNKS.length; k++) {
      var c = PHONICS_CHUNKS[k];
      if (w.substr(i, c.length) === c) { hit = c; break; }
    }
    if (hit) { out.push({ t: hit, chunk: true }); i += hit.length; }
    else { out.push({ t: w[i], chunk: false }); i++; }
  }
  return out;
}

// 適合拼讀的字：單一英文單字、純字母、3–8 個字母
function isPhonicsWord(w) {
  var s = String(w.word || '').trim();
  return /^[A-Za-z]{3,8}$/.test(s);
}

function initPhonicsGame(area, words, mode) {
  var isBaby = mode === 'baby';
  var pool = words.filter(isPhonicsWord);
  // 小寶貝：首字母要是母音以外、且規則的子音開頭，聽辨比較清楚
  if (isBaby) {
    var easy = pool.filter(function(w) { return PHONICS_EASY_LETTERS.indexOf(w.word[0].toLowerCase()) !== -1; });
    if (easy.length >= 4) pool = easy;
  }
  if (pool.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個 3–8 個字母的單字才能玩拼讀！</p>';
    return;
  }
  var queue = shuffleArray(pool).slice(0, Math.min(PHONICS_ROUNDS, pool.length));
  var total = queue.length;
  var current = 0, correct = 0;

  function next() {
    if (current >= total) { showResult(correct, total); return; }
    if (isBaby) renderFirstSound(queue[current]); else renderDecode(queue[current]);
  }

  // ---------- 小寶貝：聽單字，選開頭字母 ----------
  function renderFirstSound(target) {
    var first = target.word[0].toLowerCase();
    var others = shuffleArray(PHONICS_EASY_LETTERS.filter(function(l) { return l !== first; })).slice(0, 2);
    var opts = shuffleArray([first].concat(others));
    var img = getRandomImage(target);
    var answered = false, mistakes = 0;
    area.innerHTML =
      '<div class="phon">' +
        '<div class="phon-progress">🔤 ' + (current + 1) + ' / ' + total + '</div>' +
        '<button class="phon-pic" id="phonPic" aria-label="再聽一次">' +
          (img ? '<img src="' + img + '" alt="">' : '<span class="phon-pic-empty">🔊</span>') +
        '</button>' +
        '<div class="phon-prompt">聽聽看，<b>第一個音</b>是哪個字母？</div>' +
        '<div class="phon-letters">' +
          opts.map(function(l) {
            return '<button class="phon-letter" data-l="' + l + '">' +
              '<span class="phon-letter-big">' + l + '</span>' +
              '<span class="phon-letter-key">' + esc(PHONICS_KEY_WORDS[l] || '') + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="phon-feedback" id="phonFb" role="status" aria-live="polite"></div>' +
      '</div>';
    var say = function() { speakWord(target.word, 0.55); };
    setTimeout(say, 300);
    document.getElementById('phonPic').onclick = say;
    area.querySelectorAll('.phon-letter').forEach(function(b) {
      b.addEventListener('click', async function() {
        if (answered) return;
        var l = b.dataset.l;
        if (l === first) {
          answered = true;
          b.classList.add('correct');
          if (mistakes === 0) correct++;
          document.getElementById('phonFb').innerHTML =
            '<span class="phon-win">🎉 ' + esc(target.word) + ' 是 <b>' + first + '</b> 開頭！</span>';
          speakWord(target.word, 0.6);
          await updateProgress(target.id, mistakes === 0, 'phonics', { mistakes: mistakes });
          document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
          setTimeout(function() { current++; next(); }, 1800);
        } else {
          mistakes++;
          b.classList.add('wrong');
          b.disabled = true;
          // 念示範字，讓孩子比較「bee 的 b」和「目標字的開頭」聽起來不一樣
          speakWord(PHONICS_KEY_WORDS[l] || l, 0.6);
          setTimeout(function() { speakWord(target.word, 0.55); }, 1100);
        }
      });
    });
  }

  // ---------- 挑戰：看字 → 自己念 → 聽答案 → 選意思 ----------
  function renderDecode(target) {
    var parts = phonicsSplit(target.word);
    var others = shuffleArray(words.filter(function(w) { return w.id !== target.id && getRandomImage(w); })).slice(0, 2);
    var answered = false, mistakes = 0, heard = false;
    area.innerHTML =
      '<div class="phon">' +
        '<div class="phon-progress">🔤 ' + (current + 1) + ' / ' + total + '</div>' +
        '<div class="phon-prompt">先<b>自己念念看</b>，再按喇叭對答案</div>' +
        '<div class="phon-word" aria-label="' + esc(target.word) + '">' +
          parts.map(function(p) {
            return '<span class="phon-part' + (p.chunk ? ' phon-chunk' : '') + '">' + esc(p.t) + '</span>';
          }).join('') +
        '</div>' +
        '<div class="phon-actions">' +
          '<button class="phon-speak" id="phonSpeak">🔊 對答案</button>' +
          '<button class="btn-sm" id="phonSlow">🐢 慢慢念</button>' +
        '</div>' +
        '<div class="phon-mean" id="phonMean" hidden>' +
          '<div class="phon-prompt">它是什麼意思？</div>' +
          '<div class="phon-choices" id="phonChoices"></div>' +
        '</div>' +
        '<div class="phon-feedback" id="phonFb" role="status" aria-live="polite"></div>' +
      '</div>';

    function reveal() {
      if (heard) return;
      heard = true;
      var box = document.getElementById('phonChoices');
      var opts = shuffleArray([target].concat(others));
      box.innerHTML = opts.map(function(o) {
        var img = getRandomImage(o);
        return '<button class="phon-choice" data-id="' + o.id + '">' +
          (img ? '<img src="' + img + '" alt="">' : '') +
          '<span>' + esc(o.meaning || '') + '</span>' +
        '</button>';
      }).join('');
      document.getElementById('phonMean').hidden = false;
      box.querySelectorAll('.phon-choice').forEach(function(b) {
        b.addEventListener('click', async function() {
          if (answered) return;
          var ok = parseInt(b.dataset.id) === target.id;
          if (!ok) {
            mistakes++;
            b.classList.add('wrong');
            b.disabled = true;
            return;
          }
          answered = true;
          b.classList.add('correct');
          if (mistakes === 0) correct++;
          document.getElementById('phonFb').innerHTML = '<span class="phon-win">🎉 ' + esc(target.word) + ' = ' + esc(target.meaning || '') + '</span>';
          speakWord(target.word, 0.7);
          await updateProgress(target.id, mistakes === 0, 'phonics', { mistakes: mistakes });
          document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
          setTimeout(function() { current++; next(); }, 1600);
        });
      });
    }

    document.getElementById('phonSpeak').onclick = function() { speakWord(target.word, 0.7); reveal(); };
    document.getElementById('phonSlow').onclick = function() { speakWord(target.word, 0.4); reveal(); };
  }

  next();
}
