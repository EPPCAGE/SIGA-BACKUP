# Módulo de Workflow Dinâmico — SIGA 2.0

## Visão Geral

Permite que processos modelados sejam convertidos em workflows executáveis com
formulários dinâmicos, SLA, notificações e auditoria completa.

**Fase 1 (escopo deste documento)**
- Fluxo sequencial apenas (sem paralelismo, sem subprocessos)
- Engine baseada em máquina de estados finita
- Formulários renderizados por schema JSON
- Separação explícita entre modelo (template) e instância (execução)

---

## Estrutura de Pastas

```
siga2.0/
├── workflow.html                          # Frontend — módulo principal
├── src/
│   └── workflow/
│       ├── workflow-constants.js          # Enums e labels
│       ├── workflow-engine.js             # Máquina de estados (cliente)
│       ├── form-renderer.js              # Renderização de formulários dinâmicos
│       ├── workflow-ui-modeler.js        # Tela de modelagem do processo
│       ├── workflow-ui-tasks.js          # Lista e execução de tarefas
│       └── workflow-ui-history.js        # Histórico da instância
├── functions/
│   └── workflow/
│       ├── entities.js                   # Definições de entidades e validação
│       ├── engine.js                     # Engine de workflow (server-side)
│       ├── sla.js                        # Cálculo e validação de SLA
│       ├── notifications.js              # Disparo de notificações
│       └── index.js                      # Endpoints REST expostos via Cloud Functions
└── docs/
    └── architecture/
        └── workflow-module.md            # Este documento
```

---

## Modelo de Dados (Firestore)

### Coleções

| Coleção                        | Propósito                                  |
|--------------------------------|--------------------------------------------|
| `wf_processo_modelos`          | Templates de processos                     |
| `wf_etapa_modelos`             | Etapas de cada template                    |
| `wf_transicao_fluxos`          | Transições entre etapas                    |
| `wf_formulario_modelos`        | Schemas JSON dos formulários               |
| `wf_instancia_processos`       | Execuções em andamento/concluídas          |
| `wf_tarefa_workflows`          | Tarefas geradas por instância              |
| `wf_historico_workflows`       | Log imutável de eventos por instância      |
| `wf_notificacoes`              | Notificações geradas para usuários         |

---

## Entidades

### 1. ProcessoModelo

Template reutilizável de um processo.

**Atributos**

| Campo            | Tipo      | Descrição                                      |
|------------------|-----------|------------------------------------------------|
| `id`             | string    | UUID gerado pelo Firestore                     |
| `nome`           | string    | Nome do processo (ex: "Licença de Software")   |
| `descricao`      | string    | Descrição livre                                |
| `versao`         | number    | Versão do modelo (incrementada a cada publicação) |
| `status`         | enum      | `rascunho` \| `publicado` \| `arquivado`       |
| `etapa_inicial`  | string    | ID da EtapaModelo de entrada                   |
| `criado_por`     | string    | UID do usuário                                 |
| `criado_em`      | timestamp |                                                |
| `atualizado_em`  | timestamp |                                                |
| `perfis_permitidos` | string[] | Perfis que podem iniciar instâncias          |

**Exemplo JSON**

```json
{
  "id": "proc_abc123",
  "nome": "Solicitação de Licença de Software",
  "descricao": "Processo para aquisição e aprovação de novas licenças.",
  "versao": 2,
  "status": "publicado",
  "etapa_inicial": "etapa_001",
  "criado_por": "uid_gestor_01",
  "criado_em": "2026-01-15T09:00:00Z",
  "atualizado_em": "2026-03-10T14:30:00Z",
  "perfis_permitidos": ["ep", "gestor", "dono"]
}
```

---

### 2. EtapaModelo

Uma etapa dentro de um ProcessoModelo.

**Atributos**

