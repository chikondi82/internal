(function () {
  var programmes = [];
  var partners = [];
  var grants = [];
  var representatives = [];
  var applications = [];
  var settingsTranslations = { privacyNotice: {}, dataRetention: {} };
  var emailTemplates = {};
  var $ = function (id) { return document.getElementById(id); };

  function notice(message, type) {
    var el = $('notice');
    el.textContent = message;
    el.className = 'notice ' + (type || 'error');
    el.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function request(path, body, method) {
    if (!me) return Promise.reject(new Error('Sign in to continue.'));
    return me.getIdToken().then(function (token) {
      var options = { method: method || 'GET', headers: { Authorization: 'Bearer ' + token } };
      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
      return fetch('/api/vgf' + path, options);
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'The VGF service could not complete this request.');
        return data;
      });
    });
  }
  function downloadDocument(applicationId, docInfo) {
    return me.getIdToken().then(function (token) { return fetch('/api/vgf/applications/' + encodeURIComponent(applicationId) + '/documents/' + encodeURIComponent(docInfo.id) + '/download', { headers: { Authorization: 'Bearer ' + token } }); })
      .then(function (response) { if (!response.ok) return response.json().then(function (data) { throw new Error(data.error || 'Could not download this document.'); }); return response.blob(); })
      .then(function (blob) { var url = URL.createObjectURL(blob); var link = window.document.createElement('a'); link.href = url; link.download = docInfo.label || 'supporting-document'; link.click(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); });
  }

  function addText(parent, tag, value, className) {
    var el = document.createElement(tag);
    el.textContent = value || '';
    if (className) el.className = className;
    parent.appendChild(el);
    return el;
  }

  function renderPartners() {
    var checks = $('partner-checklist');
    var list = $('partner-list');
    checks.replaceChildren();
    if (!partners.length) addText(checks, 'span', 'Add partners to assign them.', 'muted');
    partners.forEach(function (partner) {
      if (partner.status !== 'active') return;
      var label = document.createElement('label');
      label.className = 'check-option';
      var input = document.createElement('input');
      input.type = 'checkbox'; input.value = partner.id; input.name = 'programme-partners';
      label.append(input, document.createTextNode(partner.name));
      checks.appendChild(label);
    });
    list.replaceChildren();
    if (!partners.length) addText(list, 'p', 'No partner organisations have been added.', 'empty');
    partners.forEach(function (partner) {
      var row = document.createElement('article'); row.className = 'record';
      var info = document.createElement('div');
      addText(info, 'strong', partner.name);
      addText(info, 'p', partner.email || partner.details || 'No contact details provided.');
      addText(info, 'span', partner.status, 'record-meta');
      var actions = document.createElement('div'); actions.className = 'record-actions';
      var edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit'; edit.textContent = 'Edit';
      edit.addEventListener('click', function () { fillPartner(partner); });
      actions.appendChild(edit); row.append(info, actions); list.appendChild(row);
    });
    ['access-partner', 'rep-partner'].forEach(function (id) {
      var select = $(id); if (!select) return;
      var current = select.value; select.replaceChildren();
      partners.forEach(function (partner) { var option = document.createElement('option'); option.value = partner.id; option.textContent = partner.name + (partner.status === 'active' ? '' : ' (' + partner.status + ')'); select.appendChild(option); });
      if (partners.some(function (partner) { return partner.id === current; })) select.value = current;
    });
  }

  var supportedLanguages = ['en', 'fr', 'sw', 'rn', 'rw'];
  function addQuestionRow(field) {
    field = field || { id: 'question_' + Math.random().toString(36).slice(2, 9), type: 'text', labels: { en: '' }, options: [], required: false };
    var row = document.createElement('div'); row.className = 'builder-row question-row'; row.dataset.id = field.id;
    var header = document.createElement('div'); header.className = 'builder-row-head';
    var idText = document.createElement('span'); idText.className = 'record-meta'; idText.textContent = field.id;
    var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = 'Remove'; remove.addEventListener('click', function () { row.remove(); });
    header.append(idText, remove); row.appendChild(header);
    var langGrid = document.createElement('div'); langGrid.className = 'form-grid language-label-grid';
    supportedLanguages.forEach(function (language) {
      var label = document.createElement('label'); label.textContent = ({ en: 'English label', fr: 'French label', sw: 'Kiswahili label', rn: 'Kirundi label', rw: 'Kinyarwanda label' })[language];
      var input = document.createElement('input'); input.dataset.language = language; input.value = field.labels && field.labels[language] || ''; input.required = language === 'en'; label.appendChild(input); langGrid.appendChild(label);
    });
    row.appendChild(langGrid);
    var controls = document.createElement('div'); controls.className = 'form-grid';
    var typeLabel = document.createElement('label'); typeLabel.textContent = 'Field type'; var type = document.createElement('select');
    [['text','Short text'],['textarea','Long text'],['email','Email'],['tel','Telephone'],['number','Number'],['date','Date'],['select','Choose from list'],['checkbox','Checkbox']].forEach(function (item) { var option = document.createElement('option'); option.value = item[0]; option.textContent = item[1]; type.appendChild(option); }); type.value = field.type || 'text'; typeLabel.appendChild(type);
    var requiredLabel = document.createElement('label'); requiredLabel.className = 'inline-setting'; var required = document.createElement('input'); required.type = 'checkbox'; required.checked = !!field.required; requiredLabel.append(required, document.createTextNode(' Required field'));
    controls.append(typeLabel, requiredLabel); row.appendChild(controls);
    var reportingLabel = document.createElement('label'); reportingLabel.textContent = 'Reporting category'; var reporting = document.createElement('select');
    [['','Do not include in category reports'],['country','Country'],['beneficiaryCategory','Beneficiary category']].forEach(function (item) { var option = document.createElement('option'); option.value = item[0]; option.textContent = item[1]; reporting.appendChild(option); }); reporting.value = field.reportingKey || ''; reportingLabel.appendChild(reporting); row.appendChild(reportingLabel);
    var options = document.createElement('label'); options.textContent = 'Choice options (comma separated; for choice fields)'; var optionsInput = document.createElement('input'); optionsInput.value = (field.options || []).join(', '); options.appendChild(optionsInput); row.appendChild(options);
    $('question-builder').appendChild(row);
  }

  function addDocumentRow(item) {
    item = item || { id: 'document_' + Math.random().toString(36).slice(2, 9), label: '', labels: {}, required: true };
    var row = document.createElement('div'); row.className = 'builder-row document-row'; row.dataset.id = item.id;
    var header = document.createElement('div'); header.className = 'builder-row-head'; var idText = document.createElement('span'); idText.className = 'record-meta'; idText.textContent = item.id;
    var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = 'Remove'; remove.addEventListener('click', function () { row.remove(); }); header.append(idText, remove);
    var labels = item.labels || { en: item.label || '' }; var grid = document.createElement('div'); grid.className = 'form-grid language-label-grid';
    supportedLanguages.forEach(function (language) { var label = document.createElement('label'); label.textContent = ({ en: 'English document name', fr: 'French document name', sw: 'Kiswahili document name', rn: 'Kirundi document name', rw: 'Kinyarwanda document name' })[language]; var input = document.createElement('input'); input.dataset.language = language; input.value = labels[language] || ''; input.required = language === 'en'; label.appendChild(input); grid.appendChild(label); });
    var reqLabel = document.createElement('label'); reqLabel.className = 'inline-setting'; var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!item.required; reqLabel.append(checkbox, document.createTextNode(' Required'));
    row.append(header, grid, reqLabel); $('document-builder').appendChild(row);
  }

  function collectFormSchema() {
    return Array.from(document.querySelectorAll('.question-row')).map(function (row) {
      var labels = {}; row.querySelectorAll('[data-language]').forEach(function (input) { labels[input.dataset.language] = input.value.trim(); });
      var controls = row.querySelectorAll('select,input[type="checkbox"]');
      var optionInput = row.querySelector('label:last-child input');
      return { id: row.dataset.id, type: controls[0].value, required: controls[1].checked, labels: labels, reportingKey: row.querySelectorAll('select')[1].value, options: optionInput.value.split(',').map(function (value) { return value.trim(); }).filter(Boolean) };
    });
  }
  function collectDocumentRequirements() {
    return Array.from(document.querySelectorAll('.document-row')).map(function (row) { var labels = {}; row.querySelectorAll('[data-language]').forEach(function (input) { labels[input.dataset.language] = input.value.trim(); }); var required = row.querySelector('input[type="checkbox"]'); return { id: row.dataset.id, label: labels.en, labels: labels, required: required.checked }; });
  }

  function renderSelectOptions() {
    ['access-programme', 'application-program-filter'].forEach(function (id) {
      var select = $(id); if (!select) return; var current = select.value; select.replaceChildren();
      if (id === 'application-program-filter') { var all = document.createElement('option'); all.value = ''; all.textContent = 'All programmes'; select.appendChild(all); }
      programmes.forEach(function (program) { var option = document.createElement('option'); option.value = program.id; option.textContent = program.name; select.appendChild(option); });
      if (programmes.some(function (program) { return program.id === current; })) select.value = current;
    });
  }

  function renderProgrammes() {
    var list = $('programme-list'); list.replaceChildren();
    if (!programmes.length) return addText(list, 'p', 'No programmes yet. Create the first programme above.', 'empty');
    programmes.forEach(function (programme) {
      var row = document.createElement('article'); row.className = 'record';
      var info = document.createElement('div');
      addText(info, 'strong', programme.name);
      addText(info, 'p', programme.description);
      var partnerNames = (programme.partnerIds || []).map(function (id) {
        var partner = partners.find(function (item) { return item.id === id; });
        return partner ? partner.name : '';
      }).filter(Boolean);
      addText(info, 'span', programme.status + ' · ' + (partnerNames.length ? partnerNames.join(', ') : 'No partners assigned'), 'record-meta');
      var actions = document.createElement('div'); actions.className = 'record-actions';
      var edit = document.createElement('button'); edit.type = 'button'; edit.className = 'edit'; edit.textContent = 'Edit';
      edit.addEventListener('click', function () { fillProgramme(programme); });
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = 'Delete';
      remove.addEventListener('click', function () { deleteProgramme(programme); });
      actions.append(edit, remove); row.append(info, actions); list.appendChild(row);
    });
  }

  function load() {
    $('programme-list').textContent = 'Loading…';
    return request('/admin').then(function (data) {
      programmes = Array.isArray(data.programmes) ? data.programmes : [];
      partners = Array.isArray(data.partners) ? data.partners : [];
      grants = Array.isArray(data.access) ? data.access : [];
      representatives = Array.isArray(data.representatives) ? data.representatives : [];
      renderPartners(); renderProgrammes(); renderSelectOptions(); renderAccess(); renderRepresentatives();
      loadSettings(); loadOverview(); loadAudit();
    }).catch(function (error) { notice(error.message); });
  }

  function clearProgramme() {
    $('programme-form').reset(); $('programme-id').value = '';
    $('programme-heading').textContent = 'Create a programme';
    $('question-builder').replaceChildren(); $('document-builder').replaceChildren();
  }

  function fillProgramme(item) {
    $('programme-id').value = item.id;
    $('programme-name').value = item.name || '';
    $('programme-description').value = item.description || '';
    $('programme-target').value = item.targetBeneficiaries || '';
    $('programme-coverage').value = item.coverage || '';
    $('programme-eligibility').value = item.eligibility || '';
    $('programme-opening').value = item.openingDate || '';
    $('programme-closing').value = item.closingDate || '';
    $('programme-places').value = item.places == null ? '' : item.places;
    $('programme-status').value = item.status || 'draft';
    $('collects-children').checked = !!item.collectsChildren;
    document.querySelectorAll('[name="programme-language"]').forEach(function (input) { input.checked = input.value === 'en' || (item.languages || ['en']).includes(input.value); });
    $('question-builder').replaceChildren(); (item.formSchema || []).forEach(addQuestionRow);
    $('document-builder').replaceChildren(); (item.documentRequirements || []).forEach(addDocumentRow);
    Array.from(document.querySelectorAll('[name="programme-partners"]')).forEach(function (box) {
      box.checked = (item.partnerIds || []).indexOf(box.value) !== -1;
    });
    $('programme-heading').textContent = 'Edit programme';
    $('programme-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function fillPartner(item) {
    $('partner-id').value = item.id;
    $('partner-name').value = item.name || '';
    $('partner-email').value = item.email || '';
    $('partner-details').value = item.details || '';
    $('partner-status').value = item.status || 'active';
    $('partner-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('programme-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var partnerIds = Array.from(document.querySelectorAll('[name="programme-partners"]:checked')).map(function (box) { return box.value; });
    var payload = {
      id: $('programme-id').value || undefined,
      name: $('programme-name').value,
      description: $('programme-description').value,
      targetBeneficiaries: $('programme-target').value,
      coverage: $('programme-coverage').value,
      eligibility: $('programme-eligibility').value,
      openingDate: $('programme-opening').value,
      closingDate: $('programme-closing').value,
      places: $('programme-places').value,
      status: $('programme-status').value,
      partnerIds: partnerIds,
      languages: Array.from(document.querySelectorAll('[name="programme-language"]:checked')).map(function (box) { return box.value; }),
      formSchema: collectFormSchema(), documentRequirements: collectDocumentRequirements(), collectsChildren: $('collects-children').checked
    };
    request('/programmes', payload, 'POST').then(function () {
      clearProgramme(); notice('Programme saved.', 'success'); return load();
    }).catch(function (error) { notice(error.message); });
  });

  $('partner-form').addEventListener('submit', function (event) {
    event.preventDefault();
    request('/partners', {
      id: $('partner-id').value || undefined,
      name: $('partner-name').value,
      email: $('partner-email').value,
      details: $('partner-details').value,
      status: $('partner-status').value
    }, 'POST').then(function () {
      $('partner-form').reset(); $('partner-id').value = '';
      notice('Partner organisation saved.', 'success'); return load();
    }).catch(function (error) { notice(error.message); });
  });

  function deleteProgramme(programme) {
    if (!window.confirm('Delete “' + programme.name + '”? This cannot be undone.')) return;
    request('/programmes/' + encodeURIComponent(programme.id) + '/delete', {}, 'POST')
      .then(function () { notice('Programme deleted.', 'success'); return load(); })
      .catch(function (error) { notice(error.message); });
  }

  $('programme-reset').addEventListener('click', clearProgramme);
  $('partner-reset').addEventListener('click', function () { $('partner-form').reset(); $('partner-id').value = ''; });
  $('reload').addEventListener('click', load);
  $('signout').addEventListener('click', function () { auth.signOut().then(function () { window.location.href = '/'; }); });

  auth.onAuthStateChanged(function (user) {
    if (!user) { window.location.href = '/'; return; }
    if (!currentUserIsSuperAdmin()) {
      document.querySelector('main').innerHTML = '<section class="panel"><h1>Access restricted</h1><p class="muted">This area is limited to the VGF Super Admin.</p><a href="/dashboard">Return to the workspace</a></section>';
      return;
    }
    load();
  });

  function renderAccess() {
    var list = $('access-list'); if (!list) return; list.replaceChildren();
    var programId = $('access-programme').value; var partnerId = $('access-partner').value;
    var grant = grants.find(function (item) { return item.programmeId === programId && item.partnerId === partnerId; });
    document.querySelectorAll('[name="access-permission"]').forEach(function (box) { box.checked = !!(grant && grant.enabled && grant.permissions.includes(box.value)); });
    if (!grants.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No partner permissions have been configured.'; list.appendChild(empty); return; }
    grants.forEach(function (item) {
      var program = programmes.find(function (value) { return value.id === item.programmeId; }); var partner = partners.find(function (value) { return value.id === item.partnerId; });
      if (!program || !partner) return;
      var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div');
      var title = document.createElement('strong'); title.textContent = partner.name + ' · ' + program.name;
      var detail = document.createElement('p'); detail.textContent = (item.enabled ? (item.permissions || []).join(', ') || 'No permissions' : 'Revoked'); info.append(title, detail); row.appendChild(info); list.appendChild(row);
    });
  }

  function renderRepresentatives() {
    var list = $('representative-list'); if (!list) return; list.replaceChildren();
    if (!representatives.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No partner representatives have been invited.'; list.appendChild(empty); return; }
    representatives.forEach(function (person) {
      var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div');
      var name = document.createElement('strong'); name.textContent = person.name || person.email || person.uid;
      var detail = document.createElement('p'); var partner = partners.find(function (item) { return item.id === person.partnerId; }); detail.textContent = (person.email || '') + ' · ' + (partner ? partner.name : 'Unknown organisation') + ' · ' + person.role + ' · ' + (person.enabled ? 'Active' : 'Suspended'); info.append(name, detail); row.appendChild(info);
      var toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = person.enabled ? 'delete' : 'edit'; toggle.textContent = person.enabled ? 'Suspend' : 'Activate';
      toggle.addEventListener('click', function () { request('/partners/' + encodeURIComponent(person.partnerId) + '/representatives/' + encodeURIComponent(person.uid) + '/access', { enabled: !person.enabled }, 'POST').then(load).catch(function (error) { notice(error.message); }); });
      row.appendChild(toggle); list.appendChild(row);
    });
  }

  function loadApplications() {
    var query = new URLSearchParams(); if ($('application-program-filter').value) query.set('programmeId', $('application-program-filter').value); if ($('application-status-filter').value) query.set('status', $('application-status-filter').value);
    request('/admin/applications?' + query.toString()).then(function (data) { applications = data.applications || []; renderApplications(); }).catch(function (error) { notice(error.message); });
  }

  function renderApplications() {
    var list = $('application-list'); if (!list) return; list.replaceChildren();
    if (!applications.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No matching applications.'; list.appendChild(empty); return; }
    applications.forEach(function (application) {
      var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div');
      var title = document.createElement('strong'); title.textContent = application.applicantName + ' · ' + (application.reference || 'Draft');
      var desc = document.createElement('p'); desc.textContent = application.programmeName + ' · ' + application.applicantEmail;
      var status = document.createElement('span'); status.className = 'status-chip'; status.textContent = application.status.replace(/_/g, ' '); info.append(title, desc, status);
      var actions = document.createElement('div'); actions.className = 'record-actions'; var view = document.createElement('button'); view.type = 'button'; view.className = 'edit'; view.textContent = 'Review';
      view.addEventListener('click', function () { showApplicationReview(application, row); }); actions.appendChild(view); row.append(info, actions); list.appendChild(row);
    });
  }

  function showApplicationReview(summary, row) {
    request('/applications/' + encodeURIComponent(summary.id)).then(function (data) {
      var app = data.application; var detail = document.createElement('div'); detail.className = 'review-detail';
      var answers = document.createElement('dl'); answers.className = 'answer-list';
      Object.keys(app.answers || {}).forEach(function (key) { var term = document.createElement('dt'); term.textContent = key; var value = document.createElement('dd'); value.textContent = String(app.answers[key]); answers.append(term, value); });
      detail.appendChild(answers);
      (app.documents || []).forEach(function (doc) { var button = document.createElement('button'); button.type = 'button'; button.className = 'edit'; button.textContent = 'Download ' + doc.label; button.addEventListener('click', function () { downloadDocument(app.id, doc).catch(function (error) { notice(error.message); }); }); detail.appendChild(button); });
      var program = programmes.find(function (item) { return item.id === app.programmeId; });
      var reviewerChoices = representatives.filter(function (person) { return person.enabled && program && (program.partnerIds || []).indexOf(person.partnerId) !== -1 && grants.some(function (grant) { return grant.programmeId === program.id && grant.partnerId === person.partnerId && grant.enabled && grant.permissions.includes('review_applications'); }); });
      var assignment = document.createElement('div'); assignment.className = 'review-controls'; var reviewer = document.createElement('select'); var unassigned = document.createElement('option'); unassigned.value = ''; unassigned.textContent = 'Unassigned'; reviewer.appendChild(unassigned);
      reviewerChoices.forEach(function (person) { var option = document.createElement('option'); option.value = person.uid; option.textContent = person.name || person.email; reviewer.appendChild(option); }); reviewer.value = app.assignedReviewerUid || '';
      var assign = document.createElement('button'); assign.type = 'button'; assign.className = 'secondary'; assign.textContent = 'Assign reviewer'; assign.addEventListener('click', function () { request('/applications/' + encodeURIComponent(app.id) + '/assign', { reviewerUid: reviewer.value }, 'POST').then(function () { notice('Reviewer assignment saved.', 'success'); }).catch(function (error) { notice(error.message); }); }); assignment.append(reviewer, assign); detail.appendChild(assignment);
      var statusRow = document.createElement('div'); statusRow.className = 'review-controls'; var select = document.createElement('select');
      ['submitted','under_review','shortlisted','accepted','rejected','waitlisted','withdrawn'].forEach(function (value) { var option = document.createElement('option'); option.value = value; option.textContent = value.replace(/_/g, ' '); select.appendChild(option); }); select.value = app.status;
      var save = document.createElement('button'); save.type = 'button'; save.className = 'primary'; save.textContent = 'Update status'; save.addEventListener('click', function () { request('/applications/' + encodeURIComponent(app.id) + '/status', { status: select.value }, 'POST').then(function () { notice('Status updated.', 'success'); loadApplications(); }).catch(function (error) { notice(error.message); }); }); statusRow.append(select, save); detail.appendChild(statusRow);
      (app.internalNotes || []).forEach(function (note) { var p = document.createElement('p'); p.className = 'record-meta'; p.textContent = note.name + ': ' + note.text; detail.appendChild(p); });
      (app.partnerComments || []).forEach(function (note) { var p = document.createElement('p'); p.className = 'record-meta'; p.textContent = 'Partner comment · ' + note.name + ': ' + note.text; detail.appendChild(p); });
      var noteForm = document.createElement('form'); noteForm.className = 'note-form'; var noteInput = document.createElement('textarea'); noteInput.required = true; noteInput.maxLength = 3000; noteInput.placeholder = 'Internal review note'; var noteButton = document.createElement('button'); noteButton.type = 'submit'; noteButton.className = 'secondary'; noteButton.textContent = 'Add internal note'; noteForm.append(noteInput, noteButton); noteForm.addEventListener('submit', function (event) { event.preventDefault(); request('/applications/' + encodeURIComponent(app.id) + '/notes', { note: noteInput.value }, 'POST').then(function () { notice('Note added.', 'success'); showApplicationReview(summary, row); }).catch(function (error) { notice(error.message); }); }); detail.appendChild(noteForm);
      row.appendChild(detail);
    }).catch(function (error) { notice(error.message); });
  }

  $('add-question').addEventListener('click', function () { addQuestionRow(); });
  $('add-document').addEventListener('click', function () { addDocumentRow(); });
  $('access-programme').addEventListener('change', renderAccess); $('access-partner').addEventListener('change', renderAccess);
  $('access-form').addEventListener('submit', function (event) { event.preventDefault(); var perms = Array.from(document.querySelectorAll('[name="access-permission"]:checked')).map(function (box) { return box.value; }); request('/admin/partners/' + encodeURIComponent($('access-partner').value) + '/access', { programmeId: $('access-programme').value, permissions: perms, enabled: true }, 'POST').then(function () { notice('Partner permissions saved.', 'success'); return load(); }).catch(function (error) { notice(error.message); }); });
  $('revoke-access').addEventListener('click', function () { request('/admin/partners/' + encodeURIComponent($('access-partner').value) + '/access', { programmeId: $('access-programme').value, permissions: [], enabled: false }, 'POST').then(function () { notice('Programme access revoked.', 'success'); return load(); }).catch(function (error) { notice(error.message); }); });
  $('representative-form').addEventListener('submit', function (event) { event.preventDefault(); request('/partners/' + encodeURIComponent($('rep-partner').value) + '/representatives', { name: $('rep-name').value, email: $('rep-email').value, role: $('rep-role').value }, 'POST').then(function () { $('representative-form').reset(); notice('Invitation email sent.', 'success'); return load(); }).catch(function (error) { notice(error.message); }); });
  $('load-applications').addEventListener('click', loadApplications);
  $('export-applications').addEventListener('click', function () { if (!applications.length) return notice('Load applications before exporting.'); var fields = ['reference','programmeName','applicantName','applicantEmail','status']; var rows = [fields.join(',')].concat(applications.map(function (item) { return fields.map(function (field) { return '"' + String(item[field] || '').replace(/"/g, '""') + '"'; }).join(','); })); var link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })); link.download = 'vgf-applications.csv'; link.click(); URL.revokeObjectURL(link.href); });

  function loadSettings() {
    request('/admin/settings').then(function (data) {
      var settings = data.settings || {}; var templates = settings.notificationTemplates || {};
      settingsTranslations = { privacyNotice: settings.privacyNoticeTranslations || { en: settings.privacyNotice || '' }, dataRetention: settings.dataRetentionTranslations || { en: settings.dataRetention || '' } };
      emailTemplates = templates;
      $('settings-locale').value = 'en'; $('settings-email-locale').value = 'en';
      loadSettingsLocale(); loadEmailLocale();
      $('settings-contact').value = settings.contactEmail || '';
    }).catch(function (error) { notice(error.message); });
  }
  function storeSettingsLocale() { var locale = $('settings-locale').value; settingsTranslations.privacyNotice[locale] = $('settings-privacy').value; settingsTranslations.dataRetention[locale] = $('settings-retention').value; }
  function loadSettingsLocale() { var locale = $('settings-locale').value; $('settings-privacy').value = settingsTranslations.privacyNotice[locale] || ''; $('settings-retention').value = settingsTranslations.dataRetention[locale] || ''; }
  function storeEmailLocale() { var locale = $('settings-email-locale').value; emailTemplates[locale] = emailTemplates[locale] || {}; emailTemplates[locale].application_received = { subject: $('template-received-subject').value, body: $('template-received-body').value }; emailTemplates[locale].application_status = { subject: $('template-status-subject').value, body: $('template-status-body').value }; }
  function loadEmailLocale() { var locale = $('settings-email-locale').value; var templates = emailTemplates[locale] || {}; var received = templates.application_received || {}; var status = templates.application_status || {}; $('template-received-subject').value = received.subject || (locale === 'en' ? 'VGF application received' : ''); $('template-received-body').value = received.body || (locale === 'en' ? 'Your application {{reference}} for {{programme}} has been received. We will contact you with updates.' : ''); $('template-status-subject').value = status.subject || (locale === 'en' ? 'VGF application status update' : ''); $('template-status-body').value = status.body || (locale === 'en' ? 'Your application {{reference}} for {{programme}} is now {{status}}.' : ''); }
  function loadOverview() {
    request('/admin/overview').then(function (data) {
      var metrics = $('overview-metrics'); metrics.replaceChildren();
      [['Programmes',data.totalProgrammes],['Applications',data.totalApplications],['Partners',data.totalPartners],['Awaiting review',data.awaitingReview]].forEach(function (item) { var card = document.createElement('article'); card.className = 'metric-card'; var value = document.createElement('strong'); value.textContent = String(item[1] || 0); var label = document.createElement('span'); label.textContent = item[0]; card.append(value, label); metrics.appendChild(card); });
      var breakdown = $('overview-breakdown'); breakdown.replaceChildren();
      [['By programme',data.byProgramme],['By status',data.byStatus],['By country',data.byCountry],['By beneficiary category',data.byBeneficiaryCategory]].forEach(function (group) { var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div'); var title = document.createElement('strong'); title.textContent = group[0]; var text = document.createElement('p'); text.textContent = Object.entries(group[1] || {}).map(function (entry) { return entry[0] + ': ' + entry[1]; }).join(' · ') || 'No data yet'; info.append(title, text); row.appendChild(info); breakdown.appendChild(row); });
    }).catch(function (error) { notice(error.message); });
  }
  function loadAudit() {
    request('/admin/audit').then(function (data) { var list = $('audit-list'); list.replaceChildren(); (data.entries || []).forEach(function (entry) { var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div'); var title = document.createElement('strong'); title.textContent = entry.action; var detail = document.createElement('p'); detail.textContent = entry.actorEmail + ' · ' + entry.entityType + ' ' + entry.entityId; info.append(title, detail); row.appendChild(info); list.appendChild(row); }); if (!list.children.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No activity logged yet.'; list.appendChild(empty); } }).catch(function (error) { notice(error.message); });
  }
  $('settings-form').addEventListener('submit', function (event) { event.preventDefault(); request('/admin/settings', {
    translations: (storeSettingsLocale(), settingsTranslations), contactEmail: $('settings-contact').value,
    notificationTemplates: (storeEmailLocale(), Object.keys(emailTemplates).reduce(function (result, locale) { result['application_received_' + locale] = emailTemplates[locale].application_received; result['application_status_' + locale] = emailTemplates[locale].application_status; return result; }, {}))
  }, 'POST').then(function () { notice('Privacy, retention and notification settings saved.', 'success'); loadSettings(); }).catch(function (error) { notice(error.message); }); });
  $('settings-locale').addEventListener('change', function () { storeSettingsLocale(); loadSettingsLocale(); });
  $('settings-email-locale').addEventListener('change', function () { storeEmailLocale(); loadEmailLocale(); });
  $('migration-preview').addEventListener('click', function () { request('/admin/migrate-workspace-access', {}, 'POST').then(function (result) { $('migration-summary').textContent = result.eligible + ' account(s) eligible; ' + result.skipped + ' applicant/partner account(s) excluded.'; $('migration-confirm').disabled = false; }).catch(function (error) { notice(error.message); }); });
  $('migration-confirm').addEventListener('click', function () { if (!window.confirm('Grant the staff workspace role to every eligible existing Firebase account? Applicants and partners are excluded.')) return; request('/admin/migrate-workspace-access', { confirm: true }, 'POST').then(function (result) { $('migration-confirm').disabled = true; $('migration-summary').textContent = result.migrated + ' account(s) migrated. Staff must sign out and sign in again.'; notice('Existing workspace roles migrated.', 'success'); }).catch(function (error) { notice(error.message); }); });
  $('refresh-overview').addEventListener('click', loadOverview); $('load-audit').addEventListener('click', loadAudit);
}());
