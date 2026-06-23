// ===== 雲端圖片管理 =====
// 列出 Firebase Storage 的圖片、顯示用量、刪除占空間的圖、清孤兒圖（沒有單字在用）。

var _cloudItems = [];

async function openCloudManager() {
  var modal = document.getElementById('modal-cloud');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-cloud';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML = '<div class="modal-content cloud-mgr">' +
    '<h3>☁️ 雲端圖片管理</h3>' +
    '<div class="cloud-summary" id="cloudSummary">載入中...</div>' +
    '<div class="cloud-actions">' +
      '<button class="dev-btn" onclick="cloudScan()">🔄 重新整理</button>' +
      '<button class="dev-btn dev-danger" onclick="cloudDeleteOrphans()">🧹 清除孤兒圖（沒單字在用）</button>' +
    '</div>' +
    '<div class="cloud-grid" id="cloudGrid"></div>' +
    '<button class="btn-ghost" onclick="hideModal(\'modal-cloud\')">關閉</button>' +
  '</div>';
  modal.hidden = false;
  cloudScan();
}

// 掃描 Storage 的 word_images/，並標記哪些是孤兒（沒有單字 URL 指向它）
async function cloudScan() {
  var grid = document.getElementById('cloudGrid');
  var summary = document.getElementById('cloudSummary');
  if (summary) summary.textContent = '掃描中...';
  if (grid) grid.innerHTML = '';
  _cloudItems = [];

  try {
    // 收集所有單字正在使用的圖片 URL（判斷孤兒用）
    var words = await dbGetAll('words');
    var usedUrls = {};
    words.forEach(function(w) {
      (getAllImages(w) || []).forEach(function(u) { if (u) usedUrls[u] = true; });
    });

    var listRef = storage.ref('word_images');
    var res = await listRef.listAll();
    var totalBytes = 0;
    for (var i = 0; i < res.items.length; i++) {
      var itemRef = res.items[i];
      var url = '', size = 0;
      try {
        url = await itemRef.getDownloadURL();
        var meta = await itemRef.getMetadata();
        size = meta.size || 0;
      } catch (e) { continue; }
      totalBytes += size;
      var isOrphan = !usedUrls[url];
      _cloudItems.push({ ref: itemRef, name: itemRef.name, url: url, size: size, orphan: isOrphan });
    }

    var orphanCount = _cloudItems.filter(function(x){ return x.orphan; }).length;
    if (summary) summary.innerHTML =
      '共 ' + _cloudItems.length + ' 張圖，總用量 ' + (totalBytes/1048576).toFixed(1) + ' MB' +
      '<br>其中孤兒圖（沒單字在用）：<b style="color:#f44336;">' + orphanCount + '</b> 張';

    renderCloudGrid();
  } catch (e) {
    if (summary) summary.innerHTML = '❌ 讀取失敗：' + esc(e.message) + '<br>（可能是 Storage 權限或沒登入）';
  }
}

function renderCloudGrid() {
  var grid = document.getElementById('cloudGrid');
  if (!grid) return;
  grid.innerHTML = _cloudItems.map(function(it, idx) {
    return '<div class="cloud-item' + (it.orphan ? ' orphan' : '') + '">' +
      '<img src="' + it.url + '" alt="" loading="lazy" onerror="this.style.opacity=0.2">' +
      '<div class="cloud-item-info">' + (it.size/1024).toFixed(0) + ' KB' + (it.orphan ? ' · 🗑️孤兒' : '') + '</div>' +
      '<button class="cloud-del" onclick="cloudDeleteOne(' + idx + ')">刪除</button>' +
    '</div>';
  }).join('') || '<p style="color:#999;padding:20px;">Storage 沒有圖片</p>';
}

async function cloudDeleteOne(idx) {
  var it = _cloudItems[idx];
  if (!it) return;
  if (it.orphan === false && !confirm('這張圖正在被單字使用，確定刪除？刪了該單字會失去圖片。')) return;
  if (it.orphan && !confirm('刪除這張孤兒圖？')) return;
  try {
    await it.ref.delete();
    _cloudItems.splice(idx, 1);
    renderCloudGrid();
    cloudScan();
  } catch (e) { alert('刪除失敗：' + e.message); }
}

async function cloudDeleteOrphans() {
  var orphans = _cloudItems.filter(function(x){ return x.orphan; });
  if (!orphans.length) { alert('沒有孤兒圖！'); return; }
  if (!confirm('將刪除 ' + orphans.length + ' 張孤兒圖（沒有任何單字在用）。此動作無法復原，確定嗎？')) return;
  var summary = document.getElementById('cloudSummary');
  var done = 0, fail = 0;
  for (var i = 0; i < orphans.length; i++) {
    if (summary) summary.textContent = '刪除中 ' + (i+1) + '/' + orphans.length + '...';
    try { await orphans[i].ref.delete(); done++; } catch (e) { fail++; }
  }
  alert('完成！刪除 ' + done + ' 張，失敗 ' + fail + ' 張。');
  cloudScan();
}
