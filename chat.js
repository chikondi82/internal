var ac = null, msgUnsub = null, usersUnsub = null, meDocUnsub = null, usersCache = [], channelsCache = [];
var TOTAL_USERS = 0;
var SECT_OPEN = { ch: true, dm: true };
var DEFAULT_CHANNELS = [
  { id: 'general', name: 'general', description: 'Company-wide announcements and work-based matters', createdAt: 0 },
  { id: 'random', name: 'random', description: 'Non-work banter, a place for watercooler chat', createdAt: 1 },
  { id: 'announcements', name: 'announcements', description: 'Important company updates from leadership', createdAt: 2 }
];

function userIsRemoved(u) {
  return isSPGSUser(u);
}

/* handleErr is SHARED from firebase-init.js (includes full console.group diagnostics
   + copy rules to clipboard + test permissions action buttons in the toast). */

function avHTML(u, size) {
  size = size || 20;
  if (u && u.photoURL) {
    return '<img class="i-av" src="' + esc(u.photoURL) + '" style="width:' + size + 'px;height:' + size + 'px;object-fit:cover;border-radius:50%" />';
  }
  if (u && u.emoji && u.gradient) {
    return '<span class="dm-av" style="background:' + u.gradient + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.max(10, Math.floor(size * 0.6)) + 'px;line-height:' + size + 'px">' + u.emoji + '</span>';
  }
  var c = colFor(u && u.uid || '000');
  var i = inits(u && u.name || (u && u.email) || '?');
  return '<span class="dm-av" style="background:' + c + ';width:' + size + 'px;height:' + size + 'px;font-size:' + Math.max(9, Math.floor(size * 0.48)) + 'px">' + i + '</span>';
}

function doLogout() {
  if (msgUnsub) { try { msgUnsub(); } catch (e) {} }
  if (usersUnsub) { try { usersUnsub(); } catch (e) {} }
  if (meDocUnsub) { try { meDocUnsub(); } catch (e) {} }
  auth.signOut().then(function () {
    ac = null;
    usersCache = [];
    channelsCache = [];
    toast('Signed out.', 'success');
  });
}

