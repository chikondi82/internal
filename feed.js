var postsCache = [];
var commentsUnsub = {};
var usersCache = [];
var usersUnsub = null;
var meDocUnsub = null;
var TOTAL_USERS = 0;

var DEFAULT_EMOJIS = ['🎉','👏','🏆','💚','🚀','✅','💡','🔥','🙌','😊','👍','💯','❤️','😎','🤝'];

function userIsRemoved(u) {
  return isSPGSUser(u);
}

function avHTML(u, size) {
  size = size || 20;

  /*
   * FIX:
   * Profile pictures are taken from the user's Firestore photoURL.
   * This is the primary avatar source.
   */
  if (u && u.photoURL) {
    return '<img class="i-av"'
      + ' src="' + esc(u.photoURL) + '"'
      + ' alt="' + esc(u.name || 'Profile') + '"'
      + ' style="width:' + size + 'px;height:' + size + 'px;'
      + 'min-width:' + size + 'px;min-height:' + size + 'px;'
      + 'object-fit:cover;border-radius:50%;display:block;flex-shrink:0" />';
  }

  if (u && u.emoji && u.gradient) {
    return '<span class="dm-av"'
      + ' style="background:' + u.gradient + ';'
      + 'width:' + size + 'px;height:' + size + 'px;'
      + 'min-width:' + size + 'px;min-height:' + size + 'px;'
      + 'font-size:' + Math.max(10, Math.floor(size * 0.6)) + 'px;'
      + 'line-height:' + size + 'px;text-align:center;'
      + 'border-radius:50%;display:block;flex-shrink:0">'
      + u.emoji
      + '</span>';
  }

  var c = colFor(u && u.uid || '000');
  var i = inits(u && u.name || (u && u.email) || '?');

  return '<span class="dm-av"'
    + ' style="background:' + c + ';'
    + 'width:' + size + 'px;height:' + size + 'px;'
    + 'min-width:' + size + 'px;min-height:' + size + 'px;'
    + 'font-size:' + Math.max(9, Math.floor(size * 0.48)) + 'px;'
    + 'line-height:' + size + 'px;text-align:center;'
    + 'border-radius:50%;display:block;flex-shrink:0">'
    + i
    + '</span>';
}

function lookupUser(uid, fallbackName, fallbackEmail, fallbackPhotoURL) {
  var u = usersCache.find(function (x) {
    return x.uid === uid;
  });

  if (u) {
    /*
     * FIX:
     * If the cached user exists but somehow does not have photoURL,
     * use the photo stored on the post as a fallback.
     */
    if (!u.photoURL && fallbackPhotoURL) {
      u.photoURL = fallbackPhotoURL;
    }
    return u;
  }

  return {
    uid: uid,
    name: fallbackName || 'Unknown',
    email: fallbackEmail || '',
    photoURL: fallbackPhotoURL || ''
  };
}

function loadUsers() {
  if (usersUnsub) {
    try { usersUnsub(); } catch (e) {}
  }

  usersUnsub = db.collection('users').onSnapshot(function (snap) {
    usersCache = [];
    var count = 0;

    snap.forEach(function (d) {
      var u = d.data();
      u.uid = d.id;

      if (userIsRemoved(u)) return;

      count++;
      usersCache.push(u);
    });

    TOTAL_USERS = count;

    var mc = G('mcount');
    if (mc) mc.textContent = count;

    renderFeed();
    refreshFeedMeCards();

  }, function () {});
}

function refreshFeedMeCards() {
  if (!me) return;

  var meRef = db.collection('users').doc(me.uid);

  meRef.get().then(function (doc) {
    var ud = doc.data() || {};

    var uav = G('uav');
    var pcav = G('pcav');
    var uname = G('uname');

    if (uname) {
      uname.textContent = ud.name || me.displayName || me.email;
    }

    [uav, pcav].forEach(function (av) {
      if (!av) return;

      if (ud.photoURL || me.photoURL) {
        var p = ud.photoURL || me.photoURL;

        av.style.background = '';
        av.style.backgroundImage = 'url("' + p + '")';
        av.style.backgroundSize = 'cover';
        av.style.backgroundPosition = 'center';
        av.textContent = '';

      } else if (ud.emoji && ud.gradient) {

        av.style.background = ud.gradient;
        av.style.backgroundImage = '';
        av.textContent = ud.emoji;

      } else {

        av.style.backgroundImage = '';
        av.style.background = 'linear-gradient(135deg,#25D366,#075e54)';
        av.textContent = inits(ud.name || me.displayName || me.email);
      }
    });

    document.querySelectorAll('[id^="cav-"]').forEach(function (cav) {
      if (!cav) return;

      if (ud.photoURL || me.photoURL) {
        var p2 = ud.photoURL || me.photoURL;

        cav.style.background = '';
        cav.style.backgroundImage = 'url("' + p2 + '")';
        cav.style.backgroundSize = 'cover';
        cav.style.backgroundPosition = 'center';
        cav.textContent = '';

      } else if (ud.emoji && ud.gradient) {

        cav.style.background = ud.gradient;
        cav.style.backgroundImage = '';
        cav.textContent = ud.emoji;

      } else {

        cav.style.backgroundImage = '';
        cav.style.background = 'linear-gradient(135deg,#25D366,#075e54)';
        cav.textContent = inits(ud.name || me.displayName || me.email);
      }
    });

  }).catch(function () {});
}

function go(page) {
  window.location.href = page;
}

