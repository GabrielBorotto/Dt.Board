'use strict';
// Teste autossuficiente: gera .dbf sintéticos (em Node puro, sem dependências), roda o
// agregador real do projeto e confere os resultados contra valores calculados à parte.
// Rodar com: npm test

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { aggregateNotasPorDia, aggregateAgingNaoLiquidado } = require('../src/aggregator');

function writeDbf(filePath, fields, records) {
  const recordLen = 1 + fields.reduce((a, f) => a + f.length, 0);
  const headerLen = 32 + 32 * fields.length + 1;

  const chunks = [];
  const header = Buffer.alloc(32);
  header[0] = 0x03;
  header.writeUInt32LE(records.length, 4);
  header.writeUInt16LE(headerLen, 8);
  header.writeUInt16LE(recordLen, 10);
  chunks.push(header);

  for (const f of fields) {
    const fd = Buffer.alloc(32);
    fd.write(f.name, 0, 'latin1');
    fd[11] = f.type.charCodeAt(0);
    fd[16] = f.length;
    fd[17] = f.dec || 0;
    chunks.push(fd);
  }
  chunks.push(Buffer.from([0x0d]));

  for (const rec of records) {
    const buf = Buffer.alloc(recordLen, 0x20);
    let pos = 1;
    fields.forEach((f, i) => {
      const raw = String(rec[i] === undefined ? '' : rec[i]);
      const text = f.type === 'N' ? raw.padStart(f.length, ' ') : raw.padEnd(f.length, ' ');
      buf.write(text.slice(0, f.length), pos, 'latin1');
      pos += f.length;
    });
    chunks.push(buf);
  }
  chunks.push(Buffer.from([0x1a]));

  fs.writeFileSync(filePath, Buffer.concat(chunks));
}

