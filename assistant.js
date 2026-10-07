var workspaceAssistant = {
  messages: [],
  busy: false
};

function assistantPageName() {
  return location.pathname.toLowerCase().indexOf('feed.html') !== -1 ? 'feed' : 'chat';
}

function assistantBuildContext() {
  var page = assistantPageName();
  var context = {
    page: page,
    activeConversation: '',
    recentMessages: [],
    feedPosts: []
  };

  if (page === 'chat' && typeof ac !== 'undefined' && ac) {
    var active = ac;
    context.activeConversation = (active.type === 'channel' ? '#' : '') + (active.name || 'conversation');
    var query = active.type === 'channel'
      ? db.collection('channels').doc(active.id).collection('messages')
      : db.collection('conversations').doc(cid(me.uid, active.uid)).collection('messages');

    return query.orderBy('createdAt', 'desc').limit(12).get().then(function (snapshot) {
      var rows = [];
      snapshot.forEach(function (doc) {
        var message = doc.data() || {};
        if (typeof message.text !== 'string' || !message.text.trim()) return;
        var sender = message.senderUid === me.uid ? 'Me' : (message.senderName || 'Teammate');
        rows.push(sender + ': ' + message.text.slice(0, 700));
      });
      context.recentMessages = rows.reverse();
      return context;
    });
  }

  if (page === 'feed' && typeof postsCache !== 'undefined') {
    context.feedPosts = postsCache.slice(0, 8).map(function (post) {
      var author = post.authorName || 'Teammate';
      var tag = post.tag || 'update';
      return '[' + tag + '] ' + author + ': ' + String(post.text || '').slice(0, 450);
    });
  }
  return Promise.resolve(context);
}

function assistantAddMessage(role, text, draft) {
  var list = document.getElementById('workspace-ai-messages');
  var item = document.createElement('article');
  item.className = 'workspace-ai-message ' + (role === 'user' ? 'from-user' : 'from-assistant') +
    (role === 'error' ? ' is-error' : '');

  var label = document.createElement('span');
  label.className = 'workspace-ai-message-label';
  label.textContent = role === 'user' ? 'You' : (role === 'error' ? 'Assistant unavailable' : 'Workspace assistant');
  var body = document.createElement('div');
  body.className = 'workspace-ai-message-body';
  body.textContent = text;
  item.appendChild(label);
  item.appendChild(body);

  if (draft && typeof draft.text === 'string' && draft.text.trim()) {
    var draftCard = document.createElement('div');
    draftCard.className = 'workspace-ai-draft';
    var draftLabel = document.createElement('span');
    draftLabel.className = 'workspace-ai-draft-label';
    draftLabel.textContent = draft.type === 'feed' ? 'Suggested feed draft' : 'Suggested chat draft';
    var draftBody = document.createElement('div');
    draftBody.className = 'workspace-ai-draft-body';
    draftBody.textContent = draft.text;
    var useButton = document.createElement('button');
    useButton.className = 'workspace-ai-use-draft';
    useButton.type = 'button';
    useButton.textContent = 'Use draft';
    useButton.addEventListener('click', function () {
      assistantApplyDraft(draft);
    });
    draftCard.appendChild(draftLabel);
    draftCard.appendChild(draftBody);
    draftCard.appendChild(useButton);
    item.appendChild(draftCard);
  }

  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
}

function assistantSetBusy(busy) {
  workspaceAssistant.busy = busy;
  var input = document.getElementById('workspace-ai-input');
  var send = document.getElementById('workspace-ai-send');
  var status = document.getElementById('workspace-ai-status');
  input.disabled = busy;
  send.disabled = busy || !input.value.trim();
  status.textContent = busy ? 'Thinking…' : '';
  document.getElementById('workspace-ai-panel').setAttribute('aria-busy', busy ? 'true' : 'false');
}

function assistantSetInput(text) {
  var input = document.getElementById('workspace-ai-input');
  input.value = text;
  input.focus();
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  document.getElementById('workspace-ai-send').disabled = workspaceAssistant.busy || !text.trim();
}

function assistantSetMode() {
  var panel = document.getElementById('workspace-ai-panel');
  if (!panel || panel.hidden) {
    if (panel) {
      panel.setAttribute('role', 'complementary');
      panel.removeAttribute('aria-modal');
    }
    return;
  }

  var compactLayout = window.matchMedia('(max-width: 960px)').matches;
  panel.setAttribute('role', compactLayout ? 'dialog' : 'complementary');
  if (compactLayout) panel.setAttribute('aria-modal', 'true');
  else panel.removeAttribute('aria-modal');
}

