const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[c]));
let me = null;
let editingNewsId = null;

const roleName = (u) => u.role === 'admin' ? 'Era Heian' : u.role === 'moderator' ? 'Grau Especial' : `Grau ${u.grade}`;
const roleClass = (u) => u.role === 'admin' ? 'heian' : u.role === 'moderator' ? 'special' : 'grade';

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(window.__toast);
  window.__toast = setTimeout(() => t.classList.remove('show'), 2800);
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}

function page(name) {
  if (name === 'members' && !me) {
    $('#membersList').innerHTML = '<article class="empty"><div class="empty-icon">🔒</div><h3>Área de membros</h3><p>Entre na sua conta para ver a lista de membros aprovados.</p><button class="primary" onclick="modal(\'login\')">Entrar</button></article>';
  }
  $$('.page').forEach(p => p.classList.remove('active'));
  const target = $('#' + name);
  if (!target) return;
  target.classList.add('active');
  if (name === 'news') loadNews();
  if (name === 'members') loadMembers();
  if (name === 'events') loadEvents();
  if (name === 'rules') loadRules();
  if (name === 'admin') loadAdmin();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$$('[data-page]').forEach(button => button.addEventListener('click', () => page(button.dataset.page)));

function modal(type = 'login') {
  $('#modal').classList.remove('hidden');
  const login = type === 'login';
  $('#modalContent').innerHTML = `
    <div class="eyebrow">${login ? 'ACESSO' : 'NOVO MEMBRO'}</div>
    <h2>${login ? 'Entrar no portal' : 'Criar conta'}</h2>
    <p class="modal-note">${login ? 'Entre para acessar a área de membros e, se tiver cargo, a gestão.' : 'O primeiro cadastro vira Era Heian. Os próximos aguardam aprovação.'}</p>
    <form id="authForm" class="form">
      <input id="authUser" maxlength="30" placeholder="Usuário" autocomplete="username" required>
      <input id="authPass" type="password" minlength="6" placeholder="Senha (mín. 6 caracteres)" autocomplete="current-password" required>
      <button class="primary">${login ? 'Entrar' : 'Enviar cadastro'}</button>
    </form>
    <button class="switch-auth">${login ? 'Ainda não tenho conta' : 'Já tenho conta'}</button>`;
  $('#authForm').onsubmit = async (event) => {
    event.preventDefault();
    try {
      const data = await api(login ? '/api/login' : '/api/register', {
        method: 'POST',
        body: JSON.stringify({ username: $('#authUser').value, password: $('#authPass').value })
      });
      toast(data.message || 'Login realizado.');
      if (login) {
        me = data.user;
        closeModal();
        updateAccount();
        page('home');
      } else {
        closeModal();
      }
    } catch (error) { toast(error.message); }
  };
  $('.switch-auth').onclick = () => modal(login ? 'register' : 'login');
}

function closeModal() { $('#modal').classList.add('hidden'); }
$('#closeModal').onclick = closeModal;
$('#modal').addEventListener('click', e => { if (e.target === $('#modal')) closeModal(); });
$('#loginOpen').onclick = () => modal('login');
$('#registerOpen').onclick = () => modal('register');

function updateAccount() {
  const account = $('#account');
  $('#adminNav').classList.toggle('hidden', !(me && ['admin','moderator'].includes(me.role)));
  if (!me) {
    account.innerHTML = '<button class="primary" id="loginOpen2">Entrar</button>';
    $('#loginOpen2').onclick = () => modal('login');
    return;
  }
  account.innerHTML = `<div class="account-chip"><span class="avatar">${esc(me.username.charAt(0).toUpperCase())}</span><span><b>${esc(me.username)}</b><small>${roleName(me)}</small></span><button id="logout">Sair</button></div>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };
}

function formatDate(value) { return new Date(value).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }); }
function formatEventDate(value) { return new Date(value).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }); }

async function loadNews() {
  try {
    const list = await api('/api/news');
    $('#newsList').innerHTML = list.length ? list.map(n => `
      <article class="news-card ${n.pinned ? 'pinned' : ''}">
        <div class="news-top"><div class="meta">${n.pinned ? '📌 FIXADA · ' : ''}${esc(n.author || 'Portal')} · ${formatDate(n.created_at)}</div>${me && ['admin','moderator'].includes(me.role) ? `<div class="mini-actions"><button onclick="editNews(${n.id})">Editar</button><button onclick="deleteNews(${n.id})">Excluir</button></div>` : ''}</div>
        <h3>${esc(n.title)}</h3><p>${esc(n.content).replace(/\n/g, '<br>')}</p>
      </article>`).join('') : '<article class="empty"><div class="empty-icon">📰</div><h3>O jornal está vazio</h3><p>As próximas novidades da comunidade aparecerão aqui.</p></article>';
  } catch (e) { toast(e.message); }
}

window.deleteNews = async (id) => {
  if (!confirm('Excluir esta notícia?')) return;
  try { await api('/api/news/' + id, { method: 'DELETE' }); toast('Notícia excluída.'); loadNews(); if (me) loadAdmin(); }
  catch (e) { toast(e.message); }
};

window.editNews = async (id) => {
  try {
    const list = await api('/api/news');
    const n = list.find(x => x.id === id);
    if (!n) return;
    editingNewsId = id;
    $('#newsTitle').value = n.title;
    $('#newsContent').value = n.content;
    $('#newsPinned').checked = n.pinned;
    $('#newsForm button').textContent = 'Salvar alterações';
    $('#newsForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) { toast(e.message); }
};

async function loadMembers() {
  if (!me) return;
  try {
    const list = await api('/api/members');
    $('#membersList').innerHTML = list.map(u => `
      <article class="member-card ${roleClass(u)}">
        <div class="member-avatar">${u.role === 'admin' ? '👑' : u.role === 'moderator' ? '⚔️' : '🩸'}</div>
        <div><b>${esc(u.username)}</b><div class="tag ${roleClass(u)}">${roleName(u)}</div></div>
      </article>`).join('') || '<article class="empty"><h3>Nenhum membro aprovado.</h3></article>';
  } catch (e) { toast(e.message); }
}

async function loadEvents() {
  try {
    const list = await api('/api/events');
    $('#eventsList').innerHTML = list.length ? list.map(e => `
      <article class="event-card">
        <div class="event-date"><b>${new Date(e.event_date).getDate()}</b><span>${new Date(e.event_date).toLocaleDateString('pt-BR',{month:'short'}).replace('.','')}</span></div>
        <div class="event-body"><div class="meta">${formatEventDate(e.event_date)} · ${esc(e.location)}</div><h3>${esc(e.title)}</h3><p>${esc(e.description).replace(/\n/g, '<br>')}</p><small>Publicado por ${esc(e.author || 'Portal')}</small></div>
        ${me && ['admin','moderator'].includes(me.role) ? `<button class="event-delete" onclick="deleteEvent(${e.id})">×</button>` : ''}
      </article>`).join('') : '<article class="empty"><div class="empty-icon">📅</div><h3>Nenhum evento marcado</h3><p>A agenda da comunidade aparecerá aqui.</p></article>';
  } catch (e) { toast(e.message); }
}
window.deleteEvent = async (id) => { if (!confirm('Excluir este evento?')) return; try { await api('/api/events/' + id, { method:'DELETE' }); toast('Evento excluído.'); loadEvents(); } catch(e) { toast(e.message); } };

async function loadRules() {
  try {
    const data = await api('/api/rules');
    $('#rulesContent').innerHTML = esc(data.content).split('\n').filter(Boolean).map((line, i) => `<div class="rule-line"><span>${String(i+1).padStart(2,'0')}</span><p>${line}</p></div>`).join('');
    if ($('#rulesEditor')) $('#rulesEditor').value = data.content;
  } catch (e) { toast(e.message); }
}

async function loadAdmin() {
  if (!me || !['admin','moderator'].includes(me.role)) { page('home'); return; }
  try {
    if (me.role === 'admin') {
      const [pending, users, rules] = await Promise.all([api('/api/admin/pending'), api('/api/admin/users'), api('/api/rules')]);
      $('#pendingList').innerHTML = pending.length ? pending.map(u => `<div class="pending"><div><b>${esc(u.username)}</b><small>Cadastro em ${formatDate(u.created_at)}</small></div><div><button class="icon-btn approve" onclick="decide(${u.id},'approved')">✓</button><button class="icon-btn reject" onclick="decide(${u.id},'rejected')">×</button></div></div>`).join('') : '<div class="empty-small">Nenhum cadastro pendente.</div>';
      $('#usersList').innerHTML = users.map(u => `<div class="user-row"><div class="user-info"><span class="user-dot ${roleClass(u)}">${u.role === 'admin' ? '👑' : u.role === 'moderator' ? '⚔️' : '🩸'}</span><div><b>${esc(u.username)}</b><small>${esc(u.status)}</small></div></div><div class="role-controls"><select id="role-${u.id}"><option value="admin" ${u.role==='admin'?'selected':''}>Era Heian</option><option value="moderator" ${u.role==='moderator'?'selected':''}>Grau Especial</option><option value="member" ${u.role==='member'?'selected':''}>Membro</option></select><select id="grade-${u.id}"><option value="1" ${u.grade===1?'selected':''}>Grau 1</option><option value="2" ${u.grade===2?'selected':''}>Grau 2</option><option value="3" ${u.grade===3?'selected':''}>Grau 3</option><option value="4" ${u.grade===4?'selected':''}>Grau 4</option></select><button onclick="saveRole(${u.id})">Salvar</button>${u.id !== me.id ? `<button class="danger" onclick="removeUser(${u.id})">Remover</button>` : ''}</div></div>`).join('');
      $('#rulesEditor').value = rules.content || '';
    } else {
      $('.admin-grid').classList.add('moderator-view');
      document.querySelectorAll('.admin-grid > .full').forEach((el, i) => { if (i < 2 || i === 4) el.classList.add('hidden'); });
    }
  } catch (e) { toast(e.message); }
}

window.decide = async (id, decision) => { try { await api('/api/admin/users/' + id + '/decision', { method:'POST', body: JSON.stringify({ decision }) }); toast(decision === 'approved' ? 'Membro aprovado!' : 'Cadastro rejeitado.'); loadAdmin(); } catch(e) { toast(e.message); } };
window.saveRole = async (id) => { try { const role = $('#role-' + id).value; const grade = Number($('#grade-' + id).value); await api('/api/admin/users/' + id, { method:'PUT', body:JSON.stringify({ role, grade }) }); toast('Cargo atualizado.'); if (id === me.id) { me.role = role; me.grade = grade; updateAccount(); } loadAdmin(); loadMembers(); } catch(e) { toast(e.message); } };
window.removeUser = async (id) => { if (!confirm('Remover este usuário permanentemente?')) return; try { await api('/api/admin/users/' + id, { method:'DELETE' }); toast('Usuário removido.'); loadAdmin(); } catch(e) { toast(e.message); } };

$('#newsForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const payload = { title: $('#newsTitle').value, content: $('#newsContent').value, pinned: $('#newsPinned').checked };
    await api(editingNewsId ? '/api/news/' + editingNewsId : '/api/news', { method: editingNewsId ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    e.target.reset(); editingNewsId = null; $('#newsForm button').textContent = 'Publicar notícia'; toast('Notícia salva!'); loadNews(); loadAdmin();
  } catch(e) { toast(e.message); }
};

$('#eventForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    await api('/api/events', { method:'POST', body:JSON.stringify({ title:$('#eventTitle').value, event_date:$('#eventDate').value, location:$('#eventLocation').value, description:$('#eventDescription').value }) });
    e.target.reset(); toast('Evento criado!'); loadEvents();
  } catch(e) { toast(e.message); }
};

$('#rulesForm').onsubmit = async (e) => {
  e.preventDefault();
  try { await api('/api/rules', { method:'PUT', body:JSON.stringify({ content:$('#rulesEditor').value }) }); toast('Regras salvas!'); loadRules(); }
  catch(e) { toast(e.message); }
};

async function init() {
  try { me = (await api('/api/me')).user; updateAccount(); } catch {}
  loadNews();
  loadEvents();
  loadRules();
}
init();
