function setUserInviteAccess() {
  var panel = G('user-invite-panel');
  if (panel) panel.style.display = currentUserIsAdmin() ? '' : 'none';
}

auth.onAuthStateChanged(function (user) {
  setUserInviteAccess();
  if (!user) return;
  G('user-invite-form').onsubmit = inviteWorkspaceUser;
});

document.addEventListener('workspace-role-changed', function (event) {
  if (me && event.detail && event.detail.uid === me.uid) setUserInviteAccess();
});

function inviteWorkspaceUser(event) {
  event.preventDefault();
  if (!currentUserIsAdmin()) {
    toast('Only workspace admins can invite users.');
    return;
  }

  var name = G('invite-user-name').value.trim();
  var email = G('invite-user-email').value.trim().toLowerCase();
  var button = G('invite-user-submit');
  var accountCreated = false;
  button.disabled = true;
  button.textContent = 'Creating account…';

  me.getIdToken().then(function (token) {
    return fetch('/api/workspace/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ name: name, email: email })
    });
  }).then(function (response) {
    return response.json().then(function (data) {
      if (!response.ok) throw new Error(data.error || 'Could not create the workspace account.');
      accountCreated = true;
      return auth.sendPasswordResetEmail(email, {
        url: window.location.origin + '/index.html',
        handleCodeInApp: false
      });
    });
  }).then(function () {
    G('user-invite-form').reset();
    toast('User added. A password setup email has been sent.', 'success');
  }).catch(function (error) {
    toast(accountCreated
      ? 'The account was created, but Firebase could not send the setup email. Ask the user to use “Forgot password?” on the sign-in page. ' + (error.message || '')
      : (error.message || 'Could not complete the invitation.'));
  }).finally(function () {
    button.disabled = false;
    button.textContent = 'Add user and send email';
  });
}
