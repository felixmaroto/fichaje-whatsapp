// Uso: node src/crear-admin.js correo@empresa.com miContraseña "Nombre Empresa"
// Crea (o reutiliza) la empresa y da de alta un administrador que podrá
// entrar al panel en /login.

import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const [, , email, password, nombreEmpresa] = process.argv;

if (!email || !password || !nombreEmpresa) {
  console.log('Uso: node src/crear-admin.js correo@empresa.com contraseña "Nombre Empresa"');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 10);

const empresa = await pool.query(
  `INSERT INTO empresas (nombre) VALUES ($1) RETURNING id`,
  [nombreEmpresa]
);
const empresaId = empresa.rows[0].id;

await pool.query(
  `INSERT INTO administradores (empresa_id, email, password_hash) VALUES ($1, $2, $3)`,
  [empresaId, email, hash]
);

console.log(`Empresa "${nombreEmpresa}" creada con id ${empresaId}.`);
console.log(`Administrador ${email} creado. Ya puedes entrar en /login.`);
console.log(`Recuerda: aún debes poner el número de WhatsApp de esta empresa`);
console.log(`con: UPDATE empresas SET whatsapp_numero = '34XXXXXXXXX' WHERE id = ${empresaId};`);

await pool.end();
