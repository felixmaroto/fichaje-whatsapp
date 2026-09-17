import express from "express";
import {
  stripe,
  PLANES,
  crearSesionPago,
} from "./stripe.js";
import {
  crearEmpresaDesdePago,
  revelarPasswordTemporal,
  buscarEmpresaPorStripeCustomerId,
  actualizarEstadoPorSuscripcion,
} from "./db.js";

export const router = express.Router();

// --- Página pública donde una empresa nueva elige plan y paga ---
router.get("/signup", (req, res) => {
  res.render("signup", { planes: PLANES, error: req.query.error || null });
});

router.post("/signup/checkout", async (req, res) => {
  const { plan, nombreEmpresa, email } = req.body;
  if (!PLANES[plan] || !nombreEmpresa || !email) {
    return res.redirect("/signup?error=Rellena todos los campos.");
  }
  try {
    const urlBase = `${req.protocol}://${req.get("host")}`;
    const sesion = await crearSesionPago({ plan, nombreEmpresa, email, urlBase });
    res.redirect(303, sesion.url);
  } catch (error) {
    console.error("Error creando sesión de pago:", error);
    res.redirect("/signup?error=No se pudo iniciar el pago, inténtalo de nuevo.");
  }
});

// --- Pantalla a la que Stripe redirige tras el pago ---
// El webhook (más abajo) es quien de verdad crea la empresa; esta pantalla
// solo espera un momento a que el webhook haya terminado y enseña la
// contraseña provisional UNA vez.
router.get("/signup/exito", async (req, res) => {
  const sessionId = req.query.session_id;
  if (!sessionId) return res.redirect("/signup");

  // El webhook de Stripe suele llegar en menos de un segundo, pero puede
  // haber una pequeña carrera: reintentamos unas pocas veces antes de rendirnos.
  let datos = null;
  for (let intento = 0; intento < 6 && !datos; intento++) {
    datos = await revelarPasswordTemporal(sessionId);
    if (!datos) await new Promise((r) => setTimeout(r, 1000));
  }

  if (!datos) {
    return res.render("signup-exito", {
      pendiente: true,
      email: null,
      password: null,
      empresa: null,
    });
  }

  res.render("signup-exito", { pendiente: false, ...datos });
});

// --- Webhook: aquí es donde Stripe nos avisa de pagos y cambios de suscripción ---
// Se exporta aparte (no como ruta del router) porque necesita montarse en
// index.js ANTES de express.json(), con el cuerpo todavía sin parsear:
// Stripe firma el cuerpo tal cual llega, byte a byte, para comprobar que el
// mensaje es de verdad suyo y no de alguien haciéndose pasar por Stripe.
export async function manejarWebhookStripe(req, res) {
  let evento;
  try {
    evento = stripe.webhooks.constructEvent(
      req.body,
      req.get("stripe-signature"),
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    console.error("Firma de Stripe inválida:", error.message);
    return res.sendStatus(400);
  }

  // Respondemos ya: Stripe reintenta si no recibe 200 a tiempo, y el resto
  // de este trabajo puede tardar (crear empresa, etc.).
  res.sendStatus(200);

  try {
    switch (evento.type) {
      case "checkout.session.completed": {
        const sesion = evento.data.object;
        const { plan, nombreEmpresa, email } = sesion.metadata;
        const configuracionPlan = PLANES[plan];
        await crearEmpresaDesdePago({
          stripeSessionId: sesion.id,
          stripeCustomerId: sesion.customer,
          stripeSubscriptionId: sesion.subscription,
          nombreEmpresa,
          email,
          plan,
          limiteEmpleados: configuracionPlan.limiteEmpleados,
        });
        break;
      }

      // El pago de un mes falla (tarjeta caducada, sin fondos...): bloqueamos
      // el acceso hasta que se resuelva, pero no borramos nada.
      case "invoice.payment_failed": {
        const factura = evento.data.object;
        const empresa = await buscarEmpresaPorStripeCustomerId(factura.customer);
        if (empresa) await actualizarEstadoPorSuscripcion(factura.subscription, "pago_pendiente");
        break;
      }

      case "invoice.payment_succeeded": {
        const factura = evento.data.object;
        if (factura.subscription) {
          await actualizarEstadoPorSuscripcion(factura.subscription, "activa");
        }
        break;
      }

      // El cliente cancela desde el propio portal de Stripe.
      case "customer.subscription.deleted": {
        const suscripcion = evento.data.object;
        await actualizarEstadoPorSuscripcion(suscripcion.id, "cancelada");
        break;
      }
    }
  } catch (error) {
    console.error("Error procesando evento de Stripe:", evento.type, error);
  }
}
