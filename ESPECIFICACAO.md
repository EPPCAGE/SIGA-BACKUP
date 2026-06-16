# Especificação Técnica — Módulo de Workflow Dinâmico (SIGA 2.0)

> **Data:** 2026-06-16  
> **Sistema:** SIGA 2.0 — EP·CAGE / Sefaz-RS  
> **Arquivo principal:** `src/workflow/workflow-engine-ui.js` (~5 500 linhas)  
> **Arquivo de contrato de UI:** `src/workflow/workflow-ui-contract.js`  
> **Constantes:** `src/workflow/workflow-constants.js`  
> **Renderizador externo:** `src/workflow/workflow-renderer.js` (opcional/plugável)  
> **Renderizador de formulários:** `src/workflow/form-renderer.js` (externo ao escopo deste doc)

---

## 1. Visão Geral

O módulo de **Workflow Dinâmico** é uma plataforma de BPM (Business Process Management) embutida no SIGA 2.0 que permite:

1. **Modelar** processos institucionais visualmente como diagramas BPMN 2.0, usando a biblioteca **bpmn.js** (BpmnJS).
2. **Publicar** esses modelos tornando-os instanciáveis.
3. **Iniciar** instâncias de processos (manualmente, agendadas ou recorrentes).
4. **Executar** etapas em filas de trabalho pessoais ou compartilhadas.
5. **Controlar** o ciclo de vida de cada instância (avançar, devolver, suspender, cancelar, concluir).
6. **Notificar** os participantes via notificações internas e e-mail (EmailJS).
7. **Auditar** toda a trilha de eventos num histórico imutável.

### 1.1 Quem usa

| Perfil | Papel no módulo |
|--------|----------------|
| `ep` (Equipe de Processos) | Acesso total: modela, publica, exclui, administra qualquer instância e tarefa |
| `gestor` | Lê todas as instâncias e tarefas; pode suspender, retomar, cancelar; não modela |
| `dono` | Executa tarefas atribuídas a si; vê apenas as próprias instâncias iniciadas como solicitante |
| `solicitante` | Perfil especial — inicia processos e acompanha as próprias instâncias; não vê a fila de tarefas de outros |
| qualquer autenticado | Pode iniciar processos publicados e ver o próprio histórico como solicitante |

### 1.2 Posição no sistema

O módulo é carregado como parte da página `processos.html` pelo bloco de scripts no final do arquivo:

```html
<script src="src/workflow/workflow-constants.js"></script>
<script src="src/workflow/form-renderer.js"></script>
<script src="src/workflow/workflow-ui-contract.js"></script>
<script src="src/workflow/workflow-renderer.js"></script>
<script src="src/workflow/workflow-engine-ui.js"></script>
```

Toda a lógica é encapsulada numa IIFE `(function initWorkflowUI(globalScope){…})(globalThis)` que expõe funções no escopo global via `Object.assign(globalScope, {…})`.

A navegação para o módulo ocorre pelo botão `#nb-workflow` do menu lateral, que chama `_invokeGlobalHandler('rWorkflow')`.

---

## 2. Coleções Firestore (wf\_*)

### 2.1 Diagrama ER (narrativa)

```
wf_processo_modelos (1) ──< wf_instancia_processos
wf_instancia_processos (1) ──< wf_tarefa_workflows
wf_instancia_processos (1) ──< wf_historico_workflows
wf_instancia_processos (1) ──< wf_comentarios (via instancia_id)
wf_tarefa_workflows (1) ──< wf_comentarios (via tarefa_id)
wf_tarefa_workflows (N) >── wf_grupos
wf_formulario_modelos (1) ──< wf_tarefa_workflows (via formulario_id)
wf_grupos (N) >── config/usuarios (referência por email)
wf_notificacoes (N) >── wf_instancia_processos / wf_tarefa_workflows
wf_emails_pendentes — fila de despacho do EmailJS
```

### 2.2 `wf_processo_modelos` — Modelos de Processo

Cada documento representa a **definição** de um tipo de processo workflow (equivalente a um template BPMN).

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID Firestore |
| `nome` | string | sim | Nome do modelo (ex.: "Aprovação de Documento") |
| `descricao` | string | não | Texto livre de descrição |
| `status` | string enum | sim | `rascunho` \| `publicado` \| `arquivado` |
| `versao` | number (int) | sim | Versão do modelo; inicia em 1, incrementada a cada edição de formulário |
| `processo_origem_id` | string \| null | não | ID do documento `processos` de onde foi importado o mapeamento |
| `processo_origem_nome` | string \| null | não | Nome do processo de origem (redundância para display) |
| `fluxo_origem` | string \| null | não | `'asis'` \| `'tobe'` — qual versão do mapeamento foi importada |
| `bpmn_xml` | string | sim | XML BPMN 2.0 completo do diagrama (gerenciado pelo bpmn.js) |
| `canvas` | object | sim | Representação serializada do canvas (ver sub-seção 2.2.1) |
| `config_nos` | object (map) | sim | Mapa `{ [bpmnElementId]: ConfigNo }` — configurações por elemento (ver 2.2.2) |
| `criado_por` | string (uid) | não | UID do usuário que criou o modelo |
| `_criado_em` | Timestamp | auto | Injetado pelo helper `_addDoc` |
| `_atualizado_em` | Timestamp | auto | Atualizado pelo helper `_updateDoc` |

#### 2.2.1 Estrutura de `canvas`

```json
{
  "nos": [
    {
      "id": "start",
      "tipo": "inicio",
      "nome": "Início",
      "x": 160,
      "y": 200,
      "config": { /* ConfigNo — ver 2.2.2 */ }
    },
    {
      "id": "task_1",
      "tipo": "tarefa",
      "nome": "Elaboração",
      "x": 300,
      "y": 200,
      "config": {}
    },
    {
      "id": "gw1",
      "tipo": "gateway_xor",
      "nome": "Aprovado?",
      "x": 450,
      "y": 200,
      "config": {}
    },
    {
      "id": "end",
      "tipo": "fim",
      "nome": "Fim",
      "x": 600,
      "y": 200,
      "config": {}
    }
  ],
  "arestas": [
    {
      "id": "f1",
      "origem": "start",
      "destino": "task_1",
      "acao": "avancar",
      "label": "Avançar",
      "condicoes": [],
      "operador_logico": "AND",
      "padrao": false
    }
  ]
}
```

**Tipos de nó** (`tipo`):

| Valor | Mapeamento BPMN | Descrição |
|-------|----------------|-----------|
| `inicio` | `bpmn:StartEvent` | Evento de início do fluxo |
| `fim` | `bpmn:EndEvent` | Evento de fim do fluxo |
| `tarefa` | `bpmn:Task`, `bpmn:UserTask`, `bpmn:ManualTask`, `bpmn:ServiceTask` | Etapa executável por um usuário |
| `aprovacao` | `bpmn:ExclusiveGateway` (quando tem ações aprovar/rejeitar) | Gateway com decisão explícita |
| `gateway_xor` | `bpmn:ExclusiveGateway`, `bpmn:InclusiveGateway` | Gateway condicional |
| `gateway_and` | `bpmn:ParallelGateway` | Gateway paralelo (fork/join) |
| `intermediario` | `bpmn:IntermediateCatchEvent`, `bpmn:IntermediateThrowEvent` | Evento intermediário (mensagem, timer, sinal) |

#### 2.2.2 Estrutura de `ConfigNo` (elemento de `config_nos` e `canvas.nos[].config`)

```json
{
  "papeis": {
    "executor": "solicitante",
    "revisor": null,
    "aprovador": null,
    "ciente": []
  },
  "acoes": ["avancar"],
  "formulario_id": null,
  "sla_horas": 0,
  "instrucoes": "",
  "exige_parecer": false,
  "titulo_notificacao": "",
  "mensagem_notificacao": "",
  "comentario_automatico": "",
  "acoes_condicionais": [],
  "campos_condicionais": [],
  "condicoes": [],
  "operador_logico": "AND",
  "padrao": false,
  "destino_devolucao": null,
  "tipo_disparo": null,
  "agendado_padrao": null,
  "descricao": "",
  "tipo_fim": null,
  "mensagem_fim": "",
  "notificar_fim": null,
  "recorrencia": null
}
```

| Campo | Tipo | Aplicável a | Descrição |
|-------|------|-------------|-----------|
| `papeis.executor` | string | tarefa, aprovacao | Papel que executa a etapa. Valores: `solicitante`, `gestor_solicitante`, `gestor_executor`, `ep`, `gestor`, `dono`, `grupo:<id>`, `grupo_chefe:<id>`, `grupo_membro:<id>:<email>` |
| `papeis.revisor` | string \| null | tarefa | Papel revisor (opcional, configuração avançada) |
| `papeis.aprovador` | string \| null | tarefa | Papel aprovador (opcional) |
| `papeis.ciente` | string[] | tarefa | Papéis que devem ser notificados como "ciente" |
| `acoes` | string[] | tarefa, aprovacao | Ações disponíveis: `avancar`, `devolver`, `aprovar`, `rejeitar`, `concluir`, `solicitar_ajuste` |
| `formulario_id` | string \| null | tarefa | ID de documento em `wf_formulario_modelos` |
| `sla_horas` | number | tarefa | SLA em horas úteis (0 = sem prazo) |
| `instrucoes` | string | tarefa | Texto de orientação exibido ao executor |
| `exige_parecer` | boolean | tarefa | Se true, `observacao` torna-se obrigatória |
| `titulo_notificacao` | string | tarefa | Template do título da notificação. Suporta `{{etapa.nome}}`, `{{processo.titulo}}` |
| `mensagem_notificacao` | string | tarefa | Template da mensagem. Mesmas variáveis |
| `comentario_automatico` | string | tarefa | Template de comentário criado automaticamente ao iniciar a etapa |
| `acoes_condicionais` | array | tarefa | Regras para visibilidade de botões de ação. Cada item: `{acao, campo, operador, valor}` |
| `campos_condicionais` | array | tarefa | Regras de visibilidade/obrigatoriedade de campos do formulário. Cada item: `{campo_id, acao, condicoes[], operador_logico}` |
| `condicoes` | array | aresta | Para arestas: condições de roteamento. Cada item: `{campo, operador, valor}` |
| `operador_logico` | string | aresta | `AND` (todas as condições) \| `OR` (qualquer condição) |
| `padrao` | boolean | aresta | Se true, esta aresta é usada quando nenhuma outra condição for atendida |
| `destino_devolucao` | string \| null | tarefa | ID do nó para devolver (null = etapa imediatamente anterior) |
| `tipo_disparo` | string \| null | inicio | `manual` \| `agendado` \| `recorrente` \| `evento` |
| `agendado_padrao` | string \| null | inicio | Valor padrão para datetime-local ao iniciar agendado |
| `descricao` | string | inicio | Orientação ao solicitante exibida na primeira etapa |
| `tipo_fim` | string \| null | fim | `normal` \| `cancelado` \| `erro` |
| `mensagem_fim` | string | fim | Mensagem exibida ao solicitante ao concluir. Suporta `{{processo.titulo}}`, `{{solicitante.nome}}` |
| `notificar_fim` | string \| null | fim | `ep` \| `gestor` \| `todos` \| null (apenas solicitante) |
| `recorrencia` | object \| null | inicio | Configuração de recorrência (ver 2.2.3) |

