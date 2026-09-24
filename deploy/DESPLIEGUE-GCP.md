# Despliegue en Google Compute Engine con PM2

Guía para desplegar Infra Credentials Manager en una VM de Compute Engine, con
PostgreSQL en la misma máquina y el backend gestionado por PM2. Por ahora **no
hay nginx delante**: se accede directamente por la IP de la VM y el puerto 8743,
donde el backend sirve la API y la SPA compilada.

```
Navegador ──http://IP:8743──▶ node (PM2) ──▶ 127.0.0.1:5432 PostgreSQL
```

Archivos de este directorio que intervienen:

| Archivo | Para qué |
|---|---|
| [`ecosystem.config.cjs`](./ecosystem.config.cjs) | Definición del proceso PM2 |
| [`RECUPERACION.md`](./RECUPERACION.md) | Copias de seguridad y restauración |
| [`nginx-icm.conf`](./nginx-icm.conf) | Solo para cuando se pase a HTTPS (ver el final) |

> **Rutas, puerto e IPs de ejemplo.** La guía instala en `/opt/icm`, usa el
> puerto `8743` y las IPs de documentación `203.0.113.x`. Si tu instalación usa
> otra ruta (p. ej. `/APPS/infra-credentials-manager-vuejs-hapi`) u otro puerto
> (`APP_PORT` en `backend/.env`), sustitúyelos en todos los comandos.

---

## ⚠️ Antes de empezar: esto es HTTP sin cifrar

Sin TLS, la contraseña del login, la cookie de sesión y **cada credencial que se
descifra** viajan en claro entre el navegador y la VM. Mientras siga así:

- **Limita el puerto 8743 a las IPs de origen que lo necesitan** (la de la
  oficina, la de la VPN). Nunca `0.0.0.0/0`.
