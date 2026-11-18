var HR_SUPER_ADMIN_EMAIL = 'chikondigahimbare@gmail.com';
var hrUser = null;
var hrIsSuperAdmin = false;
var hrPeople = [];
var hrWorkspaceUsers = [];
var hrLinkRequests = [];
var hrCases = [];
var hrReports = [];
var hrSelectedCaseId = '';
var hrCaseMessagesUnsub = null;
var hrReportMessagesUnsub = null;
var hrSelectedReportId = '';
var hrSubscriptions = [];
var hrInviteToken = new URLSearchParams(window.location.search).get('invite') || '';
var hrReturnPath = 'hr.html' + window.location.search;

function hrEl(id) { return document.getElementById(id); }

function hrText(tag, text, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text == null ? '' : String(text);
  return node;
}

function hrButton(label, className, onClick) {
  var button = hrText('button', label, 'hr-button ' + (className || ''));
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function hrNotify(message, type) {
  var toast = hrEl('hr-toast');
  toast.textContent = message;
  toast.className = 'hr-toast ' + (type || 'error');
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { toast.style.display = 'none'; }, 6000);
}

function hrShowGate(title, message, actionLabel, action) {
  hrEl('hr-app').hidden = true;
  hrEl('hr-gate').hidden = false;
  hrEl('hr-gate-title').textContent = title;
  hrEl('hr-gate-message').textContent = message;
  var button = hrEl('hr-gate-action');
  button.hidden = !actionLabel;
  button.textContent = actionLabel || '';
  button.onclick = action || null;
}