#### 2.2.3 Estrutura de `recorrencia` (para `tipo_disparo = 'recorrente'`)

```json
{
  "ativo": true,
  "tipo": "mensal_dia_util",
  "hora": 8,
  "dia_semana": 1,
  "dia_mes": 1,
  "numero_dia_util": 1,
  "mes": 1
}
```

| Campo | Valores `tipo` suportados |
|-------|--------------------------|
| `tipo` | `diario`, `semanal`, `mensal_dia_fixo`, `mensal_dia_util`, `mensal_ultimo_dia`, `mensal_ultimo_dia_util`, `trimestral`, `anual` |
| `hora` | 0–23 (hora de disparo) |
| `dia_semana` | 0–6 (apenas `semanal`) |
| `dia_mes` | 1–31 (apenas `mensal_dia_fixo`, `anual`) |
| `numero_dia_util` | 1–23 (apenas `mensal_dia_util`) |
| `mes` | 1–12 (apenas `anual`) |
| `ativo` | boolean — habilita/desabilita a recorrência |

---

### 2.3 `wf_instancia_processos` — Instâncias de Processo

Cada documento representa uma **execução concreta** de um modelo de processo.

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID da instância |
| `titulo` | string | sim | Título da instância (ex.: "Aprovação de Relatório — 01/06/2026") |
| `status` | string enum | sim | `em_andamento` \| `concluido` \| `cancelado` \| `suspenso` \| `agendado` |
| `processo_modelo_id` | string \| null | condicional | ID em `wf_processo_modelos` (instâncias criadas pelo designer) |
| `processo_id` | string \| null | condicional | ID em `processos` (instâncias criadas diretamente de mapeamentos legados) |
| `processo_nome` | string | não | Nome do processo de origem (redundância para display) |
| `solicitante_uid` | string | sim | UID do usuário que iniciou a instância |
| `etapa_atual_id` | string \| null | sim | ID do nó BPMN da etapa em execução |
| `etapa_atual_nome` | string \| null | não | Nome da etapa atual (redundância) |
| `responsavel_atual_nome` | string \| null | não | Nome do responsável atual (redundância para solicitante ver) |
| `snapshot_etapas` | array | não | Lista de etapas capturada no momento do início (para instâncias de mapeamentos legados). Cada item: `{id, nome, tipo, desc, executor, modo, natureza, sla_horas}` |
| `canvas` | object \| null | não | Snapshot do canvas no momento do início (copiado de `wf_processo_modelos.canvas`). Mesmo formato que 2.2.1 |
| `config_nos` | object \| null | não | Snapshot de `config_nos` copiado do modelo no início |
| `dados_consolidados` | object | sim | Mapa `{ [campoId]: valor }` acumulando todas as respostas de formulários de etapas anteriores |
| `fluxo_origem` | string \| null | não | `'asis'` \| `'tobe'` |
| `agendado_para` | Timestamp \| null | não | Data/hora em que a instância agendada deve ser ativada automaticamente |
| `excluida` | boolean \| null | não | Soft delete — se true, a instância não aparece nas listagens |
| `_criado_em` | Timestamp | auto | Data de criação |
| `_atualizado_em` | Timestamp | auto | Data da última atualização |

**Relacionamentos:** Uma instância referencia exatamente um modelo de processo (`processo_modelo_id`) ou um processo legado (`processo_id`). Suas tarefas ficam em `wf_tarefa_workflows` (filtradas por `instancia_id`). Seu histórico de eventos fica em `wf_historico_workflows`.

---

### 2.4 `wf_tarefa_workflows` — Tarefas

Cada documento representa uma **tarefa individual** dentro de uma instância, equivalente a um token de BPM.

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID da tarefa |
| `instancia_id` | string | sim | Referência para `wf_instancia_processos` |
| `processo_nome` | string | não | Nome do processo (redundância para display) |
| `etapa_modelo_id` | string | sim | ID do nó BPMN que esta tarefa representa |
| `etapa_nome` | string | não | Nome da etapa (redundância para display) |
| `etapa_desc` | string \| null | não | Descrição/instrução da etapa copiada do modelo |
| `status` | string enum | sim | `pendente` \| `em_execucao` \| `concluida` \| `cancelada` \| `vencida` |
| `responsavel_uid` | string \| null | não | UID do responsável atual. null = disponível para a fila |
| `papel_alvo` | string \| null | não | Papel ou valor de responsabilidade resolvido: `solicitante`, `ep`, `gestor`, `grupo:<id>`, `grupo_membro:<id>:<email>` etc. |
| `papel_responsavel` | string \| null | não | Papel do responsável que assumiu (para exibição) |
| `grupo_id` | string \| null | não | ID do grupo responsável pela fila (quando `papel_alvo` começa com `grupo:`) |
| `formulario_id` | string \| null | não | ID em `wf_formulario_modelos` vinculado a esta etapa |
| `dados_formulario` | object | não | Dados preenchidos nesta tarefa `{ [campoId]: valor }` |
| `acoes_disponiveis` | string[] | não | Ações configuradas para esta etapa (copiadas do modelo) |
| `exige_parecer` | boolean | não | Se true, campo observação é obrigatório |
| `instrucoes` | string | não | Instrução copiada do ConfigNo |
| `motivo_devolucao` | string \| null | não | Preenchido quando a tarefa foi devolvida por etapa posterior |
| `prazo` | Timestamp \| null | não | Data/hora limite para conclusão (calculada com SLA) |
| `sla_vencido` | boolean | não | Flag calculada pelo backend para indicar SLA vencido |
| `anexos` | array | não | Lista de anexos: `[{nome, url, path, tamanho}]` |
| `_criado_em` | Timestamp | auto | Data de criação |
| `_atualizado_em` | Timestamp | auto | Data da última atualização |

**Nota:** Quando `responsavel_uid` é null e `grupo_id` está preenchido, a tarefa fica em "fila de grupo" — visível a todos os membros daquele grupo mas sem responsável definido. Quando ambos são null e `papel_alvo` tem um perfil (ex.: `ep`), todos os usuários com aquele perfil podem ver e assumir a tarefa.

---

### 2.5 `wf_historico_workflows` — Histórico de Eventos

Coleção **imutável** — apenas criação permitida (nenhum update ou delete). Funciona como log de auditoria.

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID do evento |
| `instancia_id` | string | sim | Referência para `wf_instancia_processos` |
| `tipo_evento` | string enum | sim | Tipo do evento (ver tabela abaixo) |
| `usuario_uid` | string \| null | sim | UID do usuário responsável pelo evento (`'sistema'` para ações automáticas) |
| `etapa_id` | string \| null | não | ID do nó BPMN da etapa onde ocorreu o evento |
| `tarefa_id` | string \| null | não | ID da tarefa relacionada |
| `descricao` | string | sim | Descrição legível do evento |
| `dados` | object | não | Dados adicionais: `{acao, parecer, papel, …}` |
| `_criado_em` | Timestamp | auto | Data de criação |

**Tipos de evento** (`tipo_evento`):

| Valor | Descrição |
|-------|-----------|
| `instancia_criada` | Processo iniciado |
| `tarefa_criada` | Nova tarefa criada |
| `tarefa_assumida` | Usuário assumiu a tarefa da fila |
| `tarefa_iniciada` | Tarefa marcada como em execução |
| `tarefa_concluida` | Tarefa concluída (com ação registrada em `dados.acao`) |
| `etapa_avancada` | Fluxo avançou para próxima etapa |
| `instancia_concluida` | Processo concluído |
| `instancia_cancelada` | Processo cancelado (com motivo em `dados.motivo`) |
| `sla_alerta` | Alerta de prazo próximo |
| `sla_vencido` | Prazo vencido |

---

### 2.6 `wf_comentarios` — Comentários

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID do comentário |
| `tarefa_id` | string \| null | condicional | Referência à tarefa (para comentários de execução) |
| `instancia_id` | string | sim | Referência à instância (para agrupamento no histórico) |
| `etapa_id` | string \| null | não | ID do nó BPMN |
| `etapa_nome` | string \| null | não | Nome da etapa (para agrupamento no histórico por etapa) |
| `autor_uid` | string | sim | UID do autor |
| `texto` | string | sim | Conteúdo do comentário |
| `respondendo_a` | string \| null | não | ID de outro comentário (para threads de resposta) |
| `criado_em` | Timestamp | não | Data de criação (campo legado) |
| `_criado_em` | Timestamp | auto | Data de criação (campo padrão adicionado por `_addDoc`) |

**Observação:** O campo `autor_uid` pode ser `'sistema'` para comentários automáticos criados pela engine ao iniciar uma etapa (ver `comentario_automatico` em ConfigNo).

---

### 2.7 `wf_formulario_modelos` — Modelos de Formulário

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID do formulário |
| `titulo` | string | sim | Nome do formulário (ex.: "Dados da Solicitação") |
| `campos` | array | sim | Lista ordenada de campos (ver 2.7.1) |
| `versao` | number (int) | sim | Versão; incrementada a cada salvamento |
| `_criado_em` | Timestamp | auto | Data de criação |
| `_atualizado_em` | Timestamp | auto | Data da última atualização |

#### 2.7.1 Estrutura de cada item de `campos`

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string | sim | Identificador único do campo (ex.: `campo_1718000000000`) |
| `label` | string | sim | Rótulo exibido ao usuário |
| `tipo` | string enum | sim | `texto` \| `textarea` \| `numero` \| `data` \| `select` \| `checkbox` \| `arquivo` |
| `obrigatorio` | boolean | sim | Se true, o campo é obrigatório por padrão (pode ser sobrescrito por `campos_condicionais`) |
| `opcoes` | string[] | condicional | Lista de opções (apenas para `tipo = 'select'` ou `'checkbox'`) |

