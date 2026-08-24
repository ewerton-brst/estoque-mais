# Guia de Uso — Estoque Mais

Manual prático para o dia a dia do sistema. Para detalhes técnicos, consulte
[ARQUITETURA.md](ARQUITETURA.md) e [API.md](API.md).

---

## 1. Acessar o sistema

1. Inicie o servidor (`npm start`) e abra `http://localhost:3000`.
2. Na tela de login, selecione a **empresa**, informe **usuário** e **senha** e clique em *Entrar*.
3. Se for seu primeiro acesso (ou sua senha foi redefinida por um administrador), o sistema pedirá
   a definição de uma nova senha com pelo menos 6 caracteres.

> Credenciais iniciais criadas automaticamente: usuário **admin**, senha **admin**.
> Troque essa senha no primeiro login.

### Alternar tema

O botão de lua/sol no topo alterna entre três modos: **automático** (segue o sistema),
**noturno** e **claro**. A preferência fica salva no navegador.

### Menu da conta

Clique no avatar (iniciais ou foto) no topo direito para acessar:

- **Configurações do usuário**: alterar nome e foto de perfil (a imagem é redimensionada
  automaticamente antes do envio).
- **Sair**: encerra a sessão.

---

## 2. Dashboard

A tela inicial resume a operação:

| Cartão | Significado |
|--------|-------------|
| Produtos cadastrados | Total de itens distintos no catálogo |
| Itens em estoque | Soma das quantidades de todos os produtos |
| Valor do estoque | Soma de `quantidade × preço unitário` |
| Estoque baixo | Quantidade de produtos em alerta |

Também são exibidos: lista de produtos com filtros, painel "Requer atenção" (itens abaixo do
mínimo ou zerados), atividade recente (últimas movimentações), gráfico de valor por categoria
e ações rápidas.

**Filtros da tabela de produtos:**
- Busca por nome ou SKU
- Categoria (preenchida automaticamente com as categorias existentes)
- Situação: qualquer / estoque saudável / estoque baixo / sem estoque

Um produto é considerado:
- 🟢 **Saudável**: quantidade acima do mínimo
- 🟡 **Estoque baixo**: quantidade maior que zero, porém igual ou abaixo do mínimo
- 🔴 **Sem estoque**: quantidade zerada

---

## 3. Produtos

### Cadastrar

Clique em **Novo produto** (topo) ou no atalho **Cadastrar produto** e preencha:

- **Nome** e **SKU** (o SKU é sugerido automaticamente e convertido para maiúsculas)
- **Categoria**: Casa & decoração, Cozinha, Organização ou Têxtil
- **Quantidade** atual, **estoque mínimo** e **preço unitário**

### Editar / Excluir

Use os botões de lápis ✏️ e lixeira 🗑️ na linha do produto. A exclusão pede confirmação.
Toda criação, edição e exclusão fica registrada na auditoria (página Usuários).

---

## 4. Movimentações (entradas e saídas)

Abra pelo botão **Registrar movimentação**, pelo atalho **Entrada de mercadoria**
ou pela página Movimentações:

1. Selecione o produto (a quantidade atual aparece na lista).
2. Escolha o tipo: **↓ Entrada** ou **↑ Saída**.
3. Informe a quantidade e uma observação opcional (ex.: "Compra do fornecedor").

Regras aplicadas:
- A saída **não pode superar** o estoque disponível — o sistema bloqueia e avisa.
- Cada movimentação registra data/hora real e o autor (usuário logado).
- As 4 movimentações mais recentes aparecem no dashboard.

---

## 5. Alertas

A página Alertas lista os produtos que precisam de reposição, priorizando os zerados,
com indicação de quantas unidades faltam para atingir o mínimo. O sino 🔔 no topo mostra
o total de alertas pendentes.

---

## 6. Relatórios e exportação

- O gráfico **Distribuição por categoria** mostra o valor investido por grupo de produtos.
- Em **Exportar relatório**, escolha o formato:
  - **Excel (.xlsx)** — gerado via SheetJS
  - **CSV (.csv)** — separado por ponto e vírgula, compatível com Excel brasileiro

> A exportação depende da permissão **"Pode exportar relatórios"**, concedida pelo administrador.
> Sem ela, o botão exibe um aviso.

Colunas exportadas: Produto, SKU, Categoria, Quantidade, Mínimo, Preço unitário.

---

## 7. Empresas *(administradores)*

Em **Configurações → Empresas → Adicionar empresa**:

