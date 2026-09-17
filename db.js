import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Busca un empleado por su número de WhatsApp dentro de una empresa concreta.
// El número de empresa se identifica por el phone_number_id que recibió el mensaje,
// así un mismo backend puede atender a varios clientes (multi-tenant).
export async function buscarEmpleadoPorTelefono(telefono, whatsappNumeroEmpresa) {
  const { rows } = await pool.query(
    `SELECT e.id, e.nombre, e.empresa_id
     FROM empleados e
     JOIN empresas emp ON emp.id = e.empresa_id
     WHERE e.telefono = $1 AND emp.whatsapp_numero = $2 AND e.activo = true`,
    [telefono, whatsappNumeroEmpresa]
  );
  return rows[0] || null;
}

// Inserta un fichaje. Si ya existe un registro con el mismo wamid, no duplica
// (Meta puede reenviar el mismo evento varias veces).
export async function registrarFichaje({ empleadoId, tipo, lat, lng, wamid }) {
  const { rows } = await pool.query(
    `INSERT INTO fichajes (empleado_id, tipo, latitud, longitud, wamid)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wamid) DO NOTHING
     RETURNING id, registrado_en`,
    [empleadoId, tipo, lat ?? null, lng ?? null, wamid ?? null]
  );
  return rows[0] || null;
}

// Último fichaje del empleado, útil para saber qué botones ofrecerle a continuación
// (si ya fichó entrada, no le vuelvas a ofrecer "Entrada").
export async function ultimoFichaje(empleadoId) {
  const { rows } = await pool.query(
    `SELECT tipo, registrado_en FROM fichajes
     WHERE empleado_id = $1
     ORDER BY registrado_en DESC
     LIMIT 1`,
    [empleadoId]
  );
  return rows[0] || null;
}

// --- Funciones para el panel de administración ---

export async function buscarAdminPorEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, empresa_id, email, password_hash FROM administradores WHERE email = $1`,
    [email]
  );
  return rows[0] || null;
}

export async function listarEmpleados(empresaId) {
  const { rows } = await pool.query(
    `SELECT id, nombre, telefono, centro, activo
     FROM empleados WHERE empresa_id = $1 ORDER BY nombre`,
    [empresaId]
  );
  return rows;
}

export async function crearEmpleado({ empresaId, nombre, telefono, centro }) {
  const { rows } = await pool.query(
    `INSERT INTO empleados (empresa_id, nombre, telefono, centro)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [empresaId, nombre, telefono, centro || null]
  );
  return rows[0];
}

export async function desactivarEmpleado(empresaId, empleadoId) {
  await pool.query(
    `UPDATE empleados SET activo = false WHERE id = $1 AND empresa_id = $2`,
    [empleadoId, empresaId]
  );
}

// Fichajes de una empresa en un rango de fechas, con el nombre del empleado.
// desde/hasta son objetos Date; si no se pasan, se usan los últimos 30 días.
export async function listarFichajes(empresaId, { desde, hasta } = {}) {
  const desdeFecha = desde || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const hastaFecha = hasta || new Date();

  const { rows } = await pool.query(
    `SELECT f.id, e.nombre AS empleado, f.tipo, f.registrado_en, f.latitud, f.longitud
     FROM fichajes f
     JOIN empleados e ON e.id = f.empleado_id
     WHERE e.empresa_id = $1
       AND f.registrado_en BETWEEN $2 AND $3
     ORDER BY f.registrado_en DESC`,
    [empresaId, desdeFecha, hastaFecha]
  );
  return rows;
}