function doLogout(e) {
  if (e) e.stopPropagation();

  Object.values(commentsUnsub).forEach(function (u) {
    if (u) u();
  });

  commentsUnsub = {};

  if (usersUnsub) {
    try { usersUnsub(); } catch (err) {}
  }

  if (meDocUnsub) {
    try { meDocUnsub(); } catch (err) {}
  }

  auth.signOut().then(function () {
    toast('Signed out.', 'success');
  }).catch(function (err) {
    toast(err.message);
    window.location.href = 'index.html';
  });
}

/* handleErr is SHARED from firebase-init.js (includes full console.group diagnostics
   + copy rules to clipboard + test permissions action buttons in the toast). */

function loadStats() {
  var p = db.collection('posts').get().then(function (snap) {
    G('pcount').textContent = snap.size;

    var likes = 0;

    snap.forEach(function (d) {
      likes += ((d.data() || {}).likes || []).length;
    });

    G('lcount').textContent = likes;

  }).catch(function (e) {
    G('pcount').textContent = G('lcount').textContent = '—';
    handleErr(e, 'Could not load stats.');
  });

  return Promise.all([p]);
}

function _postsMatchMe(p) {
  if (!me) return false;

  var myEmail = (me.email || '').trim().toLowerCase();
  var pEmail = ((p.authorEmail || '') + '').trim().toLowerCase();

  if (myEmail && pEmail && myEmail === pEmail) return true;

  var myDisplay = ((me.displayName || me.email || '') + '').trim();
  var pName = ((p.authorName || '') + '').trim();

  if (typeof normalizeName === 'function' && pName && myDisplay) {
    var nP = normalizeName(pName).replace(/\s+/g, '');
    var nM = normalizeName(myDisplay).replace(/\s+/g, '');

    if (nP && nM && (nP === nM || nP.indexOf(nM) !== -1 || nM.indexOf(nP) !== -1)) {
      return true;
    }
  }

  var myNameLow = (me.displayName || '').trim().toLowerCase();
  var pNameLow = pName.toLowerCase();

  if (
    myNameLow &&
    pNameLow &&
    myNameLow === pNameLow &&
    myEmail &&
    pEmail &&
    myEmail === pEmail
  ) {
    return true;
  }

  return false;
}

function loadFeed() {
  db.collection('posts').orderBy('createdAt', 'desc').limit(50).onSnapshot(
    function (snap) {
      postsCache = [];
      var toBackfill = [];

      snap.forEach(function (d) {
        var p = d.data();
        p.id = d.id;

        if (me && (!p.authorUid || (p.authorUid !== me.uid && _postsMatchMe(p)))) {
          var matched = false;

          if (!p.authorUid) {
            if (_postsMatchMe(p)) matched = true;
          } else if (p.authorUid !== me.uid && _postsMatchMe(p)) {
            matched = true;
          }

          if (matched) {
            p.authorUid = me.uid;
            toBackfill.push(d.ref);
          }
        }

        postsCache.push(p);
      });

      if (toBackfill.length && me && me.uid) {
        toBackfill.forEach(function (ref) {
          ref.set({
            authorUid: me.uid,
            authorName: me.displayName || me.email,
            authorEmail: me.email || ''
          }, { merge: true }).catch(function (noop) {});
        });
      }

      renderFeed();

    },
    function (e) {
      postsCache = [];
      renderFeed();
      handleErr(e, 'Could not load posts.');
    }
  );
}

function renderFeed() {
  var sinp = G('sinp');
  var q = (sinp ? sinp.value : '').toLowerCase().trim();
  var el = G('feed');

  var list = postsCache.filter(function (p) {
    return !userIsRemoved({ name: p.authorName });
  });

  if (q) {
    list = list.filter(function (p) {
      return (p.text || '').toLowerCase().indexOf(q) > -1
        || (p.authorName || '').toLowerCase().indexOf(q) > -1
        || (p.tag || '').toLowerCase().indexOf(q) > -1;
    });
  }

  if (!list.length) {
    el.innerHTML = '<div class="empty-posts"><div style="font-size:42px;margin-bottom:10px">🌱</div>'
      + '<h3 style="color:#fff;margin-bottom:6px">'
      + (postsCache.length && q ? 'No posts match your search' : 'Nothing here yet')
      + '</h3>'
      + '<p style="color:rgba(255,255,255,0.5);font-size:13px">'
      + (postsCache.length && q ? 'Try a different keyword.' : 'Be the first to share a win with the team!')
      + '</p></div>';

    return;
  }

  el.innerHTML = list.map(function (p) {
    return postHTML(p);
  }).join('');

  list.forEach(function (p) {
    subscribeComments(p.id);
  });
}

var TAG_BADGES = {
  progress:     ['📈', 'Progress', '#34b7f1'],
  win:          ['🏆', 'Win',        '#f59e0b'],
  shoutout:     ['💚', 'Shoutout',   '#25D366'],
  idea:         ['💡', 'Idea',       '#a78bfa'],
  question:     ['❓', 'Question',   '#fb7185'],
  announcement: ['📢', 'Announcement', '#f43f5e']
};

function tagBadgeHTML(tag) {
  var t = TAG_BADGES[tag] || ['📌', 'Post', '#888'];

  return '<span class="tbadge" style="background:rgba('
    + hexToRgb(t[2])
    + ',0.12);border-color:rgba('
    + hexToRgb(t[2])
    + ',0.25);color:'
    + t[2]
    + '">'
    + '<span>' + t[0] + '</span>'
    + t[1]
    + '</span>';
}

