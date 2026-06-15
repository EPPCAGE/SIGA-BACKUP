const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const crypto = require("node:crypto");

admin.initializeApp();

// Publica os endpoints REST do módulo workflow sem sobrescrever exports legados.
Object.entries(require('./workflow/index')).forEach(([name, fn]) => {
  if (!Object.prototype.hasOwnProperty.call(exports, name)) {
    exports[name] = fn;
  }
});

// ---------------------------------------------------------------------------
// Rate limiting — Firestore-backed sliding window counter.
// key:      document ID under rate_limits/ (must be Firestore-safe)
// maxCalls: maximum number of calls allowed within the window
// windowMs: window duration in milliseconds
// Returns true (allowed) or false (limit exceeded).
// Fails-open on Firestore errors to avoid blocking legitimate requests.
// ---------------------------------------------------------------------------
async function checkRateLimit(key, maxCalls, windowMs) {
  const db = admin.firestore();
  const ref = db.doc(`rate_limits/${key}`);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || now > snap.data().reset_at) {
        tx.set(ref, { count: 1, reset_at: now + windowMs });
        return true;
      }
      const { count } = snap.data();
      if (count >= maxCalls) return false;
      tx.update(ref, { count: count + 1 });
      return true;
    });
  } catch (e) {
    console.error("checkRateLimit error:", e);
    return true;
  }
}

function getClientIpHash(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip = forwarded ? forwarded.split(",")[0].trim() : (req.ip || "unknown");
  return crypto.createHash("sha256").update(ip).digest("hex").substring(0, 16);
}

const ALLOWED_ORIGINS = new Set([
  "https://eppcage.com.br",
  "https://www.eppcage.com.br",
  "https://eppcage.github.io",
  "https://sigaepp.web.app",
  "https://sigaepp.firebaseapp.com",
]);

const AZURE_KEY      = defineSecret("AZURE_OPENAI_KEY");
const AZURE_ENDPOINT = defineSecret("AZURE_OPENAI_ENDPOINT");
const AZURE_DEPLOY   = defineSecret("AZURE_OPENAI_DEPLOYMENT");

const MAX_PAYLOAD_BYTES = 20 * 1024; // 20 KB

function setCorsHeaders(req, res) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Vary", "Origin");
}

async function verifyToken(req, res) {
  // Aceitar token do body (_token) ou do header Authorization
  let idToken = req.body?._token;
  
  // Se não veio no body, tentar pegar do header Authorization
  if (!idToken) {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      idToken = authHeader.substring(7); // Remove "Bearer "
    }
  }
  
  if (!idToken) {
    res.status(401).json({ error: "Autenticação necessária" });
    return null;
  }
  
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).json({ error: "Token inválido ou expirado" });
    return null;
  }
}

