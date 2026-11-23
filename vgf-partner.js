(function () {
  var user = null;
  var assignedProgrammes = [];
  var $ = function (id) { return document.getElementById(id); };
  function notice(message, type) { var el = $('partner-notice'); el.textContent = message; el.className = 'notice ' + (type || 'error'); el.hidden = false; }
  function api(path, body, method) {
    return user.getIdToken().then(function (token) { var options = { method: method || 'GET', headers: { Authorization: 'Bearer ' + token } }; if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); } return fetch('/api/vgf' + path, options); })
      .then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) throw new Error(data.error || 'Could not load partner records.'); return data; }); });
  }
  function downloadDocument(applicationId, docInfo) {
    return user.getIdToken().then(function (token) { return fetch('/api/vgf/applications/' + encodeURIComponent(applicationId) + '/documents/' + encodeURIComponent(docInfo.id) + '/download', { headers: { Authorization: 'Bearer ' + token } }); })
      .then(function (response) { if (!response.ok) return response.json().then(function (data) { throw new Error(data.error || 'Could not download this document.'); }); return response.blob(); })
      .then(function (blob) { var url = URL.createObjectURL(blob); var link = window.document.createElement('a'); link.href = url; link.download = docInfo.label || 'supporting-document'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); });
  }
  function render(items) {
    var parent = $('partner-applications'); parent.replaceChildren();
    var list = document.createElement('div'); list.className = 'record-list'; parent.appendChild(list);
    if (!items.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = assignedProgrammes.length ? 'There are no applications to review yet. New submissions for your assigned programmes will appear here.' : 'No programmes have been assigned to your organisation yet. Contact VGF if you expected to see programme access.'; list.appendChild(empty); return; }
    items.forEach(function (item) {
      var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div');
      var title = document.createElement('strong'); title.textContent = item.applicantName + ' · ' + (item.reference || 'Application');
      var detail = document.createElement('p'); detail.textContent = item.programmeName + ' · ' + String(item.status).replace(/_/g, ' ');
      info.append(title, detail); var review = document.createElement('button'); review.type = 'button'; review.className = 'edit'; review.textContent = 'Review'; review.addEventListener('click', function () { showDetail(item, row); }); row.append(info, review); list.appendChild(row);
    });
  }
  function showDetail(item, row) {
    api('/applications/' + encodeURIComponent(item.id)).then(function (data) {
      var application = data.application; var detail = document.createElement('div'); detail.className = 'review-detail';
      var answers = document.createElement('dl'); answers.className = 'answer-list';
      Object.keys(application.answers || {}).forEach(function (key) { var term = document.createElement('dt'); term.textContent = key; var value = document.createElement('dd'); value.textContent = String(application.answers[key]); answers.append(term, value); }); detail.appendChild(answers);
      (application.partnerComments || []).forEach(function (comment) { var p = document.createElement('p'); p.className = 'record-meta'; p.textContent = comment.name + ': ' + comment.text; detail.appendChild(p); });
      (application.documents || []).forEach(function (doc) { var download = document.createElement('button'); download.type = 'button'; download.className = 'edit'; download.textContent = 'Download ' + doc.label; download.addEventListener('click', function () { downloadDocument(item.id, doc).catch(function (error) { notice(error.message); }); }); detail.appendChild(download); });
      if ((item.permissions || []).includes('update_status')) {
        var statusForm = document.createElement('form'); statusForm.className = 'review-controls'; var status = document.createElement('select');
        ['under_review','shortlisted','accepted','rejected','waitlisted'].forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = value.replace(/_/g, ' '); status.appendChild(option); }); status.value = application.status;
        var update = document.createElement('button'); update.type = 'submit'; update.className = 'primary'; update.textContent = 'Update status'; statusForm.append(status, update); statusForm.addEventListener('submit', function (event) { event.preventDefault(); api('/applications/' + encodeURIComponent(item.id) + '/status', { status: status.value }, 'POST').then(function () { notice('Application status updated.', 'success'); load(); }).catch(function (error) { notice(error.message); }); }); detail.appendChild(statusForm);
      }
      if ((item.permissions || []).includes('add_comments')) {
        var noteForm = document.createElement('form'); noteForm.className = 'note-form'; var note = document.createElement('textarea'); note.required = true; note.maxLength = 3000; note.placeholder = 'Review comment'; var add = document.createElement('button'); add.type = 'submit'; add.className = 'secondary'; add.textContent = 'Add comment'; noteForm.append(note, add); noteForm.addEventListener('submit', function (event) { event.preventDefault(); api('/applications/' + encodeURIComponent(item.id) + '/notes', { note: note.value }, 'POST').then(function () { notice('Comment saved.', 'success'); showDetail(item, row); }).catch(function (error) { notice(error.message); }); }); detail.appendChild(noteForm);
      }
      row.appendChild(detail);
    }).catch(function (error) { notice(error.message); });
  }
  function renderOverview(data) {
    var applications = data.applications || [];
    assignedProgrammes = data.programmes || [];
    $('partner-stat-programmes').textContent = assignedProgrammes.length;
    $('partner-stat-applications').textContent = applications.length;
    $('partner-stat-review').textContent = applications.filter(function (item) { return item.status === 'submitted' || item.status === 'under_review'; }).length;
    var list = $('partner-programmes'); list.replaceChildren();
    if (!assignedProgrammes.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No programmes have been assigned yet. VGF will add programmes here when your organisation is granted access.'; list.appendChild(empty); return; }
    assignedProgrammes.forEach(function (programme) {
      var row = document.createElement('article'); row.className = 'partner-programme';
      var name = document.createElement('strong'); name.textContent = programme.name;
      var detail = document.createElement('span'); detail.textContent = [programme.coverage, programme.status && String(programme.status).replace(/_/g, ' ')].filter(Boolean).join(' · ');
      row.append(name, detail); list.appendChild(row);
    });
  }
  function load() { return api('/partner/applications').then(function (data) { renderOverview(data); render(data.applications || []); }).catch(function (error) { $('partner-dashboard').hidden = true; $('partner-auth').hidden = false; notice(error.message); }); }
  function showPartnerView(name) {
    ['overview', 'applications', 'team'].forEach(function (view) { var panel = $('partner-view-' + view); if (panel) panel.hidden = view !== name; });
    document.querySelectorAll('[data-partner-view]').forEach(function (button) { button.classList.toggle('active', button.getAttribute('data-partner-view') === name); });
  }
  function loadRepresentatives() { return api('/partner/representatives').then(function (data) {
    var list = $('partner-representatives'); list.replaceChildren();
    (data.representatives || []).forEach(function (person) { var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div'); var name = document.createElement('strong'); name.textContent = person.name || person.email; var description = document.createElement('p'); description.textContent = person.email + ' · ' + person.role.replace(/_/g, ' ') + ' · ' + (person.enabled ? 'Active' : 'Suspended'); info.append(name, description); var action = document.createElement('button'); action.type = 'button'; action.className = person.enabled ? 'delete' : 'edit'; action.textContent = person.enabled ? 'Suspend' : 'Activate'; action.disabled = person.uid === user.uid; action.addEventListener('click', function () { api('/partner/representatives/' + encodeURIComponent(person.uid) + '/access', { enabled: !person.enabled }, 'POST').then(loadRepresentatives).catch(function (error) { notice(error.message); }); }); row.append(info, action); list.appendChild(row); });
    if (!(data.representatives || []).length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No representatives yet.'; list.appendChild(empty); }
  }).catch(function (error) { notice(error.message); }); }
  function signedIn(nextUser) {
    user = nextUser;
    $('partner-auth').hidden = !!user;
    $('partner-loading').hidden = !user;
    $('partner-dashboard').hidden = true;
    $('partner-view-team').hidden = true;
    $('partner-signout').hidden = !user;
    if (!user) return;
    user.getIdTokenResult(true).then(function (token) {
      if (token.claims.vgfApplicant === true) { window.location.href = 'vgf-applicant.html'; return; }
      if (token.claims.vgfWorkspace === true || String(user.email || '').toLowerCase() === 'chikondigahimbare@gmail.com') {
        auth.signOut();
        return;
      }
      if (token.claims.vgfPartner !== true) {
        auth.signOut().then(function () {
          $('partner-loading').hidden = true;
          $('partner-auth').hidden = false;
          $('partner-signout').hidden = true;
          notice('This account is not registered as a VGF partner representative. Use the email address that received the invitation.');
        });
        return;
      }
      if (!user.emailVerified) {
        $('partner-loading').hidden = true;
        $('partner-auth').hidden = false;
        notice('Verify the invited email address before using partner access.');
        return;
      }
      return api('/partner/context').then(function (context) {
        $('partner-loading').hidden = true;
        $('partner-dashboard').hidden = false;
        $('partner-org-name').textContent = context.organisation || '';
        $('partner-sidebar-org').textContent = context.organisation || '';
        $('partner-team-nav').hidden = !context.canManageRepresentatives;
        showPartnerView('overview');
        if (context.canManageRepresentatives) loadRepresentatives();
        return load();
      });
    }).catch(function (error) {
      $('partner-loading').hidden = true;
      $('partner-auth').hidden = false;
      $('partner-dashboard').hidden = true;
      notice(error.message || 'Could not verify partner access. Sign in with the invited representative email.');
    });
  }
  $('partner-login').addEventListener('submit', function (event) { event.preventDefault(); auth.signInWithEmailAndPassword($('partner-email').value.trim(), $('partner-password').value).then(function (credential) { signedIn(credential.user); }).catch(function (error) { notice(error.message); }); });
  $('partner-reset-password').addEventListener('click', function () {
    var email = $('partner-email').value.trim();
    if (!email) { notice('Enter your invitation email address first.'); $('partner-email').focus(); return; }
    auth.sendPasswordResetEmail(email).then(function () { notice('If this address has a VGF account, a password reset email has been sent.', 'success'); }).catch(function () { notice('Could not send a reset email. Check the address or contact the VGF Super Admin.'); });
  });
  $('partner-rep-form').addEventListener('submit', function (event) { event.preventDefault(); api('/partner/representatives', { name: $('partner-rep-name').value, email: $('partner-rep-email').value, role: $('partner-rep-role').value }, 'POST').then(function () { $('partner-rep-form').reset(); notice('Representative invitation sent.', 'success'); loadRepresentatives(); }).catch(function (error) { notice(error.message); }); });
  $('partner-signout').addEventListener('click', function () { auth.signOut(); }); $('partner-refresh').addEventListener('click', load); $('partner-app-refresh').addEventListener('click', load); auth.onAuthStateChanged(signedIn);
  $('partner-rep-refresh').addEventListener('click', loadRepresentatives);
  document.querySelectorAll('[data-partner-view]').forEach(function (button) { button.addEventListener('click', function () { showPartnerView(button.getAttribute('data-partner-view')); }); });
}());
