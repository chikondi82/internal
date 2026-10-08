function setUserInviteAccess() {
  var isAdmin = currentUserIsAdmin();
  ['user-management-open', 'user-management-open-footer'].forEach(function (id) {
    var button = G(id);
    if (button) button.style.display = isAdmin ? '' : 'none';
  });
}

auth.onAuthStateChanged(function (user) {
  setUserInviteAccess();
  if (!user) closeUserManagement();
});

document.addEventListener('workspace-role-changed', function (event) {
  if (me && event.detail && event.detail.uid === me.uid) setUserInviteAccess();
});

function openUserManagement() {
  if (!currentUserIsAdmin()) {
    toast('Only workspace admins can manage accounts.', 'error');
    return;
  }
  var modal = G('user-management-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  loadManagedAccounts();
}

function closeUserManagement() {
  var modal = G('user-management-modal');
  if (modal) modal.style.display = 'none';
}

function userManagementRequest(payload) {
  return me.getIdToken().then(function (token) {
    return fetch('/api/workspace/users/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(payload)
    });
  }).then(function (response) {
    return response.text().then(function (body) {
      var data;
      try { data = body ? JSON.parse(body) : {}; }
      catch (_) { throw new Error('Account management service returned an invalid response (HTTP ' + response.status + ').'); }
      if (!response.ok) throw new Error(data.error || 'Could not manage that account (HTTP ' + response.status + ').');
      return data;
    });
  });
}

function loadManagedAccounts() {
  var list = G('user-management-list');
  if (!list) return;
  list.textContent = 'Loading accounts…';
  userManagementRequest({ action: 'list' }).then(function (result) {
    if (!G('user-management-modal') || G('user-management-modal').style.display === 'none') return;
    renderManagedAccounts(Array.isArray(result.accounts) ? result.accounts : []);
  }).catch(function (error) {
    list.textContent = error.message || 'Could not load accounts.';
  });
}

function renderManagedAccounts(accounts) {
  var list = G('user-management-list');
  if (!list) return;
  list.replaceChildren();
  if (!accounts.length) {
    list.textContent = 'No workspace accounts found.';
    return;
  }
  accounts.sort(function (a, b) {
    return String(a.name || a.email).localeCompare(String(b.name || b.email));
  }).forEach(function (account) {
    var row = document.createElement('div');
    row.className = 'user-management-row';
    var identity = document.createElement('div');
    identity.className = 'user-management-identity';
    var name = document.createElement('strong');
    name.textContent = account.name || account.email || 'Workspace user';
    var details = document.createElement('span');
    details.textContent = (account.email || 'No email') + ' · ' + (account.isAdmin ? 'Admin' : 'Member') + ' · ' + (account.disabled ? 'Disabled' : 'Active');
    identity.append(name, details);
    row.appendChild(identity);

    if (!account.protected && (!account.isAdmin || currentUserIsSuperAdmin())) {
      var actions = document.createElement('div');
      actions.className = 'user-management-actions';
      addAccountAction(actions, account.disabled ? 'Enable' : 'Disable', account.disabled ? 'enable' : 'disable', account);
      addAccountAction(actions, 'Revoke sessions', 'revoke', account);
      addAccountAction(actions, 'Delete', 'delete', account, true);
      row.appendChild(actions);
    }
    list.appendChild(row);
  });
}

function addAccountAction(container, label, action, account, danger) {
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (danger) button.className = 'danger';
  button.onclick = function () { runAccountAction(account, action, button); };
  container.appendChild(button);
}

function runAccountAction(account, action, button) {
  var accountName = account.name || account.email || 'this account';
  var prompts = {
    disable: 'Disable ' + accountName + '? They will no longer be able to sign in.',
    enable: 'Enable ' + accountName + ' so they can sign in again?',
    revoke: 'Revoke refresh tokens for ' + accountName + '? Their other sessions will need to sign in again after current ID tokens expire.',
    delete: 'Permanently delete ' + accountName + "'s Firebase account? This cannot be undone. Existing messages will remain."
  };
  if (!window.confirm(prompts[action])) return;
  button.disabled = true;
  userManagementRequest({ action: action, uid: account.uid }).then(function () {
    toast({ disable: 'Account disabled.', enable: 'Account enabled.', revoke: 'Sessions revoked.', delete: 'Account deleted.' }[action], 'success');
    loadManagedAccounts();
  }).catch(function (error) {
    toast(error.message || 'Could not complete that account action.', 'error');
    button.disabled = false;
  });
}

var accountModal = G('user-management-modal');
if (accountModal) accountModal.addEventListener('click', function (event) {
  if (event.target === accountModal) closeUserManagement();
});

document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape') closeUserManagement();
});
