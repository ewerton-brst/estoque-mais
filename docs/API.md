# Referência da API — Estoque Mais

Todas as rotas são servidas pelo mesmo processo do frontend em `http://localhost:<PORT>` (padrão `3000`).
Requisições e respostas usam **JSON** (`Content-Type: application/json; charset=utf-8`).

Autenticação é feita por **cookie de sessão** (`estoque_session`), emitido no login com os atributos
`HttpOnly; SameSite=Strict; Path=/; Max-Age=604800` (7 dias). Não há tokens Bearer.

**Novo na v2.0:** WebSocket em `/ws` para sincronização em tempo real e cabeçalhos `ETag`/`If-Match` para optimistic locking.

---

## Sumário

| Método | Rota | Descrição | Acesso |
|--------|------|-----------|--------|
| GET | `/api/companies` | Lista empresas ativas | Público |
| POST | `/api/login` | Autentica e abre sessão | Público |
| POST | `/api/logout` | Encerra a sessão atual | Autenticado |
| GET | `/api/session` | Dados da sessão atual | Autenticado |
| POST | `/api/account/password` | Altera a própria senha | Autenticado |
| GET | `/api/inventory` | Estoque da empresa da sessão (retorna `ETag`) | Autenticado |
| PUT | `/api/inventory` | Salva o estoque completo (exige `If-Match`) | Operator ou superior |
| POST | `/api/companies` | Cria nova empresa (+ gerente) | Admin |
| GET | `/api/companies/:id/inventory` | Estoque de qualquer empresa (backup) | Admin |
| DELETE | `/api/companies/:id` | Remove empresa e todos os seus dados | Admin (com senha) |
| GET | `/api/export` | Verifica permissão de exportação | Autenticado |
| GET | `/api/users` | Lista todos os usuários | Admin |
| POST | `/api/users` | Cria usuário | Admin |
| PATCH | `/api/users/:id` | Atualiza usuário | Admin (ou o próprio perfil) |
| WS | `/ws` | WebSocket para atualizações em tempo real | Autenticado |

---

## Níveis de acesso

Hierarquia: `admin` › `manager` › `operator` › `viewer`.
Rotas marcadas com um nível mínimo exigem que o papel do usuário esteja **no mesmo nível ou acima** na hierarquia.

| Papel | Nome exibido | Pode |
|-------|--------------|------|
| `admin` | Administrador | Tudo: empresas, usuários, permissões, estoque |
| `manager` | Gerente | Alterar estoque e movimentações |
| `operator` | Operador | Alterar estoque e movimentações |
| `viewer` | Consulta | Somente visualizar |

Além do papel, existe a permissão booleana `exportReports` (controla exportação de relatórios) e a lista
`companyIds` (empresas às quais o usuário tem acesso; admins usam `["*"]` para acesso total).

---

## Erros padrão

Todas as respostas de erro seguem o formato:

```json
{ "error": "Mensagem descritiva em português." }
```

Códigos utilizados: `400` (dados inválidos), `401` (não autenticado), `403` (sem permissão),
`404` (não encontrado), `409` (conflito/duplicado), `413` (payload grande demais),
`429` (muitas tentativas de login), `500` (erro interno).

---

## Rotas públicas

### `GET /api/companies`

Lista apenas as empresas ativas, para popular o seletor da tela de login.

**Resposta `200`:**
```json
[
  { "id": "default", "name": "BRSTEC", "active": true },
  { "id": "1ffd77af-…", "name": "BrstTest", "active": true }
]
```

### `POST /api/login`

Abre uma sessão e define o cookie `estoque_session`.

**Corpo:**
```json
{ "username": "admin", "password": "admin", "companyId": "default" }
```

**Resposta `200`:**
```json
{
  "user": {
    "id": "700d3117-…", "name": "Administrador", "username": "admin",
    "role": "admin", "active": true, "exportReports": true,
    "companyIds": ["*"], "profileImage": ""
  },
  "company": { "id": "default", "name": "BRSTEC", "active": true },
  "mustChangePassword": false
}
```
> O campo `passwordHash` nunca é retornado pela API.

**Erros:**
- `401` — usuário ou senha inválidos (também conta para o rate limit)
- `403` — usuário sem acesso à empresa informada. **O usuário master `admin` só pode entrar
  na empresa padrão BRSTEC (`companyId: "default"`)**; tentativas em outras empresas retornam 403
- `429` — bloqueio temporário após 5 falhas consecutivas por usuário/IP dentro de 10 minutos

### `POST /api/logout`

Remove a sessão do servidor e do disco.

**Resposta `200`:** `{ "ok": true }`

---

## Sessão e conta

### `GET /api/session`

Retorna usuário logado, empresa selecionada na sessão e flag de troca obrigatória de senha.
Sem sessão válida/expirada → `401`.

### `POST /api/account/password`

Altera a senha do próprio usuário e limpa a flag `mustChangePassword`.

