# SIGA 2.0 — Conformidade com o Guia de Desenvolvimento SEFAZ/RS

**Referência:** [Guia de desenvolvimento de SW](https://dev.azure.com/sefaz-rs/projeto-modelo/_wiki/wikis/projeto-modelo.wiki)  
**Data:** Maio de 2026  
**Objetivo:** Mapear o que o SIGA 2.0 precisa adequar para atender os padrões do DETIC/SEFAZ/RS.

---

## Resumo executivo

| Área | Estado | Impacto |
|------|--------|---------|
| Repositório | ❌ GitHub → deve ser Azure DevOps | Bloqueante |
| Hospedagem | ❌ Firebase Hosting → deve ser IIS SEFAZ | Bloqueante |
| Autenticação | ❌ Firebase Auth (e-mail/senha) → deve ser Entra ID | Bloqueante |
| Segredos | ❌ Google Secret Manager → deve ser Azure Key Vault | Bloqueante |
| CI/CD | ❌ GitHub Actions → deve ser Azure Pipelines | Bloqueante |
| Testes unitários | ❌ Inexistentes → obrigatórios e bloqueantes no pipeline | Alto |
| SonarCloud | ⚠️ Existe, mas fora da org `sefaz-rs` | Alto |
| GHAS / CodeQL | ⚠️ CodeQL existe no GitHub; deve migrar para Azure DevOps | Alto |
| Testes E2E | ⚠️ Existem com Playwright; precisam ser adequados | Médio |
| Logging | ⚠️ Sem estrutura de log definida | Médio |
| Backlog Azure Boards | ❌ Inexistente | Médio |
| Estratégia de branch | ⚠️ Só `main`; deve ser Gitflow (dev → hml → main) | Médio |

---

## 1. Repositório

**Exigência SEFAZ:** código hospedado exclusivamente no Azure DevOps (`dev.azure.com/sefaz-rs/`). Repositórios externos não são aceitos.

**Estado atual:** GitHub (repositório externo à SEFAZ).

**O que fazer:**
1. Solicitar ao DETIC a criação do projeto no Azure DevOps.
2. Migrar o repositório: `git push` do histórico completo para o novo remote.
3. Desativar o repositório no GitHub (ou mantê-lo apenas como espelho, se autorizado).
4. Atualizar as referências de CI/CD e integrações.

**Complexidade:** Baixa — é uma operação de migração de repositório Git, sem mudança de código.

---

## 2. Hospedagem

**Exigência SEFAZ:** aplicações hospedadas exclusivamente na infraestrutura da SEFAZ (servidores IIS, rede interna). Ambientes obrigatórios:

| Ambiente | URL padrão |
|----------|-----------|
| DEV | `https://siga-dev.sefaz.rs.gov.br` |
| HML | `https://siga-hml.sefaz.rs.gov.br` |
| PRD | `https://siga.sefaz.rs.gov.br` |

**Estado atual:** Firebase Hosting (infraestrutura Google Cloud, externa à SEFAZ).

**O que fazer:**
1. Solicitar ao DETIC a criação dos ambientes DEV, HML e PRD no IIS.
2. O SIGA 2.0 é uma aplicação de arquivos estáticos (HTML + JS + CSS) — tecnicamente compatível com IIS, sem necessidade de runtime de servidor.
3. Criar pipeline de release no Azure Pipelines que publica os arquivos no compartilhamento de rede correto por ambiente (`\\DEVWSSHARED\Content$\wwwroot-dev`, etc.).
4. **Atenção:** Firebase Hosting resolve automaticamente rotas e HTTPS. No IIS, será necessário configurar URL Rewrite e certificados SSL.

**Complexidade:** Média — o frontend é estático, mas a infra precisa ser provisionada e configurada pelo DETIC.

**Dependência crítica:** os serviços de backend (Firestore, Firebase Auth, Cloud Functions) também precisam ser migrados. Ver seções 3, 5 e 7.

---

## 3. Autenticação

**Exigência SEFAZ:** autenticação via **Microsoft Entra ID** para usuários internos (servidores da SEFAZ). Autenticação direta com e-mail e senha na aplicação **não é permitida**.

O protocolo obrigatório é OAuth 2.0 / OpenID Connect. Para SPA (aplicação JavaScript no navegador), o fluxo é **Authorization Code com PKCE**, usando a biblioteca `@azure/msal-browser`.

**Estado atual:** Firebase Authentication com e-mail e senha — **não conforme**.

**O que fazer:**
1. Solicitar ao DETIC o **App Registration** no Microsoft Entra ID para o SIGA 2.0.
2. O DETIC fornecerá o `TenantId` e o `ClientId`.
3. Substituir o Firebase Auth pela biblioteca `@azure/msal-browser` no frontend.
4. Reescrever o fluxo de login (`auth-controller.js`) para usar Authorization Code + PKCE.
5. O token JWT do Entra ID passa a ser usado para autorização em todas as chamadas de backend.
6. As Cloud Functions (`functions/index.js`) precisam validar o token Entra ID em vez do Firebase ID Token.

**Complexidade:** Alta — o sistema de autenticação está integrado em múltiplos pontos: login, auto-logout, verificação de perfil, Cloud Functions. É uma substituição cirúrgica, mas extensa.

**Impacto em cascata:** a migração de autenticação afeta diretamente a gestão de usuários e perfis (seção 3.1 abaixo).

### 3.1 Perfis e autorização

**Exigência SEFAZ:** controle de acesso baseado em **Claims** do token JWT ou **grupos do Entra ID**. A autorização deve ser validada no servidor — nunca confiar exclusivamente no cliente.

**Estado atual:** perfis (`ep`, `dono`, `gestor`) armazenados no Firestore (`config/usuarios`), verificados apenas no JavaScript do cliente.

**O que fazer:**
1. Mapear os perfis do SIGA para grupos no Entra ID (ex: `SIGA-EP`, `SIGA-DONO`, `SIGA-GESTOR`).
2. Usar os grupos do Entra ID como Claims no token — o Entra ID inclui automaticamente os grupos do usuário.
3. As Cloud Functions devem ler o claim de grupo para autorizar operações sensíveis.
4. As regras Firestore devem usar Custom Claims ou ser substituídas por validação server-side nas Cloud Functions.

---

## 4. Segredos e credenciais

**Exigência SEFAZ:** todos os segredos armazenados no **Azure Key Vault**. Proibido em código, `appsettings.json`, `.env` ou qualquer arquivo versionado.

**Estado atual:** Google Cloud Secret Manager (para a Cloud Function) + GitHub Secrets (para o CI/CD). Nenhuma credencial no código — **conforme em princípio**, mas nas ferramentas erradas.

**O que fazer:**
1. Solicitar ao DETIC a criação do Key Vault do projeto (`kv-SIGA-DETIC-PROD` ou similar).
2. Migrar todos os segredos para o Azure Key Vault:
   - Chave do Firebase (enquanto Firestore for usado)
   - URL e chave do Azure OpenAI
   - Credenciais EmailJS
   - Credenciais de acesso ao Entra ID
3. Vincular o Key Vault à Library do Azure Pipelines para injeção nos pipelines de build e release.

**Complexidade:** Baixa — é migração de valores, não de código.

---

## 5. CI/CD — Pipeline

**Exigência SEFAZ:** pipelines em YAML, versionados no repositório, executando em agentes self-hosted da SEFAZ (`sefaz-self-hosted` ou `sefaz-self-hosted-2`).

**Etapas obrigatórias em todo pipeline de build:**
- Build / empacotamento
- Testes automatizados (unitários e/ou E2E)
- Cobertura de testes publicada
- SonarCloud (quality gate)
- GHAS — CodeQL (SAST) + Dependency Scanning (SCA) + Secret Scanning

**Estado atual:** GitHub Actions com agentes hospedados pelo GitHub. Não usa agentes da SEFAZ.

**O que fazer:**
1. Criar pipeline de build em YAML para o Azure Pipelines (`azure-pipelines.yml`).
2. Configurar o pool `sefaz-self-hosted` (acordar com DETIC).
3. Migrar as etapas do GitHub Actions para tasks do Azure Pipelines.
4. Incluir as tasks obrigatórias: SonarCloud, GHAS CodeQL, Dependency Scanning.
5. Criar pipeline de release separado para os ambientes DEV, HML e PRD.
6. Configurar Branch Policies no repositório: aprovação de PR obrigatória, SonarCloud e GHAS como status checks bloqueantes.

**Complexidade:** Média — a lógica de CI/CD já existe; é reescrita do YAML para o formato Azure Pipelines.

**Exemplo de estrutura do pipeline de build:**

```yaml
trigger:
  - dev

pool:
  name: "sefaz-self-hosted"

steps:
  # 1. GHAS — inicializar CodeQL
  - task: AdvancedSecurity-Codeql-Init@1
    displayName: "🔒 GHAS - Initialize CodeQL"
    inputs:
      languages: "javascript"
      enableAutomaticCodeQLInstall: true

  # 2. Instalar dependências
  - script: npm ci
    displayName: "📦 Instalar dependências"

  # 3. Testes unitários
  - script: npm run test:unit -- --coverage
    displayName: "🧪 Testes unitários"

  # 4. GHAS — Dependency Scanning e CodeQL Analyze
  - task: AdvancedSecurity-Dependency-Scanning@1
    displayName: "🔒 GHAS - Dependency Scanning"

  - task: AdvancedSecurity-Codeql-Analyze@1
    displayName: "🔒 GHAS - CodeQL Analyze"

  # 5. SonarCloud
  - task: SonarCloudPrepare@3
    inputs:
      SonarCloud: '<service-connection>'
      organization: 'sefaz-rs'
      projectKey: 'sefaz-rs_siga'

  - task: SonarCloudAnalyze@3
  - task: SonarCloudPublish@3
    inputs:
      pollingTimeoutSec: '300'

  # 6. Publicar cobertura
  - task: PublishCodeCoverageResults@2
    inputs:
      summaryFileLocation: 'coverage/cobertura-coverage.xml'
```

---

## 6. Estratégia de branches

**Exigência SEFAZ:** Gitflow com branches `dev`, `hml` e `main`. Cada PR deve conter exatamente 1 work item do Azure Boards.

| PR | Origem | Destino |
|----|--------|---------|
| Feature | branch de feature | `dev` |
| HML | `dev` | `hml` |
| PRD | `hml` | `main` |

**Estado atual:** apenas `main`. Sem rastreabilidade com work items.

**O que fazer:**
1. Criar branches `dev` e `hml` a partir do estado atual de `main`.
2. Configurar Branch Policies no Azure DevOps para cada branch.
3. Passar a trabalhar em branches de feature (`feat/nome`) e abrir PRs para `dev`.
4. Todo PR deve ter exatamente 1 work item do Azure Boards associado.

---

## 7. Backend — Firestore e Cloud Functions

**Exigência SEFAZ:** sem consumo de serviços externos à SEFAZ sem aprovação prévia do DETIC.

**Estado atual:** o sistema usa extensivamente:
- **Firestore** (Google Cloud) — banco de dados principal
- **Cloud Functions** (Google Cloud) — proxy para Azure OpenAI
- **Firebase Auth** (Google Cloud) — autenticação
- **Firebase Storage** (Google Cloud) — armazenamento de arquivos
- **Azure OpenAI** — geração de POP, PPT, análises de IA

**O que fazer (médio e longo prazo):**

O consumo do Azure OpenAI pode ser aprovado mais facilmente — já é um serviço Microsoft/Azure, alinhado com a infraestrutura da SEFAZ. Solicitar aprovação formal ao DETIC.

O Firestore, Firebase Auth e Cloud Functions são o maior ponto de ruptura. Há duas abordagens:

**Opção A — Solicitar exceção formal ao DETIC**
Documentar tecnicamente o uso do Firebase, demonstrar que os dados ficam em datacenter brasileiro (Firestore `southamerica-east1`) e solicitar aprovação formal. Se o DETIC aceitar, a maioria dos requisitos de infraestrutura pode ser atendida sem reescrita de backend.

**Opção B — Migrar o backend para infraestrutura SEFAZ**
Substituir Firestore por SQL Server, Firebase Auth por Entra ID, e Cloud Functions por uma API ASP.NET Core hospedada no IIS. Esta opção atende plenamente todos os requisitos, mas representa uma reescrita substancial do backend (estimativa: 3–4 meses de trabalho paralelo à modularização do frontend).

**Recomendação:** iniciar pela Opção A enquanto o frontend é adequado. Se o DETIC não conceder exceção, executar a Opção B como projeto separado com cronograma negociado.

---

## 8. Testes unitários

**Exigência SEFAZ:** testes unitários obrigatórios para toda funcionalidade entregue. Bloqueiam o PR se falharem. Cobertura mínima definida no SonarCloud.

Para JavaScript/TypeScript: **Vitest** ou **Jest**.

**Estado atual:** inexistentes. O SIGA 2.0 tem apenas testes E2E com Playwright.

**O que fazer:**
1. Instalar Vitest: `npm install -D vitest @vitest/coverage-v8`.
2. Criar `vitest.config.js` e script `test:unit` no `package.json`.
3. Criar `tests/unit/` no repositório.
4. Começar pelos arquivos mais testáveis: `security-utils.js`, `storage-utils.js`, `app-constants.js`, `firestore-repositories.js`.
5. À medida que módulos forem extraídos do monolito (plano de modularização), adicionar testes unitários junto com cada extração.

**Complexidade:** Média — os arquivos em `src/` já são modulares e relativamente fáceis de testar. O monolito `processos.html` não pode ser testado unitariamente enquanto não for modularizado.

**Exemplo de teste unitário para `security-utils.js`:**

```javascript
// tests/unit/security-utils.test.js
import { describe, it, expect } from 'vitest';

describe('esc()', () => {
  it('escapa caracteres HTML críticos', () => {
    expect(esc('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });
});

describe('safeUrl()', () => {
  it('aceita URLs https', () => {
    expect(safeUrl('https://exemplo.gov.br')).toBe('https://exemplo.gov.br');
  });

  it('rejeita URLs http', () => {
    expect(safeUrl('http://exemplo.gov.br')).toBe('');
  });

  it('rejeita javascript:', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('');
  });
});
```

---

## 9. Testes E2E

**Exigência SEFAZ:** Playwright + TypeScript, rodando no pipeline a cada PR para `dev`. Testes vinculados a PBIs do Azure Boards via `[AB#NNNNN]` no nome do `describe`.

**Estado atual:** Playwright existe, mas:
- Linguagem: JavaScript (deve ser TypeScript ou manter JS — verificar com DETIC)
- Pipeline: GitHub Actions (deve ser Azure Pipelines)
- Sem vínculo com Azure Boards

**O que fazer:**
1. Adaptar os testes existentes para incluir `[AB#NNNNN]` nos `describe` — vincular cada suíte ao PBI correspondente.
2. Criar o pipeline YAML para Azure Pipelines rodando os testes E2E.
3. Publicar resultados JUnit e cobertura no Azure DevOps.

**Complexidade:** Baixa — os testes já existem; é adaptação de formato e pipeline.

---

## 10. SonarCloud e GHAS

**Exigência SEFAZ:**
- SonarCloud sob a organização `sefaz-rs` em `sonarcloud.io`
- GHAS habilitado no repositório Azure DevOps

**Estado atual:**
- SonarCloud: existe, mas provavelmente fora da organização `sefaz-rs`
- CodeQL: configurado no GitHub, não no Azure DevOps

**O que fazer:**
1. Solicitar ao DETIC a criação do projeto na organização `sefaz-rs` do SonarCloud.
2. Habilitar GHAS no repositório Azure DevOps (configuração feita pelo DETIC).
3. Configurar o quality gate padrão (`Sonar Way`) — percentual mínimo de cobertura a acordar com o DETIC.
4. Adicionar as tasks do GHAS no pipeline YAML (ver seção 5).

---

## 11. Logging

**Exigência SEFAZ:** logging estruturado. Em produção: apenas `Information`, `Warning`, `Error`, `Critical`. Sem dados pessoais nos logs (LGPD). Rotação diária, retenção mínima de 30 dias.

**Estado atual:** sem infraestrutura de logging. O código tem `console.log` de debug (proibido em produção pela própria convenção do SIGA).

**O que fazer:**
1. O sistema é JavaScript no browser — o logging estruturado se aplica principalmente ao backend (Cloud Functions / futura API).
2. Para as Cloud Functions: implementar logging estruturado com `console.log` formatado como JSON (padrão do Google Cloud Logging) ou migrar para uma solução compatível com os padrões SEFAZ.
3. No frontend: remover todos os `console.log` de debug antes de qualquer deploy.
4. Registrar nos logs da Cloud Function: tentativas de autenticação, chamadas à IA (tempo de resposta, resultado), erros com contexto.

---

## 12. Backlog no Azure Boards

**Exigência SEFAZ:** todas as demandas representadas no backlog do produto com PBI, BUG ou REVIEW. Cada PR vinculado a exatamente 1 work item.

**Estado atual:** sem backlog formal no Azure Boards.

**O que fazer:**
1. Criar o projeto no Azure DevOps (pode ser o mesmo pedido da seção 1).
2. Cadastrar os itens de backlog existentes: funcionalidades a implementar, bugs conhecidos, itens do plano de modularização.
3. Para cada item do plano de modularização (Fases 1, 2 e 3 em `docs/arquitetura-para-cessao.md`), criar um PBI no Azure Boards.
4. A partir daí, todo PR referencia o PBI correspondente.

---

## Priorização das ações

### Imediatas (sem risco de regressão, podem ser feitas em paralelo)

| # | Ação | Responsável |
|---|------|------------|
| 1 | Migrar repositório para Azure DevOps | Equipe + DETIC |
| 2 | Solicitar App Registration no Entra ID | DETIC |
| 3 | Solicitar criação do Key Vault | DETIC |
| 4 | Criar branches `dev` e `hml` | Equipe |
| 5 | Instalar Vitest e criar primeiros testes unitários | Equipe |
| 6 | Criar `azure-pipelines.yml` com etapas básicas | Equipe |
| 7 | Criar backlog inicial no Azure Boards | Equipe + PO |
| 8 | Solicitar ao DETIC aprovação formal para uso de Firebase e Azure OpenAI | Gestão |

### Curto prazo (requerem DETIC envolvido)

| # | Ação |
|---|------|
| 9 | Provisionar ambientes DEV, HML, PRD no IIS |
| 10 | Habilitar GHAS no repositório Azure DevOps |
| 11 | Criar projeto no SonarCloud org `sefaz-rs` |
| 12 | Configurar pipeline completo com SonarCloud + GHAS |
| 13 | Substituir Firebase Auth por Entra ID (`@azure/msal-browser`) |

### Médio prazo (decisão arquitetural)

| # | Ação |
|---|------|
| 14 | Avaliar resposta do DETIC sobre Firebase (exceção ou migração) |
| 15 | Se migração: planejar substituição de Firestore por SQL Server |
| 16 | Se migração: planejar substituição de Cloud Functions por API ASP.NET Core |

---

## Definition of Done adaptada para o SIGA 2.0

Com base nos critérios da SEFAZ, esta é a DoD que deve ser aplicada a cada entrega:

- [ ] Código no Azure DevOps (`dev.azure.com/sefaz-rs/`)
- [ ] PR vinculado a exatamente 1 PBI/BUG/REVIEW no Azure Boards
- [ ] Testes unitários implementados para a funcionalidade
- [ ] `npm run test:unit` passando
- [ ] `npm run test:e2e:smoke` passando
- [ ] SonarCloud Quality Gate = `PASSED`
- [ ] GHAS sem novas vulnerabilidades Alta ou Crítica
- [ ] Sem `console.log` de debug no código comitado
- [ ] PR revisado por ao menos 1 revisor
- [ ] Todos os comentários da revisão resolvidos
- [ ] Deploy realizado a partir da branch correta (dev → DEV, hml → HML, main → PRD)

---

*Referências: [Guia de desenvolvimento SEFAZ/RS](https://dev.azure.com/sefaz-rs/projeto-modelo/_wiki/wikis/projeto-modelo.wiki) | `docs/arquitetura-para-cessao.md` | `docs/architecture/PLANO-MODULARIZACAO.md`*