function assistantAsk(prompt) {
  if (workspaceAssistant.busy) return;
  var input = document.getElementById('workspace-ai-input');
  var text = (typeof prompt === 'string' ? prompt : input.value).trim();
  if (!text) return;
  if (typeof me === 'undefined' || !me) {
    assistantAddMessage('error', 'Please sign in to use the workspace assistant.');
    return;
  }

  assistantAddMessage('user', text);
  input.value = '';
  input.style.height = 'auto';
  var history = workspaceAssistant.messages.slice(-7);
  history.push({ role: 'user', content: text });
  workspaceAssistant.messages.push({ role: 'user', content: text });
  assistantSetBusy(true);

  assistantBuildContext()
    .then(function (context) {
      return me.getIdToken().then(function (token) {
        return fetch('/api/ai/assistant', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
          },
          body: JSON.stringify({ messages: history, context: context })
        });
      });
    })
    .then(function (response) {
      return response.json().catch(function () {
        throw new Error('The assistant service returned an unreadable response.');
      }).then(function (data) {
        if (!response.ok) throw new Error(data.error || 'The assistant request failed (' + response.status + ').');
        return data;
      });
    })
    .then(function (data) {
      if (!data || typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('The assistant returned an empty response. Please try again.');
      }
      var assistantMessage = { role: 'assistant', content: data.reply };
      workspaceAssistant.messages.push(assistantMessage);
      assistantAddMessage('assistant', data.reply, data.draft ? {
        text: data.draft,
        type: data.draftType,
        tag: data.tag
      } : null);
    })
    .catch(function (error) {
      var latest = workspaceAssistant.messages[workspaceAssistant.messages.length - 1];
      if (latest && latest.role === 'user' && latest.content === text) workspaceAssistant.messages.pop();
      console.error('Workspace assistant request failed:', error);
      assistantAddMessage('error', error.message || 'Could not reach the workspace assistant. Please try again.');
    })
    .then(function () {
      assistantSetBusy(false);
      input.focus();
    });
}

function assistantApplyDraft(draft) {
  var destination = draft.type === 'feed' ? 'feed' : 'chat';
  if (destination !== assistantPageName()) {
    try {
      sessionStorage.setItem('workspace-ai-draft', JSON.stringify(draft));
    } catch (error) {
      console.error('Could not save the workspace assistant draft for navigation:', error);
      assistantAddMessage('error', 'Could not carry this draft to the other workspace page. Copy the draft text and open that page.');
      return;
    }
    location.href = destination === 'feed' ? 'feed.html' : 'dashboard.html';
    return;
  }

  var target = document.getElementById(destination === 'feed' ? 'ptext' : 'minp');
  if (!target) {
    assistantAddMessage('error', 'The draft composer is not available on this page.');
    return;
  }
  target.value = draft.text;
  if (destination === 'chat' && typeof updSend === 'function') updSend();
  if (destination === 'feed' && draft.tag) {
    var tagSelect = document.getElementById('ptag');
    if (tagSelect && Array.prototype.some.call(tagSelect.options, function (option) { return option.value === draft.tag; })) {
      tagSelect.value = draft.tag;
    }
  }
  assistantToggle(false);
  target.focus();
  toast('Draft added to the composer. Review it before sending or posting.', 'success');
}