| Campo              | Tipo      | Descrição                                          |
|--------------------|-----------|----------------------------------------------------|
| `id`               | string    |                                                    |
| `processo_modelo_id` | string  | FK → ProcessoModelo                                |
| `nome`             | string    | Nome da etapa (ex: "Análise do Gestor")            |
| `descricao`        | string    |                                                    |
| `ordem`            | number    | Posição na sequência                               |
| `tipo`             | enum      | `inicio` \| `tarefa` \| `aprovacao` \| `fim`       |
| `formulario_modelo_id` | string | FK → FormularioModelo (opcional)                 |
| `responsavel_tipo` | enum      | `perfil` \| `usuario_especifico` \| `solicitante`  |
| `responsavel_valor`| string    | Perfil ou UID dependendo do tipo                   |
| `sla_horas`        | number    | Prazo em horas úteis (0 = sem SLA)                 |
| `instrucoes`       | string    | Texto livre exibido ao responsável                 |

**Exemplo JSON**

```json
{
  "id": "etapa_001",
  "processo_modelo_id": "proc_abc123",
  "nome": "Solicitação Inicial",
  "descricao": "Solicitante preenche o formulário de pedido.",
  "ordem": 1,
  "tipo": "tarefa",
  "formulario_modelo_id": "form_xyz",
  "responsavel_tipo": "solicitante",
  "responsavel_valor": null,
  "sla_horas": 24,
  "instrucoes": "Preencha todos os campos e anexe o orçamento."
}
```

---

### 3. TransicaoFluxo

Define como o fluxo avança de uma etapa para a próxima.

**Atributos**

| Campo              | Tipo   | Descrição                                        |
|--------------------|--------|--------------------------------------------------|
| `id`               | string |                                                  |
| `processo_modelo_id` | string | FK → ProcessoModelo                            |
| `etapa_origem_id`  | string | FK → EtapaModelo (origem)                        |
| `etapa_destino_id` | string | FK → EtapaModelo (destino)                       |
| `condicao`         | enum   | `sempre` \| `aprovado` \| `rejeitado`            |
| `label`            | string | Texto do botão de ação (ex: "Aprovar", "Enviar") |

**Exemplo JSON**

```json
{
  "id": "trans_001",
  "processo_modelo_id": "proc_abc123",
  "etapa_origem_id": "etapa_001",
  "etapa_destino_id": "etapa_002",
  "condicao": "sempre",
  "label": "Enviar para Análise"
}
```

---

### 4. FormularioModelo

Schema JSON que define os campos de um formulário de etapa.

**Atributos**

| Campo        | Tipo   | Descrição                        |
|--------------|--------|----------------------------------|
| `id`         | string |                                  |
| `titulo`     | string | Título do formulário             |
| `campos`     | Campo[]| Lista de campos (ver schema)     |
| `versao`     | number |                                  |
| `criado_por` | string |                                  |
| `criado_em`  | timestamp |                               |

**Schema de Campo**

```json
{
  "id": "string (snake_case, único no formulário)",
  "tipo": "texto | textarea | numero | data | select | checkbox | anexo",
  "label": "string",
  "obrigatorio": "boolean",
  "placeholder": "string (opcional)",
  "opcoes": ["array de strings — usado por select"],
  "validacao": {
    "min": "number (para numero/data)",
    "max": "number (para numero/data)",
    "regex": "string (para texto)"
  }
}
```

**Exemplo JSON completo**

```json
{
  "id": "form_xyz",
  "titulo": "Solicitação de Licença",
  "versao": 1,
  "criado_por": "uid_ep_01",
  "criado_em": "2026-01-10T08:00:00Z",
  "campos": [
    {
      "id": "nome_software",
      "tipo": "texto",
      "label": "Nome do Software",
      "obrigatorio": true,
      "placeholder": "Ex: Adobe Acrobat"
    },
    {
      "id": "justificativa",
      "tipo": "textarea",
      "label": "Justificativa",
      "obrigatorio": true
    },
    {
      "id": "custo_estimado",
      "tipo": "numero",
      "label": "Custo Estimado (R$)",
      "obrigatorio": false,
      "validacao": { "min": 0, "max": 1000000 }
    },
    {
      "id": "data_necessidade",
      "tipo": "data",
      "label": "Data de Necessidade",
      "obrigatorio": true
    },
    {
      "id": "tipo_licenca",
      "tipo": "select",
      "label": "Tipo de Licença",
      "obrigatorio": true,
      "opcoes": ["Perpétua", "Anual", "Mensal", "Open Source"]
    },
    {
      "id": "uso_corporativo",
      "tipo": "checkbox",
      "label": "Uso exclusivamente corporativo",
      "obrigatorio": false
    },
    {
      "id": "orcamento_anexo",
      "tipo": "anexo",
      "label": "Orçamento (PDF ou imagem)",
      "obrigatorio": false
    }
  ]
}
```

---

### 5. InstanciaProcesso

Uma execução específica de um ProcessoModelo.

**Atributos**

| Campo                | Tipo      | Descrição                                          |
|----------------------|-----------|----------------------------------------------------|
| `id`                 | string    |                                                    |
| `processo_modelo_id` | string    | FK → ProcessoModelo                                |
| `processo_modelo_versao` | number | Versão do modelo no momento da criação            |
| `titulo`             | string    | Gerado automaticamente ou fornecido pelo solicitante |
| `status`             | enum      | `em_andamento` \| `concluido` \| `cancelado` \| `suspenso` |
| `etapa_atual_id`     | string    | FK → EtapaModelo (etapa em execução)               |
| `solicitante_uid`    | string    | UID do usuário que abriu a instância               |
| `dados_consolidados` | object    | Mapa `{ campo_id: valor }` acumulado de todas etapas |
| `iniciado_em`        | timestamp |                                                    |
| `concluido_em`       | timestamp | null enquanto em andamento                         |
| `prazo_geral`        | timestamp | Opcional — deadline total do processo              |

**Exemplo JSON**

```json
{
  "id": "inst_001",
  "processo_modelo_id": "proc_abc123",
  "processo_modelo_versao": 2,
  "titulo": "Licença Adobe Acrobat — João Silva",
  "status": "em_andamento",
  "etapa_atual_id": "etapa_002",
  "solicitante_uid": "uid_user_42",
  "dados_consolidados": {
    "nome_software": "Adobe Acrobat Pro",
    "justificativa": "Necessário para digitalização de documentos."
  },
  "iniciado_em": "2026-05-20T10:00:00Z",
  "concluido_em": null,
  "prazo_geral": null
}
```

---

### 6. TarefaWorkflow

Tarefa gerada para um responsável em uma etapa de uma instância.

**Atributos**

| Campo              | Tipo      | Descrição                                          |
|--------------------|-----------|----------------------------------------------------|
| `id`               | string    |                                                    |
| `instancia_id`     | string    | FK → InstanciaProcesso                             |
| `etapa_modelo_id`  | string    | FK → EtapaModelo                                   |
| `responsavel_uid`  | string    | UID do responsável resolvido no momento da criação |
| `status`           | enum      | `pendente` \| `em_execucao` \| `concluida` \| `cancelada` \| `vencida` |
| `prazo`            | timestamp | Calculado: `criado_em + sla_horas`                 |
| `criado_em`        | timestamp |                                                    |
| `iniciado_em`      | timestamp | Quando o responsável abriu a tarefa                |
| `concluido_em`     | timestamp |                                                    |
| `dados_formulario` | object    | Respostas submetidas para esta etapa               |
| `acao_tomada`      | string    | Label da transição executada (ex: "Aprovado")      |
| `observacao`       | string    | Comentário livre do responsável                    |

**Exemplo JSON**

