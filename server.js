const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: process.env.DATABASE_URL
    ? new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true })
    : undefined,
  secret: process.env.SESSION_SECRET || 'troque-esta-chave-no-deploy',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
  }
}));

async function db(query, params = []) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada.');
  return pool.query(query, params);
}

async function init() {
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL não configurada. O servidor sobe, mas os dados precisam de PostgreSQL.');
    return;
  }

  await db(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','moderator','member')),
    grade INTEGER NOT NULL DEFAULT 4 CHECK (grade BETWEEN 1 AND 4),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await db(`CREATE TABLE IF NOT EXISTS news (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  // Migração automática para bancos criados pela versão anterior do portal.
  await db(`ALTER TABLE news ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE`);
  await db(`ALTER TABLE news ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  await db(`CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    event_date TIMESTAMPTZ NOT NULL,
    location TEXT NOT NULL DEFAULT 'Grupo do Instagram',
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await db(`CREATE TABLE IF NOT EXISTS site_rules (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);

  await db(`INSERT INTO site_rules (id, content) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [
    'Respeite todos os membros.\nEvite spam, brigas e conteúdo que prejudique a comunidade.\nSiga as orientações da moderação.\nUse o espaço do grupo para conversar sobre Jujutsu Kaisen e assuntos da comunidade.'
  ]);
}

const auth = (req, res, next) => {
  if (req.session.user) return next();
  return res.status(401).json({ error: 'Faça login primeiro.' });
};

const approved = (req, res, next) => {
  if (req.session.user?.status === 'approved') return next();
  return res.status(401).json({ error: 'Faça login primeiro.' });
};

const admin = (req, res, next) => {
  if (req.session.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Acesso restrito à Era Heian.' });
};

const staff = (req, res, next) => {
  if (['admin', 'moderator'].includes(req.session.user?.role)) return next();
  return res.status(403).json({ error: 'Acesso restrito à moderação.' });
};

function clean(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/register', async (req, res) => {
  try {
    const username = clean(req.body.username, 30);
    const password = String(req.body.password || '');
    if (!/^[\p{L}\p{N}_.-]{3,30}$/u.test(username)) {
      return res.status(400).json({ error: 'O usuário deve ter 3–30 caracteres e usar apenas letras, números, ponto, hífen ou _. ' });
    }
    if (password.length < 6 || password.length > 100) {
      return res.status(400).json({ error: 'A senha precisa ter entre 6 e 100 caracteres.' });
    }

    const count = await db('SELECT COUNT(*)::int AS n FROM users');
    const first = count.rows[0].n === 0;
    const hash = await bcrypt.hash(password, 12);
    await db(
      'INSERT INTO users(username,password_hash,role,grade,status) VALUES($1,$2,$3,$4,$5)',
      [username, hash, first ? 'admin' : 'member', first ? 1 : 4, first ? 'approved' : 'pending']
    );

    res.json({
      ok: true,
      message: first
        ? 'Conta criada como administrador da Era Heian.'
        : 'Cadastro enviado. Aguarde a aprovação da Era Heian.'
    });
  } catch (e) {
    res.status(e.code === '23505' ? 409 : 500).json({
      error: e.code === '23505' ? 'Esse usuário já existe.' : 'Erro ao criar conta.'
    });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const username = clean(req.body.username, 30);
    const password = String(req.body.password || '');
    const result = await db(
      'SELECT id,username,password_hash,role,grade,status FROM users WHERE username=$1',
      [username]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
    }
    if (user.status !== 'approved') {
      return res.status(403).json({
        error: `Seu cadastro está ${user.status === 'pending' ? 'pendente' : 'rejeitado'}.`
      });
    }
    req.session.user = {
      id: user.id,
      username: user.username,
      role: user.role,
      grade: user.grade,
      status: user.status
    };
    res.json({ ok: true, user: req.session.user });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao entrar.' });
  }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

// Jornal
app.get('/api/news', async (req, res) => {
  try {
    const result = await db(`
      SELECT n.id,n.title,n.content,n.pinned,n.created_at,n.updated_at,u.username author
      FROM news n LEFT JOIN users u ON u.id=n.author_id
      ORDER BY n.pinned DESC,n.created_at DESC
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Não foi possível carregar o jornal.' });
  }
});

app.post('/api/news', staff, async (req, res) => {
  try {
    const title = clean(req.body.title, 120);
    const content = clean(req.body.content, 10000);
    const pinned = Boolean(req.body.pinned);
    if (!title || !content) return res.status(400).json({ error: 'Preencha título e conteúdo.' });
    if (pinned) await db('UPDATE news SET pinned=false WHERE pinned=true');
    await db('INSERT INTO news(title,content,pinned,author_id) VALUES($1,$2,$3,$4)', [
      title, content, pinned, req.session.user.id
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao publicar.' });
  }
});

app.put('/api/news/:id', staff, async (req, res) => {
  try {
    const title = clean(req.body.title, 120);
    const content = clean(req.body.content, 10000);
    const pinned = Boolean(req.body.pinned);
    if (!title || !content) return res.status(400).json({ error: 'Preencha título e conteúdo.' });
    if (pinned) await db('UPDATE news SET pinned=false WHERE pinned=true AND id<>$1', [req.params.id]);
    await db('UPDATE news SET title=$1,content=$2,pinned=$3,updated_at=NOW() WHERE id=$4', [title, content, pinned, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao editar notícia.' });
  }
});

app.delete('/api/news/:id', staff, async (req, res) => {
  try {
    await db('DELETE FROM news WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao excluir notícia.' });
  }
});

// Membros
app.get('/api/members', approved, async (req, res) => {
  try {
    const result = await db(`
      SELECT id,username,role,grade,created_at
      FROM users WHERE status='approved'
      ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END, grade ASC, created_at ASC
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao carregar membros.' });
  }
});

// Eventos
app.get('/api/events', async (req, res) => {
  try {
    const result = await db(`
      SELECT e.id,e.title,e.description,e.event_date,e.location,e.created_at,u.username author
      FROM events e LEFT JOIN users u ON u.id=e.author_id
      ORDER BY e.event_date ASC
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao carregar eventos.' });
  }
});

app.post('/api/events', staff, async (req, res) => {
  try {
    const title = clean(req.body.title, 120);
    const description = clean(req.body.description, 5000);
    const location = clean(req.body.location, 120) || 'Grupo do Instagram';
    const date = new Date(req.body.event_date);
    if (!title || !description || Number.isNaN(date.getTime())) {
      return res.status(400).json({ error: 'Preencha título, descrição e uma data válida.' });
    }
    await db('INSERT INTO events(title,description,event_date,location,author_id) VALUES($1,$2,$3,$4,$5)', [
      title, description, date.toISOString(), location, req.session.user.id
    ]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao criar evento.' });
  }
});

app.delete('/api/events/:id', staff, async (req, res) => {
  try {
    await db('DELETE FROM events WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao excluir evento.' });
  }
});

// Regras
app.get('/api/rules', async (req, res) => {
  try {
    const result = await db('SELECT content,updated_at FROM site_rules WHERE id=1');
    res.json(result.rows[0] || { content: '' });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao carregar as regras.' });
  }
});

app.put('/api/rules', admin, async (req, res) => {
  try {
    const content = clean(req.body.content, 12000);
    if (!content) return res.status(400).json({ error: 'As regras não podem ficar vazias.' });
    await db('UPDATE site_rules SET content=$1,updated_at=NOW() WHERE id=1', [content]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao salvar as regras.' });
  }
});

// Administração
app.get('/api/admin/pending', admin, async (req, res) => {
  try {
    const result = await db("SELECT id,username,created_at FROM users WHERE status='pending' ORDER BY created_at ASC");
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao carregar pendentes.' });
  }
});

app.post('/api/admin/users/:id/decision', admin, async (req, res) => {
  try {
    if (!['approved', 'rejected'].includes(req.body.decision)) {
      return res.status(400).json({ error: 'Decisão inválida.' });
    }
    await db('UPDATE users SET status=$1 WHERE id=$2', [req.body.decision, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar cadastro.' });
  }
});

app.get('/api/admin/users', admin, async (req, res) => {
  try {
    const result = await db(`
      SELECT id,username,role,grade,status,created_at
      FROM users ORDER BY CASE status WHEN 'pending' THEN 1 WHEN 'approved' THEN 2 ELSE 3 END, username ASC
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Erro ao carregar usuários.' });
  }
});

app.put('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const role = ['admin', 'moderator', 'member'].includes(req.body.role) ? req.body.role : null;
    const grade = Number(req.body.grade);
    if (!role || ![1, 2, 3, 4].includes(grade)) return res.status(400).json({ error: 'Cargo ou grau inválido.' });
    if (id === req.session.user.id && role !== 'admin') return res.status(400).json({ error: 'Você não pode retirar o próprio cargo de administrador.' });
    await db('UPDATE users SET role=$1,grade=$2 WHERE id=$3', [role, grade, id]);
    if (id === req.session.user.id) {
      req.session.user.role = role;
      req.session.user.grade = grade;
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao atualizar cargo.' });
  }
});

app.delete('/api/admin/users/:id', admin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.session.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
    await db('DELETE FROM users WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erro ao remover membro.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

init()
  .then(() => app.listen(PORT, () => console.log(`Portal JJK online na porta ${PORT}`)))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
