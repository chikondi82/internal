var ac = null, msgUnsub = null, usersUnsub = null, meDocUnsub = null, dmRequestsUnsub = null, dmRequestUnsub = null, dmAccessCheckId = 0, dmRequestsCache = [], dmPermissionPrompt = null, dmExceptionUids = [], dmExceptionConfigLoaded = false, dmExceptionConfigPromise = null, usersCache = [], channelsCache = [], myProfile = {};
var allUsersByUid = {};
var channelMembersUnsub = null, subgroupMembersUnsub = null, channelMemberUids = [], subgroupMemberUids = [];
var SECT_OPEN = { ch: true, dm: true };
var DEFAULT_CHANNELS = [
  { id: 'general', name: 'general', description: 'Company-wide announcements and work-based matters', createdAt: 0 },
  { id: 'random', name: 'random', description: 'Non-work banter, a place for watercooler chat', createdAt: 1 },
  { id: 'announcements', name: 'announcements', description: 'Important company updates from leadership', createdAt: 2 }
];

function isAlwaysPublicChannel(channelId) {
  return ['general', 'random', 'announcements'].indexOf(String(channelId || '').toLowerCase()) !== -1;
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
  if (dmRequestsUnsub) { try { dmRequestsUnsub(); } catch (e) {} }
  if (dmRequestUnsub) { try { dmRequestUnsub(); } catch (e) {} }
  auth.signOut().then(function () {
    ac = null;
    usersCache = [];
    channelsCache = [];
    toast('Signed out.', 'success');
  });
}

function toggleMobileMenu(forceOpen) {
  var dash = G('dash');
  if (!dash) return;
  var isOpen = typeof forceOpen === 'boolean' ? forceOpen : !dash.classList.contains('mobile-menu-open');
  dash.classList.toggle('mobile-menu-open', isOpen);
  var toggle = G('mobile-menu-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Close navigation menu' : 'Open navigation menu');
  }
}

window.addEventListener('resize', function () {
  if (window.innerWidth > 600) toggleMobileMenu(false);
});

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
          visibility: 'public',
          createdBy: me.uid,
          createdByName: 'Workspace admin',
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
    var publicFixes = [];
    snap.forEach(function (d) {
      var channel = d.data(); channel.id = d.id;
      channelsCache.push(channel);
      if (currentUserIsAdmin() && isAlwaysPublicChannel(d.id) && channel.visibility === 'private') {
        publicFixes.push(d.ref.update({ visibility: 'public' }));
      }
    });
    if (!channelsCache.length) {
      if (!currentUserIsAdmin()) { renderSidebar(); return; }
      seedChannels(); return;
    }
    renderSidebar();
    renderDmRequests(dmRequestsCache);
    if (publicFixes.length) {
      Promise.all(publicFixes).then(function () { loadChannels(); })
        .catch(function (e) { handleErr(e, 'Could not restore built-in channels to public access.'); });
    }
  }).catch(function () {
    if (currentUserIsAdmin()) seedChannels();
    else renderSidebar();
  });
}

function loadUsers() {
  if (usersUnsub) { try { usersUnsub(); } catch (e) {} }
  var dmList = G('dmlist');
  if (dmList && !usersCache.length) {
    dmList.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:12px;padding:4px 8px 10px">Loading teammates…</div>';
  }
  usersUnsub = db.collection('users').onSnapshot(function (snap) {
    usersCache = [];
    allUsersByUid = {};
    snap.forEach(function (d) {
      var u = d.data();
      u.uid = d.id;
      allUsersByUid[d.id] = u;
      if (d.id !== me.uid) usersCache.push(u);
    });
    updateOpenMemberCount();
    renderSidebar();
    renderDmRequests(dmRequestsCache);
    updateSuperAdminDmActions();
    if (ac && ac.type === 'dm') {
      var row = findDMRow(ac.uid);
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
  }, function (e) {
    if (dmList) {
      dmList.innerHTML = '<div style="color:#fca5a5;font-size:12px;padding:4px 8px 10px">Could not load teammates. <button class="ibtn" type="button" onclick="loadUsers()">Retry</button></div>';
    }
    handleErr(e, 'Could not load users.');
  });
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
    if (isAlwaysPublicChannel(c.id)) c.visibility = 'public';
    var on = ac && ((ac.type === 'channel' && ac.id === c.id) || (ac.type === 'subgroup' && ac.channelId === c.id)) ? 'on' : '';
    return '<div class="row ' + on + '" id="ch-' + c.id + '" onclick="openChannel(\'' + c.id + '\')">'
      + '<span class="hash">' + (c.visibility === 'private' ? '🔒' : '#') + '</span>'
      + '<span class="rname">' + esc(c.name) + '</span></div>';
  }).join('');
}

function renderDMs() {
  var el = G('dmlist');
  var visibleUsers = usersCache.filter(isVisibleInDmDirectory);
  if (!visibleUsers.length) {
    el.innerHTML = '<div style="color:rgba(255,255,255,0.28);font-size:12px;padding:4px 8px 10px;line-height:1.6">No teammates yet.<br/>Invite colleagues to sign up!</div>';
    return;
  }
  renderDMRows(el, visibleUsers);
}

function isVisibleInDmDirectory(user) {
  var displayName = String(user && (user.name || user.email) || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  return displayName !== 'simon pierre nuru';
}

function loadDmRequests() {
  if (dmRequestsUnsub) { try { dmRequestsUnsub(); } catch (e) {} }
  dmRequestsUnsub = db.collection('dmRequests').where('recipientUid', '==', me.uid)
    .onSnapshot(function (snap) {
      var incoming = snap.docs.map(function (doc) {
        var request = doc.data() || {};
        request.id = doc.id;
        return request;
      }).filter(function (request) { return request.status === 'pending'; });
      dmRequestsCache = incoming;
      renderDmRequests(dmRequestsCache);
    }, function (error) {
      console.error('Could not load incoming direct message requests:', error);
      var list = G('dmrequestlist');
      if (list) list.textContent = 'Could not load message requests.';
    });
}

function renderDmRequests(requests) {
  var list = G('dmrequestlist');
  if (!list) return;
  list.textContent = '';
  if (!requests.length) return;
  var heading = document.createElement('div');
  heading.className = 'dm-request-heading';
  heading.textContent = 'Message requests (' + requests.length + ')';
  list.appendChild(heading);
  requests.forEach(function (request) {
    var sender = usersCache.find(function (user) { return user.uid === request.senderUid; }) || {};
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'row dm-request-row';
    row.textContent = (sender.name || sender.email || 'Workspace user') + ' · Review';
    row.addEventListener('click', function () {
      openChat(request.senderUid, sender.name || sender.email || 'Workspace user', colFor(request.senderUid), inits(sender.name || sender.email || 'Workspace user'));
    });
    list.appendChild(row);
  });
}

function findDMRow(uid) {
  var list = G('dmlist');
  if (!list) return null;
  var rows = list.querySelectorAll('.dm-user-row');
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute('data-user-uid') === uid) return rows[i];
  }
  return null;
}

function renderDMRows(el, users) {
  el.innerHTML = users.map(function (u, index) {
    var on = ac && ac.type === 'dm' && ac.uid === u.uid ? 'on' : '';
    return '<div class="row dm-user-row ' + on + '" data-user-uid="' + esc(u.uid) + '" data-user-index="' + index + '">'
      + avHTML(u, 20)
      + '<span class="rname">' + esc(u.name || u.email || 'Workspace user') + '</span></div>';
  }).join('');

  Array.prototype.forEach.call(el.querySelectorAll('.dm-user-row'), function (row) {
    var user = users[Number(row.getAttribute('data-user-index'))];
    if (!user) return;
    row.addEventListener('click', function () {
      var name = user.name || user.email || 'Workspace user';
      openChat(user.uid, name, colFor(user.uid), inits(name));
    });
  });
}

function updateSuperAdminDmActions() {
  var button = G('ch-clear-dm-btn');
  if (!button) return;
  var user = ac && ac.type === 'dm'
    ? usersCache.find(function (candidate) { return candidate.uid === ac.uid; })
    : null;
  button.style.display = user
    && String(user.email || '').toLowerCase() === 'chikondigahimbare@gmail.com'
    ? ''
    : 'none';
}

