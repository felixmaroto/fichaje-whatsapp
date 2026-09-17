-- Esquema mínimo multi-tenant para el MVP.
-- Una fila en "empresas" por cada cliente que contrate el servicio.

CREATE TABLE IF NOT EXISTS empresas (
  id                   SERIAL PRIMARY KEY,
  nombre               TEXT NOT NULL,
  whatsapp_numero      TEXT UNIQUE, -- número de WhatsApp asociado a esa empresa
  plan                 TEXT NOT NULL DEFAULT 'starter',
  limite_empleados     INTEGER NOT NULL DEFAULT 10,
  estado               TEXT NOT NULL DEFAULT 'incompleta'
                         CHECK (estado IN ('incompleta','activa','pago_pendiente','cancelada')),
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  creada_en            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Se crea en cuanto alguien completa el pago en Stripe pero antes de que
-- entre por primera vez al panel a poner su propia contraseña definitiva.
-- password_temporal se borra en cuanto se muestra una vez (ver src/billing.js).
CREATE TABLE IF NOT EXISTS altas_pendientes (
  id                  SERIAL PRIMARY KEY,
  stripe_session_id   TEXT UNIQUE NOT NULL,
  empresa_id          INTEGER REFERENCES empresas(id),
  password_temporal   TEXT,
  creada_en           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Una persona con acceso al panel de administración de una empresa.
CREATE TABLE IF NOT EXISTS administradores (
  id             SERIAL PRIMARY KEY,
  empresa_id     INTEGER NOT NULL REFERENCES empresas(id),
  email          TEXT UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS empleados (
  id           SERIAL PRIMARY KEY,
  empresa_id   INTEGER NOT NULL REFERENCES empresas(id),
  nombre       TEXT NOT NULL,
  telefono     TEXT NOT NULL, -- formato E.164, ej. 34600123456
  centro       TEXT,
  activo       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (empresa_id, telefono)
);

CREATE TABLE IF NOT EXISTS fichajes (
  id            SERIAL PRIMARY KEY,
  empleado_id   INTEGER NOT NULL REFERENCES empleados(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada','salida','descanso_inicio','descanso_fin')),
  registrado_en TIMESTAMPTZ NOT NULL DEFAULT now(), -- siempre timestamp del servidor
  latitud       DOUBLE PRECISION,
  longitud      DOUBLE PRECISION,
  origen        TEXT NOT NULL DEFAULT 'whatsapp',
  wamid         TEXT -- id del mensaje de WhatsApp, para evitar duplicados
);

-- Evita procesar el mismo evento de WhatsApp dos veces (reintentos de Meta)
CREATE UNIQUE INDEX IF NOT EXISTS fichajes_wamid_idx ON fichajes(wamid) WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS fichajes_empleado_fecha_idx ON fichajes(empleado_id, registrado_en);