---

### 2.8 `wf_grupos` — Grupos de Responsáveis

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID do grupo |
| `nome` | string | sim | Nome do grupo (ex.: "Equipe de Controle Interno") |
| `descricao` | string | não | Descrição do grupo |
| `membros_email` | string[] | sim | Lista de e-mails dos membros |
| `chefe_email` | string \| null | não | E-mail do chefe do grupo (pode ser selecionado como responsável direto) |
| `_criado_em` | Timestamp | auto | Data de criação |
| `_atualizado_em` | Timestamp | auto | Data da última atualização |

**Nota:** O campo legado `membros_uid` também pode existir em registros antigos; o código trata ambos.

---

### 2.9 `wf_notificacoes` — Notificações

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID da notificação |
| `destinatario_uid` | string | sim | UID do destinatário. Valor especial `'ep_escalada'` para escaladas de SLA para o perfil EP |
| `titulo` | string | sim | Título da notificação |
| `mensagem` | string | sim | Corpo da notificação |
| `lida` | boolean | sim | Se foi lida pelo usuário |
| `instancia_id` | string \| null | não | Referência à instância (para navegação ao clicar) |
| `tarefa_id` | string \| null | não | Referência à tarefa |
| `tipo` | string enum | não | `tarefa_criada` \| `prazo_proximo` \| `tarefa_vencida` \| `tarefa_concluida` |
| `criado_em` | Timestamp | não | Data de criação |
| `_criado_em` | Timestamp | auto | Data de criação (padrão) |

**Regra de acesso:** Cada usuário só lê as próprias notificações. A única exceção é o perfil EP, que pode ler notificações com `destinatario_uid == 'ep_escalada'`. A única atualização permitida é o campo `lida` (pela própria engine cliente via API `wfNotificacoes`).

---

### 2.10 `wf_emails_pendentes` — Fila de E-mails

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|------------|-----------|
| `id` | string (doc ID) | auto | ID do item de fila |
| `destinatario_email` | string | sim | E-mail do destinatário |
| `destinatario_nome` | string | não | Nome do destinatário |
| `template_id` | string | sim | Template ID do EmailJS |
| `params` | object | sim | Parâmetros do template (título, etapa, instruções, etc.) |
| `enviado` | boolean | sim | Se foi enviado |
| `tentativas` | number | sim | Número de tentativas de envio |
| `enviado_em` | Timestamp \| null | não | Data do envio bem-sucedido |
| `erro` | string \| null | não | Mensagem de erro da última tentativa |
| `_criado_em` | Timestamp | auto | Data de criação |
| `_atualizado_em` | Timestamp | auto | Data da última atualização |

**Acesso:** Apenas perfil EP pode criar, ler, atualizar e excluir. A Cloud Function enfileira; o cliente EP envia via EmailJS (que é client-side) e marca como `enviado`.

---

## 3. Máquina de Estados

### 3.1 Estados de `wf_instancia_processos`

```
[agendado] ──(ativar)──→ [em_andamento]
[em_andamento] ──(concluir última etapa)──→ [concluido]
[em_andamento] ──(cancelar)──→ [cancelado]
[em_andamento] ──(suspender)──→ [suspenso]
[suspenso] ──(retomar)──→ [em_andamento]
[cancelado] ──(excluir soft)──→ [excluida=true]
[concluido] ──(excluir soft)──→ [excluida=true]
```

| Estado | Descrição |
|--------|-----------|
| `agendado` | Instância criada mas não iniciada — aguarda data/hora ou ativação manual |
| `em_andamento` | Instância em execução com pelo menos uma tarefa aberta |
| `concluido` | Todas as etapas concluíram e o fluxo chegou ao nó `fim` |
| `cancelado` | Cancelada por EP ou Gestor com motivo registrado no histórico |
| `suspenso` | Pausada temporariamente; nenhuma nova tarefa é criada |

### 3.2 Estados de `wf_tarefa_workflows`

```
[pendente] ──(iniciar/assumir)──→ [em_execucao]
[pendente] ──(SLA vencido)──→ [vencida]
[em_execucao] ──(concluir com ação 'avancar')──→ [concluida]
[em_execucao] ──(concluir com ação 'devolver')──→ [concluida] + nova tarefa na etapa anterior
[em_execucao] ──(SLA vencido)──→ [vencida]
[em_execucao] ──(cancelar instância)──→ [cancelada]
[vencida] ──(continuar executando)──→ mantém vencida até concluir
```

| Estado | Descrição |
|--------|-----------|
| `pendente` | Tarefa criada, aguardando responsável |
| `em_execucao` | Responsável assumiu e está executando |
| `concluida` | Tarefa encerrada (com qualquer ação) |
| `cancelada` | Cancelada por encerramento da instância |
| `vencida` | SLA ultrapassado (mantida no estado para operação mas sinalizada) |

### 3.3 Transições e Ações

O motor de regras (`_proximoNoExecutavel`) navega pelo canvas para determinar o próximo nó após cada ação. A lógica:

1. Obtém as arestas de saída do nó atual filtradas pela `acao` escolhida.
2. Avalia as condições de cada aresta: primeiras as condicionais (usando `_avaliarCondicoes`), depois a aresta `padrao`.
3. Se o próximo nó for um gateway (XOR, AND) ou início, continua a travessia recursivamente.
4. Para ao encontrar um nó `tarefa`, `aprovacao` ou `fim`.

**Ações normalizadas:**

| Ação original | Normalizada para | Efeito |
|--------------|-----------------|--------|
| `avancar` | `avancar` | Avança para próxima etapa |
| `concluir` | `avancar` | Sinônimo de avancar (legado) |
| `aprovar` | `avancar` | Sinônimo de avancar (legado) |
| `rejeitar` | `devolver` | Devolve para etapa anterior |
| `solicitar_ajuste` | `devolver` | Devolve para etapa anterior |
| `devolver` | `devolver` | Devolve para etapa anterior |

Ao devolver, o sistema:
1. Pede o motivo através do modal `_wfPedirMotivoDevolucao`.
2. Conclui a tarefa atual com `motivo_devolucao` preenchido.
3. Cria uma nova tarefa na etapa anterior (ou em `destino_devolucao` se configurado) com `motivo_devolucao` preenchido para guiar o executor.

---

## 4. Perfis de Usuário e Permissões

### 4.1 Regras do Firestore (defesa em profundidade)

Toda escrita na coleção de workflow passa pela Cloud Function (engine) que valida permissões antes de gravar. As regras do Firestore são camada adicional de proteção para acesso direto ao banco.

| Coleção | Leitura | Criação | Atualização | Exclusão |
|---------|---------|---------|-------------|---------|
| `wf_processo_modelos` | Qualquer autenticado | EP | EP | EP |
| `wf_formulario_modelos` | Qualquer autenticado | EP | EP | EP |
| `wf_instancia_processos` | EP, Gestor, ou `solicitante_uid == uid` | Qualquer autenticado | EP, Gestor, ou `solicitante_uid == uid` | Não permitido (soft delete) |
| `wf_tarefa_workflows` | EP, Gestor, `responsavel_uid == uid`, ou `responsavel_uid == null` | Qualquer autenticado | EP, Gestor, `responsavel_uid == uid`, ou `responsavel_uid == null` | EP, Gestor |
| `wf_historico_workflows` | Qualquer autenticado | Qualquer autenticado | Proibido | Proibido |
| `wf_comentarios` | Qualquer autenticado | Qualquer autenticado | Apenas pelo `autor_uid` | Proibido |
| `wf_grupos` | Qualquer autenticado | EP | EP | EP |
| `wf_notificacoes` | `destinatario_uid == uid` ou (EP e `destinatario_uid == 'ep_escalada'`) | Qualquer autenticado | Apenas pelo destinatário (`lida` somente) | Proibido |
| `wf_emails_pendentes` | EP | EP | EP (campos restritos) | EP |

### 4.2 Permissões por funcionalidade na UI

| Funcionalidade | solicitante | dono/gestor | ep |
|---------------|-------------|-------------|-----|
| Ver aba "Minhas Tarefas" | Não | Sim | Sim |
| Executar tarefa própria | Sim | Sim | Sim |
| Delegar tarefa | Não | Não | Sim |
| Puxar tarefa de outro usuário (admin) | Não | Não | Sim |
| Excluir tarefa | Não | Não | Sim |
| Ver "Processos Ativos" (instâncias de outros) | Não (vê "Minhas Solicitações") | Sim (gestor) | Sim |
| Suspender/retomar instância | Não | Sim (gestor) | Sim |
| Cancelar instância | Não | Sim (gestor) | Sim |
| Excluir instância | Não | Não | Sim |
| Aba Modelagem | Não | Não | Sim |
| Criar/editar/publicar modelos | Não | Não | Sim |
| Aba Formulários | Não | Não | Sim |
| Aba Equipes | Não | Não | Sim |
| Aba Visão Admin | Não | Não | Sim |
| Iniciar processo publicado | Sim | Sim | Sim |
| Ver histórico (próprias instâncias) | Sim | Sim | Sim |
| Ver histórico (qualquer instância) | Não | Sim (gestor) | Sim |

---

## 5. Abas e Painéis da Interface

A navegação interna do módulo é controlada por `wfNavWorkflow(painel)`. O estado atual fica em `_st.painelAtual`.

Os painéis são `<div>` com `id="wf-painel-{nome}"`. Somente um é exibido por vez (os demais ficam `display:none`). Ao trocar de painel, a função de carregamento correspondente é chamada automaticamente.

### 5.1 Painel: `tarefas` — Minhas Tarefas

**ID DOM:** `wf-painel-tarefas` | **Tab:** `wf-tab-tarefas` | **Lista:** `wf-lista-tarefas`

**Não visível para solicitante** (classe `.wf-tab-nao-solicitante`).

**O que exibe:**
- Tarefas com `status in ['pendente', 'em_execucao']` onde `responsavel_uid == uid` (buscadas via API `wfTarefas`).
- Tarefas da fila dos grupos do usuário (onde `responsavel_uid == null` e `grupo_id` pertence ao usuário).
- Tarefas por perfil (`papel_alvo == perfil_atual`) sem responsável.
- Paginação de 20 itens por vez com botão "Carregar mais".