function clearSuperAdminDmHistory() {
  if (!me || !ac || ac.type !== 'dm') return;
  var user = usersCache.find(function (candidate) { return candidate.uid === ac.uid; });
  if (!user || String(user.email || '').toLowerCase() !== 'chikondigahimbare@gmail.com') {
    toast('Open the direct message with the workspace super admin first.', 'error');
    return;
  }
  if (!confirm('Permanently delete every message in your direct message history with the workspace super admin? This cannot be undone.')) return;

  var button = G('ch-clear-dm-btn');
  if (button) button.disabled = true;
  var messages = db.collection('conversations').doc(cid(me.uid, ac.uid)).collection('messages');
  var deleted = 0;

  function deleteNextBatch() {
    return messages.limit(450).get().then(function (snap) {
      if (snap.empty) return;
      var batch = db.batch();
      snap.docs.forEach(function (doc) { batch.delete(doc.ref); });
      return batch.commit().then(function () {
        deleted += snap.size;
        return deleteNextBatch();
      });
    });
  }

  deleteNextBatch().then(function () {
    toast('Deleted ' + deleted + ' message(s) from this conversation.', 'success');
  }).catch(function (e) {
    handleErr(e, 'Could not clear this conversation.');
  }).then(function () {
    if (button) button.disabled = false;
  });
}

function clearAllChannelMessages() {
  if (!currentUserIsAdmin()) {
    toast('Only a workspace admin can clear channel messages.', 'error');
    return;
  }
  if (!confirm('Permanently delete every message in every channel and work group? This cannot be undone.')) return;

  var button = G('ch-clear-channels-btn');
  if (button) button.disabled = true;
  var deleted = 0;

  function deleteCollection(collectionRef) {
    function nextBatch() {
      return collectionRef.limit(450).get().then(function (snap) {
        if (snap.empty) return;
        var batch = db.batch();
        snap.docs.forEach(function (doc) { batch.delete(doc.ref); });
        return batch.commit().then(function () {
          deleted += snap.size;
          return nextBatch();
        });
      });
    }
    return nextBatch();
  }

  db.collection('channels').get().then(function (channels) {
    var tasks = [];
    channels.forEach(function (channel) {
      var base = channel.ref;
      tasks.push(deleteCollection(base.collection('messages')));
      tasks.push(base.collection('subgroups').get().then(function (subgroups) {
        var subgroupTasks = [];
        subgroups.forEach(function (subgroup) {
          subgroupTasks.push(deleteCollection(subgroup.ref.collection('messages')));
        });
        return Promise.all(subgroupTasks);
      }));
    });
    return Promise.all(tasks);
  }).then(function () {
    toast('Deleted ' + deleted + ' message(s) from channels and work groups.', 'success');
  }).catch(function (e) {
    handleErr(e, 'Could not clear all channel messages. Some messages may have been deleted before the error.');
  }).then(function () {
    if (button) button.disabled = false;
  });
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
  var fdm = usersCache.filter(function (u) {
    return isVisibleInDmDirectory(u)
      && ((u.name || '').toLowerCase().indexOf(q) > -1 || (u.email || '').toLowerCase().indexOf(q) > -1);
  });
  if (!fdm.length) {
    del.innerHTML = '<div style="color:rgba(255,255,255,0.28);font-size:12px;padding:4px 8px">No people</div>';
    return;
  }
  renderDMRows(del, fdm);
}

function toggleSect(k) {
  SECT_OPEN[k] = !SECT_OPEN[k];
  G('chev-' + k).textContent = SECT_OPEN[k] ? '▾' : '▸';
  G(k === 'ch' ? 'chlist' : 'dmlist').style.display = SECT_OPEN[k] ? '' : 'none';
  if (k === 'dm') G('dmrequestlist').style.display = SECT_OPEN[k] ? '' : 'none';
}

function openModal() {
  if (!currentUserIsAdmin()) { toast('Only an admin can create channels.'); return; }
  G('modal').style.display = 'flex';
  G('mcn').value = ''; G('mcd').value = '';
  G('mcvisibility').value = 'public';
  G('emcn').textContent = '';
  setTimeout(function () { G('mcn').focus(); }, 50);
}

function closeModal() {
  G('modal').style.display = 'none';
}

function createChannel() {
  if (!currentUserIsAdmin()) { toast('Only an admin can create channels.'); return; }
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
      visibility: G('mcvisibility').value === 'private' ? 'private' : 'public',
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
  stopMemberCountListeners();
  document.querySelectorAll('.row.on, .crow.on').forEach(function (r) { r.classList.remove('on'); });
}

function stopMemberCountListeners() {
  if (channelMembersUnsub) { try { channelMembersUnsub(); } catch (_) {} channelMembersUnsub = null; }
  if (subgroupMembersUnsub) { try { subgroupMembersUnsub(); } catch (_) {} subgroupMembersUnsub = null; }
  channelMemberUids = [];
  subgroupMemberUids = [];
}

function setMemberCount(count) {
  var status = G('chstat');
  if (!status) return;
  status.innerHTML = '<span class="dot"></span> ' + count + ' member' + (count === 1 ? '' : 's');
}

function subscribeChannelMemberCount(channelId) {
  var members = db.collection('channels').doc(channelId).collection('members');
  channelMemberUids = [];
  channelMembersUnsub = members.onSnapshot(function (snap) {
    channelMemberUids = snap.docs.map(function (doc) { return doc.id; });
    updateOpenMemberCount();
  }, function () { G('chstat').textContent = 'Member count unavailable'; });
  members.doc(me.uid).get().then(function (member) {
    if (!member.exists) {
      return members.doc(me.uid).set({ uid: me.uid, joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
    }
  }).catch(function (error) {
    console.warn('Channel membership could not be recorded:', error);
  });
}

function countActiveMembers(uids) {
  return uids.filter(function (uid) {
    var user = allUsersByUid[uid];
    return !!me && uid === me.uid || !!user && user.disabled !== true;
  }).length;
}

function updateOpenMemberCount() {
  if (ac && ac.type === 'channel') {
    setMemberCount(countActiveMembers(channelMemberUids));
  } else if (ac && ac.type === 'subgroup') {
    setMemberCount(countActiveMembers(subgroupMemberUids));
  }
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
  toggleMobileMenu(false);
  var clearDmButton = G('ch-clear-dm-btn');
  if (clearDmButton) clearDmButton.style.display = 'none';
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
          checkChannelAccess(finalC);
        }
      });
    }).catch(function (e) { handleErr(e, 'Could not open channel #' + cid); });
    return;
  }
  db.collection('channels').doc(cid).get().then(function (doc) {
    if (!doc.exists) return;
    var fresh = doc.data(); fresh.id = doc.id;
    channelsCache = channelsCache.filter(function (x) { return x.id !== fresh.id; }).concat([fresh]);
    renderChannels();
    checkChannelAccess(fresh);
  }).catch(function (e) { handleErr(e, 'Could not open channel #' + cid); });
}

function checkChannelAccess(c) {
  if (isAlwaysPublicChannel(c.id) || c.visibility !== 'private' || currentUserIsAdmin() || c.createdBy === me.uid) {
    _realOpenChannel(c.id, c.name, c.description); return;
  }
  var ref = db.collection('channels').doc(c.id);
  ref.collection('members').doc(me.uid).get().then(function (member) {
    if (member.exists) { _realOpenChannel(c.id, c.name, c.description); return; }
    ref.collection('requests').doc(me.uid).get().then(function (request) {
      showChannelAccess(c, request.exists);
    });
  }).catch(function (e) { handleErr(e, 'Could not check channel access.'); });
}

function showChannelAccess(c, pending) {
  ac = { type: 'channel', id: c.id, name: c.name, description: c.description };
  activeOff(); var row = G('ch-' + c.id); if (row) row.classList.add('on');
  G('nc').style.display = 'none'; G('ac').style.display = 'flex';
  G('chav').textContent = '🔒'; G('chname').textContent = c.name;
  G('chstat').textContent = 'Private channel'; G('ch-topic').textContent = c.description || '';
  var adminBtn = G('ch-admin-btn'); if (adminBtn) adminBtn.style.display = 'none';
  var visibilityBtn = G('ch-visibility-btn'); if (visibilityBtn) visibilityBtn.style.display = 'none';
  var groupsBtn = G('ch-groups-btn'); if (groupsBtn) groupsBtn.style.display = 'none';
  var backBtn = G('ch-group-back-btn'); if (backBtn) backBtn.style.display = 'none';
  G('cmp-hint').textContent = 'Private channel';
  var composer = G('minp'); if (composer && composer.closest) composer.closest('.composer').style.display = 'none';
  if (msgUnsub) { try { msgUnsub(); } catch (e) {} msgUnsub = null; }
  var area = G('msgs');
  if (currentUserIsAdmin()) { showChannelRequests(c); return; }
  area.innerHTML = '<div class="ch-intro"><div class="ch-intro-icon">🔒</div><h2>Private channel</h2>'
    + '<p class="ch-intro-desc">' + esc(c.description || 'Request access to join this channel.') + '</p>'
    + (pending ? '<p class="ch-intro-meta">Your request is waiting for admin approval.</p>'
      : '<button class="btn" onclick="requestChannelJoin(\'' + c.id + '\')">Request to join</button>') + '</div>';
}