function hexToRgb(hex) {
  var h = hex.replace('#', '');

  if (h.length === 3) {
    h = h.split('').map(function (c) {
      return c + c;
    }).join('');
  }

  var n = parseInt(h, 16);

  return [
    (n >> 16) & 255,
    (n >> 8) & 255,
    n & 255
  ].join(',');
}

function timeAgo(ts) {
  if (!ts) return 'just now';

  var s = Math.floor(
    (Date.now() - (ts.toDate ? ts.toDate().getTime() : new Date(ts).getTime())) / 1000
  );

  if (s < 0) s = 0;

  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';

  return Math.floor(s / 86400) + 'd ago';
}

function isMyPost(p) {
  if (!p || !me) return false;

  if (typeof currentUserIsAdmin === 'function' && currentUserIsAdmin()) {
    return true;
  }

  if (p.authorUid && me.uid && p.authorUid === me.uid) return true;

  if (
    p.authorUid &&
    me.uid &&
    String(p.authorUid).toLowerCase() === String(me.uid).toLowerCase()
  ) {
    return true;
  }

  var myEmail = (me.email || '').trim().toLowerCase();
  var pEmail = ((p.authorEmail || '') + '').trim().toLowerCase();

  if (myEmail && pEmail && myEmail === pEmail) return true;

  var pName = ((p.authorName || '') + '').trim();
  var myDisplay = ((me.displayName || me.email || '') + '').trim();

  if (typeof normalizeName === 'function' && pName && myDisplay) {
    var nP = normalizeName(pName).replace(/\s+/g, '');
    var nM = normalizeName(myDisplay).replace(/\s+/g, '');

    if (nP && nM && (nP === nM || nP.indexOf(nM) !== -1 || nM.indexOf(nP) !== -1)) {
      return true;
    }
  }

  var myName = (me.displayName || '').trim().toLowerCase();
  var pNameLow = pName.toLowerCase();

  if (
    myName &&
    pNameLow &&
    myName === pNameLow &&
    myEmail &&
    pEmail &&
    myEmail === pEmail
  ) {
    return true;
  }

  return false;
}

function deletePost(pid) {
  if (!pid) return;

  if (!confirm(
    'Delete this post? This also deletes all its comments and attached media. This CANNOT be undone.'
  )) {
    return;
  }

  if (!db || !me) {
    toast('Sign in to delete posts.');
    return;
  }

  var card = document.getElementById('p-' + pid);

  if (card) {
    card.style.opacity = '0.5';
    card.style.pointerEvents = 'none';
  }

  var postRef = db.collection('posts').doc(pid);

  _deleteCollectionDocsInBatches(postRef.collection('comments'))
    .then(function () {
      return postRef.delete();
    })
    .then(function () {

      if (card && card.parentNode) {
        card.parentNode.removeChild(card);
      }

      if (typeof refreshEmptyFeedHint === 'function') {
        refreshEmptyFeedHint();
      }

      toast('Post deleted.', 'success');

    })
    .catch(function (e) {

      if (card) {
        card.style.opacity = '';
        card.style.pointerEvents = '';
      }

      var code = (e || {}).code || '';
      var msg = (e || {}).message || 'Could not delete post.';

      if (code === 'permission-denied' || /permission|denied/i.test(msg)) {
        toast(
          '🔒 Permission denied — Firestore rules may only let authors delete their own posts. Publish rules in Firebase Console → Rules → Build → Firestore Database.'
        );
      } else if (code === 'not-found' || /not.?found/i.test(msg)) {
        toast('Post was already deleted — refreshing.');
        setTimeout(function () {
          try { location.reload(); } catch (noop) {}
        }, 600);
      } else {
        toast(msg);
      }

      console.error('deletePost error:', e);
    });
}

function postMediaHTML(p) {
  var html = '';

  if (Array.isArray(p.media) && p.media.length) {

    var hasVid = p.media.some(function (m) {
      return m && m.kind === 'video';
    });

    var hasImg = p.media.some(function (m) {
      return m && m.kind !== 'video';
    });

    var w = p.media.length === 1 && hasVid
      ? '100%'
      : hasVid
        ? '100%'
        : 'auto';

    var wrapStyle = hasVid
      ? 'display:flex;flex-direction:column;gap:10px;margin:10px 0 4px'
      : 'display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:10px 0 4px';

    html += '<div style="' + wrapStyle + ';width:' + (hasVid ? '100%' : 'auto') + '">';

    p.media.forEach(function (m) {
      if (!m || !m.url) return;

      if (m.kind === 'video') {

        html += '<video controls preload="metadata" style="width:100%;max-height:420px;border-radius:14px;object-fit:contain;background:#000;display:block" playsinline>'
          + '<source src="' + esc(m.url) + '" />'
          + '</video>';

      } else {

        html += '<img loading="lazy" onclick="window.open(\'' + esc(m.url) + '\',\'_blank\')"'
          + ' src="' + esc(m.url) + '"'
          + ' style="border-radius:14px;object-fit:cover;width:100%;max-height:520px;cursor:zoom-in" />';
      }
    });

    html += '</div>';
  }

  return html;
}