```json
{
  "id": "tarefa_555",
  "instancia_id": "inst_001",
  "etapa_modelo_id": "etapa_002",
  "responsavel_uid": "uid_gestor_07",
  "status": "pendente",
  "prazo": "2026-05-22T18:00:00Z",
  "criado_em": "2026-05-20T10:05:00Z",
  "iniciado_em": null,
  "concluido_em": null,
  "dados_formulario": {},
  "acao_tomada": null,
  "observacao": null
}
```

---

### 7. HistoricoWorkflow

Log imutável de todos os eventos de uma instância.

**Atributos**

| Campo          | Tipo      | Descrição                                            |
|----------------|-----------|------------------------------------------------------|
| `id`           | string    |                                                      |
| `instancia_id` | string    | FK → InstanciaProcesso                               |
| `tipo_evento`  | enum      | Ver tabela abaixo                                    |
| `usuario_uid`  | string    | Quem gerou o evento (null para eventos de sistema)   |
| `etapa_id`     | string    | Etapa relacionada (quando aplicável)                 |
| `tarefa_id`    | string    | FK → TarefaWorkflow (quando aplicável)               |
| `descricao`    | string    | Texto legível do evento                              |
| `dados`        | object    | Payload completo do evento (para auditoria)          |
| `ocorrido_em`  | timestamp |                                                      |

**Tipos de Evento**

| `tipo_evento`          | Gerado por        |
|------------------------|-------------------|
| `instancia_criada`     | sistema           |
| `tarefa_criada`        | sistema           |
| `tarefa_iniciada`      | responsável       |
| `tarefa_concluida`     | responsável       |
| `etapa_avancada`       | sistema           |
| `instancia_concluida`  | sistema           |
| `instancia_cancelada`  | usuário/sistema   |
| `sla_alerta`           | sistema (cron)    |
| `sla_vencido`          | sistema (cron)    |

**Exemplo JSON**

```json
{
  "id": "hist_999",
  "instancia_id": "inst_001",
  "tipo_evento": "tarefa_concluida",
  "usuario_uid": "uid_gestor_07",
  "etapa_id": "etapa_002",
  "tarefa_id": "tarefa_555",
  "descricao": "Tarefa 'Análise do Gestor' concluída com ação 'Aprovado'.",
  "dados": {
    "acao_tomada": "Aprovado",
    "observacao": "Solicitação dentro do orçamento previsto.",
    "dados_formulario": { "parecer": "Aprovado sem ressalvas." }
  },
  "ocorrido_em": "2026-05-21T11:30:00Z"
}
```

---

### 8. Notificacao

Notificação gerada para um usuário por um evento.

**Atributos**

| Campo          | Tipo      | Descrição                                  |
|----------------|-----------|--------------------------------------------|
| `id`           | string    |                                            |
| `destinatario_uid` | string | UID do usuário                            |
| `tipo`         | enum      | `tarefa_criada` \| `prazo_proximo` \| `tarefa_vencida` \| `tarefa_concluida` |
| `titulo`       | string    | Resumo curto                               |
| `mensagem`     | string    | Texto completo                             |
| `instancia_id` | string    | FK → InstanciaProcesso                     |
| `tarefa_id`    | string    | FK → TarefaWorkflow (quando aplicável)     |
| `lida`         | boolean   | false por padrão                           |
| `criado_em`    | timestamp |                                            |

---

## Endpoints REST

Todos os endpoints são Cloud Functions HTTPS autenticadas.
Base URL: `https://us-central1-sigaepp.cloudfunctions.net/workflow`

### Modelos de Processo

```
GET    /processos-modelo              Lista processos modelo (paginado)
POST   /processos-modelo              Cria novo modelo
GET    /processos-modelo/:id          Detalhe do modelo
PUT    /processos-modelo/:id          Atualiza rascunho
POST   /processos-modelo/:id/publicar Publica modelo (incrementa versão)
DELETE /processos-modelo/:id          Arquiva modelo
```

### Etapas e Transições

