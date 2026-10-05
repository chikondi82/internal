var COLORS = ['#25D366', '#128C7E', '#075e54', '#34b7f1', '#7c3aed', '#f59e0b'];
var auth, db, me = null;

var SPGS_REMOVE_NAMES = [
  'somon pierre gahimbare',
  'somons pierre gahimbare',
  'gahimbare simon pierre'
];

function G(id) {
  return document.getElementById(id);
}

function esc(t) {
  return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inits(n) {
  return (n || '?').trim().split(/\s+/).map(function (x) {
    return x[0] || '';
  }).join('').slice(0, 2).toUpperCase();
}

function normalizeName(n) {
  return String(n || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSPGSUser(u) {
  if (!u) return false;
  var nn = normalizeName(u.name || '');
  if (!nn) {
    var iname = normalizeName(u.email || '').split('@')[0];
    if (iname && SPGS_REMOVE_NAMES.some(function (t) { return iname.indexOf(t.replace(/\s+/g, '')) !== -1; })) return true;
    var ii = inits(u.email || u.uid || '');
    return ii === 'SP' || ii === 'GS';
  }
  var compact = nn.replace(/\s+/g, '');
  if (SPGS_REMOVE_NAMES.some(function (t) {
    var tc = t.replace(/\s+/g, '');
    return compact === tc || compact.indexOf(tc) !== -1 || tc.indexOf(compact) !== -1;
  })) return true;
  var tok = nn.split(/\s+/).filter(Boolean);
  var f = tok[0] || '', m = tok[1] || '', l = tok[tok.length - 1] || '';
  if ((f === 'somon' || f === 'somons') && (l === 'gahimbare' || tok.indexOf('pierre') !== -1)) return true;
  if (l === 'gahimbare' && f === 'simon' && m === 'pierre') return true;
  if (l === 'gahimbare' && f === 'gahimbare') return true;
  var ii = inits(u.name || u.email || '');
  return ii === 'SP' || ii === 'GS';
}

function cid(a, b) {
  return [a, b].sort().join('_');
}

function colFor(uid) {
  return COLORS[parseInt((uid || '0000').slice(-4), 16) % COLORS.length];
}

function toast(msg, type) {
  type = type || 'error';
  var t = G('toast');
  if (!t) return;
  t.innerHTML = (type === 'success' ? '✅ ' : '⚠️ ') + msg;
  t.style.background = type === 'success' ? '#25D366' : '#e53e3e';
  t.style.display = 'block';
  clearTimeout(t._t);
  t._t = setTimeout(function () {
    t.style.display = 'none';
  }, 9000);
}

/* ======================= PERSISTENT RULES HELPERS =======================
   The Firebase Console Rules parser rejects JS: never paste .js code there.
   These strings match firestore.rules / storage.rules files on disk exactly.
   ====================================================================== */
var FIRESTORE_RULES_TEXT = ''
  + 'rules_version = \'2\';\n'
  + 'service cloud.firestore {\n'
  + '  match /databases/{database}/documents {\n'
  + '    match /users/{userId} {\n'
  + '      allow read: if request.auth != null;\n'
  + '      allow create: if request.auth != null && request.auth.uid == userId && request.resource.data.uid == userId && request.resource.data.email is string;\n'
  + '      allow update: if request.auth != null && (request.auth.uid == userId || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '      allow delete: if request.auth != null && (request.auth.uid == userId || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /conversations/{convId} {\n'
  + '      allow read, create, delete: if request.auth != null && (request.auth.uid in convId.split(\'_\') || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /conversations/{convId}/messages/{msgId} {\n'
  + '      allow read, create: if request.auth != null && (request.auth.uid in convId.split(\'_\') || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '      allow delete: if request.auth != null && (request.auth.uid in convId.split(\'_\') || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /groups/{groupId}/messages/{msgId} { allow read, create, delete: if request.auth != null; }\n'
  + '    match /channels/{channelId} { allow read, create, delete: if request.auth != null; }\n'
  + '    match /channels/{channelId}/messages/{msgId} {\n'
  + '      allow read, create: if request.auth != null;\n'
  + '      allow delete: if request.auth != null && (request.auth.uid == resource.data.senderUid || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /posts/{postId} {\n'
  + '      allow read: if request.auth != null;\n'
  + '      allow create: if request.auth != null && request.resource.data.authorUid == request.auth.uid;\n'
  + '      allow update: if request.auth != null && (request.auth.uid == resource.data.authorUid || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '      allow delete: if request.auth != null && (request.auth.uid == resource.data.authorUid || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /posts/{postId}/comments/{commentId} {\n'
  + '      allow read, create: if request.auth != null;\n'
  + '      allow delete: if request.auth != null && (request.auth.uid == resource.data.authorUid || request.auth.uid == resource.data.postAuthorUid || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /{document=**} { allow read, write: if request.auth != null && request.auth.token.email == \'chikondigahimbare@gmail.com\'; }\n'
  + '  }\n'
  + '}\n';

var STORAGE_RULES_TEXT = ''
  + 'rules_version = \'2\';\n'
  + 'service firebase.storage {\n'
  + '  match /b/{bucket}/o {\n'
  + '    match /avatars/{userId}/{allPaths=**} {\n'
  + '      allow read: if request.auth != null;\n'
  + '      allow write: if request.auth != null && (request.auth.uid == userId || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /posts/{userId}/{allPaths=**} {\n'
  + '      allow read: if request.auth != null;\n'
  + '      allow write: if request.auth != null && (request.auth.uid == userId || request.auth.token.email == \'chikondigahimbare@gmail.com\');\n'
  + '    }\n'
  + '    match /{allPaths=**} {\n'
  + '      allow read, write: if request.auth != null && request.auth.token.email == \'chikondigahimbare@gmail.com\';\n'
  + '    }\n'
  + '  }\n'
  + '}\n';

function _copyToClipboard(text, label) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(label + ' copied to clipboard! Now paste into Firebase Console Rules editor and click PUBLISH.', 'success');
      }).catch(function () {
        _fallbackCopy(text, label);
      });
    } else {
      _fallbackCopy(text, label);
    }
  } catch (e) {
    console.warn('_copyToClipboard error:', e);
    toast('Could not copy rules. Please open the file manually.');
  }
}

function _fallbackCopy(text, label) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast(label + ' copied to clipboard! Now paste into Firebase Console Rules editor and click PUBLISH.', 'success');
  } catch (e2) {
    console.warn('_fallbackCopy failed:', e2);
    toast('Clipboard unavailable. Please manually copy the rules file.');
  }
}

function copyFirestoreRules()  { _copyToClipboard(FIRESTORE_RULES_TEXT, 'Firestore Rules'); }
function copyStorageRules()    { _copyToClipboard(STORAGE_RULES_TEXT,   'Storage Rules');   }

function _permHtml() {
  return ''
    + '<div style="margin-top:10px;padding:10px 12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;font-size:12px;color:#d1d5db">'
    + '  <div style="margin-bottom:8px;font-weight:600;color:#fff">Fix permission toasts in 30 seconds:</div>'
    + '  <ol style="padding-left:18px;margin:0 0 10px;line-height:1.6">'
    + '    <li>Click <b style="color:#fde68a">Copy Firestore Rules</b> below.</li>'
    + '    <li>Open <a href="https://console.firebase.google.com/project/whatsapp-internal-4a29f/firestore/rules" target="_blank" style="color:#93c5fd;text-decoration:underline">Firestore → Rules</a>.</li>'
    + '    <li>Delete everything in the editor, <b>Paste (Ctrl+V)</b>, click <b>Publish</b>.</li>'
    + '    <li>Repeat for <a href="https://console.firebase.google.com/project/whatsapp-internal-4a29f/storage/rules" target="_blank" style="color:#93c5fd;text-decoration:underline">Storage → Rules</a> using the Storage button.</li>'
    + '  </ol>'
    + '  <div style="display:flex;gap:8px;flex-wrap:wrap">'
    + '    <button type="button" class="btn" style="padding:6px 10px;font-size:12px" onclick="copyFirestoreRules()">📋 Copy Firestore Rules</button>'
    + '    <button type="button" class="btn" style="padding:6px 10px;font-size:12px" onclick="copyStorageRules()">📋 Copy Storage Rules</button>'
    + '    <button type="button" class="btn" style="padding:6px 10px;font-size:12px" onclick="testPermissions()">🔎 Test Permissions</button>'
    + '  </div>'
    + '</div>';
}

function handleErr(e, fallbackMsg) {
  var code = (e || {}).code || '';
  var msg  = (e || {}).message || fallbackMsg || 'Error';
  console.group('%c Permission / Firestore Error ', 'background:#ef4444;color:#fff;font-weight:700');
  try {
    console.log('code     :', code);
    console.log('message  :', msg);
    if (e && typeof e === 'object') {
      Object.keys(e).forEach(function (k) { if (k !== 'message' && k !== 'code' && typeof e[k] !== 'function') console.log(k + ':', e[k]); });
    }
    console.trace ? console.trace() : console.log(new Error().stack);
  } catch (noop) {}
  console.groupEnd();
  if (code === 'permission-denied' || /permission|denied/i.test(msg)) {
    toast('🔒 Missing Firestore permissions: <a href="https://console.firebase.google.com/project/whatsapp-internal-4a29f/firestore/rules" target="_blank" style="color:#ffd980;text-decoration:underline">Firestore → Rules</a>' + _permHtml(), 'error');
  } else if (code === 'not-found' || /not.?found/i.test(msg)) {
    toast((fallbackMsg || msg) + ' (Refreshing the page…)', 'error');
    setTimeout(function () { try { location.reload(); } catch (noop) {} }, 900);
  } else {
    toast(fallbackMsg || msg);
  }
}

function testPermissions() {
  if (!db || !me || !me.uid) { toast('Sign in first, then run the permission test.', 'success'); return; }
  toast('Testing Firestore + Storage permissions. See browser DevTools (F12) → Console for the full report.', 'success');
  var uid = me.uid;
  var email = me.email || '';
  console.group('%c 🔎 Firestore + Storage Permission Test ', 'background:#7c3aed;color:#fff;font-weight:800');
  console.log('user uid:', uid);
  console.log('user email:', email);

  var results = [];
  function addResult(name, ok, extra) {
    results.push({ name: name, ok: ok, extra: extra || '' });
    var c = ok ? 'color:#22c55e;font-weight:700' : 'color:#ef4444;font-weight:700';
    console.log('%c ' + (ok ? '✅' : '❌') + ' ' + name + (extra ? ' — ' + extra : ''), c);
  }

  var myUserRef = db.collection('users').doc(uid);
  var myName = (me.displayName || me.email || 'Test User');
  var t0 = myUserRef.get().then(function () { addResult('users/' + uid + ' READ', true); })
    .catch(function (e) { addResult('users/' + uid + ' READ', false, (e && e.code) || e.message); });

  var t1 = t0.then(function () {
    return myUserRef.set({ uid: uid, name: myName, email: email || 'test@test.com', _permTest: true }, { merge: true })
      .then(function () { addResult('users/' + uid + ' WRITE (merge)', true); })
      .catch(function (e) { addResult('users/' + uid + ' WRITE (merge)', false, (e && e.code) || e.message); });
  });

  var t2 = t1.then(function () {
    var testPostRef = db.collection('posts').doc('__perm_test_' + uid + '_' + Date.now());
    return testPostRef.set({
      authorUid: uid,
      authorName: myName,
      authorEmail: email || '',
      text: 'permission test - safe to delete',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      addResult('posts/<new> CREATE (own)', true);
      return testPostRef.delete().then(function () { addResult('posts/<own> DELETE', true); });
    }).catch(function (e) {
      addResult('posts/<new> CREATE (own) or DELETE', false, (e && e.code) || e.message);
    });
  });

  var t3 = t2.then(function () {
    var cid1 = cid(uid, 'perm_test_buddy');
    var convRef = db.collection('conversations').doc(cid1);
    return convRef.set({ uids: [uid, 'perm_test_buddy'], _permTest: true }, { merge: true })
      .then(function () {
        addResult('conversations/<mine> WRITE', true);
        return convRef.delete().then(function () { addResult('conversations/<mine> DELETE', true); })
          .catch(function (e2) { addResult('conversations/<mine> DELETE', false, (e2 && e2.code) || e2.message); });
      }).catch(function (e) {
        addResult('conversations/<mine> WRITE or DELETE', false, (e && e.code) || e.message);
      });
  });

  var t4 = Promise.resolve();
  if (STORAGE_AVAILABLE && storage) {
    t4 = t3.then(function () {
      var blob = new Blob(['perm test'], { type: 'text/plain' });
      var ref = storage.ref('posts/' + uid + '/perm_test_' + Date.now() + '.txt');
      return ref.put(blob).then(function (snap) {
        addResult('storage posts/' + uid + '/<file> PUT', true);
        return snap.ref.delete().then(function () { addResult('storage posts/' + uid + '/<file> DELETE', true); })
          .catch(function (e2) { addResult('storage posts/' + uid + '/<file> DELETE', false, (e2 && e2.code) || e2.message); });
      }).catch(function (e) {
        addResult('storage posts/' + uid + '/<file> PUT or DELETE', false, (e && e.code) || e.message);
      });
    });
  } else {
    t4 = t3.then(function () { addResult('storage SDK', false, 'firebase.storage() not loaded, add Storage script to HTML'); });
  }

  return t4.then(function () {
    console.groupEnd();
    var okCount = results.filter(function (r) { return r.ok; }).length;
    var total = results.length;
    if (okCount === total) {
      toast('✅ All ' + total + '/' + total + ' permission checks passed! Firestore rules and Storage rules are published correctly.', 'success');
    } else {
      var failed = results.filter(function (r) { return !r.ok; }).map(function (r) { return r.name; }).join(', ');
      toast('❌ ' + okCount + '/' + total + ' passed. Failed: ' + failed + '. Click buttons below to copy rules, paste into Firebase Console Rules, and click PUBLISH.' + _permHtml(), 'error');
    }
  }).catch(function (e) {
    console.groupEnd();
    console.error('testPermissions fatal:', e);
    toast('Permission test crashed: ' + ((e && e.message) || e), 'error');
  });
}

function commitBatchIfAny(b) {
  return new Promise(function (resolve) {
    try {
      var hasOps = false;
      if (typeof b._mutations !== 'undefined') hasOps = !!(b._mutations && b._mutations.length);
      else if (typeof b._ops !== 'undefined') hasOps = !!(b._ops && b._ops.length);
      else if (typeof b.isEmpty === 'function') hasOps = !b.isEmpty();
      else hasOps = true;
      if (hasOps) resolve(b.commit().catch(function (e) { console.warn('batch commit warn:', e); return Promise.resolve(); }));
      else resolve(Promise.resolve());
    } catch (e) {
      console.warn('batch check err:', e);
      resolve(Promise.resolve());
    }
  });
}

function _deleteCollectionDocsInBatches(collRef, batchSize) {
  batchSize = batchSize || 400;
  return collRef.limit(batchSize).get().then(function (snap) {
    if (!snap.size) return Promise.resolve();
    var b = db.batch();
    snap.forEach(function (d) { b.delete(d.ref); });
    return commitBatchIfAny(b).then(function () {
      if (snap.size >= batchSize) return _deleteCollectionDocsInBatches(collRef, batchSize);
      return Promise.resolve();
    });
  }).catch(function (e) {
    console.warn('collection batch delete warn for ', collRef.path, ':', e);
    return Promise.resolve();
  });
}

function performCleanupSPGS() {
  if (!confirm('Delete SP + GS users and all their data? This removes: user docs, DMs, posts, comments. This CANNOT be undone.')) return Promise.resolve(false);
  if (!db || !auth || !auth.currentUser) {
    toast('You must be signed in to run cleanup.', 'error');
    return Promise.resolve(false);
  }
  toast('🔍 Scanning users collection for SP / GS...', 'success');
  var stats = { users: 0, conversations: 0, messages: 0, posts: 0, comments: 0, errors: [] };
  var removedUids = [];
  return db.collection('users').get().then(function (snap) {
    snap.forEach(function (d) {
      var u = d.data() || {};
      u.uid = d.id;
      if (isSPGSUser(u)) {
        removedUids.push(u.uid);
        stats.users++;
        console.log('[cleanup] matched user:', u.uid, 'name=', u.name, 'email=', u.email);
      }
    });
    if (!removedUids.length) {
      toast('✅ No SP / GS users found in Firestore users collection. Nothing to delete.', 'success');
      return Promise.resolve(true);
    }
    toast('🚮 Found ' + removedUids.length + ' user(s). Deleting user docs + data...', 'success');
    var jobs = [];
    removedUids.forEach(function (uid) {
      jobs.push(db.collection('users').doc(uid).delete().catch(function (e) {
        stats.errors.push('user doc ' + uid + ': ' + (e.message || e.code || 'unknown'));
        console.warn('delete user fail:', uid, e);
      }));
    });
    return Promise.all(jobs).then(function () {
      return db.collection('conversations').get().then(function (cSnap) {
        var convJobs = [];
        cSnap.forEach(function (conv) {
          var parts = conv.id.split('_');
          var hit = removedUids.some(function (uid) { return parts.indexOf(uid) !== -1; });
          if (!hit) return;
          stats.conversations++;
          convJobs.push(_deleteCollectionDocsInBatches(db.collection('conversations').doc(conv.id).collection('messages')).then(function () {
            return db.collection('conversations').doc(conv.id).delete().catch(function (e) {
              stats.errors.push('conv ' + conv.id + ': ' + (e.message || e.code || 'perm'));
              console.warn('delete conv fail:', conv.id, e);
              return Promise.resolve();
            });
          }).catch(function () { return Promise.resolve(); }));
        });
        return Promise.all(convJobs);
      }).catch(function (e) {
        stats.errors.push('conversations.list: ' + (e.message || e.code || 'perm'));
        console.warn('conversations get failed:', e);
        return Promise.resolve();
      }).then(function () {
        return db.collection('posts').get().then(function (pSnap) {
          var pJobs = [];
          pSnap.forEach(function (pd) {
            var post = pd.data() || {};
            post.id = pd.id;
            if (removedUids.indexOf(post.authorUid) !== -1) {
              stats.posts++;
              pJobs.push(
                _deleteCollectionDocsInBatches(db.collection('posts').doc(pd.id).collection('comments'))
                  .then(function () { return db.collection('posts').doc(pd.id).delete(); })
                  .catch(function (e) {
                    stats.errors.push('post ' + pd.id + ': ' + (e.message || e.code || 'perm'));
                    console.warn('delete post fail:', pd.id, e);
                    return Promise.resolve();
                  })
              );
            } else {
              pJobs.push(
                db.collection('posts').doc(pd.id).collection('comments').where('authorUid', 'in', removedUids).get().then(function (cs) {
                  if (!cs.size) return Promise.resolve();
                  stats.comments += cs.size;
                  var b = db.batch();
                  cs.forEach(function (c) { b.delete(c.ref); });
                  return commitBatchIfAny(b).catch(function (e) {
                    stats.errors.push('comments in post ' + pd.id + ': ' + (e.message || e.code || 'perm'));
                    console.warn('delete comments fail:', pd.id, e);
                    return Promise.resolve();
                  });
                }).catch(function () { return Promise.resolve(); })
              );
            }
          });
          return Promise.all(pJobs);
        }).catch(function (e) {
          stats.errors.push('posts.list: ' + (e.message || e.code || 'perm'));
          console.warn('posts get failed:', e);
          return Promise.resolve();
        });
      }).then(function () {
        var summary = 'users=' + stats.users +
          ', convs=' + stats.conversations +
          ', posts=' + stats.posts +
          ', comments=' + stats.comments;
        console.log('[cleanup] summary:', summary);
        if (stats.errors.length) {
          console.warn('[cleanup] errors:', stats.errors);
          toast('⚠️ Cleanup finished with issues. ' + summary + '. Errors: ' + stats.errors.length + '. Check console (F12). Reloading in 2s...', 'error');
        } else {
          toast('✅ Cleanup complete. ' + summary + '. Reloading...', 'success');
        }
        setTimeout(function () { try { location.reload(); } catch (e) {} }, 1800);
        return Promise.resolve(true);
      });
    });
  }).catch(function (e) {
    console.error('cleanup fatal:', e);
    var code = (e || {}).code || '';
    if (code === 'permission-denied' || /permission|denied/i.test((e || {}).message || '')) {
      toast('🔒 Cleanup blocked by missing rules. Click <a href="https://console.firebase.google.com/project/whatsapp-internal-4a29f/firestore/rules" target="_blank" style="color:#ffd980;text-decoration:underline">this link</a>, paste firestore.rules, click Publish, then retry.', 'error');
    } else {
      toast('Cleanup failed: ' + (e.message || e.code || e), 'error');
    }
    return Promise.resolve(false);
  });
}

firebase.initializeApp({
  apiKey: 'AIzaSyCkiIBB7r0uNac3GeDMNA0zTYjNVJOSeto',
  authDomain: 'whatsapp-internal-4a29f.firebaseapp.com',
  projectId: 'whatsapp-internal-4a29f',
  storageBucket: 'whatsapp-internal-4a29f.firebasestorage.app',
  messagingSenderId: '120541783728',
  appId: '1:120541783728:web:4e4a04bd7e973f7c14bd75'
});
auth = firebase.auth();
db = firebase.firestore();
var STORAGE_AVAILABLE = !!(firebase.storage && firebase.storage);
var storage = STORAGE_AVAILABLE ? firebase.storage() : null;

/* ==========================================================
 * SHARED: admin list + me-footer click wiring
 * ========================================================== */
var ADMIN_EMAILS = [
  'chikondigahimbare@gmail.com'
];

function currentUserIsAdmin() {
  if (!me || !me.email) return false;
  try {
    var u = me.email.toLowerCase();
    return ADMIN_EMAILS.indexOf(u) !== -1;
  } catch (e) { return false; }
}

function openProfileIfReady() {
  try {
    if (!me || !me.uid) {
      toast('Still signing you in — try again in a moment.', 'success');
      setTimeout(function () { if (me && me.uid) openProfileModal(); }, 900);
      return;
    }
    if (typeof openProfileModal === 'function') {
      openProfileModal();
    } else {
      toast('Profile editor is loading — try again.', 'success');
    }
  } catch (e) {
    console.error('openProfileIfReady error:', e);
    toast('Profile editor error: ' + ((e && e.message) || e));
  }
}

function bindMeFooterOnce() {
  if (bindMeFooterOnce._done) return;
  bindMeFooterOnce._done = true;

  function clickProxy(el) {
    if (!el || el._boundClick) return;
    el.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openProfileIfReady();
    });
    el._boundClick = true;
  }

  try { clickProxy(G('dash-mecard')); } catch (noop) {}
  try { clickProxy(G('dash-edit-btn')); } catch (noop) {}
  try { clickProxy(G('feed-mecard')); } catch (noop) {}
  try { clickProxy(G('feed-edit-btn')); } catch (noop) {}

  try {
    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!t) return;
      if (t.classList && t.classList.contains('me-edit-btn')) {
        e.preventDefault(); e.stopPropagation(); openProfileIfReady();
      } else if (t.classList && (t.classList.contains('me-card') || (t.parentElement && t.parentElement.classList && t.parentElement.classList.contains('me-card')))) {
        var card = t.classList && t.classList.contains('me-card') ? t : t.closest ? t.closest('.me-card') : null;
        if (card && !card._boundClick) {
          e.preventDefault(); e.stopPropagation(); openProfileIfReady();
        }
      }
    });
  } catch (noop) {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindMeFooterOnce);
} else {
  bindMeFooterOnce();
}

