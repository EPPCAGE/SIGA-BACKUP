# SIGA 2.0 — Proposta de Migração de Infraestrutura

**Data:** Maio de 2026  
**Destinatário:** Equipe técnica receptora  
**Contexto:** Adequação do sistema aos padrões de infraestrutura da SEFAZ/RS

---

## 1. Situação atual

O SIGA 2.0 foi construído sobre o Google Firebase, uma plataforma gerenciada que resolve autenticação, banco de dados, hospedagem e backend sem servidor. Essa escolha acelerou o desenvolvimento inicial, mas cria uma dependência com serviços externos à SEFAZ que precisa ser resolvida para aceite pelo DETIC.

| Serviço atual | Função | Padrão SEFAZ exigido |
|---------------|--------|----------------------|
| Firebase Hosting | Servir os arquivos estáticos (HTML, JS, CSS) | Infraestrutura interna |
| Firestore | Banco de dados (NoSQL, documentos JSON) | SQL Server |
| Firebase Auth | Autenticação de usuários | Microsoft Entra ID |
| Cloud Functions | API backend e proxy para IA | Container Node.js interno |
| Firebase Storage | Armazenamento de arquivos (BPMN, documentos) | Fileserver SEFAZ |

---

## 2. Proposta de migração

A proposta substitui cada serviço Google por um equivalente na infraestrutura da SEFAZ, sem redesenhar a lógica de negócio do sistema. O código de telas, regras e fluxos permanece intacto.

### Arquitetura proposta

```
Usuário (navegador)
    │
    ▼
┌─────────────────────────────────────────┐
│  Container: nginx                       │
│  Serve os arquivos estáticos            │
│  HTML, JS, CSS — sem modificação        │
└────────────────┬────────────────────────┘
                 │ chamadas à API
                 ▼
┌─────────────────────────────────────────┐
│  Container: API Node.js                 │
│  Substitui as Cloud Functions           │
│  ├── Endpoints REST de dados            │
│  ├── Proxy autenticado para Azure OpenAI│
│  └── Leitura/escrita de arquivos        │
└──────┬──────────────────┬───────────────┘
       │                  │
       ▼                  ▼
  SQL Server SEFAZ    Fileserver SEFAZ
  (banco de dados)    (arquivos BPMN,
                       documentos)
```

Autenticação: **Microsoft Entra ID** (OAuth 2.0 / PKCE), substituindo o Firebase Auth.

Os dois containers (nginx e API) são implantados na infraestrutura Docker da SEFAZ com pipelines no Azure DevOps.

---

## 3. O que muda e o que não muda

### O que não muda

- Todo o código de interface (HTML, CSS, JavaScript de telas)
- Toda a lógica de negócio (fluxos de mapeamento, indicadores, projetos, etc.)
- A estrutura dos dados — os documentos continuam em formato JSON
- A integração com Azure OpenAI (proxy autenticado)
- Os testes E2E existentes (Playwright)

### O que muda

| Componente | De | Para |
|------------|-----|------|
| Hospedagem | Firebase Hosting | Container nginx |
| Banco de dados | Firestore (Google) | SQL Server com colunas JSON |
| Autenticação | Firebase Auth (e-mail/senha) | Microsoft Entra ID (OAuth 2.0) |
| Backend/API | Cloud Functions (Google) | Container Node.js |
| Armazenamento de arquivos | Firebase Storage | Fileserver SEFAZ (volume montado) |
| CI/CD | GitHub Actions | Azure Pipelines |
| Segredos | Google Secret Manager | Azure Key Vault |

---

## 4. Banco de dados: por que SQL Server com JSON

O Firestore armazena os dados como documentos JSON flexíveis. O SQL Server suporta nativamente colunas JSON (`NVARCHAR(MAX)` com funções `JSON_VALUE`, `JSON_QUERY`, `OPENJSON`), o que permite uma migração direta sem redesenhar o modelo de dados.

Cada coleção do Firestore vira uma tabela SQL com dois campos principais:

```sql
CREATE TABLE processos (
    id       VARCHAR(128)    NOT NULL PRIMARY KEY,
    data     NVARCHAR(MAX)   NOT NULL,  -- documento JSON completo
    criado   DATETIMEOFFSET  NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    alterado DATETIMEOFFSET  NOT NULL DEFAULT SYSDATETIMEOFFSET()
);

-- Índice sobre campo extraído do JSON para consultas frequentes
CREATE INDEX ix_processos_status
    ON processos (JSON_VALUE(data, '$.status'));
```

Isso tem duas vantagens práticas:

1. **Migração de dados direta:** o script exporta os documentos do Firestore e os insere no SQL Server sem transformação de estrutura.
2. **Interface de repositório preservada:** a camada de acesso a dados (`firestore-repositories.js`) é reescrita para usar SQL, mas mantém a mesma interface (`.list()`, `.get(id)`, `.set(id, data)`, `.remove(id)`). O restante do código do sistema não percebe a mudança.

À medida que o sistema for sendo modularizado (plano já em andamento), cada módulo pode ter seus campos mais consultados promovidos a colunas indexadas — sem urgência para a migração inicial.

---

## 5. Autenticação: Microsoft Entra ID

A autenticação é substituída do Firebase Auth (e-mail e senha direto na aplicação) para o **Microsoft Entra ID**, usando o fluxo **Authorization Code com PKCE** — o padrão obrigatório da SEFAZ para SPAs (aplicações JavaScript no navegador).