**Filtros disponíveis:**
- `#wf-filtro-tarefa-status` — filtra por status.
- `#wf-filtro-tarefa-texto` — filtra por nome da etapa ou nome do processo.

**Ações por tarefa:**
- **Tarefa de fila (sem responsável):** botões "Acessar" (`wfAssumirEAbrirTarefa`) e "Só assumir" (`wfAssumirTarefa`).
- **Tarefa assumida:** botões "Acessar" (`wfAbrirTarefa`) e "Delegar" (`wfAbrirDelegacao`).
- **EP/Gestor:** botão adicional "Excluir" (`wfExcluirTarefa`).

**Badge SLA:** Cada card exibe indicador visual de prazo: verde (no prazo, mais de 2h), amarelo (vencendo, menos de 2h), vermelho (vencido).

---

### 5.2 Painel: `instancias` — Processos Ativos

**ID DOM:** `wf-painel-instancias` | **Tab:** `wf-tab-instancias` | **Lista:** `wf-lista-instancias`

**Para solicitante:** A aba é renomeada para "Minhas Solicitações" e exibe apenas as instâncias do próprio usuário.

**O que exibe:**
- Instâncias obtidas via API `wfInstancias`, ordenadas por data decrescente.
- Barra de progresso visual mostrando etapas concluídas/atual/futuras.
- Badge de status colorido.
- Para instâncias `agendado`: data/hora formatada + botão "Ativar agora" (EP only).

**Filtros:** status e texto livre sobre o título.

**Ações disponíveis:**
- "Ver histórico" (`wfAbrirHistorico`) — qualquer perfil.
- "Ativar agora" (`wfAtivarInstanciaAgora`) — apenas EP, instâncias agendadas.
- "Suspender" (`wfSuspenderInstancia`) — EP/Gestor, instâncias em andamento.
- "Retomar" (`wfRetomarInstancia`) — EP/Gestor, instâncias suspensas.
- "Cancelar" (`wfConfirmarCancelar`) — EP/Gestor.
- "Excluir" (`wfExcluirInstancia`) — EP only, canceladas.

---

### 5.3 Painel: `solicitacoes` — Minhas Solicitações

**ID DOM:** `wf-painel-solicitacoes` | **Tab:** `wf-tab-solicitacoes`

Consulta direta ao Firestore (`wf_instancia_processos` onde `solicitante_uid == uid`). Exibe status atual, etapa atual e responsável. Botão "Histórico" para cada instância.

---

### 5.4 Painel: `iniciar` — Iniciar Processo

**ID DOM:** `wf-painel-iniciar`

Organizado em duas abas internas:

**Aba "Templates" (`wfCarregarTemplatesPublicados`):**
- Lista modelos com `status == 'publicado'` de `wf_processo_modelos`.
- Para cada modelo: nome, descrição, número de etapas, versão.
- Botão "Iniciar" → `wfIniciarDeModelo(modeloId)`.
- Botão "Editar" (EP only) → `wfAbrirDesigner(modeloId)`.

**Aba "Mapeamentos" (`wfCarregarProcessosMapeados`):**
- Lista processos da coleção `processos` que possuem `mod.etapas_proc_tobe` ou `mod.etapas_proc` com atividades executáveis.
- Mostra badge `TO BE` (verde) ou `AS IS` (azul) e primeiras 4 etapas.
- Botão "Iniciar direto" → `wfIniciarDeProcesso(processoId)` — inicia sem designer, usando as etapas do mapeamento.
- Botão "Importar e configurar" (EP only) → `wfImportarMapeamento(processoId)` — cria um modelo em `wf_processo_modelos` a partir do mapeamento e abre o designer.

**Select principal:** `#wf-np-modelo` — lista todos os modelos publicados. Ao selecionar, exibe detalhes. Botão "Iniciar" → `wfIniciarProcesso()`.

---

### 5.5 Painel: `executar` — Executar Tarefa

**ID DOM:** `wf-painel-executar`

Painel de execução de uma tarefa específica. Aberto por `wfAbrirTarefa`.

**Elementos DOM esperados:**

| ID | Conteúdo |
|----|---------|
| `wf-exec-titulo` | Nome da etapa |
| `wf-exec-instrucoes` | Instruções ao executor |
| `wf-exec-motivo-devolvido` | Banner amarelo se tarefa foi devolvida |
| `wf-exec-orientacao-inicio` | Orientação do nó de início (apenas primeira etapa) |
| `wf-exec-dados-anteriores` | Dados coletados em etapas anteriores (dos `dados_consolidados`) |
| `wf-exec-timeline` | Timeline vertical de progresso do fluxo |
| `wf-exec-papel` | Badge com papel do executor |
| `wf-exec-formulario` | Container onde o formulário dinâmico é renderizado |
| `wf-exec-parecer-hint` | Hint de parecer obrigatório |
| `wf-exec-acoes` | Container dos botões de ação |
| `wf-exec-obs` | Textarea de observação/parecer |
| `wf-exec-anexos-lista` | Lista de anexos da tarefa |
| `wf-exec-comentarios` | Thread de comentários da etapa |
| `wf-exec-comentario-texto` | Textarea para novo comentário |
| `wf-exec-respondendo-badge` | Badge indicando resposta a comentário |

**Fluxo de abertura:**
1. `wfAbrirTarefa(tarefaId)` → GET `wfTarefas/{id}` via API.
2. Marca tarefa como `em_execucao` se ainda `pendente` (POST `wfTarefas/{id}/iniciar`).
3. Busca a instância (GET `wfInstanciaItem/{instanciaId}`).
4. Renderiza orientação de início (apenas se é a primeira etapa).
5. Renderiza dados anteriores consolidados.
6. Renderiza timeline lateral.
7. Renderiza papel do executor.
8. Renderiza formulário dinâmico (se `formulario_id` preenchido).
9. Renderiza botões de ação (`_wfRenderAcoesExecucao`).
10. Carrega anexos da tarefa.
11. Carrega comentários da tarefa.

**Botões de ação dinâmicos:** calculados por `_wfAcoesVisiveisExecucao`, que avalia:
- `tarefa.acoes_disponiveis` (configurado no modelo).
- Existência de próxima etapa (legado).
- `acoes_condicionais` do nó (visibilidade condicional por valor de campo do formulário).
- Se o nó `fim` é atingível pela ação `avancar`/`devolver`.

Todas as ações são normalizadas para `avancar` ou `devolver` antes de exibir ao usuário.

**Campo "Quem é seu gestor?":** Aparece automaticamente quando a próxima etapa tem `papeis.executor == 'gestor_solicitante'`.

---

### 5.6 Painel: `historico` — Histórico de Instância

**ID DOM:** `wf-painel-historico`

**Elementos:**

| ID | Conteúdo |
|----|---------|
| `wf-hist-titulo` | Título da instância |
| `wf-hist-resumo` | Status e ID da instância |
| `wf-hist-timeline` | Lista de eventos do histórico |
| `wf-hist-comentarios-por-etapa` | Comentários agrupados por nome de etapa |
| `wf-hist-btn-cancelar` | Visível apenas para EP/Gestor em instâncias em andamento |
| `wf-hist-btn-excluir` | Visível apenas para EP |

**Ações de exportação:**
- `wfExportarHistoricoCSV()` — gera CSV com eventos + comentários.
- `wfExportarHistoricoPDF()` — gera HTML imprimível com tabelas de eventos e comentários agrupados por etapa.

---

### 5.7 Painel: `modelagem` — Modelagem

**ID DOM:** `wf-painel-modelagem` | **Tab:** `wf-tab-modelagem` (EP only)

Lista todos os modelos em `wf_processo_modelos` com status colorido.

**Ações:**
- "Editar" → `wfAbrirConfigModelo(id)` — abre painel `config-modelo`.
- "Publicar" → `_wfPublicarModeloId(id)` — disponível apenas em rascunhos.
- "Excluir" → `wfExcluirModelo(id)` — bloqueado se há instâncias ativas.
- "+ Novo modelo" → `wfAbrirModalNovoModelo()` — modal com nome + template institucional.

**Templates institucionais disponíveis:**
- `vazio` — fluxo em branco.
- `aprovacao_binaria` — Análise → Gateway (aprovar/devolver) → Publicação / Devolução.
- `triagem_prioridade` — Triagem → Gateway → Atendimento Urgente / Atendimento Normal.
- `aprovacao_com_retrabalho` — Elaboração → Revisão → Gateway → Publicação / Ajustes (com ciclo de retrabalho).

---

### 5.8 Painel: `config-modelo` — Configuração do Modelo

**ID DOM:** `wf-painel-config-modelo`

Painel central de edição de um modelo específico. Carregado por `wfAbrirConfigModelo(modeloId)`.

**Subseções:**
- **Cabeçalho:** nome (`#wf-designer-nome`), descrição (`#wf-designer-desc`), badge de status, botão "Publicar" (apenas rascunhos).
- **Canvas BPMN:** `#wf-bpmn-canvas` (gerenciado pelo `BpmnJS`). Botão de maximizar (`wfToggleCanvasMaximize`).
- **Painel de configuração do elemento selecionado:** `#wf-designer-config` — renderizado dinamicamente conforme o tipo de elemento BPMN clicado.
- **Indicador de alterações pendentes:** `#wf-bpmn-dirty` — pisca quando há alterações não salvas.
- **Status de nuvem:** `#wf-cloud-save-status` — exibe "Salvando…" / "✓ Salvo na nuvem" / "⚠ Erro".
- **Vincular processo mapeado:** `wfAbrirModalVincularArquitetura()`.
- **Simulador:** `wfDesignerSimular()` — abre modal `#wf-modal-simulacao`.

**Modo simples/avançado:** `wfDesignerSetMode('simples'|'avancado')`. Em modo simples, seções marcadas com `data-wf-advanced="true"` são ocultadas.

**Autosave:** 600ms de debounce após qualquer alteração nos campos de config do nó. Salva apenas `config_nos` (não o XML do BPMN).

---

### 5.9 Painel: `formularios` — Formulários

**ID DOM:** `wf-painel-formularios` | **Tab:** `wf-tab-formularios` (EP only)

Lista todos os formulários em `wf_formulario_modelos`. Botão "Editar" abre modal.

**Modal de edição (`wf-modal-formulario`):**
- Campo de título (`#wf-modal-form-titulo`).
- Lista de campos com drag visual (setas ↑↓).
- Para cada campo: label, tipo (select, text, etc.), opções (para select/checkbox), obrigatoriedade.
- Botão "+ Adicionar campo" → `_wfAdicionarCampo()`.
- Salvar → `wfSalvarFormulario()`.

