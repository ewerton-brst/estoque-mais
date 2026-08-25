# Arquitetura — Estoque Mais

## Visão geral

O Estoque Mais é uma aplicação web de gerenciamento de estoque **multiempresa** construída
intencionalmente com **zero dependências de runtime no backend**: todo o servidor usa apenas
módulos nativos do Node.js. O frontend é uma SPA em JavaScript vanilla servida pelo próprio servidor.

**Atualizações recentes (v2.0):**
- ✅ Banco de dados SQLite para produção (com fallback JSON para desenvolvimento)
- ✅ WebSocket para sincronização em tempo real (substituindo polling de 5s)
- ✅ Optimistic locking com ETag para controle de concorrência
- ✅ Logging estruturado de auditoria em arquivo dedicado

```
┌───────────────────────────── Navegador ─────────────────────────────┐
│  index.html + styles.css                                            │
│  app.js (SPA)                                                       │
│   • telas: login, dashboard, produtos, movimentações, alertas,      │
│     relatórios, usuários, configurações                             │
│   • bibliotecas via CDN: Lucide (ícones), SheetJS (exportar XLSX)   │
│   • WebSocket client para atualizações em tempo real                │
└───────────────────────────────┬─────────────────────────────────────┘
                   │            │ fetch() JSON + cookie de sessão
                   │            │ WebSocket /ws
┌──────────────────▼────────────▼─────────────────────────────────────┐
│                    server.js  (node:http + ws nativo)                │
│                                                                      │
│  createServer                                                        │
│   ├── /api/*        → handleApi(): autenticação, autorização, CRUD   │
│   ├── /ws           → WebSocket: broadcast de mudanças de estoque    │
│   └── demais rotas  → arquivos estáticos de src/views (com proteção  │
│                       contra path traversal) e src/app.js            │
│                                                                      │
│  Utilitários: scrypt (senhas), Map de sessões persistida em disco,   │
│  fila serializada de gravação do estoque, rate limit de login,       │
│  ETag generator, audit logger                                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ SQLite (estoque.db) ou readFile/writeFile
┌───────────────────────────────▼─────────────────────────────────────┐
│                        src/data/  (persistência)                     │
│   estoque.db (SQLite - produção)                                     │
│   users.json · companies.json · inventory-<empresa>.json (legado)    │
│   sessions.json · audit.log                                          │
└──────────────────────────────────────────────────────────────────────┘
```

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/server.js` | Servidor HTTP, API REST, WebSocket, sessões, autorização, arquivos estáticos |
| `src/app.js` | Toda a lógica do frontend: estado, renderização, chamadas à API, cliente WebSocket |
| `src/views/index.html` | Marcação única da SPA (login + shell da aplicação + modais `<dialog>`) |
| `src/views/styles.css` | Estilos, temas claro/escuro e responsividade |
| `src/data/estoque.db` | Banco de dados SQLite (produção) — tabelas: users, companies, inventory, movements, audits |
| `src/data/*.json` | Persistência legada (desenvolvimento ou migração) |
| `src/data/audit.log` | Logs estruturados de auditoria (JSON lines) para análise externa |
| `smoke-test.mjs` | Teste de fumaça que sobe o servidor e valida os principais fluxos |

## Modelo de dados

### `users.json`

```json
{
  "id": "uuid",
  "name": "Administrador",
  "username": "admin",
  "role": "admin",              // admin | manager | operator | viewer
  "active": true,
  "exportReports": true,
  "companyIds": ["*"],          // empresas acessíveis; "*" = todas
  "profileImage": "",           // data URL (máx. ~500 KB)
  "mustChangePassword": false,  // força troca no primeiro acesso
  "passwordHash": "scrypt:<salt hex>:<hash hex>"
}
```

- Senhas: `scrypt` com salt aleatório de 16 bytes e chave de 64 bytes; comparação com
  `timingSafeEqual`. Formato armazenado: `scrypt:salt:hash`.
- O hash **nunca** sai do servidor (a API usa `publicUser()` para removê-lo).

### `companies.json`

```json
{ "id": "default", "name": "BRSTEC", "cnpj": "", "phone": "",
  "email": "", "address": "", "active": true }
```

A empresa com `id: "default"` é criada automaticamente na primeira execução.

### `inventory-<companyId>.json`

Um arquivo por empresa — isolamento total dos estoques:

```json
{
  "products":      [ { "id": 1, "name": "…", "sku": "ALV-0000", "category": "…",
                       "quantity": 0, "minimum": 0, "price": 0 } ],
  "movements":     [ { "product": "…", "type": "in|out", "quantity": 1,
                       "date": "<ISO 8601>", "actor": "…" } ],
  "productAudits": [ { "action": "created|updated|deleted", "product": "…",
                       "sku": "…", "actor": "…", "date": "<ISO 8601>" } ]
}
```

IDs de produto são numéricos sequenciais (`max(id) + 1`, calculado no cliente).

### `sessions.json`

Array de pares `[token, sessão]`:

```json
[ [ "token-hex-64", { "userId": "uuid", "companyId": "default", "createdAt": 1756000000000 } ] ]
```

Sessões expiram após **7 dias** (`SESSION_TTL`) e são filtradas ao carregar. O token tem 32 bytes
de entropia (`randomBytes(32).toString('hex')`).

## Fluxos principais

### Autenticação

1. `POST /api/login` valida credenciais (scrypt + `timingSafeEqual`) e o acesso do usuário à empresa.
2. Gera token, grava `{ userId, companyId, createdAt }` em memória **e** em `sessions.json`.
3. Define cookie `HttpOnly` (inacessível ao JavaScript, mitiga XSS) e `SameSite=Strict`
   (mitiga CSRF entre sites).
4. Requisições seguintes identificam a sessão pelo cookie; `currentUser()` também confere expiração.
5. Rate limit: 5 falhas consecutivas por `usuário|IP` bloqueiam novas tentativas por 10 minutos;
   acerto limpa o contador.

### Multiempresa

- A empresa escolhida no login fica fixada na sessão; todas as operações de estoque usam apenas ela.
- Cada empresa tem seu próprio `inventory-<id>.json`, criado sob demanda com dados iniciais.
- Ao criar uma empresa, o sistema gera um gerente exclusivo (`gerente_<prefixo-do-id>`,
  senha temporária `gerente`, troca obrigatória no próximo login).
- O usuário master `admin` é exclusivo da empresa matriz **BRSTEC** (`id: "default"`):
  o login com ele em qualquer outra empresa é rejeitado com `403`.

### Salvamento do estoque

### Versão 1.x (JSON + polling)

- O frontend mantém o estado completo em memória (`state`) e envia o objeto inteiro via `PUT`
  após cada operação (**atualização otimista**: se a API falhar, desfaz a mudança local).
- O servidor serializa gravações numa fila de promessas (`inventoryWriteQueue`) para que escritas
  concorrentes não corrompam o JSON.
- Sincronização passiva: o dashboard recarrega o estoque a cada 5 segundos (`startInventorySync`),
  refletindo alterações feitas por outros usuários.

### Versão 2.0+ (SQLite + WebSocket + ETag)

- **GET `/api/inventory`** retorna cabeçalho `ETag: "<hash>"` com versão do estoque.
- **PUT `/api/inventory`** exige cabeçalho `If-Match: "<etag>"`; se divergir, retorna `412 Precondition Failed`.
- Após PUT bem-sucedido, servidor broadcast via WebSocket `{ type: 'inventory:update', userId }` para todos os clientes conectados.
- Clientes recebem atualização e fazem merge local: se estavam editando, exibem modal de conflito; caso contrário, atualizam silently.
- SQLite usa transação ACID com locking automático; escrita é atômica e imediata.
- Auditoria é gravada em `audit.log` como JSON lines: `{"timestamp":"...","action":"update","userId":"...","companyId":"...","changes":[...]}`.

### Autorização

Função central: `allowed(user, minimum)` — compara a posição do papel do usuário contra o mínimo
exigido na hierarquia `['admin', 'manager', 'operator', 'viewer']`. Regras adicionais ficam
embutidas nas rotas (ex.: somente admin cria empresas/usuários; não-admin só edita o próprio perfil).

## Frontend (`app.js`)

- **Estado global:** `state.products/movements/productAudits`, `loggedUser`, `selectedCompany`,
  `companies`, preferência de tema em `localStorage`.
- **Renderização imperativa:** funções `render()`, `row()`, `alertRow()`, `activityRow()`,
  `renderChart()` reconstruem trechos do DOM a partir do estado; ícones re-renderizados com
  `lucide.createIcons()`.
- **Navegação por hash:** `#/dashboard`, `#/products`, etc., sem recarregar a página
  (`navigate()` + `history.replaceState`).
- **Modais nativos:** elementos `<dialog>` para produto, movimentação, usuário, conta e empresa.
- **Formatação:** moeda em BRL via `toLocaleString('pt-BR')`; datas relativas via `when()`
  ("Agora", "Há X min", "Ontem").
- **Exportação:** SheetJS (CDN) para `.xlsx`; fallback CSV com `Blob` + link temporário,
  sempre precedido da checagem `GET /api/export`.

## Segurança — resumo

| Medida | Implementação (v1.x) | Implementação (v2.0+) |
|--------|---------------------|----------------------|
| Hash de senha | scrypt + salt aleatório, comparação em tempo constante | Igual + rate limit persistente em SQLite |
| Cookie de sessão | `HttpOnly`, `SameSite=Strict`, `Max-Age=7 dias` | Igual + invalidação via WebSocket quando usuário é desativado |
| Persistência de sessão | `data/sessions.json` com expiração e poda automática | Tabela `sessions` em SQLite com índice de expiração |
| Rate limit de login | 5 falhas → bloqueio de 10 min por usuário/IP, com limpeza periódica | Igual, mas persiste entre reinícios |
| Path traversal | validação com `path.relative()` antes de servir arquivos | Igual |
| Validação de entrada | produtos validados no `PUT`; senhas 6–128 caracteres; username com formato restrito; nome ≤ 80; campos de empresa ≤ 200; foto somente `data:image/` ≤ 500 KB | Igual + constraints SQL NOT NULL/UNIQUE |
| Corpo da requisição | limite de 2 MB (413) com drenagem segura; JSON inválido → 400 | Igual |
| Cabeçalhos HTTP | `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` nas páginas; `Cache-Control: no-store` na API | Igual + `ETag` e `Last-Modified` para cache condicional |
| Proteção XSS | todo dado dinâmico é escapado (`escapeHtml`) antes de entrar em templates HTML | Igual |
| Enumeração de usuários | tempo de resposta equalizado para usuários inexistentes no login | Igual |
| Vazamento de dados | `passwordHash` nunca retornado pela API | Igual |
| Controle de concorrência | Última gravação vence (risco de conflito) | **Optimistic locking com ETag** — retorna `412` se versão divergir |
| Sincronização | Polling a cada 5s (atraso, desperdício de banda) | **WebSocket push** (tempo real, eficiente) |
| Auditoria | Logs apenas em JSON de auditoria por empresa | **Arquivo dedicado `audit.log`** (JSON lines) + tabela `audits` em SQLite |

## Decisões e limitações conhecidas

### Versão 1.x (legado JSON)

- **JSON como banco**: adequado para pequenas equipes/volumes; migrado para SQLite na v2.0.
- **PUT substitui o estoque inteiro**: simplificado com optimistic locking (ETag) na v2.0.
- **Rate limit e cache de leitura em memória**: reiniciar o servidor zera contadores de tentativas.
- **Sincronização por polling**: atualizado para WebSocket na v2.0.

### Versão 2.0+ (SQLite + WebSocket)

- **SQLite embutido**: ideal para pequeno/médio porte; para alto volume, substituir por PostgreSQL
  exigiria adaptar as queries SQL mantendo a mesma interface de repositório.
- **Optimistic locking**: requer que o cliente envie o ETag recebido no `GET`; conflitos retornam `412 Precondition Failed`
  e o frontend oferece merge automático ou revisão manual.
- **WebSocket sem reconexão automática**: implementado backoff exponencial (1s, 2s, 4s, 8s, máx. 30s).
- **Migração automática**: na primeira inicialização, dados JSON são importados para SQLite; arquivos legados
  são mantidos como backup.
- **Porta configurável** via variável de ambiente `PORT` (padrão 3000); escuta em `0.0.0.0`
  para acesso pela rede local.