function close(a, b, eps) { return Math.abs(a - b) < (eps || 0.01); }

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-board-test-'));

  // ---- FTNOTA: valores por dia, com notas invalidas (NSITPED != "1") que devem ser excluídas ----
  const fieldsNota = [
    { name: 'NDTEMIS', type: 'C', length: 10 },
    { name: 'NSITPED', type: 'C', length: 1 },
    { name: 'NTOTFAT', type: 'N', length: 14, dec: 2 },
    { name: 'NVALICM', type: 'N', length: 14, dec: 2 },
    { name: 'NVALICM1', type: 'N', length: 14, dec: 2 },
    { name: 'NPISNOT', type: 'N', length: 14, dec: 2 },
    { name: 'NCOFNOT', type: 'N', length: 14, dec: 2 },
  ];
  const dias = ['10/06/2016', '11/06/2016', '12/06/2016'];
  const esperadoNota = {};
  dias.forEach((d) => { esperadoNota[d] = { fat: 0, icms: 0, pis: 0, cofins: 0 }; });
  const recordsNota = [];
  for (let i = 1; i <= 20; i++) {
    const dia = dias[i % 3];
    const cancelada = i % 5 === 0;
    const fat = 1000 + i * 13.5, icm = 100 + i, icm1 = 5 + i * 0.5, pis = 16.5 + i * 0.1, cof = 76 + i * 0.3;
    recordsNota.push([dia, cancelada ? 'C' : '1', fat.toFixed(2), icm.toFixed(2), icm1.toFixed(2), pis.toFixed(2), cof.toFixed(2)]);
    if (!cancelada) {
      esperadoNota[dia].fat += fat; esperadoNota[dia].icms += icm + icm1;
      esperadoNota[dia].pis += pis; esperadoNota[dia].cofins += cof;
    }
  }
  const ftnotaPath = path.join(dir, 'ftnota_teste.dbf');
  writeDbf(ftnotaPath, fieldsNota, recordsNota);

  const { daily: dailyNota } = aggregateNotasPorDia(ftnotaPath, {
    dateField: 'NDTEMIS', valorField: 'NTOTFAT',
    icmsFields: ['NVALICM', 'NVALICM1'], pisField: 'NPISNOT', cofinsField: 'NCOFNOT',
    filtroValido: { campo: 'NSITPED', valor: '1' },
  });

  for (const [diaBr, exp] of Object.entries(esperadoNota)) {
    const [dd, mm, yyyy] = diaBr.split('/');
    const key = `${yyyy}-${mm}-${dd}`;
    const got = dailyNota.get(key) || { fat: 0, icms: 0, pis: 0, cofins: 0 };
    assert.ok(close(got.fat, exp.fat), `FTNOTA fat ${diaBr}: esperado ${exp.fat}, obtido ${got.fat}`);
    assert.ok(close(got.icms, exp.icms), `FTNOTA icms ${diaBr}: esperado ${exp.icms}, obtido ${got.icms}`);
    assert.ok(close(got.pis, exp.pis), `FTNOTA pis ${diaBr}: esperado ${exp.pis}, obtido ${got.pis}`);
    assert.ok(close(got.cofins, exp.cofins), `FTNOTA cofins ${diaBr}: esperado ${exp.cofins}, obtido ${got.cofins}`);
  }
  console.log('OK: FTNOTA agrega por dia e inclui só notas com NSITPED="1" corretamente.');

  // ---- FTNOTA: teste dedicado do filtroExcluido (NDEVNOT="S" deve ser excluída, mesmo com NSITPED="1") ----
  const fieldsDevol = [
    { name: 'NDTEMIS', type: 'C', length: 10 },
    { name: 'NSITPED', type: 'C', length: 1 },
    { name: 'NDEVNOT', type: 'C', length: 1 },
    { name: 'NTOTFAT', type: 'N', length: 14, dec: 2 },
  ];
  const recordsDevol = [
    ['01/07/2026', '1', '', '500.00'],  // normal, deve entrar
    ['01/07/2026', '1', 'S', '300.00'], // marcada como devolução, NÃO deve entrar
    ['01/07/2026', '1', 'N', '200.00'], // NDEVNOT="N" explicito, deve entrar
    ['01/07/2026', 'C', '', '999.00'],  // cancelada, NÃO deve entrar
  ];
  const ftnotaDevolPath = path.join(dir, 'ftnota_devol_teste.dbf');
  writeDbf(ftnotaDevolPath, fieldsDevol, recordsDevol);
  const { daily: dailyDevol } = aggregateNotasPorDia(ftnotaDevolPath, {
    dateField: 'NDTEMIS', valorField: 'NTOTFAT', icmsFields: [],
    filtroValido: { campo: 'NSITPED', valor: '1' },
    filtroExcluido: { campo: 'NDEVNOT', valor: 'S' },
  });
  const gotDevol = dailyDevol.get('2026-07-01') || { fat: 0 };
  assert.ok(close(gotDevol.fat, 700), `FTNOTA (NDEVNOT): esperado fat=700.00, obtido ${gotDevol.fat}`);
  console.log('OK: FTNOTA exclui notas com NDEVNOT="S" corretamente, mesmo com NSITPED="1".');

  // ---- FTCREC: só soma quem NÃO tem DPGDUP preenchido (ainda não liquidado),
  //      agrupado por atraso do vencimento (VCTDUP) em até 30 dias / +30 dias ----
  const fieldsCrec = [
    { name: 'VALDUP', type: 'N', length: 14, dec: 2 },
    { name: 'DPGDUP', type: 'C', length: 10 },
    { name: 'VCTDUP', type: 'C', length: 10 },
  ];
  const hoje = new Date();
  function dataMenos(dias) { const d = new Date(hoje); d.setDate(d.getDate() - dias); return d; }
  function fmtBr(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

  const recordsCrec = [];
  const esperadoCrec = { ate30: 0, mais30: 0 };
  const casos = [
    { venc: dataMenos(-10), paga: false }, // ainda nao venceu -> ate30
    { venc: dataMenos(5), paga: false },   // venceu ha 5 dias -> ate30
    { venc: dataMenos(30), paga: false },  // venceu ha exatos 30 dias -> ate30 (limite)
    { venc: dataMenos(31), paga: false },  // venceu ha 31 dias -> mais30
    { venc: dataMenos(90), paga: false },  // bem atrasada -> mais30
    { venc: dataMenos(5), paga: true },    // JA PAGA -> nao deve entrar em lugar nenhum
  ];
  casos.forEach((c, i) => {
    const val = 500 + i * 37.1;
    const dpg = c.paga ? fmtBr(dataMenos(1)) : '';
    recordsCrec.push([val.toFixed(2), dpg, fmtBr(c.venc)]);
    if (!c.paga) {
      const diff = Math.floor((hoje - c.venc) / (1000 * 60 * 60 * 24));
      if (diff <= 30) esperadoCrec.ate30 += val; else esperadoCrec.mais30 += val;
    }
  });

  const ftcrecPath = path.join(dir, 'ftcrec_teste.dbf');
  writeDbf(ftcrecPath, fieldsCrec, recordsCrec);

  const gotCrec = aggregateAgingNaoLiquidado(ftcrecPath, {
    valorField: 'VALDUP', dataPagamentoField: 'DPGDUP', dataVencimentoField: 'VCTDUP', hoje,
  });

  assert.ok(close(gotCrec.ate30, esperadoCrec.ate30), `FTCREC ate30: esperado ${esperadoCrec.ate30}, obtido ${gotCrec.ate30}`);
  assert.ok(close(gotCrec.mais30, esperadoCrec.mais30), `FTCREC mais30: esperado ${esperadoCrec.mais30}, obtido ${gotCrec.mais30}`);
  console.log('OK: FTCREC ignora duplicatas já liquidadas e agrupa as pendentes em até 30 / + de 30 dias corretamente.');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nTodos os testes passaram.');
}

run();