function hrApi(path, body) {
  return hrUser.getIdToken(true).then(function (token) {
    return fetch('/api/hr/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }).then(function (response) {
    return response.text().then(function (text) {
      var result = {};
      try { result = text ? JSON.parse(text) : {}; }
      catch (_) { throw new Error('The HR service returned an invalid response (HTTP ' + response.status + ').'); }
      if (!response.ok) throw new Error(result.error || 'The HR request failed.');
      return result;
    });
  });
}

function hrNotifyLinkedPerson(employeeId, entityType, entityId, title, body) {
  return hrApi('notifications/send', {
    employeeId: employeeId,
    entityType: entityType,
    entityId: entityId,
    title: title,
    body: body
  }).then(function (result) {
    if (result.notified === false) {
      throw new Error('The employee record is no longer linked to a workspace account.');
    }
  }).catch(function (error) {
    var notificationError = new Error('The HR change was saved, but its worker notification could not be delivered. ' + (error && error.message || ''));
    notificationError.hrNotificationFailed = true;
    throw notificationError;
  });
}

function hrRecordAudit(action, entityType, entityId) {
  return db.collection('hrAuditLogs').add({
    actorUid: hrUser.uid,
    actorEmail: hrUser.email || '',
    action: action,
    entityType: entityType,
    entityId: entityId,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).catch(function (error) {
    console.warn('HR audit entry could not be recorded:', error && error.code || error);
  });
}

function hrStopListeners() {
  hrSubscriptions.forEach(function (unsubscribe) { try { unsubscribe(); } catch (_) {} });
  hrSubscriptions = [];
  if (hrCaseMessagesUnsub) { hrCaseMessagesUnsub(); hrCaseMessagesUnsub = null; }
  if (hrReportMessagesUnsub) { hrReportMessagesUnsub(); hrReportMessagesUnsub = null; }
}

function hrSignOut() {
  hrStopListeners();
  auth.signOut().then(function () { window.location.href = 'index.html'; });
}

function hrHandleAuth(user) {
  hrUser = user || null;
  if (!user) {
    if (hrInviteToken) {
      try { sessionStorage.setItem('hr-return-to', hrReturnPath); } catch (_) {}
      hrShowGate('Sign in to continue', 'Sign in or create an account with the exact email address invited by the super admin. The invitation is not access by itself.', 'Sign in', function () { window.location.href = 'index.html'; });
    } else {
      try { sessionStorage.setItem('hr-return-to', hrReturnPath); } catch (_) {}
      hrShowGate('Sign in to HR', 'This private HR workspace is available only to accounts with approved HR access.', 'Sign in', function () { window.location.href = 'index.html'; });
    }
    return;
  }

  hrIsSuperAdmin = String(user.email || '').toLowerCase() === HR_SUPER_ADMIN_EMAIL;
  if (hrIsSuperAdmin) {
    if (hrInviteToken) window.history.replaceState({}, '', 'hr.html');
    hrStartApp();
    return;
  }

  db.collection('hrAccess').doc(user.uid).get().then(function (role) {
    if (role.exists && role.data().enabled === true) {
      if (hrInviteToken) window.history.replaceState({}, '', 'hr.html');
      hrStartApp();
      return;
    }
    if (!hrInviteToken) {
      hrShowGate('HR access required', 'This account has not been approved for the HR workspace. Ask the super admin for an invitation link.');
      return;
    }
    if (user.emailVerified !== true) {
      hrShowEmailVerification(user);
      return;
    }
    hrAcceptInvitation();
  }).catch(function (error) {
    console.error('HR role check failed:', error && error.code || error);
    hrShowGate('Could not check HR access', 'Refresh the page or ask the super admin to check the HR service configuration.');
  });
}

function hrShowEmailVerification(user) {
  hrShowGate('Verify your email first', 'To accept this HR invitation, verify the invited email address before continuing.', 'Send verification email', function () {
    user.sendEmailVerification().then(function () {
      hrShowGate('Check your email', 'Open the verification link, then return here to continue.', 'I verified', function () {
        hrRefreshVerification(user);
      });
    }).catch(function () { hrNotify('Could not send the verification email. Try again later.'); });
  });
}

function hrRefreshVerification(user) {
  user.reload().then(function () {
    if (!auth.currentUser || auth.currentUser.emailVerified !== true) {
      hrShowGate('Email is not verified yet', 'Open the verification link, then return and check again.', 'Check again', function () { hrRefreshVerification(auth.currentUser || user); });
      return;
    }
    hrUser = auth.currentUser;
    hrAcceptInvitation();
  }).catch(function () { hrNotify('Could not refresh your verification status. Refresh the page and try again.'); });
}

function hrAcceptInvitation() {
  hrShowGate('Accepting invitation', 'Confirming the invitation and assigning the HR role.');
  hrApi('invites/accept', { token: hrInviteToken }).then(function () {
    hrInviteToken = '';
    window.history.replaceState({}, '', 'hr.html');
    hrStartApp();
  }).catch(function (error) {
    hrShowGate('Invitation not accepted', error.message || 'Check the invitation and signed-in email address.');
  });
}

function hrStartApp() {
  hrStopListeners();
  hrEl('hr-gate').hidden = true;
  hrEl('hr-app').hidden = false;
  hrEl('hr-current-user').textContent = hrUser.displayName || hrUser.email || '';
  hrEl('hr-access-nav').hidden = !hrIsSuperAdmin;
  if (!hrIsSuperAdmin) {
    hrSubscriptions.push(db.collection('hrAccess').doc(hrUser.uid).onSnapshot(function (role) {
      if (!role.exists || role.data().enabled !== true) {
        hrStopListeners();
        auth.signOut().then(function () {
          hrShowGate('HR access revoked', 'The super admin removed HR access from this account.');
        });
      }
    }, function () {
      hrStopListeners();
      auth.signOut();
    }));
  }
  document.querySelectorAll('[data-hr-view]').forEach(function (button) {
    button.onclick = function () {
      var reportMode = button.getAttribute('data-hr-report-mode');
      hrSelectView(button.getAttribute('data-hr-view'), reportMode);
      if (reportMode) hrSetReportMode(reportMode);
    };
  });
  document.querySelectorAll('[data-go-view]').forEach(function (button) {
    button.onclick = function () { hrSelectView(button.getAttribute('data-go-view')); };
  });
  hrEl('hr-employee-form').onsubmit = hrAddEmployee;
  hrEl('hr-onboarding-form').onsubmit = hrAddOnboarding;
  hrEl('hr-leave-form').onsubmit = hrAddLeave;
  hrEl('hr-policy-form').onsubmit = hrAddPolicy;
  hrEl('hr-employee-search').oninput = hrRenderEmployees;
  hrEl('hr-invite-form').onsubmit = hrCreateInvite;
  hrEl('hr-case-reply-form').onsubmit = hrReplyToCase;
  hrEl('hr-report-form').onsubmit = hrSubmitReport;
  hrEl('hr-help-request-form').onsubmit = hrSubmitHelpRequest;
  hrEl('hr-report-reply-form').onsubmit = hrReplyToReport;
  hrSetDefaultReportWeek();
  hrLoadData();
  if (hrIsSuperAdmin) hrLoadAccess();
}

function hrSelectView(view, reportMode) {
  if (view === 'reports') reportMode = reportMode || 'weekly';
  document.querySelectorAll('.hr-view').forEach(function (panel) {
    panel.classList.toggle('active', panel.id === 'hr-view-' + view);
  });
  document.querySelectorAll('.hr-nav [data-hr-view]').forEach(function (button) {
    button.classList.toggle('active', button.getAttribute('data-hr-view') === view
      && (!button.hasAttribute('data-hr-report-mode') || button.getAttribute('data-hr-report-mode') === reportMode));
  });
}

function hrSetReportMode(mode) {
  var isHelp = mode === 'help';
  hrEl('hr-weekly-report-panel').hidden = isHelp;
  hrEl('hr-help-request-panel').hidden = !isHelp;
  hrEl('hr-leadership-title').textContent = isHelp ? 'Ask for help' : 'HR weekly reports';
  hrEl('hr-leadership-description').textContent = isHelp
    ? 'Start a private discussion with the Super Admin and authorized HR staff. Your request and replies stay in HR leadership.'
    : 'Share progress, priorities, and challenges with HR leadership. Visible only to authorized HR staff and the Super Admin.';
  if (isHelp) hrEl('hr-help-request-subject').focus();
}

function hrLoadData() {
  var notificationsPrimed = false;
  hrSubscriptions.push(db.collection('hrNotifications').doc(hrUser.uid).collection('items')
    .where('isRead', '==', false).onSnapshot(function (snapshot) {
      if (notificationsPrimed) {
        snapshot.docChanges().forEach(function (change) {
          var notification = change.doc.data() || {};
          if (change.type === 'added' && notification.entityType === 'hr-admin-report') {
            hrNotify((notification.title || 'HR leadership update') + ': ' + (notification.body || 'Open HR weekly reports to review and reply.'), 'success');
          }
        });
      }
      notificationsPrimed = true;
    }, hrDataError));
  hrSubscriptions.push(db.collection('users').orderBy('name').onSnapshot(function (snapshot) {
    hrWorkspaceUsers = snapshot.docs.map(function (doc) {
      var user = doc.data() || {};
      return { uid: doc.id, name: user.name || user.email || doc.id, email: user.email || '' };
    });
    hrRenderAccountOptions();
    hrRenderEmployees();
    hrRenderLinkRequests();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrEmployees').orderBy('name').onSnapshot(function (snapshot) {
    hrPeople = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
    hrRenderEmployees();
    hrRenderPersonSelects();
    hrRenderLinkRequests();
    hrUpdateStats();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrOnboarding').orderBy('createdAt', 'desc').onSnapshot(function (snapshot) {
    hrRenderOnboarding(snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }));
    hrUpdateStats();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrLeaveRequests').orderBy('createdAt', 'desc').onSnapshot(function (snapshot) {
    hrRenderLeave(snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }));
    hrUpdateStats();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrPolicies').orderBy('updatedAt', 'desc').onSnapshot(function (snapshot) {
    hrRenderPolicies(snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); }));
    hrUpdateStats();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrCases').orderBy('updatedAt', 'desc').onSnapshot(function (snapshot) {
    hrCases = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
    hrRenderCases();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrLinkRequests').where('status', '==', 'pending').onSnapshot(function (snapshot) {
    hrLinkRequests = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
    hrRenderLinkRequests();
  }, hrDataError));
  hrSubscriptions.push(db.collection('hrAdminReports').orderBy('updatedAt', 'desc').onSnapshot(function (snapshot) {
    hrReports = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
    hrRenderReports();
  }, hrDataError));
}

