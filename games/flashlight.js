// 探照燈尋寶遊戲
function initFlashlightGame(area, words) {
  var withImg = words.filter(function(w) { return getAllImages(w).length > 0; });
  if (withImg.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有圖片的單字才能玩探照燈！</p>';
    return;
  }
  var total = Math.min(8, withImg.length);
  var queue = shuffleArray(withImg).slice(0, total);
  var current = 0, correct = 0;

  function renderRound() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var img = getRandomImage(target);

    area.innerHTML =
      '<div class="fl-container">' +
        '<div class="fl-scene" id="flScene">' +
          '<img class="fl-image" id="flImage" src="' + img + '" alt="">' +
          '<div class="fl-dark" id="flDark"></div>' +
        '</div>' +
        '<div class="fl-info">' +
          '<div class="fl-hint">用手指滑動探照，雙擊揭曉答案</div>' +
          '<div class="fl-word" id="flWord" style="visibility:hidden;">' + esc(target.word) + '</div>' +
          '<div class="baby-progress">' + (current + 1) + ' / ' + total + '</div>' +
        '</div>' +
      '</div>';

    var dark = document.getElementById('flDark');
    var scene = document.getElementById('flScene');
    var revealed = false;
    var lastTap = 0;

    // 手指/滑鼠移動 → 移動探照燈
    function moveLight(cx, cy) {
      if (revealed) return;
      var rect = scene.getBoundingClientRect();
      var x = cx - rect.left;
      var y = cy - rect.top;
      dark.style.webkitMaskImage = 'radial-gradient(circle 70px at ' + x + 'px ' + y + 'px, transparent 60px, black 80px)';
      dark.style.maskImage = 'radial-gradient(circle 70px at ' + x + 'px ' + y + 'px, transparent 60px, black 80px)';
    }

    scene.addEventListener('touchmove', function(e) {
      e.preventDefault();
      var t = e.touches[0];
      moveLight(t.clientX, t.clientY);
    }, { passive: false });

    scene.addEventListener('mousemove', function(e) {
      moveLight(e.clientX, e.clientY);
    });

    // 雙擊揭曉
    function reveal() {
      if (revealed) return;
      revealed = true;
      dark.classList.add('fl-reveal');
      document.getElementById('flWord').style.visibility = 'visible';
      document.getElementById('flWord').classList.add('fl-word-show');
      speakWord(target.word, 0.6);
      correct++;
      updateProgress(target.id, true, 'flashlight', { mistakes: 0 });
      document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
      setTimeout(function() { current++; renderRound(); }, 2500);
    }

    // 雙擊偵測（觸控 + 滑鼠）
    scene.addEventListener('touchend', function(e) {
      var now = Date.now();
      if (now - lastTap < 400) { reveal(); }
      lastTap = now;
    });

    scene.addEventListener('dblclick', function() {
      reveal();
    });
  }

  renderRound();
}
