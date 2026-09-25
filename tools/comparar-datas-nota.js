'use strict';
// Compara, dia a dia, o total faturado agrupando por NDTEMIS (data de emissao) versus
// NDTSAID (data de saida) - util pra descobrir qual campo o relatorio do FAT realmente usa
// pra separar por dia, quando os totais diarios do app nao batem mas o total do mes bate.
//
// Uso:
//   node comparar-datas-nota.js <ftnota.dbf> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>

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
  return { txt: m[1] + '/' + m[2], chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , ftnotaPath, deArg, ateArg] = process.argv;
if (!ftnotaPath || !deArg || !ateArg) {
  console.log('Uso: node comparar-datas-nota.js <ftnota.dbf> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);

const porEmissao = new Map(); // dia -> total
const porSaida = new Map();

console.log('Lendo ftnota.dbf ...\n');
scanDbf(ftnotaPath, ['NDTEMIS', 'NDTSAID', 'NSITPED', 'NDEVNOT', 'NTOTFAT'], (r) => {
  if (r.NSITPED !== '1') return;
  if (r.NDEVNOT === 'S') return;
  const v = num(r.NTOTFAT);

  const dEmis = parseData(r.NDTEMIS);
  if (dEmis && dEmis.chave >= de.chave && dEmis.chave <= ate.chave) {
    porEmissao.set(dEmis.txt, (porEmissao.get(dEmis.txt) || 0) + v);
  }
  const dSaid = parseData(r.NDTSAID);
  if (dSaid && dSaid.chave >= de.chave && dSaid.chave <= ate.chave) {
    porSaida.set(dSaid.txt, (porSaida.get(dSaid.txt) || 0) + v);
  }
});

const todosDias = new Set([...porEmissao.keys(), ...porSaida.keys()]);
const diasOrdenados = Array.from(todosDias).sort((a, b) => {
  const [da, ma] = a.split('/').map(Number), [db, mb] = b.split('/').map(Number);
  return (ma - mb) || (da - db);
});

console.log('data     | por NDTEMIS (emissão) | por NDTSAID (saída)  | diferença');
console.log('-'.repeat(70));
let totEmis = 0, totSaid = 0;
diasOrdenados.forEach((dia) => {
  const e = porEmissao.get(dia) || 0, s = porSaida.get(dia) || 0;
  totEmis += e; totSaid += s;
  console.log(dia.padEnd(9) + '| ' + fmt(e).padStart(20) + '  | ' + fmt(s).padStart(19) + '  | ' + fmt(s - e).padStart(12));
});
console.log('-'.repeat(70));
console.log('TOTAL'.padEnd(9) + '| ' + fmt(totEmis).padStart(20) + '  | ' + fmt(totSaid).padStart(19));
console.log('\nCompare cada linha com o relatório do FAT desse dia - veja qual coluna bate.');
