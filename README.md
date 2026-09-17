# Fichaje por WhatsApp — MVP

Registro de entrada, salida y descansos a través de WhatsApp, usando la
Meta Cloud API directamente (sin proveedor intermedio de pago para empezar).

## Puesta en marcha

1. **Crea una app en Meta** en developers.facebook.com, añade el producto
   "WhatsApp" y consigue: `WHATSAPP_TOKEN` (token temporal para pruebas,
   permanente para producción), `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_APP_SECRET`.

2. **Copia el archivo de entorno**
   ```
   cp .env.example .env
   ```
   y rellena los valores. `WHATSAPP_VERIFY_TOKEN` te lo inventas tú (cualquier
   cadena), lo necesitarás en el paso 5.

3. **Instala dependencias y crea la base de datos**
   ```
   npm install
   createdb fichaje
   psql fichaje -f src/schema.sql
   ```

4. **Da de alta tu empresa y un empleado de prueba** (directo en SQL por ahora,
   el panel de administración vendrá después):
   ```sql
   INSERT INTO empresas (nombre, whatsapp_numero) VALUES ('Mi empresa', '34600000000');
   INSERT INTO empleados (empresa_id, nombre, telefono) VALUES (1, 'Marta', '34611111111');
   ```
   El campo `whatsapp_numero` de `empresas` debe coincidir exactamente con el
   número de WhatsApp Business que configuraste en Meta (tal como aparece en
   `display_phone_number` dentro del webhook).

5. **Arranca el servidor y expón el puerto**
   ```
   npm run dev
   ```
   En local necesitas un túnel (ngrok, cloudflared) para que Meta pueda
   alcanzar tu `/webhook`. En Meta, configura la URL del webhook como
   `https://tu-tunel.com/webhook` y el verify token que pusiste en `.env`.
   Suscríbete al campo `messages`.

6. **Prueba**: escribe "hola" desde el número de prueba de Meta al número de
   WhatsApp Business. Deberías recibir el menú con la opción "Entrada".

## Panel de administración

Ya incluido. Corre en el mismo servidor, en `/login`.

1. Crea la empresa y el primer administrador:
   ```
   npm run crear-admin -- correo@empresa.com miContraseña "Nombre de la empresa"
   ```
   Esto imprime el `id` de la empresa. Con ese id, asocia el número de WhatsApp:
   ```sql
   UPDATE empresas SET whatsapp_numero = '34600000000' WHERE id = 1;
   ```

2. Entra en `http://localhost:3000/login` con ese correo y contraseña.

3. Desde el panel puedes:
   - **Resumen**: cuántos empleados han fichado entrada hoy.
   - **Empleados**: dar de alta, ver plantilla, dar de baja (no borra el
     historial, solo desactiva para que no pueda fichar más).
   - **Fichajes**: listado filtrable por fecha, con botón para exportar a
     Excel (`.xlsx`) el rango filtrado.

La sesión dura 8 horas y usa cookies firmadas con `SESSION_SECRET` — cámbialo
por una cadena larga y aleatoria antes de pasar a producción.

## Qué falta para producción

- Verificación de número de negocio permanente (Meta exige revisión de la
  empresa para pasar del modo de pruebas al modo productivo).
- Migrar el token temporal por uno de sistema (permanente) via Business Manager.
- Alta de empleados por CSV en vez de uno a uno.
- Job diario que avise si a un empleado le falta fichar la salida.
- Cobro automático (Stripe) y registro de altas de nuevas empresas sin tocar
  la base de datos a mano.
