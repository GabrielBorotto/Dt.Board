'use strict';
const fs = require('fs');
const path = require('path');

//Caminho do FAT são sempre do windows.
const pw = path.win32;

//Os 10 arquivis do FAT que são obrigatórios para o sistema funcionar.
const ARQUIVOS_FAT = [
  {chave: 'ftnota', arquivo: 'ftnota.dbf'},
  {chave: 'ftentr', arquivo: 'ftentr.dbf'},
  {chave: 'ftcomp', arquivo: 'ftcomp.dbf'},
  {chave: 'ftcrec', arquivo: 'ftcrec.dbf'},
  {chave: 'ftcpag', arquivo: 'ftcpag.dbf'},
  {chave: 'ftlnota', arquivo: 'ftlnota.dbf'},
  {chave: 'ftgrup', arquivo: 'ftgrup.dbf'},
  {chave: 'ftmpri', arquivo: 'ftmpri.dbf'},
  {chave: 'ftlentr', arquivo: 'ftlentr.dbf'},
  {chave: 'ftnope', arquivo: 'ftnope.dbf'},
];

const DEFAULT_CONFIG = {
  companyName: '',
  logoDataUrl: '',
  theme: 'dark',
  pastaDados: '',
  paths: {
    ftnota: '',
    ftentr: '',
    ftcomp: '',
    ftcrec: '',
    ftcpag: '',
    ftlnota: '',
    ftgrup: '',
    ftmpri: '',
    ftlentr: '',
    ftnope: '',
  },
  refreshMinutes: 5,
  metaCrescimentoPct: 10,
  metaFixaSaidas: '',
};

function configFilePath(userDataDir) {
  return path.join(userDataDir, 'config.json');
}

function mesmoCaminho(a, b) {
  return pw.normalize(String(a)).toLowerCase() === pw.normalize(String(b)).toLowerCase();
}

// Configuração de antes da 1.1.8 (sem a pasta): a pasta é a do ftnota, ou a do primeiro caminho preenchido
function pastaDosCaminhos(paths) {
  const primeiro = paths.ftnota || ARQUIVOS_FAT.map((a) => paths[a.chave]).find(Boolean) || '';
  return primeiro ? pw.dirname(primeiro) : '';
}

function loadConfig(userDataDir) {
  const p = configFilePath(userDataDir);
  let cfg;
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    cfg = Object.assign({}, DEFAULT_CONFIG, parsed, {
      paths: Object.assign({}, DEFAULT_CONFIG.paths, parsed.paths || {}),
    });
    if (parsed.pastaDados === undefined) cfg.pastaDados = pastaDosCaminhos(cfg.paths);
  } catch (e) {
    cfg = Object.assign({}, DEFAULT_CONFIG, { paths: Object.assign({}, DEFAULT_CONFIG.paths) });
  }
  delete cfg.caminhosPersonalizados; // sobra da versão de teste (não é mais usado)
  return cfg;
}
  
function saveConfig(userDataDir, config) {
  const p = configFilePath(userDataDir);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig, DEFAULT_CONFIG, ARQUIVOS_FAT, mesmoCaminho, pastaDosCaminhos };