function dataURLFromFile(file) {
  return new Promise(function (resolve, reject) {
    if (!file || !window.FileReader) return reject(new Error('FileReader not supported'));
    var reader = new FileReader();
    reader.onload = function (e) { resolve(e.target.result); };
    reader.onerror = function () { reject(reader.error || new Error('File read error')); };
    reader.readAsDataURL(file);
  });
}

function uploadMediaFile(file, folder) {
  folder = folder || 'posts';
  var name = (file.name || ('up-' + (Math.random() + 1).toString(36).slice(2, 8))).replace(/[^a-zA-Z0-9._-]+/g, '_');
  var path = folder + '/' + (me && me.uid || 'anon') + '/' + Date.now() + '-' + name;
  if (STORAGE_AVAILABLE && storage) {
    var ref = storage.ref(path);
    return ref.put(file).then(function (snap) {
      return snap.ref.getDownloadURL().then(function (url) {
        return Promise.resolve({ url: url, path: path, kind: (file.type || '').startsWith('video/') ? 'video' : 'image' });
      });
    }).catch(function (e) {
      console.warn('Storage upload failed, falling back to dataURL:', e);
      return dataURLFromFile(file).then(function (durl) {
        return Promise.resolve({ url: durl, path: null, kind: (file.type || '').startsWith('video/') ? 'video' : 'image' });
      });
    });
  }
  return dataURLFromFile(file).then(function (durl) {
    return Promise.resolve({ url: durl, path: null, kind: (file.type || '').startsWith('video/') ? 'video' : 'image' });
  });
}