---

### 5.10 Painel: `notificacoes` — Notificações

**ID DOM:** `wf-painel-notificacoes` | **Tab:** `wf-tab-notificacoes`

- Lista de notificações do usuário obtidas via API `wfNotificacoes`, ordenadas por data decrescente.
- Não lidas exibidas com fundo azul claro.
- Clicar em uma notificação: marca como lida (POST `wfNotificacoes/{id}/marcar-lida`) e navega para o histórico da instância relacionada.
- Botão "Marcar todas como lidas" → `wfMarcarTodasLidas()`.

**Badge no menu lateral:** `#nb-workflow` recebe um badge vermelho com a contagem de notificações não lidas, atualizado ao carregar o módulo e sempre que o painel de notificações é aberto.

---

### 5.11 Painel: `equipes` — Equipes

**ID DOM:** `wf-painel-equipes` | **Tab:** `wf-tab-equipes` (EP only, oculto para solicitante)

Organizado em duas subabas:

**Aba "Grupos" (`wfCarregarGrupos`):**
- Lista de todos os grupos em `wf_grupos`.
- Exibe nome, descrição, chefe, número de membros e lista de membros.
- Botões "Editar" e "Excluir" (EP only).
- Modal `#wf-modal-grupo` para criar/editar: nome, descrição, checkboxes de membros (por e-mail da lista `USUARIOS`), select de chefe (apenas membros marcados).

**Aba "Usuários" (`wfCarregarEquipesUsuarios`):**
- Tabela com todos os usuários: Nome, E-mail, Perfil(s), Grupos.
- Fonte: `USUARIOS` (global carregada de `config/usuarios`) + `wf_grupos` para associar grupos.

---

### 5.12 Painel: `admin-tarefas` — Visão Admin

**ID DOM:** `wf-painel-admin-tarefas` | **Tab:** `wf-tab-admin-tarefas` (EP only)

Tabela com todas as tarefas abertas do sistema (GET `wfTarefas?admin=true`).

**Colunas:** Processo, Etapa, Responsável (nome + e-mail + papel quando sem responsável), Status (badge colorido), Prazo (vermelho se vencido), Ações.

**Ações por linha:** "Puxar" (`wfAdminPuxarTarefa`) — assume a tarefa (com reatribuição), "Ver" (`wfAdminVerTarefa`) — abre histórico da instância, "Excluir" (`wfExcluirTarefa`).

**Filtros:** status e texto livre sobre processo, etapa ou responsável.

---

## 6. Catálogo de Funções

### 6.1 Funções de Inicialização e Navegação

#### `rWorkflow()`
- **Propósito:** Ponto de entrada do módulo. Chamado por `_invokeGlobalHandler('rWorkflow')` quando o usuário clica em "Workflow" no menu.
- **Parâmetros:** nenhum.
- **Lê:** `globalScope.wfValidateWorkflowUIContract`, `globalScope.isSolicitante()`, `globalScope.usuarioLogado.perfil`.
- **Efeitos:** Valida IDs DOM obrigatórios; ajusta visibilidade das abas para solicitante; carrega badge de notificações; navega para o painel inicial (`tarefas` ou `instancias`).

#### `wfNavWorkflow(painel)`
- **Propósito:** Navega entre painéis do módulo.
- **Parâmetros:** `painel` (string) — nome do painel destino.
- **Efeitos:** Oculta todos os painéis; exibe o alvo; atualiza peso de fonte das tabs; chama a função de carregamento do painel.

---

### 6.2 Funções de Tarefas

#### `wfCarregarTarefas(acrescentar?)`
- **Propósito:** Carrega e renderiza a lista de tarefas do usuário atual.
- **Parâmetros:** `acrescentar` (boolean, default false) — se true, adiciona mais itens à lista existente (paginação).
- **Lê API:** `wfTarefas` (GET).
- **Renderiza em:** `#wf-lista-tarefas`.
- **Efeitos colaterais:** Atualiza `_st.tarefasLista` e `_st.tarefasCursor`.

#### `wfAbrirTarefa(tarefaId)`
- **Propósito:** Abre o painel de execução para uma tarefa específica.
- **Parâmetros:** `tarefaId` (string).
- **Lê API:** `wfTarefas/{id}`, `wfInstanciaItem/{instanciaId}`, `wf_processo_modelos/{modeloId}` (diretamente no Firestore).
- **Escreve API:** `wfTarefas/{id}/iniciar` (POST, se status == 'pendente').
- **Escreve estado:** `_st.tarefaAtual`, `_st._anexosTarefa`.
- **Navega para:** painel `executar`.

#### `wfAssumirTarefa(tarefaId)`
- **Propósito:** Assume uma tarefa da fila sem abrir o painel de execução.
- **Lê Firestore:** `wf_tarefa_workflows/{tarefaId}`.
- **Escreve API:** `wfTarefas/{id}/assumir` (POST).
- **Efeito colateral:** Recarrega lista de tarefas.

#### `wfAssumirEAbrirTarefa(tarefaId)`
- **Propósito:** Assume uma tarefa (se sem responsável) e abre imediatamente o painel de execução.
- **Combina:** `assumir` + `wfAbrirTarefa`.

#### `wfConcluirTarefa(acaoOriginal)`
- **Propósito:** Conclui a tarefa atual com a ação escolhida.
- **Parâmetros:** `acaoOriginal` (string) — ação bruta (normalizada internamente).
- **Fluxo:**
  1. Normaliza a ação (`_WF_ACAO_NORMALIZAR`).
  2. Se `devolver`: abre modal de motivo (`_wfPedirMotivoDevolucao`).
  3. Valida parecer obrigatório.
  4. Verifica campo de gestor obrigatório.
  5. Coleta dados do formulário (`wfColetarDadosFormulario` — função externa do `form-renderer.js`).
  6. Busca preview de notificação (POST `wfTarefas/{id}/preview-concluir`).
  7. Confirma com o usuário se preview bem-sucedido.
  8. POST `wfTarefas/{id}/concluir` com `{acao, observacao, motivo_devolucao, dados_formulario, anexos, gestor_solicitante_uid}`.
  9. Se `resultado.instancia_concluida`: exibe modal de conclusão com `mensagem_fim`.
- **Navega para:** painel `tarefas`.

#### `wfExcluirTarefa(tarefaId)`
- **Propósito:** Exclui permanentemente uma tarefa (EP only).
- **Escreve API:** `wfTarefas/{id}/excluir` (POST).

#### `wfAbrirDelegacao(tarefaId)` / `wfConfirmarDelegacao()` / `wfFecharDelegacao()`
- **Propósito:** Delegar tarefa a outro usuário.
- **Fluxo:** Busca candidatos (GET `wfTarefas/{id}/candidatos-delegacao`) → seleciona usuário + motivo → POST `wfTarefas/{id}/delegar`.

#### `wfAnexarArquivos(input)` / `wfRemoverAnexo(idx)`
- **Propósito:** Upload/remoção de arquivos anexados a uma tarefa.
- **Usa:** Firebase Storage (`storageRef`, `uploadBytes`, `getDownloadURL`, `deleteObject`).
- **Caminho Storage:** `workflow/{instanciaId}/{tarefaId}/{timestamp}_{nome}`.
- **Estado:** `_st._anexosTarefa` (array de `{nome, url, path, tamanho}`).

---

### 6.3 Funções de Instâncias

#### `wfCarregarInstancias(acrescentar?)`
- **Lê API:** `wfInstancias` (GET).
- **Renderiza em:** `#wf-lista-instancias`.

#### `wfIniciarDeModelo(modeloId)`
- **Propósito:** Inicia uma instância a partir de um modelo publicado.
- **Fluxo:**
  1. Lê o modelo do Firestore.
  2. Verifica nó de início e primeira etapa executável.
  3. Se `tipo_disparo == 'agendado'`: abre modal de agendamento.
  4. POST `wfInstancias` com `{processo_modelo_id, titulo, agendado_para?}`.
  5. Navega para `tarefas` (ou `instancias` para solicitante/agendado).

#### `wfIniciarDeProcesso(processoId)`
- **Propósito:** Inicia instância diretamente de um mapeamento legado (sem designer).
- **Fluxo:** Lê `processos/{id}`, extrai etapas TO BE ou AS IS, monta `snapshot_etapas`, POST `wfInstancias`.

#### `wfAbrirHistorico(instanciaId, titulo, status)`
- **Propósito:** Abre o painel de histórico para uma instância.
- **Lê API:** `wfInstanciaItem/{id}/historico`, `wfComentarios?instancia_id={id}`.
- **Navega para:** painel `historico`.

#### `wfConfirmarCancelar(instanciaId)` / `wfCancelarInstancia()`
- **Escreve API:** `wfInstanciaItem/{id}/cancelar` (POST com `{motivo}`).

#### `wfSuspenderInstancia(instanciaId)` / `wfRetomarInstancia(instanciaId)`
- **Escreve API:** `wfInstanciaItem/{id}/suspender` ou `/retomar` (POST).

#### `wfExcluirInstancia(instanciaId)`
- **Propósito:** Soft delete de instância.
- **Escreve API:** `wfInstanciaItem/{id}/excluir` (POST).

#### `wfAtivarInstanciaAgora(instanciaId)`
- **Propósito:** Ativa manualmente instância agendada (EP only).
- **Fluxo:** Preview (POST `wfAdminJobs/ativar/{id}/preview`) → confirmação → POST `wfAdminJobs/ativar/{id}`.

---

### 6.4 Funções do Designer BPMN

#### `wfAbrirConfigModelo(modeloId)`
- **Propósito:** Abre o painel de configuração de um modelo específico, incluindo inicialização do canvas BPMN.
- **Lê Firestore:** `wf_processo_modelos/{id}`, `wf_grupos` (todos), `wf_formulario_modelos` (todos).
- **Estado:** `_wfModeloAtual`, `_wfConfigNos` (map em memória de todas as configs de nós).
- **Navega para:** painel `config-modelo`.
- **Inicializa bpmn.js** (via `_wfInitModeler`) num `setTimeout` de 0ms.

#### `wfDesignerSalvar(opts?)`
- **Propósito:** Persiste o modelo atual no Firestore.
- **Fluxo:**
  1. Extrai o XML do bpmn.js (`saveXML`).
  2. Extrai o canvas (`_wfSyncCanvas`).
  3. Normaliza e monta o payload (`_wfMontarModeloPersistencia`).
  4. `_updateDoc` ou `_addDoc` em `wf_processo_modelos`.
