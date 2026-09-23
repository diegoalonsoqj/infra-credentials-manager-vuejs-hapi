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

> **No abras 5432.** PostgreSQL solo escucha en la propia VM.

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

```bash
cd /opt/icm
pm2 start deploy/ecosystem.config.cjs
pm2 save

# Arranque automático al reiniciar la VM: imprime un comando con sudo,
# cópialo y ejecútalo tal cual.
pm2 startup systemd

# Rotación de los logs de PM2 (los de la app ya rotan con Winston)
pm2 install pm2-logrotate
```

Comprobaciones:

```bash
pm2 status
pm2 logs icm --lines 50
curl -s http://127.0.0.1:8743/api/health     # "installed": true
```

Y desde una de las IPs autorizadas, abre `http://203.0.113.50:8743`.

---

## 8. Actualizar a una versión nueva

```bash
cd /opt/icm
git pull
(cd frontend && npm ci && npm run build)
(cd backend  && npm ci --omit=dev && npm run migrate -- --dry && npm run migrate)
pm2 reload icm
```

Las migraciones nuevas no se aplican solas al arrancar: por eso `npm run migrate`
va antes del `reload`.

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