function insertAtCursorById(taId, textBefore, textAfter) {
  var ta = typeof taId === 'string' ? document.getElementById(taId) : taId;
  if (!ta) return;
  if (window.getSelection && ta.selectionStart != null) {
    var s = ta.selectionStart, e = ta.selectionEnd;
    var before = ta.value.slice(0, s);
    var mid = ta.value.slice(s, e) || '';
    var after = ta.value.slice(e);
    var insert = (textBefore || '') + mid + (textAfter || '');
    ta.value = before + insert + after;
    var pos = (before + (textBefore || '') + mid).length;
    ta.focus();
    try { ta.setSelectionRange(pos, pos); } catch (err) {}
  } else {
    ta.value += (textBefore || '') + (textAfter || '');
    ta.focus();
  }
  try {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  } catch (e) {}
}

function insertNativeEmoji(taId) {
  var ta = typeof taId === 'string' ? document.getElementById(taId) : taId;
  if (!ta) return;
  if (navigator.keyboard && typeof navigator.keyboard.lock === 'function' && /Chrome|Chromium|Edge/i.test(navigator.userAgent)) {
    try {
      var ev = new KeyboardEvent('keydown', {
        key: '.', code: 'Period',
        ctrlKey: (navigator.platform || '').indexOf('Mac') !== -1,
        metaKey: (navigator.platform || '').indexOf('Mac') !== -1,
        bubbles: true, cancelable: true
      });
      ta.focus();
      ta.dispatchEvent(ev);
    } catch (err) {}
  }
  var pick = prompt('Type or paste an emoji here (iOS/Android: use the system keyboard):', '😊');
  if (pick) insertAtCursorById(ta, pick, '');
}