```
GET    /processos-modelo/:id/etapas          Lista etapas do modelo
POST   /processos-modelo/:id/etapas          Cria etapa
PUT    /processos-modelo/:id/etapas/:etapaId Atualiza etapa
DELETE /processos-modelo/:id/etapas/:etapaId Remove etapa

GET    /processos-modelo/:id/transicoes          Lista transições
POST   /processos-modelo/:id/transicoes          Cria transição
DELETE /processos-modelo/:id/transicoes/:transId Remove transição
```

### Formulários

```
GET  /formularios-modelo       Lista todos os schemas
POST /formularios-modelo       Cria schema
GET  /formularios-modelo/:id   Detalhe do schema
PUT  /formularios-modelo/:id   Atualiza schema (cria nova versão)
```

### Instâncias

```
GET    /instancias                    Lista instâncias do usuário autenticado
POST   /instancias                    Inicia nova instância
GET    /instancias/:id                Detalhe da instância
POST   /instancias/:id/cancelar       Cancela instância (EP/gestor)
GET    /instancias/:id/historico      Histórico completo da instância
```

### Tarefas

```
GET  /tarefas                         Lista tarefas pendentes do usuário
GET  /tarefas/:id                     Detalhe da tarefa
POST /tarefas/:id/iniciar             Marca tarefa como em_execucao
POST /tarefas/:id/concluir            Conclui tarefa e avança fluxo
```

### Notificações

```
GET  /notificacoes                    Lista notificações do usuário
POST /notificacoes/:id/marcar-lida    Marca como lida
POST /notificacoes/marcar-todas-lidas Marca todas como lidas
```

### Payloads

**POST /instancias**
```json
{
  "processo_modelo_id": "proc_abc123",
  "titulo": "Licença Adobe Acrobat — João Silva"
}
```

**POST /tarefas/:id/concluir**
```json
{
  "acao": "Aprovado",
  "observacao": "Solicitação dentro do orçamento.",
  "dados_formulario": {
    "parecer": "Aprovado sem ressalvas.",
    "data_aprovacao": "2026-05-21"
  }
}
```

**Resposta de erro padrão**
```json
{
  "erro": "TAREFA_NAO_ENCONTRADA",
  "mensagem": "Tarefa não encontrada ou sem permissão.",
  "status": 404
}
```

---

## Engine de Workflow — Máquina de Estados

### Estados da InstanciaProcesso

```
[criada] → em_andamento → concluido
                       ↘ cancelado
                       ↘ suspenso
```

### Estados da TarefaWorkflow

```
[criada] → pendente → em_execucao → concluida
                   ↘             ↘ cancelada
                   ↘ vencida (via cron SLA)
```

### Pseudocódigo — iniciarInstancia

```
function iniciarInstancia(processoModeloId, solicitanteUid, titulo):
  modelo = buscar ProcessoModelo por id
  validar modelo.status == "publicado"
  validar solicitante tem perfil em modelo.perfis_permitidos

  instancia = criar InstanciaProcesso:
    processo_modelo_id = modelo.id
    processo_modelo_versao = modelo.versao
    titulo = titulo
    status = "em_andamento"
    etapa_atual_id = modelo.etapa_inicial
    solicitante_uid = solicitanteUid
    iniciado_em = agora()

  registrarHistorico(instancia.id, "instancia_criada", null, {})

  etapaInicial = buscar EtapaModelo por modelo.etapa_inicial
  criarTarefa(instancia, etapaInicial)

  retornar instancia
```

### Pseudocódigo — criarTarefa

