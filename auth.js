var authMode = 'login';

function showErr(id, msg) {
  var el = G('e' + id), inp = G('i' + id);
  if (el) { el.textContent = msg || ''; }
  if (inp) { msg ? inp.classList.add('bad') : inp.classList.remove('bad'); }
}

function clearErrs() {
  ['name', 'email', 'pass'].forEach(function (f) { showErr(f, ''); });
}

function switchTab(mode) {
  if (mode === 'signup') {
    window.location.href = 'vgf-applicant.html';
    return;
  }
  authMode = mode;
  G('tl').classList.toggle('on', mode === 'login');
  G('ts').classList.toggle('on', mode === 'signup');
  G('nf').style.display = mode === 'signup' ? 'block' : 'none';
  G('fw').style.display = mode === 'login' ? 'block' : 'none';
  G('sbtn').textContent = mode === 'login' ? 'Sign In →' : 'Create Account →';
  G('ipass').placeholder = mode === 'signup' ? 'Min. 6 characters' : 'Enter your password';
  clearErrs();
}

function togglePass(btn) {
  var inp = G('ipass');
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
}

function forgotPw() {
  var email = G('iemail').value.trim();
  if (!email) { showErr('email', 'Enter your email first.'); return; }
  auth.sendPasswordResetEmail(email)
    .then(function () { toast('Password reset email sent!', 'success'); })
    .catch(function (e) { toast(e.message); });
}

function doAuth() {
  if (authMode === 'signup') { window.location.href = 'vgf-applicant.html'; return; }
  clearErrs();
  var email = G('iemail').value.trim();
  var pass = G('ipass').value;
  var name = G('iname') ? G('iname').value.trim() : '';
  var ok = true;
  if (authMode === 'signup' && !name) { showErr('name', 'Full name is required.'); ok = false; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showErr('email', 'Enter a valid email.'); ok = false; }
  if (!pass || pass.length < 6) { showErr('pass', 'Minimum 6 characters.'); ok = false; }
  if (!ok) return;
  var btn = G('sbtn'); btn.disabled = true; btn.textContent = 'Please wait...';
  if (authMode === 'signup') {
    auth.createUserWithEmailAndPassword(email, pass)
      .then(function (c) {
        return c.user.updateProfile({ displayName: name }).then(function () {
          return db.collection('users').doc(c.user.uid).set({
            name: name, email: email, uid: c.user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
      })
      .then(function () { toast('Account created! Welcome', 'success'); })
      .catch(function (e) { toast(e.message); btn.disabled = false; btn.textContent = 'Create Account →'; });
  } else {
    auth.signInWithEmailAndPassword(email, pass)
      .then(function () { toast('Welcome back!', 'success'); })
      .catch(function (e) {
        var m = { 'auth/user-not-found': 'No account found.', 'auth/wrong-password': 'Wrong password.', 'auth/invalid-credential': 'Invalid email or password.', 'auth/too-many-requests': 'Too many attempts.' };
        toast(m[e.code] || e.message); btn.disabled = false; btn.textContent = 'Sign In →';
      });
  }
}

function doGoogle() {
  var p = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(p)
    .then(function (r) {
      return db.collection('users').doc(r.user.uid).set({
        name: r.user.displayName || r.user.email, email: r.user.email, uid: r.user.uid
      }, { merge: true });
    })
    .then(function () { toast('Signed in with Google!', 'success'); })
    .catch(function (e) { toast('Google sign-in failed: ' + e.message); });
}

auth.onAuthStateChanged(function (user) {
  if (user) {
    me = user;
    user.getIdTokenResult(true).then(function (token) {
      if (token.claims.vgfApplicant === true) { window.location.href = 'vgf-applicant.html'; return; }
      if (token.claims.vgfPartner === true) { window.location.href = 'vgf-partner.html'; return; }
      if (token.claims.vgfWorkspace === true || currentUserIsSuperAdmin()) {
        var returnToHr = '';
        try { returnToHr = sessionStorage.getItem('hr-return-to') || ''; } catch (_) {}
        if (returnToHr.indexOf('hr.html') === 0) {
          try { sessionStorage.removeItem('hr-return-to'); } catch (_) {}
          window.location.href = returnToHr;
          return;
        }
        window.location.href = '/dashboard';
        return;
      }
      db.collection('workspaceAdmins').doc(user.uid).get().then(function (role) {
        if (role.exists && role.data().enabled === true) window.location.href = '/dashboard';
        else auth.signOut().then(function () { toast('This account has no access to the staff workspace. Applicants and partners can use their dedicated portals.'); });
      }).catch(function () { auth.signOut().then(function () { toast('This account has no access to the staff workspace.'); }); });
    }).catch(function () { auth.signOut(); });
  }
});
