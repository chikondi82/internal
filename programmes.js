(function () {
  var list = document.getElementById('programmes');
  fetch('/api/vgf/programmes').then(function (response) {
    return response.json().then(function (data) { if (!response.ok) throw new Error(data.error || 'Could not load programmes.'); return data; });
  }).then(function (data) {
    list.replaceChildren();
    var programmes = data.programmes || [];
    if (!programmes.length) { var empty = document.createElement('div'); empty.className = 'empty-state'; empty.textContent = 'There are no open opportunities at the moment. Please check again later.'; list.appendChild(empty); return; }
    programmes.forEach(function (programme) {
      var card = document.createElement('article'); card.className = 'programme-card';
      var title = document.createElement('h2'); title.textContent = programme.name || 'VGF Programme'; card.appendChild(title);
      var description = document.createElement('p'); description.textContent = programme.description || ''; card.appendChild(description);
      var dl = document.createElement('dl');
      [['Eligibility', programme.eligibility], ['Who the programme serves', programme.targetBeneficiaries], ['Coverage', programme.coverage], ['Available places', programme.places == null ? '' : String(programme.places)]].forEach(function (pair) {
        if (!pair[1]) return;
        var wrap = document.createElement('div'); var dt = document.createElement('dt'); dt.textContent = pair[0]; var dd = document.createElement('dd'); dd.textContent = pair[1]; wrap.append(dt, dd); dl.appendChild(wrap);
      });
      card.appendChild(dl);
      var deadline = document.createElement('p'); deadline.className = 'programme-deadline'; deadline.textContent = programme.closingDate ? 'Applications close ' + programme.closingDate : 'Applications are open'; card.appendChild(deadline);
      var link = document.createElement('a'); link.className = 'primary'; link.href = 'vgf-applicant.html?programme=' + encodeURIComponent(programme.id); link.textContent = 'Apply to this programme'; card.appendChild(link);
      list.appendChild(card);
    });
  }).catch(function (error) { list.replaceChildren(); var message = document.createElement('div'); message.className = 'empty-state'; message.textContent = error.message; list.appendChild(message); });
}());