```
function criarTarefa(instancia, etapaModelo):
  responsavelUid = resolverResponsavel(etapaModelo, instancia)

  prazo = null
  se etapaModelo.sla_horas > 0:
    prazo = agora() + horasUteis(etapaModelo.sla_horas)

  tarefa = criar TarefaWorkflow:
    instancia_id = instancia.id
    etapa_modelo_id = etapaModelo.id
    responsavel_uid = responsavelUid
    status = "pendente"
    prazo = prazo
    criado_em = agora()

  registrarHistorico(instancia.id, "tarefa_criada", null, { tarefa_id: tarefa.id })
  dispararNotificacao(responsavelUid, "tarefa_criada", instancia, tarefa)

  retornar tarefa
```

### Pseudocódigo — concluirTarefa

```
function concluirTarefa(tarefaId, usuarioUid, acao, observacao, dadosFormulario):
  tarefa = buscar TarefaWorkflow por id
  validar tarefa.responsavel_uid == usuarioUid
  validar tarefa.status in ["pendente", "em_execucao"]

  instancia = buscar InstanciaProcesso por tarefa.instancia_id
  etapaAtual = buscar EtapaModelo por tarefa.etapa_modelo_id
  formularioModelo = buscar FormularioModelo por etapaAtual.formulario_modelo_id

  se formularioModelo existe:
    validarCamposObrigatorios(formularioModelo.campos, dadosFormulario)

  tarefa.status = "concluida"
  tarefa.acao_tomada = acao
  tarefa.observacao = observacao
  tarefa.dados_formulario = dadosFormulario
  tarefa.concluido_em = agora()

  instancia.dados_consolidados = merge(instancia.dados_consolidados, dadosFormulario)

  registrarHistorico(instancia.id, "tarefa_concluida", usuarioUid, {
    tarefa_id: tarefa.id,
    acao_tomada: acao,
    dados_formulario: dadosFormulario
  })

  avancarFluxo(instancia, etapaAtual, acao)
```

### Pseudocódigo — avancarFluxo

```
function avancarFluxo(instancia, etapaAtual, acao):
  transicoes = buscar TransicaoFluxo onde etapa_origem_id == etapaAtual.id
  transicao = transicoes.find(t =>
    t.condicao == "sempre" OR t.label == acao
  )

  se transicao == null:
    lançar erro "TRANSICAO_NAO_ENCONTRADA"

  proxEtapa = buscar EtapaModelo por transicao.etapa_destino_id

  instancia.etapa_atual_id = proxEtapa.id
  registrarHistorico(instancia.id, "etapa_avancada", null, {
    de: etapaAtual.id,
    para: proxEtapa.id
  })

  se proxEtapa.tipo == "fim":
    instancia.status = "concluido"
    instancia.concluido_em = agora()
    registrarHistorico(instancia.id, "instancia_concluida", null, {})
    dispararNotificacao(instancia.solicitante_uid, "tarefa_concluida", instancia, null)
  senão:
    criarTarefa(instancia, proxEtapa)
```

---

## SLA

### Cálculo de Prazo

- Horas úteis: segunda a sexta, 08h–18h (excluindo feriados nacionais)
- `prazo = adicionarHorasUteis(criado_em, sla_horas)`

### Status de SLA da Tarefa

| Condição                            | Status      | Cor      |
|-------------------------------------|-------------|----------|
| `prazo == null`                     | `sem_sla`   | cinza    |
| `agora < prazo - 2h`                | `no_prazo`  | verde    |
| `prazo - 2h <= agora <= prazo`      | `vencendo`  | amarelo  |
| `agora > prazo && concluida`        | `vencido`   | vermelho |
| `agora > prazo && não concluida`    | `vencido`   | vermelho |

### Cloud Function Scheduled (cron)

Executada a cada 30 minutos:
1. Busca tarefas `status == "pendente"` com `prazo < agora + 2h`
2. Dispara notificação `prazo_proximo` para responsáveis ainda não notificados
3. Busca tarefas `status in ["pendente","em_execucao"]` com `prazo < agora`
4. Atualiza status para `vencida`, registra histórico `sla_vencido`

---

## Notificações