function uploadFileByInput(input, folder, onProgress) {
  var list = [];
  for (var i = 0; i < input.files.length; i++) list.push(input.files[i]);
  if (!list.length) return Promise.resolve([]);
  var maxMB = folder === 'avatars' ? 8 : 50;
  var over = list.filter(function (f) { return f.size > maxMB * 1024 * 1024; });
  if (over.length) {
    toast('Some files exceed ' + maxMB + 'MB — pick smaller ones.');
    return Promise.resolve([]);
  }
  if (folder !== 'avatars' && list.length > 10) {
    toast('Please attach max 10 files at a time.');
    return Promise.resolve([]);
  }
  return list.reduce(function (prom, file, idx) {
    return prom.then(function (acc) {
      if (onProgress) onProgress(idx + 1, list.length);
      return uploadMediaFile(file, folder).then(function (r) { acc.push(r); return acc; });
    });
  }, Promise.resolve([]));
}

/* ========== SHARED PROFILE MODAL (dashboard + feed) ========== */
var PROFILE_PRESET_EMOJIS = ['🚀','👨‍💼','👩‍💼','🧑‍💻','👨‍🎨','👩‍🔬','🦊','🐼','🦁','🐸','🌈','⭐','🏆','💼','🎯','🔥','💡','🌱'];
var PROFILE_PRESET_GRADIENTS = [
  'linear-gradient(135deg,#25D366,#075e54)','linear-gradient(135deg,#7c3aed,#34b7f1)',
  'linear-gradient(135deg,#f59e0b,#ef4444)','linear-gradient(135deg,#ec4899,#8b5cf6)',
  'linear-gradient(135deg,#14b8a6,#34b7f1)','linear-gradient(135deg,#e11d48,#fb7185)',
  'linear-gradient(135deg,#0ea5e9,#6366f1)','linear-gradient(135deg,#84cc16,#22c55e)'
];
var PROFILE_UPLOADED_DATAURL = '';
var PROFILE_UPLOADED_REMOTE_URL = '';

