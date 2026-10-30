// openGym owner bootstrap for Railway (community template, not affiliated with openGym).
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Runs before `node server.js`, while the API port is still closed. On an instance with no
// profiles at all it writes one profile into db.json: OPENGYM_OWNER_NAME with the password
// OPENGYM_OWNER_PASSWORD, marked admin and owner. Together with INVITE_ONLY=1 nobody can create a
// profile without an invite code from that owner, and nobody can claim a fresh instance first.
// On every later boot it changes nothing and the OPENGYM_OWNER_* variables are not read.
//
// The password is hashed with openGym's own password.js, and the file is written with its own
// durable.js (temporary file, fsync, rename), the way the server saves db.json, plus the
// db.json.bak copy the server keeps. The record has the shape POST /api/register/password gives
// the first profile of an instance under FIRST_USER_ADMIN=1.
//
//   node seed-owner.mjs              bootstrap (railway-entrypoint.sh runs this)
//   node seed-owner.mjs --check      only load openGym's modules
//   node seed-owner.mjs --self-test  bootstrap into temporary directories and verify the result
//
// OPENGYM_APP_DIR (default /app) is where openGym's API lives in the image.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP_DIR = process.env.OPENGYM_APP_DIR || '/app';
// server.js keeps the first 40 characters of a profile name (text(body.name).trim().slice(0, 40)).
const NAME_MAX = 40;
const TRUTHY = /^(1|true|yes|on)$/i;
const PREFIX = '[railway-opengym]';

class SetupError extends Error {}

const consoleLogger = {
  info: msg => console.log(`${PREFIX} ${msg}`),
  warn: msg => console.error(`${PREFIX} WARNING: ${msg}`),
};
const quietLogger = { info: () => {}, warn: () => {} };

async function loadOpenGym() {
  const load = file => import(pathToFileURL(path.join(APP_DIR, file)).href);
  const [password, durable] = await Promise.all([load('password.js'), load('durable.js')]);
  const needed = [
    [password, 'password.js', ['hashPassword', 'verifyPassword', 'passwordProblem', 'nameKey', 'normalizeEmail']],
    [durable, 'durable.js', ['atomicWrite']],
  ];
  for (const [mod, file, names] of needed) {
    for (const name of names) {
      if (typeof mod[name] !== 'function') {
        throw new SetupError(`${file} in ${APP_DIR} has no ${name}(); this wrapper does not fit this openGym version`);
      }
    }
  }
  return {
    hashPassword: password.hashPassword,
    verifyPassword: password.verifyPassword,
    passwordProblem: password.passwordProblem,
    nameKey: password.nameKey,
    normalizeEmail: password.normalizeEmail,
    atomicWrite: durable.atomicWrite,
  };
}

// What is on disk: a parsed db.json, nothing yet, or something the server has to deal with itself.
function readDb(dbFile) {
  let raw;
  try {
    raw = fs.readFileSync(dbFile, 'utf8');
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    if (fs.existsSync(`${dbFile}.bak`)) return { state: 'backup-only' };
    return { state: 'fresh', db: { users: [], creds: [], subs: [], invites: [] } };
  }
  try {
    const db = JSON.parse(raw);
    if (!db || typeof db !== 'object' || Array.isArray(db)) return { state: 'unreadable' };
    return { state: 'ok', db };
  } catch {
    return { state: 'unreadable' };
  }
}

