(function () {
  var currentUser = null;
  var registerMode = false;
  var programme = null;
  var applicationId = '';
  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(window.location.search);
  var requestedProgramme = params.get('programme') || '';
  var formCopy = {
    en: { choose: 'Choose…', privacy: 'I confirm this information is accurate and consent to VGF using it to assess my application. I have read the privacy notice.', guardian: 'I am the applicant’s parent or legal guardian, I am authorised to submit this application, and I consent to VGF processing the minimum information needed to assess it.', save: 'Save draft', submit: 'Submit application' },
    fr: { choose: 'Choisir…', privacy: 'Je confirme que ces informations sont exactes et consens à leur utilisation par VGF pour évaluer ma candidature. J’ai lu l’avis de confidentialité.', guardian: 'Je suis le parent ou le tuteur légal du candidat, je suis autorisé à soumettre cette candidature et je consens au traitement des informations minimales nécessaires.', save: 'Enregistrer le brouillon', submit: 'Soumettre la candidature' },
    sw: { choose: 'Chagua…', privacy: 'Ninathibitisha kuwa taarifa hizi ni sahihi na ninakubali VGF kuzitumia kutathmini ombi langu. Nimesoma ilani ya faragha.', guardian: 'Mimi ni mzazi au mlezi wa kisheria wa mwombaji, nina mamlaka ya kuwasilisha ombi hili, na ninakubali VGF kuchakata taarifa chache zinazohitajika.', save: 'Hifadhi rasimu', submit: 'Wasilisha ombi' },
    rn: { choose: 'Hitamwo…', privacy: 'Ndemeje ko aya makuru ari ukuri kandi ndemeye ko VGF iyakoresha mu gusuzuma ubusabe bwanje. Nasomye itangazo ryerekeye ubuzima bwite.', guardian: 'Ndi umuvyeyi canke umurezi wemewe w’usaba, ndafise uburenganzira bwo gutanga ubu busabe kandi ndemeye ko VGF ikoresha amakuru make akenewe.', save: 'Bika umushinge', submit: 'Rungika ubusabe' },
    rw: { choose: 'Hitamo…', privacy: 'Ndemeza ko aya makuru ari ukuri kandi nemeye ko VGF iyakoresha mu gusuzuma ubusabe bwanjye. Nasomye itangazo ry’ibanga.', guardian: 'Ndi umubyeyi cyangwa umurinzi wemewe w’usaba, nemerewe gutanga ubu busabe kandi nemeye ko VGF ikoresha amakuru make akenewe.', save: 'Bika umushinga', submit: 'Ohereza ubusabe' }
  };

  function notice(message, type) { var el = $('notice'); el.textContent = message; el.className = 'notice ' + (type || 'error'); el.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
  function api(path, body, method) {
    if (!currentUser) return Promise.reject(new Error('Sign in to continue.'));
    return currentUser.getIdToken().then(function (token) {
      var options = { method: method || 'GET', headers: { Authorization: 'Bearer ' + token } };
      if (body) { options.headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
      return fetch('/api/vgf' + path, options);
    }).then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) throw new Error(data.error || 'The service could not complete this request.'); return data; }); });
  }
  function renderQuestion(field, language) {
    var labelText = (field.labels && (field.labels[language] || field.labels.en)) || field.label || field.id;
    var wrapper = document.createElement('label'); wrapper.textContent = labelText + (field.required ? ' *' : '');
    var control;
    if (field.type === 'textarea') control = document.createElement('textarea');
    else if (field.type === 'select') { control = document.createElement('select'); var blank = document.createElement('option'); blank.value = ''; blank.textContent = (formCopy[language] || formCopy.en).choose; control.appendChild(blank); (field.options || []).forEach(function (option) { var item = document.createElement('option'); item.value = option; item.textContent = option; control.appendChild(item); }); }
    else if (field.type === 'checkbox') { wrapper.className = 'consent-row'; control = document.createElement('input'); control.type = 'checkbox'; }
    else { control = document.createElement('input'); control.type = ['email', 'tel', 'number', 'date'].includes(field.type) ? field.type : 'text'; }
    control.name = field.id; control.id = 'question-' + field.id; control.required = !!field.required; wrapper.appendChild(control); return wrapper;
  }
  function renderForm() {
    if (!programme) return;
    $('apply-title').textContent = programme.name;
    $('apply-description').textContent = programme.description + (programme.eligibility ? '\nEligibility: ' + programme.eligibility : '');
    $('children-safeguard').hidden = !programme.collectsChildren;
    $('guardian-consent-row').hidden = !programme.collectsChildren;
    $('guardian-consent').required = !!programme.collectsChildren;
    var language = $('form-language').value;
    var languages = programme.languages || ['en'];
    Array.from($('form-language').options).forEach(function (option) { option.disabled = languages.indexOf(option.value) === -1; });
    if (languages.indexOf(language) === -1) { $('form-language').value = 'en'; language = 'en'; }
    var copy = formCopy[language] || formCopy.en;
    $('consent-copy').replaceChildren(document.createTextNode(copy.privacy + ' '));
    var privacyLink = document.createElement('a'); privacyLink.href = 'vgf-privacy.html?language=' + encodeURIComponent(language); privacyLink.target = '_blank'; privacyLink.textContent = language === 'fr' ? 'Avis de confidentialité' : (language === 'sw' ? 'Ilani ya faragha' : (language === 'rw' ? 'Itangazo ry’ibanga' : (language === 'rn' ? 'Itangazo ryerekeye ubuzima bwite' : 'Privacy notice'))); $('consent-copy').appendChild(privacyLink);
    $('guardian-consent-copy').textContent = copy.guardian;
    $('save-draft').textContent = copy.save; $('application-form').querySelector('button[type="submit"]').textContent = copy.submit;
    var fields = $('question-fields'); fields.replaceChildren();
    (programme.formSchema || []).forEach(function (field) { fields.appendChild(renderQuestion(field, language)); });
    var docs = $('document-fields'); docs.replaceChildren();
    (programme.documentRequirements || []).forEach(function (requirement) {
      var label = document.createElement('label'); label.className = 'file-control';
      label.appendChild(document.createTextNode(((requirement.labels && (requirement.labels[language] || requirement.labels.en)) || requirement.label) + (requirement.required ? ' *' : '')));
      var input = document.createElement('input'); input.type = 'file'; input.accept = '.pdf,.docx,.jpg,.jpeg,.png'; input.dataset.requirementId = requirement.id; input.dataset.label = requirement.label; input.required = !!requirement.required;
      var meta = document.createElement('span'); meta.className = 'record-meta'; meta.textContent = 'PDF, DOCX, JPG or PNG; up to 10 MB';
      label.append(input, meta); docs.appendChild(label);
    });
  }
  function openTracking() {
    return api('/my/applications').then(function (data) {
      var list = $('application-list'); list.replaceChildren();
      if (!data.applications.length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No applications yet.'; list.appendChild(empty); return; }
      data.applications.forEach(function (application) {
        var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div');
        var name = document.createElement('strong'); name.textContent = application.programmeName || 'Programme';
        var reference = document.createElement('p'); reference.textContent = application.reference ? 'Reference: ' + application.reference : 'Draft application';
        var status = document.createElement('span'); status.className = 'status-chip'; status.textContent = String(application.status).replace(/_/g, ' ');
        info.append(name, reference, status); row.appendChild(info);
        if (application.status === 'draft') { var resume = document.createElement('a'); resume.href = 'vgf-applicant.html?programme=' + encodeURIComponent(application.programmeId) + '&draft=' + encodeURIComponent(application.id); resume.className = 'edit'; resume.textContent = 'Continue'; row.appendChild(resume); }
        list.appendChild(row);
      });
    }).catch(function (error) { notice(error.message); });
  }
  function loadNotifications() {
    return api('/my/notifications').then(function (data) {
      var list = $('notification-list'); list.replaceChildren();
      (data.notifications || []).forEach(function (item) {
        var row = document.createElement('article'); row.className = 'record'; var info = document.createElement('div');
        var title = document.createElement('strong'); title.textContent = item.title; var message = document.createElement('p'); message.textContent = item.message; info.append(title, message); row.appendChild(info);
        if (!item.read) { var button = document.createElement('button'); button.type = 'button'; button.className = 'edit'; button.textContent = 'Mark read'; button.addEventListener('click', function () { api('/my/notifications/' + encodeURIComponent(item.id) + '/read', {}, 'POST').then(loadNotifications).catch(function (error) { notice(error.message); }); }); row.appendChild(button); }
        list.appendChild(row);
      });
      if (!(data.notifications || []).length) { var empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No notifications yet.'; list.appendChild(empty); }
    }).catch(function (error) { notice(error.message); });
  }
  function collectAnswers() { var answers = {}; (programme.formSchema || []).forEach(function (field) { var input = $('question-' + field.id); if (input) answers[field.id] = field.type === 'checkbox' ? input.checked : input.value; }); return answers; }
  function ensureDraft() {
    if (applicationId) return Promise.resolve(applicationId);
    return api('/applications', { programmeId: programme.id, applicantName: currentUser.displayName || '' }, 'POST').then(function (data) { applicationId = data.applicationId; return applicationId; });
  }
  function saveDraft() {
    return ensureDraft().then(function (id) { return api('/applications/' + encodeURIComponent(id) + '/draft', { answers: collectAnswers(), applicantName: currentUser.displayName || '', language: $('form-language').value }, 'POST'); });
  }
  function uploadDocuments() {
    var inputs = Array.from(document.querySelectorAll('#document-fields input[type="file"]'));
    return inputs.reduce(function (chain, input) {
      if (!input.files || !input.files[0]) return chain;
      return chain.then(function () {
        var file = input.files[0];
        if (file.size > 10 * 1024 * 1024) throw new Error(file.name + ' exceeds the 10 MB limit.');
        var id = (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2));
        var path = 'vgfApplications/' + currentUser.uid + '/' + applicationId + '/' + id;
        return storage.ref(path).put(file, { contentType: file.type }).then(function () {
          return api('/applications/' + encodeURIComponent(applicationId) + '/documents', { documentId: id, requirementId: input.dataset.requirementId, label: input.dataset.label + ' - ' + file.name }, 'POST');
        });
      });
    }, Promise.resolve());
  }
  function completeForm() {
    return saveDraft().then(uploadDocuments);
  }
  function loadProgramme() {
    if (!requestedProgramme) { $('apply-panel').hidden = true; return Promise.resolve(); }
    return fetch('/api/vgf/programmes').then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error); return data; }); })
      .then(function (data) {
        programme = (data.programmes || []).find(function (item) { return item.id === requestedProgramme; });
        if (!programme) throw new Error('This opportunity is no longer available.');
        $('apply-panel').hidden = false; renderForm();
        applicationId = params.get('draft') || '';
        if (applicationId) return api('/applications/' + encodeURIComponent(applicationId)).then(function (result) {
          var application = result.application || {};
          Object.keys(application.answers || {}).forEach(function (key) { var input = $('question-' + key); if (input) { if (input.type === 'checkbox') input.checked = application.answers[key] === true; else input.value = application.answers[key]; } });
          (application.documents || []).forEach(function (doc) { var line = document.createElement('div'); line.className = 'document-item'; var text = document.createElement('span'); text.textContent = 'Uploaded: ' + doc.label; var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'edit'; remove.textContent = 'Remove'; remove.addEventListener('click', function () { api('/applications/' + encodeURIComponent(applicationId) + '/documents/' + encodeURIComponent(doc.id) + '/delete', {}, 'POST').then(function () { line.remove(); notice('Document removed.', 'success'); }).catch(function (error) { notice(error.message); }); }); line.append(text, remove); $('document-fields').appendChild(line); });
        });
      }).catch(function (error) { notice(error.message); });
  }
  function setSignedIn(user) {
    currentUser = user;
    if (user) {
      user.getIdTokenResult(true).then(function (token) {
        if (token.claims.vgfPartner === true || token.claims.vgfWorkspace === true || String(user.email || '').toLowerCase() === 'chikondigahimbare@gmail.com') { window.location.href = token.claims.vgfPartner ? 'vgf-partner.html' : '/dashboard'; return; }
        if (token.claims.vgfApplicant !== true) { auth.signOut().then(function () { notice('This account is not registered for the VGF applicant portal. Create an applicant account or sign in with the invited address.'); }); }
      }).catch(function () { auth.signOut(); });
    }
    $('auth-panel').hidden = !!user;
    $('sign-out').hidden = !user;
    $('tracking-panel').hidden = !user;
    if (user) {
      $('verification-warning').hidden = !!user.emailVerified;
      $('verify-note').hidden = !!user.emailVerified;
      loadProgramme(); openTracking(); loadNotifications(); $('notification-panel').hidden = false;
    } else {
      $('apply-panel').hidden = true; $('verification-warning').hidden = true; $('notification-panel').hidden = true;
    }
  }
  $('auth-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var email = $('app-email').value.trim(); var password = $('app-password').value;
    if (registerMode) {
      var name = $('app-name').value.trim(); if (!name) return notice('Enter your full name.');
      fetch('/api/vgf/applicants/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, email: email }) }).then(function (response) { return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || 'Could not register.'); return data; }); }).then(function (data) { notice(data.message || 'If the address can be registered, VGF has sent the next steps to that inbox.', 'success'); $('verify-note').hidden = false; }).catch(function (error) { notice(error.message); });
    } else auth.signInWithEmailAndPassword(email, password).then(function (credential) { if (!credential.user.emailVerified) { $('verify-note').hidden = false; return notice('Verify your email before applying. Check your inbox for the verification link.'); } setSignedIn(credential.user); }).catch(function (error) { notice(error.message); });
  });
  $('switch-auth').addEventListener('click', function () { registerMode = !registerMode; $('name-wrap').hidden = !registerMode; $('app-name').required = registerMode; $('auth-submit').textContent = registerMode ? 'Create account' : 'Sign in'; $('switch-auth').textContent = registerMode ? 'I already have an account' : 'Create account'; });
  $('sign-out').addEventListener('click', function () { auth.signOut(); });
  $('form-language').addEventListener('change', renderForm);
  $('save-draft').addEventListener('click', function () { if (!programme || !currentUser) return; completeForm().then(function () { notice('Draft saved. You can return to it from Application tracking.', 'success'); return openTracking(); }).catch(function (error) { notice(error.message); }); });
  $('application-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (!programme || !currentUser) return;
    if (!currentUser.emailVerified) return notice('Verify your email before submitting.');
    completeForm().then(function () { return currentUser.getIdToken(true); }).then(function () { return api('/applications/' + encodeURIComponent(applicationId) + '/submit', { consent: $('privacy-consent').checked, guardianConsent: $('guardian-consent').checked }, 'POST'); })
      .then(function (result) { notice('Application submitted. Your reference number is ' + result.reference + (result.emailSent ? '. A confirmation email was sent.' : '. Email delivery is not configured yet.'), 'success'); applicationId = ''; $('application-form').reset(); return openTracking(); })
      .catch(function (error) { notice(error.message); });
  });
  $('refresh-applications').addEventListener('click', openTracking);
  $('refresh-notifications').addEventListener('click', loadNotifications);
  $('resend-verification').addEventListener('click', function () { if (!currentUser) return; currentUser.sendEmailVerification().then(function () { notice('Verification email sent.', 'success'); }).catch(function (error) { notice(error.message); }); });
  auth.onAuthStateChanged(setSignedIn);
}());