function getCurrentProfilePhoto() {
  if (PROFILE_UPLOADED_REMOTE_URL) return PROFILE_UPLOADED_REMOTE_URL;
  if (PROFILE_UPLOADED_DATAURL) return PROFILE_UPLOADED_DATAURL;
  var u = G('pfile-url');
  return u ? u.value : '';
}

function buildProfileModalIfNeeded() {
  if (G('pmodal')) return G('pmodal');
  var wrap = document.createElement('div');
  wrap.id = 'pmodal';
  wrap.className = 'modal-mask';
  wrap.style.display = 'none';
  wrap.innerHTML = ''
    + '<div class="modal-card profile-card">'
    + '  <div class="modal-hdr">'
    + '    <span class="modal-title">Edit your profile</span>'
    + '    <button class="ibtn" onclick="closeProfileModal()">'
    + '      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>'
    + '    </button>'
    + '  </div>'
    + '  <div class="modal-body">'
    + '    <div class="pav-wrap" id="pav-wrap" title="Click to upload a picture from phone/laptop" style="cursor:pointer">'
    + '      <div class="pav-preview" id="pav-preview">🚀</div>'
    + '      <div style="font-size:11px;color:#93c5fd;text-align:center;margin-top:6px">Tap the avatar to upload a photo from device</div>'
    + '    </div>'
    + '    <input type="file" id="pfile-input" accept="image/*" capture="user" style="display:none" />'
    + '    <div class="pf-row">'
    + '      <label class="lbl">Avatar type</label>'
    + '      <select class="tag-sel" id="pav-type">'
    + '        <option value="avatar">Emoji + Gradient</option>'
    + '        <option value="photo">Custom photo (tap avatar above or paste URL)</option>'
    + '      </select>'
    + '    </div>'
    + '    <div class="pf-row">'
    + '      <label class="lbl">Emoji (for avatar)</label>'
    + '      <select class="tag-sel" id="pemoji">'
    +         PROFILE_PRESET_EMOJIS.map(function (e) { return '<option value="' + e + '">' + e + '</option>'; }).join('')
    + '      </select>'
    + '    </div>'
    + '    <div class="pf-row">'
    + '      <label class="lbl">Photo URL (optional — OR tap the avatar above to upload from phone/laptop)</label>'
    + '      <input class="inp" id="pfile-url" placeholder="https://... (optional)"/>'
    + '    </div>'
    + '    <div class="pf-row">'
    + '      <label class="lbl">Display name</label>'
    + '      <input class="inp" id="pname" placeholder="Full name"/>'
    + '    </div>'
    + '    <div class="pf-row">'
    + '      <label class="lbl">Bio / Role</label>'
    + '      <input class="inp" id="pbio" placeholder="e.g. Product Manager · Team Green"/>'
    + '    </div>'
    + '    <div class="pf-row">'
    + '      <label class="lbl">Email</label>'
    + '      <input class="inp" id="pemail" placeholder="you@company.com"/>'
    + '    </div>'
    + '    <div style="height:8px"></div>'
    + '    <button class="btn" id="pbtn" onclick="saveProfile()">Save Changes</button>'
    + '  </div>'
    + '</div>';
  document.body.appendChild(wrap);

  var fi = G('pfile-input');
  if (fi && !fi._bound) {
    fi.addEventListener('change', function () { handleProfileFileChange(); });
    fi._bound = true;
  }
  var pw = G('pav-wrap');
  if (pw && !pw._bound) {
    pw.addEventListener('click', function () { if (fi) fi.click(); });
    pw._bound = true;
  }
  var pvType = G('pav-type');
  if (pvType && !pvType._bound) {
    pvType.addEventListener('change', function () { renderProfilePreview(getCurrentProfilePhoto(), G('pemoji').value, PROFILE_PRESET_GRADIENTS[0]); });
    pvType._bound = true;
  }
  var pe = G('pemoji');
  if (pe && !pe._bound) {
    pe.addEventListener('change', function () { renderProfilePreview(getCurrentProfilePhoto(), pe.value, PROFILE_PRESET_GRADIENTS[0]); });
    pe._bound = true;
  }
  var pfu = G('pfile-url');
  if (pfu && !pfu._bound) {
    pfu.addEventListener('input', function () { renderProfilePreview(pfu.value, G('pemoji').value, PROFILE_PRESET_GRADIENTS[0]); });
    pfu._bound = true;
  }
  return wrap;
}

