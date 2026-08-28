// ===== Firebase 初始化 =====
firebase.initializeApp({
  apiKey: "AIzaSyB_gukI-_g6dZpd1HPfSvGKBNgzQ1Ytf6g",
  authDomain: "eng-workspace.firebaseapp.com",
  projectId: "eng-workspace",
  storageBucket: "eng-workspace.firebasestorage.app",
  messagingSenderId: "434719078442",
  appId: "1:434719078442:web:a05d939bbda48780542b53"
});

var firestore = firebase.firestore();
var auth = firebase.auth();
var storage = firebase.storage();

// 啟用 Firestore 離線快取
firestore.enablePersistence().catch(function(err) {
  console.warn('Firestore persistence failed:', err.code);
});

// 匿名登入
var currentUserId = null;
auth.signInAnonymously().then(function(cred) {
  currentUserId = cred.user.uid;
  console.log('Signed in:', currentUserId);
}).catch(function(err) {
  console.warn('Auth failed, using local only:', err);
});

// ===== Firebase Storage 圖片上傳 =====
async function uploadPixabayImage(pixabayUrl, word) {
  try {
    // 方法1：直接 fetch（可能被 CORS 擋）
    var response = await fetch(pixabayUrl, { mode: 'cors' });
    if (!response.ok) throw new Error('Fetch failed');
    var blob = await response.blob();

    var filename = word.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '.jpg';
    var ref = storage.ref('word_images/' + filename);
    var snapshot = await ref.put(blob, { contentType: blob.type || 'image/jpeg' });
    var downloadUrl = await snapshot.ref.getDownloadURL();
    console.log('Uploaded to Firebase Storage:', downloadUrl);
    return downloadUrl;
  } catch (e) {
    console.warn('Direct fetch failed, trying canvas method:', e.message);
    // 方法2：用 canvas 繞過 CORS
    try {
      return await uploadViaCanvas(pixabayUrl, word);
    } catch (e2) {
      console.warn('Canvas method also failed:', e2.message);
      return pixabayUrl;
    }
  }
}

function uploadViaCanvas(url, word) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob(function(blob) {
        if (!blob) { reject(new Error('toBlob failed')); return; }
        var filename = word.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '.jpg';
        var ref = storage.ref('word_images/' + filename);
        ref.put(blob, { contentType: 'image/jpeg' }).then(function(snapshot) {
          return snapshot.ref.getDownloadURL();
        }).then(resolve).catch(reject);
      }, 'image/jpeg', 0.85);
    };
    img.onerror = function() { reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// ===== IndexedDB（離線快取，保持相容）=====
var DB_NAME = 'WordLearnerDB';
var DB_VERSION = 1;
var db = null;

function openDB() {
  return new Promise(function(resolve, reject) {
    if (db) return resolve(db);
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains('words')) {
        var ws = d.createObjectStore('words', { keyPath: 'id', autoIncrement: true });
        ws.createIndex('pool', 'pool', { unique: false });
      }
      if (!d.objectStoreNames.contains('exams'))
        d.createObjectStore('exams', { keyPath: 'id', autoIncrement: true });
      if (!d.objectStoreNames.contains('progress')) {
        var ps = d.createObjectStore('progress', { keyPath: 'wordId' });
        ps.createIndex('nextReview', 'nextReview', { unique: false });
      }
      if (!d.objectStoreNames.contains('settings'))
        d.createObjectStore('settings', { keyPath: 'key' });
    };
    req.onsuccess = function(e) { db = e.target.result; resolve(db); };
    req.onerror = function(e) { reject(e.target.error); };
  });
}

// ===== 通用 CRUD（IndexedDB + Firestore 同步）=====

// 新增：寫入 IndexedDB + Firestore
async function dbAdd(store, data) {
  var d = await openDB();
  var localId = await new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readwrite');
    var req = tx.objectStore(store).add(data);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
  // 同步到 Firestore
  try {
    data._localId = localId;
    var docRef = await firestore.collection(store).add(data);
    // 把 Firestore doc ID 存回 IndexedDB
    data.id = localId;
    data._firestoreId = docRef.id;
    var tx2 = d.transaction(store, 'readwrite');
    tx2.objectStore(store).put(data);
  } catch (e) { console.warn('Firestore sync failed:', e); }
  return localId;
}

