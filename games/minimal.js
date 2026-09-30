// ===== 易混音辨識（Minimal Pairs）=====
// 聽一個字 → 從兩個「只差一個音」的字中選出來（例：ship / sheep）
// 針對台灣孩子常見的混淆音：長短母音、l/r、th/s、v/b、n/ng、字尾子音
// 內建字組（不依賴單字庫）；若字組中的字在單字庫裡，答題會一併寫入該字的 FSRS
// 小寶貝：選項用 emoji + 中文（不看英文）；挑戰：選項顯示英文 + emoji

var MINIMAL_ROUNDS = 8;

// [字A, emojiA, 中文A, 字B, emojiB, 中文B, 類別]
var MINIMAL_PAIRS = [
  ['ship', '🚢', '船', 'sheep', '🐑', '綿羊', 'i / ee'],
  ['sit', '🪑', '坐', 'seat', '💺', '座位', 'i / ee'],
  ['live', '🏠', '住', 'leave', '👋', '離開', 'i / ee'],
  ['hit', '👊', '打', 'heat', '🔥', '熱', 'i / ee'],
  ['bed', '🛏️', '床', 'bad', '👎', '壞的', 'e / a'],
  ['pen', '🖊️', '筆', 'pan', '🍳', '平底鍋', 'e / a'],
  ['men', '👨‍👨‍👦', '男人們', 'man', '👨', '男人', 'e / a'],
  ['cap', '🧢', '帽子', 'cup', '🥤', '杯子', 'a / u'],
  ['hat', '🎩', '帽子', 'hut', '🛖', '小屋', 'a / u'],
  ['full', '🈵', '滿的', 'fool', '🤡', '傻瓜', 'u / oo'],
  ['light', '💡', '燈', 'right', '👉', '右邊', 'l / r'],
  ['lock', '🔒', '鎖', 'rock', '🪨', '石頭', 'l / r'],
  ['long', '📏', '長的', 'wrong', '❌', '錯的', 'l / r'],
  ['glass', '🥛', '玻璃杯', 'grass', '🌱', '草', 'l / r'],
  ['fly', '🪰', '蒼蠅', 'fry', '🍟', '炸', 'l / r'],
  ['think', '🤔', '想', 'sink', '🚰', '水槽', 'th / s'],
  ['three', '3️⃣', '三', 'tree', '🌳', '樹', 'th / t'],
  ['mouth', '👄', '嘴巴', 'mouse', '🐭', '老鼠', 'th / s'],
  ['bath', '🛁', '洗澡', 'bus', '🚌', '公車', 'th / s'],
  ['van', '🚐', '廂型車', 'ban', '🚫', '禁止', 'v / b'],
  ['vest', '🦺', '背心', 'best', '🏆', '最好的', 'v / b'],
  ['fan', '🪭', '扇子', 'van', '🚐', '廂型車', 'f / v'],
  ['sun', '☀️', '太陽', 'sung', '🎤', '唱過', 'n / ng'],
  ['win', '🏅', '贏', 'wing', '🪽', '翅膀', 'n / ng'],
  ['bag', '👜', '包包', 'back', '🔙', '背', 'g / k'],
  ['dog', '🐶', '狗', 'dock', '⚓', '碼頭', 'g / k'],
  ['cat', '🐱', '貓', 'cap', '🧢', '帽子', 't / p'],
  ['bat', '🦇', '蝙蝠', 'bad', '👎', '壞的', 't / d'],
  ['boat', '⛵', '船', 'bought', '🛍️', '買了', 'oa / aw'],
  ['coat', '🧥', '外套', 'caught', '🧤', '接住', 'oa / aw']
];