function hrRenderLinkRequests() {
  var list = hrEl('hr-link-request-list');
  var count = hrLinkRequests.length;
  hrEl('hr-link-request-summary').textContent = count
    ? count + (count === 1 ? ' request needs review.' : ' requests need review.')
    : 'No pending requests.';
  var badge = hrEl('hr-link-request-count');
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.hidden = count === 0;
  list.replaceChildren();
  if (!count) {
    list.appendChild(hrText('div', 'New My HR access requests will appear here.', 'hr-list-empty'));
    return;
  }
  hrLinkRequests.forEach(function (request) {
    var row = document.createElement('article');
    row.className = 'hr-list-row hr-link-request-row';
    var main = document.createElement('div');
    main.className = 'hr-list-main';
    main.appendChild(hrText('strong', request.requesterName || 'Workspace user'));
    main.appendChild(hrText('small', request.requesterEmail || 'No account email recorded'));
    main.appendChild(hrText('p', request.note || 'No additional note from the requester.', 'hr-link-request-note'));

    var actions = document.createElement('div');
    actions.className = 'hr-link-request-actions';
    var employeeSelect = document.createElement('select');
    employeeSelect.setAttribute('aria-label', 'Employee record to link to ' + (request.requesterName || request.requesterEmail || 'requester'));
    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Choose matching employee record';
    employeeSelect.appendChild(placeholder);
    hrPeople.filter(function (person) { return !person.userUid && person.status === 'active'; }).forEach(function (person) {
      var option = document.createElement('option');
      option.value = person.id;
      option.textContent = (person.name || 'Unnamed person') + (person.email ? ' · ' + person.email : '');
      employeeSelect.appendChild(option);
    });
    var reviewReason = document.createElement('input');
    reviewReason.type = 'text';
    reviewReason.maxLength = 500;
    reviewReason.setAttribute('aria-label', 'Optional review note');
    reviewReason.placeholder = 'Optional note, required if rejecting';
    var approve = hrButton('Approve and link', '', function () {
      if (!employeeSelect.value) {
        hrNotify('Choose the verified matching employee record before approving.');
        employeeSelect.focus();
        return;
      }
      hrReviewLinkRequest(request, 'approve', employeeSelect.value, reviewReason.value);
    });
    approve.disabled = employeeSelect.options.length < 2;
    var reject = hrButton('Reject request', 'hr-button-quiet', function () {
      if (!reviewReason.value.trim()) {
        hrNotify('Add a brief reason before rejecting this request.');
        reviewReason.focus();
        return;
      }
      hrReviewLinkRequest(request, 'reject', '', reviewReason.value);
    });
    actions.append(employeeSelect, reviewReason, approve, reject);
    row.append(main, actions);
    list.appendChild(row);
  });
}

function hrReviewLinkRequest(request, decision, employeeId, reviewReason) {
  var payload = { decision: decision, reviewReason: String(reviewReason || '').trim() };
  if (employeeId) payload.employeeId = employeeId;
  hrApi('link-requests/' + encodeURIComponent(request.id) + '/review', payload).then(function (result) {
    hrNotify(decision === 'approve'
      ? 'My HR access approved and linked to ' + (result.employeeName || 'the selected employee record') + '.'
      : 'My HR link request rejected. The requester was notified.', 'success');
  }).catch(function (error) {
    hrNotify(error.message || 'Could not review the My HR link request.');
  });
}

function hrSetDefaultReportWeek() {
  var date = new Date();
  date.setDate(date.getDate() - (date.getDay() + 6) % 7);
  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day = String(date.getDate()).padStart(2, '0');
  hrEl('hr-report-week').value = date.getFullYear() + '-' + month + '-' + day;
}

function hrReportStatusLabel(status) {
  return { 'needs-help': 'Needs help', 'in-progress': 'In progress', resolved: 'Resolved' }[status] || 'Needs help';
}

function hrRenderReports() {
  var list = hrEl('hr-report-list');
  list.replaceChildren();
  hrEl('hr-report-count').textContent = hrReports.length + (hrReports.length === 1 ? ' report' : ' reports');
  if (!hrReports.length) list.appendChild(hrText('div', 'Weekly HR reports and follow-ups will appear here.', 'hr-list-empty'));
  hrReports.forEach(function (report) {
    var row = document.createElement('button'); row.type = 'button';
    row.className = 'hr-report-list-row' + (report.id === hrSelectedReportId ? ' active' : '');
    row.onclick = function () { hrOpenReport(report.id); };
    row.appendChild(hrText('strong', report.reportType === 'help-request'
      ? 'Help: ' + (report.subject || 'Support request')
      : 'Week of ' + (report.weekOf || 'Unknown date')));
    var reportSummary = (report.authorName || report.authorEmail || 'HR staff') + ' · ' + hrReportStatusLabel(report.status);
    if (report.reportType === 'help-request') {
      reportSummary += ' · ' + hrHelpCategoryLabel(report.category) + ' · ' + hrHelpPriorityLabel(report.priority);
    }
    row.appendChild(hrText('small', reportSummary));
    row.appendChild(hrText('small', report.reportType === 'help-request'
      ? report.message || 'Private help request'
      : report.challenges || report.accomplishments || 'Weekly update'));
    list.appendChild(row);
  });
  var selected = hrReports.find(function (report) { return report.id === hrSelectedReportId; });
  if (selected) hrUpdateReportHeader(selected);
  else if (hrSelectedReportId) {
    hrSelectedReportId = '';
    if (hrReportMessagesUnsub) { hrReportMessagesUnsub(); hrReportMessagesUnsub = null; }
    hrEl('hr-report-title').textContent = 'Select a weekly report';
    hrEl('hr-report-meta').textContent = 'Private to authorized HR staff and the Super Admin.';
    hrEl('hr-report-status-actions').hidden = true;
    hrEl('hr-report-details').replaceChildren();
    hrEl('hr-report-thread').replaceChildren(hrText('div', 'Choose a report to review its discussion.', 'hr-list-empty'));
    hrEl('hr-report-reply-form').hidden = true;
  }
}

