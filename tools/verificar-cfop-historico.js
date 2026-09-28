'use strict';
// Mostra, para um periodo, cada CFOP que apareceu nas notas (validas por NSITPED/NDEVNOT),
// com o total de NTOTFAT e se esse CFOP e considerado "venda valida" HOJE no ftnope.dbf.
// Util pra achar CFOPs antigos que foram descontinuados/reclassificados e que por isso
// passaram a ser excluidos de periodos passados sem terem nada de errado na epoca.
//
// Uso:
//   node verificar-cfop-historico.js <ftnota.dbf> <ftnope.dbf> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>

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

const [, , ftnotaPath, ftnopePath, deArg, ateArg] = process.argv;
if (!ftnotaPath || !ftnopePath || !deArg || !ateArg) {
  console.log('Uso: node verificar-cfop-historico.js <ftnota.dbf> <ftnope.dbf> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);

const nope = new Map();
scanDbf(ftnopePath, ['CODNOP', 'TIPNOP', 'DESNOP'], (r) => nope.set(r.CODNOP, { tipnop: r.TIPNOP, desc: r.DESNOP }));

const porCfop = {}; // cfop -> { qtdNotas, somaNota, somaContada }
scanDbf(ftnotaPath, ['NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE', 'NTOTFAT'], (r) => {
  const data = parseData(r.NDTEMIS);
  if (!data || data.chave < de.chave || data.chave > ate.chave) return;
  if (r.NSITPED !== '1') return;
  if (r.NDEVNOT === 'S') return;

  const cfop = r.NNATOPE;
  if (!porCfop[cfop]) porCfop[cfop] = { qtdNotas: 0, somaNota: 0 };
  porCfop[cfop].qtdNotas++;
  porCfop[cfop].somaNota += num(r.NTOTFAT);
});

const chaves = Object.keys(porCfop).sort((a, b) => porCfop[b].somaNota - porCfop[a].somaNota);
console.log('CFOP     | notas | soma NTOTFAT       | válido HOJE? | descrição no ftnope');
console.log('-'.repeat(90));
let totalTudo = 0, totalContado = 0, totalNaoContado = 0;
chaves.forEach((cfop) => {
  const info = nope.get(cfop);
  const valido = info && info.tipnop === 'V';
  const b = porCfop[cfop];
  totalTudo += b.somaNota;
  if (valido) totalContado += b.somaNota; else totalNaoContado += b.somaNota;

  const statusTxt = !info ? 'NÃO CADASTRADO' : (valido ? 'sim (V)' : 'não (' + info.tipnop + ')');
  console.log(
    cfop.padEnd(8) + ' | ' + String(b.qtdNotas).padStart(5) + ' | ' + fmt(b.somaNota).padStart(18) + ' | ' +
    statusTxt.padEnd(12) + ' | ' + (info ? info.desc : '')
  );
});
console.log('-'.repeat(90));
console.log('Total de tudo (todo CFOP, válido ou não): R$ ' + fmt(totalTudo));
console.log('Total considerado válido hoje (o que o app soma): R$ ' + fmt(totalContado));
console.log('Total excluído hoje: R$ ' + fmt(totalNaoContado));
console.log('\nProcure por CFOPs com "NÃO CADASTRADO" ou status diferente de "sim (V)" que tenham');
console.log('soma alta - esses são os candidatos a explicar a diferença.');
