import "dotenv/config";
import express from "express";
import session from "express-session";
import crypto from "crypto";
import {
  buscarEmpleadoPorTelefono,
  registrarFichaje,
  ultimoFichaje,
  obtenerLimitePlan,
} from "./db.js";
import { enviarMenuFichaje, confirmarFichaje, avisarNoRegistrado, avisarServicioSuspendido } from "./whatsapp.js";
import { router as adminRouter } from "./admin.js";
import { router as billingRouter, manejarWebhookStripe } from "./billing.js";

const app = express();

app.set("view engine", "ejs");
app.set("views", new URL("../views", import.meta.url).pathname);
app.use(express.static(new URL("../public", import.meta.url).pathname));

// El webhook de Stripe necesita el cuerpo SIN tocar para poder comprobar su
// firma, así que se monta con express.raw() ANTES del parser general de
// JSON de más abajo (que si corriera primero, ya habría consumido y
// transformado el cuerpo y la firma dejaría de coincidir).
app.post("/webhook/stripe", express.raw({ type: "application/json" }), manejarWebhookStripe);

// Guardamos el cuerpo sin parsear (solo hace falta en /webhook, el de
// WhatsApp) para poder verificar su firma, y parseamos formularios normales
// para el panel y la página de alta.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "cambia-esto-en-produccion",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 horas
  })
);

app.use(adminRouter);
app.use(billingRouter);

// --- 1. Verificación del webhook (Meta la llama una vez al configurar la URL) ---
app.get("/webhook", (req, res) => {
  const modo = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- 2. Verificación de firma de cada petición entrante ---
function firmaValida(req) {
  const firmaRecibida = req.get("x-hub-signature-256");
  if (!firmaRecibida || !req.rawBody) return false;

  const firmaEsperada =
    "sha256=" +
    crypto
      .createHmac("sha256", process.env.WHATSAPP_APP_SECRET)
      .update(req.rawBody)
      .digest("hex");

  // Comparación en tiempo constante para evitar timing attacks.
  return crypto.timingSafeEqual(Buffer.from(firmaRecibida), Buffer.from(firmaEsperada));
}

// Determina qué botones ofrecer según el último fichaje del empleado.
function siguientesOpciones(ultimoTipo) {
  const secuencia = {
    null: ["entrada"],
    entrada: ["descanso_inicio", "salida"],
    descanso_inicio: ["descanso_fin"],
    descanso_fin: ["descanso_inicio", "salida"],
    salida: ["entrada"],
  };
  return secuencia[ultimoTipo ?? "null"] ?? ["entrada"];
}

// --- 3. Recepción de eventos (mensajes y pulsaciones de botón) ---
app.post("/webhook", async (req, res) => {
  // Respondemos 200 enseguida: Meta reintenta si no recibe OK rápido.
  res.sendStatus(200);

  if (!firmaValida(req)) {
    console.warn("Firma inválida, evento descartado");
    return;
  }

  try {
    const cambio = req.body.entry?.[0]?.changes?.[0]?.value;
    const mensaje = cambio?.messages?.[0];
    if (!mensaje) return; // puede ser un evento de estado (entregado/leído), lo ignoramos

    const whatsappNumeroEmpresa = cambio.metadata?.display_phone_number;
    const telefono = mensaje.from;
    const wamid = mensaje.id;

    const empleado = await buscarEmpleadoPorTelefono(telefono, whatsappNumeroEmpresa);
    if (!empleado) {
      await avisarNoRegistrado(telefono);
      return;
    }

    const empresa = await obtenerLimitePlan(empleado.empresa_id);
    if (empresa?.estado !== "activa") {
      await avisarServicioSuspendido(telefono);
      return;
    }

    // El empleado pulsó una opción de la lista interactiva
    const seleccion = mensaje.interactive?.list_reply?.id;

    if (seleccion) {
      const registro = await registrarFichaje({
        empleadoId: empleado.id,
        tipo: seleccion,
        wamid,
      });
      if (registro) {
        const hora = new Intl.DateTimeFormat("es-ES", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Madrid",
        }).format(registro.registrado_en);
        await confirmarFichaje(telefono, seleccion, hora);
      }
      return;
    }

    // Cualquier otro mensaje de texto: le mandamos el menú con las opciones válidas
    const ultimo = await ultimoFichaje(empleado.id);
    await enviarMenuFichaje(telefono, siguientesOpciones(ultimo?.tipo));
  } catch (error) {
    console.error("Error procesando el webhook:", error);
  }
});

const puerto = process.env.PORT || 3000;
app.listen(puerto, () => console.log(`Servidor escuchando en el puerto ${puerto}`));
