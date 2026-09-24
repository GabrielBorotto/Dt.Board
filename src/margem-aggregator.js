'use strict';
const { scan } = require('./dbf-reader');
const { parseBrDate, parseNum } = require('./dbf-utils');

function parseISO(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

// Le o cadastro de grupos (ftgrup.dbf) -> Map CODGRU -> descricao
function lerGrupos(path) {
  const grupos = new Map();
  scan(path, ['CODGRU', 'DESGRU'], (rec) => {
    if (rec.__deleted) return;
    grupos.set((rec.CODGRU || '').trim(), (rec.DESGRU || '').trim());
  });
  return grupos;
}

// Le o cadastro de produtos (ftmpri.dbf) -> Map CODMPR -> {desc, grupo}
function lerProdutos(path) {
  const produtos = new Map();
  scan(path, ['CODMPR', 'DESMPR', 'GRUMPR'], (rec) => {
    if (rec.__deleted) return;
    produtos.set((rec.CODMPR || '').trim(), {
      desc: (rec.DESMPR || '').trim(),
      grupo: (rec.GRUMPR || '').trim(),
    });
  });
  return produtos;
}

// Le o historico de compras (ftlentr.dbf) e monta, por produto, uma lista ordenada por data
// de entrada com o custo unitario de cada compra - para depois achar "a compra mais recente
// antes de uma data" (busca binaria).
function construirHistoricoCompras(path) {
  const historico = new Map(); // CODPRO -> [{data: Date, custoUnitario: number}]
  scan(path, ['LCODPRO', 'LNDTENT', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LQUAPES'], (rec) => {
    if (rec.__deleted) return;
    const data = parseBrDate(rec.LNDTENT);
    if (!data) return;
    const peso = parseNum(rec.LQUAPES);
    if (peso === 0) return; // evita divisao por zero - compra sem peso registrado nao ajuda a achar custo

    const valorFinal = parseNum(rec.LVTOTAL) - parseNum(rec.LVALDES) + parseNum(rec.LVALACR) + parseNum(rec.LVALFRE);
    const custoUnitario = valorFinal / peso;
    const cod = (rec.LCODPRO || '').trim();
    if (!historico.has(cod)) historico.set(cod, []);
    historico.get(cod).push({ data, custoUnitario });
  });
  historico.forEach((lista) => lista.sort((a, b) => a.data - b.data));
  return historico;
}

// Acha o custo unitario da compra mais recente ANTES (ou na mesma data) de uma venda, para um
// produto - busca binaria na lista já ordenada. Se a venda for anterior a qualquer compra
// registrada, usa a compra mais antiga disponível como aproximação (melhor do que custo zero).
function custoNaData(historico, codProduto, data) {
  const lista = historico.get(codProduto);
  if (!lista || lista.length === 0) return null;
  let lo = 0, hi = lista.length - 1, resultado = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lista[mid].data <= data) { resultado = lista[mid]; lo = mid + 1; }
    else hi = mid - 1;
  }
  return resultado ? resultado.custoUnitario : lista[0].custoUnitario;
}

// Le do ftnota.dbf, por numero de nota: a data de emissao e se esta cancelada. O ftlnota
// (itens da venda) NAO tem seu proprio campo de data preenchido - a data so existe na nota
// "pai" (ftnota), entao precisamos cruzar pelo numero da nota (LNRNOTA = NNRNOTA) para saber
// quando cada item foi vendido.
function lerInfoNotas(path, cfopsValidos) {
  const info = new Map(); // NNRNOTA -> { data: Date|null, cancelada: boolean }
  scan(path, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE'], (rec) => {
    if (rec.__deleted) return;
    const nota = (rec.NNRNOTA || '').trim();
    const situacaoValida = (rec.NSITPED || '').trim() === '1';
    const ehDevolucao = (rec.NDEVNOT || '').trim() === 'S';
    const cfop = (rec.NNATOPE || '').trim();
    const cfopValido = !cfopsValidos || cfopsValidos.has(cfop);
    const data = parseBrDate(rec.NDTEMIS);
    info.set(nota, { data, cancelada: !situacaoValida || ehDevolucao || !cfopValido });
  });
  return info;
}

// Calcula a margem por grupo/item para um intervalo de datas [from, to] (strings 'YYYY-MM-DD').
function calcularMargem(ftlnotaPath, opts) {
  const { produtos, grupos, historicoCompras, infoNotas, from, to } = opts;
  const fromDate = parseISO(from), toDate = parseISO(to);

  const itensPorProduto = new Map(); // CODPRO -> { qtd, valorFinal, custo }

  const wanted = ['LNRNOTA', 'LCODPRO', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LVLSTDEV', 'LQUAPES'];
  const meta = scan(ftlnotaPath, wanted, (rec) => {
    if (rec.__deleted) return;
    const nota = (rec.LNRNOTA || '').trim();
    const infoNota = infoNotas.get(nota);
    if (!infoNota || infoNota.cancelada || !infoNota.data) return; // nota nao encontrada, cancelada, ou sem data valida

    const data = infoNota.data;
    if (data < fromDate || data > toDate) return;

    const cod = (rec.LCODPRO || '').trim();
    const qtd = parseNum(rec.LQUAPES);
    const valorFinal = parseNum(rec.LVTOTAL) - parseNum(rec.LVALDES) + parseNum(rec.LVALACR) + parseNum(rec.LVALFRE) + parseNum(rec.LVLSTDEV);
    const custoUnitario = custoNaData(historicoCompras, cod, data);
    const custo = custoUnitario == null ? 0 : custoUnitario * qtd;

    if (!itensPorProduto.has(cod)) itensPorProduto.set(cod, { qtd: 0, valorFinal: 0, custo: 0 });
    const it = itensPorProduto.get(cod);
    it.qtd += qtd;
    it.valorFinal += valorFinal;
    it.custo += custo;
  });

  const gruposResultado = new Map(); // CODGRU -> { desc, qtd, valorFinal, custo, itens: [...] }

  itensPorProduto.forEach((valores, cod) => {
    const produto = produtos.get(cod) || { desc: cod, grupo: '' };
    const codGrupo = produto.grupo || '(sem grupo)';
    const descGrupo = grupos.get(codGrupo) || codGrupo;

    if (!gruposResultado.has(codGrupo)) {
      gruposResultado.set(codGrupo, { desc: descGrupo, qtd: 0, valorFinal: 0, custo: 0, itens: [] });
    }
    const g = gruposResultado.get(codGrupo);
    g.qtd += valores.qtd;
    g.valorFinal += valores.valorFinal;
    g.custo += valores.custo;
    g.itens.push({
      codigo: cod,
      desc: produto.desc,
      qtd: valores.qtd,
      valorFinal: valores.valorFinal,
      custo: valores.custo,
      margem: valores.valorFinal - valores.custo,
    });
  });

  const resultado = [];
  gruposResultado.forEach((g, codGrupo) => {
    g.itens.sort((a, b) => b.valorFinal - a.valorFinal);
    resultado.push({
      codigo: codGrupo,
      desc: g.desc,
      qtd: g.qtd,
      valorFinal: g.valorFinal,
      custo: g.custo,
      margem: g.valorFinal - g.custo,
      itens: g.itens,
    });
  });
  resultado.sort((a, b) => b.valorFinal - a.valorFinal);

  return { grupos: resultado, totalRegistros: meta.numRecords };
}

module.exports = {
  lerGrupos, lerProdutos, construirHistoricoCompras, custoNaData,
  lerInfoNotas, calcularMargem,
};
