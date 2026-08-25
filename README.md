# Estoque Mais (estoque+)

Aplicação web completa de gerenciamento de estoque **multiempresa**, construída com Node.js puro (sem frameworks) no backend e JavaScript vanilla no frontend.

## 📚 Documentação

| Documento | Conteúdo |
|-----------|----------|
| [Guia de Uso](docs/GUIA-DE-USO.md) | Manual prático: telas, fluxos do dia a dia e perguntas frequentes |
| [Arquitetura](docs/ARQUITETURA.md) | Visão técnica: componentes, modelo de dados, fluxos e segurança |
| [Referência da API](docs/API.md) | Todos os endpoints com exemplos de requisição/resposta e permissões |

## Estrutura do projeto

```
estoque-mais/
├── package.json              # Configuração do npm (ESM)
├── smoke-test.mjs            # Teste de fumaça da API (npm test)
├── README.md
├── docs/                     # Documentação completa
│   ├── GUIA-DE-USO.md        # Manual do usuário
│   ├── ARQUITETURA.md        # Arquitetura técnica e modelo de dados
│   └── API.md                # Referência dos endpoints
└── src/
    ├── server.js             # Servidor do app (API + interface) e do site (porta própria)
    ├── app.js                # Lógica do frontend (SPA)
    ├── views/
    │   ├── index.html        # Interface principal
    │   ├── site.html         # Site institucional com aba Ajuda
    │   ├── site.css          # Estilos animados do site
    │   ├── site.js           # Interações do site
    │   └── styles.css        # Estilos da interface
    └── data/                 # Persistência (criada automaticamente)
        ├── estoque.db        # Banco de dados SQLite (produção)
        ├── users.json        # Usuários e hashes de senha (scrypt) — legado
        ├── companies.json    # Empresas cadastradas — legado
        ├── inventory-*.json  # Estoque independente por empresa — legado
        └── sessions.json     # Sessões ativas (sobrevivem a reinícios)
        └── audit.log         # Logs estruturados de auditoria (JSON lines)
```

## Funcionalidades

- **Autenticação**: sessões persistentes via cookie `HttpOnly`, senhas com hash scrypt, expiração de sessão em 7 dias e limite de tentativas de login.
- **Multiempresa**: cada empresa possui estoque totalmente independente; ao criar uma empresa, o sistema gera automaticamente um usuário gerente com senha temporária, que define a própria senha no primeiro acesso (confirmação em duas etapas) e pode cadastrar os usuários da sua empresa.
- **Níveis de acesso**: `admin`, `manager` (gerente), `operator` (operador) e `viewer` (consulta).
- **Produtos**: cadastro, edição e exclusão com SKU, categoria, preço unitário e estoque mínimo.
- **Movimentações**: entradas e saídas de mercadoria com validação de saldo disponível.
- **Alertas**: itens abaixo do estoque mínimo ou zerados destacados automaticamente.
- **Auditoria**: registra quem criou/editou/excluiu produtos e cada movimentação, com data real e logs estruturados em arquivo dedicado.
- **Relatórios**: exportação em Excel (.xlsx) ou CSV, controlada por permissão específica.
- **Usuários**: gestão de contas, papéis, ativação/desativação e foto de perfil — pelo admin master (todas as empresas) ou pelo gerente (apenas a sua empresa).
- **Interface**: tema claro/escuro/automático, responsiva, com **sincronização em tempo real via WebSockets** (fallback: polling a cada 5 segundos).
- **Banco de dados**: suporte híbrido JSON (desenvolvimento) e **SQLite (produção)** com migração automática.
- **Controle de concorrência**: **optimistic locking com ETag** para prevenir conflitos de edição simultânea.

## Requisitos

- Node.js 18 ou superior

## Instalação

1. Navegue até o diretório do projeto:
   ```
   cd estoque-mais
   ```
2. Instale as dependências:
   ```
   npm install
   ```

## Uso

1. Inicie a aplicação:
   ```
   npm start
   ```
2. Abra o navegador em `http://localhost:3000`. O servidor também exibe os endereços de rede local disponíveis no console.
3. O **site institucional** (apresentação + aba Ajuda) roda separado, em `http://localhost:4000` — use a variável de ambiente `SITE_PORT` para alterar a porta. Dentro do aplicativo, os links **"Site e Ajuda"** (barra lateral) e **"Conheça o Estoque Mais"** (tela de login) apontam automaticamente para ele.

## Primeiro acesso

Na primeira execução o sistema cria automaticamente o usuário administrador:

- **Usuário:** `admin`
- **Senha:** `admin`

> ⚠️ Por segurança, altere essa senha após o primeiro login (menu da conta → Configurações do usuário). A dica de credenciais não é exibida na tela de login justamente para não expor o acesso padrão.

> 🔒 O usuário master **admin** só pode entrar na empresa matriz **BRSTEC** (empresa padrão). Tentativas de login com ele em outras empresas são rejeitadas.

Ao criar uma nova empresa (como admin), o sistema gera um usuário gerente com a senha temporária `gerente`, que deve ser trocada obrigatoriamente no primeiro login.

## Testes

```
npm test
```

Executa duas suítes automatizadas:

1. **Teste de fumaça** (`smoke-test.mjs`) — sobe o servidor na porta 3000 e valida os fluxos principais da API.
2. **Suíte completa** (`tests/api.test.mjs`) — 40 testes em porta isolada (3100) cobrindo autenticação, rate limit, sessões, validações de estoque, ciclo de vida de empresas (criar/backup/excluir), permissões por papel, gestão de usuários pelo gerente da empresa, escalonamento de acesso, limites de payload e exposição de arquivos. Os dados reais são preservados via snapshot: a suíte faz backup dos JSONs antes de rodar e os restaura ao final.

A suíte completa retorna código de saída diferente de zero quando algum teste falha — ideal para integração contínua.

## API REST

| Método | Rota | Descrição | Acesso mínimo |
|--------|------|-----------|---------------|
| GET | `/api/companies` | Lista empresas ativas | Público |
| POST | `/api/login` | Autentica e abre sessão | Público |
| POST | `/api/logout` | Encerra a sessão | Autenticado |
| GET | `/api/session` | Sessão atual | Autenticado |
| POST | `/api/account/password` | Altera a própria senha | Autenticado |
| GET | `/api/inventory` | Estoque da empresa da sessão | Autenticado |
| PUT | `/api/inventory` | Salva o estoque completo (com ETag para optimistic locking) | Operator |
| POST | `/api/companies` | Cria empresa (+ gerente) | Admin |
| GET | `/api/companies/:id/inventory` | Estoque de qualquer empresa (backup) | Admin |
| DELETE | `/api/companies/:id` | Remove empresa e todos os seus dados | Admin (com senha) |
| GET | `/api/export` | Verifica permissão de exportação | Autenticado |
| GET | `/api/users` | Lista usuários | Admin (todos) · Gerente (sua empresa) |
| POST | `/api/users` | Cria usuário | Admin · Gerente (sua empresa) |
| PATCH | `/api/users/:id` | Atualiza usuário | Admin · Gerente (sua empresa) · Próprio perfil |
| WS | `/ws` | WebSocket para sincronização em tempo real | Autenticado |

Tentativas de login são limitadas a 5 falhas consecutivas por usuário/IP dentro de 10 minutos.

## Contribuição

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests.