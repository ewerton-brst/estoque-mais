# Arquitetura — Estoque Mais

## Visão geral

O Estoque Mais é uma aplicação web de gerenciamento de estoque **multiempresa** construída
intencionalmente com **zero dependências de runtime no backend**: todo o servidor usa apenas
módulos nativos do Node.js. O frontend é uma SPA em JavaScript vanilla servida pelo próprio servidor.

```
┌───────────────────────────── Navegador ─────────────────────────────┐
│  index.html + styles.css                                            │
│  app.js (SPA)                                                       │
│   • telas: login, dashboard, produtos, movimentações, alertas,      │
│     relatórios, usuários, configurações                             │
│   • bibliotecas via CDN: Lucide (ícones), SheetJS (exportar XLSX)   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ fetch() JSON + cookie de sessão
┌───────────────────────────────▼─────────────────────────────────────┐
│                    server.js  (node:http nativo)                     │
│                                                                      │
│  createServer                                                        │
│   ├── /api/*        → handleApi(): autenticação, autorização, CRUD   │
│   └── demais rotas  → arquivos estáticos de src/views (com proteção  │
│                       contra path traversal) e src/app.js            │
│                                                                      │
│  Utilitários: scrypt (senhas), Map de sessões persistida em disco,   │
│  fila serializada de gravação do estoque, rate limit de login        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ readFile / writeFile (fs/promises)
┌───────────────────────────────▼─────────────────────────────────────┐
│                        src/data/  (persistência)                     │
│   users.json · companies.json · inventory-<empresa>.json             │
│   sessions.json                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---------|------------------|
| `src/server.js` | Servidor HTTP, API REST, sessões, autorização, arquivos estáticos |
| `src/app.js` | Toda a lógica do frontend: estado, renderização, chamadas à API |
| `src/views/index.html` | Marcação única da SPA (login + shell da aplicação + modais `<dialog>`) |
| `src/views/styles.css` | Estilos, temas claro/escuro e responsividade |
| `src/data/*.json` | Persistência (criados automaticamente na primeira execução) |
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

- O frontend mantém o estado completo em memória (`state`) e envia o objeto inteiro via `PUT`
  após cada operação (**atualização otimista**: se a API falhar, desfaz a mudança local).
- O servidor serializa gravações numa fila de promessas (`inventoryWriteQueue`) para que escritas
  concorrentes não corrompam o JSON.
- Sincronização passiva: o dashboard recarrega o estoque a cada 5 segundos (`startInventorySync`),
  refletindo alterações feitas por outros usuários.

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

| Medida | Implementação |
|--------|---------------|
| Hash de senha | scrypt + salt aleatório, comparação em tempo constante |
| Cookie de sessão | `HttpOnly`, `SameSite=Strict`, `Max-Age=7 dias` |
| Persistência de sessão | `data/sessions.json` com expiração e poda automática |
| Rate limit de login | 5 falhas → bloqueio de 10 min por usuário/IP, com limpeza periódica |
| Path traversal | validação com `path.relative()` antes de servir arquivos |
| Validação de entrada | produtos validados no `PUT`; senhas 6–128 caracteres; username com formato restrito; nome ≤ 80; campos de empresa ≤ 200; foto somente `data:image/` ≤ 500 KB |
| Corpo da requisição | limite de 2 MB (413) com drenagem segura; JSON inválido → 400 |
| Cabeçalhos HTTP | `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` nas páginas; `Cache-Control: no-store` na API |
| Proteção XSS | todo dado dinâmico é escapado (`escapeHtml`) antes de entrar em templates HTML |
| Enumeração de usuários | tempo de resposta equalizado para usuários inexistentes no login |
| Vazamento de dados | `passwordHash` nunca retornado pela API |

## Decisões e limitações conhecidas

- **JSON como banco**: adequado para pequenas equipes/volumes; substituir por SQLite/PostgreSQL
  exigiria apenas reescrever as funções `read*/write*` do `server.js`.
- **PUT substitui o estoque inteiro**: simples e consistente com o modelo otimista do frontend,
  mas sujeito a conflito se dois usuários salvarem simultaneamente (a última gravação vence).
- **Rate limit e cache de leitura em memória**: reiniciar o servidor zera contadores de tentativas.
- **Porta configurável** via variável de ambiente `PORT` (padrão 3000); escuta em `0.0.0.0`
  para acesso pela rede local.