// Resumen para el dashboard: cuántos empleados han fichado entrada hoy y cuántos
// llevan más de un turno sin fichar salida (posible olvido).
export async function resumenHoy(empresaId) {
  const { rows } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE f.tipo = 'entrada' AND f.registrado_en::date = current_date) AS entradas_hoy,
       count(DISTINCT e.id) FILTER (WHERE e.activo) AS total_empleados
     FROM empleados e
     LEFT JOIN fichajes f ON f.empleado_id = e.id
     WHERE e.empresa_id = $1`,
    [empresaId]
  );
  return rows[0];
}

// --- Funciones para la facturación con Stripe ---

// Genera un password legible (evita caracteres confusos como 0/O, 1/l/I).
function generarPasswordTemporal() {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let password = "";
  for (let i = 0; i < 12; i++) {
    password += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  }
  return password;
}

// Se llama desde el webhook de Stripe cuando un pago se completa. Crea la
// empresa, un administrador con contraseña provisional, y deja esa
// contraseña guardada para enseñarla UNA sola vez en la pantalla de éxito.
// Devuelve null si ese session_id ya se había procesado antes (Stripe
// reintenta el mismo evento y no queremos duplicar la empresa).
export async function crearEmpresaDesdePago({
  stripeSessionId,
  stripeCustomerId,
  stripeSubscriptionId,
  nombreEmpresa,
  email,
  plan,
  limiteEmpleados,
}) {
  const bcrypt = (await import("bcryptjs")).default;
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");

    const yaExiste = await cliente.query(
      `SELECT id FROM altas_pendientes WHERE stripe_session_id = $1`,
      [stripeSessionId]
    );
    if (yaExiste.rows[0]) {
      await cliente.query("ROLLBACK");
      return null;
    }

    const empresa = await cliente.query(
      `INSERT INTO empresas (nombre, plan, limite_empleados, estado, stripe_customer_id, stripe_subscription_id)
       VALUES ($1, $2, $3, 'activa', $4, $5) RETURNING id`,
      [nombreEmpresa, plan, limiteEmpleados, stripeCustomerId, stripeSubscriptionId]
    );
    const empresaId = empresa.rows[0].id;

    const passwordTemporal = generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 10);
    await cliente.query(
      `INSERT INTO administradores (empresa_id, email, password_hash) VALUES ($1, $2, $3)`,
      [empresaId, email, hash]
    );

    await cliente.query(
      `INSERT INTO altas_pendientes (stripe_session_id, empresa_id, password_temporal)
       VALUES ($1, $2, $3)`,
      [stripeSessionId, empresaId, passwordTemporal]
    );

    await cliente.query("COMMIT");
    return { empresaId };
  } catch (error) {
    await cliente.query("ROLLBACK");
    throw error;
  } finally {
    cliente.release();
  }
}

// La pantalla de éxito llama a esto una sola vez: devuelve la contraseña
// provisional y de inmediato la borra, para que no quede visible para
// siempre si alguien vuelve a abrir ese enlace.
export async function revelarPasswordTemporal(stripeSessionId) {
  const { rows } = await pool.query(
    `WITH antes AS (
       SELECT id, empresa_id, password_temporal AS password
       FROM altas_pendientes
       WHERE stripe_session_id = $1 AND password_temporal IS NOT NULL
     )
     UPDATE altas_pendientes AS a
     SET password_temporal = NULL
     FROM antes, empresas emp, administradores adm
     WHERE a.id = antes.id
       AND antes.empresa_id = emp.id
       AND adm.empresa_id = emp.id
     RETURNING adm.email, antes.password, emp.nombre AS empresa`,
    [stripeSessionId]
  );
  return rows[0] || null;
}

export async function buscarEmpresaPorStripeCustomerId(customerId) {
  const { rows } = await pool.query(
    `SELECT id, plan, limite_empleados, estado FROM empresas WHERE stripe_customer_id = $1`,
    [customerId]
  );
  return rows[0] || null;
}

export async function actualizarEstadoPorSuscripcion(stripeSubscriptionId, estado) {
  await pool.query(
    `UPDATE empresas SET estado = $2 WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId, estado]
  );
}

export async function contarEmpleadosActivos(empresaId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM empleados WHERE empresa_id = $1 AND activo = true`,
    [empresaId]
  );
  return rows[0].total;
}

export async function obtenerLimitePlan(empresaId) {
  const { rows } = await pool.query(
    `SELECT plan, limite_empleados, estado FROM empresas WHERE id = $1`,
    [empresaId]
  );
  return rows[0] || null;
}