function assistantToggle(forceOpen) {
  var panel = document.getElementById('workspace-ai-panel');
  var open = typeof forceOpen === 'boolean' ? forceOpen : panel.hidden;
  panel.hidden = !open;
  var dash = document.getElementById('dash');
  dash.classList.toggle('workspace-ai-open', open);
  document.querySelectorAll('[data-assistant-toggle]').forEach(function (button) {
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  assistantSetMode();
  if (open) {
    if (window.matchMedia('(max-width: 960px)').matches && typeof toggleMobileMenu === 'function') {
      toggleMobileMenu(false);
    }
    document.getElementById('workspace-ai-input').focus();
  } else {
    var navButton = window.matchMedia('(max-width: 960px)').matches
      ? document.getElementById('mobile-menu-toggle')
      : document.querySelector('[data-assistant-toggle]');
    if (navButton) navButton.focus();
  }
}

function assistantRender() {
  if (document.getElementById('workspace-ai')) return;
  var root = document.createElement('div');
  root.id = 'workspace-ai';
  root.innerHTML = [
    '<aside id="workspace-ai-panel" class="workspace-ai-panel" aria-label="Workspace assistant" aria-busy="false" role="complementary" hidden>',
    '  <header class="workspace-ai-header">',
    '    <div class="workspace-ai-heading"><span class="workspace-ai-mark" aria-hidden="true">✦</span><div><h2>Workspace assistant</h2><p>Ask, plan, summarize, or draft</p></div></div>',
    '    <div class="workspace-ai-header-actions"><button id="workspace-ai-clear" class="workspace-ai-icon-button" type="button" title="Clear this conversation" aria-label="Clear this conversation">Clear</button><button id="workspace-ai-close" class="workspace-ai-icon-button" type="button" title="Close assistant" aria-label="Close assistant">×</button></div>',
    '  </header>',
    '  <div id="workspace-ai-messages" class="workspace-ai-messages" role="log" aria-live="polite">',
    '    <div class="workspace-ai-welcome"><strong>How can I help?</strong><p>I can help with your workspace, summarize the context on this page, plan work, and draft chat or feed text. Recent page context may be sent to GroqCloud to answer. I will never send or post for you.</p></div>',
    '  </div>',
    '  <div class="workspace-ai-quick-prompts" aria-label="Suggested questions">',
    '    <button type="button" data-prompt="Summarize the recent context on this page.">Summarize this page</button>',
    '    <button type="button" data-prompt="Help me plan my next steps for work.">Plan next steps</button>',
    '    <button type="button" data-prompt="Draft a professional update for the company feed based on the information I provide. Ask me for details you need.">Draft a feed update</button>',
    '  </div>',
    '  <form id="workspace-ai-form" class="workspace-ai-form">',
    '    <label class="workspace-ai-sr-only" for="workspace-ai-input">Ask the workspace assistant</label>',
    '    <textarea id="workspace-ai-input" rows="1" maxlength="1200" placeholder="Ask anything about your work…" autocomplete="off"></textarea>',
    '    <button id="workspace-ai-send" type="submit" aria-label="Send message" disabled><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"/></svg></button>',
    '  </form>',
    '  <div class="workspace-ai-foot"><span id="workspace-ai-status" role="status"></span><span>AI can be wrong. Review drafts before use.</span></div>',
    '</aside>'
  ].join('');
  document.getElementById('dash').appendChild(root);

  document.querySelectorAll('[data-assistant-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      assistantToggle(true);
    });
  });
  document.getElementById('workspace-ai-close').addEventListener('click', function () {
    assistantToggle(false);
  });
  document.getElementById('workspace-ai-clear').addEventListener('click', function () {
    workspaceAssistant.messages = [];
    var list = document.getElementById('workspace-ai-messages');
    list.innerHTML = '<div class="workspace-ai-welcome"><strong>How can I help?</strong><p>I can help with your workspace, summarize the context on this page, plan work, and draft chat or feed text. Recent page context may be sent to GroqCloud to answer. I will never send or post for you.</p></div>';
  });
  document.getElementById('workspace-ai-form').addEventListener('submit', function (event) {
    event.preventDefault();
    assistantAsk();
  });
  document.getElementById('workspace-ai-input').addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 140) + 'px';
    document.getElementById('workspace-ai-send').disabled = workspaceAssistant.busy || !this.value.trim();
  });
  document.getElementById('workspace-ai-input').addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      assistantAsk();
    }
  });
  root.querySelectorAll('[data-prompt]').forEach(function (button) {
    button.addEventListener('click', function () {
      assistantAsk(button.getAttribute('data-prompt'));
    });
  });
  document.addEventListener('keydown', function (event) {
    var panel = document.getElementById('workspace-ai-panel');
    if (panel.hidden) return;
    if (event.key === 'Escape') {
      assistantToggle(false);
      return;
    }
    if (event.key !== 'Tab' || !window.matchMedia('(max-width: 960px)').matches) return;
    var focusable = panel.querySelectorAll('button:not(:disabled), textarea:not(:disabled)');
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  window.addEventListener('resize', assistantSetMode);

  try {
    var storedDraft = sessionStorage.getItem('workspace-ai-draft');
    if (storedDraft) {
      sessionStorage.removeItem('workspace-ai-draft');
      var draft = JSON.parse(storedDraft);
      if (draft && ['chat', 'feed'].includes(draft.type) && typeof draft.text === 'string') {
        assistantApplyDraft(draft);
      }
    }
  } catch (error) {
    console.error('Could not restore a workspace assistant draft:', error);
    assistantAddMessage('error', 'Could not restore the draft. Please ask the assistant to create it again.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', assistantRender);
} else {
  assistantRender();
}
