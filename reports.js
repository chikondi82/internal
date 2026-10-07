var reportUser = null;
var reportUsers = [];
var reportGroups = [];
var reportAssignments = {};
var reportMyAssignment = null;
var reportFounderUid = '';
var reportsInitialized = false;
var myReportsUnsub = null;
var reviewReportsUnsub = null;
var myAssignmentUnsub = null;
var activeReportPreviewUrl = '';

auth.onAuthStateChanged(function (user) {
  me = user;
  reportUser = user;
  if (!user) { window.location.href = 'index.html'; return; }
  if (!currentUserIsSuperAdmin()) document.addEventListener('workspace-role-changed', onReportRoleChanged);
  initReportsWorkspace();
});

function onReportRoleChanged(event) {
  if (!reportUser || !event.detail || event.detail.uid !== reportUser.uid) return;
  if (currentUserIsAdmin()) {
    G('team-panel').style.display = '';
    var alreadyInitialized = reportsInitialized;
    initReportsWorkspace();
    if (alreadyInitialized) loadReportWorkspaceData();
  } else {
    G('team-panel').style.display = 'none';
    loadReviewReports();
  }
  G('admins-panel').style.display = currentUserIsSuperAdmin() ? '' : 'none';
}

function initReportsWorkspace() {
  if (reportsInitialized || !reportUser) return;
  reportsInitialized = true;
  G('reports-loading').style.display = 'none';
  G('reports-app').style.display = 'grid';
  if (currentUserIsAdmin()) G('team-panel').style.display = '';
  if (currentUserIsSuperAdmin()) G('admins-panel').style.display = '';
  if (currentUserIsSuperAdmin()) {
    db.collection('workspaceConfig').doc('founder').set({ uid: reportUser.uid, email: reportUser.email || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true })
      .catch(function (e) { console.warn('Founder settings could not be initialized:', e); });
  }
  bindReportForms();
  loadReportWorkspaceData();
  loadMyReports();
  loadReviewReports();
}

function bindReportForms() {
  G('report-form').onsubmit = submitProgressReport;
  G('report-files').onchange = renderSelectedReportFiles;
  G('group-form').onsubmit = createOrgGroup;
  G('admin-form').onsubmit = grantWorkspaceAdmin;
}

function loadReportWorkspaceData() {
  if (myAssignmentUnsub) { myAssignmentUnsub(); myAssignmentUnsub = null; }
  myAssignmentUnsub = db.collection('orgAssignments').doc(reportUser.uid).onSnapshot(function (doc) {
    reportMyAssignment = doc.exists ? doc.data() : null;
    renderReportRoute();
    loadReviewReports();
  }, function (e) { handleErr(e, 'Could not load your reporting line.'); });
  var tasks = [
    db.collection('workspaceConfig').doc('founder').get().then(function (doc) { reportFounderUid = doc.exists ? (doc.data().uid || '') : ''; }),
    db.collection('users').get().then(function (snap) {
      reportUsers = snap.docs.map(function (doc) { var u = doc.data() || {}; u.uid = doc.id; return u; });
      reportUsers.sort(function (a, b) { return reportDisplayName(a).localeCompare(reportDisplayName(b)); });
    }),
    db.collection('orgGroups').orderBy('name').get().then(function (snap) {
      reportGroups = snap.docs.map(function (doc) { var group = doc.data() || {}; group.id = doc.id; return group; });
      renderOrgGroups();
    })
  ];
  if (currentUserIsAdmin()) {
    tasks.push(db.collection('orgAssignments').get().then(function (snap) {
      reportAssignments = {};
      snap.forEach(function (doc) { reportAssignments[doc.id] = doc.data(); });
    }));
  }
  if (currentUserIsSuperAdmin()) {
    tasks.push(db.collection('workspaceAdmins').get().then(function (snap) {
      renderWorkspaceAdmins(snap.docs.map(function (doc) { var role = doc.data() || {}; role.uid = doc.id; return role; }));
    }));
  }
  Promise.all(tasks).then(function () {
    if (currentUserIsSuperAdmin() && !reportFounderUid) {
      reportFounderUid = reportUser.uid;
      db.collection('workspaceConfig').doc('founder').set({ uid: reportUser.uid, email: reportUser.email || '' }, { merge: true }).catch(function () {});
    }
    renderAssignmentList();
    renderAdminUserOptions();
    renderReportRoute();
    loadReviewReports();
  }).catch(function (e) {
    handleErr(e, 'Could not load organization settings.');
  });
}

