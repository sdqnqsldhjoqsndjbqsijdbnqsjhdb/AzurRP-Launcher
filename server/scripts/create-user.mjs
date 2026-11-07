#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import env from '../src/env.js';
import { initDatabase, closeDatabase, query } from '../src/db.js';
import { assertEmail, assertPassword, hashPassword } from '../src/auth.js';

function parseArgs(argv) {
  // Least privilege: only grant administrator rights when explicitly requested.
  const args = { role: 'player' };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inline] = token.slice(2).split('=');
    if (key === 'force') {
      args.force = true;
      continue;
    }
    const value = inline ?? argv[(i += 1)];
    if (key === 'username' || key === 'email' || key === 'password' || key === 'role') {
      args[key] = value;
    }
  }
  return args;
}

async function promptMissing(args) {
  if (!stdin.isTTY) {
    return args;
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    while (!args.username) args.username = (await rl.question('Pseudo : ')).trim();
    while (!args.email) args.email = (await rl.question('Email : ')).trim();
    while (!args.password) args.password = await rl.question('Mot de passe : ');
  } finally {
    rl.close();
  }
  return args;
}

async function main() {
  const args = await promptMissing(parseArgs(process.argv.slice(2)));

  if (!args.username || !args.email || !args.password) {
    throw new Error(
      'Usage : npm run create-user -- --username Pseudo --email joueur@exemple.fr --password "motdepasse" [--role player|staff|admin] [--force] (rôle par défaut : player)'
    );
  }
  if (!['admin', 'staff', 'player'].includes(args.role)) {
    throw new Error('Rôle invalide : admin, staff ou player.');
  }

  const email = assertEmail(args.email);
  const password = assertPassword(args.password);

  await initDatabase();

  const existing = await query('SELECT id, username, email, role FROM users WHERE username = ? OR email = ? LIMIT 1', [
    args.username.trim(),
    email
  ]);

  const passwordHash = await hashPassword(password);

  if (existing.length) {
    if (!args.force) {
      throw new Error(
        `Le compte « ${existing[0].username} » existe déjà. Ajoute --force pour réinitialiser son mot de passe et son rôle.`
      );
    }
    await query('UPDATE users SET password_hash = ?, role = ?, email = ? WHERE id = ?', [
      passwordHash,
      args.role,
      email,
      existing[0].id
    ]);
    console.log(`[user] « ${existing[0].username} » mis à jour (${args.role}).`);
  } else {
    await query('INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      args.username.trim(),
      email,
      passwordHash,
      args.role
    ]);
    console.log(`[user] « ${args.username.trim()} » créé (${args.role}).`);
  }

  await closeDatabase();
  console.log(`[user] base ${env.db.host}:${env.db.port}/${env.db.database}`);
}

main().catch(async (error) => {
  console.error(`[user] échec: ${error.message}`);
  await closeDatabase().catch(() => {});
  process.exit(1);
});