| Evento             | Destinatário   | Título                              |
|--------------------|----------------|-------------------------------------|
| `tarefa_criada`    | responsável    | "Nova tarefa: {etapa.nome}"         |
| `prazo_proximo`    | responsável    | "Prazo se encerrando: {etapa.nome}" |
| `tarefa_vencida`   | responsável + EP | "Tarefa vencida: {etapa.nome}"    |
| `tarefa_concluida` | solicitante    | "Processo concluído: {instancia.titulo}" |

Entrega via:
1. Coleção `wf_notificacoes` (badge no frontend)
2. EmailJS (mesmo mecanismo já existente no SIGA)
3. Futuro: Firebase Cloud Messaging

---

## Permissões

### Matriz de Acesso

| Ação                          | `ep` | `gestor` | `dono` | `gerente_projeto` |
|-------------------------------|------|----------|--------|-------------------|
| Criar/editar ProcessoModelo   | ✓    | ✓        | ✗      | ✗                 |
| Publicar ProcessoModelo       | ✓    | ✗        | ✗      | ✗                 |
| Iniciar instância             | ✓    | ✓        | ✓      | ✓                 |
| Concluir tarefa própria       | ✓    | ✓        | ✓      | ✓                 |
| Cancelar instância alheia     | ✓    | ✓        | ✗      | ✗                 |
| Ver histórico completo        | ✓    | ✓        | próprias | próprias        |
| Gerenciar formulários         | ✓    | ✓        | ✗      | ✗                 |

### Enforcement

- **Firestore Rules**: verificam `perfil` do token para operações diretas
- **Cloud Functions**: validam permissões antes de executar a engine
- **Frontend**: oculta ações não permitidas (defesa em profundidade, não substitui o backend)

---

## Estratégia de Versionamento

### Modelos de Processo

1. Modelo em `rascunho` pode ser editado livremente
2. Ao `publicar`, a versão é incrementada e uma cópia imutável é criada
3. Instâncias guardam `processo_modelo_versao` — nunca são afetadas por publicações futuras
4. Para modificar um processo publicado: criar nova versão em rascunho, publicar, instâncias antigas continuam na versão anterior

### Formulários

- Versionados independentemente do processo
- EtapaModelo referencia o `formulario_modelo_id` fixo no momento da publicação
- TarefaWorkflow armazena `dados_formulario` como snapshot imutável

### API

- Prefix de versão nas Cloud Functions: `workflow/v1/...`
- Breaking changes → nova função `workflow/v2/...` com período de deprecação de 90 dias

---

## Telas do Frontend

### 1. Modelagem do Processo (`#workflow-modelagem`)
- Lista de ProcessoModelo com filtro por status
- Formulário de criação/edição do modelo
- Configuração visual das etapas (lista ordenável)
- Configuração de transições entre etapas
- Botão "Publicar"

### 2. Configuração de Formulário (`#workflow-formulario`)
- Editor visual de campos (adicionar, remover, reordenar)
- Preview em tempo real do formulário
- Associação ao formulário modelo existente ou criação de novo

### 3. Lista de Tarefas (`#workflow-tarefas`)
- Cards de tarefas pendentes/em execução do usuário
- Indicador visual de SLA (verde/amarelo/vermelho)
- Filtros: status, processo, prazo
- Badge de contagem no menu

### 4. Execução da Tarefa (`#workflow-executar-tarefa`)
- Instruções da etapa
- Formulário dinâmico renderizado pelo schema JSON
- Dados das etapas anteriores (somente leitura)
- Botões de ação (transições disponíveis)
- Campo de observação

### 5. Lista de Instâncias (`#workflow-instancias`)
- Instâncias abertas pelo usuário e atribuídas ao usuário
- Status e etapa atual
- Link para histórico

### 6. Histórico da Instância (`#workflow-historico`)
- Timeline vertical de eventos
- Dados de cada etapa concluída
- Status atual com SLA
- Botão de cancelamento (se permitido)