function seedChannels() {
  var batch = db.batch();
  var pending = DEFAULT_CHANNELS.length;
  DEFAULT_CHANNELS.forEach(function (ch) {
    var ref = db.collection('channels').doc(ch.id);
    ref.get().then(function (doc) {
      if (!doc.exists) {
        batch.set(ref, {
          id: ch.id,
          name: ch.name,
          description: ch.description,
          createdBy: 'system',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }
      pending--;
      if (pending === 0) {
        batch.commit().then(function () { loadChannels(); }).catch(function () { loadChannels(); });
      }
    }).catch(function () { pending--; if (pending === 0) loadChannels(); });
  });
}

function loadChannels() {
  db.collection('channels').orderBy('createdAt', 'asc').get().then(function (snap) {
    channelsCache = [];
    snap.forEach(function (d) { channelsCache.push(d.data()); });
    if (!channelsCache.length) { seedChannels(); return; }
    renderSidebar();
  }).catch(function () {
    seedChannels();
  });
}

function loadUsers() {
  if (usersUnsub) { try { usersUnsub(); } catch (e) {} }
  usersUnsub = db.collection('users').onSnapshot(function (snap) {
    usersCache = [];
    TOTAL_USERS = 0;
    snap.forEach(function (d) {
      var u = d.data();
      u.uid = d.id;
      if (userIsRemoved(u)) return;
      TOTAL_USERS++;
      if (d.id !== me.uid) usersCache.push(u);
    });
    var tch = G('chstat');
    if (tch && ac && ac.type === 'channel') {
      tch.innerHTML = '<span class="dot"></span> ' + TOTAL_USERS + ' member' + (TOTAL_USERS === 1 ? '' : 's');
    }
    renderSidebar();
    if (ac && ac.type === 'dm') {
      var row = G('dm-' + ac.uid);
      if (row) row.classList.add('on');
      var u = usersCache.find(function (x) { return x.uid === ac.uid; });
      if (u) {
        ac.name = u.name || u.email;
        ac.ini = inits(u.name || u.email);
        ac.color = colFor(u.uid);
        G('chname').textContent = ac.name;
        var chav = G('chav');
        if (u.photoURL) {
          chav.style.backgroundImage = 'url(' + u.photoURL + ')';
          chav.style.backgroundSize = 'cover';
          chav.style.backgroundPosition = 'center';
          chav.textContent = '';
        } else {
          chav.style.backgroundImage = '';
          chav.textContent = ac.ini;
          chav.style.background = ac.color;
        }
      }
    }
    refreshMeCard();
  }, function (e) { handleErr(e, 'Could not load users.'); });
}

function renderSidebar() {
  renderChannels();
  renderDMs();
}

function renderChannels() {
  var el = G('chlist');
  if (!channelsCache.length) {
    el.innerHTML = '<div style="color:rgba(255,255,255,0.28);font-size:12px;padding:4px 8px 10px">Loading channels...</div>';
    return;
  }
  el.innerHTML = channelsCache.map(function (c) {
    var on = ac && ac.type === 'channel' && ac.id === c.id ? 'on' : '';
    return '<div class="row ' + on + '" id="ch-' + c.id + '" onclick="openChannel(\'' + c.id + '\')">'
      + '<span class="hash">#</span>'
      + '<span class="rname">' + esc(c.name) + '</span></div>';
  }).join('');
}

function renderDMs() {
  var el = G('dmlist');
  if (!usersCache.length) {
    el.innerHTML = '<div style="color:rgba(255,255,255,0.28);font-size:12px;padding:4px 8px 10px;line-height:1.6">No teammates yet.<br/>Invite colleagues to sign up!</div>';
    return;
  }
  el.innerHTML = usersCache.map(function (u) {
    var on = ac && ac.type === 'dm' && ac.uid === u.uid ? 'on' : '';
    return '<div class="row ' + on + '" id="dm-' + u.uid + '" onclick="openChat(\'' + u.uid + '\',\'' + esc(u.name || u.email) + '\',\'' + colFor(u.uid) + '\',\'' + inits(u.name || u.email) + '\')">'
      + avHTML(u, 20)
      + '<span class="rname">' + esc(u.name || u.email) + '</span></div>';
  }).join('');
}

function onSearch() {
  var q = G('sinp').value.toLowerCase().trim();
  if (!q) { renderSidebar(); return; }
  var fel = G('chlist');
  var fch = channelsCache.filter(function (c) { return c.name.toLowerCase().indexOf(q) > -1 || (c.description || '').toLowerCase().indexOf(q) > -1; });
  fel.innerHTML = !fch.length ? '<div style="color:rgba(255,255,255,0.28);font-size:12px;padding:4px 8px">No channels</div>'
    : fch.map(function (c) {
      var on = ac && ac.type === 'channel' && ac.id === c.id ? 'on' : '';
      return '<div class="row ' + on + '" onclick="openChannel(\'' + c.id + '\')">'
        + '<span class="hash">#</span><span class="rname">' + esc(c.name) + '</span></div>';
    }).join('');
  var del = G('dmlist');
  var fdm = usersCache.filter(function (u) { return (u.name || '').toLowerCase().indexOf(q) > -1 || (u.email || '').toLowerCase().indexOf(q) > -1; });
  del.innerHTML = !fdm.length ? '<div style="color:rgba(255,255,255,0.28);font-size:12px;padding:4px 8px">No people</div>'
    : fdm.map(function (u) {
      var on = ac && ac.type === 'dm' && ac.uid === u.uid ? 'on' : '';
      return '<div class="row ' + on + '" onclick="openChat(\'' + u.uid + '\',\'' + esc(u.name || u.email) + '\',\'' + colFor(u.uid) + '\',\'' + inits(u.name || u.email) + '\')">'
        + avHTML(u, 20) + '<span class="rname">' + esc(u.name || u.email) + '</span></div>';
    }).join('');
}

function toggleSect(k) {
  SECT_OPEN[k] = !SECT_OPEN[k];
  G('chev-' + k).textContent = SECT_OPEN[k] ? '▾' : '▸';
  G(k === 'ch' ? 'chlist' : 'dmlist').style.display = SECT_OPEN[k] ? '' : 'none';
}

function openModal() {
  G('modal').style.display = 'flex';
  G('mcn').value = ''; G('mcd').value = '';
  G('emcn').textContent = '';
  setTimeout(function () { G('mcn').focus(); }, 50);
}

function closeModal() {
  G('modal').style.display = 'none';
}

function createChannel() {
  var n = G('mcn').value.trim().toLowerCase().replace(/[^a-z0-9\-]/g, '');
  var d = G('mcd').value.trim();
  if (!n) { G('emcn').textContent = 'Channel name is required.'; return; }
  if (n.length < 2) { G('emcn').textContent = 'Name must be at least 2 characters.'; return; }
  var btn = G('mbtn'); btn.disabled = true; btn.textContent = 'Creating...';
  var ref = db.collection('channels').doc(n);
  ref.get().then(function (doc) {
    if (doc.exists) {
      G('emcn').textContent = 'A channel with this name already exists.';
      btn.disabled = false; btn.textContent = 'Create Channel';
      return;
    }
    ref.set({
      id: n, name: n, description: d || 'No description yet.',
      createdBy: me.uid,
      createdByName: me.displayName || me.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
      toast('Channel #' + n + ' created!', 'success');
      closeModal();
      btn.disabled = false; btn.textContent = 'Create Channel';
      loadChannels();
      setTimeout(function () { openChannel(n); }, 200);
    }).catch(function (e) {
      handleErr(e, 'Could not create channel.');
      btn.disabled = false; btn.textContent = 'Create Channel';
    });
  });
}

function activeOff() {
  document.querySelectorAll('.row.on, .crow.on').forEach(function (r) { r.classList.remove('on'); });
}

function scrollToDM() {
  var dmSection = G('dmlist');
  if (dmSection) {
    dmSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    dmSection.parentElement.style.background = 'rgba(255,255,255,0.04)';
    setTimeout(function () { dmSection.parentElement.style.background = ''; }, 800);
  }
  var dms = dmSection ? dmSection.querySelectorAll('.row') : [];
  if (dms.length) return;
  var q = G('q'); if (q && !q.value.trim()) { setTimeout(function () { q.focus(); }, 350); return; }
}

function openChannel(cid, fallbackName, fallbackDesc) {
  var c = channelsCache.find(function (x) { return x.id === cid; });
  if (!c) {
    var ref = db.collection('channels').doc(cid);
    var name = fallbackName || cid;
    var desc = fallbackDesc || '';
    ref.get().then(function (doc) {
      if (!doc.exists) {
        return ref.set({
          id: cid, name: name, description: desc,
          createdBy: me.uid,
          createdByName: me.displayName || me.email,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () { return loadChannels(); });
      }
      return Promise.resolve();
    }).then(function () {
      return ref.get().then(function (doc) {
        if (doc.exists) {
          var finalC = doc.data();
          finalC.id = doc.id;
          channelsCache = channelsCache.filter(function (x) { return x.id !== finalC.id; }).concat([finalC]);
          _realOpenChannel(finalC.id, finalC.name, finalC.description);
        }
      });
    }).catch(function (e) { handleErr(e, 'Could not open channel #' + cid); });
    return;
  }
  _realOpenChannel(c.id, c.name, c.description);
}

function _realOpenChannel(cid, cname, cdesc) {
  var c = channelsCache.find(function (x) { return x.id === cid; }) || { id: cid, name: cname, description: cdesc };
  ac = { type: 'channel', id: cid, name: c.name, description: c.description };
  activeOff();
  var row = G('ch-' + cid); if (row) row.classList.add('on');
  G('nc').style.display = 'none';
  G('ac').style.display = 'flex';
  var chav = G('chav');
  chav.textContent = '#';
  chav.style.background = 'linear-gradient(135deg,#7c3aed,#34b7f1)';
  chav.style.backgroundImage = '';
  G('chname').textContent = c.name;
  G('chstat').innerHTML = '<span class="dot"></span> ' + TOTAL_USERS + ' member' + (TOTAL_USERS === 1 ? '' : 's');
  G('ch-topic').textContent = c.description || '';
  G('cmp-hint').textContent = 'Message #' + c.name;
  if (msgUnsub) { try { msgUnsub(); } catch (e) {} }
  var area = G('msgs');
  area.innerHTML = channelIntroHTML(c);
  msgUnsub = db.collection('channels').doc(cid)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(function (snap) {
      area.innerHTML = channelIntroHTML(c);
      snap.forEach(function (d) { addMsg(d.data(), area, 'channel'); });
      area.scrollTop = area.scrollHeight;
    }, function (e) { handleErr(e, 'Could not load channel messages.'); });
}

function channelIntroHTML(c) {
  return '<div class="ch-intro">'
    + '<div class="ch-intro-icon">#</div>'
    + '<h2>This is the start of #' + esc(c.name) + '</h2>'
    + '<p class="ch-intro-desc">' + esc(c.description || 'No description yet.') + '</p>'
    + '<p class="ch-intro-meta">This is the very beginning of the #' + esc(c.name) + ' channel.</p>'
    + '</div><div class="dpill">Today</div>';
}

function openChat(uid, name, color, ini) {
  var u = usersCache.find(function (x) { return x.uid === uid; }) || { uid: uid, name: name, email: name };
  var liveName = u.name || u.email || name;
  var liveColor = colFor(uid);
  var liveIni = inits(u.name || u.email || name);
  ac = { type: 'dm', uid: uid, name: liveName, color: liveColor, ini: liveIni };
  activeOff();
  var row = G('dm-' + uid); if (row) row.classList.add('on');
  G('nc').style.display = 'none';
  G('ac').style.display = 'flex';
  var chav = G('chav');
  chav.textContent = liveIni; chav.style.background = liveColor;
  chav.style.backgroundImage = '';
  if (u.photoURL) {
    chav.style.backgroundImage = 'url(' + u.photoURL + ')';
    chav.style.backgroundSize = 'cover';
    chav.style.backgroundPosition = 'center';
    chav.textContent = '';
  } else if (u.emoji && u.gradient) {
    chav.style.background = u.gradient;
    chav.style.backgroundImage = '';
    chav.textContent = u.emoji;
  }
  G('chname').textContent = liveName;
  G('chstat').innerHTML = '<span class="dot"></span> Online';
  G('ch-topic').textContent = '';
  G('cmp-hint').textContent = 'Message ' + liveName;
  if (msgUnsub) { try { msgUnsub(); } catch (e) {} }
  var convId = cid(me.uid, uid), area = G('msgs');
  area.innerHTML = dmIntroHTML(liveName, u);
  msgUnsub = db.collection('conversations').doc(convId)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(function (snap) {
      var curU = usersCache.find(function (x) { return x.uid === uid; }) || u;
      var curName = curU.name || curU.email || liveName;
      area.innerHTML = dmIntroHTML(curName, curU);
      snap.forEach(function (d) { addMsg(d.data(), area, 'dm'); });
      area.scrollTop = area.scrollHeight;
    }, function (e) { handleErr(e, 'Could not load DM messages.'); });
}

function refreshMeCard() {
  if (!me) return;
  var meRef = db.collection('users').doc(me.uid);
  meRef.get().then(function (doc) {
    var ud = doc.data() || {};
    var uav = G('uav');
    var uname = G('uname');
    if (uname) uname.textContent = ud.name || me.displayName || me.email;
    if (!uav) return;
    if (ud.photoURL || me.photoURL) {
      var p = ud.photoURL || me.photoURL;
      uav.style.backgroundImage = 'url(' + p + ')';
      uav.style.backgroundSize = 'cover';
      uav.style.backgroundPosition = 'center';
      uav.style.background = '';
      uav.style.backgroundImage = 'url(' + p + ')';
      uav.textContent = '';
    } else if (ud.emoji && ud.gradient) {
      uav.style.background = ud.gradient;
      uav.style.backgroundImage = '';
      uav.textContent = ud.emoji;
    } else {
      uav.style.backgroundImage = '';
      uav.style.background = 'linear-gradient(135deg,#25D366,#075e54)';
      uav.textContent = inits(ud.name || me.displayName || me.email);
    }
  }).catch(function () {});
}

function dmIntroHTML(name, uObj) {
  var imgHTML = avHTML(uObj, 54);
  return '<div class="ch-intro">'
    + imgHTML.replace('dm-av','ch-intro-icon dm-intro-icon')
    + '<h2>This is the very beginning of your direct message history with ' + esc(name) + '</h2>'
    + '<p class="ch-intro-desc">Only you and ' + esc(name) + ' can see this conversation.</p>'
    + '<p class="ch-intro-meta">Messages and calls are end-to-end private.</p>'
    + '</div><div class="dpill">Today</div>';
}

function addMsg(data, area, mode) {
  if (userIsRemoved({ name: data.senderName, uid: data.senderUid })) return;
  var isMe = data.senderUid === me.uid;
  var ts = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';
  var cached = usersCache.find(function (u) { return u.uid === data.senderUid; });
  var senderName = (cached && cached.name) || data.senderName || 'Unknown';
  var senderPhoto = (cached && cached.photoURL) || data.senderPhoto || null;
  var senderEmoji = cached && cached.emoji;
  var senderGradient = cached && cached.gradient;
  var senderLabel = '';
  var showAv = false;
  if (mode === 'channel') {
    showAv = true;
    if (!isMe) {
      var sInitials = senderEmoji ? '' : inits(senderName || '?');
      var sColor = senderGradient || colFor(data.senderUid);
      var labelAv = '';
      if (senderPhoto) {
        labelAv = '<img src="' + esc(senderPhoto) + '" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0" />';
      } else if (senderEmoji && senderGradient) {
        labelAv = '<span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:' + senderGradient + ';align-items:center;justify-content:center;flex-shrink:0;font-size:11px">' + senderEmoji + '</span>';
      } else {
        labelAv = '<span style="display:inline-flex;width:20px;height:20px;border-radius:50%;background:' + sColor + ';color:#fff;font-size:10px;font-weight:700;align-items:center;justify-content:center;flex-shrink:0">' + sInitials + '</span>';
      }
      senderLabel = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        + labelAv
        + '<span style="color:#e6edf3;font-size:13px;font-weight:700">' + esc(senderName || 'Unknown') + '</span>'
        + '<span style="color:rgba(255,255,255,0.35);font-size:10px">' + ts + '</span></div>';
    }
  }
  if (mode === 'channel' && isMe) {
    senderLabel = '<div style="color:#86efac;font-size:11px;font-weight:700;margin-bottom:4px;text-align:right">You · ' + ts + '</div>';
  }
  var d = document.createElement('div');
  d.className = 'mrow ' + (isMe ? 'me' : 'them') + (showAv && !isMe ? ' hasav' : '');
  var leftAv = '';
  if (showAv && !isMe) {
    leftAv = avHTML({ uid: data.senderUid, name: senderName, email: data.senderEmail, photoURL: senderPhoto, emoji: senderEmoji, gradient: senderGradient }, 34).replace('style="width:34px;height:34px"','class="lav" style="width:34px;height:34px"');
    if (!/class="lav"/.test(leftAv)) {
      leftAv = leftAv.replace('class="i-av"', 'class="lav i-av"');
    }
  }
  d.innerHTML = leftAv + '<div class="bbl ' + (isMe ? 'me' : 'them') + '">'
    + senderLabel
    + (data.isAI ? '<div class="ailbl">🤖 AI Reply</div>' : '')
    + '<div class="bt">' + formatMsg(data.text) + '</div>'
    + (mode === 'dm' ? '<div class="btime">' + ts + '</div>' : '')
    + '</div>';
  area.appendChild(d);
}

function formatMsg(t) {
  var s = esc(t);
  s = s.replace(/\*(.+?)\*/g, '<b>$1</b>');
  s = s.replace(/`(.+?)`/g, '<code style="background:rgba(255,255,255,0.1);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>');
  s = s.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:#7dd3fc;text-decoration:underline">$1</a>');
  s = s.replace(/\n/g, '<br/>');
  return s;
}

function sendMsg() {
  var inp = G('minp'), text = inp.value.trim();
  if (!text || !ac) return;
  inp.value = ''; updSend();
  var payload = {
    text: text, senderUid: me.uid, senderName: me.displayName || me.email,
    senderPhoto: me.photoURL || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), isAI: false
  };
  if (ac.type === 'channel') {
    db.collection('channels').doc(ac.id).collection('messages').add(payload)
      .catch(function (e) { handleErr(e, 'Could not send message.'); });
  } else if (ac.type === 'dm') {
    db.collection('conversations').doc(cid(me.uid, ac.uid)).collection('messages').add(payload)
      .catch(function (e) { handleErr(e, 'Could not send DM.'); });
  }
}

function updSend() {
  var has = G('minp').value.trim().length > 0;
  G('sndbtn').classList.toggle('off', !has);
}

function getAI() {
  if (!ac) { toast('Open a channel or DM first.'); return; }
  G('typing').style.display = 'block';
  var query;
  if (ac.type === 'channel') {
    query = db.collection('channels').doc(ac.id).collection('messages').orderBy('createdAt', 'asc').limit(15).get();
  } else {
    query = db.collection('conversations').doc(cid(me.uid, ac.uid)).collection('messages').orderBy('createdAt', 'asc').limit(15).get();
  }
  query.then(function (snap) {
      var hist = []; snap.forEach(function (d) { hist.push(d.data()); });
      var ctx = hist.map(function (m) { return m.senderName + ': ' + m.text; }).join('\n');
      return fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 200,
          system: 'You help compose short professional replies in a company chat (Slack-style). Output ONLY the reply text. Use *bold* for emphasis, `code` for snippets. Keep it concise and natural.',
          messages: [{ role: 'user', content: 'Chat context:\n' + (ctx || '(empty)') + '\n\nWrite a reply for ' + (me.displayName || me.email) + ' in the conversation above:' }]
        })
      });
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var t = data && data.content && data.content[0] && data.content[0].text;
      if (t) { G('minp').value = t.trim(); updSend(); toast('AI suggestion ready!', 'success'); }
      else toast('Add your Anthropic API key to enable AI replies.');
      G('typing').style.display = 'none';
    })
    .catch(function (e) { toast('AI error: ' + e.message); G('typing').style.display = 'none'; });
}