function postHTML(p) {
  var tag = p.tag || 'progress';

  /*
   * FIX:
   * Pass authorPhotoURL from the post as a fallback.
   * This also allows older posts to display their stored profile photo
   * if the users cache has not loaded yet.
   */
  var author = lookupUser(
    p.authorUid,
    p.authorName || 'Unknown',
    p.authorEmail || '',
    p.authorPhotoURL || ''
  );

  var likedMe = (p.likes || []).indexOf(me && me.uid) > -1;
  var clapCount = (p.likes || []).length;
  var cc = p._commentCount || 0;

  var avEl = avHTML(author, 46);

  avEl = avEl.replace(
    'class="dm-av"',
    'class="av pc-av dm-av"'
  );

  avEl = avEl.replace(
    'class="i-av"',
    'class="av pc-av i-av"'
  );

  if (!/class="av/.test(avEl)) {
    avEl = avEl.replace(
      '<img ',
      '<img class="av pc-av" '
    );

    avEl = avEl.replace(
      '<span ',
      '<span class="av pc-av" '
    );
  }

  var delBtn = '';

  if (isMyPost(p)) {
    delBtn =
      '<button type="button" style="background:transparent;border:none;color:rgba(255,255,255,0.55);cursor:pointer;font-size:15px;padding:6px 10px;border-radius:8px;transition:all .15s"'
      + ' title="Delete your post"'
      + ' onclick="deletePost(\'' + p.id + '\')"'
      + ' onmouseover="this.style.color=\'#ef4444\';this.style.background=\'rgba(239,68,68,0.12)\'"'
      + ' onmouseout="this.style.color=\'rgba(255,255,255,0.55)\';this.style.background=\'transparent\'">'
      + '🗑️'
      + '</button>';
  }

  var media = postMediaHTML(p);

  var mentionHTML = '';

  if (Array.isArray(p.mentions) && p.mentions.length) {
    mentionHTML =
      '<div style="margin:2px 0 -2px;font-size:11px;color:#60a5fa">'
      + 'Mentioned: '
      + p.mentions.map(function (x) {
        return '<span style="margin-right:6px">@'
          + esc((x && x.name) || x)
          + '</span>';
      }).join('')
      + '</div>';
  }

  return '<div class="post-card" id="p-' + p.id + '">'
    + '<div class="pc-head">'
    + avEl
    + '<div style="flex:1;min-width:0">'
    + '<div class="pc-name-row">'
    + '<span class="pc-name">'
    + esc(author.name || p.authorName || 'Unknown')
    + '</span>'
    + tagBadgeHTML(tag)
    + delBtn
    + '</div>'
    + '<div class="pc-meta">'
    + (author.email || p.authorEmail || '')
    + ' · '
    + timeAgo(p.createdAt)
    + '</div>'
    + '</div>'
    + '</div>'

    + '<div class="pc-text">'
    + formatPost(p.text || '')
    + '</div>'

    + mentionHTML
    + media

    + '<div class="pc-stats">'
    + (
      clapCount
        ? '<span class="pstat"><span class="pemoji">'
          + (likedMe ? '👏' : '👍')
          + '</span>'
          + clapCount
          + '</span>'
        : ''
    )
    + (
      cc
        ? '<span class="pstat">'
          + cc
          + ' comment'
          + (cc === 1 ? '' : 's')
          + '</span>'
        : ''
    )
    + '</div>'

    + '<div class="pc-actions">'

    + '<button class="pa-btn ' + (likedMe ? 'on' : '') + '" onclick="toggleLike(\'' + p.id + '\')">'
    + (likedMe ? '<span>👏</span> Clapped' : '<span>👏</span> Clap')
    + '</button>'

    + '<button class="pa-btn" onclick="toggleComments(\'' + p.id + '\')">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
    + '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>'
    + '</svg> Comment'
    + '</button>'

    + '<button class="pa-btn" onclick="sharePost(\'' + p.id + '\')">'
    + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
    + '<path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/>'
    + '</svg> Share'
    + '</button>'

    + '</div>'

    + '<div class="cmt-box" id="cmt-' + p.id + '" style="display:none">'

    + '<div class="cmt-list" id="cml-' + p.id + '">'
    + '<div style="color:rgba(255,255,255,0.4);font-size:12px;padding:4px 2px">'
    + 'No comments yet. Be the first!'
    + '</div>'
    + '</div>'

    + '<div class="cmt-row">'
    + '<div class="av cmt-av" id="cav-' + p.id + '"'
    + ' style="width:32px;height:32px;font-size:12px;background:linear-gradient(135deg,#25D366,#075e54)">'
    + '?'
    + '</div>'
    + '<input class="cmt-inp" id="cinp-' + p.id + '"'
    + ' placeholder="Add a comment... (Enter to send)"'
    + ' onkeydown="if(event.key===\'Enter\')addComment(\'' + p.id + '\')"/>'
    + '</div>'

    + '</div>'
    + '</div>';
}

function formatPost(t) {
  var s = esc(t);

  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/\*(.+?)\*/g, '<i>$1</i>');

  s = s.replace(
    /`(.+?)`/g,
    '<code style="background:rgba(255,255,255,0.08);padding:1px 6px;border-radius:5px;font-family:monospace;font-size:12.5px;color:#f0d080">$1</code>'
  );

  s = s.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" style="color:#7dd3fc;text-decoration:underline">$1</a>'
  );

  s = s.replace(
    /(^|\s)(#\w[\w\-]*)/g,
    '$1<span style="color:#a78bfa;font-weight:600">$2</span>'
  );

  s = s.replace(
    /(^|\s)(@\S+)/g,
    '$1<span style="color:#34b7f1;font-weight:600">$2</span>'
  );

  s = s.replace(/\n/g, '<br/>');

  return s;
}

