'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = {
  companyName: 'Minha Empresa',
  logoDataUrl: '',
  theme: 'dark',
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

function loadConfig(userDataDir) {
  const p = configFilePath(userDataDir);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign({}, DEFAULT_CONFIG, parsed, {
      paths: Object.assign({}, DEFAULT_CONFIG.paths, parsed.paths || {}),
    });
  } catch (e) {
    return Object.assign({}, DEFAULT_CONFIG, { paths: Object.assign({}, DEFAULT_CONFIG.paths) });
  }
}

function saveConfig(userDataDir, config) {
  const p = configFilePath(userDataDir);
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { loadConfig, saveConfig, DEFAULT_CONFIG };