**Corpo:** `{ "password": "novaSenha123" }` (mínimo de 6 caracteres)

**Resposta `200`:** `{ "user": { … } }` · **Erro:** `400` se a senha tiver menos de 6 caracteres.

---

## Estoque

### `GET /api/inventory`

Retorna o estoque completo da **empresa vinculada à sessão** (cada empresa possui arquivo próprio).

**Cabeçalhos de resposta:**
- `ETag: "<hash-sha256>"` — versão do estoque para optimistic locking
- `Last-Modified: <RFC 7231 date>` — data da última modificação

**Resposta `200`:**
```json
{
  "products": [
    {
      "id": 1, "name": "Kit organizador modular", "sku": "ALV-1042",
      "category": "Organização", "quantity": 86, "minimum": 20, "price": 89.9
    }
  ],
  "movements": [
    { "product": "Cafeteira italiana 6 xícaras", "type": "in", "quantity": 10,
      "date": "2026-08-24T12:00:00.000Z", "actor": "Administrador" }
  ],
  "productAudits": [
    { "action": "created", "product": "Tábua de corte bambu", "sku": "ALV-1254",
      "actor": "Administrador", "date": "2026-08-24T11:30:00.000Z" }
  ]
}
```

Valores possíveis:
- `movements[].type`: `"in"` (entrada) ou `"out"` (saída)
- `productAudits[].action`: `"created"`, `"updated"` ou `"deleted"`
- `date`: timestamp ISO 8601 (registros antigos podem conter texto legado)

**Nota sobre cache condicional (v2.0+):**
O cliente pode enviar `If-None-Match: "<etag>"` em requisições subseqüentes. Se o ETag não mudou,
o servidor retorna `304 Not Modified` sem corpo, economizando banda.

### `PUT /api/inventory` *(operator ou superior)*

Salva o estoque inteiro da empresa (o frontend envia o estado completo após cada operação,
com rollback otimista em caso de falha). Gravações são serializadas por uma fila interna
para evitar condições de corrida.

**Cabeçalhos de requisição obrigatórios (v2.0+):**
- `If-Match: "<etag>"` — deve corresponder ao ETag recebido no último `GET`; caso contrário, retorna `412 Precondition Failed`

**Corpo:** mesmo formato da resposta de `GET /api/inventory`.

**Validações (`400`):**
- `products`, `movements` e `productAudits` devem ser arrays
- Cada produto exige: `name` (string não vazia), `sku` (string), `quantity`, `minimum` e `price`
  numéricos finitos e ≥ 0

**Resposta `200`:** ecoa o estoque salvo com novo `ETag` no cabeçalho.

**Erros:**
- `412 Precondition Failed` — ETag divergente (conflito de edição); o corpo retorna o estoque atualizado para merge
- `400` — validação de dados
- `403` — usuário sem permissão operator ou superior

---

## Empresas *(admin)*

### `POST /api/companies`

Cria uma empresa e gera automaticamente um usuário gerente vinculado a ela, com senha temporária
`gerente` e flag `mustChangePassword: true`.

**Corpo:**
```json
{ "name": "Nova Loja", "cnpj": "00.000.000/0000-00", "phone": "", "email": "", "address": "" }
```
Somente `name` é obrigatório.

**Resposta `201`:**
```json
{
  "company": { "id": "uuid", "name": "Nova Loja", "cnpj": "…", "phone": "",
               "email": "", "address": "", "active": true },
  "manager": { "name": "Gerente", "username": "gerente_1ffd77", "temporaryPassword": "gerente" }
}
```

**Erros:** `400` nome ausente · `409` empresa já cadastrada (comparação sem diferenciar maiúsculas).

### `GET /api/companies/:id/inventory` *(admin)*

Retorna o estoque completo de qualquer empresa — usado pelo frontend para oferecer
o download de backup antes da exclusão.

**Resposta `200`:** mesmo formato de `GET /api/inventory`.
**Erros:** `403` não-admin · `404` empresa inexistente.

### `DELETE /api/companies/:id` *(admin, com senha)*

Remove a empresa e **todos os dados vinculados a ela**:

- Registro da empresa em `companies.json`
- Arquivo de estoque `inventory-<id>.json` (produtos, movimentações e auditorias)
- A empresa é removida do `companyIds` de todos os usuários
- **Usuários que ficarem sem nenhuma empresa vinculada são excluídos** (inclui gerentes
  automáticos e qualquer conta que só tinha acesso à empresa removida)
- Sessões abertas apontando para a empresa são invalidadas imediatamente

**Corpo:** `{ "password": "<senha do admin logado>" }`

**Resposta `200`:**
```json
{ "ok": true, "company": { "id": "uuid", "name": "Nome da Empresa" } }
```

**Erros:**
- `400` — a empresa matriz BRSTEC (`default`) não pode ser removida
- `401` — senha de administrador incorreta ou ausente
- `403` — usuário não-admin
- `404` — empresa inexistente

