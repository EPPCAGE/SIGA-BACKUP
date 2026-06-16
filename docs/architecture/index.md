# Arquitetura do SIGA 2.0

Este documento e a porta de entrada para analistas entenderem a arquitetura atual do SIGA 2.0, o estado da modularizacao e o caminho de evolucao para um software cedivel a outros orgaos.

## Visao geral

O SIGA 2.0 e uma aplicacao web hospedada no Firebase, com dois modulos principais:

- `processos.html`: SIGA Processos, com arquitetura de processos, mapeamentos, indicadores, PAT, publicacoes e analise de aderencia.
- `projetos.html`: SIGA Projetos, com portfolio, programas, estrategia, cronogramas, reunioes, indicadores e relatorio executivo.

Historicamente, a aplicacao nasceu como front-end monolitico. A arquitetura atual preserva compatibilidade com esse modelo, mas ja introduz camadas para configuracao institucional, tenancy, seguranca, persistencia e modularizacao gradual.

## Como o sistema inicia

Ordem conceitual de carregamento:

1. `config/config.local.js` ou `config/config.deploy.js` injeta `window.CONFIG`.
2. `src/shared/tenant-config.js` normaliza a configuracao de tenant.
3. `src/shared/org-config.js` normaliza identidade institucional, textos, logos e dominios.
4. `src/shared/firebase-helpers.js` expoe helpers Firebase tenant-aware.
5. `src/shared/firestore-repositories.js` expoe repositorios de dados por dominio.
6. Arquivos do modulo carregam constantes, utilitarios e controllers extraidos.
7. O HTML legado executa a logica principal e renderiza as telas.

## Camadas atuais

| Camada | Local | Responsabilidade |
|--------|-------|------------------|
| Configuracao institucional | `config/`, `src/shared/org-config.js` | Nome do sistema, orgao, logos, dominios, e-mails e textos institucionais |
| Tenant | `src/shared/tenant-config.js` | Gerar caminhos legados ou `tenants/{tenantId}/...` sem ativar tenant antes da migracao |
| Firebase helpers | `src/shared/firebase-helpers.js` | Criar referencias Firestore respeitando tenant |
| Repositorios de dados | `src/shared/firestore-repositories.js` | Centralizar leituras/escritas Firestore por dominio |
| Utilitarios de front | `src/processos/*` | Primeiros utilitarios e controllers extraidos do monolito |
| UI legada | `processos.html`, `projetos.html`, `projetos-logic.js` | Renderizacao e regras ainda majoritariamente monoliticas |
| Functions | `functions/index.js` | Proxy autenticado para IA/Azure OpenAI |
| Testes | `tests/e2e/` | Smoke tests e simulacoes Playwright |
| Ferramentas | `tools/` | Scripts auxiliares, como plano/migracao tenant |

## Persistencia de dados

Todo acesso novo ao Firestore deve passar por repositorios, por exemplo:

- `processosRepository`
- `kpisRepository`
- `publicacoesRepository`
- `planoRepository`
- `relatoriosIndicadoresRepository`
- `projetosRepository`
- `programasRepository`
- `configRepository`

O objetivo e impedir novas chamadas Firestore espalhadas pela UI. O arquivo central para evolucao dessa camada e `src/shared/firestore-repositories.js`.

## Multi-tenant

Estado atual:

- `TENANCY.enabled:false`
- Caminhos ativos continuam legados, como `processos/{id}` e `config/usuarios`.
- Caminhos alvo ja podem ser previstos como `tenants/{tenantId}/processos/{id}`.

Script de apoio:

```bash
npm run tenant:migration:plan
```

Esse comando apenas mostra o plano de migracao. A execucao real deve acontecer somente em homologacao/controlado:

```bash
node tools/migrate-firestore-tenant.mjs --tenant=cage-rs --execute
```

## Estrutura de pastas

```text
config/              Configuracao por ambiente e exemplo publico
docs/                Documentacao tecnica, baseline, deploy e seguranca
functions/           Cloud Functions
src/shared/          Camadas compartilhadas entre Processos e Projetos
src/processos/       Extracoes graduais do modulo Processos
tests/e2e/           Testes de fumaca e simulacoes Playwright
tools/               Scripts operacionais e migracoes
```

Arquivos ainda monoliticos:

- `processos.html`
- `projetos.html`
- `projetos-logic.js`

Eles devem ser quebrados gradualmente, mantendo compatibilidade global ate cada fatia estar coberta por testes.

## Documentos relacionados

- `docs/architecture/frontend-layers.md`: camadas atuais do front-end.
- `docs/architecture/modularization.md`: estrategia de modularizacao gradual.
- `docs/architecture/tenancy.md`: desenho multi-tenant e migracao.
- `docs/architecture/productization.md`: plano para transformar o sistema em produto cedivel.
- `docs/architecture/frontend-backend-roadmap.md`: roadmap para backend, APIs, auditoria e seguranca.
- `docs/baseline/2026-05-09-functional-baseline.md`: baseline funcional registrada.
- `docs/deployment/checklist.md`: checklist de deploy.
- `docs/security/tenant-members-model.md`: modelo de membros e papeis por tenant.
- `docs/security/*.rules.example`: exemplos de regras por tenant.

## Regras para proximas alteracoes

- Nao criar novas chamadas diretas ao Firestore na UI; usar repositórios.
- Nao colocar nomes, logos, e-mails ou dominios fixos no codigo de modulo; usar `ORG_CONFIG`.
- Nao ativar `TENANCY.enabled:true` em producao antes de migrar e validar dados em homologacao.
- Nao remover compatibilidade global dos arquivos monoliticos sem teste equivalente.
- Nao versionar `config.local.js`, `config.deploy.js`, `.env` ou chaves reais.

## Proximos passos recomendados

1. Continuar extraindo renderizadores e controllers de `processos.html`.
2. Criar testes e2e para fluxos criticos antes de cada extracao maior.
3. Validar migracao tenant em homologacao com copia real da base.
4. Mover operacoes sensiveis para Cloud Functions.
5. Reforcar regras Firestore/Storage por tenant e papel do usuario.
