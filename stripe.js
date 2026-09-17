import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Un único sitio donde viven los tres planes. Los price_id son los que
// creas tú a mano en el panel de Stripe (Paso 2 de la guía) y pegas aquí
// vía variables de entorno.
export const PLANES = {
  starter: {
    nombre: "Starter",
    precioMensual: 24,
    limiteEmpleados: 10,
    stripePriceId: process.env.STRIPE_PRICE_STARTER,
  },
  growth: {
    nombre: "Growth",
    precioMensual: 59,
    limiteEmpleados: 30,
    stripePriceId: process.env.STRIPE_PRICE_GROWTH,
  },
  business: {
    nombre: "Business",
    precioMensual: 119,
    limiteEmpleados: 100,
    stripePriceId: process.env.STRIPE_PRICE_BUSINESS,
  },
};

// Crea la sesión de pago de Stripe. El nombre de la empresa y el correo del
// futuro administrador viajan como "metadata": Stripe no hace nada con ellos,
// simplemente nos los devuelve intactos en el webhook cuando el pago se
// complete, y así sabemos qué empresa y qué admin crear.
export async function crearSesionPago({ plan, nombreEmpresa, email, urlBase }) {
  const configuracionPlan = PLANES[plan];
  if (!configuracionPlan) throw new Error(`Plan desconocido: ${plan}`);

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    line_items: [{ price: configuracionPlan.stripePriceId, quantity: 1 }],
    metadata: { plan, nombreEmpresa, email },
    success_url: `${urlBase}/signup/exito?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${urlBase}/signup`,
  });
}
