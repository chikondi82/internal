var ac = null, msgUnsub = null, usersUnsub = null, meDocUnsub = null, usersCache = [], channelsCache = [], myProfile = {};
var TOTAL_USERS = 0;
var SECT_OPEN = { ch: true, dm: true };
var DEFAULT_CHANNELS = [
  { id: 'general', name: 'general', description: 'Company-wide announcements and work-based matters', createdAt: 0 },
  { id: 'random', name: 'random', description: 'Non-work banter, a place for watercooler chat', createdAt: 1 },
  { id: 'announcements', name: 'announcements', description: 'Important company updates from leadership', createdAt: 2 }
];

function isAlwaysPublicChannel(channelId) {
  return ['general', 'random', 'announcements'].indexOf(String(channelId || '').toLowerCase()) !== -1;
}

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
    if (isAlwaysPublicChannel(c.id)) c.visibility = 'public';
    var on = ac && ((ac.type === 'channel' && ac.id === c.id) || (ac.type === 'subgroup' && ac.channelId === c.id)) ? 'on' : '';
    return '<div class="row ' + on + '" id="ch-' + c.id + '" onclick="openChannel(\'' + c.id + '\')">'
      + '<span class="hash">' + (c.visibility === 'private' ? '🔒' : '#') + '</span>'
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
  toggleMobileMenu(false);
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
    G('chstat').textContent = 'Work group'; G('ch-topic').textContent = group.description || '';
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
        snap.forEach(function (d) { addMsg(d.data(), area, 'channel'); });
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
  var updateVisibility = nextVisibility === 'private'
    ? preserveCurrentChannelMembers(c).then(function () {
        return db.collection('channels').doc(cid).update({ visibility: nextVisibility });
      })
    : db.collection('channels').doc(cid).update({ visibility: nextVisibility });
  updateVisibility.then(function () {
    c.visibility = nextVisibility;
    c._reviewing = false;
    renderChannels();
    toast(nextVisibility === 'private' ? 'Channel is now private. New members need admin approval.' : 'Channel is now public.', 'success');
    _realOpenChannel(c.id, c.name, c.description);
  }).catch(function (e) { handleErr(e, 'Could not change channel access.'); })
    .then(function () { if (button) button.disabled = false; });
}

function preserveCurrentChannelMembers(c) {
  var base = db.collection('channels').doc(c.id);
  return Promise.all([
    db.collection('users').get(),
    base.collection('members').get()
  ]).then(function (snaps) {
    var existing = {};
    snaps[1].forEach(function (doc) { existing[doc.id] = true; });
    var toAdd = [];
    snaps[0].forEach(function (doc) {
      if (!userIsRemoved(doc.data()) && !existing[doc.id]) toAdd.push(doc.id);
    });
    var work = Promise.resolve();
    for (var i = 0; i < toAdd.length; i += 450) {
      (function (uids) {
        work = work.then(function () {
          var batch = db.batch();
          uids.forEach(function (uid) {
            batch.set(base.collection('members').doc(uid), {
              uid: uid,
              joinedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          });
          return batch.commit();
        });
      })(toAdd.slice(i, i + 450));
    }
    return work;
  });
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
  chav.style.background = 'linear-gradient(135deg,#075e45,#c9a84c)';
  chav.style.backgroundImage = '';
  G('chname').textContent = c.name;
  G('chstat').innerHTML = '<span class="dot"></span> ' + TOTAL_USERS + ' member' + (TOTAL_USERS === 1 ? '' : 's');
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
  toggleMobileMenu(false);
  var adminBtn = G('ch-admin-btn'); if (adminBtn) adminBtn.style.display = 'none';
  var visibilityBtn = G('ch-visibility-btn'); if (visibilityBtn) visibilityBtn.style.display = 'none';
  var groupsBtn = G('ch-groups-btn'); if (groupsBtn) groupsBtn.style.display = 'none';
  var backBtn = G('ch-group-back-btn'); if (backBtn) backBtn.style.display = 'none';
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
  var groupsBtn = G('ch-groups-btn'); if (groupsBtn) groupsBtn.style.display = 'none';
  var backBtn = G('ch-group-back-btn'); if (backBtn) backBtn.style.display = 'none';
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

function addMsg(data, area, mode) {
  if (userIsRemoved({ name: data.senderName, uid: data.senderUid })) return;
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
  area.appendChild(d);
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
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault(); sendMsg();
  }
}

function sendMsg() {
  var inp = G('minp'), text = getComposerText().trim();
  if (!text || !ac) return;
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
});

auth.onAuthStateChanged(function (user) {
  if (user) {
    me = user;
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
  } else {
    me = null;
    if (meDocUnsub) { try { meDocUnsub(); } catch (e) {} }
    if (usersUnsub) { try { usersUnsub(); } catch (e) {} }
    window.location.href = 'index.html';
  }
});
