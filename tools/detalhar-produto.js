'use strict';
// Mostra TODAS as vendas de um produto especifico, sem filtrar nada - pra cada uma, mostra
// se ela seria incluida ou excluida hoje pelo app, e por qual motivo. Nao esconde nada
// (nem itens fora do periodo, nem notas nao encontradas) - o objetivo e ver 100% do que
// existe pra aquele produto.
//
// Uso:
//   node detalhar-produto.js <ftnota> <ftlnota> <ftnope> <codigo_do_produto> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>

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

const [, , ftnotaPath, ftlnotaPath, ftnopePath, codProdutoArg, deArg, ateArg] = process.argv;
if (!ftnotaPath || !ftlnotaPath || !ftnopePath || !codProdutoArg || !deArg || !ateArg) {
  console.log('Uso: node detalhar-produto.js <ftnota> <ftlnota> <ftnope> <codigo_do_produto> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);
const codProduto = codProdutoArg.trim();

const nope = new Map();
scanDbf(ftnopePath, ['CODNOP', 'TIPNOP'], (r) => nope.set(r.CODNOP, r.TIPNOP));

console.log('Lendo ftnota.dbf ...');
const notas = new Map();
scanDbf(ftnotaPath, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE'], (r) => {
  notas.set(r.NNRNOTA, { data: parseData(r.NDTEMIS), nsitped: r.NSITPED, ndevnot: r.NDEVNOT, cfop: r.NNATOPE });
});

console.log('Lendo ftlnota.dbf (TODAS as linhas do produto ' + codProduto + ', sem filtro) ...\n');
let n = 0, qtdContada = 0, valorContado = 0;
scanDbf(ftlnotaPath, ['LNRNOTA', 'LCODPRO', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE', 'LVLSTDEV', 'LQUAPES'], (r) => {
  if (r.LCODPRO !== codProduto) return;
  n++;

  const info = notas.get(r.LNRNOTA);
  const qtd = num(r.LQUAPES);
  const vf = num(r.LVTOTAL) - num(r.LVALDES) + num(r.LVALACR) + num(r.LVALFRE) + num(r.LVLSTDEV);

  let status;
  if (!info) {
    status = 'NOTA NÃO ENCONTRADA no ftnota (número "' + r.LNRNOTA + '")';
  } else if (!info.data) {
    status = 'DATA INVÁLIDA na nota (NDTEMIS="' + '") ';
  } else if (info.data.chave < de.chave || info.data.chave > ate.chave) {
    status = 'FORA DO PERÍODO (data da nota: ' + info.data.txt + ')';
  } else if (info.nsitped !== '1') {
    status = 'EXCLUÍDA: NSITPED="' + info.nsitped + '"';
  } else if (info.ndevnot === 'S') {
    status = 'EXCLUÍDA: NDEVNOT="S"';
  } else if (nope.get(info.cfop) !== 'V') {
    status = 'EXCLUÍDA: CFOP "' + info.cfop + '" tem TIPNOP="' + (nope.get(info.cfop) || '(não cadastrado)') + '"';
  } else {
    status = 'CONTADA ✓';
    qtdContada += qtd;
    valorContado += vf;
  }

  console.log('nota ' + r.LNRNOTA + ' | qtd=' + qtd.toFixed(3) + ' | valorFinal=' + fmt(vf) +
    (num(r.LVLSTDEV) !== 0 ? ' (inclui LVLSTDEV=' + fmt(num(r.LVLSTDEV)) + ')' : '') +
    ' | data nota=' + (info && info.data ? info.data.txt : '???') + ' | ' + status);
});

console.log('\n=== Resumo ===');
console.log('Linhas encontradas no ftlnota pra esse produto: ' + n);
console.log('Quantidade contada (que o app soma hoje): ' + qtdContada.toFixed(3));
console.log('Valor contado (que o app soma hoje): R$ ' + fmt(valorContado));
