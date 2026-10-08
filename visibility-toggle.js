(function () {
  var storageKey = 'internal-high-visibility';
  var enabled = false;
  try {
    enabled = localStorage.getItem(storageKey) === 'on';
  } catch (error) {
    console.warn('High visibility preference could not be loaded:', error);
  }

  function setHighVisibility(value) {
    enabled = value;
    document.documentElement.classList.toggle('high-visibility', enabled);
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? 'On' : 'Off';
    try {
      localStorage.setItem(storageKey, enabled ? 'on' : 'off');
    } catch (error) {
      console.warn('High visibility preference could not be saved:', error);
    }
  }

  var toggle = document.createElement('button');
  toggle.id = 'visibility-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'High visibility mode');
  toggle.setAttribute('aria-pressed', 'false');
  toggle.addEventListener('click', function () {
    setHighVisibility(!enabled);
  });
  var header = document.querySelector('.wk-row');
  var logoutButton = header && header.querySelector('button[onclick="doLogout()"]');
  if (header && logoutButton) header.insertBefore(toggle, logoutButton);
  else document.body.appendChild(toggle);
  setHighVisibility(enabled);
}());