/* CLEANUP SP/GS (chat page entry point — shared logic in firebase-init.js) */
function cleanupUsersChat() {
  performCleanupSPGS();
}

/* PROFILE EDITING (shared implementation lives in firebase-init.js)
   openProfileModal / closeProfileModal / saveProfile are loaded from firebase-init.js
   so they work identically on both dashboard.html and feed.html. */

auth.onAuthStateChanged(function (user) {
  if (user) {
    me = user;
    G('dash').style.display = 'flex';
    var uav = G('uav');
    if (uav) {
      if (user.photoURL) {
        uav.style.backgroundImage = 'url(' + user.photoURL + ')';
        uav.style.backgroundSize = 'cover';
        uav.style.backgroundPosition = 'center';
        uav.style.background = '';
        uav.style.backgroundImage = 'url(' + user.photoURL + ')';
        uav.textContent = '';
      } else {
        uav.textContent = inits(user.displayName || user.email);
      }
    }
    G('uname').textContent = user.displayName || user.email;
    var meRef = db.collection('users').doc(user.uid);
    if (meDocUnsub) { try { meDocUnsub(); } catch (e) {} }
    meDocUnsub = meRef.onSnapshot(function (doc) {
      var ud = doc.exists ? (doc.data() || {}) : {};
      var uavEl = G('uav');
      if (uavEl) {
        if (ud.photoURL) {
          uavEl.style.backgroundImage = 'url(' + ud.photoURL + ')';
          uavEl.style.backgroundSize = 'cover';
          uavEl.style.backgroundPosition = 'center';
          uavEl.style.background = '';
          uavEl.style.backgroundImage = 'url(' + ud.photoURL + ')';
          uavEl.textContent = '';
        } else if (ud.emoji && ud.gradient) {
          uavEl.style.background = ud.gradient;
          uavEl.style.backgroundImage = '';
          uavEl.textContent = ud.emoji;
        } else {
          uavEl.style.backgroundImage = '';
          uavEl.style.background = 'linear-gradient(135deg,#25D366,#075e54)';
          uavEl.textContent = inits(ud.name || user.displayName || user.email);
        }
      }
      if (ud.name) {
        var unameEl = G('uname');
        if (unameEl) unameEl.textContent = ud.name;
      }
    }, function () {});
    loadChannels();
    loadUsers();
  } else {
    me = null;
    if (meDocUnsub) { try { meDocUnsub(); } catch (e) {} }
    if (usersUnsub) { try { usersUnsub(); } catch (e) {} }
    window.location.href = 'index.html';
  }
});