function hrUpdateReportHeader(report) {
  hrEl('hr-report-title').textContent = report.reportType === 'help-request'
    ? 'Help: ' + (report.subject || 'Support request')
    : 'Week of ' + (report.weekOf || 'Unknown date');
  hrEl('hr-report-meta').textContent = (report.authorName || report.authorEmail || 'HR staff')
    + ' · ' + hrReportStatusLabel(report.status)
    + (report.reportType === 'help-request'
      ? ' · ' + hrHelpCategoryLabel(report.category) + ' · ' + hrHelpPriorityLabel(report.priority)
        + (report.neededBy ? ' · Needed by ' + report.neededBy : '')
      : '');
  var actions = hrEl('hr-report-status-actions'); actions.replaceChildren(); actions.hidden = false;
  ['needs-help', 'in-progress', 'resolved'].forEach(function (status) {
    if (status === report.status) return;
    actions.appendChild(hrButton(hrReportStatusLabel(status), 'hr-button-quiet', function () { hrSetReportStatus(report, status); }));
  });
  var details = hrEl('hr-report-details'); details.replaceChildren();
  var sections = report.reportType === 'help-request'
    ? [['Details', report.message], ['Support or decision needed', report.requestedSupport]]
    : [
    ['Progress and accomplishments', report.accomplishments],
    ['Priorities for next week', report.priorities],
    ['Challenges or help needed', report.challenges]
  ];
  sections.forEach(function (section) {
    var block = document.createElement('section'); block.className = 'hr-report-detail';
    block.appendChild(hrText('h3', section[0]));
    block.appendChild(hrText('p', section[1] || '—'));
    details.appendChild(block);
  });
  hrEl('hr-report-reply-form').hidden = false;
}

function hrHelpCategoryLabel(category) {
  return {
    workload: 'Workload',
    staffing: 'Staffing',
    policy: 'Policy',
    'employee-relations': 'Employee relations',
    'system-access': 'System access',
    other: 'Other'
  }[category] || 'Other';
}

function hrHelpPriorityLabel(priority) {
  return { normal: 'Normal priority', high: 'High priority', urgent: 'Urgent' }[priority] || 'Normal priority';
}

function hrOpenReport(reportId) {
  hrSelectedReportId = reportId;
  var report = hrReports.find(function (item) { return item.id === reportId; });
  if (!report) return;
  if (hrReportMessagesUnsub) { hrReportMessagesUnsub(); hrReportMessagesUnsub = null; }
  hrUpdateReportHeader(report);
  hrRenderReports();
  hrEl('hr-report-thread').replaceChildren(hrText('div', 'Loading discussion…', 'hr-list-empty'));
  hrReportMessagesUnsub = db.collection('hrAdminReports').doc(reportId).collection('messages').orderBy('createdAt')
    .onSnapshot(function (snapshot) {
      var thread = hrEl('hr-report-thread'); thread.replaceChildren();
      if (snapshot.empty) thread.appendChild(hrText('div', 'No replies yet. Use this private thread to discuss support and next steps.', 'hr-list-empty'));
      snapshot.docs.forEach(function (doc) {
        var message = doc.data() || {};
        var bubble = document.createElement('article');
        bubble.className = 'hr-message-bubble ' + (message.senderUid === hrUser.uid ? 'from-hr' : 'from-worker');
        var heading = document.createElement('div'); heading.className = 'hr-message-meta';
        heading.append(hrText('strong', message.senderName || message.senderEmail || 'HR team'),
          hrText('time', message.createdAt && message.createdAt.toDate ? message.createdAt.toDate().toLocaleString() : ''));
        bubble.append(heading, hrText('p', message.text || ''));
        thread.appendChild(bubble);
      });
      thread.scrollTop = thread.scrollHeight;
    }, hrDataError);
}

function hrSubmitReport(event) {
  event.preventDefault();
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  var report = {
    weekOf: hrEl('hr-report-week').value,
    status: hrEl('hr-report-status').value,
    accomplishments: hrEl('hr-report-accomplishments').value.trim(),
    priorities: hrEl('hr-report-priorities').value.trim(),
    challenges: hrEl('hr-report-challenges').value.trim()
  };
  submit.disabled = true;
  hrApi('reports', report).then(function (result) {
    event.target.reset();
    hrSetDefaultReportWeek();
    hrEl('hr-report-status').value = 'needs-help';
    hrNotify('Weekly report submitted to the private HR leadership space.', 'success');
    if (result.reportId) {
      hrSelectedReportId = result.reportId;
      if (!hrReports.some(function (item) { return item.id === result.reportId; })) {
        hrReports.unshift(Object.assign({ id: result.reportId, authorName: hrUser.displayName || hrUser.email }, report));
      }
      hrRenderReports();
      hrOpenReport(result.reportId);
    }
  }).catch(function (error) { hrNotify(error.message || 'Could not submit the weekly report.', 'error'); })
    .finally(function () { submit.disabled = false; });
}

function hrSubmitHelpRequest(event) {
  event.preventDefault();
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  var request = {
    reportType: 'help-request',
    weekOf: hrEl('hr-report-week').value,
    status: 'needs-help',
    subject: hrEl('hr-help-request-subject').value.trim(),
    category: hrEl('hr-help-request-category').value,
    priority: hrEl('hr-help-request-priority').value,
    neededBy: hrEl('hr-help-request-needed-by').value,
    message: hrEl('hr-help-request-message').value.trim(),
    requestedSupport: hrEl('hr-help-request-support').value.trim()
  };
  submit.disabled = true;
  hrApi('reports', request).then(function (result) {
    event.target.reset();
    hrNotify('Your private help request was sent to HR leadership.', 'success');
    if (result.reportId) {
      hrSelectedReportId = result.reportId;
      if (!hrReports.some(function (item) { return item.id === result.reportId; })) {
        hrReports.unshift(Object.assign({
          id: result.reportId,
          authorName: hrUser.displayName || hrUser.email
        }, request));
      }
      hrRenderReports();
      hrOpenReport(result.reportId);
    }
  }).catch(function (error) {
    hrNotify(error.message || 'Could not send the private help request.', 'error');
  }).finally(function () { submit.disabled = false; });
}

function hrReplyToReport(event) {
  event.preventDefault();
  if (!hrSelectedReportId) return hrNotify('Select a weekly report first.');
  var message = hrEl('hr-report-reply').value.trim();
  if (!message) return;
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  hrApi('reports/' + encodeURIComponent(hrSelectedReportId) + '/messages', { message: message }).then(function () {
    hrEl('hr-report-reply').value = '';
    hrNotify('Private reply sent.', 'success');
  }).catch(function (error) { hrNotify(error.message || 'Could not send the reply.', 'error'); })
    .finally(function () { submit.disabled = false; });
}

function hrSetReportStatus(report, status) {
  hrApi('reports/' + encodeURIComponent(report.id) + '/status', { status: status }).then(function () {
    hrNotify('Report status updated to ' + hrReportStatusLabel(status) + '.', 'success');
  }).catch(function (error) { hrNotify(error.message || 'Could not update report status.', 'error'); });
}

