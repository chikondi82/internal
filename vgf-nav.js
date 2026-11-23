auth.onAuthStateChanged(function (user) {
  var link = document.getElementById('vgf-programme-nav');
  if (link) link.style.display = user && currentUserIsSuperAdmin() ? '' : 'none';
});