A biblioteca usada no frontend é `@azure/msal-browser`, mantida pela Microsoft.

O impacto no código está localizado em `src/shared/auth/auth-controller.js`, que já foi extraído do monolito para esse fim. As telas e os fluxos de negócio não são afetados.

O DETIC precisa criar o **App Registration** no Entra ID para o SIGA 2.0 e fornecer o `TenantId` e o `ClientId`. A partir daí, a configuração é feita no arquivo de ambiente da aplicação, sem toque no código.

---

## 6. Plano de execução

As etapas podem ser executadas em paralelo por duas frentes de trabalho.

### Frente 1 — Infraestrutura e dados

**Etapa 1 — Containerização (1–2 semanas)**

- Criar `Dockerfile` para o nginx (frontend estático)
- Criar `Dockerfile` para a API Node.js (substitui Cloud Functions)
- Criar `docker-compose.yml` para ambiente de desenvolvimento local
- Criar pipeline de build e release no Azure Pipelines para os containers

Resultado: o sistema roda em Docker localmente e o pipeline está configurado para os ambientes DEV, HML e PRD.

**Etapa 2 — Camada SQL (2–3 semanas)**

- Criar as tabelas no SQL Server (uma por coleção Firestore)
- Escrever `src/shared/sql-repositories.js` substituindo `firestore-repositories.js`
  — mesma interface, implementação com `mssql`
- Criar script de migração de dados: exporta Firestore → importa SQL Server
- Executar migração em DEV, validar, depois em HML

Resultado: o sistema lê e grava no SQL Server. O Firestore pode ser desativado.

**Etapa 3 — Arquivos (1 semana)**

- Substituir as chamadas do Firebase Storage por operações de filesystem
- Configurar o volume do fileserver SEFAZ no container da API
- Migrar os arquivos existentes (BPMN, documentos) para o fileserver

Resultado: arquivos servidos e armazenados internamente.

---

### Frente 2 — Autenticação

**Etapa 4 — Entra ID (2–3 semanas, em paralelo com Frente 1)**

- Solicitar App Registration ao DETIC
- Instalar `@azure/msal-browser` no frontend
- Reescrever `src/shared/auth/auth-controller.js` para MSAL
- Atualizar a API Node.js para validar tokens JWT do Entra ID em vez de Firebase tokens
- Remover Firebase Auth do projeto

Resultado: login via conta corporativa da SEFAZ, sem Firebase.

---

### Cronograma estimado

```
Semana 1–2   Containerização (nginx + API Node.js) + pipeline Azure DevOps
Semana 2–3   Início paralelo: Entra ID + Camada SQL
Semana 4–5   Conclusão SQL, script de migração de dados
Semana 5     Migração de arquivos (fileserver)
Semana 6     Testes integrados em DEV com todos os serviços migrados
Semana 7     Homologação (HML) com dados reais
Semana 8     Deploy em produção + desativação dos serviços Google
```

**Total estimado: 7–9 semanas** com duas frentes trabalhando em paralelo.

---

## 7. Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Queries do Firestore sem equivalente direto em SQL | Médio | A camada de repositórios abstrai isso; identificar os casos antes de começar a Etapa 2 |
| Arquivos com URLs hardcoded do Firebase Storage | Baixo | Busca no código antes da migração; substituição pontual |
| Usuários com contas Firebase sem conta corporativa no Entra ID | Médio | O cadastro de usuários já está em `config/usuarios` no Firestore; migrar para grupos do Entra ID junto com a Etapa 4 |
| Performance do SQL Server JSON vs Firestore | Baixo | Adicionar índices nos campos consultados com frequência; monitorar nas primeiras semanas em produção |

---

## 8. O que a equipe receptora precisa do DETIC antes de começar

| Item | Etapa que desbloqueia |
|------|----------------------|
| Ambiente Docker configurado (DEV, HML, PRD) | Etapa 1 |
| SQL Server provisionado com banco de dados dedicado | Etapa 2 |
| Usuário SQL com permissão de leitura/escrita (sem admin) | Etapa 2 |
| Fileserver com volume acessível ao container | Etapa 3 |
| App Registration no Microsoft Entra ID (`TenantId`, `ClientId`) | Etapa 4 |
| Azure Key Vault criado com acesso ao pipeline | Todas |

---

## 9. O que está pronto hoje

Para acelerar a entrada da equipe receptora, os seguintes itens já estão feitos:

- Repositório migrado para Azure DevOps (`dev.azure.com/sefaz-rs/siga/_git/siga2.0`)
- Branches `main`, `hml` e `dev` criadas com estratégia Gitflow
- Camada de repositórios centralizada (`src/shared/firestore-repositories.js`) — ponto único de mudança para a Etapa 2
- Módulo de autenticação extraído (`src/shared/auth/auth-controller.js`) — ponto único de mudança para a Etapa 4
- Testes unitários com Vitest configurados e rodando (`npm run test:unit`)
- Documentação de arquitetura em `docs/arquitetura-para-cessao.md`
- Análise de conformidade com o guia SEFAZ em `docs/conformidade-sefaz.md`

---

*Dúvidas técnicas sobre a arquitetura atual: consultar `docs/arquitetura-para-cessao.md` no repositório.*
