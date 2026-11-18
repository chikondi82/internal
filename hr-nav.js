(function () {
  var hrLink = document.getElementById('hr-crm-nav');
  var unreadBadge = document.getElementById('my-hr-unread-badge');
  var myHrLinks = document.querySelectorAll('.my-hr-link, .reports-hr-link');
  if (typeof auth === 'undefined' || typeof db === 'undefined') return;
  var subscriptions = [];

  auth.onAuthStateChanged(function (user) {
    subscriptions.forEach(function (unsubscribe) { unsubscribe(); });
    subscriptions = [];
    if (hrLink) hrLink.style.display = 'none';
    if (unreadBadge) unreadBadge.hidden = true;
    if (!user) return;
    var currentUid = user.uid;
    var superAdmin = String(user.email || '').toLowerCase() === 'chikondigahimbare@gmail.com';
    myHrLinks.forEach(function (link) { link.style.display = superAdmin ? 'none' : ''; });
    if (hrLink && superAdmin) hrLink.style.display = '';
    if (hrLink && !superAdmin) {
      db.collection('hrAccess').doc(currentUid).get().then(function (role) {
        if (auth.currentUser && auth.currentUser.uid === currentUid && role.exists && role.data().enabled === true) {
          hrLink.style.display = '';
        }
      }).catch(function (error) {
        console.error('Could not check HR navigation access:', error && error.code || error);
      });
    }
    if (unreadBadge) {
      var primed = false;
      subscriptions.push(db.collection('hrNotifications').doc(currentUid).collection('items')
        .where('isRead', '==', false).onSnapshot(function (snapshot) {
          if (!auth.currentUser || auth.currentUser.uid !== currentUid) return;
          unreadBadge.textContent = snapshot.size > 99 ? '99+' : String(snapshot.size);
          unreadBadge.hidden = snapshot.empty;
          if (primed && snapshot.docChanges().some(function (change) { return change.type === 'added'; })) {
            toast('A new HR update is waiting in My HR.', 'success');
          }
          primed = true;
        }, function (error) {
          console.error('Could not load unread HR updates:', error && error.code || error);
        }));
    }
  });
}());