- Trátalo como un despliegue provisional y pasa a HTTPS en cuanto haya dominio
  (ver [Pasar a HTTPS más adelante](#pasar-a-https-más-adelante)).

---

## Por qué el `ecosystem.config.cjs` es como es

- **`cwd` en `backend/`.** dotenv busca el `.env` en el directorio de trabajo, y
  `LOG_DIR=./logs` también es relativo. Si el proceso arranca en otro sitio, no
  carga la configuración.
- **Una sola instancia en modo `fork`, nunca `cluster`.** El rate limiting y los
  tokens de MFA ya usados viven en memoria del proceso. Con varios workers, cada
  uno llevaría su propia cuenta y los límites se multiplicarían.
- **`kill_signal: 'SIGTERM'` y `kill_timeout: 15000`.** `src/app.js` solo hace
  el apagado ordenado con SIGTERM (`server.stop` con 10 s de margen y cierre del
  pool). PM2 manda SIGINT por defecto y mata el proceso a los 1,6 s, así que sin
  esto cada `reload` cortaría peticiones en curso.
- **`watch: false`.** El wizard y la rotación de claves reescriben
  `backend/.env`. Con watch activado, PM2 reiniciaría el proceso en mitad de la
  operación.
- **Sin secretos.** El ecosystem solo fija `NODE_ENV`. Todo lo demás se lee de
  `backend/.env`.

---

## 1. Crear la VM, la IP estática y el firewall

Desde una máquina con `gcloud` autenticado:

```bash
# IP externa estática: CORS_ORIGIN la lleva dentro y no debe cambiar al reiniciar
gcloud compute addresses create icm-ip --region=us-central1
gcloud compute addresses describe icm-ip --region=us-central1 --format='value(address)'

gcloud compute instances create icm-vm \
  --zone=us-central1-a --machine-type=e2-small \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB --tags=icm-app \
  --address=icm-ip

# Solo desde las IPs autorizadas (separadas por comas)
gcloud compute firewall-rules create icm-allow-app \
  --allow=tcp:8743 --target-tags=icm-app \
  --source-ranges=203.0.113.10/32
```

> **No abras 5432 hacia fuera.** Con la base en la propia VM, PostgreSQL solo
> escucha en local. Si está en otro servidor, ver
> [La base de datos en otro servidor](#la-base-de-datos-en-otro-servidor).

Ubuntu 24.04 trae PostgreSQL 16 en sus repositorios, que es la versión verificada
(ver el README). Usa la misma versión mayor en la máquina que haga las copias.

---

## 2. Instalar dependencias del sistema

```bash
gcloud compute ssh icm-vm

curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs postgresql git
sudo npm install -g pm2

node -v    # debe ser >= 24
psql -V    # debe ser 16.x
```

---

## 3. Crear la base de datos

```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE icm_db;
CREATE USER icm_user WITH PASSWORD 'una-contraseña-larga-y-aleatoria';
GRANT ALL PRIVILEGES ON DATABASE icm_db TO icm_user;
ALTER DATABASE icm_db OWNER TO icm_user;
SQL
```

Genera la contraseña para este entorno (`openssl rand -base64 32`); no reutilices
la de desarrollo. El wizard la pedirá en el paso 6.

### La base de datos en otro servidor

Si PostgreSQL no está en la VM de la aplicación, en el paso 2 instala solo el
cliente (`sudo apt-get install -y postgresql-client-16`, para `psql` y las copias
de seguridad) y prepara el servidor de la base:

1. **Crear la base y el usuario** con el SQL de arriba, en ese servidor.
2. **Permitir conexiones de un número razonable.** Si el rol se creó con
   `CONNECTION LIMIT 0` (o por plantilla del DBA), no podrá conectarse nunca y
   el wizard dará el error `53300`. La aplicación usa hasta `DB_POOL_MAX=10`
   conexiones, más una o dos de `migrate` y `backup`:
   ```sql
   SELECT rolname, rolconnlimit FROM pg_roles WHERE rolname = 'icm_user';
   ALTER ROLE icm_user CONNECTION LIMIT 20;
   ```
3. **Escuchar en la red**: en `postgresql.conf`, `listen_addresses` debe incluir
   la IP privada del servidor (no solo `localhost`). Requiere reiniciar PostgreSQL.
4. **Autorizar la IP de la VM** en `pg_hba.conf`:
   ```
   host  icm_db  icm_user  10.0.0.5/32  scram-sha-256
   ```
   y recargar: `SELECT pg_reload_conf();`
5. **Firewall**: abre `tcp:5432` hacia el servidor de la base **solo desde la IP
   privada de la VM** de la aplicación.

Comprobación desde la VM de la aplicación:

```bash
psql "host=IP_DE_LA_BASE port=5432 dbname=icm_db user=icm_user" -c 'select 1'
```

En el wizard (paso 6), el host es la IP del servidor de la base. Si falla, el
wizard muestra el motivo, y el log del backend una línea
`testConnection failed {"code":"..."}` con el código de PostgreSQL.

---

## 4. Subir el código y compilar

```bash
sudo mkdir -p /opt/icm && sudo chown "$USER": /opt/icm
git clone <url-del-repositorio> /opt/icm
# Sin remoto: desde tu máquina, gcloud compute scp --recurse . icm-vm:/opt/icm
#            (sin node_modules/, dist/ ni .env)

cd /opt/icm/frontend && npm ci && npm run build     # genera frontend/dist
cd /opt/icm/backend  && npm ci --omit=dev
```

`frontend/dist` no se versiona: hay que compilarlo en la VM tras cada cambio del
frontend.

---

## 5. Configurar `backend/.env`

```bash
cd /opt/icm/backend
cp .env.example .env
chmod 600 .env
```

Ajusta estas claves (con la IP estática del paso 1):

```dotenv
NODE_ENV=production
APP_HOST=0.0.0.0
APP_PORT=8743
TRUST_PROXY=0
HTTPS_ENABLED=false
CORS_ORIGIN=http://203.0.113.50:8743
SETUP_COMPLETED=false
```

Por qué esos valores:

- **`APP_HOST=0.0.0.0`**: sin proxy delante, el backend tiene que escuchar en la
  interfaz de red de la VM. Quien puede llegar lo decide la regla de firewall.
- **`TRUST_PROXY=0`**: no hay proxy, así que la IP del cliente es la de la
  conexión. Con otro valor, cualquiera podría falsear su IP con la cabecera
  `X-Forwarded-For` y esquivar el rate limiting o ensuciar la auditoría.
- **`HTTPS_ENABLED=false`**: con `true`, la cookie de sesión se marca `Secure` y
  el navegador no la reenvía por HTTP: el login funciona y la siguiente petición
  da 401.
- **`CORS_ORIGIN`**: la URL exacta con la que se abre la aplicación.

Los datos de conexión a la base, `JWT_SECRET` y `MASTER_KEY` los escribe el
wizard. Genera la Master Key antes de empezar y guárdala en tu gestor de secretos
**fuera de esta VM**:

```bash
openssl rand -base64 64
```

> ⚠️ Si pierdes la `MASTER_KEY`, las credenciales cifradas no se pueden
> recuperar.

---

## 6. Primer arranque: el wizard, en primer plano

```bash
cd /opt/icm/backend
node src/app.js
```

Copia el **SETUP TOKEN** que se imprime, abre `http://203.0.113.50:8743` y
completa el wizard. Al terminar, `.env` queda con `SETUP_COMPLETED=true` y se
crea `backend/.installed`. Detén el proceso con Ctrl+C.

> **Por qué no con PM2.** El token se imprime solo en stdout para que no quede en
> ningún archivo de log, pero PM2 guarda stdout en `~/.pm2/logs/icm-out.log`. Si
> aun así haces el wizard con PM2, ejecuta `pm2 flush icm` al terminar.

---

## 7. Arrancar con PM2

**Antes:** asegúrate de que no queda el `node src/app.js` del paso 6 en marcha
(Ctrl+C en su terminal). Si sigue ahí, el puerto está ocupado y PM2 entrará en
bucle de reinicios con `EADDRINUSE` en los logs.

```bash
cd /opt/icm
pm2 start deploy/ecosystem.config.cjs
pm2 status                                   # "icm" debe aparecer "online"
pm2 logs icm --lines 50                      # Ctrl+C para salir
curl -s http://127.0.0.1:8743/api/health     # "installed": true
```

El ecosystem arranca el proceso dentro de `backend/`, así que toma el
`backend/.env` (puerto incluido) sin más.

### Arranque automático con el sistema

```bash
# Guarda la lista de procesos que PM2 restaurará al arrancar.
pm2 save

# Crea y activa un servicio systemd (pm2-<usuario>). Si imprime un comando que
# empieza por "sudo env PATH=...", cópialo y ejecútalo tal cual.
pm2 startup systemd

systemctl is-enabled pm2-$USER               # debe decir "enabled"

# Rotación de los logs de PM2 (los de la app ya rotan con Winston)
pm2 install pm2-logrotate
```

> **`pm2 save` después de cualquier cambio en la lista de procesos** (añadir,
> borrar o renombrar). El arranque automático restaura la última lista
> guardada, no la que esté en marcha.

Comprueba que de verdad arranca solo reiniciando la VM cuando sea posible:

```bash
sudo reboot
# al volver a entrar:
pm2 status
curl -s http://127.0.0.1:8743/api/health
```

Y desde una de las IPs autorizadas, abre `http://203.0.113.50:8743`.

---

## 8. Actualizar a una versión nueva

Resumen:

```bash
cd /opt/icm
npm --prefix backend run backup                  # 1. copia antes de tocar la base
git pull                                         # 2. código nuevo
(cd backend  && npm ci --omit=dev)               # 3. dependencias
(cd backend  && npm run migrate -- --dry)        # 4. qué migraciones faltan
(cd backend  && npm run migrate)                 # 5. aplicarlas
(cd frontend && npm ci && npm run build)         # 6. frontend
pm2 reload icm                                   # 7. reiniciar el backend
curl -s http://127.0.0.1:8743/api/health         # 8. comprobar
```

Si el cambio es solo del frontend, basta con `npm run build`: el backend sirve
`frontend/dist` desde disco y no hace falta reiniciarlo (recarga el navegador con
Ctrl+F5).

### Migraciones de base de datos

Las migraciones (`database/migrations/NNN_*.sql`) **no se aplican solas al
arrancar**: el wizard las ejecuta una única vez al instalar, y a partir de ahí
cada versión nueva que traiga migraciones exige `npm run migrate`. Si se
reinicia el backend sin aplicarlas, las pantallas que usan las tablas nuevas
fallan.

> **Todos los `npm run` de este apartado se ejecutan dentro de `backend/`**, donde
> está su `package.json`. Desde la raíz del repositorio fallan con
> `ENOENT: no such file or directory, open '.../package.json'`.

**1. Copia de seguridad antes de migrar.** No hay "deshacer" de una migración: la
vuelta atrás es restaurar la copia (ver [`RECUPERACION.md`](./RECUPERACION.md)).

```bash
cd /opt/icm/backend
npm run backup
npm run backup -- --list        # comprueba que la copia de hoy aparece
```

**2. Ver qué falta, sin tocar nada:**

```bash
cd /opt/icm/backend
npm run migrate -- --dry
```

```
Migraciones aplicadas: 17
Pendientes (3):
    - 018_ldap_auth.sql
    - 019_network_devices.sql
    - 020_team_audit.sql

(--dry: no se aplicó nada)
```

**3. Aplicar:**

```bash
cd /opt/icm/backend
npm run migrate
```

Todas las pendientes se aplican **en una sola transacción**: si una falla, no se
aplica ninguna y la base queda como estaba. Cada archivo aplicado queda registrado
en `sch_system.tbl_migrations` con su checksum; volver a ejecutar el comando no
repite nada (`✓ No hay migraciones pendientes.`).

**4. Reiniciar y comprobar:**

```bash
pm2 reload icm
pm2 logs icm --lines 30
cd /opt/icm/backend && npm run migrate -- --dry   # debe decir: No hay migraciones pendientes
```

El orden importa: **primero migrar, después reiniciar**. El código nuevo cuenta
con las tablas nuevas; el antiguo sigue funcionando con ellas mientras tanto, así
que migrar con la aplicación en marcha no la interrumpe.

### Errores habituales al migrar

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| `INTEGRIDAD: estos archivos cambiaron después de aplicarse` | Un `.sql` ya aplicado fue editado en el servidor | No lo "arregles" editándolo: `git status` y `git checkout -- database/migrations/` para volver a la versión del repositorio |
| `ENOENT ... open '.../package.json'` | Se ejecutó `npm run` fuera de `backend/` | `cd /opt/icm/backend` y repetir |
| `No existe sch_system.tbl_migrations` | El sistema no está instalado | Completa primero el wizard (paso 6) |
| `permission denied` / `must be owner of table` | El usuario de `DB_USER` no es dueño de las tablas | Aplícalo con el dueño, o ejecuta en la base `ALTER DATABASE icm_db OWNER TO icm_user;` y reasigna las tablas |
| `password authentication failed` (28P01) | `DB_PASSWORD` del `.env` no es la correcta | Revísala; si lleva `#`, va entre comillas simples (`DB_PASSWORD='...'`) |
| Cualquier otro error | La transacción se deshizo: la base no cambió | Revisa el mensaje, corrígelo y vuelve a ejecutar `npm run migrate` |

> ⚠️ **Nunca apliques un `.sql` a mano con `psql`.** El registro de
> `tbl_migrations` no se actualizaría, y la siguiente ejecución intentaría
> aplicarlo de nuevo. Una migración ya aplicada tampoco se edita: el cambio va en
> una migración nueva.

### Qué trae cada migración reciente

| Migración | Qué añade | Después de aplicarla |
|---|---|---|
| `018_ldap_auth.sql` | Autenticación con Active Directory / LDAP: origen de contraseña por usuario y ajustes `ldap_*` | Configurar la conexión en *Configuración → Directorio* (pide tu contraseña y segundo factor), probar y activar `ldap_enabled` |
| `019_network_devices.sql` | Tipo de recurso NET: dispositivos de red, catálogo de productos de red y equipo NETOPS | Dar de alta dispositivos en *Recursos → Networking* y asignar el equipo NETOPS a quien corresponda. Si ya existía un equipo llamado NETOPS, la migración **no** le da acceso a NET: asígnalo desde *Catálogos → Equipos* si procede |
| `020_team_audit.sql` | Rol **LEADER** (Líder de equipo) y permiso `AUDIT_TEAM`: auditoría de los recursos de su equipo | Asignar el rol LEADER a los líderes en *Usuarios*. Un líder de varias áreas (p. ej. redes y sysadmin) va en un equipo con esos tipos (OS + NET) |
| `021_supervisor_role.sql` | Rol **SUPERVISOR** (Supervisor de equipo): auditoría e inventario de su equipo, sin acceso a credenciales | Asignarlo, con su equipo, a los líderes que supervisan pero no deben ver ni crear credenciales |

---

## 9. Copias de seguridad

Sigue [`RECUPERACION.md`](./RECUPERACION.md) para programar `npm run backup` en
cron. En GCP, lo razonable es sacar las copias de la VM a un bucket de Cloud
Storage con retención, en un proyecto o cuenta distinta a la que guarda la
`MASTER_KEY`: juntas en el mismo sitio, el cifrado no protege de nada.

Las instantáneas de disco de Compute Engine no sustituyen a `npm run backup`:
copian la base en caliente y, además, llevan dentro el `.env` con la
`MASTER_KEY`.

---

## Pasar a HTTPS más adelante

Cuando haya un dominio apuntando a la IP estática:

1. Instala nginx y certbot, y configura [`nginx-icm.conf`](./nginx-icm.conf)
   con el dominio.
2. Cambia en `backend/.env`:
   ```dotenv
   APP_HOST=127.0.0.1
   TRUST_PROXY=1
   HTTPS_ENABLED=true
   CORS_ORIGIN=https://icm.tu-dominio.com
   ```
3. `pm2 reload icm`.
4. Sustituye la regla `icm-allow-app` (8743) por una de 80/443, y borra la del
   8743: con `APP_HOST=127.0.0.1` ya no se llega a ese puerto desde fuera, y así
   no queda una regla abierta sin uso.

Los cuatro valores del paso 2 van juntos. Mezclarlos rompe el login
(`HTTPS_ENABLED`) o hace que todos los usuarios compartan la IP 127.0.0.1 en el
rate limiting y la auditoría (`TRUST_PROXY`). Los detalles están en
[`.env.production.example`](./.env.production.example).

---

## Referencia rápida de PM2

| Comando | Qué hace |
|---|---|
| `pm2 status` | Estado, reinicios, memoria |
| `pm2 logs icm` | Salida en vivo (los logs de la app están en `backend/logs/`) |
| `pm2 reload icm` | Reinicio ordenado (SIGTERM, 15 s de margen) |
| `pm2 restart icm` | Reinicio completo |
| `pm2 stop icm` | Detener |
| `pm2 flush icm` | Vaciar los logs de PM2 |
| `pm2 save` | Guardar la lista de procesos para el arranque automático |
