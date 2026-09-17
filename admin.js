import express from "express";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import {
  buscarAdminPorEmail,
  listarEmpleados,
  crearEmpleado,
  desactivarEmpleado,
  listarFichajes,
  resumenHoy,
  obtenerLimitePlan,
  contarEmpleadosActivos,
} from "./db.js";

export const router = express.Router();

// --- Middleware: exige haber iniciado sesión para todo lo que empiece por /admin ---
function exigirSesion(req, res, next) {
  if (!req.session.empresaId) return res.redirect("/login");
  next();
}

// --- Login ---
router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const admin = await buscarAdminPorEmail(email);

  const contraseñaValida = admin && (await bcrypt.compare(password, admin.password_hash));
  if (!contraseñaValida) {
    return res.render("login", { error: "Correo o contraseña incorrectos." });
  }

  const empresa = await obtenerLimitePlan(admin.empresa_id);
  if (empresa?.estado === "cancelada") {
    return res.render("login", {
      error: "Vuestra suscripción está cancelada. Contacta con soporte para reactivarla.",
    });
  }

  req.session.empresaId = admin.empresa_id;
  req.session.adminEmail = admin.email;
  res.redirect("/admin");
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// --- Panel principal ---
router.get("/admin", exigirSesion, async (req, res) => {
  const empresaId = req.session.empresaId;
  const [resumen, fichajesRecientes, empresa] = await Promise.all([
    resumenHoy(empresaId),
    listarFichajes(empresaId, {}).then((f) => f.slice(0, 10)),
    obtenerLimitePlan(empresaId),
  ]);
  res.render("dashboard", { resumen, fichajesRecientes, empresa });
});

// --- Empleados ---
router.get("/admin/empleados", exigirSesion, async (req, res) => {
  const empleados = await listarEmpleados(req.session.empresaId);
  res.render("empleados", { empleados, error: null });
});

router.post("/admin/empleados", exigirSesion, async (req, res) => {
  const { nombre, telefono, centro } = req.body;
  const empresaId = req.session.empresaId;
  try {
    const [plan, totalActual] = await Promise.all([
      obtenerLimitePlan(empresaId),
      contarEmpleadosActivos(empresaId),
    ]);
    if (totalActual >= plan.limite_empleados) {
      const empleados = await listarEmpleados(empresaId);
      return res.render("empleados", {
        empleados,
        error: `Has llegado al límite de ${plan.limite_empleados} empleados de tu plan ${plan.plan}. Amplía tu plan para añadir más.`,
      });
    }
    await crearEmpleado({ empresaId, nombre, telefono, centro });
    res.redirect("/admin/empleados");
  } catch (error) {
    const empleados = await listarEmpleados(empresaId);
    const mensaje = error.code === "23505"
      ? "Ese teléfono ya está dado de alta."
      : "No se pudo añadir el empleado.";
    res.render("empleados", { empleados, error: mensaje });
  }
});

router.post("/admin/empleados/:id/desactivar", exigirSesion, async (req, res) => {
  await desactivarEmpleado(req.session.empresaId, req.params.id);
  res.redirect("/admin/empleados");
});

// --- Fichajes ---
function rangoFechas(req) {
  const hoy = new Date();
  const hace30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const desde = req.query.desde ? new Date(req.query.desde) : hace30;
  const hasta = req.query.hasta ? new Date(req.query.hasta + "T23:59:59") : hoy;
  return { desde, hasta };
}

router.get("/admin/fichajes", exigirSesion, async (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const fichajes = await listarFichajes(req.session.empresaId, { desde, hasta });
  res.render("fichajes", {
    fichajes,
    desde: desde.toISOString().slice(0, 10),
    hasta: hasta.toISOString().slice(0, 10),
  });
});

router.get("/admin/fichajes/exportar", exigirSesion, async (req, res) => {
  const { desde, hasta } = rangoFechas(req);
  const fichajes = await listarFichajes(req.session.empresaId, { desde, hasta });

  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet("Fichajes");
  hoja.columns = [
    { header: "Empleado", key: "empleado", width: 28 },
    { header: "Tipo", key: "tipo", width: 18 },
    { header: "Fecha y hora", key: "fecha", width: 22 },
    { header: "Latitud", key: "lat", width: 12 },
    { header: "Longitud", key: "lng", width: 12 },
  ];
  fichajes.forEach((f) => {
    hoja.addRow({
      empleado: f.empleado,
      tipo: f.tipo.replace("_", " "),
      fecha: new Date(f.registrado_en).toLocaleString("es-ES", { timeZone: "Europe/Madrid" }),
      lat: f.latitud,
      lng: f.longitud,
    });
  });
  hoja.getRow(1).font = { bold: true };

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader("Content-Disposition", "attachment; filename=fichajes.xlsx");
  await libro.xlsx.write(res);
  res.end();
});