// ---------------------------------------------------------------------------
// checkEmail — verifica se um e-mail está cadastrado em config/usuarios.
// Endpoint público (sem auth): elimina a necessidade de leitura pública do
// Firestore para o fluxo de Primeiro Acesso.
// Retorna apenas {exists: boolean} — nunca expõe o documento completo.
// ---------------------------------------------------------------------------
exports.checkEmail = onRequest(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  // Throttle: 10 calls per 15 minutes per IP to prevent user enumeration
  const ipAllowed = await checkRateLimit(`email_${getClientIpHash(req)}`, 10, 15 * 60 * 1000);
  if (!ipAllowed) {
    res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
    return;
  }

  const email = req.body?.email;
  if (!email || typeof email !== "string" || email.length > 254) {
    res.status(400).json({ error: "Campo obrigatório: email" });
    return;
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const doc = await admin.firestore().doc("config/usuarios").get();
    if (!doc.exists) { res.status(200).json({ exists: false }); return; }
    const rawData = doc.data()?.data;
    const usuarios = typeof rawData === "string" ? JSON.parse(rawData) : [];
    const exists = Array.isArray(usuarios) && usuarios.some(u => u?.email === normalizedEmail);
    res.status(200).json({ exists });
  } catch (e) {
    console.error("checkEmail error:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// setUserClaims — atribui Custom Claim {perfil} ao token do usuário autenticado.
// Deve ser chamado logo após o login. O cliente precisa renovar o ID Token
// (getIdToken(true)) após a resposta para que as regras do Firestore recebam
// o claim atualizado.
// ---------------------------------------------------------------------------
exports.setUserClaims = onRequest(async (req, res) => {
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const decoded = await verifyToken(req, res);
  if (!decoded) return;

  try {
    const doc = await admin.firestore().doc("config/usuarios").get();
    const rawData = doc.exists ? doc.data()?.data : null;
    const usuarios = typeof rawData === "string" ? JSON.parse(rawData) : [];
    const user = Array.isArray(usuarios)
      ? usuarios.find(u => u?.email === decoded.email)
      : null;

    const perfil = user?.perfil || "dono";
    await admin.auth().setCustomUserClaims(decoded.uid, { perfil });
    res.status(200).json({ ok: true, perfil });
  } catch (e) {
    console.error("setUserClaims error:", e);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ---------------------------------------------------------------------------
// ai — proxy autenticado para Azure OpenAI.
// ---------------------------------------------------------------------------
exports.ai = onRequest(
  { secrets: [AZURE_KEY, AZURE_ENDPOINT, AZURE_DEPLOY] },
  async (req, res) => {
    setCorsHeaders(req, res);

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

    const decoded = await verifyToken(req, res);
    if (!decoded) return;

    // Rate limit: 30 calls per hour per authenticated user
    const aiAllowed = await checkRateLimit(`ai_${decoded.uid}`, 30, 60 * 60 * 1000);
    if (!aiAllowed) {
      res.status(429).json({ error: "Limite de requisições atingido. Tente novamente em 1 hora." });
      return;
    }

    // Validate payload size
    if (JSON.stringify(req.body).length > MAX_PAYLOAD_BYTES) {
      res.status(413).json({ error: "Payload muito grande" });
      return;
    }

    const { mode, payload } = req.body || {};
    if (!mode || !payload) {
      res.status(400).json({ error: "Campos obrigatórios: mode, payload" });
      return;
    }

    const SYSTEM = {
      analisar_bpmn: `Você é um especialista em BPM (Business Process Management) e análise de processos.\nAnalise o processo fornecido e retorne um JSON com:\n{\n  "gargalos": ["..."],\n  "retrabalhos": ["..."],\n  "gaps": ["..."],\n  "oportunidades": ["..."],\n  "complexidade": "Baixa|Media|Alta|Muito alta",\n  "resumo": "..."\n}\n\nINSTRUÇÕES PARA O CAMPO "resumo":\n- Escreva 2 a 3 frases em tom construtivo, encorajador e diplomático.\n- Comece reconhecendo o propósito ou o valor do processo para a organização.\n- Aponte 1 ou 2 oportunidades de melhoria, sempre enquadrando como potencial a explorar — nunca como falha ou problema grave.\n- Evite palavras negativas diretas como "falha", "ruim", "precário", "sério problema" ou "grave". Prefira "oportunidade", "ponto de atenção", "pode ser aprimorado", "há espaço para evoluir".\n- O dono do processo deve terminar de ler o resumo sentindo que seu trabalho é valorizado e que há caminhos claros de melhoria.\n\nResponda APENAS com o JSON, sem markdown, sem texto adicional.`,

      gerar_pop: `Você é especialista em redação de Procedimentos Operacionais Padrão (POP) no padrão da administração pública brasileira.\nCom base nas etapas do processo fornecidas, gere um texto estruturado para o POP com as seções:\n1.0 Objetivo, 1.1 Definições, 1.2 Entradas, 1.3 Saídas, 2.0 Atividades (por responsável), 3.0 Documentos correlatos.\nSe o payload incluir "gargalos_confirmados", "oportunidades_confirmadas" ou "solucoes_confirmadas", incorpore essas informações de forma natural no texto do POP: mencione os gargalos como pontos de atenção nas atividades relevantes, inclua as soluções e oportunidades como orientações ou boas práticas dentro das seções pertinentes. Não crie seções separadas para esses itens — integre-os ao corpo do POP.\nSeja objetivo, use linguagem formal e imperativa. Retorne como texto simples sem markdown.`,

      assistente: `Você é um assistente especializado em gestão de processos do Escritório de Processos da CAGE/Sefaz-RS.\nResponda de forma clara, objetiva e em português brasileiro. Contexto do sistema: EP·CAGE é um sistema de mapeamento e gestão de processos institucionais seguindo metodologia BPM.\nLimite suas respostas a 300 palavras.`,

      analisar_indicadores: `Você é especialista em análise de desempenho e indicadores de processos da administração pública.\nO payload pode conter um campo "nota_sisplan" com instruções sobre a convenção de preenchimento, e um array "indicadores".\nANTES de analisar, descarte COMPLETAMENTE os seguintes tipos de indicadores — não os mencione de forma alguma, nem positiva nem negativamente:\n1. Indicadores com "aguardando_fechamento": true (estão nos 2 primeiros meses de um trimestre; o SISPLAN só registra resultados no último mês do trimestre).\n2. Indicadores cujo campo "realizado" é null, undefined, vazio ou igual a zero E que não possuem nenhum dado histórico preenchido — esses indicadores ainda não foram alimentados e não devem ser interpretados como desempenho ruim.\nAnalise APENAS os indicadores que possuem dados válidos. Com base neles, gere um comentário analítico conciso (máximo 150 palavras) destacando:\n- Indicadores que merecem atenção (abaixo da meta)\n- Tendências positivas\n- Recomendação principal\nSe não houver nenhum indicador com dados válidos, retorne apenas: "Nenhum indicador com dados disponíveis para análise neste período."\nRetorne APENAS o texto do comentário, sem título, sem markdown.`,

      gerar_ppt: `Você é especialista em gestão de processos e criação de apresentações executivas.\nCom base nas informações do processo fornecidas, gere um JSON com o conteúdo para uma apresentação PowerPoint executiva sobre o mapeamento deste processo. Seja direto, profissional e conciso.\nRetorne APENAS o JSON válido, sem markdown, sem texto adicional.`,

      extrair_pop: `Você é especialista em análise de documentos de gestão pública.\nAnalise o POP (Procedimento Operacional Padrão) fornecido e extraia as informações no formato JSON exato, sem markdown:\n{"nome":"nome do processo","area":"área responsável","objetivo":"objetivo em uma frase","atores":["ator1","ator2"],"etapas":[{"nome":"nome da etapa","tipo":"Atividade|Decisao|Evento","executor":"ator responsável pela etapa"}]}\nClassifique cada etapa:\n- "Atividade": tarefas, execuções, verificações, comunicações, registros (a maioria)\n- "Decisao": gateways, bifurcações, condicionais (ex: "Caso sim/não", "O processo está no escopo?")\n- "Evento": início e fim do processo\nO executor de cada etapa é o ator explicitamente responsável por ela no documento. Se não identificado, use "".\nInclua TODOS os elementos do fluxo, inclusive gateways e eventos de fim.\nRetorne APENAS o JSON válido, sem texto adicional.`,

      relatorio_auditoria: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base nos dados da análise de aderência fornecidos, elabore um Relatório Executivo de Análise de Aderência completo e profissional.\nUse sempre os termos "análise de aderência", "processo analisado", "equipe de análise" e "trabalho de análise" — nunca use "auditoria", "auditado" ou "auditor".\nRetorne APENAS um JSON válido (sem markdown, sem bloco de código) com a estrutura:\n{\n  "sumario": "Sumário executivo em 2-3 parágrafos descrevendo o processo analisado, o período e os principais resultados",\n  "conformidade_justificativa": "Justificativa objetiva para a conformidade geral atribuída",\n  "achados_resumo": ["achado resumido 1", "achado resumido 2"],\n  "recomendacoes": ["recomendação 1", "recomendação 2", "recomendação 3"],\n  "conclusao": "Parágrafo de conclusão com avaliação final e próximos passos"\n}`,

      gerar_questoes: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base no objetivo, escopo, critérios da análise de aderência e no conteúdo do processo mapeado fornecidos, gere uma lista de questões de análise relevantes e objetivas.\nUse sempre os termos "análise de aderência", "processo analisado" e "equipe de análise" — nunca use "auditoria", "auditado" ou "auditor".\nCada questão deve ser verificável, diretamente ligada a um critério e adequada ao contexto do processo.\nRetorne APENAS um JSON válido (sem markdown, sem bloco de código) com a estrutura:\n[\n  {"questao": "texto da questão", "criterio": "critério relacionado"},\n  ...\n]\nGere entre 8 e 15 questões cobrindo conformidade, desempenho, controles internos e evidências documentais.`,

      sugerir_achados: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base nas questões de análise e suas respectivas respostas fornecidas, identifique potenciais achados que possam ser confirmados pelo analista.\nUse sempre os termos "análise de aderência" e "processo analisado" — nunca use "auditoria" ou "auditado".\nGere achados APENAS para respostas que indiquem problema, lacuna ou oportunidade de melhoria. Se todas indicarem conformidade plena, retorne no máximo um achado do tipo Conformidade.\nRetorne APENAS um JSON válido (sem markdown) com a estrutura:\n[\n  {\n    "titulo": "título objetivo e direto do achado",\n    "tipo": "Não conformidade|Observação|Ponto de melhoria|Conformidade",\n    "descricao": "descrição da situação encontrada e possível causa (2-3 frases)",\n    "evidencia": "tipo de evidência documental ou observacional que sustenta o achado",\n    "criterio": "critério, norma ou boa prática relacionada, com recomendação de melhoria"\n  }\n]\nGere entre 1 e 6 achados. Seja preciso e objetivo — cada achado deve ser diretamente rastreável a uma ou mais respostas fornecidas.`,

      descrever_achado: `Você é especialista em análise de aderência de processos da administração pública brasileira.\nCom base no título e tipo do achado fornecidos, gere uma descrição técnica completa e profissional do apontamento.\nUse sempre os termos "análise de aderência" e "processo analisado" — nunca use "auditoria" ou "auditado".\nRetorne APENAS um JSON válido (sem markdown) com a estrutura:\n{\n  "descricao": "descrição detalhada da situação encontrada e possível causa (2-3 frases técnicas e objetivas)",\n  "evidencia": "sugestão de evidência documental ou observacional que poderia sustentar este achado",\n  "criterio": "critério, norma, regulamento ou boa prática relacionada, seguido de recomendação de melhoria"\n}`,

      gerar_faq: `Você é especialista em gestão de processos e comunicação institucional da administração pública brasileira.\nCom base nas informações do processo fornecidas, gere entre 5 e 8 perguntas frequentes (FAQ) com suas respectivas respostas.\nAs perguntas devem refletir dúvidas reais de cidadãos ou servidores sobre o processo.\nFormato de saída: apenas o texto puro, sem markdown, sem numeração extra, no padrão:\nP: [pergunta]\nR: [resposta objetiva em até 3 frases]\n\nRepita o bloco P/R para cada item.`,
    };

    const systemPrompt = SYSTEM[mode];
    if (!systemPrompt) {
      res.status(400).json({ error: `Mode inválido: ${mode}` });
      return;
    }

    const userMessage = typeof payload === "string" ? payload : JSON.stringify(payload);

    try {
      const endpoint = AZURE_ENDPOINT.value();
      const deploy   = AZURE_DEPLOY.value();
      const apiKey   = AZURE_KEY.value();

      const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploy}/chat/completions?api-version=2024-12-01-preview`;

      const fetch = (await import("node-fetch")).default;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user",   content: userMessage  },
            ],
            max_completion_tokens: mode === 'extrair_pop' ? 4000 : 1500,
            ...( ["extrair_pop","analisar_bpmn","gerar_ppt","gerar_questoes","sugerir_achados","descrever_achado","relatorio_auditoria"].includes(mode)
              ? { response_format: { type: "json_object" } }
              : {} ),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!resp.ok) {
        const err = await resp.text();
        console.error("Azure error:", err);
        res.status(502).json({ error: "Erro na API Azure OpenAI" });
        return;
      }

      const data = await resp.json();
      const text = data.choices?.[0]?.message?.content || "";
      res.status(200).json({ result: text });

    } catch (e) {
      console.error("Function error:", e);
      res.status(500).json({ error: "Erro interno ao processar a requisição." });
    }
  }
);

// ---------------------------------------------------------------------------
// migrateAllUserClaims — Migra perfis de TODOS os usuários para Custom Claims.
// Esta função deve ser executada UMA VEZ após o primeiro deploy da Fase 1.
// Requer autenticação e perfil EP.
// ---------------------------------------------------------------------------
exports.migrateAllUserClaims = onCall(async (request) => {
  // Verificar autenticação (onCall faz automaticamente)
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado');
  }

  try {
    const db = admin.firestore();
    const doc = await db.doc("config/usuarios").get();
    const rawData = doc.exists ? doc.data()?.data : null;
    const usuarios = typeof rawData === "string" ? JSON.parse(rawData) : [];
    
    // Verificar se quem está chamando é EP
    const caller = Array.isArray(usuarios)
      ? usuarios.find(u => u?.email === request.auth.token.email)
      : null;

    if (caller?.perfil !== 'ep') {
      throw new HttpsError(
        'permission-denied',
        'Apenas usuários EP podem executar migração'
      );
    }

    // Processar todos os usuários
    const resultados = {
      total: usuarios.length,
      sucesso: 0,
      erros: 0,
      detalhes: []
    };

    for (const usuario of usuarios) {
      try {
        const { perfil, email } = usuario;
        
        if (!email) {
          resultados.erros++;
          resultados.detalhes.push({
            nome: usuario.nome || 'N/A',
            erro: 'E-mail ausente'
          });
          continue;
        }

        if (!perfil) {
          resultados.erros++;
          resultados.detalhes.push({
            email: email,
            erro: 'Perfil ausente'
          });
          continue;
        }

        // Buscar UID do Firebase Auth pelo e-mail
        let uid;
        try {
          const userRecord = await admin.auth().getUserByEmail(email);
          uid = userRecord.uid;
        } catch (authError) {
          resultados.erros++;
          resultados.detalhes.push({
            email: email,
            erro: `Usuário não encontrado no Firebase Auth: ${authError.message}`
          });
          continue;
        }

        // Setar Custom Claim
        await admin.auth().setCustomUserClaims(uid, { perfil });
        resultados.sucesso++;
        
        console.log(`Claim migrado: uid=${uid}, email=${email}, perfil=${perfil}`);
        
      } catch (error) {
        resultados.erros++;
        resultados.detalhes.push({
          email: usuario.email || 'N/A',
          erro: error.message
        });
        console.error(`Erro ao migrar usuário ${usuario.email}:`, error);
      }
    }

    console.log('Migração concluída:', resultados);

    // onCall retorna diretamente o objeto (não precisa de res.json)
    return {
      ok: true,
      resultados
    };

  } catch (error) {
    console.error('Erro na migração de claims:', error);
    throw new HttpsError(
      'internal',
      `Erro interno durante migração: ${error.message}`
    );
  }
});

// ---------------------------------------------------------------------------
// P1.2 — Engine server-side de workflow
// Valida permissões, executa transição de etapa e registra histórico.
// O cliente chama esta função em vez de gravar diretamente no Firestore.
// ---------------------------------------------------------------------------
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const ACOES_RETORNO = new Set(['rejeitar', 'devolver']);
const ACOES_POR_PAPEL = {
  executor: ['avancar', 'concluir', 'devolver', 'solicitar_ajuste'],
  revisor: ['avancar', 'concluir'],
  aprovador: ['aprovar', 'rejeitar', 'devolver'],
};

function _proximoNoServer(canvas, noId, acao, dados = {}) {
  const arestas = canvas.arestas || [];
  const nos = canvas.nos || [];
  const candidatas = arestas.filter(a => a.origem === noId && (!a.acao || a.acao === acao));
  const aresta = candidatas.find(a => _avaliarCondicaoServer(a.condicao, dados))
    || (acao ? arestas.find(a => a.origem === noId) : null);
  if (!aresta) return null;
  const destino = nos.find(n => n.id === aresta.destino);
  if (!destino) return null;
  if (destino.tipo === 'inicio') return _proximoNoServer(canvas, destino.id, null, dados);
  return destino;
}

function _avaliarCondicaoServer(condicao, dados) {
  if (!condicao?.trim()) return true;
  try {
    // Regex linear: sem backtracking — trimEnd separa o valor em seguida
    const m = condicao.trim().match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(\S.*)/);
    if (!m) return true;
    const [, campo, op, valorRaw] = m;
    const valorStr = valorRaw.trimEnd().replace(/^['"]|['"]$/g, '');
    const valDados = dados[campo];
    const valorNumero = Number(valorStr);
    const valComp = Number.isNaN(valorNumero) ? valorStr : valorNumero;
    switch (op) {
      case '==': return String(valDados) === String(valComp);
      case '!=': return String(valDados) !== String(valComp);
      case '>':  return Number(valDados) > Number(valComp);
      case '<':  return Number(valDados) < Number(valComp);
      case '>=': return Number(valDados) >= Number(valComp);
      case '<=': return Number(valDados) <= Number(valComp);
      default: return true;
    }
  } catch { return true; }
}

async function _resolverPapelServer(valor, instancia) {
  if (!valor) return null;
  if (valor === 'solicitante') return instancia.solicitante_uid || null;
  if (['ep','gestor','dono','gerente_projeto'].includes(valor)) return null; // assumível por perfil
  return valor; // UID direto
}

async function _criarTarefaServer(batch, tarefaRef, instancia, etapa) {
  const prazo = etapa.sla_horas > 0
    ? new Date(Date.now() + etapa.sla_horas * 3600000)
    : null;
  const uid = instancia.solicitante_uid;
  batch.set(tarefaRef, {
    instancia_id: instancia.id,
    processo_nome: instancia.titulo,
    processo_id: instancia.processo_id || null,
    etapa_modelo_id: etapa.id,
    etapa_nome: etapa.nome,
    etapa_desc: etapa.desc || null,
    etapa_tipo: etapa.tipo || 'Atividade',
    responsavel_uid: uid,
    papel_responsavel: 'executor',
    papel_alvo: 'solicitante',
    acoes_disponiveis: etapa.tipo === 'Aprovação' ? ['aprovar','rejeitar'] : ['avancar'],
    acao_tomada: null, parecer: null,
    exige_parecer: false,
    formulario_id: etapa.formulario_id || null,
    status: 'pendente',
    prazo,
    dados_formulario: {},
    observacao: null,
    _criado_em: FieldValue.serverTimestamp(),
  });
}

async function _carregarTarefaServer(tarefaId) {
  const tarefaSnap = await db.collection('wf_tarefa_workflows').doc(tarefaId).get();
  if (!tarefaSnap.exists) throw new HttpsError('not-found', 'Tarefa não encontrada.');
  return { id: tarefaSnap.id, ...tarefaSnap.data() };
}

async function _carregarInstanciaServer(instanciaId) {
  const instSnap = await db.collection('wf_instancia_processos').doc(instanciaId).get();
  if (!instSnap.exists) throw new HttpsError('not-found', 'Instância não encontrada.');
  return { id: instSnap.id, ...instSnap.data() };
}

async function _carregarPermissoesConclusaoServer(uid) {
  const userRecord = await admin.auth().getUser(uid);
  const perfil = userRecord.customClaims?.perfil || '';
  return {
    isEP: perfil === 'ep',
    isGestor: perfil === 'gestor',
  };
}

function _validarEstadoTarefaConclusaoServer(tarefa) {
  if (tarefa.status !== 'pendente' && tarefa.status !== 'em_execucao') {
    throw new HttpsError('failed-precondition', 'Tarefa já foi concluída.');
  }
}

function _validarPermissaoConclusaoServer(uid, tarefa, acao, observacao, permissoes) {
  const isResponsavel = tarefa.responsavel_uid === uid || tarefa.responsavel_uid == null;
  if (!permissoes.isEP && !permissoes.isGestor && !isResponsavel) {
    throw new HttpsError('permission-denied', 'Sem permissão para concluir esta tarefa.');
  }

  const papel = tarefa.papel_responsavel || 'executor';
  const acoesPermitidas = ACOES_POR_PAPEL[papel] || ACOES_POR_PAPEL.executor;
  if (!permissoes.isEP && !permissoes.isGestor && !acoesPermitidas.includes(acao)) {
    throw new HttpsError('permission-denied', `Papel "${papel}" não pode executar a ação "${acao}".`);
  }

  const exigeParecer = tarefa.exige_parecer || acao === 'rejeitar' || acao === 'devolver';
  if (exigeParecer && !observacao) {
    throw new HttpsError('invalid-argument', 'Parecer obrigatório para esta ação.');
  }
}

function _atualizarTarefaConcluidaBatch(batch, tarefaId, observacao, acao, dadosFormulario, anexos, now) {
  batch.update(db.collection('wf_tarefa_workflows').doc(tarefaId), {
    status: 'concluida',
    observacao: observacao || null,
    parecer: observacao || null,
    acao_tomada: acao,
    dados_formulario: dadosFormulario || {},
    anexos: anexos || [],
    concluido_em: now,
    _atualizado_em: now,
  });
}

function _atualizarDadosInstanciaBatch(batch, instancia, dadosMerged, now) {
  batch.update(db.collection('wf_instancia_processos').doc(instancia.id), {
    dados_consolidados: dadosMerged,
    _atualizado_em: now,
  });
}

function _atualizarInstanciaCanvasBatch(batch, instanciaId, patch, now) {
  batch.update(db.collection('wf_instancia_processos').doc(instanciaId), {
    ...patch,
    _atualizado_em: now,
  });
}

function _criarTarefaRetornoCanvasBatch(batch, instancia, noAnterior, now) {
  const novaRef = db.collection('wf_tarefa_workflows').doc();
  const cfg = noAnterior.config || {};
  const prazoDev = cfg.sla_horas > 0 ? new Date(Date.now() + cfg.sla_horas * 3600000) : null;
  batch.set(novaRef, {
    instancia_id: instancia.id, processo_nome: instancia.titulo,
    processo_id: instancia.processo_id || null,
    etapa_modelo_id: noAnterior.id, etapa_nome: noAnterior.nome,
    etapa_desc: cfg.instrucoes || null, etapa_tipo: noAnterior.tipo,
    responsavel_uid: instancia.solicitante_uid, papel_responsavel: 'executor',
    papel_alvo: 'solicitante', acoes_disponiveis: ['avancar'],
    acao_tomada: null, parecer: null, exige_parecer: false,
    formulario_id: cfg.formulario_id || null,
    status: 'pendente', prazo: prazoDev,
    dados_formulario: {}, observacao: null, _criado_em: now,
  });
}

async function _criarTarefaProximoNoCanvasBatch(batch, instancia, prox, now) {
  const cfg = prox.config || {};
  const prazoProx = cfg.sla_horas > 0 ? new Date(Date.now() + cfg.sla_horas * 3600000) : null;
  const novaRef = db.collection('wf_tarefa_workflows').doc();
  const papelAlvo = cfg.papeis?.executor || 'solicitante';
  const uidResp = await _resolverPapelServer(papelAlvo, instancia);
  batch.set(novaRef, {
    instancia_id: instancia.id, processo_nome: instancia.titulo,
    processo_id: instancia.processo_id || null,
    etapa_modelo_id: prox.id, etapa_nome: prox.nome,
    etapa_desc: cfg.instrucoes || null, etapa_tipo: prox.tipo,
    responsavel_uid: uidResp, papel_responsavel: 'executor',
    papel_alvo: papelAlvo,
    acoes_disponiveis: prox.tipo === 'Aprovação' ? ['aprovar','rejeitar'] : ['avancar'],
    acao_tomada: null, parecer: null, exige_parecer: !!cfg.exige_parecer,
    formulario_id: cfg.formulario_id || null,
    status: 'pendente', prazo: prazoProx,
    dados_formulario: {}, observacao: null, _criado_em: now,
  });
}

async function _processarFluxoCanvasConclusao(batch, instancia, tarefa, acao, dadosMerged, now) {
  const canvas = instancia.canvas;
  const noOrigemId = tarefa.etapa_modelo_id;

  if (ACOES_RETORNO.has(acao)) {
    const arestas = canvas.arestas || [];
    const nos = canvas.nos || [];
    const arestaEntrada = arestas.find(a => a.destino === noOrigemId);
    const noAnterior = arestaEntrada ? nos.find(n => n.id === arestaEntrada.origem) : null;
    if (!(noAnterior && noAnterior.tipo !== 'inicio')) {
      return 'Etapa rejeitada sem etapa anterior disponível.';
    }
    _atualizarInstanciaCanvasBatch(batch, instancia.id, {
      no_atual_id: noAnterior.id,
      etapa_atual_id: noAnterior.id,
    }, now);
    _criarTarefaRetornoCanvasBatch(batch, instancia, noAnterior, now);
    return `Etapa devolvida para "${noAnterior.nome}".`;
  }

  const prox = _proximoNoServer(canvas, noOrigemId, acao, dadosMerged);
  if (!prox || prox.tipo === 'fim') {
    _atualizarInstanciaCanvasBatch(batch, instancia.id, {
      status: 'concluido',
      concluido_em: now,
      no_atual_id: null,
      etapa_atual_id: null,
    }, now);
    return 'Processo concluído.';
  }

  _atualizarInstanciaCanvasBatch(batch, instancia.id, {
    no_atual_id: prox.id,
    etapa_atual_id: prox.id,
  }, now);
  await _criarTarefaProximoNoCanvasBatch(batch, instancia, prox, now);
  return `Avançou para etapa "${prox.nome}".`;
}

async function _processarFluxoSequencialConclusao(batch, instancia, tarefa, acao, now) {
  const etapas = instancia.snapshot_etapas || [];
  const idx = etapas.findIndex(e => e.id === tarefa.etapa_modelo_id);

  if (ACOES_RETORNO.has(acao) && idx > 0) {
    const etapaAnt = etapas[idx - 1];
    batch.update(db.collection('wf_instancia_processos').doc(instancia.id), {
      etapa_atual_id: etapaAnt.id,
      _atualizado_em: now,
    });
    await _criarTarefaServer(batch, db.collection('wf_tarefa_workflows').doc(), instancia, etapaAnt);
    return `Etapa devolvida para "${etapaAnt.nome}".`;
  }

  const proxEtapa = etapas[idx + 1];
  if (!proxEtapa) {
    batch.update(db.collection('wf_instancia_processos').doc(instancia.id), {
      status: 'concluido', concluido_em: now, etapa_atual_id: null, _atualizado_em: now,
    });
    return 'Processo concluído.';
  }

  batch.update(db.collection('wf_instancia_processos').doc(instancia.id), {
    etapa_atual_id: proxEtapa.id,
    _atualizado_em: now,
  });
  await _criarTarefaServer(batch, db.collection('wf_tarefa_workflows').doc(), instancia, proxEtapa);
  return `Avançou para etapa "${proxEtapa.nome}".`;
}

function _registrarHistoricoConclusaoBatch(batch, { instancia, tarefa, tarefaId, uid, acao, observacao, descHistorico, now }) {
  const histRef = db.collection('wf_historico_workflows').doc();
  batch.set(histRef, {
    instancia_id: instancia.id, tipo_evento: 'tarefa_concluida',
    usuario_uid: uid, etapa_id: tarefa.etapa_modelo_id, tarefa_id: tarefaId,
    descricao: `Etapa "${tarefa.etapa_nome}" — ${acao}. ${descHistorico}`,
    dados: { acao, papel: tarefa.papel_responsavel || null, parecer: observacao || null },
    _criado_em: now,
  });
}

function _notificarSolicitanteConclusaoBatch(batch, instancia, tarefa, tarefaId, uid, acao, now) {
  if (!(instancia.solicitante_uid && instancia.solicitante_uid !== uid)) return;
  const notifRef = db.collection('wf_notificacoes').doc();
  batch.set(notifRef, {
    destinatario_uid: instancia.solicitante_uid,
    tipo: 'etapa_concluida',
    titulo: `Etapa concluída: ${tarefa.etapa_nome}`,
    mensagem: `A etapa "${tarefa.etapa_nome}" do processo "${instancia.titulo}" foi ${acao}.`,
    instancia_id: instancia.id, tarefa_id: tarefaId, lida: false, _criado_em: now,
  });
}

exports.wfConcluirTarefaEngine = onCall({ enforceAppCheck: false }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');

  const { tarefaId, acao, observacao, dadosFormulario, anexos } = request.data || {};
  if (!tarefaId || !acao) throw new HttpsError('invalid-argument', 'tarefaId e acao são obrigatórios.');

  const tarefa = await _carregarTarefaServer(tarefaId);
  _validarEstadoTarefaConclusaoServer(tarefa);
  const permissoes = await _carregarPermissoesConclusaoServer(uid);
  _validarPermissaoConclusaoServer(uid, tarefa, acao, observacao, permissoes);
  const instancia = await _carregarInstanciaServer(tarefa.instancia_id);

  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  const dadosMerged = { ...instancia.dados_consolidados, ...dadosFormulario };

  _atualizarTarefaConcluidaBatch(batch, tarefaId, observacao, acao, dadosFormulario, anexos, now);
  _atualizarDadosInstanciaBatch(batch, instancia, dadosMerged, now);

  const descHistorico = instancia.canvas
    ? await _processarFluxoCanvasConclusao(batch, instancia, tarefa, acao, dadosMerged, now)
    : await _processarFluxoSequencialConclusao(batch, instancia, tarefa, acao, now);

  _registrarHistoricoConclusaoBatch(batch, { instancia, tarefa, tarefaId, uid, acao, observacao, descHistorico, now });
  _notificarSolicitanteConclusaoBatch(batch, instancia, tarefa, tarefaId, uid, acao, now);

  await batch.commit();
  return { ok: true, descricao: descHistorico };
});

// ---------------------------------------------------------------------------
// P2.4 — SLA Scheduler
// Executa a cada hora; busca tarefas vencidas e cria notificações de alerta.
// ---------------------------------------------------------------------------
exports.wfVerificarSLAs = onSchedule({ schedule: 'every 60 minutes', timeZone: 'America/Sao_Paulo' }, async () => {
  const agora = new Date();
  const em2h = new Date(agora.getTime() + 2 * 3600000);
  const batch = db.batch();
  const now = FieldValue.serverTimestamp();
  let processadas = 0;

  // ── 1. Pré-alerta: tarefas que vencem nas próximas 2h ────────────────────
  const snapPreAlerta = await db.collection('wf_tarefa_workflows')
    .where('status', 'in', ['pendente', 'em_execucao'])
    .where('prazo', '>', agora)
    .where('prazo', '<', em2h)
    .get();

  for (const docSnap of snapPreAlerta.docs) {
    const tarefa = { id: docSnap.id, ...docSnap.data() };
    if (!tarefa.responsavel_uid) continue;

    // Evita duplicata de pré-alerta
    const jaAlerta = await db.collection('wf_notificacoes')
      .where('tarefa_id', '==', tarefa.id)
      .where('tipo', '==', 'sla_alerta')
      .limit(1)
      .get();
    if (!jaAlerta.empty) continue;

    const minutosRestantes = Math.round((tarefa.prazo.toDate() - agora) / 60000);
    const ref = db.collection('wf_notificacoes').doc();
    batch.set(ref, {
      destinatario_uid: tarefa.responsavel_uid,
      tipo: 'sla_alerta',
      titulo: `Prazo próximo: ${tarefa.etapa_nome}`,
      mensagem: `A etapa "${tarefa.etapa_nome}" do processo "${tarefa.processo_nome}" vence em ${minutosRestantes} minutos.`,
      instancia_id: tarefa.instancia_id,
      tarefa_id: tarefa.id,
      lida: false,
      _criado_em: now,
    });
    processadas++;
  }

  // ── 2. SLA vencido: tarefas com prazo já ultrapassado ────────────────────
  const snapVencido = await db.collection('wf_tarefa_workflows')
    .where('status', 'in', ['pendente', 'em_execucao'])
    .where('prazo', '<', agora)
    .get();

  for (const docSnap of snapVencido.docs) {
    const tarefa = { id: docSnap.id, ...docSnap.data() };

    // Evita duplicata de vencido
    const jaNotif = await db.collection('wf_notificacoes')
      .where('tarefa_id', '==', tarefa.id)
      .where('tipo', '==', 'sla_vencido')
      .limit(1)
      .get();
    if (!jaNotif.empty) continue;

    if (tarefa.responsavel_uid) {
      const ref = db.collection('wf_notificacoes').doc();
      batch.set(ref, {
        destinatario_uid: tarefa.responsavel_uid,
        tipo: 'sla_vencido',
        titulo: `SLA vencido: ${tarefa.etapa_nome}`,
        mensagem: `A etapa "${tarefa.etapa_nome}" do processo "${tarefa.processo_nome}" está com prazo vencido.`,
        instancia_id: tarefa.instancia_id,
        tarefa_id: tarefa.id,
        lida: false,
        _criado_em: now,
      });
    }

    // Escalada para EP
    const escRef = db.collection('wf_notificacoes').doc();
    const hAtraso = tarefa.prazo?.toDate ? Math.round((agora - tarefa.prazo.toDate()) / 3600000) : '?';
    batch.set(escRef, {
      destinatario_uid: 'ep_escalada',
      tipo: 'sla_vencido_escalada',
      titulo: `Escalada SLA: ${tarefa.etapa_nome}`,
      mensagem: `Tarefa em "${tarefa.processo_nome}" vencida há ${hAtraso}h.`,
      instancia_id: tarefa.instancia_id,
      tarefa_id: tarefa.id,
      lida: false,
      _criado_em: now,
    });

    batch.update(docSnap.ref, { sla_vencido: true, _atualizado_em: now });
    processadas++;
  }

  if (processadas > 0) await batch.commit();
  console.log(`wfVerificarSLAs: ${processadas} tarefa(s) processadas (pré-alerta + vencidas).`);
});

// ---------------------------------------------------------------------------
// P3 — Arquivamento de instâncias antigas
// Executa mensalmente; marca como arquivado instâncias concluídas/canceladas
// com mais de 365 dias. Não deleta — preserva para auditoria.
// ---------------------------------------------------------------------------
exports.wfArquivarInstanciasAntigas = onSchedule({ schedule: 'every 24 hours', timeZone: 'America/Sao_Paulo' }, async () => {
  const limiteData = new Date();
  limiteData.setFullYear(limiteData.getFullYear() - 1); // 1 ano atrás

  const snap = await db.collection('wf_instancia_processos')
    .where('status', 'in', ['concluido', 'cancelado'])
    .where('arquivado', '==', false)
    .where('_criado_em', '<', limiteData)
    .get();

  if (snap.empty) {
    console.log('wfArquivarInstanciasAntigas: nenhuma instância para arquivar.');
    return;
  }

  // Processa em lotes de 500 (limite do Firestore batch)
  const LOTE = 500;
  let arquivadas = 0;
  const now = FieldValue.serverTimestamp();

  for (let i = 0; i < snap.docs.length; i += LOTE) {
    const batch = db.batch();
    const lote = snap.docs.slice(i, i + LOTE);
    lote.forEach(docSnap => {
      batch.update(docSnap.ref, { arquivado: true, arquivado_em: now, _atualizado_em: now });
    });
    await batch.commit();
    arquivadas += lote.length;
  }

  console.log(`wfArquivarInstanciasAntigas: ${arquivadas} instância(s) arquivadas.`);
});