function reportDisplayName(user) {
  return (user && (user.name || user.displayName || user.email)) || 'Workspace member';
}

function reportAttr(value) {
  return esc(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function reportUserLabel(uid) {
  var user = reportUsers.find(function (item) { return item.uid === uid; });
  return user ? reportDisplayName(user) : (uid === reportFounderUid ? 'Founder' : 'Workspace member');
}

function renderReportRoute() {
  var notice = G('report-notice'), route = G('report-route'), submit = G('report-submit');
  var assignment = reportMyAssignment;
  if (!assignment) {
    route.textContent = 'No reporting line assigned';
    notice.style.display = '';
    notice.textContent = 'An admin needs to assign you to a group and supervisor before you can submit a report.';
    submit.disabled = true;
    return;
  }
  var target = assignment.supervisorUid || reportFounderUid;
  if (!target) {
    route.textContent = 'Supervisor setup needed';
    notice.style.display = '';
    notice.textContent = 'Your Founder account needs to open Reports once to initialize the reporting chain.';
    submit.disabled = true;
    return;
  }
  route.textContent = 'Sends to ' + reportUserLabel(target);
  notice.style.display = 'none';
  submit.disabled = false;
}

function createOrgGroup(event) {
  event.preventDefault();
  if (!currentUserIsAdmin()) return;
  var name = G('group-name').value.trim(), description = G('group-description').value.trim();
  if (!name) return;
  var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);
  db.collection('orgGroups').doc(id).set({ name: name, description: description, createdBy: reportUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), active: true })
    .then(function () { G('group-form').reset(); toast('Group created.', 'success'); loadReportWorkspaceData(); })
    .catch(function (e) { handleErr(e, 'Could not create group.'); });
}

function renderOrgGroups() {
  var target = G('group-list');
  if (!target) return;
  target.innerHTML = reportGroups.length ? reportGroups.map(function (group) {
    return '<div class="org-group-chip"><b>' + esc(group.name || 'Unnamed group') + '</b><span>' + esc(group.description || 'Organization group') + '</span></div>';
  }).join('') : '<div class="report-empty">Create your first group to set up reporting lines.</div>';
}

function renderAssignmentList() {
  var target = G('assignment-list');
  if (!target || !currentUserIsAdmin()) return;
  if (!reportUsers.length || !reportGroups.length) {
    target.innerHTML = '<div class="report-empty">Add members and create at least one group before assigning reporting lines.</div>';
    return;
  }
  target.innerHTML = reportUsers.filter(function (user) {
    return String(user.email || '').toLowerCase() !== 'chikondigahimbare@gmail.com';
  }).map(function (user) {
    var assignment = reportAssignments[user.uid] || {};
    var otherUsers = reportUsers.filter(function (person) { return person.uid !== user.uid; });
    var groups = reportGroups.map(function (group) { return '<option value="' + esc(group.id) + '" ' + (assignment.groupId === group.id ? 'selected' : '') + '>' + esc(group.name) + '</option>'; }).join('');
    var supervisors = '<option value="">Founder (top of chain)</option>' + otherUsers.map(function (person) {
      return '<option value="' + esc(person.uid) + '" ' + (assignment.supervisorUid === person.uid ? 'selected' : '') + '>' + esc(reportDisplayName(person)) + '</option>';
    }).join('');
    return '<div class="assignment-row" data-member="' + esc(user.uid) + '"><div class="assignment-person"><b>' + esc(reportDisplayName(user)) + '</b><span>' + esc(user.email || '') + '</span></div>'
      + '<label>Group<select class="assignment-group"><option value="">Choose group</option>' + groups + '</select></label>'
      + '<label>Class / role<input class="assignment-class" maxlength="60" value="' + reportAttr(assignment.memberClass || '') + '" placeholder="Intern, volunteer, board member…" /></label>'
      + '<label>Direct supervisor<select class="assignment-supervisor">' + supervisors + '</select></label>'
      + '<button class="btn" type="button" onclick="saveOrgAssignment(\'' + esc(user.uid) + '\')">Save</button></div>';
  }).join('');
}

