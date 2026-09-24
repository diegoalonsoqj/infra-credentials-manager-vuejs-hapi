# Infra Credentials Manager (ICM)

Gestor seguro de credenciales de infraestructura (bases de datos, servidores y
aplicaciones). Las contraseñas se almacenan **cifradas** con `pgcrypto` y solo se
descifran bajo control de acceso por roles y equipos.

- **Frontend:** Vue 3 + Vite + CoreUI + Pinia + Vue Router
- **Backend:** Node.js (≥ 24) + hapi 21 + Joi + PostgreSQL 16
- **Seguridad:** JWT en cookie HttpOnly, bcrypt (factor 14), cabeceras de seguridad
  HTTP, rate limiting, cifrado con Master Key + `pgcrypto`, auditoría completa.

> **Despliegue:** este proyecto corre en **bare-metal** (Node + PostgreSQL
> instalados en el host). No usa Docker.

---

## Tabla de contenidos

1. [Requisitos](#requisitos)
2. [Estructura del proyecto](#estructura-del-proyecto)
3. [Configuración (`.env`)](#configuración-env)
4. [Modo desarrollo](#modo-desarrollo)
5. [Modo producción](#modo-producción)
6. [Primera instalación (wizard)](#primera-instalación-wizard)
7. [Resetear la contraseña de admin](#resetear-la-contraseña-de-admin)
8. [Segundo factor (MFA)](#segundo-factor-mfa)
9. [Active Directory / LDAP](#active-directory--ldap)
10. [Ajustes desde el panel](#ajustes-desde-el-panel)
11. [Tareas de mantenimiento](#tareas-de-mantenimiento)
12. [Roles y permisos](#roles-y-permisos)
13. [Endpoints de la API](#endpoints-de-la-api)
14. [Seguridad y mantenimiento](#seguridad-y-mantenimiento)

---

## Requisitos

| Software | Versión | Notas |
|---|---|---|
| Node.js | ≥ 24.0.0 | Definido en `backend/package.json` (`engines`) |
| PostgreSQL | 16 o superior | Con `pgcrypto` disponible. **Verificado en 16.8**; ver la nota de abajo |
| npm | 10+ | Incluido con Node |

Antes de arrancar, crea la base de datos y el usuario en PostgreSQL. El nombre de
la base y el del usuario deben coincidir con `DB_NAME` y `DB_USER` de tu
`backend/.env` (los valores de abajo son los de `.env.example`):

```sql
CREATE DATABASE icm_db;
CREATE USER icm_user WITH PASSWORD '...';
GRANT ALL PRIVILEGES ON DATABASE icm_db TO icm_user;
```

> `GRANT ALL PRIVILEGES ON DATABASE` basta: las extensiones `pgcrypto` y
> `uuid-ossp` que crea la primera migración son *trusted* desde PostgreSQL 13,
> así que `icm_user` puede instalarlas sin ser superusuario.

> Las tablas, índices y datos base los crea automáticamente el **wizard de
> instalación** (migraciones + seeds) en el primer arranque.

### Sobre la versión de PostgreSQL

El esquema y las consultas no usan **nada** posterior a PostgreSQL 13: extensiones
`pgcrypto` y `uuid-ossp` (*trusted* desde la 13), `pgp_sym_encrypt/decrypt`,
`FOR UPDATE`/`FOR SHARE`, `lock_timeout`, `ON CONFLICT` y `RETURNING`. Ni `MERGE`,
ni `NULLS NOT DISTINCT`, ni columnas generadas, ni particiones. Por funcionalidad
debería correr de la 13 en adelante, pero **solo está verificada contra 16.8**:
los tests usan mocks, no una base real de otra versión.

**Usa la misma versión mayor en desarrollo y en producción**, y también en las
**herramientas de cliente** (`pg_dump`, `psql`) de la máquina que haga las copias.
No es un capricho: un volcado se restaura en un servidor igual o más nuevo, nunca
en uno más antiguo, así que un `pg_dump` 18 produce copias que un servidor 16 no
puede restaurar. `npm run backup` lo comprueba y se niega a copiar si no casan;
el detalle está en [`deploy/RECUPERACION.md`](./deploy/RECUPERACION.md) (trampa R1).

---

## Estructura del proyecto

```
infra-credentials-manager-vuejs/
├── backend/                 # API hapi
│   ├── src/
│   │   ├── app.js           # Entrada del proceso (arranque y apagado)
│   │   ├── server.js        # Servidor hapi: plugins y rutas
│   │   ├── config/          # database, cors, constants, rateLimits
│   │   ├── controllers/
│   │   ├── plugins/         # auth, rbac, cors, rate limit, entrada estricta,
│   │   │                    #   guard de MFA, cabeceras, errores
│   │   ├── repositories/    # acceso a datos (SQL parametrizado)
│   │   ├── routes/          # /api/*
│   │   ├── services/        # lógica de negocio
│   │   ├── setup/           # wizard de instalación, migraciones, estado
│   │   ├── utils/           # logger (Winston), IP del cliente, cripto, TOTP
│   │   └── validation/      # esquemas y formato de errores (Joi)
│   ├── scripts/             # backup, migrate, archive-audit, reset-mfa,
│   │                        #   reset-admin-password
│   ├── .env                 # configuración real (NO commitear)
│   └── .env.example
├── frontend/                # SPA Vue 3
│   ├── src/                 # api, components, pages, router, store
│   ├── dist/                # build de producción (generado)
│   └── vite.config.js
├── database/
│   ├── migrations/          # 001..021_*.sql (se aplican con npm run migrate)
│   └── seeds/               # 001_base_data.sql (roles, equipos, catálogos)
├── deploy/
│   ├── nginx-icm.conf       # proxy inverso de ejemplo
    └── RECUPERACION.md      # copias de seguridad y recuperación
```

---

## Configuración (`.env`)

Toda la configuración del backend vive en `backend/.env` (copia de
`backend/.env.example`). Variables clave:

| Variable | Descripción | Dev | Producción |
|---|---|---|---|
| `NODE_ENV` | Modo de ejecución | `development` | `production` |
| `APP_PORT` | Puerto del backend | `8743` | `8743` |
| `APP_HOST` | Interfaz de escucha | `0.0.0.0` | `0.0.0.0` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Conexión PostgreSQL | local | local |
| `JWT_SECRET` | Secreto JWT (≥ 64 chars aleatorios) | — | — |
| `MASTER_KEY` | Clave maestra de cifrado (≥ 32 chars) | — | — |
| `CORS_ORIGIN` | Origen permitido | `http://localhost:5173` | URL real (mismo puerto / dominio) |
| `TRUST_PROXY` | Saltos de proxy delante | `0` (acceso directo) | `0` directo · `1` tras proxy/TLS |
| `HTTPS_ENABLED` | Hay TLS delante | `false` | `true` solo con certificado |
| `SETUP_COMPLETED` | Marca de instalación | `false` (primer arranque) | `true` (ya instalado) |

**Generar secretos:**
```bash
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# MASTER_KEY
openssl rand -base64 64
```

> ⚠️ Si pierdes la `MASTER_KEY`, **no hay forma de recuperar** las credenciales
> cifradas. Guárdala en un gestor de secretos externo (KeePass, Vault, etc.), y
> **no en el mismo sitio que las copias de seguridad**: juntas, el cifrado deja
> de proteger. Ver [`deploy/RECUPERACION.md`](./deploy/RECUPERACION.md).

La tabla recoge lo que hay que tocar sí o sí. El `.env.example` documenta además,
con sus valores por defecto: los **límites de peticiones** (`RATE_LIMIT_*`, que
el panel muestra en solo lectura), el **pool y los tiempos máximos de consulta**
(`DB_POOL_*`, `DB_STATEMENT_TIMEOUT_MS`), el **TLS contra la base** (`DB_SSL*`),
los **logs** (`LOG_*`) y las **copias de seguridad** (`BACKUP_*`).

Los ajustes que sí cambian a diario —duración de sesión, bloqueo de cuenta,
política de segundo factor— **no están aquí**: se administran desde el panel
(ver [Ajustes desde el panel](#ajustes-desde-el-panel)).

---

## Modo desarrollo

Dos procesos en dos terminales. El frontend (Vite) hace proxy de `/api` →
backend, así no hay problemas de CORS.

**Terminal 1 — Backend** (con recarga automática vía nodemon):
```powershell
cd backend
npm install
npm run dev          # nodemon src/app.js  →  http://localhost:8743
```

**Terminal 2 — Frontend** (Vite dev server):
```powershell
cd frontend
npm install
npm run dev          # vite  →  http://localhost:5173
```

Accede a **http://localhost:5173**.

`.env` recomendado para dev: `NODE_ENV=development`, `CORS_ORIGIN=http://localhost:5173`,
`TRUST_PROXY=0`.

---

## Modo producción

En producción **el backend sirve el frontend compilado** (`@hapi/inert` sobre
`frontend/dist`). Todo corre en **un solo puerto (8743)** — no se necesita nginx
ni mantener el frontend como proceso vivo.

**1. Compilar el frontend:**
```powershell
cd frontend
npm install
npm run build        # genera frontend/dist
```

**2. Ajustar `backend/.env`:** `NODE_ENV=production`, `CORS_ORIGIN` a la URL real
(p. ej. `http://localhost:8743` o tu dominio), `TRUST_PROXY` y `HTTPS_ENABLED`
según haya o no un proxy/TLS delante.

**3. Arrancar el backend** (solo dependencias de producción):
```powershell
cd backend
npm ci --omit=dev    # instala sin herramientas de test/dev
npm start            # node src/app.js
```

Accede a **http://localhost:8743** (SPA + API en el mismo origen).

> Tras cualquier cambio en el código del frontend hay que **recompilar**
> (`npm run build`) para que se refleje.

**Con TLS o cara a internet.** Para nada de esto hace falta nginx, pero si vas a
publicarla necesitas **HTTPS**, y la forma habitual es un proxy inverso delante:
[`deploy/nginx-icm.conf`](./deploy/nginx-icm.conf) es un ejemplo listo para
adaptar. Con proxy delante hay que poner `TRUST_PROXY=1` y `HTTPS_ENABLED=true`,
o las cabeceras de seguridad y la IP registrada en la auditoría serán incorrectas.

**En Google Compute Engine con PM2:** ver
[`deploy/DESPLIEGUE-GCP.md`](./deploy/DESPLIEGUE-GCP.md).

> Antes de exponerla a internet: base de datos accesible solo desde el servidor
> de la aplicación, contraseña de PostgreSQL propia y robusta, Master Key
> custodiada fuera de ese servidor y, a ser posible, una VPN por delante.

---

## Primera instalación (wizard)

Si `SETUP_COMPLETED=false` y no existe el flag `.installed`, el sistema arranca en
modo **wizard**: al iniciar el backend imprime en consola (solo en stdout, no en
logs) un **SETUP TOKEN**:

```
══════════════════════════════════════════════════════════════════════
  SETUP TOKEN (solo visible aquí — no queda en logs)
  <token>
══════════════════════════════════════════════════════════════════════
```

Abre el frontend y completa el wizard con ese token. El wizard:

1. Valida la conexión a PostgreSQL.
2. Ejecuta las **migraciones** (`database/migrations/*.sql`).
3. Carga los **seeds** (roles, equipos y catálogos base).
4. Registra el hash de la `MASTER_KEY`.
5. Crea el **usuario administrador**.
6. Escribe la configuración en `.env` y marca el sistema como instalado.

### Migraciones posteriores a la instalación

El wizard ejecuta las migraciones **una sola vez**. Nada las vuelve a ejecutar al
arrancar, así que una migración añadida después de instalar no llega sola a la
base de datos. Para aplicarla:

```powershell
cd backend
npm run migrate -- --dry   # informa de lo pendiente, sin tocar nada
npm run migrate            # aplica lo que falte
```

Usa el mismo runner que el wizard, de modo que cada archivo queda registrado en
`sch_system.tbl_migrations` con su checksum.

> ⚠️ **No apliques el SQL a mano.** El runner verifica que ninguna migración ya
> aplicada haya cambiado de contenido y aborta si detecta una diferencia. Una
> migración ya aplicada **nunca se edita**: se crea una nueva.

---

## Resetear la contraseña de admin

Si olvidaste la contraseña del admin (no es recuperable: bcrypt es de una vía),
usa el script incluido. Genera el hash con el mismo factor (14) y **desbloquea**
la cuenta.

```powershell
cd backend

# 1) Listar usuarios ADMIN disponibles
node scripts/reset-admin-password.js

# 2) Resetear: pide la contraseña por consola y no la muestra
node scripts/reset-admin-password.js <username>
```

La contraseña debe cumplir los mismos requisitos que exige la aplicación (mínimo
12 caracteres, con mayúscula, minúscula, número y símbolo), y el usuario tendrá
que cambiarla en su primer inicio de sesión.

> ⚠️ **No pases la contraseña como argumento.** En Windows queda en la lista de
> procesos y en el historial de PowerShell, que PSReadLine guarda en texto plano
> en `ConsoleHost_history.txt`. Se sigue admitiendo por compatibilidad, pero el
> script te avisa. Para automatizar, pásala por tubería:
>
> ```powershell
> "MiNuevaClave#2026" | node scripts/reset-admin-password.js <username>
> ```

Requiere que PostgreSQL esté accesible (usa las credenciales de `backend/.env`).

---

## Segundo factor (MFA)

Códigos TOTP estándar (RFC 6238): sirve **Aegis**, Google Authenticator,
Microsoft Authenticator, Bitwarden o cualquier aplicación equivalente. No hay que
instalar nada en el servidor ni contratar ningún servicio.

**Quién está obligado** lo decide el ajuste `mfa_policy` desde *Configuración*:

| Valor | Efecto |
|---|---|
| `none` | Voluntario: cada usuario decide desde su perfil. |
| `admins` | Obligatorio para los ADMIN. |
| `all` | Obligatorio para todos. **Es el valor por defecto.** |

Quien está obligado y no lo ha activado puede entrar, pero la aplicación solo le
deja ir a su perfil hasta que lo active (`403 MFA_ENROLLMENT_REQUIRED`); tampoco
puede desactivarlo después.

**Activarlo** (*Perfil → Segundo factor → Activar*): se muestra un QR y la clave
en texto por si prefieres escribirla a mano. Al confirmar con un código aparecen
**10 códigos de recuperación de un solo uso**, que se muestran **una única vez**
—en la base solo queda su SHA-256—. Guárdalos donde guardes las contraseñas: son
la única forma de entrar si pierdes el móvil.

**Después**, el login pasa a ser de dos pasos: contraseña y código. Un código
incorrecto cuenta para el bloqueo de cuenta, igual que una contraseña.

**Si un usuario pierde el móvil y se queda fuera:**

```bash
# Un ADMIN puede hacerlo desde la propia aplicación (Usuarios → Restablecer MFA),
# lo que además cierra las sesiones de ese usuario.

# Y si quien se queda fuera es el ÚNICO ADMIN, desde el servidor:
cd backend
npm run reset-mfa -- <username>
```

`reset-mfa` borra el secreto, los códigos de recuperación y las sesiones de ese
usuario, que volverá a activarlo en su siguiente acceso.

> El secreto TOTP se guarda **cifrado con la Master Key**, igual que las
> credenciales, y la rotación de claves lo re-cifra. Una copia de seguridad sin
> la Master Key tampoco revela los segundos factores.

---

## Active Directory / LDAP

Los usuarios pueden entrar con su **contraseña de dominio**. El directorio solo
comprueba la contraseña: **nadie se da de alta solo al iniciar sesión**. Un
ADMIN crea al usuario en *Usuarios* con origen **LDAP**, su username de dominio,
su rol y su equipo.

**1. Configurar la conexión** en *Configuración → Directorio*:

| Campo | Ejemplo |
|---|---|
| Servidor | `ldaps://ad.empresa.local:636` o `ldap://ad.empresa.local` |
| Formato del usuario | `EMPRESA\{username}` o `{username}@empresa.local` |
| StartTLS, validar certificado, CA (PEM) | Cifrado, si el servidor lo admite |

El cifrado es opcional, pero recomendable: sin `ldaps://` ni StartTLS, el bind
envía la contraseña de dominio en claro por la red, y el panel lo avisa.

Guardar la conexión **pide tu contraseña y el código del segundo factor**, y cada
intento, correcto o no, queda en la auditoría (`LDAP_CONFIG_UPDATE`) con el valor
anterior y el nuevo. Es a propósito: quien controla la URL del directorio recibe
las contraseñas de dominio de quien inicia sesión, y una sesión de administrador
robada no debe bastar para cambiarla. Hace falta tener el segundo factor activado.

**2. Probar y activar**: la misma tarjeta hace un bind de prueba con un usuario
del dominio y los valores del formulario, sin guardarlos. Después se activa el
ajuste `ldap_enabled` de *Seguridad*.

**Qué cambia para un usuario LDAP:**

- No tiene contraseña en ICM: no puede cambiarla desde su perfil ni un ADMIN
  puede resetearla. Se gestiona en el directorio.
- El segundo factor, el bloqueo de cuenta, los límites de peticiones y la
  auditoría se aplican igual. Con la cuenta bloqueada en ICM no se consulta al
  directorio, para no bloquear también su cuenta de dominio.
- Si el directorio no responde, el login devuelve 503 y no cuenta como intento
  fallido.

**Siempre queda al menos un ADMIN con contraseña local**: la aplicación impide
desactivar, eliminar, degradar o pasar a LDAP al último. Es la forma de entrar si
el directorio cae. Si aun así hiciera falta, `node scripts/reset-admin-password.js
<usuario>` le pone una contraseña local, aunque fuera LDAP.

---

## Ajustes desde el panel

*Configuración* (solo ADMIN) guarda estos valores en la base, no en el `.env`, y
se aplican sin reiniciar. Fuera de rango, el backend cae a su valor por defecto:

| Ajuste | Por defecto | Rango | Qué hace |
|---|---|---|---|
| `mfa_policy` | `all` | `none`, `admins`, `all` | Quién está obligado a usar segundo factor. |
| `session_ttl_minutes` | 480 (8 h) | 1 – 43200 | Cuánto dura una sesión como máximo. |
| `session_idle_minutes` | 30 | 0 – 1440 | Cierra la sesión tras ese tiempo **sin actividad**. `0` la desactiva. |
| `session_max_concurrent` | 3 | 1 – 100 | Sesiones simultáneas por usuario; al superarlo se cierra la más antigua. |
| `account_lockout_attempts` | 5 | 3 – 20 | Intentos fallidos antes de bloquear la cuenta. |
| `account_lockout_minutes` | 15 | 1 – 1440 | Cuánto dura ese bloqueo. |
| `password_min_length` | 12 | 12 – 128 | Longitud mínima. El suelo de 12 lo fija el código: el ajuste solo puede endurecerlo. |
| `decrypt_timeout_secs` | 30 | 5 – 300 | Cuánto se muestra en pantalla una contraseña descifrada. |
| `audit_retention_days` | 365 | 1 – 3650 | Días que la auditoría permanece en la tabla activa (ver `archive-audit`). |
| `allow_visitor_access` | `true` | sí/no | Permite entrar a los usuarios VISITOR. |
| `ldap_enabled` | `false` | sí/no | Deja entrar a los usuarios LDAP con su contraseña de dominio (ver [Active Directory / LDAP](#active-directory--ldap)). |
| `cors_origin` | — | texto | Orígenes permitidos; se escribe también en el `.env`. |
| `app_name`, `locale`, `timezone` | — | texto | Nombre visible, idioma y zona horaria. |

Los **límites de peticiones** (rate limiting) se muestran en esa misma pantalla
**en solo lectura**: viven en el `.env` a propósito. Son protecciones de
infraestructura, y una sesión de administrador robada no debe poder relajarlas.

---

## Tareas de mantenimiento

Todas desde `backend/`, sin necesidad de parar la aplicación:

```bash
npm run backup             # copia de seguridad (ver más abajo)
npm run archive-audit      # mueve la auditoría vencida al histórico
npm run migrate            # aplica migraciones pendientes
npm run reset-mfa -- <usuario>   # quita el segundo factor a un usuario
npm run lint               # ESLint sobre src/ y scripts/
```

`archive-audit` respeta `audit_retention_days` y **archiva, no borra**: traslada
las filas vencidas a `sch_audit.tbl_audit_log_historico`, porque en un gestor de
credenciales el rastro de quién descifró qué es la única prueba de lo ocurrido.
Es idempotente y está pensado para cron.

---

## Roles y permisos

- **ADMIN** (nivel 100): acceso total al sistema.
- **LEADER** — Líder de equipo (nivel 70): lo mismo que un operador y, además,
  la **auditoría de los recursos de su equipo**: ve los eventos sobre los tipos
  de recurso de su equipo, los haga quien los haga, y sus propios eventos. Un
  líder cuyo equipo tiene OS y NET ve todo lo de servidores y red, pero nada de
  bases de datos ni los inicios de sesión de otros. Lo da el permiso
  `AUDIT_TEAM`, que también puede asignarse a otro rol desde *Catálogos → Roles*.
- **SUPERVISOR** — Supervisor de equipo (nivel 60): la misma auditoría de su
  equipo y el inventario de recursos, pero **sin acceso a credenciales**: no las
  lista, no las crea ni las descifra, y no puede ser custodio. Para líderes que
  supervisan sin operar.
- **VISITOR** (nivel 0): sin acceso a credenciales; solo el Generador de Contraseñas.
- Usuarios con **equipo asignado**:
  - **DBA**: acceso a credenciales de bases de datos.
  - **SYSADMIN**: acceso a credenciales de servidores.
  - **APPOPS**: acceso a credenciales de aplicaciones.
  - **NETOPS**: acceso a credenciales de dispositivos de red (routers, switches,
    firewalls…), en el menú *Recursos → Networking*.

El control de acceso es multinivel: nivel de rol + permisos + alcance por equipo.

---

## Endpoints de la API

Todos bajo `/api` (rate limiting global; límite estricto en `/api/auth`):

| Prefijo | Propósito |
|---|---|
| `/api/setup` | Wizard de instalación (solo si no instalado) |
| `/api/auth` | Login (dos pasos si hay segundo factor), logout, usuario actual y sesiones activas |
| `/api/credentials` | CRUD y descifrado de credenciales |
| `/api/resources` | Servidores y servicios de BD |
| `/api/applications` | Aplicaciones |
| `/api/network-devices` | Dispositivos de red |
| `/api/catalogs` | Catálogos base |
| `/api/dashboard` | Métricas y resumen |
| `/api/audit` | Registro de auditoría |
| `/api/admin` | Gestión de usuarios (ADMIN), incluido restablecer su segundo factor |
| `/api/profile` | Perfil del usuario actual: contraseña, sesiones y segundo factor |
| `/api/security` | Operaciones de seguridad (rotación de claves, etc.) |
| `/api/system` | Estado y configuración del sistema |

---

## Seguridad y mantenimiento

- **SQL** 100 % parametrizado; sin concatenación de strings.
- **Contraseñas** con bcrypt factor 14; **credenciales** cifradas con `pgcrypto` +
  Master Key (AES-256), y el cifrado ocurre **en PostgreSQL**: la clave nunca se
  interpola en el SQL.
- **Segundo factor TOTP** compatible con Aegis y equivalentes, con política
  configurable ([Segundo factor](#segundo-factor-mfa)).
- **JWT** en cookie `HttpOnly` + `Secure` + `SameSite=strict`, validado contra sesión en BD.
  Las sesiones caducan por tiempo **y por inactividad**, y hay un tope de sesiones
  simultáneas por usuario.
- **Bloqueo de cuenta** tras N intentos fallidos, configurable desde el panel.
- **Límites de peticiones** en tres capas: por IP, por usuario autenticado y
  específicos para login, segundo factor y descifrado.
- **Esquema de entrada estricto**: lo que no está declarado se rechaza con 400,
  en el cuerpo y en la query (`src/plugins/strictInput.js`).
- **Cabeceras de seguridad HTTP** (CSP, HSTS, X-Frame-Options, `Cache-Control:
  no-store` en `/api`…) aplicadas a todas las respuestas por
  `src/plugins/securityHeaders.js`.
- **Auditoría** de todo acceso a credenciales: el descifrado registra de forma
  bloqueante —si no se puede registrar, no se entrega la contraseña—.
- **Logs** con Winston (rotación diaria) y campos sensibles redactados.

### Vulnerabilidades de `npm audit`

`npm audit` reporta avisos en su mayoría de **devDependencies** (nodemon, eslint…)
que **no se ejecutan en producción**. Para producción instala con
`npm ci --omit=dev`.

- **No** ejecutes `npm audit fix --force`: introduce cambios mayores que pueden
  romper la app.
- **Producción no tiene alertas** (`npm audit --omit=dev` → 0 vulnerabilidades).
  La única que había venía de `uuid`, un paquete que no se importaba en ningún
  archivo —los UUID los genera PostgreSQL con `gen_random_uuid()`— y que se
  eliminó de las dependencias.

### Copia de seguridad y recuperación

```bash
npm run backup             # copia comprimida + retención (7 diarias, 4 semanales, 12 mensuales)
npm run backup -- --list   # copias existentes y cuáles borraría la próxima ejecución
npm run backup -- --verify # además la restaura en una base temporal y comprueba que descifra
```

Ver [`deploy/RECUPERACION.md`](./deploy/RECUPERACION.md): cómo programarla en
cron o en el Programador de tareas, cómo restaurar y cómo comprobar que la copia
sirve. Procedimiento probado de principio a fin (copia → restauración → la
aplicación descifrando).

**Recuerda que hacen falta dos cosas y se guardan por separado: el volcado de la
base y la `MASTER_KEY`.** Sin la clave, el volcado no se puede descifrar; juntas
en el mismo sitio, el cifrado no protege de nada.
