const API_BASE = "https://graph.facebook.com/v20.0";

async function enviarMensaje(payload) {
  const url = `${API_BASE}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const detalle = await res.text();
    throw new Error(`Error enviando mensaje de WhatsApp: ${res.status} ${detalle}`);
  }
  return res.json();
}

// Menú con los cuatro botones de fichaje. WhatsApp solo permite 3 botones por
// mensaje de tipo "button", así que para 4 opciones se usa una lista interactiva.
export function enviarMenuFichaje(telefono, opcionesDisponibles) {
  const etiquetas = {
    entrada: "🟢 Entrada",
    salida: "🔴 Salida",
    descanso_inicio: "☕ Descanso",
    descanso_fin: "↩️ Vuelta",
  };

  return enviarMensaje({
    messaging_product: "whatsapp",
    to: telefono,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "¿Qué quieres registrar?" },
      action: {
        button: "Elegir",
        sections: [
          {
            title: "Fichaje",
            rows: opcionesDisponibles.map((tipo) => ({
              id: tipo,
              title: etiquetas[tipo],
            })),
          },
        ],
      },
    },
  });
}

export function confirmarFichaje(telefono, tipo, fechaHora) {
  const etiquetas = {
    entrada: "Entrada registrada",
    salida: "Salida registrada",
    descanso_inicio: "Descanso iniciado",
    descanso_fin: "Vuelta al trabajo registrada",
  };
  return enviarMensaje({
    messaging_product: "whatsapp",
    to: telefono,
    type: "text",
    text: { body: `${etiquetas[tipo]} · ${fechaHora}` },
  });
}

export function avisarNoRegistrado(telefono) {
  return enviarMensaje({
    messaging_product: "whatsapp",
    to: telefono,
    type: "text",
    text: {
      body: "No encuentro tu número en el sistema. Pide a tu responsable que te dé de alta.",
    },
  });
}

export function avisarServicioSuspendido(telefono) {
  return enviarMensaje({
    messaging_product: "whatsapp",
    to: telefono,
    type: "text",
    text: {
      body: "El fichaje de tu empresa está pausado temporalmente. Avisa a tu responsable.",
    },
  });
}
