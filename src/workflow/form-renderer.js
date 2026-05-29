(function initFormRenderer(globalScope) {
  'use strict';

  /**
   * Renderiza um formulário dinâmico a partir de um schema JSON.
   * @param {object} schema - FormularioModelo
   * @param {object} valoresIniciais - Dados pré-preenchidos (somente leitura ou edição)
   * @param {boolean} somenteLeitura - true para exibir dados sem permitir edição
   * @returns {HTMLElement}
   */
  function renderizarFormulario(schema, valoresIniciais = {}, somenteLeitura = false) {
    const form = document.createElement('div');
    form.className = 'wf-form';
    form.dataset.formularioId = schema.id || '';

    if (schema.titulo) {
      const titulo = document.createElement('h4');
      titulo.className = 'wf-form-titulo';
      titulo.textContent = schema.titulo;
      form.appendChild(titulo);
    }

    (schema.campos || []).forEach(campo => {
      const grupo = _renderizarCampo(campo, valoresIniciais[campo.id], somenteLeitura);
      form.appendChild(grupo);
    });

    return form;
  }

  function _renderizarCampo(campo, valor, somenteLeitura) {
    const grupo = document.createElement('div');
    grupo.className = 'wf-campo-grupo';
    grupo.dataset.campoId = campo.id;

    const label = document.createElement('label');
    label.className = 'wf-campo-label';
    label.htmlFor = `wf-campo-${campo.id}`;
    label.textContent = campo.label + (campo.obrigatorio ? ' *' : '');
    grupo.appendChild(label);

    let input;

    if (somenteLeitura) {
      input = _renderizarLeitura(campo, valor);
    } else {
      switch (campo.tipo) {
        case 'texto':     input = _inputTexto(campo, valor);    break;
        case 'textarea':  input = _inputTextarea(campo, valor); break;
        case 'numero':    input = _inputNumero(campo, valor);   break;
        case 'data':      input = _inputData(campo, valor);     break;
        case 'select':    input = _inputSelect(campo, valor);   break;
        case 'checkbox':  input = _inputCheckbox(campo, valor); break;
        case 'anexo':     input = _inputAnexo(campo, valor);    break;
        default:          input = _inputTexto(campo, valor);
      }
    }

    grupo.appendChild(input);

    const erro = document.createElement('span');
    erro.className = 'wf-campo-erro';
    erro.id = `wf-erro-${campo.id}`;
    grupo.appendChild(erro);

    return grupo;
  }

  function _renderizarLeitura(campo, valor) {
    const span = document.createElement('div');
    span.className = 'wf-campo-leitura';

    if (campo.tipo === 'checkbox') {
      span.textContent = valor ? 'Sim' : 'Não';
    } else if (campo.tipo === 'anexo') {
      if (valor) {
        const link = document.createElement('a');
        link.href = globalScope.safeUrl ? globalScope.safeUrl(valor.url) : '#';
        link.textContent = valor.nome || 'Anexo';
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        span.appendChild(link);
      } else {
        span.textContent = '—';
      }
    } else {
      span.textContent = valor != null && valor !== '' ? String(valor) : '—';
    }
    return span;
  }

  function _base(campo, tipo) {
    const el = document.createElement('input');
    el.type = tipo;
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input';
    if (campo.obrigatorio) el.required = true;
    if (campo.placeholder) el.placeholder = campo.placeholder;
    return el;
  }

  function _inputTexto(campo, valor) {
    const el = _base(campo, 'text');
    if (valor != null) el.value = String(valor);
    if (campo.validacao?.regex) el.pattern = campo.validacao.regex;
    return el;
  }

  function _inputTextarea(campo, valor) {
    const el = document.createElement('textarea');
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input wf-campo-textarea';
    el.rows = 4;
    if (campo.obrigatorio) el.required = true;
    if (campo.placeholder) el.placeholder = campo.placeholder;
    if (valor != null) el.value = String(valor);
    return el;
  }

  function _inputNumero(campo, valor) {
    const el = _base(campo, 'number');
    if (valor != null) el.value = String(valor);
    if (campo.validacao?.min != null) el.min = String(campo.validacao.min);
    if (campo.validacao?.max != null) el.max = String(campo.validacao.max);
    return el;
  }

  function _inputData(campo, valor) {
    const el = _base(campo, 'date');
    if (valor) el.value = String(valor).substring(0, 10);
    if (campo.validacao?.min) el.min = String(campo.validacao.min).substring(0, 10);
    if (campo.validacao?.max) el.max = String(campo.validacao.max).substring(0, 10);
    return el;
  }

  function _inputSelect(campo, valor) {
    const el = document.createElement('select');
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input wf-campo-select';
    if (campo.obrigatorio) el.required = true;

    const vazio = document.createElement('option');
    vazio.value = '';
    vazio.textContent = 'Selecione…';
    el.appendChild(vazio);

    (campo.opcoes || []).forEach(opcao => {
      const opt = document.createElement('option');
      opt.value = opcao;
      opt.textContent = opcao;
      if (opcao === valor) opt.selected = true;
      el.appendChild(opt);
    });

    return el;
  }

  function _inputCheckbox(campo, valor) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wf-campo-checkbox-wrapper';

    const el = document.createElement('input');
    el.type = 'checkbox';
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-checkbox';
    el.checked = Boolean(valor);
    if (campo.obrigatorio) el.required = true;

    const lbl = document.createElement('label');
    lbl.htmlFor = el.id;
    lbl.textContent = campo.label;
    lbl.className = 'wf-campo-checkbox-label';

    wrapper.appendChild(el);
    wrapper.appendChild(lbl);
    return wrapper;
  }

  function _inputAnexo(campo, valor) {
    const wrapper = document.createElement('div');
    wrapper.className = 'wf-campo-anexo-wrapper';

    const el = document.createElement('input');
    el.type = 'file';
    el.id = `wf-campo-${campo.id}`;
    el.name = campo.id;
    el.className = 'wf-campo-input';
    el.accept = '.pdf,.png,.jpg,.jpeg,.doc,.docx';
    if (campo.obrigatorio) el.required = true;

    if (valor?.nome) {
      const existente = document.createElement('div');
      existente.className = 'wf-campo-anexo-existente';
      existente.textContent = `Arquivo atual: ${valor.nome}`;
      wrapper.appendChild(existente);
    }

    wrapper.appendChild(el);
    return wrapper;
  }

  /**
   * Coleta os valores de um formulário renderizado.
   * @param {HTMLElement} formEl - Container gerado por renderizarFormulario
   * @param {object[]} campos - Lista de campos do schema
   * @returns {{ valido: boolean, dados: object, erros: object }}
   */
  function coletarDados(formEl, campos) {
    const dados = {};
    const erros = {};

    campos.forEach(campo => {
      const grupo = formEl.querySelector(`[data-campo-id="${campo.id}"]`);
      if (!grupo) return;

      const input = grupo.querySelector(`#wf-campo-${campo.id}`);
      if (!input) return;

      let valor;
      if (campo.tipo === 'checkbox') {
        valor = input.checked;
      } else if (campo.tipo === 'anexo') {
        valor = input.files?.[0] ?? null;
      } else {
        valor = input.value.trim();
      }

      if (campo.obrigatorio && (valor === '' || valor === null || valor === undefined)) {
        erros[campo.id] = `${campo.label} é obrigatório.`;
      }

      dados[campo.id] = valor;
      _exibirErro(grupo, campo.id, erros[campo.id] || '');
    });

    return {
      valido: Object.keys(erros).length === 0,
      dados,
      erros,
    };
  }

  function _exibirErro(grupo, campoId, mensagem) {
    const erroEl = grupo.querySelector(`#wf-erro-${campoId}`);
    if (erroEl) erroEl.textContent = mensagem;
  }

  Object.assign(globalScope, {
    wfRenderizarFormulario: renderizarFormulario,
    wfColetarDadosFormulario: coletarDados,
  });
})(globalThis);