function saveOrgAssignment(uid) {
  if (!currentUserIsAdmin()) return;
  var row = document.querySelector('.assignment-row[data-member="' + uid + '"]');
  var groupId = row.querySelector('.assignment-group').value;
  var supervisorUid = row.querySelector('.assignment-supervisor').value || reportFounderUid;
  var memberClass = row.querySelector('.assignment-class').value.trim();
  if (!groupId || !supervisorUid) { toast('Choose a group and initialize the Founder reporting account first.'); return; }
  if (supervisorUid === uid) { toast('A member cannot be their own supervisor.'); return; }
  var cursor = supervisorUid, seen = {};
  while (cursor) {
    if (cursor === uid) { toast('That supervisor would create a reporting loop. Choose someone else.'); return; }
    if (seen[cursor]) { toast('That supervisor is already in a reporting loop. Correct that reporting line first.'); return; }
    seen[cursor] = true;
    cursor = reportAssignments[cursor] && reportAssignments[cursor].supervisorUid;
  }
  db.collection('orgAssignments').doc(uid).set({ uid: uid, groupId: groupId, memberClass: memberClass,
    supervisorUid: supervisorUid, assignedBy: reportUser.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(function () { toast('Reporting line saved.', 'success'); return db.collection('orgAssignments').get(); })
    .then(function (snap) { reportAssignments = {}; snap.forEach(function (doc) { reportAssignments[doc.id] = doc.data(); }); renderAssignmentList(); if (uid === reportUser.uid) { reportMyAssignment = reportAssignments[uid]; renderReportRoute(); } })
    .catch(function (e) { handleErr(e, 'Could not save reporting line.'); });
}

function renderAdminUserOptions() {
  var select = G('admin-user');
  if (!select || !currentUserIsSuperAdmin()) return;
  select.innerHTML = '<option value="">Choose a workspace member</option>' + reportUsers.filter(function (user) {
    return user.uid !== reportUser.uid;
  }).map(function (user) {
    return '<option value="' + esc(user.uid) + '">' + esc(reportDisplayName(user)) + ' · ' + esc(user.email || '') + '</option>';
  }).join('');
}

function grantWorkspaceAdmin(event) {
  event.preventDefault();
  if (!currentUserIsSuperAdmin()) { toast('Only the Founder Super Admin can grant admin access.'); return; }
  var uid = G('admin-user').value;
  var user = reportUsers.find(function (person) { return person.uid === uid; });
  if (!user) { toast('Choose a member first.'); return; }
  db.collection('workspaceAdmins').doc(uid).set({ uid: uid, email: user.email || '', name: reportDisplayName(user),
    enabled: true, grantedBy: reportUser.uid, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(function () { toast('Workspace admin access granted.', 'success'); G('admin-form').reset(); loadReportWorkspaceData(); })
    .catch(function (e) { handleErr(e, 'Could not grant admin access.'); });
}

function renderWorkspaceAdmins(admins) {
  var target = G('admin-list');
  if (!target) return;
  var active = admins.filter(function (role) { return role.enabled === true; });
  target.innerHTML = active.length ? active.map(function (role) {
    return '<div class="admin-row"><div><b>' + esc(role.name || reportUserLabel(role.uid)) + '</b><span>' + esc(role.email || '') + '</span></div>'
      + '<button class="btn admin-revoke" type="button" onclick="revokeWorkspaceAdmin(\'' + esc(role.uid) + '\')">Remove admin access</button></div>';
  }).join('') : '<div class="report-empty">No delegated workspace admins yet.</div>';
}

function revokeWorkspaceAdmin(uid) {
  if (!currentUserIsSuperAdmin() || uid === reportUser.uid) return;
  if (!confirm('Remove workspace admin access from this member?')) return;
  db.collection('workspaceAdmins').doc(uid).update({ enabled: false, revokedBy: reportUser.uid,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(function () { toast('Admin access removed.', 'success'); loadReportWorkspaceData(); })
    .catch(function (e) { handleErr(e, 'Could not remove admin access.'); });
}

function submitProgressReport(event) {
  event.preventDefault();
  var assignment = reportMyAssignment;
  if (!assignment) { renderReportRoute(); return; }
  var reviewerUid = assignment.supervisorUid || reportFounderUid;
  var group = reportGroups.find(function (item) { return item.id === assignment.groupId; });
  if (!reviewerUid || !group) { toast('Your group or reporting line needs to be set up first.'); return; }
  var button = G('report-submit'); button.disabled = true; button.textContent = 'Uploading…';
  var files = Array.prototype.slice.call(G('report-files').files || []);
  if (files.length > 5) { toast('Attach up to five files to one report.'); button.disabled = false; button.textContent = 'Submit report'; return; }
  var allowedTypes = { 'application/pdf': '.pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx' };
  var invalidFile = files.find(function (file) {
    var extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    return file.size > 20 * 1024 * 1024 || !Object.keys(allowedTypes).some(function (type) { return allowedTypes[type] === extension && (!file.type || file.type === type); });
  });
  if (invalidFile) { toast('Use PDF or DOCX files only. Each file must be 20 MB or smaller.'); button.disabled = false; button.textContent = 'Submit report'; return; }
  var ownProfile = reportUsers.find(function (user) { return user.uid === reportUser.uid; }) || reportUser;
  var payload = {
    authorUid: reportUser.uid, authorName: reportDisplayName(ownProfile),
    authorEmail: reportUser.email || '', groupId: group.id, groupName: group.name,
    memberClass: assignment.memberClass || '', title: G('report-title').value.trim(),
    summary: G('report-summary').value.trim(), achievements: G('report-achievements').value.trim(),
    blockers: G('report-blockers').value.trim(), nextSteps: G('report-next').value.trim(),
    currentReviewerUid: reviewerUid, reviewerUids: [reviewerUid], status: 'submitted',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  var reportRef = db.collection('internReports').doc(), uploadedRefs = [];
  files.reduce(function (chain, file) {
    return chain.then(function (attachments) {
    var safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var path = 'internReports/' + reportUser.uid + '/' + reportRef.id + '/' + Date.now() + '_' + safeName;
    var fileRef = storage.ref(path);
    var extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    var contentType = extension === '.pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    uploadedRefs.push(fileRef);
    return fileRef.put(file, { contentType: contentType }).then(function () {
      attachments.push({ name: file.name, path: path, contentType: contentType, size: file.size });
      return attachments;
    });
    });
  }, Promise.resolve([])).then(function (attachments) {
    payload.attachments = attachments;
    button.textContent = 'Submitting…';
    return reportRef.set(payload);
  }).then(function () {
    G('report-form').reset(); G('report-file-selection').textContent = '';
    toast('Report sent to ' + reportUserLabel(reviewerUid) + '.', 'success'); loadMyReports(); loadReviewReports();
  }).catch(function (e) {
    Promise.all(uploadedRefs.map(function (fileRef) { return fileRef.delete().catch(function () {}); }));
    handleErr(e, 'Could not submit report. Check that your reporting line is active and try again.');
  }).then(function () { button.disabled = false; button.textContent = 'Submit report'; });
}

function renderSelectedReportFiles() {
  var files = Array.prototype.slice.call(G('report-files').files || []);
  G('report-file-selection').textContent = files.length ? files.map(function (file) {
    return file.name + ' · ' + (file.size / (1024 * 1024)).toFixed(1) + ' MB';
  }).join('   ') : '';
}

function loadMyReports() {
  if (myReportsUnsub) { myReportsUnsub(); myReportsUnsub = null; }
  myReportsUnsub = db.collection('internReports').where('authorUid', '==', reportUser.uid).onSnapshot(function (snap) {
    var reports = snap.docs.map(function (doc) { var item = doc.data(); item.id = doc.id; return item; });
    reports.sort(function (a, b) { return reportDateValue(b.createdAt) - reportDateValue(a.createdAt); });
    G('my-reports').innerHTML = reports.length ? reports.map(function (item) { return reportCardHTML(item, false); }).join('') : '<div class="report-empty">You have not submitted a report yet.</div>';
    reports.forEach(loadReportReviews);
  }, function (e) { handleErr(e, 'Could not load your reports.'); });
}

function loadReviewReports() {
  var panel = G('review-panel');
  if (!panel) return;
  if (!currentUserIsAdmin() && !reportMyAssignment) { panel.style.display = 'none'; return; }
  panel.style.display = '';
  if (reviewReportsUnsub) { reviewReportsUnsub(); reviewReportsUnsub = null; }
  var query = currentUserIsAdmin()
    ? db.collection('internReports')
    : db.collection('internReports').where('currentReviewerUid', '==', reportUser.uid);
  reviewReportsUnsub = query.onSnapshot(function (snap) {
    var reports = snap.docs.map(function (doc) { var item = doc.data(); item.id = doc.id; return item; });
    if (!currentUserIsAdmin()) reports = reports.filter(function (item) { return item.currentReviewerUid === reportUser.uid; });
    reports.sort(function (a, b) { return reportDateValue(b.updatedAt || b.createdAt) - reportDateValue(a.updatedAt || a.createdAt); });
    G('review-count').textContent = reports.filter(function (item) { return item.currentReviewerUid === reportUser.uid && item.status !== 'reviewed'; }).length + ' waiting';
    G('review-reports').innerHTML = reports.length ? reports.map(function (item) { return reportCardHTML(item, item.currentReviewerUid === reportUser.uid); }).join('') : '<div class="report-empty">No reports are waiting for you.</div>';
    reports.forEach(loadReportReviews);
  }, function (e) { handleErr(e, 'Could not load reports for review.'); });
}

function reportDateValue(value) {
  if (!value) return 0;
  if (value.toDate) return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}

function reportCardHTML(item, canReview) {
  var statusLabel = item.status === 'reviewed' ? 'Reviewed' : (item.status === 'forwarded' ? 'Forwarded' : 'Submitted');
  var textField = function (label, value) { return value ? '<div class="report-detail"><b>' + label + '</b><p>' + esc(value).replace(/\n/g, '<br>') + '</p></div>' : ''; };
  return '<article class="intern-report-card" id="report-' + esc(item.id) + '"><div class="intern-report-head"><div><span class="report-status status-' + esc(item.status) + '">' + statusLabel + '</span>'
    + '<h3>' + esc(item.title || 'Progress report') + '</h3><p>' + esc(item.authorName || reportUserLabel(item.authorUid)) + ' · ' + esc(item.memberClass || item.groupName || 'Team member') + '</p></div><span class="report-group-label">' + esc(item.groupName || 'Group') + '</span></div>'
    + '<div class="report-details">' + textField('Work completed', item.summary) + textField('Achievements', item.achievements) + textField('Challenges / support needed', item.blockers) + textField('Next steps', item.nextSteps) + '</div>'
    + reportAttachmentsHTML(item)
    + '<div class="report-review-history" id="reviews-' + esc(item.id) + '"></div>'
    + (canReview ? '<div class="report-review-form"><label>Evaluation feedback<textarea id="feedback-' + esc(item.id) + '" rows="3" maxlength="2000" placeholder="Give clear, helpful feedback"></textarea></label><label>Rating<select id="rating-' + esc(item.id) + '"><option value="">Optional</option><option value="1">1 — Needs support</option><option value="2">2 — Developing</option><option value="3">3 — On track</option><option value="4">4 — Strong</option><option value="5">5 — Excellent</option></select></label><div class="report-review-actions"><button class="btn report-forward" type="button" onclick="reviewInternReport(\'' + esc(item.id) + '\',true)">Forward up chain</button><button class="btn" type="button" onclick="reviewInternReport(\'' + esc(item.id) + '\',false)">Complete review</button></div></div>' : '')
    + '</article>';
}

function reportAttachmentsHTML(item) {
  var attachments = Array.isArray(item.attachments) ? item.attachments : [];
  if (!attachments.length) return '';
  return '<div class="report-attachments"><b>Supporting documents</b><div>' + attachments.map(function (file, index) {
    var kind = file.contentType === 'application/pdf' ? 'PDF' : 'Word';
    return '<button class="report-attachment" type="button" onclick="previewReportAttachment(\'' + esc(item.id) + '\',' + index + ')"><span aria-hidden="true">' + (kind === 'PDF' ? '▤' : '▧') + '</span><span>' + esc(file.name) + '<small>' + kind + ' · ' + (Number(file.size || 0) / (1024 * 1024)).toFixed(1) + ' MB</small></span><b>View</b></button>';
  }).join('') + '</div></div>';
}

function previewReportAttachment(reportId, index) {
  var dialog = G('report-viewer'), content = G('report-viewer-content');
  content.innerHTML = '<div class="report-loading">Loading secure document preview…</div>';
  G('report-viewer-title').textContent = 'Loading document…';
  G('report-viewer-type').textContent = '';
  if (!dialog.open) dialog.showModal();
  db.collection('internReports').doc(reportId).get().then(function (doc) {
    if (!doc.exists) throw new Error('This report is no longer available.');
    var attachments = doc.data().attachments || [], file = attachments[index];
    if (!file || !file.path) throw new Error('The attachment could not be found.');
    G('report-viewer-title').textContent = file.name;
    G('report-viewer-type').textContent = file.contentType === 'application/pdf' ? 'PDF document' : 'Word document';
    return storage.ref(file.path).getBlob().then(function (blob) {
      if (activeReportPreviewUrl) URL.revokeObjectURL(activeReportPreviewUrl);
      activeReportPreviewUrl = URL.createObjectURL(blob);
      if (file.contentType === 'application/pdf') {
        content.innerHTML = '<iframe class="report-pdf-preview" title="PDF preview"></iframe>';
        content.querySelector('iframe').src = activeReportPreviewUrl;
        return;
      }
      if (!window.mammoth) throw new Error('Word preview is unavailable right now.');
      return blob.arrayBuffer().then(function (buffer) { return mammoth.convertToHtml({ arrayBuffer: buffer }); }).then(function (result) {
        content.innerHTML = '<article class="report-docx-preview">' + sanitizeDocumentPreview(result.value) + '</article>';
      });
    });
  }).catch(function (e) {
    content.innerHTML = '<div class="report-empty">Could not preview this file. Check your connection or ask an admin to verify access.</div>';
    console.warn('Report attachment preview failed:', e);
  });
}

function sanitizeDocumentPreview(html) {
  var parsed = new DOMParser().parseFromString(html || '', 'text/html');
  var allowed = { P:1, BR:1, STRONG:1, B:1, EM:1, I:1, U:1, UL:1, OL:1, LI:1, H1:1, H2:1, H3:1, H4:1, BLOCKQUOTE:1, TABLE:1, THEAD:1, TBODY:1, TR:1, TD:1, TH:1 };
  function clean(node) {
    Array.prototype.slice.call(node.childNodes).forEach(function (child) {
      if (child.nodeType === 1) {
        if (!allowed[child.tagName]) { child.replaceWith(document.createTextNode(child.textContent || '')); return; }
        Array.prototype.slice.call(child.attributes).forEach(function (attribute) { child.removeAttribute(attribute.name); });
        clean(child);
      } else if (child.nodeType !== 3) child.remove();
    });
    return node.innerHTML;
  }
  return clean(parsed.body);
}

function closeReportViewer() {
  var dialog = G('report-viewer');
  if (dialog.open) dialog.close();
  G('report-viewer-content').innerHTML = '';
  if (activeReportPreviewUrl) { URL.revokeObjectURL(activeReportPreviewUrl); activeReportPreviewUrl = ''; }
}

function loadReportReviews(item) {
  db.collection('internReports').doc(item.id).collection('reviews').orderBy('createdAt', 'asc').get().then(function (snap) {
    var target = G('reviews-' + item.id); if (!target || snap.empty) return;
    target.innerHTML = '<h4>Supervisor feedback</h4>' + snap.docs.map(function (doc) {
      var review = doc.data();
      return '<div class="report-review-entry"><div><b>' + esc(reportUserLabel(review.reviewerUid)) + '</b>'
        + (review.rating ? '<span class="review-rating">Rating ' + esc(review.rating) + '/5</span>' : '')
        + '<small>' + (review.action === 'forwarded' ? 'Forwarded report' : 'Completed review') + '</small></div>'
        + (review.feedback ? '<p>' + esc(review.feedback).replace(/\n/g, '<br>') + '</p>' : '') + '</div>';
    }).join('');
  }).catch(function () {});
}

function reviewInternReport(reportId, forward) {
  var ref = db.collection('internReports').doc(reportId);
  ref.get().then(function (doc) {
    if (!doc.exists) throw new Error('This report is no longer available.');
    var report = doc.data();
    if (report.currentReviewerUid !== reportUser.uid) throw new Error('This report is assigned to another supervisor.');
    var feedback = G('feedback-' + reportId).value.trim();
    var rating = G('rating-' + reportId).value;
    var destinationPromise = forward ? db.collection('orgAssignments').doc(reportUser.uid).get() : Promise.resolve(null);
    return destinationPromise.then(function (assignmentDoc) {
      var destination = assignmentDoc && assignmentDoc.exists ? (assignmentDoc.data().supervisorUid || '') : '';
      if (!destination || destination === reportUser.uid) destination = reportFounderUid;
      if (forward && (!destination || destination === reportUser.uid)) throw new Error('There is no one further up the reporting chain. Complete this review instead.');
      var reviewerUids = (report.reviewerUids || []).slice();
      if (forward && reviewerUids.indexOf(destination) !== -1) throw new Error('This reporting line loops back to an earlier reviewer. Ask an admin to correct the reporting line.');
      if (forward) reviewerUids.push(destination);
      var action = forward ? 'forwarded' : 'reviewed';
      var batch = db.batch();
      batch.set(ref.collection('reviews').doc(), { reviewerUid: reportUser.uid, action: action,
        feedback: feedback, rating: rating ? Number(rating) : null, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      batch.update(ref, { status: action, currentReviewerUid: forward ? destination : null,
        reviewerUids: reviewerUids, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      return batch.commit();
    });
  }).then(function () {
    toast(forward ? 'Report forwarded to the next supervisor.' : 'Evaluation saved.', 'success');
    loadReviewReports(); loadMyReports();
  }).catch(function (e) { handleErr(e, 'Could not save the evaluation.'); });
}
