# Aplicativo de Busca de Vagas de Emprego

Um aplicativo web em JavaScript que busca vagas de emprego em múltiplas plataformas online.

## 🚀 Funcionalidades

- **Busca por nome da vaga**: Digite o cargo ou posição desejada
- **Busca por cidade**: Filtre as oportunidades por localização (opcional)
- **Múltiplas fontes**: Integra com LinkedIn, Indeed, Glassdoor e Vagas.com
- **Interface gráfica moderna**: Design responsivo e atraente
- **Links diretos**: Cada resultado inclui link direto para a vaga original
- **Resultados consolidados**: Remove duplicatas e apresenta todas as vagas em um único lugar

## 📁 Estrutura do Projeto

```
job-search-app/
├── src/
│   └── server.js          # Servidor Node.js com Express
├── public/
│   ├── index.html         # Interface gráfica
│   ├── styles.css         # Estilos CSS
│   └── app.js             # JavaScript do frontend
├── package.json           # Dependências e scripts
└── README.md              # Este arquivo
```

## 🛠️ Tecnologias Utilizadas

- **Backend**: Node.js com Express
- **Frontend**: HTML5, CSS3, JavaScript Vanilla
- **Dependências**:
  - express: Servidor web
  - axios: Cliente HTTP
  - cheerio: Parser HTML (para scraping)

## 📦 Instalação

1. Navegue até a pasta do projeto:
```bash
cd job-search-app
```

2. Instale as dependências:
```bash
npm install
```

## ▶️ Como Executar

1. Inicie o servidor:
```bash
npm start
```

2. Acesse no navegador:
```
http://localhost:3000
```

## 💡 Como Usar

1. No campo **"Nome da Vaga"**, digite o cargo que você está buscando (ex: Desenvolvedor, Analista, Gerente)
2. No campo **"Cidade"**, digite a localização desejada (opcional)
3. Clique em **"Buscar Vagas"**
4. Visualize os resultados com:
   - Título da vaga
   - Nome da empresa
   - Localização
   - Fonte (LinkedIn, Indeed, Glassdoor, Vagas.com)
   - Data de publicação
   - Descrição resumida
   - **Link direto** para se candidatar

## 🔍 Fontes de Busca

O aplicativo consolida vagas das seguintes plataformas:

- **LinkedIn**: Maior rede profissional do mundo
- **Indeed**: Agregador de vagas global
- **Glassdoor**: Avaliações de empresas e vagas
- **Vagas.com**: Portal brasileiro de empregos

## ⚠️ Importante

Este aplicativo é uma demonstração funcional. Para uso em produção com scraping real:

1. Algumas plataformas requerem APIs oficiais
2. Respeite os termos de uso de cada site
3. Implemente rate limiting para evitar bloqueios
4. Considere usar APIs oficiais quando disponíveis

## 📝 License

ISC

## 👨‍💻 Autor

Desenvolvido como exemplo de aplicação full-stack em JavaScript.

---

**Divirta-se buscando sua próxima oportunidade! 🎯**
