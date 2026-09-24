'use strict';
// Testa DUAS regras de filtro de CFOP (usando o ftnope.dbf como referencia oficial) e mostra
// qual delas faz o Total de Saidas e o Total da Margem baterem mais perto do valor esperado.
//   Regra A: conta a nota se TIPNOP = "V"
//   Regra B: conta a nota se TIPNOP = "V" E FATNOP = "F"
// (isso e por CIMA da regra que ja usamos: NSITPED="1" e NDEVNOT != "S")
//
// Esta ferramenta e AUTOCONTIDA - nao depende de nenhum arquivo do projeto. Le os .dbf em
// FLUXO (um registro por vez, so os campos necessarios) para nao estourar memoria em
// arquivos grandes como o ftnota.dbf (pode ter centenas de MB).
//
// Uso:
//   node testar-tipnop.js <ftnota.dbf> <ftlnota.dbf> <ftnope.dbf> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA> [valor_alvo]

const fs = require('fs');

// Le um .dbf em fluxo, chamando onRecord(rec) para cada registro nao deletado. So extrai os
// campos listados em camposDesejados (nao guarda o arquivo inteiro na memoria).
function scanDbf(caminho, camposDesejados, onRecord) {
  const fd = fs.openSync(caminho, 'r');
  const cabecalho = Buffer.alloc(32);
  fs.readSync(fd, cabecalho, 0, 32, 0);
  const numRecords = cabecalho.readUInt32LE(4);
  const headerSize = cabecalho.readUInt16LE(8);
  const recordSize = cabecalho.readUInt16LE(10);

  // le a lista de campos (descritores), que ficam logo apos os 32 bytes do cabecalho
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

  // le os registros em BLOCOS (nao um por um, nao tudo de uma vez) - equilibrio entre
  // velocidade e memoria
  const TAMANHO_BLOCO = 2000; // registros por leitura
  const bufBloco = Buffer.alloc(recordSize * TAMANHO_BLOCO);
  let lidos = 0;
  while (lidos < numRecords) {
    const nesteBloco = Math.min(TAMANHO_BLOCO, numRecords - lidos);
    const bytesLidos = fs.readSync(fd, bufBloco, 0, recordSize * nesteBloco, headerSize + lidos * recordSize);
    if (bytesLidos <= 0) break;

    for (let i = 0; i < nesteBloco; i++) {
      const recOff = i * recordSize;
      if (bufBloco[recOff] === 0x2A) continue; // deletado

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

const [, , ftnotaPath, ftlnotaPath, ftnopePath, deArg, ateArg, alvoArg] = process.argv;
if (!ftnotaPath || !ftlnotaPath || !ftnopePath || !deArg || !ateArg) {
  console.log('Uso: node testar-tipnop.js <ftnota.dbf> <ftlnota.dbf> <ftnope.dbf> <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA> [valor_alvo]');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);
const alvo = alvoArg ? Number(alvoArg) : null;

console.log('Lendo ftnope.dbf ...');
const nope = new Map();
scanDbf(ftnopePath, ['CODNOP', 'TIPNOP', 'FATNOP'], (r) => nope.set(r.CODNOP, { tipnop: r.TIPNOP, fatnop: r.FATNOP }));

function valeA(cfop) { const r = nope.get(cfop); return !!r && r.tipnop === 'V'; }
function valeB(cfop) { const r = nope.get(cfop); return !!r && r.tipnop === 'V' && r.fatnop === 'F'; }

console.log('Lendo ftnota.dbf (pode demorar um pouco, é um arquivo grande) ...');
// guarda so o MINIMO por nota: se conta em cada regra (booleano), nao o registro inteiro
const notas = new Map(); // numero -> { contaA: bool, contaB: bool }
let saidasA = 0, saidasB = 0, notasNoPeriodo = 0;
scanDbf(ftnotaPath, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE', 'NTOTFAT'], (r) => {
  const data = parseData(r.NDTEMIS);
  if (!data || data.chave < de.chave || data.chave > ate.chave) return;
  const validaBase = r.NSITPED === '1' && r.NDEVNOT !== 'S';
  if (!validaBase) return;

  notasNoPeriodo++;
  const cfop = r.NNATOPE;
  const ntotfat = num(r.NTOTFAT);
  const contaA = valeA(cfop), contaB = valeB(cfop);
  notas.set(r.NNRNOTA, { contaA, contaB });
  if (contaA) saidasA += ntotfat;
  if (contaB) saidasB += ntotfat;
});
console.log('Notas válidas (NSITPED/NDEVNOT) no período: ' + notasNoPeriodo);

console.log('Lendo ftlnota.dbf (pode demorar mais um pouco, é o maior arquivo) ...\n');
let margemA = 0, margemB = 0;
scanDbf(ftlnotaPath, ['LNRNOTA', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE'], (r) => {
  const n = notas.get(r.LNRNOTA);
  if (!n) return;
  const vf = num(r.LVTOTAL) - num(r.LVALDES) + num(r.LVALACR) + num(r.LVALFRE);
  if (n.contaA) margemA += vf;
  if (n.contaB) margemB += vf;
});

console.log('=== Regra A: TIPNOP="V" ===');
console.log('Saídas: R$ ' + fmt(saidasA));
console.log('Margem: R$ ' + fmt(margemA));
console.log('Diferença Margem-Saídas: R$ ' + fmt(margemA - saidasA));
if (alvo) console.log('Diferença p/ alvo (Saídas): R$ ' + fmt(saidasA - alvo) + ' | (Margem): R$ ' + fmt(margemA - alvo));

console.log('\n=== Regra B: TIPNOP="V" E FATNOP="F" ===');
console.log('Saídas: R$ ' + fmt(saidasB));
console.log('Margem: R$ ' + fmt(margemB));
console.log('Diferença Margem-Saídas: R$ ' + fmt(margemB - saidasB));
if (alvo) console.log('Diferença p/ alvo (Saídas): R$ ' + fmt(saidasB - alvo) + ' | (Margem): R$ ' + fmt(margemB - alvo));

if (alvo) {
  console.log('\n=== Veredito ===');
  const erroA = Math.abs(saidasA - alvo) + Math.abs(margemA - alvo);
  const erroB = Math.abs(saidasB - alvo) + Math.abs(margemB - alvo);
  console.log('Regra A - soma dos erros: R$ ' + fmt(erroA));
  console.log('Regra B - soma dos erros: R$ ' + fmt(erroB));
  console.log('\n>>> Melhor regra: ' + (erroA <= erroB ? 'A (só TIPNOP="V")' : 'B (TIPNOP="V" e FATNOP="F")'));
}