function openProfileModal() {
  try {
    var modal = buildProfileModalIfNeeded();
    if (!modal) { toast('Profile builder failed — reload the page and try again.'); return; }
    modal.style.display = 'flex';
    PROFILE_UPLOADED_DATAURL = '';
    PROFILE_UPLOADED_REMOTE_URL = '';
    var name = (me && me.displayName) || (me && me.email) || '';
    var email = (me && me.email) || '';
    if (!me || !me.uid) { toast('Still signing you in — wait 1 second then try again.', 'success'); setTimeout(function () { if (me && me.uid) openProfileModal(); }, 900); return; }
    if (!db) { toast('Database not ready yet — wait a moment then try again.', 'success'); return; }
    G('pname').value = name || '';
    G('pbio').value = '';
    G('pemail').value = email || '';
    var pu = G('pfile-url'); if (pu) pu.value = '';
    var pf = G('pfile-input'); if (pf) pf.value = '';
    G('pav-type').value = 'avatar';
    G('pemoji').value = '🚀';
    var currentPhoto = (me && me.photoURL) || '';
    if (currentPhoto) {
      G('pav-type').value = 'photo';
      if (pu) pu.value = currentPhoto;
    }
    renderProfilePreview(currentPhoto, '🚀', PROFILE_PRESET_GRADIENTS[0]);
    var userDocRef = db.collection('users').doc(me.uid);
    userDocRef.get().then(function (doc) {
      var ud = doc.exists ? (doc.data() || {}) : {};
      G('pname').value = ud.name || name || '';
      G('pbio').value = ud.bio || '';
      G('pemail').value = ud.email || email || '';
      var dbPhoto = ud.photoURL || currentPhoto || '';
      var dbEmoji = PROFILE_PRESET_EMOJIS.indexOf(ud.emoji || '') !== -1 ? ud.emoji : (ud.emoji || '🚀');
      var dbGrad = ud.gradient || PROFILE_PRESET_GRADIENTS[0];
      if (pu) pu.value = dbPhoto || '';
      if (dbPhoto) G('pav-type').value = 'photo';
      var pe2 = G('pemoji');
      if (pe2) {
        if (PROFILE_PRESET_EMOJIS.indexOf(dbEmoji) === -1) {
          var opt = document.createElement('option');
          opt.value = dbEmoji;
          opt.textContent = dbEmoji;
          pe2.appendChild(opt);
        }
        pe2.value = dbEmoji;
      }
      renderProfilePreview(dbPhoto, dbEmoji, dbGrad);
    }).catch(function (e) {
      var code = (e || {}).code || '';
      var msg = (e || {}).message || '';
      if (code === 'permission-denied' || /permission|denied/i.test(msg)) {
        toast('🔒 Could not read your profile. Your profile still saves — check Firestore rules.');
      } else {
        console.warn('profile fetch warn:', e);
      }
    });
  } catch (err) {
    console.error('openProfileModal error:', err);
    toast('Profile editor error: ' + (err && err.message ? err.message : err));
  }
}