function hrDataError(error) {
  console.error('HR data request failed:', error && error.code || error);
  hrNotify('Could not load HR data. Confirm your access and Firestore rules.', 'error');
}

function hrUpdateStats() {
  var activePeople = hrPeople.filter(function (person) { return person.status === 'active'; }).length;
  var openTasks = document.querySelectorAll('#hr-onboarding-list [data-task-status="open"]').length;
  var pendingLeave = document.querySelectorAll('#hr-leave-list [data-leave-status="pending"]').length;
  var publishedPolicies = document.querySelectorAll('#hr-policy-list [data-policy-active="true"]').length;
  hrEl('hr-stat-people').textContent = activePeople;
  hrEl('hr-stat-onboarding').textContent = openTasks;
  hrEl('hr-stat-leave').textContent = pendingLeave;
  hrEl('hr-stat-policies').textContent = publishedPolicies;
}

function hrRenderEmployees() {
  var list = hrEl('hr-employee-list');
  var query = String(hrEl('hr-employee-search').value || '').trim().toLowerCase();
  var filtered = hrPeople.filter(function (person) {
    return !query || [person.name, person.email, person.jobTitle, person.department].join(' ').toLowerCase().indexOf(query) !== -1;
  });
  hrEl('hr-employee-count').textContent = hrPeople.length + (hrPeople.length === 1 ? ' person' : ' people');
  list.replaceChildren();
  if (!filtered.length) { list.appendChild(hrText('div', hrPeople.length ? 'No people match that search.' : 'No people have been added yet.', 'hr-list-empty')); return; }
  filtered.forEach(function (person) {
    var row = document.createElement('article'); row.className = 'hr-list-row';
    var main = document.createElement('div'); main.className = 'hr-list-main';
    main.appendChild(hrText('strong', person.name || 'Unnamed person'));
    main.appendChild(hrText('small', [person.jobTitle, person.department, person.email, person.employmentType, person.startDate].filter(Boolean).join(' · ')));
    var actions = document.createElement('div'); actions.className = 'hr-list-actions';
    var account = document.createElement('select'); account.className = 'hr-account-select'; account.setAttribute('aria-label', 'Link workspace account for ' + (person.name || 'employee'));
    var noAccount = document.createElement('option'); noAccount.value = ''; noAccount.textContent = 'Link account'; account.appendChild(noAccount);
    var linkedElsewhere = {};
    hrPeople.forEach(function (item) { if (item.id !== person.id && item.userUid) linkedElsewhere[item.userUid] = true; });
    hrWorkspaceUsers.forEach(function (user) {
      if (linkedElsewhere[user.uid] && user.uid !== person.userUid) return;
      var option = document.createElement('option'); option.value = user.uid;
      option.textContent = user.name + (user.email ? ' · ' + user.email : '');
      if (user.uid === person.userUid) option.selected = true;
      account.appendChild(option);
    });
    account.onchange = function () { hrLinkEmployee(person, account.value); };
    actions.appendChild(account);
    actions.appendChild(hrText('span', person.status === 'active' ? 'Active' : 'Inactive', 'hr-badge ' + (person.status === 'active' ? 'active' : 'inactive')));
    actions.appendChild(hrButton(person.status === 'active' ? 'Deactivate' : 'Reactivate', 'hr-button-quiet', function () { hrToggleEmployee(person); }));
    row.append(main, actions); list.appendChild(row);
  });
}

function hrRenderAccountOptions() {
  var select = hrEl('hr-employee-account'); var selected = select.value;
  select.replaceChildren();
  var none = document.createElement('option'); none.value = ''; none.textContent = 'Not linked yet'; select.appendChild(none);
  var linked = {};
  hrPeople.forEach(function (person) { if (person.userUid) linked[person.userUid] = true; });
  hrWorkspaceUsers.forEach(function (user) {
    if (linked[user.uid]) return;
    var option = document.createElement('option'); option.value = user.uid;
    option.textContent = user.name + (user.email ? ' · ' + user.email : '');
    select.appendChild(option);
  });
  if (hrWorkspaceUsers.some(function (user) { return user.uid === selected; })) select.value = selected;
}