/* ================== COMPOSER TOOLBAR ================== */

function insertAtCursorLocal(text, wrapBefore, wrapAfter) {
  var ta = G('ptext');

  if (!ta) return;

  wrapBefore = wrapBefore || '';
  wrapAfter = wrapAfter === undefined ? '' : wrapAfter;

  var start = ta.selectionStart || 0;
  var end = ta.selectionEnd || 0;
  var val = ta.value;
  var selected = val.substring(start, end);

  var newText =
    val.substring(0, start)
    + wrapBefore
    + selected
    + wrapAfter
    + val.substring(end);

  ta.value = newText;

  var pos = start + wrapBefore.length + selected.length;

  ta.focus();
  ta.selectionStart = ta.selectionEnd = pos;

  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function toolbarEmojiGrid() {
  var ta = G('ptext');

  if (!ta) return;

  var el = document.getElementById('emoji-picker');

  if (el) {
    el.remove();
    return;
  }

  var picker = document.createElement('div');

  picker.id = 'emoji-picker';
  picker.className = 'emoji-picker';

  picker.innerHTML =
    DEFAULT_EMOJIS.map(function (e) {
      return '<button type="button" class="ebtn" data-e="' + e + '">' + e + '</button>';
    }).join('')
    + '<div class="ep-hint">Click an emoji to insert</div>';

  ta.parentElement.appendChild(picker);

  picker.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.ebtn');

    if (btn) {
      insertAtCursorById(
        'ptext',
        btn.getAttribute('data-e'),
        ''
      );

      picker.remove();
    }
  });

  setTimeout(function () {
    var close = function (e) {
      if (
        !picker.contains(e.target) &&
        e.target !== ta.parentElement.querySelector('[title="Emoji"]')
      ) {
        picker.remove();
        document.removeEventListener('click', close);
      }
    };

    document.addEventListener('click', close);
  }, 0);
}

var POST_MEDIA = [];

function renderMediaPreview() {
  var prev = G('pm-prev');
  var body = G('pm-prev-body');

  if (!prev || !body) return;

  if (!POST_MEDIA.length) {
    prev.style.display = 'none';
    body.innerHTML = '';
    return;
  }

  prev.style.display = '';

  body.innerHTML = POST_MEDIA.map(function (m, idx) {
    if (!m) return '';

    var tag = m.kind === 'video'
      ? '<video controls preload="metadata" src="' + esc(m.url || '') + '" style="width:100%;max-height:180px;border-radius:10px;object-fit:contain;background:#000" playsinline></video>'
      : '<img src="' + esc(m.url || '') + '" style="max-width:100%;max-height:180px;border-radius:10px;object-fit:contain" />';

    return '<div style="position:relative;display:inline-block;margin:4px 8px 4px 0;max-width:48%">'
      + tag
      + '<button type="button" onclick="removeAttach(' + idx + ')" style="position:absolute;top:-6px;right:-6px;background:#ef4444;color:#fff;border:none;border-radius:50%;width:22px;height:22px;font-size:12px;cursor:pointer">×</button>'
      + '</div>';
  }).join('');
}

function clearMedia() {
  POST_MEDIA = [];
  renderMediaPreview();

  var f = G('pm-file');

  if (f) f.value = '';
}

function removeAttach(i) {
  POST_MEDIA.splice(i, 1);
  renderMediaPreview();
}

function handlePostFileChange() {
  var inp = G('pm-file');

  if (!inp || !inp.files || !inp.files.length) return;

  toast(
    'Attaching ' + inp.files.length + ' file(s)...',
    'success'
  );

  var btn = G('psend');

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Attaching...';
  }

  var previews = [];

  for (var i = 0; i < inp.files.length; i++) {
    previews.push(inp.files[i]);
  }

  var count = 0;
  var total = previews.length;

  uploadFileByInput(inp, 'posts', function (cur, tot) {
    var tt = G('psend');

    if (tt) {
      tt.textContent = 'Uploading ' + cur + '/' + tot + '...';
    }
  }).then(function (arr) {

    POST_MEDIA = (POST_MEDIA || []).concat(
      arr.filter(Boolean)
    );

    count = total;

    renderMediaPreview();

    toast((arr.length || 0) + ' file(s) attached.');

    var bb = G('psend');

    if (bb) {
      bb.disabled = false;
      bb.textContent = 'Post';
      inp.value = '';
    }

  }).catch(function (err) {

    handleErr(err, 'Could not attach file(s).');

    var bb = G('psend');

    if (bb) {
      bb.disabled = false;
      bb.textContent = 'Post';
      inp.value = '';
    }
  });
}

