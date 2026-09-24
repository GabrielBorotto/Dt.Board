'use strict';
// Audita, item por item, TODAS as vendas de um grupo especifico num periodo - mostrando se
// cada item esta sendo incluido ou excluido pelo app, e POR QUAL MOTIVO (NSITPED, NDEVNOT,
// ou CFOP/TIPNOP). Util pra achar um item que deveria contar mas esta sumindo da conta.
//
// Ferramenta AUTOCONTIDA (nao depende de nada do projeto).
//
// Uso:
//   node auditoria-grupo.js <ftnota> <ftlnota> <ftmpri> <ftnope> <codigo_do_grupo> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplo (Queijos = grupo 12, conforme o relatorio do FAT):
//   node auditoria-grupo.js "G:\Zimmer\ftnota.dbf" "G:\Zimmer\ftlnota.dbf" "G:\Zimmer\ftmpri.dbf" "G:\Zimmer\ftnope.dbf" 12 01/08/2026 31/08/2026

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
  return { txt: m[0], chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , ftnotaPath, ftlnotaPath, ftmpriPath, ftnopePath, grupoArg, deArg, ateArg] = process.argv;
if (!ftnotaPath || !ftlnotaPath || !ftmpriPath || !ftnopePath || !grupoArg || !deArg || !ateArg) {
  console.log('Uso: node auditoria-grupo.js <ftnota> <ftlnota> <ftmpri> <ftnope> <codigo_do_grupo> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);

console.log('Lendo ftnope.dbf ...');
const nope = new Map();
scanDbf(ftnopePath, ['CODNOP', 'TIPNOP'], (r) => nope.set(r.CODNOP, r.TIPNOP));

console.log('Lendo ftmpri.dbf (produtos do grupo ' + grupoArg + ') ...');
const produtosDoGrupo = new Map(); // CODMPR -> DESMPR
scanDbf(ftmpriPath, ['CODMPR', 'DESMPR', 'GRUMPR'], (r) => {
  if (r.GRUMPR === grupoArg) produtosDoGrupo.set(r.CODMPR, r.DESMPR);
});
console.log('  ' + produtosDoGrupo.size + ' produtos encontrados nesse grupo.\n');

console.log('Lendo ftnota.dbf ...');
const notas = new Map(); // numero -> {data, nsitped, ndevnot, cfop}
scanDbf(ftnotaPath, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE'], (r) => {
  notas.set(r.NNRNOTA, { data: parseData(r.NDTEMIS), nsitped: r.NSITPED, ndevnot: r.NDEVNOT, cfop: r.NNATOPE });
});

console.log('Lendo ftlnota.dbf (itens dos produtos do grupo, no período) ...\n');
const linhas = [];
let qtdIncluida = 0, valorIncluido = 0, qtdExcluida = 0, valorExcluido = 0;

scanDbf(ftlnotaPath, ['LNRNOTA', 'LCODPRO', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LVLSTDEV', 'LQUAPES'], (r) => {
  if (!produtosDoGrupo.has(r.LCODPRO)) return;

  const n = notas.get(r.LNRNOTA);
  if (!n || !n.data) return;
  if (n.data.chave < de.chave || n.data.chave > ate.chave) return;

  const vf = num(r.LVTOTAL) - num(r.LVALDES) + num(r.LVALACR) + num(r.LVALFRE) + num(r.LVLSTDEV);
  const qtd = num(r.LQUAPES);

  let motivo = null;
  if (n.nsitped !== '1') motivo = 'NSITPED="' + n.nsitped + '" (não é 1)';
  else if (n.ndevnot === 'S') motivo = 'NDEVNOT="S"';
  else {
    const tipnop = nope.get(n.cfop);
    if (tipnop !== 'V') motivo = 'CFOP "' + n.cfop + '" tem TIPNOP="' + (tipnop || '(não cadastrado no ftnope!)') + '"';
  }

  linhas.push({ nota: r.LNRNOTA, data: n.data.txt, produto: r.LCODPRO, desc: produtosDoGrupo.get(r.LCODPRO), cfop: n.cfop, qtd, vf, motivo });
  if (motivo) { qtdExcluida += qtd; valorExcluido += vf; }
  else { qtdIncluida += qtd; valorIncluido += vf; }
});

console.log('=== Itens EXCLUÍDOS (não entram na conta do app) ===\n');
const excluidas = linhas.filter((l) => l.motivo);
if (excluidas.length === 0) console.log('  (nenhum item excluído encontrado)');
excluidas.forEach((l) => {
  console.log('  nota ' + l.nota + ' | ' + l.data + ' | produto ' + l.produto + ' (' + l.desc + ')');
  console.log('    qtd=' + l.qtd.toFixed(3) + '  valorFinal=' + fmt(l.vf) + '  CFOP=' + l.cfop);
  console.log('    MOTIVO DA EXCLUSÃO: ' + l.motivo + '\n');
});

console.log('=== Resumo ===');
console.log('Itens incluídos: qtd=' + qtdIncluida.toFixed(3) + '  valorFinal=R$ ' + fmt(valorIncluido));
console.log('Itens excluídos: qtd=' + qtdExcluida.toFixed(3) + '  valorFinal=R$ ' + fmt(valorExcluido));
console.log('Total geral (incluído+excluído): qtd=' + (qtdIncluida + qtdExcluida).toFixed(3) + '  valorFinal=R$ ' + fmt(valorIncluido + valorExcluido));
