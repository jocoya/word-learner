// ===== 學習地圖（Atlas / World Map）=====
// 動線：金幣庫 → 點 👦/👧 圖鑑 → 學習地圖（分頁）→ 點島 → 該主題單字卡
// 島 = 標籤主題。島內單字全部到「熟悉期(S>=3)」→ 通關（永久旗子，不因新增單字而消失）
// 沒標籤的字不納入任何島。

// 每頁島數（一張底圖重複用，超過就分頁）
var ATLAS_PER_PAGE = 6;
// 熟悉期門檻（與 fsrs-engine STAGE_THRESHOLDS[0].s 對齊）
var ATLAS_FAMILIAR_S = 3;

// 每頁 6 個節點在底圖上的相對座標（%）— 沿路徑蜿蜒排列
var ATLAS_NODES = [
  { x: 18, y: 80 },
  { x: 40, y: 66 },
  { x: 22, y: 48 },
  { x: 50, y: 38 },
  { x: 74, y: 50 },
  { x: 80, y: 24 }
];

// 標籤 → 代表 emoji（找不到就用預設）
var ATLAS_TAG_EMOJI = {
  animal: '🐾', animals: '🐾', food: '🍎', fruit: '🍓', drink: '🥤',
  clothes: '👕', clothing: '👕', color: '🎨', colors: '🎨', number: '🔢', numbers: '🔢',
  transport: '🚗', transportation: '🚗', vehicle: '🚗', family: '👨‍👩‍👧', body: '👣',
  school: '🏫', nature: '🌳', weather: '⛅', sport: '⚽', sports: '⚽', toy: '🧸', toys: '🧸',
  house: '🏠', home: '🏠', furniture: '🛋️', job: '👷', jobs: '👷', action: '🏃', verb: '🏃',
  emotion: '😊', feeling: '😊', shape: '🔷', shapes: '🔷', music: '🎵', ocean: '🌊', sea: '🌊',
  insect: '🐛', bird: '🐦', vegetable: '🥕', dessert: '🍰', place: '📍', time: '⏰', day: '📅'
};
function atlasEmoji(tag) {
  return ATLAS_TAG_EMOJI[tag] || ATLAS_TAG_EMOJI[tag.replace(/s$/, '')] || '🏝️';
}

// 目前檢視的圖鑑小孩 + 分頁
var atlasChild = 'boy';
var atlasPage = 0;

// 已通關旗子（永久）：存在 settings key = 'atlasCleared'
async function getAtlasCleared() {
  var s = await dbGet('settings', 'atlasCleared');
  return s || { key: 'atlasCleared', boy: {}, girl: {} };
}
async function markIslandCleared(child, tag, perfect) {
  var s = await getAtlasCleared();
  if (!s[child]) s[child] = {};
  var prev = s[child][tag] || {};
  s[child][tag] = { cleared: true, perfect: !!perfect || !!prev.perfect, date: prev.date || getTodayStr() };
  await dbPut('settings', s);
}

// 計算某小孩的所有島（含進度）
async function computeIslands(child) {
  var prevChild = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
  if (typeof currentChild !== 'undefined') currentChild = child; // 讓 getProgressFor 抓對小孩
  try {
    var tags = await getAllTags();
    var cleared = await getAtlasCleared();
    var childCleared = cleared[child] || {};
    var islands = [];
    for (var i = 0; i < tags.length; i++) {
      var tag = tags[i];
      var words = await getWordsByTag(tag);
      if (!words.length) continue;
      var familiar = 0;
      for (var j = 0; j < words.length; j++) {
        var s = (typeof getWordStability === 'function') ? await getWordStability(words[j].id) : 0;
        if (s >= ATLAS_FAMILIAR_S) familiar++;
      }
      var total = words.length;
      var wasCleared = !!(childCleared[tag] && childCleared[tag].cleared);
      var nowAllFamiliar = familiar >= total;
      islands.push({
        tag: tag,
        emoji: atlasEmoji(tag),
        total: total,
        familiar: familiar,
        cleared: wasCleared || nowAllFamiliar,     // 通關過就永久算通關
        perfect: nowAllFamiliar,                    // 目前是否全部熟悉（含新字）
        newCount: wasCleared && !nowAllFamiliar ? (total - familiar) : 0 // 通關後又有新朋友
      });
    }
    return islands;
  } finally {
    if (typeof currentChild !== 'undefined') currentChild = prevChild;
  }
}

// 進入學習地圖
async function openAtlas(child) {
  atlasChild = child || 'boy';
  atlasPage = 0;
  goTo('page-atlas');
  await renderAtlas();
}