function extractMentions(text) {
  var out = [];

  if (!text) return out;

  var re = /(^|\s|,|\.)@([a-zA-Z0-9._\-' ]+?)(?=[\s,.;:!?]|$)/g;
  var m;

  while ((m = re.exec(text)) !== null) {

    var nameRaw = (m[2] || '').trim();

    if (!nameRaw) continue;

    var nameLow = nameRaw.toLowerCase();

    var u = (usersCache || []).find(function (x) {
      return (x.name || '').toLowerCase() === nameLow
        || (x.email || '').toLowerCase().split('@')[0] === nameLow
        || normalizeName(x.name) === normalizeName(nameRaw);
    }) || {
      name: nameRaw,
      uid: null,
      email: ''
    };

    out.push({
      name: u.name || nameRaw,
      uid: u.uid || null,
      email: u.email || ''
    });
  }

  var seen = {};

  return out.filter(function (x) {
    var k = (x.name || '').toLowerCase();

    if (seen[k]) return false;

    seen[k] = true;

    return true;
  });
}

function showMentionList(qry) {
  var dd = G('mention-dd');

  if (!dd) return;

  var q = (qry || '').toLowerCase().trim();

  var pool = (usersCache || []).slice().filter(function (u) {
    return u.uid !== (me && me.uid);
  });

  if (q) {
    pool = pool.filter(function (u) {
      var n = normalizeName(u.name || u.email || '');

      return n.indexOf(normalizeName(q)) !== -1
        || (u.email || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  if (!pool.length) {
    dd.style.display = 'none';
    return;
  }

  dd.innerHTML = pool.slice(0, 10).map(function (u) {

    var av = avHTML(u, 26);

    av = av.replace(
      /class="(dm-av|i-av)"/,
      'class="$1" style="flex-shrink:0"'
    );

    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer"'
      + ' onmouseover="this.style.background=\'rgba(255,255,255,0.05)\'"'
      + ' onmouseout="this.style.background=\'transparent\'"'
      + ' onclick="pickMention(\''
      + esc(String(u.uid || (u.name || '')).replace(/'/g, "\\'"))
      + '\',\''
      + esc(String(u.name || '').replace(/'/g, "\\'"))
      + '\')">'
      + av
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:13px;font-weight:600;color:#fff;margin:0">'
      + esc(u.name || u.email || 'Unknown')
      + '</div>'
      + '<div style="font-size:11px;color:rgba(255,255,255,0.4)">'
      + esc(u.email || 'Team member')
      + '</div>'
      + '</div>'
      + '</div>';

  }).join('');

  dd.style.display = '';
}

function hideMentionList() {
  var dd = G('mention-dd');

  if (dd) dd.style.display = 'none';
}

var _mentionStart = -1;

function onFeedInput(ev) {
  var ta = G('ptext');

  if (!ta) return;

  var pos = ta.selectionStart || 0;
  var val = ta.value || '';
  var upTo = val.slice(0, pos);
  var at = upTo.lastIndexOf('@');

  if (
    at !== -1 &&
    (at === 0 || /[\s(,\n:.!?]/.test(upTo.charAt(at - 1)))
  ) {
    var tail = upTo.slice(at + 1);

    if (tail.indexOf(' ') === -1 && tail.length < 32) {
      _mentionStart = at;
      showMentionList(tail);
      return;
    }
  }

  _mentionStart = -1;
  hideMentionList();
}

function pickMention(uid, name) {
  var ta = G('ptext');

  if (!ta) return;

  var pos = ta.selectionStart || 0;
  var val = ta.value || '';

  var at =
    (_mentionStart != null && _mentionStart >= 0)
      ? _mentionStart
      : val.slice(0, pos).lastIndexOf('@');

  if (at === -1) return;

  var before = val.slice(0, at);
  var after = val.slice(pos);
  var insert = '@' + name + ' ';

  ta.value = before + insert + after;

  ta.focus();

  var np = (before + insert).length;

  try {
    ta.setSelectionRange(np, np);
  } catch (err) {}

  _mentionStart = -1;
  hideMentionList();
}

function toolbarImage() {
  var inp = G('pm-file');

  if (inp) inp.click();
}

function toolbarMention() {
  insertAtCursorById('ptext', '@', ' ');
  showMentionList('');
}

function toolbarHashtag() {
  insertAtCursorById('ptext', '#', '');
}

function publishPost() {
  var t = G('ptext');
  var text = t.value.trim();

  if (!text && !POST_MEDIA.length) {
    toast('Write something or attach media before posting.');
    return;
  }

  var tag = G('ptag').value;
  var btn = G('psend');

  btn.disabled = true;
  btn.textContent = 'Publishing...';

  var mentions = extractMentions(text || '');

  var mediaToSave = (POST_MEDIA || []).map(function (m) {
    return {
      url: m.url,
      kind: m.kind,
      path: m.path || null
    };
  });

  /*
   * FIX:
   * Read the current Firestore user profile before creating the post.
   * This gets the actual custom profile photo stored in users/{uid}.photoURL.
   */
  db.collection('users').doc(me.uid).get()
    .then(function (userDoc) {

      var ud = userDoc.exists ? (userDoc.data() || {}) : {};

      var authorName =
        ud.name ||
        me.displayName ||
        me.email ||
        'Unknown';

      var authorEmail =
        ud.email ||
        me.email ||
        '';

      var authorPhotoURL =
        ud.photoURL ||
        me.photoURL ||
        '';

      return db.collection('posts').add({
        text: text || '',
        tag: tag,

        authorUid: me.uid,
        authorName: authorName,
        authorEmail: authorEmail,

        /*
         * FIX:
         * Store the profile photo directly on the post as well.
         */
        authorPhotoURL: authorPhotoURL,

        likes: [],
        commentCount: 0,
        mentions: mentions,
        media: mediaToSave,

        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function () {

      t.value = '';
      POST_MEDIA = [];

      renderMediaPreview();

      btn.disabled = false;
      btn.textContent = 'Post';

      toast('Post shared! 🎉', 'success');

      hideMentionList();

    })
    .catch(function (e) {

      handleErr(e, 'Could not publish post.');

      btn.disabled = false;
      btn.textContent = 'Post';
    });
}

function toggleLike(pid) {
  var ref = db.collection('posts').doc(pid);

  ref.get().then(function (d) {
    if (!d.exists) return;

    var p = d.data();
    var likes = p.likes || [];

    var i = likes.indexOf(me.uid);

    if (i > -1) {
      likes.splice(i, 1);
    } else {
      likes.push(me.uid);
    }

    return ref.update({
      likes: likes
    });

  }).catch(function (e) {
    handleErr(e, 'Could not update clap.');
  });
}

function toggleComments(pid) {
  var box = G('cmt-' + pid);

  box.style.display =
    box.style.display === 'none'
      ? ''
      : 'none';

  if (box.style.display !== 'none') {

    var av = G('cav-' + pid);

    if (av && me) {

      db.collection('users').doc(me.uid).get().then(function (doc) {

        var ud = doc.data() || {};

        if (ud.photoURL || me.photoURL) {

          var p = ud.photoURL || me.photoURL;

          av.style.background = '';
          av.style.backgroundImage = 'url("' + p + '")';
          av.style.backgroundSize = 'cover';
          av.style.backgroundPosition = 'center';
          av.textContent = '';

        } else if (ud.emoji && ud.gradient) {

          av.style.background = ud.gradient;
          av.style.backgroundImage = '';
          av.textContent = ud.emoji;

        } else {

          av.style.backgroundImage = '';
          av.style.background = 'linear-gradient(135deg,#25D366,#075e54)';
          av.textContent = inits(
            ud.name ||
            me.displayName ||
            me.email
          );
        }

      }).catch(function () {

        av.textContent = inits(
          me.displayName ||
          me.email
        );
      });
    }

    var inp = G('cinp-' + pid);

    if (inp) {
      setTimeout(function () {
        inp.focus();
      }, 80);
    }
  }
}

function addComment(pid) {
  var inp = G('cinp-' + pid);
  var text = (inp.value || '').trim();

  if (!text) return;

  inp.value = '';

  db.collection('posts')
    .doc(pid)
    .collection('comments')
    .add({
      text: text,
      authorUid: me.uid,
      authorName: me.displayName || me.email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    })
    .catch(function (e) {
      handleErr(e, 'Could not add comment.');
    });
}

function subscribeComments(pid) {
  if (commentsUnsub[pid]) {
    commentsUnsub[pid]();
  }

  commentsUnsub[pid] = db.collection('posts')
    .doc(pid)
    .collection('comments')
    .orderBy('createdAt', 'asc')
    .onSnapshot(
      function (snap) {

        var post = postsCache.find(function (p) {
          return p.id === pid;
        });

        if (post) {
          post._commentCount = snap.size;
        }

        var list = [];

        snap.forEach(function (d) {
          list.push(d.data());
        });

        renderComments(pid, list);
        updatePCount(pid, snap.size);
      },
      function (e) {
        /* silently ignore permission errors per comment thread */
      }
    );
}

function updatePCount(pid, n) {
  var card = G('p-' + pid);

  if (!card) return;

  var stats = card.querySelector('.pc-stats');

  var likeCount = 0;
  var likedMe = false;

  var post = postsCache.find(function (p) {
    return p.id === pid;
  });

  if (post) {
    likeCount = (post.likes || []).length;
    likedMe = (post.likes || []).indexOf(me && me.uid) > -1;
  }

  var html = '';

  if (likeCount) {
    html += '<span class="pstat"><span class="pemoji">'
      + (likedMe ? '👏' : '👍')
      + '</span>'
      + likeCount
      + '</span>';
  }

  if (n) {
    html += '<span class="pstat">'
      + n
      + ' comment'
      + (n === 1 ? '' : 's')
      + '</span>';
  }

  if (stats) {
    stats.innerHTML = html;
  }
}

function renderComments(pid, list) {
  var el = G('cml-' + pid);

  if (!el) return;

  var filtered = list.filter(function (c) {
    return !userIsRemoved({
      name: c.authorName
    });
  });

  if (!filtered.length) {
    el.innerHTML =
      '<div style="color:rgba(255,255,255,0.4);font-size:12px;padding:4px 2px">'
      + 'No comments yet. Be the first!'
      + '</div>';

    return;
  }

  el.innerHTML = filtered.map(function (c) {

    var author = lookupUser(
      c.authorUid,
      c.authorName || 'Unknown',
      ''
    );

    var avEl = avHTML(author, 28);

    avEl = avEl.replace(
      'class="dm-av"',
      'class="av cmt-av dm-av"'
    );

    avEl = avEl.replace(
      'class="i-av"',
      'class="av cmt-av i-av"'
    );

    if (!/class="av/.test(avEl)) {
      avEl = avEl.replace(
        '<img ',
        '<img class="av cmt-av" '
      );

      avEl = avEl.replace(
        '<span ',
        '<span class="av cmt-av" '
      );
    }

    return '<div class="cmt-item">'
      + avEl
      + '<div class="cmt-body">'
      + '<div class="cmt-head">'
      + '<span class="cmt-name">'
      + esc(author.name || c.authorName || 'Unknown')
      + '</span>'
      + '<span class="cmt-time">'
      + timeAgo(c.createdAt)
      + '</span>'
      + '</div>'
      + '<div class="cmt-text">'
      + formatPost(c.text || '')
      + '</div>'
      + '</div>'
      + '</div>';

  }).join('');
}

function sharePost(pid) {
  var link =
    (window.location.origin + window.location.pathname)
    + '#p-' + pid;

  var ok = function () {
    toast(
      'Post link copied to clipboard!',
      'success'
    );
  };

  var fail = function () {
    toast('Copy this link: ' + link);
  };

  if (
    navigator.clipboard &&
    navigator.clipboard.writeText
  ) {

    navigator.clipboard.writeText(link)
      .then(ok)
      .catch(function () {

        var t = document.createElement('textarea');

        t.value = link;
        t.style.position = 'fixed';
        t.style.left = '-9999px';

        document.body.appendChild(t);

        t.select();

        try {
          document.execCommand('copy');
          ok();
        } catch (e) {
          fail();
        }

        document.body.removeChild(t);
      });

  } else {

    var t2 = document.createElement('textarea');

    t2.value = link;
    t2.style.position = 'fixed';
    t2.style.left = '-9999px';

    document.body.appendChild(t2);

    t2.select();

    try {
      document.execCommand('copy');
      ok();
    } catch (e) {
      fail();
    }

    document.body.removeChild(t2);
  }
}

auth.onAuthStateChanged(function (user) {

  if (user) {

    me = user;

    G('dash').style.display = 'flex';

    var uav = G('uav');
    var pcav = G('pcav');

    if (uav) {

      if (user.photoURL) {

        uav.style.backgroundImage =
          'url("' + user.photoURL + '")';

        uav.style.backgroundSize = 'cover';
        uav.style.backgroundPosition = 'center';
        uav.style.background = '';
        uav.textContent = '';

      } else {

        uav.textContent =
          inits(user.displayName || user.email);
      }
    }

    if (pcav) {

      if (user.photoURL) {

        pcav.style.backgroundImage =
          'url("' + user.photoURL + '")';

        pcav.style.backgroundSize = 'cover';
        pcav.style.backgroundPosition = 'center';
        pcav.style.background = '';
        pcav.textContent = '';

      } else {

        pcav.textContent =
          inits(user.displayName || user.email);
      }
    }

    G('uname').textContent =
      user.displayName || user.email;

    var meRef =
      db.collection('users').doc(user.uid);

    if (meDocUnsub) {
      try { meDocUnsub(); } catch (e) {}
    }

    meDocUnsub = meRef.onSnapshot(
      function (doc) {

        var ud =
          doc.exists
            ? (doc.data() || {})
            : {};

        var uavEl = G('uav');
        var pcavEl = G('pcav');
        var unameEl = G('uname');

        if (unameEl) {
          unameEl.textContent =
            ud.name ||
            user.displayName ||
            user.email;
        }

        [uavEl, pcavEl].forEach(function (av) {

          if (!av) return;

          if (ud.photoURL) {

            av.style.background = '';
            av.style.backgroundImage =
              'url("' + ud.photoURL + '")';

            av.style.backgroundSize = 'cover';
            av.style.backgroundPosition = 'center';
            av.textContent = '';

          } else if (ud.emoji && ud.gradient) {

            av.style.background =
              ud.gradient;

            av.style.backgroundImage = '';
            av.textContent = ud.emoji;

          } else {

            av.style.backgroundImage = '';
            av.style.background =
              'linear-gradient(135deg,#25D366,#075e54)';

            av.textContent =
              inits(
                ud.name ||
                user.displayName ||
                user.email
              );
          }
        });

      },
      function () {}
    );

    Object.keys(commentsUnsub).forEach(function (k) {

      if (commentsUnsub[k]) {
        commentsUnsub[k]();
      }
    });

    commentsUnsub = {};

    loadUsers();

    loadStats().then(function () {
      loadFeed();
    });

    var pmFile = G('pm-file');

    if (pmFile && !pmFile._bound) {

      pmFile.addEventListener(
        'change',
        function () {
          handlePostFileChange();
        }
      );

      pmFile._bound = true;
    }

    var ptext = G('ptext');

    if (ptext && !ptext._bound) {

      ptext.addEventListener(
        'input',
        onFeedInput
      );

      ptext.addEventListener(
        'focus',
        function () {
          setTimeout(onFeedInput, 50);
        }
      );

      ptext.addEventListener(
        'keydown',
        function (e) {
          if (e && e.key === 'Escape') {
            hideMentionList();
          }
        }
      );

      ptext._bound = true;
    }

    document.addEventListener(
      'click',
      function (ev) {

        var dd = G('mention-dd');

        if (!dd || dd.style.display === 'none') {
          return;
        }

        var within =
          ev.target.closest &&
          ev.target.closest('#mention-dd')
          ||
          ev.target.id === 'ptext'
          ||
          (
            ev.target.closest &&
            ev.target.closest('.ttip[onclick*="toolbarMention"]')
          );

        if (!within) {
          hideMentionList();
        }
      },
      { passive: true }
    );

  } else {

    me = null;

    Object.values(commentsUnsub).forEach(function (u) {
      if (u) u();
    });

    commentsUnsub = {};

    if (usersUnsub) {
      try { usersUnsub(); } catch (e) {}
    }

    if (meDocUnsub) {
      try { meDocUnsub(); } catch (e) {}
    }

    window.location.href = 'index.html';
  }
});

/* SP & GS cleanup entry point (UI button removed per request).
   Shared logic remains available in firebase-init.js if needed by admin. */

function cleanupUsers() {
  performCleanupSPGS();
}