1. Informe nome (obrigatório), CNPJ, telefone, e-mail e endereço.
2. Se a criação for bem-sucedida, uma janela **"Empresa criada"** exibe os dados de
   **primeiro acesso** do gerente exclusivo dessa empresa:
   - **Usuário:** `gerente_xxxxxx`
   - **Senha temporária:** `gerente`
3. No primeiro login do gerente será aberta a janela "Defina sua senha", onde ele cria a
   senha definitiva (digitada duas vezes, com validação de igualdade e mínimo de 6 caracteres).

Cada empresa possui estoque totalmente independente. No login, cada pessoa seleciona a empresa
à qual tem acesso.

### Remover uma empresa

Na lista de empresas (Configurações → Empresas), cada linha — exceto a matriz BRSTEC — tem um
botão vermelho **Remover**. Ao clicar, abre-se uma janela de confirmação no mesmo estilo do
sistema, com tudo em um único passo:

1. Aviso: produtos, movimentações e usuários vinculados serão apagados definitivamente.
2. Caixa de seleção **"Baixar uma cópia do estoque desta empresa antes de excluir"** — marque
   para receber o backup (Excel com abas de Produtos e Movimentações, ou CSV) antes da exclusão.
3. Campo de **senha de administrador**: digite a sua senha para autorizar a exclusão.
4. Clique em **Excluir definitivamente**. Erros (ex.: senha incorreta) aparecem dentro da janela.

Ao concluir, a empresa desaparece da lista e do seletor de login e **todos os usuários que só
tinham acesso a ela são removidos do sistema** (incluindo o gerente automático). Se você estava
logado na empresa excluída, a sessão é encerrada automaticamente.

> 🔒 O usuário master **admin** é exclusivo da empresa matriz **BRSTEC**: ele só consegue entrar
> com a BRSTEC selecionada na tela de login. As demais empresas são operadas pelos seus gerentes
> e usuários vinculados.

---

## 8. Usuários *(administradores)*

A página Usuários concentra duas seções:

### Gerenciador de usuários

A página está disponível para o **administrador master** e para o **gerente de cada empresa**:

- O **admin master** vê **todos os usuários criados**, com a **empresa de cada um** indicada
  logo abaixo do login (admins master aparecem como "Todas as empresas").
- O **gerente** vê **somente os usuários vinculados à sua empresa**.

- **Novo usuário**: nome, login, senha, nível de acesso e permissão de exportar relatórios.
  - O admin master escolhe livremente o papel (inclusive Administrador) e a empresa de acesso.
  - O gerente cria usuários sempre vinculados à própria empresa e não pode criar administradores.
- **Editar**: ajusta dados e permissões (o login não pode ser alterado após a criação).
- **Ativar/Desativar**: desativados não conseguem entrar, mas mantêm histórico.
- Ninguém pode desativar a própria conta.

### Primeiro acesso do gerente

Ao criar uma empresa, o sistema gera o usuário **gerente** com a senha temporária `gerente`.
No primeiro login dele, uma janela "Defina sua senha" solicita a nova senha **duas vezes**,
validando se são iguais e se atendem ao requisito mínimo de 6 caracteres antes de salvar.

### Auditoria do estoque

Linha do tempo combinando:
- Alterações de catálogo: produto cadastrado/editado/excluído
- Movimentações: entradas e saídas com quantidade

Cada registro mostra **quem** fez a ação, **quando** (tempo relativo: "Agora", "Há X min"…) e detalhes.

---

## 9. Configurações

Página com dados básicos da operação (nome da empresa, moeda, responsável) e o gerenciador
de empresas. As preferências de tema ficam no navegador de cada usuário.

---

## 10. Perguntas frequentes

**Esqueci minha senha. O que fazer?**
Peça a um administrador que edite seu usuário e defina uma nova senha; você será orientado
a trocá-la no próximo login.

**Outra pessoa alterou o estoque e eu não vejo a mudança.**
Aguarde alguns segundos: o sistema sincroniza automaticamente a cada 5 segundos.

**Posso usar o sistema de outro computador?**
Sim. O servidor exibe no console os endereços de rede local (ex.: `http://192.168.0.10:3000`);
acesse esse endereço de qualquer dispositivo na mesma rede.

**Qual a diferença entre Gerente e Operador?**
Atualmente ambos podem alterar o estoque; a distinção existe para organização hierárquica
e futuras permissões específicas.

**Meu acesso foi bloqueado com "Muitas tentativas".**
Após 5 senhas erradas seguidas, o login fica bloqueado por 10 minutos por segurança.
Aguarde e tente novamente.