- **Autosave:** Chamado automaticamente 600ms após qualquer alteração nos campos de config de nó.

#### `wfDesignerPublicar()` / `wfPublicarModelo()`
- **Propósito:** Valida e publica o modelo.
- **Validações (`_wfValidarModeloPublicacao`):**
  - Deve ter exatamente um nó de início.
  - Deve ter pelo menos um nó de fim.
  - Deve ter pelo menos uma aresta.
  - Gateways devem ter ≥ 2 saídas.
  - Cada gateway deve ter uma saída padrão (ou aviso).
  - Cada ação de cada tarefa deve ter destino válido.
- **Escreve Firestore:** `{status: 'publicado'}` em `wf_processo_modelos/{id}`.

#### `wfDesignerSimular()` / `wfExecutarSimulacao()`
- **Propósito:** Simulador de caminho no designer.
- **Fluxo:** Exibe modal `#wf-modal-simulacao` com campos de todos os formulários + seletores de ação por etapa. Ao executar, navega o canvas com `_proximoNoExecutavel` e exibe o caminho percorrido com explicação textual das decisões.

#### `wfToggleCanvasMaximize()`
- **Propósito:** Alterna entre tamanho normal e tela cheia (posição fixed, z-index 9000) para o canvas BPMN.

#### `wfImportarMapeamento(processoId)`
- **Propósito:** Cria um novo modelo em `wf_processo_modelos` a partir de um processo mapeado, reutilizando o BPMN XML existente (`bpmnToBe` ou `bpmnAsIs`) se disponível, ou gerando um novo linearmente.
- **Escreve Firestore:** `_addDoc` em `wf_processo_modelos`.

---

### 6.5 Funções de Configuração de Nós (Designer)

Todos os handlers de painel de configuração são chamados quando o usuário clica em um elemento BPMN no canvas.

#### `wfDesignerCampoCfg(noId, campo, valor)`
- Atualiza `_wfConfigNos[noId][campo]`. Salva imediatamente (debounce 0ms para campos simples).
- Efeito especial: `campo == 'tipo_disparo'` re-renderiza o painel de início.

#### `wfDesignerPapel(noId, papel, valor)`
- Atualiza `_wfConfigNos[noId].papeis[papel]`.

#### `wfDesignerToggleAcao(noId, acao, on)`
- Adiciona ou remove ação do array `acoes` do nó.

#### `wfDesignerSetDestinoDevolucao(noId, destinoId)`
- Define destino de devolução personalizado (nó anterior no canvas BFS reverso).

#### `wfDesignerAddCondicao(arestaId)` / `wfDesignerRemoveCondicao` / `wfDesignerUpdateCondicao`
- Gerenciam lista de condições de roteamento de uma aresta.

#### `wfDesignerArestaPadrao(arestaId, val)`
- Marca/desmarca uma aresta como saída padrão do gateway.

#### `wfDesignerAddAcaoCond(noId)` / `wfDesignerAcaoCondRemove` / `wfDesignerAcaoCondUpdate`
- Gerenciam `acoes_condicionais` de um nó.

#### `wfDesignerAddCampoCond(noId)` / `wfDesignerCampoCondRemove` / `wfDesignerCampoCondUpdate` / `wfDesignerCampoCondAddCond` / `wfDesignerCampoCondRemoveCond` / `wfDesignerCampoCondCond`
- Gerenciam `campos_condicionais` de um nó.

#### `wfDesignerRecorrencia(noId, campo, valor)`
- Atualiza `_wfConfigNos[noId].recorrencia[campo]` e re-renderiza o painel do nó de início com preview da recorrência.

#### `wfDesignerAplicarPreset(noId, presetId)`
- Aplica configurações pré-definidas:
  - `aprovacao_binaria`: configura `acoes_condicionais` com campo do primeiro formulário.
  - `campo_condicional`: configura `campos_condicionais` mostrando campo 2 quando campo 1 != 'nao'.

---

### 6.6 Funções de Formulários

#### `wfCarregarFormularios()`
- Carrega todos os formulários de `wf_formulario_modelos`, atualiza `_st.formularioModelos`.

#### `wfAbrirModalNovoFormulario(formularioId?, origem?)`
- Abre modal `#wf-modal-formulario`. Se `formularioId` fornecido, carrega dados existentes.
- `origem` pode ser `'etapa'` ou `'designer:{noId}'` para atualizar o select correto após salvar.

#### `wfSalvarFormulario()`
- Valida título. Monta campos com `id`, `label`, `tipo`, `obrigatorio`, `opcoes`.
- `_updateDoc` ou `_addDoc` em `wf_formulario_modelos`.
- Atualiza `_st.formularioModelos` e o select de formulário da origem.

---

### 6.7 Funções de Grupos/Equipes

#### `wfCarregarGrupos()` / `wfCarregarEquipes()`
- Carrega `wf_grupos` e exibe no `#wf-lista-grupos`.

#### `wfAbrirModalGrupo(grupoId?)` / `wfSalvarGrupo()` / `wfExcluirGrupo(grupoId)`
- CRUD de grupos. `wfSalvarGrupo` lê checkboxes `#.wf-grupo-membro-cb` e select `#wf-grupo-chefe`.
- Membros identificados por **e-mail** (não UID).

---

### 6.8 Funções de Comentários

#### `wfCarregarComentarios(tarefaId)`
- GET `wfComentarios?tarefa_id={id}`.
- Renderiza thread com raízes e respostas aninhadas.

#### `wfEnviarComentario()`
- POST `wfComentarios` com `{tarefa_id, instancia_id, etapa_id, etapa_nome, texto, respondendo_a?}`.

#### `wfResponderComentario(comentarioId, nomeAutor)` / `wfCancelarResposta()`
- Controla estado de resposta a comentário (`_st._respondendoA`).

---

### 6.9 Funções de Notificações

#### `_wfAtualizarBadgeNotificacoes(notificacoes?)` / `_wfIniciarBadge()`
- Conta notificações não lidas e atualiza badge em `#nb-workflow` e label em `#wf-notif-tab-label`.

#### `wfMarcarNotifLida(notifId, instanciaId, titulo, id)`
- POST `wfNotificacoes/{id}/marcar-lida`.
- Navega para histórico da instância se `instanciaId` fornecido.

#### `wfMarcarTodasLidas()`
- POST `wfNotificacoes/marcar-todas-lidas`.

---

### 6.10 Motor de Regras

#### `_proximoNoExecutavel(canvas, noId, acao, dados?)`
- **Propósito:** Encontra o próximo nó executável (tarefa, aprovação ou fim) no canvas.
- **Algoritmo:** BFS com travessia de gateways e eventos de início transparentes.
- **Avalia condições** usando `_proximoNo` que chama `_avaliarCondicoes` / `_avaliarCondicao`.

#### `_avaliarCondicaoObj(cond, dados)`
- Avalia `{campo, operador, valor}` contra `dados`.
- Operadores suportados: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contém`, `não contém`, `vazio`, `não vazio`.
- Valor especial `__ANY__` sempre retorna true.

#### `_avaliarCondicoes(condicoes[], operadorLogico, dados)`
- Avalia lista de condições com AND ou OR.

#### `_avaliarCondicao(condicao, dados)`
- Compatibilidade com formato de string legado: `"campo op valor"`.

#### `_avaliarCamposCondicionais(camposCondicionais[], dadosForm)`
- Retorna mapa `{[campoId]: {visivel, obrigatorio}}` para controle de visibilidade do formulário.
- **Exportada globalmente** para uso pelo `form-renderer.js`.

---

### 6.11 Motor de Templates de Texto

#### `_interpolarTemplate(tmpl, ctx)`
- Interpola strings `{{chave.subcampo}}` com valores do objeto `ctx`.
- Usada para títulos e mensagens de notificação com variáveis como `{{processo.titulo}}`, `{{etapa.nome}}`, `{{prazo}}`.

---

## 7. Lógica de Notificação e E-mail

### 7.1 Notificações internas

O módulo cliente não cria notificações diretamente (isso é feito pela Cloud Function). O cliente apenas:
- **Lê** via API `wfNotificacoes` (GET).
- **Marca como lida** via API `wfNotificacoes/{id}/marcar-lida` (POST).
- **Marca todas como lidas** via API `wfNotificacoes/marcar-todas-lidas` (POST).
- **Exibe preview** antes de concluir tarefa: GET `wfTarefas/{id}/preview-concluir` retorna `{tipo, etapa, destinatarios[], nome_grupo?, papel?}`.

### 7.2 E-mails via EmailJS

O sistema usa EmailJS (biblioteca client-side) com um template configurado em `ejsConfig.template_workflow`. A fila `wf_emails_pendentes` é gerenciada pela Cloud Function; o cliente EP pode visualizar e disparar o envio.

Template configurável em `config/ejs`: campo `template_workflow` (ID do template EmailJS para workflows).

O template recebe parâmetros padrão: `workflow`, `instrucoes`, `processo.titulo`, `etapa.nome`, `solicitante.nome`.

---

## 8. Lógica de SLA (Service Level Agreement)

### 8.1 Como é calculado

- O SLA de cada etapa é definido em `ConfigNo.sla_horas` (horas úteis, 0 = sem prazo).
- A Cloud Function calcula o campo `prazo` da tarefa ao criá-la, adicionando `sla_horas` horas úteis à data de criação.
- O campo `sla_vencido` é um booleano calculado pelo backend.

### 8.2 Exibição no cliente

A função `_slaInfo(tarefa)` renderiza um indicador visual:
- **Verde:** prazo mais de 2 horas à frente.
- **Amarelo ("Vencendo"):** prazo em menos de 2 horas.
- **Vermelho ("Vencido"):** prazo já passou.

A constante `WF_SLA_ALERTA_HORAS = 2` define o limiar de alerta.

---

## 9. Lógica de Formulários Dinâmicos

### 9.1 Fluxo de renderização

1. A tarefa tem `formulario_id` preenchido.
2. `_wfCarregarFormularioExecucaoTarefa` busca o schema em `wf_formulario_modelos/{id}`.
3. Chama `globalScope.wfRenderizarFormulario(schema, dadosIniciais)` — função fornecida pelo `form-renderer.js`.
4. O formulário é inserido em `#wf-exec-formulario`.
5. Listeners `input`/`change` chamam `_wfRenderAcoesExecucao` passando os dados parciais para recalcular botões de ação condicionais.