> A exclusão é definitiva. O frontend oferece o download de backup (XLSX/CSV) **antes**
> de enviar o `DELETE`.

---

## Exportação

### `GET /api/export`

Verificação prévia usada pelo botão "Exportar relatório".

**Resposta `200`:** `{ "allowed": true }` quando o usuário possui `exportReports: true`,
caso contrário `403`. A exportação em si acontece no navegador (SheetJS/CSV).

---

## Usuários

### `GET /api/users` *(admin ou gerente da sessão)*

**Resposta `200`:** `{ "users": [ … ] }` — sem `passwordHash`.
- **Admin master**: lista todos os usuários.
- **Gerente**: lista somente os usuários vinculados à empresa da sessão.

### `POST /api/users` *(admin ou gerente da sessão)*

**Corpo:**
```json
{ "name": "Maria", "username": "maria", "password": "senha123",
  "role": "operator", "companyIds": ["default"] }
```

**Regras por papel:**
- **Admin master**: pode definir `role` livremente (incluindo `admin`) e vincular a qualquer
  empresa existente via `companyIds` (padrão: `["default"]`).
- **Gerente**: cria usuários **sempre vinculados à própria empresa da sessão** (`companyIds`
  enviado é ignorado) e **não pode criar papel `admin`** (403).

**Resposta `201`:** `{ "user": { … } }`

**Erros:** `400` campos ausentes/papel inválido/empresa inexistente/senha < 6 caracteres ·
`403` sem permissão ou gerente tentando criar admin · `409` username duplicado.

---

## WebSocket — Tempo Real *(v2.0+)*

### `WS /ws`

Conexão WebSocket para receber atualizações em tempo real do estoque. A conexão exige autenticação
via cookie de sessão (mesmo cookie HTTP das requisições REST).

**Handshake:**
```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onopen = () => console.log('Conectado');
```

**Mensagens do servidor → cliente (JSON):**

| Tipo | Payload | Descrição |
|------|---------|-----------|
| `inventory:update` | `{ type: 'inventory:update', userId: 'uuid', timestamp: 'ISO8601' }` | Outro usuário modificou o estoque; cliente deve recarregar via `GET /api/inventory` |
| `user:logout` | `{ type: 'user:logout', userId: 'uuid', reason: 'desativated|deleted' }` | Conta desativada/excluída; cliente deve encerrar sessão |
| `ping` | `{ type: 'ping', timestamp: number }` | Keep-alive; cliente responde com `pong` |

**Mensagens do cliente → servidor:**
```json
{ "type": "pong", "timestamp": 1756000000000 }
```

**Reconexão:**
O cliente implementa backoff exponencial (1s, 2s, 4s, 8s, máx. 30s) em caso de desconexão.
Após reconectar, deve fazer `GET /api/inventory` para sincronizar estado.

**Fallback (v1.x ou WebSocket indisponível):**
Polling a cada 5 segundos via `GET /api/inventory` com `If-None-Match` para economizar banda.

---

## Auditoria Estruturada *(v2.0+)*

Além dos logs embutidos no JSON de auditoria por empresa, todas as ações são registradas em
`src/data/audit.log` no formato **JSON lines** (uma linha = um evento JSON), facilitando análise
externa com ferramentas como `jq`, ELK Stack ou Datadog.

**Formato:**
```json
{"timestamp":"2026-08-24T14:30:00.000Z","action":"inventory.update","userId":"uuid","companyId":"default","ip":"192.168.0.10","changes":{"productsAdded":1,"movementsCount":2}}
{"timestamp":"2026-08-24T14:31:00.000Z","action":"user.login","username":"admin","companyId":"default","ip":"192.168.0.10","success":true}
```

**Eventos registrados:**
- `user.login`, `user.logout`, `user.create`, `user.update`, `user.delete`
- `company.create`, `company.delete`
- `inventory.update`, `product.create`, `product.update`, `product.delete`
- `movement.in`, `movement.out`

### `PATCH /api/users/:id`

Atualização parcial. Campos aceitos: `name`, `role`, `active`, `exportReports`,
`companyIds` (string ou array), `profileImage` (data URL, máx. ~500 KB) e `password`.

**Regras de permissão:**
- **Admin master**: pode editar qualquer usuário e todos os campos.
- **Gerente**: pode editar apenas usuários da própria empresa (exceto a si mesmo, que edita
  só o perfil); não pode promover para `admin` nem alterar `companyIds` (403).
- **Demais papéis**: alteram **apenas o próprio perfil**, e somente `name`/`profileImage`/`password`
  (tentativas de mudar `role`, `active`, `exportReports` ou `companyIds` retornam `403`)
- Ninguém pode desativar a própria conta (`400`)
- `companyIds` é validado contra as empresas existentes (exceto o curinga `"*"`)

**Resposta `200`:** `{ "user": { … } }` · **Erro:** `404` usuário inexistente · `413` foto > 500 KB.