async function renderAtlas() {
  var page = document.getElementById('page-atlas');
  if (!page) return;
  var body = document.getElementById('atlasBody');
  if (body) body.innerHTML = '<div style="text-align:center;padding:60px;color:#fff;">地圖繪製中...</div>';

  var islands = await computeIslands(atlasChild);

  // 更新已通關旗子（若目前全熟悉但還沒記錄 → 記一枚旗子）
  for (var i = 0; i < islands.length; i++) {
    if (islands[i].perfect) await markIslandCleared(atlasChild, islands[i].tag, true);
  }

  var totalPages = Math.max(1, Math.ceil(islands.length / ATLAS_PER_PAGE));
  if (atlasPage >= totalPages) atlasPage = totalPages - 1;
  var pageIslands = islands.slice(atlasPage * ATLAS_PER_PAGE, atlasPage * ATLAS_PER_PAGE + ATLAS_PER_PAGE);

  var clearedCount = islands.filter(function(x){ return x.cleared; }).length;

  var childLabel = atlasChild === 'boy' ? '👦 小男生' : '👧 小女生';
  var html =
    '<div class="atlas-topinfo">' +
      '<div class="atlas-child-tabs">' +
        '<button class="atlas-child-tab' + (atlasChild==='boy'?' active':'') + '" onclick="switchAtlasChild(\'boy\')">👦 小男生</button>' +
        '<button class="atlas-child-tab' + (atlasChild==='girl'?' active':'') + '" onclick="switchAtlasChild(\'girl\')">👧 小女生</button>' +
      '</div>' +
      '<div class="atlas-progress">🏴 已征服 ' + clearedCount + ' / ' + islands.length + ' 座島</div>' +
    '</div>';

  if (islands.length === 0) {
    html += '<div class="atlas-empty">還沒有任何主題島喔！<br>先到「管理單字」幫單字加上標籤（例如 animal、food），島就會出現在地圖上。</div>';
    if (body) body.innerHTML = html;
    return;
  }

  // 地圖畫布（底圖 + 節點）
  html += '<div class="atlas-map">';
  html += '<img class="atlas-map-bg" src="./images/map.png" alt="">';
  pageIslands.forEach(function(isl, idx) {
    var node = ATLAS_NODES[idx] || { x: 50, y: 50 };
    var pct = isl.total > 0 ? Math.round(isl.familiar / isl.total * 100) : 0;
    var stateCls = isl.cleared ? (isl.perfect ? 'perfect' : 'cleared') : (isl.familiar > 0 ? 'progress' : 'locked');
    var crown = isl.perfect ? '<span class="atlas-crown">👑</span>' : (isl.cleared ? '<span class="atlas-flag">🏴</span>' : '');
    var newDot = isl.newCount > 0 ? '<span class="atlas-newdot">+' + isl.newCount + '</span>' : '';
    html +=
      '<button class="atlas-node ' + stateCls + '" style="left:' + node.x + '%;top:' + node.y + '%;" ' +
        'onclick="openIsland(\'' + encodeURIComponent(isl.tag) + '\')">' +
        crown + newDot +
        '<span class="atlas-node-emoji">' + isl.emoji + '</span>' +
        '<span class="atlas-node-name">' + esc(isl.tag) + '</span>' +
        '<span class="atlas-node-bar"><span class="atlas-node-fill" style="width:' + pct + '%;"></span></span>' +
        '<span class="atlas-node-count">' + isl.familiar + '/' + isl.total + '</span>' +
      '</button>';
  });
  html += '</div>';

  // 分頁列
  if (totalPages > 1) {
    html += '<div class="atlas-pager">';
    html += '<button class="atlas-pg-btn"' + (atlasPage<=0?' disabled':'') + ' onclick="atlasPrevPage()">← 上一片大陸</button>';
    html += '<span class="atlas-pg-info">第 ' + (atlasPage+1) + ' / ' + totalPages + ' 片</span>';
    html += '<button class="atlas-pg-btn"' + (atlasPage>=totalPages-1?' disabled':'') + ' onclick="atlasNextPage()">下一片大陸 →</button>';
    html += '</div>';
  }

  if (body) body.innerHTML = html;
}

function switchAtlasChild(child) { atlasChild = child; atlasPage = 0; renderAtlas(); }
function atlasPrevPage() { if (atlasPage > 0) { atlasPage--; renderAtlas(); } }
function atlasNextPage() { atlasPage++; renderAtlas(); }

// ===== 島嶼詳情：該主題的單字卡 =====
async function openIsland(tagEnc) {
  var tag = decodeURIComponent(tagEnc);
  var prevChild = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
  if (typeof currentChild !== 'undefined') currentChild = atlasChild;
  var cards = '';
  try {
    var words = await getWordsByTag(tag);
    // 依熟練度排序：不熟的排前面（提示要練）
    var enriched = [];
    for (var i = 0; i < words.length; i++) {
      var s = (typeof getWordStability === 'function') ? await getWordStability(words[i].id) : 0;
      enriched.push({ w: words[i], s: s });
    }
    enriched.sort(function(a, b){ return a.s - b.s; });
    enriched.forEach(function(e) {
      var w = e.w;
      var img = (typeof getRandomImage === 'function') ? getRandomImage(w) : '';
      var stage = e.s >= 40 ? '大師' : e.s >= 15 ? '應用' : e.s >= ATLAS_FAMILIAR_S ? '熟悉' : '認識';
      var stageCls = e.s >= 40 ? 'master' : e.s >= 15 ? 'apply' : e.s >= ATLAS_FAMILIAR_S ? 'familiar' : 'new';
      cards +=
        '<div class="island-card ' + stageCls + '" onclick="speakWord(\'' + esc(w.word) + '\',0.7)">' +
          (img ? '<img class="island-card-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">'
               : '<div class="island-card-noimg">' + esc(w.meaning) + '</div>') +
          '<div class="island-card-word">' + esc(w.word) + '</div>' +
          '<div class="island-card-meaning">' + esc(w.meaning) + '</div>' +
          '<div class="island-card-stage ' + stageCls + '">' + stage + '</div>' +
        '</div>';
    });
  } finally {
    if (typeof currentChild !== 'undefined') currentChild = prevChild;
  }

  var body = document.getElementById('atlasBody');
  if (!body) return;
  body.innerHTML =
    '<div class="island-detail">' +
      '<div class="island-detail-head">' +
        '<button class="btn-ghost" onclick="renderAtlas()">← 回地圖</button>' +
        '<h3>' + atlasEmoji(tag) + ' ' + esc(tag) + '</h3>' +
      '</div>' +
      '<div class="island-cards">' + (cards || '<p style="color:#999;padding:20px;">這座島還沒有單字</p>') + '</div>' +
    '</div>';
}
