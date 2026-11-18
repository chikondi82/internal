var myHrUser = null;
var myHrData = null;
var myHrCases = [];
var myHrNotifications = [];
var myHrSelectedCaseId = '';
var myHrCaseMessagesUnsub = null;
var myHrLinkRequestUnsub = null;
var myHrUnsubscribers = [];
var myHrNotificationsPrimed = false;

function myHrEl(id) { return document.getElementById(id); }

function myHrText(tag, value, className) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value == null ? '' : String(value);
  return node;
}

function myHrShowGate(title, message, actionLabel, action) {
  myHrEl('my-hr-app').hidden = true;
  myHrEl('my-hr-gate').hidden = false;
  myHrEl('my-hr-gate-title').textContent = title;
  myHrEl('my-hr-gate-message').textContent = message;
  var button = myHrEl('my-hr-gate-action');
  button.hidden = !actionLabel;
  button.textContent = actionLabel || '';
  button.onclick = action || null;
}

function myHrNotify(message, type) {
  var toast = myHrEl('my-hr-toast');
  toast.textContent = message;
  toast.className = 'my-hr-toast' + (type ? ' ' + type : '');
  toast.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function () { toast.hidden = true; }, 6000);
}

function myHrApi(path, body) {
  return myHrUser.getIdToken().then(function (token) {
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

function myHrStopListeners() {
  myHrUnsubscribers.forEach(function (unsubscribe) { unsubscribe(); });
  myHrUnsubscribers = [];
  if (myHrCaseMessagesUnsub) { myHrCaseMessagesUnsub(); myHrCaseMessagesUnsub = null; }
  if (myHrLinkRequestUnsub) { myHrLinkRequestUnsub(); myHrLinkRequestUnsub = null; }
}

function myHrSignOut() {
  myHrStopListeners();
  auth.signOut().then(function () { window.location.href = 'index.html'; });
}

function myHrHandleAuth(user) {
  myHrUser = user || null;
  if (!user) {
    myHrStopListeners();
    myHrShowGate('Sign in to My HR', 'Sign in with your workspace account to view your personal HR updates and messages.', 'Sign in', function () {
      window.location.href = 'index.html';
    });
    return;
  }
  if (String(user.email || '').toLowerCase() === 'chikondigahimbare@gmail.com') {
    myHrStopListeners();
    myHrShowGate(
      'My HR is for employees',
      'You do not need an employee-linked My HR account as Super Admin. Use HR CRM for weekly reports and private support discussions.',
      'Open HR CRM',
      function () { window.location.href = 'hr.html'; }
    );
    return;
  }
  myHrEl('my-hr-current-user').textContent = user.displayName || user.email || '';
  myHrEl('my-hr-gate').hidden = true;
  myHrEl('my-hr-app').hidden = false;
  myHrStart();
}

function myHrStart() {
  myHrStopListeners();
  myHrNotificationsPrimed = false;
  myHrEl('my-hr-data').hidden = true;
  myHrEl('my-hr-not-linked').hidden = true;
  myHrEl('my-hr-link-form').onsubmit = myHrSubmitLinkRequest;
  myHrLoadData().then(function (result) {
    if (result.linked) {
      myHrStartRealtime();
      return;
    }
    myHrLinkRequestUnsub = db.collection('hrLinkRequests').doc(myHrUser.uid).onSnapshot(function (snapshot) {
      var request = snapshot.exists ? snapshot.data() : null;
      myHrRenderLinkRequest(request);
      if (request && request.status === 'approved') myHrStart();
    }, function (error) {
      myHrHandleDataError(error, 'link request status');
    });
  }).catch(function (error) {
    console.error('My HR data request failed:', error);
    if (error.message && error.message.indexOf('Verify your email address') !== -1) {
      myHrShowGate('Verify your workspace email', error.message, 'Send verification email', function () {
        myHrUser.sendEmailVerification().then(function () {
          myHrShowGate('Check your email', 'Open the verification link, then return here to refresh your sign-in.', 'I verified', myHrRefreshVerification);
        }).catch(function (verificationError) {
          myHrNotify(verificationError.message || 'Could not send the verification email.', 'error');
        });
      });
      return;
    }
    myHrShowGate('Could not load My HR', error.message || 'Refresh the page or contact HR.');
  });
}

function myHrStartRealtime() {
  myHrUnsubscribers.push(db.collection('hrNotifications').doc(myHrUser.uid).collection('items')
    .orderBy('createdAt', 'desc').limit(30).onSnapshot(function (snapshot) {
      var previous = myHrNotificationsPrimed;
      myHrNotifications = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
      myHrRenderNotifications();
      if (previous && snapshot.docChanges().some(function (change) { return change.type === 'added'; })) {
        myHrNotify('You have a new HR update.', 'success');
        myHrLoadData().catch(myHrHandleDataError);
      }
      myHrNotificationsPrimed = true;
    }, function (error) { myHrHandleDataError(error, 'HR updates'); }));
  myHrUnsubscribers.push(db.collection('hrCases').where('employeeUid', '==', myHrUser.uid)
    .onSnapshot(function (snapshot) {
      myHrCases = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
      myHrCases.sort(function (a, b) { return myHrTimestamp(b.updatedAt) - myHrTimestamp(a.updatedAt); });
      myHrRenderCases();
    }, function (error) { myHrHandleDataError(error, 'private HR conversations'); }));
  myHrUnsubscribers.push(db.collection('hrPolicies').where('published', '==', true)
    .onSnapshot(function (snapshot) {
      var policies = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
      policies.sort(function (a, b) { return myHrTimestamp(b.updatedAt) - myHrTimestamp(a.updatedAt); });
      myHrRenderPolicies(policies);
    }, function (error) { myHrHandleDataError(error, 'published policies'); }));
  myHrEl('my-hr-case-form').onsubmit = myHrCreateCase;
  myHrEl('my-hr-reply-form').onsubmit = myHrReplyToCase;
}

function myHrRefreshVerification() {
  var user = auth.currentUser;
  if (!user) return;
  user.reload().then(function () {
    if (!auth.currentUser || auth.currentUser.emailVerified !== true) {
      myHrShowGate('Email is not verified yet', 'Open the verification link, then check again.', 'Check again', myHrRefreshVerification);
      return;
    }
    myHrUser = auth.currentUser;
    return myHrUser.getIdToken(true).then(function () {
      myHrEl('my-hr-gate').hidden = true;
      myHrEl('my-hr-app').hidden = false;
      myHrStart();
    });
  }).catch(function (error) {
    myHrNotify(error.message || 'Could not refresh your verification status.', 'error');
  });
}

function myHrLoadData() {
  return myHrApi('me').then(function (result) {
    if (!result.linked) {
      myHrData = null;
      myHrEl('my-hr-data').hidden = true;
      myHrEl('my-hr-not-linked').hidden = false;
      myHrRenderLinkRequest(result.linkRequest);
      return result;
    }
    myHrData = result;
    myHrEl('my-hr-not-linked').hidden = true;
    myHrEl('my-hr-data').hidden = false;
    myHrRenderProfile();
    myHrRenderOnboarding();
    myHrRenderLeave();
    return result;
  });
}

function myHrRenderLinkRequest(request) {
  var status = myHrEl('my-hr-link-status');
  var form = myHrEl('my-hr-link-form');
  status.hidden = !request;
  status.className = 'my-hr-link-status' + (request ? ' ' + request.status : '');
  form.hidden = !!(request && request.status === 'pending');
  if (!request) {
    status.textContent = '';
    return;
  }
  if (request.status === 'pending') {
    status.textContent = 'Your request is waiting for HR or the Super Admin to verify and review it.';
  } else if (request.status === 'rejected') {
    status.textContent = 'Your request was not approved. ' + (request.reviewReason || 'Contact HR if you believe this was a mistake.') + ' You can submit a new request if needed.';
  } else if (request.status === 'approved') {
    status.textContent = 'Your request was approved. Loading your My HR information…';
  }
}

function myHrSubmitLinkRequest(event) {
  event.preventDefault();
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  var note = myHrEl('my-hr-link-note').value.trim();
  submit.disabled = true;
  myHrApi('link-requests', { note: note }).then(function (result) {
    myHrRenderLinkRequest({ status: result.status });
    myHrEl('my-hr-link-note').value = '';
    myHrNotify(result.alreadyRequested
      ? 'Your My HR link request is already waiting for review.'
      : 'Your My HR link request was sent to HR for review.', 'success');
  }).catch(function (error) {
    myHrNotify(error.message || 'Could not submit your My HR link request.', 'error');
  }).finally(function () { submit.disabled = false; });
}

function myHrHandleDataError(error, source) {
  source = source || 'My HR information';
  var code = error && error.code || 'unknown error';
  console.error('My HR realtime ' + source + ' listener failed:', code, error);
  var message = code === 'permission-denied'
    ? 'Live ' + source + ' are blocked by Firestore permissions. Publish the current Firestore rules, then refresh.'
    : 'Could not update ' + source + ' (' + code + '). Check your connection and refresh.';
  myHrNotify(message, 'error');
}

function myHrTimestamp(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'object') {
    var seconds = value.seconds || value._seconds;
    return typeof seconds === 'number' ? seconds * 1000 : 0;
  }
  var parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function myHrDate(value) {
  var timestamp = myHrTimestamp(value);
  return timestamp ? new Date(timestamp).toLocaleString() : '';
}

function myHrRenderProfile() {
  var profile = myHrEl('my-hr-profile');
  profile.replaceChildren();
  var employee = myHrData.employee || {};
  [
    ['Name', employee.name],
    ['Work email', employee.email],
    ['Job title', employee.jobTitle],
    ['Team', employee.department],
    ['Relationship', employee.employmentType],
    ['Start date', employee.startDate],
    ['Status', employee.status]
  ].forEach(function (field) {
    if (!field[1]) return;
    var item = document.createElement('div'); item.className = 'my-hr-profile-item';
    item.append(myHrText('span', field[0]), myHrText('strong', field[1]));
    profile.appendChild(item);
  });
}

function myHrRenderNotifications() {
  var list = myHrEl('my-hr-notifications');
  list.replaceChildren();
  var unread = myHrNotifications.filter(function (item) { return item.isRead !== true; }).length;
  myHrEl('my-hr-update-count').textContent = unread + ' unread · updates appear here as HR saves them.';
  if (!myHrNotifications.length) {
    list.appendChild(myHrText('div', 'Your HR updates will appear here.', 'my-hr-empty'));
    return;
  }
  myHrNotifications.forEach(function (item) {
    var row = document.createElement('article'); row.className = 'my-hr-list-row my-hr-notification' + (item.isRead === true ? '' : ' unread');
    var content = document.createElement('div');
    content.appendChild(myHrText('strong', item.title || 'HR update'));
    content.appendChild(myHrText('p', item.body || ''));
    content.appendChild(myHrText('small', myHrDate(item.createdAt)));
    row.appendChild(content);
    if (item.isRead !== true) {
      var button = myHrText('button', 'Mark read', 'my-hr-button my-hr-button-quiet');
      button.type = 'button';
      button.onclick = function () {
        db.collection('hrNotifications').doc(myHrUser.uid).collection('items').doc(item.id)
          .update({ isRead: true }).catch(myHrHandleDataError);
      };
      row.appendChild(button);
    } else {
      row.appendChild(myHrText('span', 'Read', 'my-hr-read-label'));
    }
    list.appendChild(row);
  });
}

function myHrRenderOnboarding() {
  var list = myHrEl('my-hr-onboarding');
  list.replaceChildren();
  var tasks = myHrData.onboarding || [];
  if (!tasks.length) { list.appendChild(myHrText('div', 'No onboarding tasks have been assigned.', 'my-hr-empty')); return; }
  tasks.forEach(function (task) {
    var row = document.createElement('article'); row.className = 'my-hr-list-row';
    var details = document.createElement('div');
    details.appendChild(myHrText('strong', task.title || 'Onboarding task'));
    details.appendChild(myHrText('small', (task.dueDate ? 'Due ' + task.dueDate + ' · ' : '') + (task.status || 'open')));
    row.appendChild(details);
    row.appendChild(myHrText('span', task.status || 'open', 'my-hr-status ' + (task.status === 'complete' ? 'complete' : 'pending')));
    list.appendChild(row);
  });
}

function myHrRenderLeave() {
  var list = myHrEl('my-hr-leave');
  list.replaceChildren();
  var requests = myHrData.leave || [];
  if (!requests.length) { list.appendChild(myHrText('div', 'No leave requests are on file.', 'my-hr-empty')); return; }
  requests.forEach(function (request) {
    var row = document.createElement('article'); row.className = 'my-hr-list-row';
    var details = document.createElement('div');
    details.appendChild(myHrText('strong', (request.leaveType || 'Leave') + ' · ' + (request.startDate || '') + ' through ' + (request.endDate || '')));
    details.appendChild(myHrText('small', request.reviewedAt ? 'Updated ' + myHrDate(request.reviewedAt) : 'Submitted ' + myHrDate(request.createdAt)));
    row.appendChild(details);
    row.appendChild(myHrText('span', request.status || 'pending', 'my-hr-status ' + (request.status === 'approved' ? 'complete' : request.status === 'declined' ? 'declined' : 'pending')));
    list.appendChild(row);
  });
}

function myHrRenderPolicies(policies) {
  var list = myHrEl('my-hr-policies');
  list.replaceChildren();
  if (!policies.length) { list.appendChild(myHrText('div', 'No published policies yet.', 'my-hr-empty')); return; }
  policies.forEach(function (policy) {
    var item = document.createElement('details'); item.className = 'my-hr-policy';
    var summary = document.createElement('summary');
    summary.appendChild(myHrText('strong', policy.title || 'Untitled policy'));
    summary.appendChild(myHrText('small', policy.category || 'General'));
    item.appendChild(summary);
    item.appendChild(myHrText('p', policy.body || ''));
    list.appendChild(item);
  });
}

function myHrRenderCases() {
  var list = myHrEl('my-hr-case-list');
  list.replaceChildren();
  if (!myHrCases.length) {
    list.appendChild(myHrText('div', 'You have not started a conversation with HR yet.', 'my-hr-empty'));
    return;
  }
  myHrCases.forEach(function (item) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'my-hr-case-row' + (item.id === myHrSelectedCaseId ? ' active' : '');
    row.onclick = function () { myHrOpenCase(item.id); };
    row.appendChild(myHrText('strong', item.subject || 'HR conversation'));
    row.appendChild(myHrText('small', (item.category || 'Other') + ' · ' + (item.status || 'open')));
    row.appendChild(myHrText('small', item.lastMessagePreview || ''));
    list.appendChild(row);
  });
  var selected = myHrCases.find(function (item) { return item.id === myHrSelectedCaseId; });
  if (selected) {
    myHrEl('my-hr-thread-title').textContent = selected.subject || 'HR conversation';
    myHrEl('my-hr-thread-status').textContent = 'Status: ' + (selected.status || 'open') + ' · ' + (selected.category || 'Other');
  }
  if (!myHrCases.some(function (item) { return item.id === myHrSelectedCaseId; })) {
    myHrSelectedCaseId = '';
    if (myHrCaseMessagesUnsub) myHrCaseMessagesUnsub();
    myHrCaseMessagesUnsub = null;
    myHrEl('my-hr-thread-title').textContent = 'Select a conversation';
    myHrEl('my-hr-thread-status').textContent = 'Your messages are private to you and HR.';
    myHrEl('my-hr-thread').replaceChildren(myHrText('div', 'Choose a conversation to read and reply.', 'my-hr-empty'));
    myHrEl('my-hr-reply-form').hidden = true;
  }
}

function myHrOpenCase(caseId) {
  myHrSelectedCaseId = caseId;
  var item = myHrCases.find(function (candidate) { return candidate.id === caseId; });
  if (!item) return;
  if (myHrCaseMessagesUnsub) myHrCaseMessagesUnsub();
  myHrEl('my-hr-thread-title').textContent = item.subject || 'HR conversation';
  myHrEl('my-hr-thread-status').textContent = 'Status: ' + (item.status || 'open') + ' · ' + (item.category || 'Other');
  myHrEl('my-hr-reply-form').hidden = false;
  myHrEl('my-hr-thread').replaceChildren(myHrText('div', 'Loading conversation…', 'my-hr-empty'));
  myHrRenderCases();
  myHrCaseMessagesUnsub = db.collection('hrCases').doc(caseId).collection('messages').orderBy('createdAt')
    .onSnapshot(function (snapshot) {
      var thread = myHrEl('my-hr-thread');
      thread.replaceChildren();
      if (snapshot.empty) thread.appendChild(myHrText('div', 'No messages yet.', 'my-hr-empty'));
      snapshot.docs.forEach(function (doc) {
        var message = doc.data() || {};
        var senderRole = message.senderRole === 'hr' || message.senderRole === 'worker'
          ? message.senderRole
          : (message.senderUid === myHrUser.uid ? 'worker' : 'hr');
        var bubble = document.createElement('article');
        bubble.className = 'my-hr-message from-' + senderRole;
        var heading = document.createElement('div'); heading.className = 'my-hr-message-heading';
        var sender = document.createElement('div'); sender.className = 'my-hr-message-sender';
        sender.append(
          myHrText('span', senderRole === 'worker' ? 'You' : 'HR', 'my-hr-sender-role ' + senderRole),
          myHrText('strong', senderRole === 'worker' ? '' : (message.senderName || 'HR team'))
        );
        heading.append(sender, myHrText('time', myHrDate(message.createdAt)));
        bubble.append(heading, myHrText('p', message.text || ''));
        thread.appendChild(bubble);
      });
      thread.scrollTop = thread.scrollHeight;
    }, myHrHandleDataError);
}

function myHrCreateCase(event) {
  event.preventDefault();
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  var payload = {
    subject: myHrEl('my-hr-case-subject').value.trim(),
    category: myHrEl('my-hr-case-category').value,
    message: myHrEl('my-hr-case-message').value.trim()
  };
  submit.disabled = true;
  myHrApi('cases', payload).then(function (result) {
    event.target.reset();
    myHrNotify('Your private message was sent to HR.', 'success');
    if (result.caseId) {
      myHrSelectedCaseId = result.caseId;
      myHrCases.unshift({
        id: result.caseId,
        subject: payload.subject,
        category: payload.category,
        status: 'open',
        lastMessagePreview: payload.message.slice(0, 180),
        updatedAt: new Date()
      });
      myHrRenderCases();
      myHrOpenCase(result.caseId);
    }
  }).catch(function (error) { myHrNotify(error.message || 'Could not send your message to HR.', 'error'); })
    .finally(function () { submit.disabled = false; });
}

function myHrReplyToCase(event) {
  event.preventDefault();
  if (!myHrSelectedCaseId) return myHrNotify('Choose a conversation first.', 'error');
  var message = myHrEl('my-hr-reply').value.trim();
  if (!message) return;
  var submit = event.submitter || event.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  myHrApi('cases/' + encodeURIComponent(myHrSelectedCaseId) + '/messages', { message: message })
    .then(function () { myHrEl('my-hr-reply').value = ''; })
    .catch(function (error) { myHrNotify(error.message || 'Could not send your reply.', 'error'); })
    .finally(function () { submit.disabled = false; });
}

auth.onAuthStateChanged(myHrHandleAuth);
