# Portal JJK — Comunidade

Portal completo para grupo de Jujutsu Kaisen, com login, aprovação de membros, cargos, jornal, eventos, regras e painel de administração.

## Recursos

- 🏯 **Era Heian** — administrador do portal
- ⚔️ **Grau Especial** — moderador
- 🩸 **Grau 1, 2, 3 e 4** — membros
- 📰 Jornal com notícia fixada, edição e exclusão
- 👥 Lista de membros para contas aprovadas
- 📅 Agenda de eventos
- 📜 Regras editáveis pela administração
- 🔐 Senhas protegidas com bcrypt
- 💾 Sessões persistentes usando PostgreSQL
- 📱 Layout responsivo para celular

## Deploy no Render

1. Suba **o conteúdo desta pasta** para um repositório do GitHub. O `package.json` deve ficar na raiz do repositório.
2. No Render, crie um **PostgreSQL**.
3. Crie um **Web Service** conectado ao GitHub.
4. Use:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Adicione as variáveis de ambiente:
   - `DATABASE_URL` = URL interna/URL de conexão do PostgreSQL fornecida pelo Render
   - `SESSION_SECRET` = uma senha longa e aleatória
   - `NODE_ENV` = `production`
6. Faça o deploy.

### Primeiro acesso

O **primeiro cadastro feito no banco** vira automaticamente a conta **Era Heian** (administrador). Todos os cadastros seguintes ficam pendentes até serem aprovados.

> Importante: não coloque a senha do banco ou `SESSION_SECRET` dentro dos arquivos do GitHub. Use as Environment Variables do Render.

## Rodar localmente

Requer Node.js 20+ e PostgreSQL.

```bash
npm install
```

Defina `DATABASE_URL` e `SESSION_SECRET`, depois:

```bash
npm start
```

Abra `http://localhost:10000`.