### 9.2 Coleta de dados

Ao concluir:
1. `globalScope.wfColetarDadosFormulario(formContainer, campos)` — retorna `{valido, dados, erros}`.
2. Se inválido: alerta com lista de erros + scroll até o campo.
3. Se válido: `dados` é incluído em `dados_formulario` no payload de conclusão.

### 9.3 Visibilidade condicional

`_avaliarCamposCondicionais(camposCondicionais, dadosForm)` retorna o estado de visibilidade e obrigatoriedade de cada campo. Esse mapa é passado pelo `form-renderer.js` a cada alteração nos campos.

---

## 10. Designer de Workflow (BPMN Visual)

### 10.1 Biblioteca

O designer usa **bpmn.js** (global `BpmnJS`). O módulo verifica a disponibilidade com `typeof BpmnJS === 'undefined'` e exibe mensagem de "editor não disponível offline" se ausente.

### 10.2 Inicialização

`_wfInitModeler(modelo)`:
1. Destrói instância anterior se existir.
2. Cria nova instância `new BpmnJS({ container: '#wf-bpmn-canvas' })`.
3. Registra listener `commandStack.changed` para marcar modelo como sujo.
4. Registra listener `selection.changed` para renderizar painel de config do elemento selecionado.
5. Importa o XML (`importXML`).

### 10.3 Sincronização canvas ↔ Firestore

`_wfSyncCanvas()` extrai dos elementos do bpmn.js:
- **Nós:** todos exceto `label`, `SequenceFlow`, `Process`, `Collaboration`, `Participant`.
- **Arestas:** todos os `SequenceFlow`.
- Para cada nó: mescla config de `_wfConfigNos[id]`.
- Para cada aresta: lê `condicoes`, `operador_logico` e `padrao` de `_wfConfigNos[id]`.

### 10.4 Painel de configuração por tipo de elemento

Ao selecionar um elemento, `_wfRenderConfigPanel(el)` despacha para:

| Tipo do elemento | Função do painel |
|-----------------|-----------------|
| `bpmn:StartEvent` | `_wfRenderPainelInicio` — tipo de disparo, recorrência, data padrão, descrição ao solicitante |
| `bpmn:EndEvent` | `_wfRenderPainelFim` — tipo de fim, mensagem ao solicitante, a quem notificar |
| `bpmn:ExclusiveGateway`, `bpmn:InclusiveGateway` | `_wfRenderPainelGatewayXor` — resumo das rotas com regras em linguagem natural |
| `bpmn:ParallelGateway` | `_wfRenderPainelGatewayAnd` — apenas rótulo e explicação |
| `bpmn:Task`, `bpmn:UserTask`, etc. | `_wfRenderPainelTarefa` — responsável, prazo, instrução, formulário, ações, regras condicionais, avançado |
| `bpmn:SequenceFlow` | `_wfRenderPainelAresta` — condições de roteamento, saída padrão, mapa de campos da origem |
| `bpmn:IntermediateCatch/ThrowEvent` | `_wfRenderPainelIntermediario` — tipo de evento, descrição |

### 10.5 Seleção de responsável por etapa

Valores possíveis para `papeis.executor`:

| Valor | Significado |
|-------|------------|
| `solicitante` | O próprio usuário que iniciou o processo |
| `gestor_solicitante` | Gestor do solicitante (selecionado no formulário de execução) |
| `gestor_executor` | Gestor do executor da etapa anterior |
| `ep` | Qualquer usuário com perfil EP |
| `gestor` | Qualquer usuário com perfil Gestor |
| `dono` | Qualquer usuário com perfil Dono |
| `grupo:<id>` | Qualquer membro do grupo (fila) |
| `grupo_chefe:<id>` | Apenas o chefe do grupo |
| `grupo_membro:<id>:<email>` | Membro específico do grupo |

---

## 11. Integração com `processos.html`

### 11.1 Globals que o módulo lê

| Global | Origem | Uso |
|--------|--------|-----|
| `usuarioLogado` | `processos.html` | UID, e-mail e perfil do usuário logado |
| `usuarioLogado.perfil` | `processos.html` | Verificação de perfil |
| `fb()` | `processos.html` / firebase-helpers.js | SDK Firebase: `db`, `auth`, `collection`, `doc`, `getDocs`, `getDoc`, `addDoc`, `updateDoc`, `deleteDoc`, `query`, `where`, `limit`, `startAfter`, `storage`, `storageRef`, `uploadBytes`, `getDownloadURL`, `deleteObject` |
| `USUARIOS` | `processos.html` | Lista de todos os usuários `[{uid, email, nome, perfil}]` |
| `CONFIG` | config.local.js | `CONFIG.WORKFLOW_API_BASE_URL` |
| `isEP()` | `processos.html` | Verificação de perfil EP |
| `isGestor()` | `processos.html` | Verificação de perfil Gestor |
| `isSolicitante()` | `processos.html` | Verificação de perfil solicitante |
| `esc(v)` | security-utils.js | Sanitização HTML |
| `safeUrl(url)` | security-utils.js | Sanitização de URL |
| `toast(msg, cor?)` | `processos.html` | Notificação toast opcional |
| `BpmnJS` | CDN externo | Classe do editor BPMN visual |
| `wfRenderizarFormulario` | `form-renderer.js` | Renderiza formulário dinâmico |
| `wfColetarDadosFormulario` | `form-renderer.js` | Coleta e valida dados do formulário |
| `wfWorkflowRenderer` | `workflow-renderer.js` | Renderizador plugável opcional |
| `BPMN_DEFAULT` | opcional | XML inicial customizado para o canvas |
| `WF_ACAO_LABELS` | `workflow-constants.js` | Rótulos das ações |
| `WF_PAPEL_LABELS` | `workflow-constants.js` | Rótulos dos papéis |
| `WF_PAPEL_ALVO_LABELS` | `workflow-constants.js` | Rótulos dos valores de papel-alvo |
| `WF_ACAO_COR` | `workflow-constants.js` | Cores das ações |
| `WF_STATUS_PROCESSO_MODELO_COR` | `workflow-constants.js` | Cores dos status de modelo |
| `WF_STATUS_INSTANCIA_COR` | `workflow-constants.js` | Cores dos status de instância |
| `WF_TIPO_ETAPA_ICONE` | `workflow-constants.js` | Ícones dos tipos de etapa |
| `PERFIL_LABELS` | `processos.html` | Rótulos dos perfis de usuário |
| `getPerfisUsuario(u)` | `processos.html` | Retorna lista de perfis de um usuário |

### 11.2 Globals que o módulo expõe

Todas as funções listadas no bloco `Object.assign(globalScope, {…})` ao final do arquivo, incluindo: `rWorkflow`, `wfNavWorkflow`, todas as funções de tarefas/instâncias/designer/formulários/equipes/notificações, e o objeto de estado interno `_st`.

Também expostas globalmente via `workflow-ui-contract.js`:
- `WF_UI_REQUIRED_IDS` — array com todos os IDs DOM obrigatórios.
- `wfValidateWorkflowUIContract(opts?)` — função de validação chamada por `rWorkflow()`.

Via `workflow-constants.js`: todas as constantes prefixadas com `WF_`.

### 11.3 Elementos DOM esperados

O módulo espera os seguintes IDs DOM (validados por `wfValidateWorkflowUIContract`):

```
wf-tab-tarefas          wf-painel-tarefas
wf-tab-instancias       wf-painel-instancias
wf-tab-solicitacoes     wf-painel-solicitacoes
wf-tab-modelagem        wf-painel-iniciar
wf-tab-formularios      wf-painel-modelagem
wf-tab-equipes          wf-painel-config-modelo
                        wf-painel-formularios
                        wf-painel-notificacoes
                        wf-painel-equipes
                        wf-painel-executar
                        wf-painel-historico
wf-lista-tarefas        wf-lista-instancias
wf-lista-solicitacoes   wf-lista-modelos
wf-lista-formularios    wf-lista-grupos
wf-lista-equipes-usuarios
wf-notif-lista
wf-modal-formulario     wf-modal-grupo
wf-modal-delegacao      wf-modal-inicio-form
wf-modal-simulacao
```

Além disso, elementos adicionais dentro de cada painel (não validados no contrato mas usados pelas funções):
- Painel executar: `wf-exec-titulo`, `wf-exec-obs`, `wf-exec-formulario`, `wf-exec-acoes`, `wf-exec-instrucoes`, `wf-exec-timeline`, `wf-exec-papel`, `wf-exec-anexos-lista`, `wf-exec-comentarios`, `wf-exec-dados-anteriores`, `wf-exec-orientacao-inicio`…
- Painel historico: `wf-hist-titulo`, `wf-hist-resumo`, `wf-hist-timeline`, `wf-hist-comentarios-por-etapa`, `wf-hist-btn-cancelar`, `wf-hist-btn-excluir`.
- Painel config-modelo: `wf-bpmn-canvas`, `wf-bpmn-loading`, `wf-bpmn-card`, `wf-bpmn-maximizar`, `wf-bpmn-dirty`, `wf-btn-salvar-modelo`, `wf-btn-publicar`, `wf-designer-nome`, `wf-designer-desc`, `wf-designer-config`, `wf-cloud-save-status`, `wf-config-titulo`, `wf-config-status-badge`, `wf-config-arq-info`.
- Painel tarefas: `wf-filtro-tarefa-status`, `wf-filtro-tarefa-texto`.
- Painel instancias: `wf-filtro-inst-status`, `wf-filtro-inst-texto`.
- Painel admin-tarefas: `wf-admin-tabela-body`, `wf-admin-contador`, `wf-admin-filtro-status`, `wf-admin-filtro-texto`.

### 11.4 Como `_invokeGlobalHandler` aciona o módulo

`processos.html` define a função:

```javascript
function _invokeGlobalHandler(handlerName) {
  // … mapeia módulos …
  workflow: globalThis.rWorkflow,
  // …
}
```

O botão de menu `#nb-workflow` chama `go('workflow', this)`, que internamente chama `_invokeGlobalHandler('rWorkflow')`, que por sua vez chama `globalThis.rWorkflow()`.

---

## 12. Integração com Cloud Functions (API REST)

O cliente não acessa o Firestore diretamente para operações de workflow críticas — usa a Cloud Function como proxy autenticado.

### 12.1 Helper de requisição `_wfApiRequest(functionName, path, options?)`