function closeProfileModal() {
  try {
    var m = G('pmodal');
    if (m) m.style.display = 'none';
  } catch (e) { console.warn(e); }
}

function renderProfilePreview(photoURL, emoji, grad) {
  try {
    var box = G('pav-preview');
    if (!box) return;
    var typeEl = G('pav-type');
    var type = typeEl ? typeEl.value : 'avatar';
    if (type === 'photo' && photoURL) {
      box.style.backgroundSize = 'cover';
      box.style.backgroundPosition = 'center';
      box.style.background = 'url("' + photoURL + '") center/cover no-repeat';
      box.textContent = '';
    } else {
      box.style.backgroundImage = '';
      box.style.background = grad;
      box.textContent = emoji || '🚀';
    }
  } catch (e) { console.warn('renderProfilePreview error:', e); }
}

function handleProfileFileChange() {
  try {
    var fi = G('pfile-input');
    if (!fi || !fi.files || !fi.files[0]) return;
    var file = fi.files[0];
    if ((file.size || 0) > 8 * 1024 * 1024) {
      toast('Please choose an image smaller than 8MB.');
      fi.value = '';
      return;
    }
    if (!(file.type || '').startsWith('image/')) {
      toast('Please choose an image (JPG, PNG, WebP, HEIC, etc).');
      fi.value = '';
      return;
    }
    toast('Uploading your profile picture...', 'success');
    var pbtn = G('pbtn');
    if (pbtn) { pbtn.disabled = true; pbtn.textContent = 'Uploading picture...'; }
    var pe = G('pemoji');
    var emojiVal = pe ? pe.value : '🚀';
    var grad = PROFILE_PRESET_GRADIENTS[0];
    dataURLFromFile(file).then(function (durl) {
      PROFILE_UPLOADED_DATAURL = durl;
      PROFILE_UPLOADED_REMOTE_URL = '';
      renderProfilePreview(durl, emojiVal, grad);
      if (STORAGE_AVAILABLE && storage) {
        return uploadMediaFile(file, 'avatars').then(function (res) {
          if (res && res.url) {
            PROFILE_UPLOADED_REMOTE_URL = res.url;
            toast('Profile picture uploaded! Save to apply.', 'success');
            renderProfilePreview(res.url, emojiVal, grad);
          }
        }).catch(function (e) { console.warn('storage fallback:', e); toast('Storage upload failed — using inline preview (still visible to you locally).'); });
      }
      return Promise.resolve();
    }).then(function () {
      if (pbtn) { pbtn.disabled = false; pbtn.textContent = 'Save Changes'; }
    }).catch(function (err) {
      console.error('handleProfileFileChange error:', err);
      toast('Could not upload picture: ' + ((err && err.message) || err));
      if (pbtn) { pbtn.disabled = false; pbtn.textContent = 'Save Changes'; }
    });
  } catch (err2) {
    console.error('handleProfileFileChange top-level error:', err2);
    toast('File picker error: ' + ((err2 && err2.message) || err2));
  }
}