function requestChannelJoin(cid) {
  var c = channelsCache.find(function (x) { return x.id === cid; });
  if (!c || c.visibility !== 'private') return;
  db.collection('channels').doc(cid).collection('requests').doc(me.uid).set({
    uid: me.uid, name: me.displayName || me.email, email: me.email || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function () { toast('Join request sent.', 'success'); showChannelAccess(c, true); })
    .catch(function (e) { handleErr(e, 'Could not send join request.'); });
}

function showChannelRequests(c) {
  var area = G('msgs');
  area.innerHTML = '<div class="ch-intro"><div class="ch-intro-icon">🔒</div><h2>Join requests for #' + esc(c.name) + '</h2><div id="ch-requests">Loading requests…</div></div>';
  db.collection('channels').doc(c.id).collection('requests').orderBy('createdAt', 'asc').get().then(function (snap) {
    var target = G('ch-requests'); if (!target) return;
    if (snap.empty) { target.innerHTML = '<p class="ch-intro-meta">No pending requests.</p>'; return; }
    target.innerHTML = snap.docs.map(function (d) {
      var req = d.data();
      return '<div style="padding:12px;border-bottom:1px solid rgba(255,255,255,.1)"><b>' + esc(req.name || req.email || d.id) + '</b>'
        + '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn" onclick="decideChannelRequest(\'' + c.id + '\',\'' + d.id + '\',true)">Admit</button>'
        + '<button class="btn" onclick="decideChannelRequest(\'' + c.id + '\',\'' + d.id + '\',false)">Reject</button></div></div>';
    }).join('');
  }).catch(function (e) { handleErr(e, 'Could not load join requests.'); });
}

function decideChannelRequest(cid, uid, admit) {
  if (!currentUserIsAdmin()) { toast('Only an admin can review requests.'); return; }
  var base = db.collection('channels').doc(cid);
  var batch = db.batch();
  if (admit) batch.set(base.collection('members').doc(uid), { uid: uid, joinedAt: firebase.firestore.FieldValue.serverTimestamp() });
  batch.delete(base.collection('requests').doc(uid));
  batch.commit().then(function () {
    var c = channelsCache.find(function (x) { return x.id === cid; });
    toast(admit ? 'Member admitted.' : 'Request rejected.', 'success');
    if (c) showChannelRequests(c);
  }).catch(function (e) { handleErr(e, 'Could not update join request.'); });
}

function closeSubgroupModal() {
  var modal = G('subgroup-modal');
  if (modal) modal.remove();
}

function openSubgroups() {
  if (!ac || (ac.type !== 'channel' && ac.type !== 'subgroup')) return;
  var channelId = ac.type === 'subgroup' ? ac.channelId : ac.id;
  var channel = channelsCache.find(function (x) { return x.id === channelId; });
  if (!channel || channel.visibility !== 'private') { toast('Work groups are available in private channels.'); return; }
  var base = db.collection('channels').doc(channelId);
  Promise.all([
    base.collection('subgroups').orderBy('createdAt', 'asc').get(),
    base.collection('subgroupAssignments').doc(me.uid).get()
  ]).then(function (results) {
    var groups = [];
    results[0].forEach(function (doc) { var group = doc.data(); group.id = doc.id; groups.push(group); });
    var assignment = results[1].exists ? results[1].data() : {};
    return Promise.all(groups.map(function (group) {
      return base.collection('subgroups').doc(group.id).collection('requests').doc(me.uid).get()
        .then(function (request) { group.requestPending = request.exists; });
    })).then(function () { return { groups: groups, assignment: assignment }; });
  }).then(function (data) {
    var groups = data.groups, assignment = data.assignment;
    var modal = document.createElement('div');
    modal.id = 'subgroup-modal'; modal.className = 'modal-mask';
    modal.style.display = 'flex';
    modal.onclick = function (event) { if (event.target === modal) closeSubgroupModal(); };
    var cards = groups.length ? groups.map(function (group) {
      var selected = assignment.subgroupId === group.id;
      var isPrivate = group.visibility === 'private';
      var action = currentUserIsAdmin() ? 'Open group' : (selected ? 'Open my group'
        : (isPrivate ? (group.requestPending ? 'Request pending' : 'Request to join') : 'Join group'));
      return '<div class="subgroup-card"><div><h3>' + esc(group.name) + (selected ? ' <span class="subgroup-current">Your group</span>' : '') + '</h3>'
        + '<span class="subgroup-visibility">' + (isPrivate ? 'Private · admin approval' : 'Open to channel members') + '</span>'
        + '<p>' + esc(group.description || 'No description yet.') + '</p></div><div class="subgroup-card-actions">'
        + (currentUserIsAdmin() ? '<button class="btn subgroup-secondary" type="button" onclick="openSubgroupRequests(\'' + channelId + '\',\'' + group.id + '\')">Review requests</button>' : '')
        + (currentUserIsAdmin() ? '<button class="btn subgroup-secondary" type="button" onclick="editChannelSubgroup(\'' + channelId + '\',\'' + group.id + '\')">Edit details</button>' : '')
        + (currentUserIsAdmin() ? '<button class="btn subgroup-secondary" type="button" onclick="toggleSubgroupVisibility(\'' + channelId + '\',\'' + group.id + '\',\'' + (isPrivate ? 'public' : 'private') + '\')">Make ' + (isPrivate ? 'public' : 'private') + '</button>' : '')
        + '<button class="btn" type="button" ' + (group.requestPending && !currentUserIsAdmin() ? 'disabled' : '')
        + ' onclick="' + (!currentUserIsAdmin() && !selected && isPrivate ? 'requestSubgroupJoin' : 'selectChannelSubgroup') + '(\'' + channelId + '\',\'' + group.id + '\')">' + action + '</button></div></div>';
    }).join('') : '<div class="subgroup-empty">No work groups yet.</div>';
    modal.innerHTML = '<div class="modal-card subgroup-modal-card"><div class="modal-hdr"><span class="modal-title">Work groups · #' + esc(channel.name) + '</span>'
      + '<button class="ibtn" type="button" onclick="closeSubgroupModal()" aria-label="Close">×</button></div>'
      + '<div class="modal-body">' + (currentUserIsAdmin() ? '<div class="subgroup-create"><label class="lbl" for="sg-name">Create a work group</label>'
        + '<input class="inp" id="sg-name" maxlength="40" placeholder="e.g. Community outreach">'
        + '<input class="inp" id="sg-description" maxlength="140" placeholder="What will this group work on?">'
        + '<label class="lbl" for="sg-visibility">Who can join?</label><select class="inp" id="sg-visibility"><option value="public">Public — members can join</option><option value="private">Private — admin approval required</option></select>'
        + '<button class="btn" type="button" onclick="createChannelSubgroup(\'' + channelId + '\')">Create group</button></div>' : '')
      + '<div class="subgroup-list">' + cards + '</div></div></div>';
    document.body.appendChild(modal);
  }).catch(function (e) { handleErr(e, 'Could not load channel work groups.'); });
}

function createChannelSubgroup(channelId) {
  if (!currentUserIsAdmin()) { toast('Only an admin can create work groups.'); return; }
  var name = (G('sg-name').value || '').trim();
  var description = (G('sg-description').value || '').trim();
  var visibility = G('sg-visibility').value === 'private' ? 'private' : 'public';
  if (!name) { toast('Enter a work group name.'); return; }
  var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!id) { toast('Use letters or numbers in the group name.'); return; }
  var ref = db.collection('channels').doc(channelId).collection('subgroups').doc(id);
  ref.get().then(function (doc) {
    if (doc.exists) { toast('A work group with that name already exists.'); return; }
    return ref.set({ id: id, name: name, description: description, visibility: visibility, createdBy: me.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(function () { toast('Work group created.', 'success'); closeSubgroupModal(); openSubgroups(); });
  }).catch(function (e) { handleErr(e, 'Could not create work group.'); });
}

function requestSubgroupJoin(channelId, subgroupId) {
  var ref = db.collection('channels').doc(channelId).collection('subgroups').doc(subgroupId);
  ref.collection('requests').doc(me.uid).set({ uid: me.uid, name: myProfile.name || me.displayName || me.email,
    email: me.email || '', createdAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(function () { toast('Request sent to the admin.', 'success'); closeSubgroupModal(); openSubgroups(); })
    .catch(function (e) { handleErr(e, 'Could not request access to this work group.'); });
}

function toggleSubgroupVisibility(channelId, subgroupId, visibility) {
  if (!currentUserIsAdmin()) { toast('Only an admin can change work group access.'); return; }
  db.collection('channels').doc(channelId).collection('subgroups').doc(subgroupId)
    .update({ visibility: visibility === 'private' ? 'private' : 'public' })
    .then(function () { toast(visibility === 'private' ? 'Work group is now private.' : 'Work group is now public.', 'success'); closeSubgroupModal(); openSubgroups(); })
    .catch(function (e) { handleErr(e, 'Could not change work group access.'); });
}

function editChannelSubgroup(channelId, subgroupId) {
  if (!currentUserIsAdmin()) { toast('Only an admin can edit work group details.'); return; }
  var ref = db.collection('channels').doc(channelId).collection('subgroups').doc(subgroupId);
  ref.get().then(function (doc) {
    if (!doc.exists) { toast('This work group is no longer available.'); return; }
    var group = doc.data(), body = G('subgroup-modal') && G('subgroup-modal').querySelector('.modal-body');
    if (!body) return;
    body.innerHTML = '<div class="subgroup-request-header"><button class="ibtn subgroup-back" type="button" onclick="openSubgroups()"><span aria-hidden="true">&#8592;</span><span>Work groups</span></button><h3 class="subgroup-request-title">Edit work group</h3></div>'
      + '<div class="subgroup-edit-form"><label class="lbl" for="sg-edit-name">Title</label><input class="inp" id="sg-edit-name" maxlength="40">'
      + '<label class="lbl" for="sg-edit-description">Subtitle</label><textarea class="inp" id="sg-edit-description" maxlength="140" rows="3"></textarea>'
      + '<label class="lbl" for="sg-edit-visibility">Who can join?</label><select class="inp" id="sg-edit-visibility"><option value="public">Open to channel members</option><option value="private">Private · admin approval required</option></select>'
      + '<button class="btn" type="button" onclick="saveChannelSubgroupEdit(\'' + channelId + '\',\'' + subgroupId + '\')">Save changes</button></div>';
    G('sg-edit-name').value = group.name || '';
    G('sg-edit-description').value = group.description || '';
    G('sg-edit-visibility').value = group.visibility === 'private' ? 'private' : 'public';
  }).catch(function (e) { handleErr(e, 'Could not load work group details.'); });
}

function saveChannelSubgroupEdit(channelId, subgroupId) {
  if (!currentUserIsAdmin()) { toast('Only an admin can edit work group details.'); return; }
  var name = (G('sg-edit-name').value || '').trim();
  var description = (G('sg-edit-description').value || '').trim();
  var visibility = G('sg-edit-visibility').value === 'private' ? 'private' : 'public';
  if (!name) { toast('Enter a work group title.'); return; }
  var isActive = ac && ac.type === 'subgroup' && ac.channelId === channelId && ac.subgroupId === subgroupId;
  db.collection('channels').doc(channelId).collection('subgroups').doc(subgroupId)
    .update({ name: name, description: description, visibility: visibility })
    .then(function () {
      toast('Work group details updated.', 'success'); closeSubgroupModal();
      if (isActive) openSubgroup(channelId, subgroupId); else openSubgroups();
    }).catch(function (e) { handleErr(e, 'Could not save work group details.'); });
}

function openSubgroupRequests(channelId, subgroupId) {
  if (!currentUserIsAdmin()) { toast('Only an admin can review requests.'); return; }
  var ref = db.collection('channels').doc(channelId).collection('subgroups').doc(subgroupId);
  Promise.all([ref.get(), ref.collection('requests').orderBy('createdAt', 'asc').get()]).then(function (results) {
    if (!results[0].exists) { toast('This work group is no longer available.'); return; }
    var group = results[0].data(), requests = results[1];
    var modal = G('subgroup-modal'); if (!modal) return;
    var rows = requests.empty ? '<div class="subgroup-empty">No pending requests.</div>' : requests.docs.map(function (doc) {
      var request = doc.data();
      return '<div class="subgroup-request"><div><b>' + esc(request.name || request.email || doc.id) + '</b><small>' + esc(request.email || '') + '</small></div>'
        + '<div class="subgroup-card-actions"><button class="btn" onclick="decideSubgroupRequest(\'' + channelId + '\',\'' + subgroupId + '\',\'' + doc.id + '\',true)">Admit</button>'
        + '<button class="btn subgroup-secondary" onclick="decideSubgroupRequest(\'' + channelId + '\',\'' + subgroupId + '\',\'' + doc.id + '\',false)">Reject</button></div></div>';
    }).join('');
    modal.querySelector('.modal-body').innerHTML = '<div class="subgroup-request-header"><button class="ibtn subgroup-back" type="button" onclick="openSubgroups()"><span aria-hidden="true">&#8592;</span><span>Work groups</span></button><h3 class="subgroup-request-title">Requests &#183; ' + esc(group.name) + '</h3></div>' + rows;
  }).catch(function (e) { handleErr(e, 'Could not load work group requests.'); });
}

function decideSubgroupRequest(channelId, subgroupId, uid, admit) {
  if (!currentUserIsAdmin()) { toast('Only an admin can review requests.'); return; }
  var base = db.collection('channels').doc(channelId), group = base.collection('subgroups').doc(subgroupId);
  var batch = db.batch();
  if (admit) batch.set(base.collection('subgroupAssignments').doc(uid), { uid: uid, subgroupId: subgroupId,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  batch.delete(group.collection('requests').doc(uid));
  batch.commit().then(function () { toast(admit ? 'Member admitted to the work group.' : 'Request rejected.', 'success'); openSubgroupRequests(channelId, subgroupId); })
    .catch(function (e) { handleErr(e, 'Could not update the work group request.'); });
}

function selectChannelSubgroup(channelId, subgroupId) {
  var assignmentRef = db.collection('channels').doc(channelId).collection('subgroupAssignments').doc(me.uid);
  var current = ac && ac.type === 'subgroup' && ac.channelId === channelId ? ac.subgroupId : null;
  if (current === subgroupId) { closeSubgroupModal(); return openSubgroup(channelId, subgroupId); }
  assignmentRef.set({ uid: me.uid, subgroupId: subgroupId,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp() }).then(function () {
    closeSubgroupModal(); openSubgroup(channelId, subgroupId);
  }).catch(function (e) { handleErr(e, 'Could not join this work group.'); });
}

function openSubgroup(channelId, subgroupId) {
  var clearDmButton = G('ch-clear-dm-btn');
  if (clearDmButton) clearDmButton.style.display = 'none';
  var base = db.collection('channels').doc(channelId);
  Promise.all([
    base.get(), base.collection('subgroups').doc(subgroupId).get(),
    base.collection('subgroupAssignments').doc(me.uid).get()
  ]).then(function (results) {
    if (!results[0].exists || !results[1].exists) { toast('This work group is no longer available.'); return; }
    if (results[0].data().visibility !== 'private') { toast('Work groups are available only in private channels.'); return; }
    if (!currentUserIsAdmin() && (!results[2].exists || results[2].data().subgroupId !== subgroupId)) {
      openSubgroups(); return;
    }
    var channel = results[0].data(), group = results[1].data();
    ac = { type: 'subgroup', channelId: channelId, subgroupId: subgroupId,
      channelName: channel.name, name: group.name, description: group.description || '' };
    activeOff(); var row = G('ch-' + channelId); if (row) row.classList.add('on');
    G('nc').style.display = 'none'; G('ac').style.display = 'flex';
    G('chav').textContent = '↳'; G('chname').textContent = channel.name + ' / ' + group.name;
    G('chstat').textContent = 'Loading members…'; G('ch-topic').textContent = group.description || '';
    subgroupMemberUids = [];
    subgroupMembersUnsub = base.collection('subgroupAssignments').where('subgroupId', '==', subgroupId)
      .onSnapshot(function (snap) {
        subgroupMemberUids = snap.docs.map(function (doc) { return doc.id; });
        updateOpenMemberCount();
      }, function () { G('chstat').textContent = 'Member count unavailable'; });
    G('cmp-hint').textContent = 'Message ' + group.name;
    var adminBtn = G('ch-admin-btn'); if (adminBtn) adminBtn.style.display = 'none';
    var visibilityBtn = G('ch-visibility-btn'); if (visibilityBtn) visibilityBtn.style.display = 'none';
    var groupsBtn = G('ch-groups-btn');
    if (groupsBtn) { groupsBtn.style.display = ''; groupsBtn.onclick = openSubgroups; }
    var backBtn = G('ch-group-back-btn');
    if (backBtn) { backBtn.style.display = ''; backBtn.onclick = function () { openChannel(channelId); }; }
    var composer = G('minp'); if (composer && composer.closest) composer.closest('.composer').style.display = '';
    if (msgUnsub) { try { msgUnsub(); } catch (e) {} }
    var area = G('msgs');
    area.innerHTML = channelIntroHTML({ name: group.name, description: group.description || 'Work group in #' + channel.name });
    msgUnsub = base.collection('subgroups').doc(subgroupId).collection('messages')
      .orderBy('createdAt', 'asc').onSnapshot(function (snap) {
        area.innerHTML = channelIntroHTML({ name: group.name, description: group.description || 'Work group in #' + channel.name });
        snap.forEach(function (d) { addMsg(d.data(), area, 'channel', d.ref); });
        area.scrollTop = area.scrollHeight;
      }, function (e) { handleErr(e, 'Could not load work group messages.'); });
  }).catch(function (e) { handleErr(e, 'Could not open work group.'); });
}

function toggleChannelVisibility(cid) {
  if (!currentUserIsAdmin()) { toast('Only an admin can change channel access.'); return; }
  if (isAlwaysPublicChannel(cid)) { toast('General, random, and announcements are always public.'); return; }
  var c = channelsCache.find(function (x) { return x.id === cid; });
  if (!c) return;
  var nextVisibility = c.visibility === 'private' ? 'public' : 'private';
  var button = G('ch-visibility-btn');
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  var updateVisibility = db.collection('channels').doc(cid).update({ visibility: nextVisibility });
  updateVisibility.then(function () {
    c.visibility = nextVisibility;
    c._reviewing = false;
    renderChannels();
    toast(nextVisibility === 'private' ? 'Channel is now private. New members need admin approval.' : 'Channel is now public.', 'success');
    _realOpenChannel(c.id, c.name, c.description);
  }).catch(function (e) { handleErr(e, 'Could not change channel access.'); })
    .then(function () { if (button) button.disabled = false; });
}

function _realOpenChannel(cid, cname, cdesc) {
  var clearDmButton = G('ch-clear-dm-btn');
  if (clearDmButton) clearDmButton.style.display = 'none';
  var c = channelsCache.find(function (x) { return x.id === cid; }) || { id: cid, name: cname, description: cdesc };
  var clearChannelsButton = G('ch-clear-channels-btn');
  if (clearChannelsButton) clearChannelsButton.style.display = currentUserIsAdmin() ? '' : 'none';
  ac = { type: 'channel', id: cid, name: c.name, description: c.description };
  activeOff();
  var row = G('ch-' + cid); if (row) row.classList.add('on');
  G('nc').style.display = 'none';
  G('ac').style.display = 'flex';
  var chav = G('chav');
  chav.textContent = '#';
  chav.style.background = 'linear-gradient(135deg,#075e45,#c9a84c)';
  chav.style.backgroundImage = '';
  G('chname').textContent = c.name;
  G('chstat').textContent = 'Loading members…';
  subscribeChannelMemberCount(cid);
  G('ch-topic').textContent = c.description || '';
  var composer = G('minp'); if (composer && composer.closest) composer.closest('.composer').style.display = '';
  var adminBtn = G('ch-admin-btn');
  if (adminBtn) {
    adminBtn.style.display = currentUserIsAdmin() && c.visibility === 'private' && !isAlwaysPublicChannel(c.id) ? '' : 'none';
    adminBtn.textContent = c._reviewing ? 'View messages' : 'Review requests';
    adminBtn.onclick = function () {
      if (c._reviewing) { c._reviewing = false; _realOpenChannel(c.id, c.name, c.description); }
      else { c._reviewing = true; adminBtn.textContent = 'View messages'; showChannelRequests(c); }
    };
  }
  var visibilityBtn = G('ch-visibility-btn');
  if (visibilityBtn) {
    visibilityBtn.style.display = currentUserIsAdmin() && !isAlwaysPublicChannel(c.id) ? '' : 'none';
    visibilityBtn.disabled = false;
    visibilityBtn.textContent = c.visibility === 'private' ? 'Make public' : 'Make private';
    visibilityBtn.onclick = function () { toggleChannelVisibility(c.id); };
  }
  var groupsBtn = G('ch-groups-btn');
  if (groupsBtn) {
    groupsBtn.style.display = c.visibility === 'private' && !isAlwaysPublicChannel(c.id) ? '' : 'none';
    groupsBtn.onclick = openSubgroups;
  }
  var backBtn = G('ch-group-back-btn'); if (backBtn) backBtn.style.display = 'none';
  G('cmp-hint').textContent = 'Message #' + c.name;
  if (msgUnsub) { try { msgUnsub(); } catch (e) {} }
  var area = G('msgs');
  area.innerHTML = channelIntroHTML(c);
  msgUnsub = db.collection('channels').doc(cid)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(function (snap) {
      area.innerHTML = channelIntroHTML(c);
      snap.forEach(function (d) { addMsg(d.data(), area, 'channel', d.ref); });
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
  closeDmPermissionPrompt();
  toggleMobileMenu(false);
  var clearDmButton = G('ch-clear-dm-btn');
  if (clearDmButton) clearDmButton.style.display = 'none';
  var clearChannelsButton = G('ch-clear-channels-btn');
  if (clearChannelsButton) clearChannelsButton.style.display = 'none';
  var adminBtn = G('ch-admin-btn'); if (adminBtn) adminBtn.style.display = 'none';
  var visibilityBtn = G('ch-visibility-btn'); if (visibilityBtn) visibilityBtn.style.display = 'none';
  var groupsBtn = G('ch-groups-btn'); if (groupsBtn) groupsBtn.style.display = 'none';
  var backBtn = G('ch-group-back-btn'); if (backBtn) backBtn.style.display = 'none';
  var u = usersCache.find(function (x) { return x.uid === uid; }) || { uid: uid, name: name, email: name };
  var liveName = u.name || u.email || name;
  var liveColor = colFor(uid);
  var liveIni = inits(u.name || u.email || name);
  ac = { type: 'dm', uid: uid, name: liveName, color: liveColor, ini: liveIni };
  updateSuperAdminDmActions();
  activeOff();
  var row = findDMRow(uid); if (row) row.classList.add('on');
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
  var groupsBtn = G('ch-groups-btn'); if (groupsBtn) groupsBtn.style.display = 'none';
  var backBtn = G('ch-group-back-btn'); if (backBtn) backBtn.style.display = 'none';
  G('cmp-hint').textContent = 'Message ' + liveName;
  if (msgUnsub) { try { msgUnsub(); } catch (e) {} }
  if (dmRequestUnsub) { try { dmRequestUnsub(); } catch (e) {} dmRequestUnsub = null; }
  var convId = cid(me.uid, uid), area = G('msgs');
  var accessCheckId = ++dmAccessCheckId;
  ac.dmAllowed = false;
  ac.dmAccessStatus = 'checking';
  ac.dmSendWhenAllowed = false;
  setDmComposerVisible(true);
  area.innerHTML = dmIntroHTML(liveName, u);
  if (currentUserIsAdmin() || isDmAccessException(me.uid)) {
    loadDmMessages(uid, liveName, u, convId);
    return;
  }
  if (!dmExceptionConfigLoaded) {
    loadDmAccessExceptions().then(function () {
      if (accessCheckId !== dmAccessCheckId || !ac || ac.type !== 'dm' || ac.uid !== uid) return;
      if (currentUserIsAdmin() || isDmAccessException(me.uid)) {
        var sendWhenAllowed = ac.dmSendWhenAllowed === true;
        loadDmMessages(uid, liveName, u, convId);
        if (sendWhenAllowed) sendMsg();
        return;
      }
      checkDmAccessForChat(uid, liveName, u, convId, accessCheckId);
    });
    return;
  }
  checkDmAccessForChat(uid, liveName, u, convId, accessCheckId);
}

function checkDmAccessForChat(uid, liveName, user, convId, accessCheckId) {
  var area = G('msgs');
  getWorkspaceDmAccess('access', { recipientUid: uid }).then(function (access) {
    if (accessCheckId !== dmAccessCheckId || !ac || ac.type !== 'dm' || ac.uid !== uid) return;
    if (access.status === 'allowed') {
      var sendWhenAllowed = ac.dmSendWhenAllowed === true;
      loadDmMessages(uid, liveName, user, convId);
      if (sendWhenAllowed) sendMsg();
      return;
    }
    ac.dmAccessStatus = access.status;
    ac.dmSendWhenAllowed = false;
    if (access.status === 'request-required') {
      G('chstat').textContent = 'Permission required';
      area.innerHTML = dmIntroHTML(liveName, user);
      handleDmComposerInput();
    } else {
      G('chstat').textContent = 'Message request';
      setDmComposerVisible(false);
      showDmAccessCard(access.status, uid);
      if (access.status === 'request-sent' || access.status === 'request-received') observeDmRequest(convId, uid, accessCheckId);
    }
  }).catch(function (error) {
    if (accessCheckId !== dmAccessCheckId || !ac || ac.uid !== uid) return;
    console.error('Could not check direct message access:', error);
    if (ac) ac.dmAccessStatus = 'error';
    if (ac) ac.dmSendWhenAllowed = false;
    setDmComposerVisible(false);
    G('chstat').textContent = 'Access check failed';
    showDmAccessCard('error', uid, error.message);
  });
}

function loadDmAccessExceptions() {
  if (dmExceptionConfigPromise) return dmExceptionConfigPromise;
  if (!me || !me.uid) return Promise.resolve([]);
  var uid = me.uid;
  dmExceptionConfigPromise = db.collection('workspaceConfig').doc('dmAccessExceptions').get()
    .then(function (doc) {
      if (me && me.uid === uid) {
        var config = doc.exists ? (doc.data() || {}) : {};
        dmExceptionUids = Array.isArray(config.uids) ? config.uids : [];
        dmExceptionConfigLoaded = true;
      }
      return dmExceptionUids;
    }).catch(function (error) {
      console.warn('Trusted direct-message accounts could not be loaded:', error);
      if (me && me.uid === uid) {
        dmExceptionUids = [];
        dmExceptionConfigLoaded = true;
      }
      return dmExceptionUids;
    });
  return dmExceptionConfigPromise;
}

function isDmAccessException(uid) {
  return !!uid && dmExceptionUids.indexOf(uid) !== -1;
}

function loadDmMessages(uid, liveName, user, convId) {
  if (!ac || ac.type !== 'dm' || ac.uid !== uid) return;
  var area = G('msgs');
  ac.dmAllowed = true;
  ac.dmAccessStatus = 'allowed';
  ac.dmSendWhenAllowed = false;
  setDmComposerVisible(true);
  G('chstat').textContent = 'Direct message';
  area.innerHTML = dmIntroHTML(liveName, user);
  msgUnsub = db.collection('conversations').doc(convId)
    .collection('messages').orderBy('createdAt', 'asc')
    .onSnapshot(function (snap) {
      if (!ac || ac.type !== 'dm' || ac.uid !== uid) return;
      var currentUser = usersCache.find(function (candidate) { return candidate.uid === uid; }) || user;
      var currentName = currentUser.name || currentUser.email || liveName;
      area.innerHTML = dmIntroHTML(currentName, currentUser);
      snap.forEach(function (doc) { addMsg(doc.data(), area, 'dm'); });
      area.scrollTop = area.scrollHeight;
    }, function (error) { handleErr(error, 'Could not load DM messages.'); });
}

function setDmComposerVisible(visible) {
  var input = G('minp');
  var composer = input && input.closest ? input.closest('.composer') : null;
  if (composer) composer.style.display = visible ? '' : 'none';
}

function handleDmComposerInput() {
  updSend();
  if (!ac || ac.type !== 'dm' || ac.dmAllowed || !getComposerText().trim()) return;
  if (ac.dmAccessStatus === 'request-required') showDmPermissionPrompt(ac.uid);
}

function showDmPermissionPrompt(uid) {
  if (dmPermissionPrompt) return;
  var user = usersCache.find(function (candidate) { return candidate.uid === uid; }) || {};
  var name = user.name || user.email || 'this member';
  var overlay = document.createElement('div');
  overlay.className = 'modal-mask';
  overlay.setAttribute('role', 'presentation');

  var card = document.createElement('section');
  card.className = 'modal-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'dm-permission-title');

  var heading = document.createElement('div');
  heading.className = 'modal-hdr';
  var title = document.createElement('span');
  title.className = 'modal-title';
  title.id = 'dm-permission-title';
  title.textContent = 'Ask permission to continue with this chat';
  heading.appendChild(title);

  var body = document.createElement('div');
  body.className = 'modal-body';
  var message = document.createElement('p');
  message.className = 'modal-sub';
  message.textContent = name + ' must accept your request before you can send messages. Your draft will stay here.';
  body.appendChild(message);

  var actions = document.createElement('div');
  actions.className = 'dm-permission-actions';
  var requestButton = document.createElement('button');
  requestButton.type = 'button';
  requestButton.className = 'btn';
  requestButton.textContent = 'Request permission';
  requestButton.addEventListener('click', function () {
    closeDmPermissionPrompt();
    submitDmRequest(uid);
  });
  var cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'btn';
  cancelButton.textContent = 'Not now';
  cancelButton.addEventListener('click', closeDmPermissionPrompt);
  actions.appendChild(requestButton);
  actions.appendChild(cancelButton);

  card.appendChild(heading);
  card.appendChild(body);
  card.appendChild(actions);
  overlay.appendChild(card);
  overlay.addEventListener('click', function (event) {
    if (event.target === overlay) closeDmPermissionPrompt();
  });
  document.body.appendChild(overlay);
  dmPermissionPrompt = overlay;
  requestButton.focus();
}

function closeDmPermissionPrompt() {
  if (!dmPermissionPrompt) return;
  if (dmPermissionPrompt.parentNode) dmPermissionPrompt.parentNode.removeChild(dmPermissionPrompt);
  dmPermissionPrompt = null;
}

function getWorkspaceDmAccess(action, payload) {
  return me.getIdToken().then(function (token) {
    var url = '/api/workspace/dm/' + action;
    var options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    };
    var accessRetryDelays = [6000, 12000, 18000, 24000];

    function retryAccess(attempt) {
      return new Promise(function (resolve) {
        setTimeout(resolve, accessRetryDelays[attempt]);
      }).then(function () {
        return request(attempt + 1);
      });
    }

    function request(attempt) {
      return fetch(url, options).then(function (response) {
        return response.text().then(function (body) {
          var result;
          try {
            result = body ? JSON.parse(body) : {};
          } catch (error) {
            if (action === 'access' && attempt < accessRetryDelays.length
                && [502, 503, 504].indexOf(response.status) !== -1) {
              return retryAccess(attempt);
            }
            if (response.status === 404) {
              throw new Error('The direct-message access service is not deployed yet. Deploy the updated server and Netlify redirect, then try again.');
            }
            if ([502, 503, 504].indexOf(response.status) !== -1) {
              throw new Error('The direct-message service is still unavailable after several attempts (HTTP ' + response.status + '). Try again shortly.');
            }
            throw new Error('The direct-message access service returned an invalid response (HTTP ' + response.status + ').');
          }
          if (!result || typeof result !== 'object') result = {};
          if (!response.ok) {
            var retryableGateway = response.status === 502 || response.status === 504
              || (response.status === 503 && !result.error);
            if (action === 'access' && attempt < accessRetryDelays.length && retryableGateway) {
              return retryAccess(attempt);
            }
            if (result.error) throw new Error(result.error);
            if ([502, 503, 504].indexOf(response.status) !== -1) {
              throw new Error('The direct-message service is still unavailable after several attempts (HTTP ' + response.status + '). Try again shortly.');
            }
            throw new Error('Could not process the direct message request (HTTP ' + response.status + ').');
          }
          return result;
        });
      }, function (error) {
        if (action === 'access' && attempt < accessRetryDelays.length && error instanceof TypeError) return retryAccess(attempt);
        throw error;
      });
    }

    return request(0);
  });
}

function showDmAccessCard(status, uid, errorText) {
  var area = G('msgs');
  var name = (usersCache.find(function (user) { return user.uid === uid; }) || {}).name || 'this member';
  var title = document.createElement('h2');
  var message = document.createElement('p');
  var card = document.createElement('div');
  card.className = 'ch-intro dm-access-card';
  if (status === 'request-required') {
    title.textContent = 'Request to message ' + name;
    message.textContent = 'This member is outside your assigned Group. Send a message request to start a private conversation.';
    addDmAccessButton(card, 'Send message request', function () { submitDmRequest(uid); });
  } else if (status === 'request-sent') {
    title.textContent = 'Message request sent';
    message.textContent = 'Your request is waiting for ' + name + ' to accept.';
  } else if (status === 'request-received') {
    title.textContent = 'Message request from ' + name;
    message.textContent = 'Accept to start a private conversation. Until then, messages are unavailable.';
    addDmAccessButton(card, 'Accept', function () { respondToDmRequest(uid, true); });
    addDmAccessButton(card, 'Deny', function () { respondToDmRequest(uid, false); });
  } else if (status === 'request-declined') {
    title.textContent = 'Request declined';
    message.textContent = name + ' declined your message request.';
  } else if (status === 'request-declined-by-you') {
    title.textContent = 'Request declined';
    message.textContent = 'You declined ' + name + '’s message request.';
  } else {
    title.textContent = 'Could not check message access';
    message.textContent = errorText || 'Please check your connection and try again.';
    addDmAccessButton(card, 'Retry', function () { openChat(uid, name, colFor(uid), inits(name)); });
  }
  card.prepend(message);
  card.prepend(title);
  area.replaceChildren(card);
}

function addDmAccessButton(card, label, onClick) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn dm-access-action';
  button.textContent = label;
  button.addEventListener('click', onClick);
  card.appendChild(button);
}

function observeDmRequest(convId, uid, accessCheckId) {
  if (dmRequestUnsub) { try { dmRequestUnsub(); } catch (e) {} }
  dmRequestUnsub = db.collection('dmRequests').doc(convId).onSnapshot(function (doc) {
    if (accessCheckId !== dmAccessCheckId || !ac || ac.type !== 'dm' || ac.uid !== uid || !doc.exists) return;
    var request = doc.data() || {};
    if (request.status === 'accepted') openChat(uid, ac.name, ac.color, ac.ini);
    else if (request.status === 'declined' && request.senderUid === me.uid) showDmAccessCard('request-declined', uid);
  }, function (error) {
    console.error('Could not monitor the direct message request:', error);
  });
}

function submitDmRequest(uid) {
  getWorkspaceDmAccess('request', { recipientUid: uid }).then(function () {
    var user = usersCache.find(function (candidate) { return candidate.uid === uid; }) || {};
    openChat(uid, user.name || user.email || 'Workspace user', colFor(uid), inits(user.name || user.email || 'Workspace user'));
  }).catch(function (error) {
    toast(error.message || 'Could not send the message request.');
  });
}

function respondToDmRequest(senderUid, accept) {
  getWorkspaceDmAccess('respond', { senderUid: senderUid, accept: accept }).then(function () {
    var user = usersCache.find(function (candidate) { return candidate.uid === senderUid; }) || {};
    if (accept) {
      openChat(senderUid, user.name || user.email || 'Workspace user', colFor(senderUid), inits(user.name || user.email || 'Workspace user'));
      toast('Message request accepted.', 'success');
      return;
    }
    if (dmRequestUnsub) { try { dmRequestUnsub(); } catch (e) {} dmRequestUnsub = null; }
    showDmAccessCard('request-declined-by-you', senderUid);
    toast('Message request declined.', 'success');
  }).catch(function (error) {
    toast(error.message || 'Could not respond to the message request.');
  });
}

function refreshMeCard() {
  if (!me) return;
  var meRef = db.collection('users').doc(me.uid);
  meRef.get().then(function (doc) {
    var ud = doc.data() || {};
    myProfile = ud;
    var uav = G('uav');
    var uname = G('uname');
    if (uname) uname.textContent = ud.name || me.displayName || me.email;
    setUserAvatar(uav, ud, me);
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

function addMsg(data, area, mode, messageRef) {
  var isMe = data.senderUid === me.uid;
  var ts = data.createdAt ? data.createdAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'now';
  var cached = usersCache.find(function (u) { return u.uid === data.senderUid; });
  var senderProfile = isMe ? myProfile : (cached || {});
  var senderName = senderProfile.name || (cached && cached.name) || data.senderName || 'Unknown';
  var senderPhoto = senderProfile.photoURL || (cached && cached.photoURL) || data.senderPhoto || null;
  var senderEmoji = senderProfile.emoji || (cached && cached.emoji);
  var senderGradient = senderProfile.gradient || (cached && cached.gradient);
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
    var selfAvatar = avHTML({
      uid: me.uid,
      name: senderName,
      email: me.email,
      photoURL: senderPhoto,
      emoji: senderEmoji,
      gradient: senderGradient
    }, 20);
    senderLabel = '<div style="display:flex;align-items:center;justify-content:flex-end;gap:7px;margin-bottom:4px">'
      + selfAvatar
      + '<span style="color:#86efac;font-size:11px;font-weight:700">You</span>'
      + '<span style="color:rgba(255,255,255,0.35);font-size:10px">' + ts + '</span></div>';
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
  if (mode === 'channel' && isMe && messageRef) {
    var deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'msg-delete-btn';
    deleteButton.textContent = 'Delete';
    deleteButton.setAttribute('aria-label', 'Delete your message');
    deleteButton.addEventListener('click', function () { deleteChannelMessage(messageRef, deleteButton); });
    d.querySelector('.bbl').appendChild(deleteButton);
  }
  area.appendChild(d);
}

function deleteChannelMessage(messageRef, button) {
  if (!messageRef || !confirm('Delete this message from the channel? This cannot be undone.')) return;
  if (button) button.disabled = true;
  messageRef.delete().then(function () {
    toast('Message deleted.', 'success');
  }).catch(function (e) {
    handleErr(e, 'Could not delete this message. You can delete only messages you wrote.');
  }).then(function () {
    if (button) button.disabled = false;
  });
}

function formatMsg(t) {
  var lines = String(t || '').split('\n'), out = [], listItems = [], listType = '';
  function flushList() {
    if (!listItems.length) return;
    var tag = listType === 'ordered' ? 'ol' : 'ul';
    out.push('<' + tag + ' class="message-list">' + listItems.map(function (item) { return '<li>' + formatInlineMsg(item) + '</li>'; }).join('') + '</' + tag + '>');
    listItems = []; listType = '';
  }
  lines.forEach(function (line) {
    var marker = line.match(/^\s*(-|\*|\d+\.)\s+(.+)$/);
    if (marker) {
      var nextType = /^\d/.test(marker[1]) ? 'ordered' : 'unordered';
      if (listItems.length && listType !== nextType) flushList();
      listType = nextType; listItems.push(marker[2]); return;
    }
    flushList();
    var quote = line.match(/^\s*>\s?(.*)$/);
    out.push(quote ? '<blockquote class="message-quote">' + formatInlineMsg(quote[1]) + '</blockquote>' : formatInlineMsg(line));
  });
  flushList();
  return out.join('<br/>');
}

function formatInlineMsg(t) {
  var s = esc(t), links = [];
  function stashLink(html) { links.push(html); return '\uE000' + (links.length - 1) + '\uE001'; }
  s = s.replace(/`([^`\n]+)`/g, function (_, code) {
    return stashLink('<code class="message-code">' + code + '</code>');
  });
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, function (_, label, url) {
    return stashLink('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
  });
  s = s.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  s = s.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, function (_, url) {
    return stashLink('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>');
  });
  return s.replace(/\uE000(\d+)\uE001/g, function (_, index) { return links[Number(index)]; });
}

function formatComposer(kind) {
  var inp = G('minp');
  if (!inp) return;
  inp.focus();
  if (kind === 'bold') document.execCommand('bold', false, null);
  else if (kind === 'italic') document.execCommand('italic', false, null);
  else if (kind === 'list') document.execCommand('insertUnorderedList', false, null);
  else if (kind === 'underline') document.execCommand('underline', false, null);
  else if (kind === 'strike') document.execCommand('strikeThrough', false, null);
  else if (kind === 'ordered-list') document.execCommand('insertOrderedList', false, null);
  else if (kind === 'quote') document.execCommand('formatBlock', false, 'blockquote');
  else if (kind === 'link') insertComposerLink(inp);
  else if (kind === 'code') {
    var selection = window.getSelection();
    var range = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
    if (range && (range.startContainer === inp || inp.contains(range.startContainer))) {
      var code = document.createElement('code');
      code.textContent = range.toString() || 'code';
      range.deleteContents(); range.insertNode(code);
      range.selectNodeContents(code);
      selection.removeAllRanges(); selection.addRange(range);
    } else {
      document.execCommand('insertHTML', false, '<code>code</code>');
    }
  }
  updSend();
}

function insertComposerLink(inp) {
  var selection = window.getSelection();
  var currentRange = selection && selection.rangeCount ? selection.getRangeAt(0) : null;
  var range = currentRange ? currentRange.cloneRange() : null;
  if (!range || (range.startContainer !== inp && !inp.contains(range.startContainer))) return;
  var url = window.prompt('Enter a web address or email link:');
  if (!url) return;
  url = url.trim();
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) url = 'https://' + url;
  var parsed;
  try { parsed = new URL(url); } catch (e) { toast('Enter a valid http, https, or mailto link.'); return; }
  if (['http:', 'https:', 'mailto:'].indexOf(parsed.protocol) === -1) {
    toast('Only http, https, and mailto links are supported.'); return;
  }
  var link = document.createElement('a');
  link.href = parsed.href; link.textContent = range.toString() || url;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  range.deleteContents(); range.insertNode(link); range.selectNodeContents(link);
  selection.removeAllRanges(); selection.addRange(range);
}

function richNodeToMarkdown(node) {
  if (node.nodeType === 3) return node.nodeValue;
  if (node.nodeType !== 1) return '';
  var tag = node.tagName.toLowerCase();
  if (tag === 'br') return '\n';
  var content = Array.prototype.map.call(node.childNodes, richNodeToMarkdown).join('');
  if (tag === 'b' || tag === 'strong') return '**' + content + '**';
  if (tag === 'i' || tag === 'em') return '_' + content + '_';
  if (tag === 'u') return '__' + content + '__';
  if (tag === 's' || tag === 'strike' || tag === 'del') return '~~' + content + '~~';
  if (tag === 'span') {
    if (node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) content = '**' + content + '**';
    if (node.style.fontStyle === 'italic') content = '_' + content + '_';
    var decoration = node.style.textDecorationLine || node.style.textDecoration || '';
    if (decoration.indexOf('underline') !== -1) content = '__' + content + '__';
    if (decoration.indexOf('line-through') !== -1) content = '~~' + content + '~~';
  }
  if (tag === 'code') return '`' + content + '`';
  if (tag === 'a') {
    var href = node.getAttribute('href') || '';
    return /^(https?:|mailto:)/i.test(href) ? '[' + content + '](' + href + ')' : content;
  }
  if (tag === 'ul' || tag === 'ol') {
    return Array.prototype.map.call(node.children, function (item) {
      var index = Array.prototype.indexOf.call(node.children, item);
      return (tag === 'ol' ? (index + 1) + '. ' : '- ') + richNodeToMarkdown(item).trim();
    }).join('\n') + '\n';
  }
  if (tag === 'li') return content;
  if (tag === 'blockquote') {
    return content.split('\n').filter(function (line) { return line !== ''; })
      .map(function (line) { return '> ' + line; }).join('\n') + '\n';
  }
  if (tag === 'div' || tag === 'p') return content + '\n';
  return content;
}

function getComposerText() {
  var inp = G('minp');
  if (!inp) return '';
  return Array.prototype.map.call(inp.childNodes, richNodeToMarkdown).join('')
    .replace(/\n{3,}/g, '\n\n').replace(/\n+$/, '');
}

function handleComposerKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing
    && !window.matchMedia('(max-width: 768px)').matches) {
    event.preventDefault(); sendMsg();
  }
}

function sendMsg() {
  var inp = G('minp'), text = getComposerText().trim();
  if (!text || !ac) return;
  if (ac.type === 'dm' && ac.dmAllowed !== true) {
    if (ac.dmAccessStatus === 'checking') {
      ac.dmSendWhenAllowed = true;
      toast('Checking chat access. Your message will continue once access is confirmed.');
    } else {
      handleDmComposerInput();
    }
    return;
  }
  inp.innerHTML = ''; updSend();
  var payload = {
    text: text, senderUid: me.uid, senderName: myProfile.name || me.displayName || me.email,
    senderPhoto: myProfile.photoURL || me.photoURL || null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), isAI: false
  };
  if (ac.type === 'channel') {
    db.collection('channels').doc(ac.id).collection('messages').add(payload)
      .catch(function (e) { handleErr(e, 'Could not send message.'); });
  } else if (ac.type === 'subgroup') {
    db.collection('channels').doc(ac.channelId).collection('subgroups').doc(ac.subgroupId)
      .collection('messages').add(payload)
      .catch(function (e) { handleErr(e, 'Could not send work group message.'); });
  } else if (ac.type === 'dm') {
    db.collection('conversations').doc(cid(me.uid, ac.uid)).collection('messages').add(payload)
      .catch(function (e) { handleErr(e, 'Could not send DM.'); });
  }
}

function updSend() {
  var has = getComposerText().trim().length > 0;
  G('sndbtn').classList.toggle('off', !has);
}

/* CLEANUP SP/GS (chat page entry point — shared logic in firebase-init.js) */
function cleanupUsersChat() {
  performCleanupSPGS();
}

/* PROFILE EDITING (shared implementation lives in firebase-init.js)
   openProfileModal / closeProfileModal / saveProfile are loaded from firebase-init.js
   so they work identically on both dashboard.html and feed.html. */

document.addEventListener('workspace-role-changed', function (event) {
  if (!me || !event.detail || event.detail.uid !== me.uid) return;
  loadChannels();
  if (ac && ac.type === 'channel') openChannel(ac.id, ac.name, ac.description);
  else if (ac && ac.type === 'dm') openChat(ac.uid, ac.name, ac.color, ac.ini);
});

auth.onAuthStateChanged(function (user) {
  if (user) {
    me = user;
    dmExceptionUids = [];
    dmExceptionConfigLoaded = false;
    dmExceptionConfigPromise = null;
    loadDmAccessExceptions();
    myProfile = {};
    G('dash').style.display = 'flex';
    var uav = G('uav');
    setUserAvatar(uav, {}, user);
    var uname = G('uname');
    if (uname) uname.textContent = user.displayName || user.email;
    var meRef = db.collection('users').doc(user.uid);
    if (meDocUnsub) { try { meDocUnsub(); } catch (e) {} }
    meDocUnsub = meRef.onSnapshot(function (doc) {
      var ud = doc.exists ? (doc.data() || {}) : {};
      myProfile = ud;
      var uavEl = G('uav');
      setUserAvatar(uavEl, ud, user);
      if (ud.name) {
        var unameEl = G('uname');
        if (unameEl) unameEl.textContent = ud.name;
      }
    }, function () {});
    loadChannels();
    loadUsers();
    loadDmRequests();
    ensureUserProfile(user).catch(function (e) {
      console.error('Could not create the signed-in user profile:', e);
      toast('Could not save your user profile: ' + (e.message || e.code || 'unknown error'), 'error');
    });
    syncDmDirectory(user).then(function (result) {
      if (result.created > 0) loadUsers();
    }).catch(function (e) {
      console.error('Could not load registered teammates:', e);
    });
  } else {
    me = null;
    dmExceptionUids = [];
    dmExceptionConfigLoaded = false;
    dmExceptionConfigPromise = null;
    if (meDocUnsub) { try { meDocUnsub(); } catch (e) {} }
    if (usersUnsub) { try { usersUnsub(); } catch (e) {} }
    if (dmRequestsUnsub) { try { dmRequestsUnsub(); } catch (e) {} dmRequestsUnsub = null; }
    if (dmRequestUnsub) { try { dmRequestUnsub(); } catch (e) {} dmRequestUnsub = null; }
    dmRequestsCache = [];
    window.location.href = 'index.html';
  }
});