function ownerFromEnv(env, og) {
  const name = String(env.OPENGYM_OWNER_NAME ?? '').trim();
  if (!name) throw new SetupError('OPENGYM_OWNER_NAME is empty. Set the profile name the owner signs in with.');
  if (name.length > NAME_MAX) throw new SetupError(`OPENGYM_OWNER_NAME is longer than ${NAME_MAX} characters, the most openGym keeps.`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new SetupError('OPENGYM_OWNER_NAME contains control characters.');

  const password = String(env.OPENGYM_OWNER_PASSWORD ?? '');
  if (!password) throw new SetupError('OPENGYM_OWNER_PASSWORD is empty. Set a password of 10 or more characters.');
  const problem = og.passwordProblem(password, name);
  if (problem) {
    throw new SetupError(`openGym refuses OPENGYM_OWNER_PASSWORD (${problem}): use 10 to 256 characters, not a common password and not the profile name plus digits.`);
  }

  const rawEmail = String(env.OPENGYM_OWNER_EMAIL ?? '').trim();
  let email = null;
  if (rawEmail) {
    email = og.normalizeEmail(rawEmail);
    if (!email) throw new SetupError('OPENGYM_OWNER_EMAIL is not an e-mail address. Leave it empty to sign in with the name only.');
  }
  return { name, password, email };
}

/**
 * Creates the owner when the instance has no profiles. Returns 'created', 'exists' or 'skipped'.
 * Throws SetupError on input openGym would refuse.
 */
async function bootstrap(env, og, logger = consoleLogger) {
  const dataDir = env.DATA_DIR || '/data';
  const dbFile = path.join(dataDir, 'db.json');
  fs.mkdirSync(dataDir, { recursive: true });

  const found = readDb(dbFile);
  if (found.state === 'unreadable') {
    logger.warn('db.json cannot be parsed. openGym itself falls back to db.json.bak or refuses to start; no owner was created.');
    return 'skipped';
  }
  if (found.state === 'backup-only') {
    logger.warn(`db.json is missing but db.json.bak exists in ${dataDir}. Restore it (cp db.json.bak db.json) instead of starting over; no owner was created.`);
    return 'skipped';
  }

  const users = Array.isArray(found.db.users) ? found.db.users : [];
  if (users.length > 0) {
    const envAdmins = String(env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
    const admins = users.filter(u => u && (u.admin === true || envAdmins.includes(u.id))).length;
    logger.info(`${users.length} profile(s) on this instance; the first-boot owner setup is done and OPENGYM_OWNER_* are not used.`);
    if (admins === 0) {
      logger.warn('no profile is an admin, so nobody can open the admin dashboard or create invite codes. Put a profile id in ADMIN_UIDS (Settings, Account, Account ID).');
    }
    return 'exists';
  }

  const owner = ownerFromEnv(env, og);
  const created = new Date().toISOString();
  const user = {
    id: crypto.randomBytes(12).toString('base64url'),
    name: owner.name,
    created,
    pw: { h: await og.hashPassword(owner.password), set: created },
    ...(owner.email ? { email: owner.email } : {}),
    admin: true,
    owner: true,
  };
  const next = { ...found.db, users: [user] };
  const text = JSON.stringify(next, null, 2);
  og.atomicWrite(dbFile, text, 0o600);
  try {
    og.atomicWrite(`${dbFile}.bak`, text, 0o600);
  } catch (err) {
    logger.warn(`db.json.bak could not be written: ${err.message}`);
  }
  logger.info(`created the owner profile "${user.name}" (admin and owner, id ${user.id}). Sign in with that name${owner.email ? ' or the e-mail' : ''} and OPENGYM_OWNER_PASSWORD.`);
  if (!TRUTHY.test(env.PASSWORD_LOGIN || '')) {
    logger.warn('PASSWORD_LOGIN is off, so the owner (who has no passkey yet) cannot sign in with the password. Turn it on, or make a recovery code with `node /app/recover.js "{name}"` on this service.');
  }
  return 'created';
}

function check(condition, what) {
  if (!condition) throw new SetupError(`self-test failed: ${what}`);
}

async function expectRefusal(env, og, what) {
  try {
    await bootstrap(env, og, quietLogger);
  } catch (err) {
    if (err instanceof SetupError) return;
    throw err;
  }
  throw new SetupError(`self-test failed: ${what} was accepted`);
}

async function selfTest(og) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-seed-'));
  const dir = name => path.join(root, name);
  try {
    const password = crypto.randomBytes(18).toString('base64url');
    const env = {
      DATA_DIR: dir('fresh'), OPENGYM_OWNER_NAME: 'Build Check', OPENGYM_OWNER_PASSWORD: password,
      OPENGYM_OWNER_EMAIL: 'Owner@Example.com', PASSWORD_LOGIN: '1',
    };
    check(await bootstrap(env, og, quietLogger) === 'created', 'fresh instance gets an owner');
    const dbFile = path.join(env.DATA_DIR, 'db.json');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    const [u] = db.users;
    check(db.users.length === 1 && u.admin === true && u.owner === true, 'owner is admin and owner');
    check(u.name === 'Build Check' && u.email === 'owner@example.com', 'name kept, e-mail folded');
    check(Array.isArray(db.creds) && Array.isArray(db.invites), 'empty collections written');
    check(await og.verifyPassword(password, u.pw.h), 'password verifies with openGym');
    check(!(await og.verifyPassword(`${password}x`, u.pw.h)), 'wrong password is refused');
    check((fs.statSync(dbFile).mode & 0o777) === 0o600, 'db.json is 0600');
    check(fs.readFileSync(`${dbFile}.bak`, 'utf8') === fs.readFileSync(dbFile, 'utf8'), 'db.json.bak matches');

    const second = { ...env, OPENGYM_OWNER_NAME: 'Someone Else', OPENGYM_OWNER_PASSWORD: '' };
    check(await bootstrap(second, og, quietLogger) === 'exists', 'second boot changes nothing');
    check(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users[0].id === u.id, 'owner kept on second boot');

    fs.mkdirSync(dir('kept'));
    const keep = { users: [], creds: [{ id: 'c1' }], subs: [], invites: [{ code: 'X' }], deviceLinks: [] };
    fs.writeFileSync(path.join(dir('kept'), 'db.json'), JSON.stringify(keep));
    check(await bootstrap({ ...env, DATA_DIR: dir('kept') }, og, quietLogger) === 'created', 'empty profile list gets an owner');
    const kept = JSON.parse(fs.readFileSync(path.join(dir('kept'), 'db.json'), 'utf8'));
    check(kept.invites[0].code === 'X' && kept.creds[0].id === 'c1' && Array.isArray(kept.deviceLinks), 'other collections kept');

    fs.mkdirSync(dir('broken'));
    fs.writeFileSync(path.join(dir('broken'), 'db.json'), '{"users": [');
    check(await bootstrap({ ...env, DATA_DIR: dir('broken') }, og, quietLogger) === 'skipped', 'unreadable db.json left alone');
    check(fs.readFileSync(path.join(dir('broken'), 'db.json'), 'utf8') === '{"users": [', 'unreadable db.json unchanged');

    fs.mkdirSync(dir('bak'));
    fs.writeFileSync(path.join(dir('bak'), 'db.json.bak'), '{}');
    check(await bootstrap({ ...env, DATA_DIR: dir('bak') }, og, quietLogger) === 'skipped', 'backup-only directory left alone');
    check(!fs.existsSync(path.join(dir('bak'), 'db.json')), 'no db.json written next to a lone backup');

    await expectRefusal({ ...env, DATA_DIR: dir('weak'), OPENGYM_OWNER_PASSWORD: 'Password123!' }, og, 'a common password');
    await expectRefusal({ ...env, DATA_DIR: dir('short'), OPENGYM_OWNER_PASSWORD: 'short' }, og, 'a short password');
    await expectRefusal({ ...env, DATA_DIR: dir('noname'), OPENGYM_OWNER_NAME: '  ' }, og, 'an empty name');
    await expectRefusal({ ...env, DATA_DIR: dir('mail'), OPENGYM_OWNER_EMAIL: 'not-an-address' }, og, 'a bad e-mail');
    check(!fs.existsSync(path.join(dir('weak'), 'db.json')), 'nothing written after a refusal');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main(mode) {
  const og = await loadOpenGym();
  if (mode === '--check') {
    consoleLogger.info(`openGym modules in ${APP_DIR} loaded`);
    return;
  }
  if (mode === '--self-test') {
    await selfTest(og);
    consoleLogger.info('owner bootstrap self-test passed');
    return;
  }
  if (mode) throw new SetupError(`unknown argument ${mode}`);
  await bootstrap(process.env, og);
}

try {
  await main(process.argv[2] || '');
} catch (err) {
  console.error(`${PREFIX} ERROR: ${err instanceof SetupError ? err.message : (err && err.stack) || err}`);
  process.exit(1);
}
