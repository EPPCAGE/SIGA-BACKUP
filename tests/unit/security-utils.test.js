/**
 * Testes unitários — src/processos/security-utils.js
 *
 * Os arquivos em src/ usam o padrão IIFE: (function(globalScope){...})(globalThis).
 * Usamos vm.runInNewContext para executar cada IIFE em um escopo isolado,
 * sem modificar o globalThis real nem precisar alterar os arquivos de produção.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { runInNewContext } from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const code = readFileSync(
  join(__dirname, '../../src/processos/security-utils.js'),
  'utf8'
);

let esc, safeUrl;

beforeAll(() => {
  // Executa a IIFE com um scope controlado.
  // globalThis dentro da IIFE aponta para este objeto,
  // então esc e safeUrl ficam disponíveis aqui após a execução.
  const scope = { console, URL };
  runInNewContext(code, scope);
  esc    = scope.esc;
  safeUrl = scope.safeUrl;
});

// ---------------------------------------------------------------------------
// esc()
// ---------------------------------------------------------------------------

describe('esc()', () => {
  describe('escapa os 5 caracteres HTML críticos', () => {
    it('& → &amp;', () => {
      expect(esc('a & b')).toBe('a &amp; b');
    });

    it('< → &lt;', () => {
      expect(esc('<div>')).toBe('&lt;div&gt;');
    });

    it('> → &gt;', () => {
      expect(esc('a > b')).toBe('a &gt; b');
    });

    it('" → &quot;', () => {
      expect(esc('"texto"')).toBe('&quot;texto&quot;');
    });

    it("' → &#39;", () => {
      expect(esc("'texto'")).toBe('&#39;texto&#39;');
    });
  });

  describe('bloqueia vetores de injeção XSS comuns', () => {
    it('tag <script>', () => {
      expect(esc('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
    });

    it('atributo com aspas duplas', () => {
      expect(esc('<img src="x" onerror="alert(1)">')).toBe(
        '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;'
      );
    });

    it('atributo com aspas simples', () => {
      expect(esc("<a href='javascript:void(0)'>")).toBe(
        '&lt;a href=&#39;javascript:void(0)&#39;&gt;'
      );
    });
  });

  describe('trata valores nulos e não-string', () => {
    it('retorna string vazia para null', () => {
      expect(esc(null)).toBe('');
    });

    it('retorna string vazia para undefined', () => {
      expect(esc(undefined)).toBe('');
    });

    it('converte número para string sem alterar', () => {
      expect(esc(42)).toBe('42');
    });

    it('converte booleano para string sem alterar', () => {
      expect(esc(true)).toBe('true');
    });
  });

  it('não altera texto sem caracteres especiais', () => {
    expect(esc('texto normal sem problemas')).toBe('texto normal sem problemas');
  });

  it('escapa múltiplas ocorrências do mesmo caractere', () => {
    expect(esc('a < b < c')).toBe('a &lt; b &lt; c');
  });
});

// ---------------------------------------------------------------------------
// safeUrl()
// ---------------------------------------------------------------------------

describe('safeUrl()', () => {
  describe('aceita URLs https válidas', () => {
    it('URL simples', () => {
      expect(safeUrl('https://exemplo.gov.br')).toBe('https://exemplo.gov.br');
    });

    it('URL com path', () => {
      expect(safeUrl('https://siga.sefaz.rs.gov.br/processos')).toBe(
        'https://siga.sefaz.rs.gov.br/processos'
      );
    });

    it('URL com query string', () => {
      expect(safeUrl('https://exemplo.gov.br/page?id=1&x=2')).toBe(
        'https://exemplo.gov.br/page?id=1&x=2'
      );
    });

    it('URL com porta', () => {
      expect(safeUrl('https://localhost:3000')).toBe('https://localhost:3000');
    });
  });

  describe('rejeita protocolos não seguros', () => {
    it('http:// sem TLS → string vazia', () => {
      expect(safeUrl('http://exemplo.gov.br')).toBe('');
    });

    it('javascript: → string vazia', () => {
      expect(safeUrl('javascript:alert(1)')).toBe('');
    });

    it('data: → string vazia', () => {
      expect(safeUrl('data:text/html,<h1>xss</h1>')).toBe('');
    });

    it('ftp:// → string vazia', () => {
      expect(safeUrl('ftp://files.exemplo.gov.br')).toBe('');
    });
  });

  describe('trata entradas inválidas', () => {
    it('string vazia → string vazia', () => {
      expect(safeUrl('')).toBe('');
    });

    it('null → string vazia', () => {
      expect(safeUrl(null)).toBe('');
    });

    it('undefined → string vazia', () => {
      expect(safeUrl(undefined)).toBe('');
    });

    it('texto sem protocolo → string vazia', () => {
      expect(safeUrl('nao-e-uma-url')).toBe('');
    });

    it('URL malformada → string vazia', () => {
      expect(safeUrl('https://')).toBe('');
    });
  });
});