- **Autenticação:** Obtém token Firebase (`currentUser.getIdToken()`), envia como `Authorization: Bearer {token}`.
- **Base URL:** `CONFIG.WORKFLOW_API_BASE_URL` ou `https://us-central1-{projectId}.cloudfunctions.net`.
- **Método padrão:** GET. Corpo JSON quando `options.body` está presente.
- **Erros:** Lança `Error` com `payload.mensagem` ou `payload.erro`.

### 12.2 Endpoints utilizados pelo cliente

| Endpoint | Método | Propósito |
|----------|--------|-----------|
| `wfTarefas` | GET | Lista tarefas do usuário atual |
| `wfTarefas?admin=true&status={s}` | GET | Admin: lista todas as tarefas (EP only) |
| `wfTarefas/{id}` | GET | Detalhe de uma tarefa |
| `wfTarefas/{id}/iniciar` | POST | Marca tarefa como `em_execucao` |
| `wfTarefas/{id}/assumir` | POST | Atribui tarefa ao usuário atual |
| `wfTarefas/{id}/concluir` | POST | Conclui tarefa (`{acao, observacao, motivo_devolucao, dados_formulario, anexos, gestor_solicitante_uid}`) |
| `wfTarefas/{id}/preview-concluir` | POST | Preview de notificação antes de concluir |
| `wfTarefas/{id}/delegar` | POST | Delega tarefa (`{novo_responsavel_uid, motivo}`) |
| `wfTarefas/{id}/excluir` | POST | Exclui tarefa permanentemente |
| `wfTarefas/{id}/puxar` | POST | Admin: puxar tarefa de outro usuário |
| `wfTarefas/{id}/candidatos-delegacao` | GET | Lista candidatos para delegação |
| `wfInstancias` | GET | Lista instâncias visíveis ao usuário |
| `wfInstancias` | POST | Cria nova instância (`{processo_modelo_id?, processo_id?, titulo, snapshot_etapas?, agendado_para?}`) |
| `wfInstanciaItem/{id}` | GET | Detalhe de uma instância |
| `wfInstanciaItem/{id}/historico` | GET | Histórico de eventos da instância |
| `wfInstanciaItem/{id}/cancelar` | POST | Cancela instância (`{motivo}`) |
| `wfInstanciaItem/{id}/suspender` | POST | Suspende instância |
| `wfInstanciaItem/{id}/retomar` | POST | Retoma instância |
| `wfInstanciaItem/{id}/excluir` | POST | Soft delete da instância |
| `wfNotificacoes` | GET | Lista notificações do usuário |
| `wfNotificacoes/{id}/marcar-lida` | POST | Marca notificação como lida |
| `wfNotificacoes/marcar-todas-lidas` | POST | Marca todas como lidas |
| `wfComentarios` | GET (com `?tarefa_id=` ou `?instancia_id=`) | Lista comentários |
| `wfComentarios` | POST | Cria comentário |
| `wfAdminJobs/ativar/{id}/preview` | POST | Preview de ativação de instância agendada |
| `wfAdminJobs/ativar/{id}` | POST | Ativa instância agendada manualmente |

---

## 13. Cache Local para Desenvolvimento

Quando `_wfDevLocalAtivo()` retorna `true` (hostname localhost + query `?dev_nologin=1`):
- Leituras e escritas em coleções `wf_*` são interceptadas.
- Dados são armazenados em `localStorage` com chave `siga_wf_local_{coleção}`.
- Erros de permissão do Firestore são silenciados e os dados locais são usados como fallback.
- IDs são gerados localmente usando `crypto.randomUUID()` ou `crypto.getRandomValues()` com fallback para `Date.now()`.

---

## 14. Renderizador Plugável (`wfWorkflowRenderer`)

O módulo verifica `globalScope.wfWorkflowRenderer` antes de renderizar cards de tarefas e instâncias. Se presente, delega para:
- `renderer.renderTarefasCards(tarefas, opções)` — retorna HTML string.
- `renderer.renderInstanciasCards(instancias, opções)` — retorna HTML string.
- `renderer.renderNotificacoes(notifs, esc)` — retorna HTML string.

Isso permite que `workflow-renderer.js` forneça renderização customizada sem modificar o engine.

---

## 15. Validação de Contrato de UI (`workflow-ui-contract.js`)

A função `wfValidateWorkflowUIContract(options?)`:
- Verifica se todos os 35 IDs em `WF_UI_REQUIRED_IDS` existem no DOM.
- Em modo `strict: true`: lança `Error` com lista de IDs faltantes.
- Em modo padrão: emite `console.warn` e retorna `{ok: false, missing: [...]}`.
- Chamada por `rWorkflow()` em modo não-estrito.

---

## 16. Segurança

### 16.1 Sanitização

- Toda saída HTML usa `_esc(v)` (wrapper de `globalScope.esc` do `security-utils.js`).
- URLs de anexos passam por `_safeUrl(url)` que aceita apenas `https://`.
- Payloads enviados à API são objetos JavaScript (JSON.stringify pelo helper).

### 16.2 Defesa em profundidade

- Regras do Firestore restringem acesso direto ao banco por perfil.
- A Cloud Function valida autenticação (token Bearer) antes de qualquer operação.
- Histórico é imutável (create-only no Firestore).
- Notificações só podem ter o campo `lida` atualizado pelo próprio destinatário.

---

## 17. Estado Interno do Módulo (`_st`)

O objeto `_st` é o estado interno da IIFE, **exposto globalmente** como `globalScope._st` para depuração:

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `painelAtual` | string | Nome do painel atualmente exibido |
| `instanciaAtual` | object \| null | `{id, titulo, status}` da instância em foco |
| `tarefaAtual` | object \| null | Tarefa aberta no painel executar |
| `formularioAtual` | object \| null | Schema do formulário em edição |
| `formularioCampos` | array | Cópia dos campos do formulário em edição |
| `formularioModelos` | array | Cache de todos os `wf_formulario_modelos` |
| `formularioOrigem` | string \| null | Contexto de origem do modal de formulário |
| `grupos` | array | Cache de `wf_grupos` para uso no designer |
| `meusGrupos` | array \| null | Cache dos grupos do usuário atual |
| `tarefasCursor` | number | Cursor de paginação de tarefas |
| `instanciasCursor` | number | Cursor de paginação de instâncias |
| `tarefasLista` | array \| null | Cache da lista de tarefas |
| `instanciasLista` | array \| null | Cache da lista de instâncias |
| `_notifCount` | number | Contagem de notificações não lidas |
| `_respondendoA` | string \| null | ID do comentário sendo respondido |
| `_delegacaoTarefaId` | string \| null | ID da tarefa em processo de delegação |
| `_grupoEditandoId` | string \| null | ID do grupo em edição |
| `_anexosTarefa` | array | Anexos da tarefa atual |
| `_usuariosSelecao` | array \| null | Cache de usuários para select de gestor |
| `_usersComUid` | array \| null | Cache de usuários com UID (coleção `usuarios`) |
| `iniciarAba` | string | Aba ativa no painel iniciar (`mapeamento` ou `templates`) |

---

## 18. Guia de Reimplementação

Para reimplementar este módulo em outra stack (ex.: PostgreSQL + Node.js REST API + React):

### 18.1 Banco de dados

Criar as seguintes tabelas (equivalentes às coleções Firestore):

```sql
wf_processo_modelos (id, nome, descricao, status, versao, processo_origem_id, fluxo_origem, bpmn_xml, canvas JSONB, config_nos JSONB, criado_por, criado_em, atualizado_em)
wf_instancia_processos (id, titulo, status, processo_modelo_id, processo_id, processo_nome, solicitante_uid, etapa_atual_id, etapa_atual_nome, responsavel_atual_nome, snapshot_etapas JSONB, canvas JSONB, config_nos JSONB, dados_consolidados JSONB, fluxo_origem, agendado_para TIMESTAMPTZ, excluida BOOLEAN, criado_em, atualizado_em)
wf_tarefa_workflows (id, instancia_id FK, processo_nome, etapa_modelo_id, etapa_nome, etapa_desc, status, responsavel_uid, papel_alvo, papel_responsavel, grupo_id FK, formulario_id FK, dados_formulario JSONB, acoes_disponiveis TEXT[], exige_parecer BOOLEAN, instrucoes TEXT, motivo_devolucao TEXT, prazo TIMESTAMPTZ, sla_vencido BOOLEAN, anexos JSONB, criado_em, atualizado_em)
wf_historico_workflows (id, instancia_id FK, tipo_evento, usuario_uid, etapa_id, tarefa_id FK, descricao TEXT, dados JSONB, criado_em) -- imutável
wf_comentarios (id, tarefa_id FK, instancia_id FK, etapa_id, etapa_nome, autor_uid, texto TEXT, respondendo_a FK SELF, criado_em, atualizado_em)
wf_formulario_modelos (id, titulo, campos JSONB, versao, criado_em, atualizado_em)
wf_grupos (id, nome, descricao, membros_email TEXT[], chefe_email, criado_em, atualizado_em)
wf_notificacoes (id, destinatario_uid, titulo, mensagem, lida BOOLEAN, instancia_id FK, tarefa_id FK, tipo, criado_em)
wf_emails_pendentes (id, destinatario_email, template_id, params JSONB, enviado BOOLEAN, tentativas INT, enviado_em TIMESTAMPTZ, erro TEXT, criado_em, atualizado_em)
```

### 18.2 Motor de regras

O motor de navegação de canvas (`_proximoNoExecutavel`, `_avaliarCondicaoObj`) deve ser reimplementado no servidor (não apenas no cliente) para garantir segurança nas transições. O algoritmo é BFS simples sobre o grafo do canvas.

### 18.3 Endpoints da API

Implementar todos os endpoints listados na seção 12.2. Cada endpoint deve:
1. Validar o token JWT do Firebase (ou equivalente).
2. Verificar permissões do usuário.
3. Executar a operação no banco.
4. Registrar evento no histórico.
5. Criar notificações para os próximos responsáveis.
6. Enfileirar e-mails se configurado.

### 18.4 Frontend

O frontend precisa:
- Implementar os 35 IDs DOM obrigatórios listados em `WF_UI_REQUIRED_IDS`.
- Integrar um editor BPMN (ex.: bpmn.js) para o designer visual.
- Implementar `wfRenderizarFormulario` e `wfColetarDadosFormulario` para formulários dinâmicos.
- Suportar os 12 painéis descritos na seção 5.

---

*Documento gerado em 2026-06-16 a partir da leitura completa dos arquivos fonte do módulo.*