function saveProfile() {
  try {
    if (!me || !me.uid) { toast('Sign in first, then try saving profile.'); return; }
    if (!db || !auth) { toast('Firebase not ready yet — wait and try again.', 'success'); return; }
    var pname = G('pname');
    if (!pname) { toast('Profile form not ready — try again.'); return; }
    var name = pname.value.trim();
    var pemail = G('pemail');
    var email = (pemail ? pemail.value : '').trim();
    var pbio = G('pbio');
    var bio = (pbio ? pbio.value : '').trim();
    var typeEl = G('pav-type');
    var type = typeEl ? typeEl.value : 'avatar';
    var pem = G('pemoji');
    var emoji = pem ? pem.value : '🚀';
    var pfu = G('pfile-url');
    var urlInputVal = (pfu ? pfu.value || '' : '').trim();
    var photo = PROFILE_UPLOADED_REMOTE_URL || PROFILE_UPLOADED_DATAURL || urlInputVal;
    var photoURL = type === 'photo' && photo ? photo : '';
    var grad = PROFILE_PRESET_GRADIENTS[0];
    if (!name) { toast('Please enter a display name.'); return; }
    var btn = G('pbtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    var payload = {
      name: name,
      email: email || (me && me.email) || '',
      bio: bio,
      photoURL: photoURL,
      emoji: emoji,
      gradient: grad,
      uid: me.uid
    };
    var tasks = [];
    tasks.push(db.collection('users').doc(me.uid).set(payload, { merge: true }));
    try {
      var up = auth.currentUser;
      if (up) {
        var updatePayload = { displayName: name };
        if (photoURL) {
          if (/^https?:/.test(photoURL)) updatePayload.photoURL = photoURL;
          else if (PROFILE_UPLOADED_REMOTE_URL) updatePayload.photoURL = PROFILE_UPLOADED_REMOTE_URL;
        }
        tasks.push(up.updateProfile(updatePayload).catch(function (uerr) { console.warn('auth.updateProfile skipped:', uerr); }));
      }
    } catch (innerE) { console.warn('auth profile update skip:', innerE); }
    Promise.all(tasks).then(function () {
      try { me = auth.currentUser; } catch (noop) {}
      toast('✅ Profile updated! Your new picture appears on posts and chat.', 'success');
      closeProfileModal();
      if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
      PROFILE_UPLOADED_DATAURL = '';
      PROFILE_UPLOADED_REMOTE_URL = '';
      setTimeout(function () { try { location.reload(); } catch (noop) {} }, 900);
    }).catch(function (e) {
      var code = (e || {}).code || '';
      var msg = (e || {}).message || 'Could not save profile.';
      if (code === 'permission-denied' || /permission|denied/i.test(msg)) {
        toast('🔒 Firestore permission denied — Publish firestore.rules in Firebase Console → Rules first.');
      } else {
        toast(msg);
      }
      console.error('saveProfile promise catch:', e);
      if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
    });
  } catch (topErr) {
    console.error('saveProfile top-level error:', topErr);
    toast('Profile save error: ' + ((topErr && topErr.message) || topErr));
    var btn2 = G('pbtn');
    if (btn2) { btn2.disabled = false; btn2.textContent = 'Save Changes'; }
  }
}