function initMinimalGame(area, words, mode) {
  var isBaby = mode === 'baby';
  // 單字庫對照：字組裡的字若在庫中，就寫 FSRS
  var byWord = {};
  (words || []).forEach(function(w) { byWord[String(w.word).toLowerCase()] = w; });
  // 優先出「至少一個字在單字庫」的字組，再隨機補
  var inLib = [], rest = [];
  MINIMAL_PAIRS.forEach(function(p) { (byWord[p[0]] || byWord[p[3]] ? inLib : rest).push(p); });
  var queue = shuffleArray(inLib).concat(shuffleArray(rest)).slice(0, MINIMAL_ROUNDS);
  queue = shuffleArray(queue);
  var total = queue.length, current = 0, correct = 0;

  function next() {
    if (current >= total) { showResult(correct, total); return; }
    var p = queue[current];
    var a = { w: p[0], e: p[1], zh: p[2] }, b = { w: p[3], e: p[4], zh: p[5] };
    var answer = Math.random() < 0.5 ? a : b;
    var opts = Math.random() < 0.5 ? [a, b] : [b, a];
    var mistakes = 0, answered = false;

    area.innerHTML =
      '<div class="mp">' +
        '<div class="mp-progress">👂 易混音 ' + (current + 1) + ' / ' + total +
          (isBaby ? '' : ' <span class="mp-cat">' + esc(p[6]) + '</span>') + '</div>' +
        '<button class="mp-speak" id="mpSpeak" aria-label="再聽一次">🔊</button>' +
        '<div class="mp-prompt">仔細聽，是哪一個？</div>' +
        '<div class="mp-opts">' +
          opts.map(function(o, i) {
            return '<button class="mp-opt" data-i="' + i + '">' +
              '<span class="mp-emoji">' + o.e + '</span>' +
              (isBaby ? '' : '<span class="mp-word">' + esc(o.w) + '</span>') +
              '<span class="mp-zh">' + esc(o.zh) + '</span>' +
            '</button>';
          }).join('') +
        '</div>' +
        '<div class="mp-compare" id="mpCompare" hidden></div>' +
        '<div class="mp-feedback" id="mpFb" role="status" aria-live="polite"></div>' +
      '</div>';

    var say = function() { speakWord(answer.w, 0.7); };
    setTimeout(say, 350);
    document.getElementById('mpSpeak').onclick = say;

    area.querySelectorAll('.mp-opt').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        if (answered) return;
        var o = opts[parseInt(btn.dataset.i, 10)];
        if (o.w !== answer.w) {
          mistakes++;
          btn.classList.add('wrong');
          btn.disabled = true;
          // 錯了：把兩個字對照念一次，讓孩子聽出差別
          var cmp = document.getElementById('mpCompare');
          cmp.hidden = false;
          cmp.innerHTML = '聽聽看差別：' +
            '<button class="btn-sm" id="mpCmpA">' + a.e + ' ' + (isBaby ? a.zh : esc(a.w)) + '</button>' +
            '<button class="btn-sm" id="mpCmpB">' + b.e + ' ' + (isBaby ? b.zh : esc(b.w)) + '</button>';
          document.getElementById('mpCmpA').onclick = function() { speakWord(a.w, 0.6); };
          document.getElementById('mpCmpB').onclick = function() { speakWord(b.w, 0.6); };
          speakWord(o.w, 0.6);
          setTimeout(function() { speakWord(answer.w, 0.6); }, 1100);
          return;
        }
        answered = true;
        btn.classList.add('correct');
        if (mistakes === 0) correct++;
        document.getElementById('mpFb').innerHTML = '<span class="mp-win">🎉 ' + answer.e + ' ' + esc(answer.w) + '！</span>';
        speakWord(answer.w, 0.7);
        // 在單字庫裡的字才寫 FSRS（內建字組不強迫加入單字庫）
        var lib = byWord[answer.w];
        if (lib) await updateProgress(lib.id, mistakes === 0, 'minimal', { mistakes: mistakes });
        document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
        setTimeout(function() { current++; next(); }, 1500);
      });
    });
  }

  next();
}
