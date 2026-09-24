'use strict';
// Como a auditoria-grupo.js, mas resume por PRODUTO (nao por linha de venda) - soma qtd e
// valorFinal de todos os itens INCLUIDOS de cada produto do grupo, pra comparar direto com
// um relatorio externo que tambem seja por produto.
//
// Uso:
//   node resumo-produto-grupo.js <ftnota> <ftlnota> <ftmpri> <ftnope> <codigo_do_grupo> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>

const fs = require('fs');

function scanDbf(caminho, camposDesejados, onRecord) {
  const fd = fs.openSync(caminho, 'r');
  const cabecalho = Buffer.alloc(32);
  fs.readSync(fd, cabecalho, 0, 32, 0);
  const numRecords = cabecalho.readUInt32LE(4);
  const headerSize = cabecalho.readUInt16LE(8);
  const recordSize = cabecalho.readUInt16LE(10);
  const descArea = Buffer.alloc(headerSize - 32);
  fs.readSync(fd, descArea, 0, descArea.length, 32);
  const campos = [];
  let off = 0;
  while (descArea[off] !== 0x0D) {
    const name = descArea.toString('ascii', off, off + 11).replace(/\0.*$/, '').trim();
    const length = descArea[off + 16];
    campos.push({ name, length, wanted: camposDesejados.includes(name) });
    off += 32;
  }
  const TAMANHO_BLOCO = 2000;
  const bufBloco = Buffer.alloc(recordSize * TAMANHO_BLOCO);
  let lidos = 0;
  while (lidos < numRecords) {
    const nesteBloco = Math.min(TAMANHO_BLOCO, numRecords - lidos);
    const bytesLidos = fs.readSync(fd, bufBloco, 0, recordSize * nesteBloco, headerSize + lidos * recordSize);
    if (bytesLidos <= 0) break;
    for (let i = 0; i < nesteBloco; i++) {
      const recOff = i * recordSize;
      if (bufBloco[recOff] === 0x2A) continue;
      const rec = {};
      let fOff = recOff + 1;
      for (const c of campos) {
        if (c.wanted) rec[c.name] = bufBloco.toString('latin1', fOff, fOff + c.length).trim();
        fOff += c.length;
      }
      onRecord(rec);
    }
    lidos += nesteBloco;
  }
  fs.closeSync(fd);
}

function parseData(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , ftnotaPath, ftlnotaPath, ftmpriPath, ftnopePath, grupoArg, deArg, ateArg] = process.argv;
if (!ftnotaPath || !ftlnotaPath || !ftmpriPath || !ftnopePath || !grupoArg || !deArg || !ateArg) {
  console.log('Uso: node resumo-produto-grupo.js <ftnota> <ftlnota> <ftmpri> <ftnope> <codigo_do_grupo> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);

const nope = new Map();
scanDbf(ftnopePath, ['CODNOP', 'TIPNOP'], (r) => nope.set(r.CODNOP, r.TIPNOP));

const produtosDoGrupo = new Map(); // CODMPR -> DESMPR
scanDbf(ftmpriPath, ['CODMPR', 'DESMPR', 'GRUMPR'], (r) => {
  if (r.GRUMPR === grupoArg) produtosDoGrupo.set(r.CODMPR, r.DESMPR);
});

const notas = new Map();
scanDbf(ftnotaPath, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE'], (r) => {
  notas.set(r.NNRNOTA, { data: parseData(r.NDTEMIS), nsitped: r.NSITPED, ndevnot: r.NDEVNOT, cfop: r.NNATOPE });
});

const porProduto = new Map(); // CODPRO -> { qtd, valorFinal }
let notaNaoEncontrada = 0;

scanDbf(ftlnotaPath, ['LNRNOTA', 'LCODPRO', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LVLSTDEV', 'LQUAPES'], (r) => {
  if (!produtosDoGrupo.has(r.LCODPRO)) return;

  const n = notas.get(r.LNRNOTA);
  if (!n || !n.data) { notaNaoEncontrada++; return; }
  if (n.data.chave < de.chave || n.data.chave > ate.chave) return;

  const valida = n.nsitped === '1' && n.ndevnot !== 'S' && nope.get(n.cfop) === 'V';
  if (!valida) return;

  const vf = num(r.LVTOTAL) - num(r.LVALDES) + num(r.LVALACR) + num(r.LVALFRE) + num(r.LVLSTDEV);
  const qtd = num(r.LQUAPES);
  if (!porProduto.has(r.LCODPRO)) porProduto.set(r.LCODPRO, { qtd: 0, valorFinal: 0 });
  const p = porProduto.get(r.LCODPRO);
  p.qtd += qtd;
  p.valorFinal += vf;
});

console.log('Código | Descrição'.padEnd(45) + '| QtdSaida  | ValorSaida');
console.log('-'.repeat(75));
let totQtd = 0, totVal = 0;
Array.from(porProduto.entries()).sort((a, b) => a[0].localeCompare(b[0])).forEach(([cod, p]) => {
  totQtd += p.qtd; totVal += p.valorFinal;
  console.log(cod.padEnd(7) + '| ' + (produtosDoGrupo.get(cod) || '').padEnd(36) + '| ' + p.qtd.toFixed(3).padStart(9) + ' | ' + fmt(p.valorFinal).padStart(12));
});
console.log('-'.repeat(75));
console.log('TOTAL: qtd=' + totQtd.toFixed(3) + '  valorFinal=R$ ' + fmt(totVal));
console.log('\n(notas de itens desse grupo que não foram encontradas no ftnota: ' + notaNaoEncontrada + ')');