function hrLinkEmployee(person, uid) {
  var linked = hrWorkspaceUsers.find(function (user) { return user.uid === uid; });
  var duplicate = uid && hrPeople.some(function (item) { return item.id !== person.id && item.userUid === uid; });
  if (duplicate) { hrNotify('That workspace account is already linked to another HR record.'); return; }
  db.collection('hrEmployees').doc(person.id).update({
    userUid: uid || firebase.firestore.FieldValue.delete(),
    userEmail: linked ? linked.email : '',
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function () {
    if (linked) return hrNotifyLinkedPerson(person.id, 'employee', person.id, 'Your HR profile is linked', 'Your HR updates and private HR conversations will now appear in My HR.');
    return null;
  }).then(function () { return hrRecordAudit('employee.account-linked', 'employee', person.id); })
    .then(function () { hrNotify(linked ? 'Workspace account linked.' : 'Workspace account unlinked.', 'success'); })
    .catch(hrWriteError);
}

function hrRenderPersonSelects() {
  ['hr-onboarding-person', 'hr-leave-person'].forEach(function (id) {
    var select = hrEl(id); var previous = select.value;
    select.replaceChildren();
    var placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose a person'; select.appendChild(placeholder);
    hrPeople.filter(function (person) { return person.status === 'active'; }).forEach(function (person) {
      var option = document.createElement('option'); option.value = person.id; option.textContent = person.name; select.appendChild(option);
    });
    if (hrPeople.some(function (person) { return person.id === previous && person.status === 'active'; })) select.value = previous;
  });
}

function hrRenderOnboarding(tasks) {
  var list = hrEl('hr-onboarding-list'); list.replaceChildren();
  if (!tasks.length) list.appendChild(hrText('div', 'No onboarding tasks yet.', 'hr-list-empty'));
  tasks.forEach(function (task) {
    var row = document.createElement('article'); row.className = 'hr-list-row'; row.dataset.taskStatus = task.status === 'complete' ? 'complete' : 'open';
    var main = document.createElement('div'); main.className = 'hr-list-main';
    main.appendChild(hrText('strong', task.title));
    main.appendChild(hrText('small', (task.employeeName || 'Unknown person') + (task.dueDate ? ' · Due ' + task.dueDate : '')));
    var actions = document.createElement('div'); actions.className = 'hr-list-actions';
    actions.appendChild(hrText('span', task.status === 'complete' ? 'Complete' : 'Open', 'hr-badge ' + (task.status === 'complete' ? 'active' : 'pending')));
    actions.appendChild(hrButton(task.status === 'complete' ? 'Reopen' : 'Complete', 'hr-button-quiet', function () {
      var nextStatus = task.status === 'complete' ? 'open' : 'complete';
      db.collection('hrOnboarding').doc(task.id).update({ status: nextStatus, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .then(function () { return Promise.all([
          hrRecordAudit('onboarding.updated', 'onboarding', task.id),
          task.employeeUid ? hrNotifyLinkedPerson(task.employeeId, 'onboarding', task.id, 'Onboarding task updated', task.title + ' is now ' + nextStatus + '.') : null
        ]); }).catch(hrWriteError);
    }));
    row.append(main, actions); list.appendChild(row);
  });
}

function hrRenderLeave(requests) {
  var list = hrEl('hr-leave-list'); var overview = hrEl('hr-overview-leave');
  list.replaceChildren(); overview.replaceChildren();
  if (!requests.length) {
    list.appendChild(hrText('div', 'No leave requests recorded yet.', 'hr-list-empty'));
    overview.appendChild(hrText('div', 'No leave requests recorded yet.', 'hr-list-empty'));
    return;
  }
  requests.forEach(function (request) {
    var row = hrMakeLeaveRow(request);
    list.appendChild(row);
  });
  var pending = requests.filter(function (request) { return request.status === 'pending'; }).slice(0, 5);
  if (!pending.length) overview.appendChild(hrText('div', 'There are no pending leave requests.', 'hr-list-empty'));
  pending.forEach(function (request) { overview.appendChild(hrMakeLeaveRow(request)); });
}

function hrMakeLeaveRow(request) {
  var row = document.createElement('article'); row.className = 'hr-list-row'; row.dataset.leaveStatus = request.status;
  var main = document.createElement('div'); main.className = 'hr-list-main';
  main.appendChild(hrText('strong', (request.employeeName || 'Unknown person') + ' · ' + (request.leaveType || 'Leave')));
  main.appendChild(hrText('small', (request.startDate || '') + ' through ' + (request.endDate || '')));
  var actions = document.createElement('div'); actions.className = 'hr-list-actions';
  actions.appendChild(hrText('span', request.status, 'hr-badge ' + (request.status === 'pending' ? 'pending' : request.status === 'approved' ? 'active' : 'inactive')));
  if (request.status === 'pending') {
    actions.appendChild(hrButton('Approve', '', function () { hrReviewLeave(request, 'approved'); }));
    actions.appendChild(hrButton('Decline', 'hr-button-danger', function () { hrReviewLeave(request, 'declined'); }));
  }
  row.append(main, actions); return row;
}

function hrReviewLeave(request, status) {
  db.collection('hrLeaveRequests').doc(request.id).update({ status: status, reviewedBy: hrUser.uid, reviewedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(function () { return Promise.all([
      hrRecordAudit('leave.' + status, 'leave', request.id),
      request.employeeUid ? hrNotifyLinkedPerson(request.employeeId, 'leave', request.id, 'Leave request ' + status, 'Your ' + request.leaveType + ' leave request for ' + request.startDate + ' through ' + request.endDate + ' was ' + status + '.') : null
    ]); })
    .then(function () { hrNotify('Leave request ' + status + '.', 'success'); }).catch(hrWriteError);
}

function hrRenderCases() {
  var list = hrEl('hr-case-list');
  list.replaceChildren();
  hrEl('hr-case-count').textContent = hrCases.length + (hrCases.length === 1 ? ' conversation' : ' conversations');
  if (!hrCases.length) list.appendChild(hrText('div', 'Worker messages will appear here.', 'hr-list-empty'));
  hrCases.forEach(function (item) {
    var row = document.createElement('button'); row.type = 'button'; row.className = 'hr-case-list-row' + (item.id === hrSelectedCaseId ? ' active' : '');
    row.onclick = function () { hrOpenCase(item.id); };
    row.appendChild(hrText('strong', item.subject || 'HR case'));
    row.appendChild(hrText('small', (item.employeeName || 'Worker') + ' · ' + (item.category || 'Other')));
    var footer = document.createElement('span'); footer.className = 'hr-case-list-footer';
    footer.appendChild(hrText('span', item.status || 'open', 'hr-badge ' + (item.status === 'resolved' ? 'active' : item.lastActorRole === 'worker' ? 'pending' : '')));
    if (item.lastActorRole === 'worker') footer.appendChild(hrText('span', 'New reply', 'hr-case-unread'));
    row.appendChild(footer); list.appendChild(row);
  });
  var active = hrCases.find(function (item) { return item.id === hrSelectedCaseId; });
  if (active) hrUpdateCaseHeader(active);
  hrUpdateStats();
}

function hrUpdateCaseHeader(item) {
  hrEl('hr-case-title').textContent = item.subject || 'HR case';
  hrEl('hr-case-meta').textContent = (item.employeeName || 'Worker') + ' · ' + (item.category || 'Other') + ' · ' + (item.status || 'open');
  var actions = hrEl('hr-case-status-actions'); actions.replaceChildren(); actions.hidden = false;
  if (item.status !== 'resolved') {
    actions.appendChild(hrButton('Resolve', 'hr-button-quiet', function () { hrSetCaseStatus(item, 'resolved'); }));
  } else {
    actions.appendChild(hrButton('Reopen', 'hr-button-quiet', function () { hrSetCaseStatus(item, 'open'); }));
  }
  hrEl('hr-case-reply-form').hidden = false;
}

function hrOpenCase(caseId) {
  hrSelectedCaseId = caseId;
  if (hrCaseMessagesUnsub) { hrCaseMessagesUnsub(); hrCaseMessagesUnsub = null; }
  var item = hrCases.find(function (candidate) { return candidate.id === caseId; });
  if (!item) return;
  hrUpdateCaseHeader(item);
  hrRenderCases();
  hrEl('hr-case-thread').replaceChildren(hrText('div', 'Loading conversation…', 'hr-list-empty'));
  hrCaseMessagesUnsub = db.collection('hrCases').doc(caseId).collection('messages').orderBy('createdAt').onSnapshot(function (snapshot) {
    var thread = hrEl('hr-case-thread'); thread.replaceChildren();
    if (snapshot.empty) thread.appendChild(hrText('div', 'No messages yet.', 'hr-list-empty'));
    snapshot.docs.forEach(function (doc) {
      var message = doc.data() || {};
      var bubble = document.createElement('article'); bubble.className = 'hr-message-bubble ' + (message.senderRole === 'hr' ? 'from-hr' : 'from-worker');
      var heading = document.createElement('div'); heading.className = 'hr-message-meta';
      heading.appendChild(hrText('strong', message.senderName || (message.senderRole === 'hr' ? 'HR team' : 'Worker')));
      heading.appendChild(hrText('time', message.createdAt && message.createdAt.toDate ? message.createdAt.toDate().toLocaleString() : ''));
      bubble.append(heading, hrText('p', message.text || ''));
      thread.appendChild(bubble);
    });
    thread.scrollTop = thread.scrollHeight;
  }, hrDataError);
}

function hrReplyToCase(event) {
  event.preventDefault();
  if (!hrSelectedCaseId) return hrNotify('Choose a worker conversation first.');
  var message = hrEl('hr-case-reply').value.trim();
  if (!message) return;
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  hrApi('cases/' + encodeURIComponent(hrSelectedCaseId) + '/messages', { message: message }).then(function () {
    hrEl('hr-case-reply').value = '';
    hrNotify('Reply sent to the worker.', 'success');
  }).catch(function (error) { hrNotify(error.message || 'Could not send the reply.'); })
    .finally(function () { submit.disabled = false; });
}

function hrSetCaseStatus(item, status) {
  hrApi('cases/' + encodeURIComponent(item.id) + '/status', { status: status }).then(function () {
    hrNotify('Worker notified. Case marked ' + status + '.', 'success');
  }).catch(function (error) { hrNotify(error.message || 'Could not update this case.'); });
}

function hrRenderPolicies(policies) {
  var list = hrEl('hr-policy-list'); list.replaceChildren();
  if (!policies.length) { list.appendChild(hrText('div', 'No policies have been added yet.', 'hr-list-empty')); return; }
  policies.forEach(function (policy) {
    var row = document.createElement('article'); row.className = 'hr-list-row'; row.dataset.policyActive = String(policy.published === true);
    var main = document.createElement('div'); main.className = 'hr-list-main';
    main.appendChild(hrText('strong', policy.title || 'Untitled policy'));
    main.appendChild(hrText('small', (policy.category || 'General') + ' · ' + (policy.published ? 'Published' : 'Draft') + (policy.updatedByEmail ? ' · Updated by ' + policy.updatedByEmail : '')));
    var actions = document.createElement('div'); actions.className = 'hr-list-actions';
    actions.appendChild(hrText('span', policy.published ? 'Published' : 'Draft', 'hr-badge ' + (policy.published ? 'active' : 'inactive')));
    actions.appendChild(hrButton(policy.published ? 'Unpublish' : 'Publish', 'hr-button-quiet', function () {
      db.collection('hrPolicies').doc(policy.id).update({ published: !policy.published, updatedBy: hrUser.uid, updatedByEmail: hrUser.email || '', updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
        .then(function () { return hrRecordAudit(policy.published ? 'policy.unpublished' : 'policy.published', 'policy', policy.id); }).catch(hrWriteError);
    }));
    row.append(main, actions);
    var detail = document.createElement('details'); detail.className = 'hr-policy-detail';
    detail.appendChild(hrText('summary', 'Read policy'));
    detail.appendChild(hrText('p', policy.body || ''));
    row.appendChild(detail); list.appendChild(row);
  });
}

function hrWriteError(error) {
  console.error('HR update failed:', error && error.code || error);
  if (error && error.hrNotificationFailed) {
    hrNotify(error.message, 'error');
    return;
  }
  hrNotify('Could not save that change. Check HR access and try again.', 'error');
}

function hrAddEmployee(event) {
  event.preventDefault();
  var data = {
    name: hrEl('hr-employee-name').value.trim(),
    email: hrEl('hr-employee-email').value.trim().toLowerCase(),
    jobTitle: hrEl('hr-employee-title').value.trim(),
    department: hrEl('hr-employee-team').value.trim(),
    employmentType: hrEl('hr-employee-type').value,
    userUid: hrEl('hr-employee-account').value,
    userEmail: (hrWorkspaceUsers.find(function (user) { return user.uid === hrEl('hr-employee-account').value; }) || {}).email || '',
    startDate: hrEl('hr-employee-start').value,
    status: 'active',
    createdBy: hrUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  db.collection('hrEmployees').add(data).then(function (ref) {
    event.target.reset();
    return Promise.all([
      hrRecordAudit('employee.created', 'employee', ref.id),
      data.userUid ? hrNotifyLinkedPerson(ref.id, 'employee', ref.id, 'Your HR profile is ready', 'Your employee profile is available in My HR.') : null
    ]);
  }).then(function () { hrNotify('Person added to the HR directory.', 'success'); }).catch(hrWriteError);
}

function hrToggleEmployee(person) {
  var status = person.status === 'active' ? 'inactive' : 'active';
  db.collection('hrEmployees').doc(person.id).update({ status: status, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(function () { return Promise.all([
      hrRecordAudit('employee.' + status, 'employee', person.id),
      person.userUid ? hrNotifyLinkedPerson(person.id, 'employee', person.id, 'Your HR profile was updated', 'Your HR profile status is now ' + status + '.') : null
    ]); }).catch(hrWriteError);
}

function hrAddOnboarding(event) {
  event.preventDefault();
  var person = hrPeople.find(function (item) { return item.id === hrEl('hr-onboarding-person').value; });
  if (!person) return hrNotify('Choose a person first.', 'error');
  var title = hrEl('hr-onboarding-title').value.trim();
  db.collection('hrOnboarding').add({
    employeeId: person.id,
    employeeUid: person.userUid || '',
    employeeName: person.name,
    title: title,
    dueDate: hrEl('hr-onboarding-due').value,
    status: 'open',
    createdBy: hrUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function (ref) {
    event.target.reset();
    return Promise.all([
      hrRecordAudit('onboarding.created', 'onboarding', ref.id),
      person.userUid ? hrNotifyLinkedPerson(person.id, 'onboarding', ref.id, 'New onboarding task', title) : null
    ]);
  })
    .then(function () { hrNotify('Onboarding task added.', 'success'); }).catch(hrWriteError);
}

function hrAddLeave(event) {
  event.preventDefault();
  var person = hrPeople.find(function (item) { return item.id === hrEl('hr-leave-person').value; });
  var startDate = hrEl('hr-leave-start').value; var endDate = hrEl('hr-leave-end').value;
  if (!person) return hrNotify('Choose a person first.', 'error');
  if (endDate < startDate) return hrNotify('The end date must be on or after the start date.', 'error');
  var leaveType = hrEl('hr-leave-type').value;
  db.collection('hrLeaveRequests').add({
    employeeId: person.id,
    employeeUid: person.userUid || '',
    employeeName: person.name,
    leaveType: leaveType,
    startDate: startDate,
    endDate: endDate,
    status: 'pending',
    createdBy: hrUser.uid,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function (ref) {
    event.target.reset();
    return Promise.all([
      hrRecordAudit('leave.created', 'leave', ref.id),
      person.userUid ? hrNotifyLinkedPerson(person.id, 'leave', ref.id, 'Leave request recorded', 'HR recorded your ' + leaveType + ' leave request from ' + startDate + ' through ' + endDate + '.') : null
    ]);
  })
    .then(function () { hrNotify('Leave request recorded.', 'success'); }).catch(hrWriteError);
}

function hrAddPolicy(event) {
  event.preventDefault();
  db.collection('hrPolicies').add({
    title: hrEl('hr-policy-title').value.trim(),
    category: hrEl('hr-policy-category').value.trim() || 'General',
    body: hrEl('hr-policy-body').value.trim(),
    published: hrEl('hr-policy-published').checked,
    createdBy: hrUser.uid,
    updatedBy: hrUser.uid,
    updatedByEmail: hrUser.email || '',
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function (ref) { event.target.reset(); hrEl('hr-policy-published').checked = true; return hrRecordAudit('policy.created', 'policy', ref.id); })
    .then(function () { hrNotify('Policy saved.', 'success'); }).catch(hrWriteError);
}

function hrCreateInvite(event) {
  event.preventDefault();
  var button = event.submitter || event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  hrApi('invites', { email: hrEl('hr-invite-email').value.trim() }).then(function (result) {
    var fullLink = window.location.origin + result.link;
    var box = hrEl('hr-invite-result'); box.replaceChildren(); box.hidden = false;
    box.appendChild(hrText('p', 'Share this one-time link privately. It expires ' + new Date(result.expiresAt).toLocaleString() + '.'));
    var link = document.createElement('a'); link.href = fullLink; link.textContent = fullLink; link.rel = 'noreferrer'; box.appendChild(link);
    box.appendChild(hrButton('Copy link', 'hr-button-quiet', function () {
      navigator.clipboard.writeText(fullLink).then(function () { hrNotify('Invitation link copied.', 'success'); })
        .catch(function () { window.prompt('Copy this invitation link:', fullLink); });
    }));
    event.target.reset();
    return hrLoadAccess();
  }).then(function () { hrNotify('HR invitation created.', 'success'); }).catch(function (error) { hrNotify(error.message || 'Could not create invitation.', 'error'); })
    .finally(function () { button.disabled = false; });
}

function hrLoadAccess() {
  return hrApi('access').then(function (data) {
    var members = hrEl('hr-access-members'); members.replaceChildren();
    var activeMembers = (data.members || []).filter(function (member) { return member.enabled === true && member.uid !== hrUser.uid; });
    if (!activeMembers.length) members.appendChild(hrText('div', 'No other active HR users.', 'hr-list-empty'));
    activeMembers.forEach(function (member) {
      var row = document.createElement('article'); row.className = 'hr-list-row';
      var main = document.createElement('div'); main.className = 'hr-list-main'; main.appendChild(hrText('strong', member.email || 'HR user'));
      main.appendChild(hrText('small', 'HR access' + (member.grantedAt && member.grantedAt.toDate ? ' · Added ' + member.grantedAt.toDate().toLocaleDateString() : '')));
      var actions = document.createElement('div'); actions.className = 'hr-list-actions';
      actions.appendChild(hrButton('Revoke access', 'hr-button-danger', function () { hrRevokeMember(member); }));
      row.append(main, actions); members.appendChild(row);
    });
    var invitations = hrEl('hr-access-invitations'); invitations.replaceChildren();
    if (!(data.invitations || []).length) invitations.appendChild(hrText('div', 'No pending invitations.', 'hr-list-empty'));
    (data.invitations || []).forEach(function (invite) {
      var row = document.createElement('article'); row.className = 'hr-list-row';
      var main = document.createElement('div'); main.className = 'hr-list-main'; main.appendChild(hrText('strong', invite.email));
      main.appendChild(hrText('small', 'Expires ' + new Date(invite.expiresAt).toLocaleString()));
      var actions = document.createElement('div'); actions.className = 'hr-list-actions';
      actions.appendChild(hrText('span', 'Pending', 'hr-badge pending'));
      actions.appendChild(hrButton('Cancel link', 'hr-button-danger', function () { hrRevokeInvitation(invite); }));
      row.append(main, actions); invitations.appendChild(row);
    });
  }).catch(function (error) { hrNotify(error.message || 'Could not load HR access.', 'error'); });
}

function hrRevokeMember(member) {
  if (!window.confirm('Revoke HR access for ' + (member.email || 'this account') + '?')) return;
  hrApi('access/revoke', { uid: member.uid }).then(function () {
    hrNotify('HR access revoked.', 'success');
    return hrLoadAccess();
  }).catch(function (error) { hrNotify(error.message || 'Could not revoke HR access.', 'error'); });
}

function hrRevokeInvitation(invitation) {
  if (!window.confirm('Cancel the pending HR invitation for ' + invitation.email + '?')) return;
  hrApi('invites/revoke', { invitationId: invitation.id }).then(function () {
    hrNotify('HR invitation cancelled.', 'success');
    return hrLoadAccess();
  }).catch(function (error) { hrNotify(error.message || 'Could not cancel the invitation.', 'error'); });
}

auth.onAuthStateChanged(hrHandleAuth);
