// 泡泡戳戳樂遊戲（物理彈跳 + 粒子爆裂版）
function initBubbleGame(area, words) {
  var isKid = currentMode === 'kid';
  var isBaby = currentMode === 'baby';
  var total = Math.min(8, words.length);
  var queue = shuffleArray(words).slice(0, total);
  var current = 0, correct = 0, animId = null, roundStart = 0;

  function confettiBurst(x, y, fieldEl) {
    var canvas = document.createElement('canvas');
    canvas.width = fieldEl.clientWidth; canvas.height = fieldEl.clientHeight;
    canvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50;';
    fieldEl.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var colors = ['#f44336','#FF9800','#FFEB3B','#4CAF50','#2196F3','#9C27B0','#E91E63'];
    var particles = [];
    for (var i = 0; i < 30; i++) {
      var a = Math.random()*Math.PI*2, s = 2+Math.random()*5;
      particles.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-2,size:3+Math.random()*5,color:colors[Math.floor(Math.random()*colors.length)],life:1,shape:Math.random()>.5?'rect':'circle'});
    }
    var frame=0;
    function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);var alive=false;particles.forEach(function(p){if(p.life<=0)return;alive=true;p.x+=p.vx;p.y+=p.vy;p.vy+=.15;p.life-=.025;ctx.globalAlpha=p.life;ctx.fillStyle=p.color;if(p.shape==='rect')ctx.fillRect(p.x,p.y,p.size,p.size*.6);else{ctx.beginPath();ctx.arc(p.x,p.y,p.size/2,0,Math.PI*2);ctx.fill();}});ctx.globalAlpha=1;if(alive&&frame<60){frame++;requestAnimationFrame(draw);}else canvas.remove();}
    draw();
  }
  function playCoin(){try{var c=new(window.AudioContext||window.webkitAudioContext)();[880,1108,1320].forEach(function(f,i){var o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.3,c.currentTime+i*.08);g.gain.exponentialRampToValueAtTime(.01,c.currentTime+i*.08+.2);o.connect(g);g.connect(c.destination);o.start(c.currentTime+i*.08);o.stop(c.currentTime+i*.08+.2);});}catch(e){}}
  function playPop(){try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(800,c.currentTime);o.frequency.exponentialRampToValueAtTime(300,c.currentTime+.12);g.gain.setValueAtTime(.35,c.currentTime);g.gain.exponentialRampToValueAtTime(.01,c.currentTime+.12);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.12);}catch(e){}}
  function playWrong(){try{var c=new(window.AudioContext||window.webkitAudioContext)();var o=c.createOscillator(),g=c.createGain();o.type='triangle';o.frequency.value=150;g.gain.setValueAtTime(.2,c.currentTime);g.gain.exponentialRampToValueAtTime(.01,c.currentTime+.2);o.connect(g);g.connect(c.destination);o.start();o.stop(c.currentTime+.2);}catch(e){}}
  function spawnParticles(el, color) {
    var rect=el.getBoundingClientRect(),field=document.getElementById('bubbleField'),fRect=field.getBoundingClientRect();
    var cx=rect.left-fRect.left+rect.width/2,cy=rect.top-fRect.top+rect.height/2;
    for(var i=0;i<8;i++){var p=document.createElement('div');p.className='bubble-particle';p.style.background=color;p.style.left=cx+'px';p.style.top=cy+'px';var a=(Math.PI*2/8)*i+Math.random()*.5,d=40+Math.random()*60;p.style.setProperty('--tx',Math.cos(a)*d+'px');p.style.setProperty('--ty',Math.sin(a)*d+'px');field.appendChild(p);setTimeout(function(){p.remove();},600);}
  }

  function renderRound() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var others = shuffleArray(words.filter(function(w){return w.id!==target.id;})).slice(0,3);
    var allOptions = shuffleArray([target].concat(others));

    area.innerHTML =
      '<div class="bubble-container">' +
        '<div class="bubble-prompt">' +
          '<span class="bubble-hint">' + esc(target.word) + '</span>' +
          '<button class="bubble-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.7)">🔊</button>' +
          '<div class="bubble-timer" id="bubbleTimer"' + (isKid ? '' : ' hidden') + '></div>' +
          '<span style="color:#999;font-size:.9em;margin-left:auto;">' + (current+1) + '/' + total + '</span>' +
        '</div>' +
        '<div class="bubble-field" id="bubbleField"></div>' +
        '<div class="bubble-time-result" id="bubbleTimeResult"></div>' +
      '</div>';

    if (isBaby) setTimeout(function(){ speakWord(target.word, 0.7); }, 300);

    var field = document.getElementById('bubbleField');
    var fw = field.clientWidth, fh = field.clientHeight, R = 70;
    var bubbles = [];
    allOptions.forEach(function(w) {
      var x, y, overlap, tries = 0;
      do {
        x = R + Math.random()*(fw-R*2); y = R + Math.random()*(fh-R*2);
        overlap = bubbles.some(function(b){return Math.hypot(b.x-x,b.y-y)<R*2.2;});
        tries++;
      } while (overlap && tries < 50);
      var speed = (0.8+Math.random()*1.2)*0.25, angle = Math.random()*Math.PI*2;
      bubbles.push({x:x,y:y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,word:w,el:null,popped:false});
    });

    bubbles.forEach(function(b, i) {
      var el = document.createElement('div');
      el.className = 'bubble-phys';
      var img = getRandomImage(b.word);
      if (img) {
        el.innerHTML = '<img src="' + img + '" alt="" onerror="this.outerHTML=\'<span>' + esc(b.word.word) + '</span>\'">';
      } else {
        el.innerHTML = '<span>' + esc(b.word.word) + '</span>';
      }
      el.style.left = (b.x-R)+'px'; el.style.top = (b.y-R)+'px';
      el.addEventListener('click', function(){ handleTap(i, target); });
      field.appendChild(el); b.el = el;
    });

    roundStart = performance.now();
    var timerEl = document.getElementById('bubbleTimer');

    function animate() {
      if (isKid && timerEl) timerEl.textContent = '\u23F1 ' + ((performance.now()-roundStart)/1000).toFixed(1) + 's';
      for (var i=0;i<bubbles.length;i++) {
        var b=bubbles[i]; if(b.popped) continue;
        b.x+=b.vx; b.y+=b.vy;
        if(b.x-R<0){b.x=R;b.vx=Math.abs(b.vx);} if(b.x+R>fw){b.x=fw-R;b.vx=-Math.abs(b.vx);}
        if(b.y-R<0){b.y=R;b.vy=Math.abs(b.vy);} if(b.y+R>fh){b.y=fh-R;b.vy=-Math.abs(b.vy);}
        for(var j=i+1;j<bubbles.length;j++){
          var b2=bubbles[j]; if(b2.popped) continue;
          var dx=b2.x-b.x,dy=b2.y-b.y,dist=Math.hypot(dx,dy),minD=R*2;
          if(dist<minD&&dist>0){var nx=dx/dist,ny=dy/dist,ov=(minD-dist)/2;b.x-=nx*ov;b.y-=ny*ov;b2.x+=nx*ov;b2.y+=ny*ov;var dvx=b.vx-b2.vx,dvy=b.vy-b2.vy,dot=dvx*nx+dvy*ny;b.vx-=dot*nx;b.vy-=dot*ny;b2.vx+=dot*nx;b2.vy+=dot*ny;}
        }
        b.el.style.left=(b.x-R)+'px'; b.el.style.top=(b.y-R)+'px';
      }
      animId = requestAnimationFrame(animate);
    }
    animId = requestAnimationFrame(animate);

    function handleTap(idx, target) {
      var b = bubbles[idx]; if (b.popped) return;
      b.popped = true;
      if (b.word.id === target.id) {
        correct++;
        updateProgress(target.id, true);
        document.getElementById('gameScore').textContent = correct + '/' + total;
        speakWord(target.word);
        confettiBurst(b.x, b.y, document.getElementById('bubbleField'));
        if (isBaby) {
          playCoin(); spawnParticles(b.el,'#ffd54f');
          b.el.innerHTML = '<div class="bubble-coin">🏆</div>';
          b.el.classList.add('bubble-coin-glow');
        } else {
          playPop(); spawnParticles(b.el,'#667eea');
          b.el.classList.add('bubble-pop');
          var elapsed = ((performance.now()-roundStart)/1000).toFixed(1);
          var tr = document.getElementById('bubbleTimeResult');
          tr.textContent = '\u26A1 ' + elapsed + ' \u79D2'; tr.style.display = 'block';
        }
        cancelAnimationFrame(animId);
        setTimeout(function(){ current++; renderRound(); }, 1200);
      } else {
        playWrong(); spawnParticles(b.el,'#f44336');
        if (isKid) roundStart -= 5000;
        if (isBaby) {
          b.el.innerHTML = '<div class="bubble-bat">🦇</div>';
          b.el.classList.add('bubble-bat-fly');
        } else {
          b.el.classList.add('bubble-pop');
          var pen = document.createElement('div');
          pen.style.cssText = 'position:absolute;left:'+(b.x-30)+'px;top:'+(b.y-20)+'px;color:#f44336;font-size:1.5em;font-weight:700;pointer-events:none;animation:penaltyFloat 1s forwards;z-index:20;';
          pen.textContent = '+5s';
          document.getElementById('bubbleField').appendChild(pen);
          setTimeout(function(){ pen.remove(); }, 1000);
        }
      }
    }
  }
  renderRound();
}