// 僅更新本機 IndexedDB（不送 Firestore）。
// 適合 activeSession 這類只屬於目前裝置、而且每題都會更新的暫存狀態。
async function dbPutLocal(store, data) {
  var d = await openDB();
  return new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readwrite');
    var req = tx.objectStore(store).put(data);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

// 更新
async function dbPut(store, data) {
  var d = await openDB();
  await new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readwrite');
    var req = tx.objectStore(store).put(data);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
  // 同步到 Firestore
  try {
    if (data._firestoreId) {
      await firestore.collection(store).doc(data._firestoreId).set(data);
    } else if (store === 'settings') {
      await firestore.collection(store).doc(data.key).set(data);
    } else if (store === 'progress') {
      await firestore.collection(store).doc(String(data.wordId)).set(data);
    }
  } catch (e) { console.warn('Firestore sync failed:', e); }
}

// 讀取單筆
async function dbGet(store, id) {
  var d = await openDB();
  return new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readonly');
    var req = tx.objectStore(store).get(id);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

// 讀取全部
async function dbGetAll(store) {
  var d = await openDB();
  return new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readonly');
    var req = tx.objectStore(store).getAll();
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

// 刪除
async function dbDelete(store, id) {
  var d = await openDB();
  // 先取得 firestoreId
  var item = await dbGet(store, id);
  await new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readwrite');
    var req = tx.objectStore(store).delete(id);
    req.onsuccess = function() { resolve(); };
    req.onerror = function() { reject(req.error); };
  });
  // 同步刪除 Firestore
  try {
    if (item && item._firestoreId) {
      await firestore.collection(store).doc(item._firestoreId).delete();
    }
  } catch (e) { console.warn('Firestore delete failed:', e); }
}

// 按 index 查詢
async function dbGetByIndex(store, indexName, value) {
  var d = await openDB();
  return new Promise(function(resolve, reject) {
    var tx = d.transaction(store, 'readonly');
    var idx = tx.objectStore(store).index(indexName);
    var req = idx.getAll(value);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

// ===== Firestore 專用函式 =====

// 從 Firestore 拉取所有單字同步到本地
async function syncFromFirestore() {
  try {
    var snapshot = await firestore.collection('words').get();
    var d = await openDB();
    snapshot.forEach(function(doc) {
      var data = doc.data();
      data._firestoreId = doc.id;
      if (data._localId) data.id = data._localId;
      var tx = d.transaction('words', 'readwrite');
      if (data.id) {
        tx.objectStore('words').put(data);
      }
    });
    // activeSession 是目前裝置的暫存場次，不從雲端覆蓋本機狀態。
    var settingsSnap = await firestore.collection('settings').get();
    settingsSnap.forEach(function(doc) {
      var data = doc.data();
      if (data.key === 'activeSession') return;
      var tx = d.transaction('settings', 'readwrite');
      tx.objectStore('settings').put(data);
    });
    // 同步 progress
    var progressSnap = await firestore.collection('progress').get();
    progressSnap.forEach(function(doc) {
      var data = doc.data();
      var tx = d.transaction('progress', 'readwrite');
      tx.objectStore('progress').put(data);
    });
    console.log('Synced from Firestore');
  } catch (e) {
    console.warn('Sync from Firestore failed:', e);
  }
}

// 更新使用者進度（金幣+經驗值）
async function updateUserProgress(role, coinsEarned, xpEarned) {
  if (!currentUserId) return;
  var userRef = firestore.collection('users').doc(currentUserId);
  try {
    await userRef.set({
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
      [`${role}Coins`]: firebase.firestore.FieldValue.increment(coinsEarned),
      totalXP: firebase.firestore.FieldValue.increment(xpEarned)
    }, { merge: true });
  } catch (e) { console.warn('updateUserProgress failed:', e); }
}

// ===== 間隔重複邏輯 =====
function calcNextReview(progress, correct) {
  var now = Date.now();
  var interval = progress.interval;
  var ease = progress.ease;
  var streak = progress.streak;
  if (correct) {
    streak++;
    if (streak === 1) interval = 1;
    else if (streak === 2) interval = 3;
    else interval = Math.round(interval * ease);
    ease = Math.min(3.0, ease + 0.1);
  } else {
    streak = 0;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  }
  return {
    wordId: progress.wordId,
    interval: interval,
    ease: ease,
    streak: streak,
    lastReview: now,
    nextReview: now + interval * 24 * 60 * 60 * 1000,
    totalCorrect: progress.totalCorrect + (correct ? 1 : 0),
    totalAttempts: progress.totalAttempts + 1
  };
}

function newProgress(wordId) {
  return {
    wordId: wordId,
    interval: 0, ease: 2.0, streak: 0,
    lastReview: 0, nextReview: 0,
    totalCorrect: 0, totalAttempts: 0
  };
}

async function getDueWords(pool) {
  var all = pool === 'permanent'
    ? await dbGetByIndex('words', 'pool', 'permanent')
    : await dbGetAll('words');
  var now = Date.now();
  var due = [];
  for (var i = 0; i < all.length; i++) {
    var p = await dbGet('progress', all[i].id);
    if (!p || p.nextReview <= now) due.push(all[i]);
  }
  return due;
}

async function getAllTags() {
  var words = await dbGetAll('words');
  var tagSet = {};
  words.forEach(function(w) {
    if (w.tags && w.tags.length > 0) {
      w.tags.forEach(function(t) { tagSet[t.trim().toLowerCase()] = true; });
    }
  });
  return Object.keys(tagSet).sort();
}

async function getWordsByTag(tag) {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  return words.filter(function(w) {
    return w.tags && w.tags.some(function(t) { return t.trim().toLowerCase() === tag.trim().toLowerCase(); });
  });
}

// ===== 初始化：開啟 IndexedDB 後嘗試從 Firestore 同步 =====
// 對外提供本機資料就緒 Promise。activeSession 只存本機且不受雲端覆蓋，
// 因此不必讓恢復提示等待網路；其他資料仍在背景同步。
var dbReadyPromise = openDB();
var dataReadyPromise = dbReadyPromise.then(function() {
  console.log('Local DB ready');
  if (navigator.onLine) syncFromFirestore();
  return db;
});
