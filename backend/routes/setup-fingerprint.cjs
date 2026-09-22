#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');
(async () => {
  const target = path.join(__dirname, 'fingerprint-kiosk.config.json');
  if (fs.existsSync(target)) throw new Error('Configuration already exists. Nothing changed. Use the existing kioskToken or rotate it deliberately.');
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  let adminId;
  try { adminId = (await prompt.question('Employee ke User record ka adminId paste karein (24 characters): ')).trim(); }
  finally { prompt.close(); }
  if (!/^[a-f\d]{24}$/i.test(adminId)) throw new Error('adminId must be a 24-character MongoDB ID. Nothing written.');
  const config = {
    adminId: adminId.toLowerCase(),
    kioskToken: crypto.randomBytes(32).toString('hex'),
    enrollToken: crypto.randomBytes(32).toString('hex')
  };
  fs.writeFileSync(target, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('\nPrivate configuration created next to this script. Keep this file private and out of git.');
  console.log('KIOSK TOKEN — copy ONLY into your Windows kiosk, not into chat:');
  console.log(config.kioskToken);
  console.log('\nEnrollment uses the separate enrollToken from the private configuration file.');
  console.log('Reload attendance-backend after installing the updated routes file.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
