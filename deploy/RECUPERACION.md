# Copia de seguridad y recuperación

Procedimiento **probado de principio a fin**: copia de `icm_db`, restauración en una base nueva y la
aplicación arrancando contra ella hasta descifrar una credencial.

---

## Lo primero: hacen falta DOS cosas, y se guardan por separado

| Qué | Dónde vive | Sin ella |
|---|---|---|
| **El volcado de la base** | `pg_dump` | No hay datos. |
| **La `MASTER_KEY`** del `.env` | Solo en el `.env` del servidor | El volcado es **papel mojado**: las credenciales no se pueden descifrar. Comprobado: con otra clave, PostgreSQL responde `Wrong key or corrupt data`. |

Guardar las dos en el mismo sitio anula el cifrado: quien robe la copia se lo lleva todo. Guardar
solo el volcado, en cambio, es perderlo todo el día que falle el servidor. **La Master Key va a un
gestor de secretos o a un sobre físico, en otro lugar que las copias.**

El `JWT_SECRET` no hace falta para recuperar: si cambia, solo se cierran las sesiones abiertas.

---

## Copia de seguridad: `npm run backup`

```bash
cd backend
npm run backup                → copia comprimida + retención
npm run backup -- --dry       → dice qué haría, sin escribir ni borrar
npm run backup -- --list      → las copias que hay y cuáles borraría la próxima vez
npm run backup -- --verify    → además la restaura en una base temporal y comprueba que descifra
```

Cada ejecución deja dos ficheros en `BACKUP_DIR`: el volcado `icm-AAAA-MM-DD_HHMM.sql.gz` (permisos
`0600`) y un `.meta.json` con los recuentos, el SHA-256 y **el hash de la Master Key activa**, que
es lo que permite saber *cuál* de tus claves abre esa copia si ha habido una rotación de por medio.

Lo que el script hace por ti:

- **Comprueba las versiones antes de copiar** y se niega si el `pg_dump` no es de la misma versión
  mayor que el servidor (trampa R1). Es la diferencia entre enterarse hoy o el día de la emergencia.
  Con `--force` la hace igualmente y, para que siga siendo restaurable, quita del volcado los
  ajustes de cabecera que el servidor de origen no reconoce; queda anotado en el `.meta.json`.
- **Retención abuelo-padre-hijo**: conserva las 7 últimas diarias, 4 semanales y 12 mensuales
  (`BACKUP_KEEP_DAILY`, `_WEEKLY`, `_MONTHLY`). Si algo va mal y solo queda una copia, no la borra.
- **Nunca deja un fichero a medias**: escribe con extensión `.parcial` y solo lo renombra al acabar
  bien, para que un corte de luz no deje una copia truncada con pinta de buena. Si el volcado falla, el
  parcial se borra; los que dejaran ejecuciones anteriores se barren al empezar la copia siguiente.
- **Protege el directorio**: por defecto escribe en `icm-backups/`, **fuera del repositorio**, y al
  crearlo le quita los permisos heredados (`icacls` en Windows, `chmod 0700` en el resto). En Windows
  eso es lo único que protege de verdad los volcados: el `0600` de los ficheros **no se aplica**.
- **No deja bases de verificación sueltas**: `--verify` borra su base temporal aunque la interrumpas
  con Ctrl-C, y al empezar barre las que quedaran de ejecuciones anteriores.

El volcado **no contiene la Master Key ni ninguna contraseña en claro** —comprobado buscándolas
dentro del fichero—, pero sí los hashes de contraseña de los usuarios y las credenciales cifradas:
trátalo como material sensible, con acceso restringido y, a ser posible, en un disco cifrado y
**fuera del servidor de la base**. `backups/`, `*.sql.gz` y `*.dump` están en el `.gitignore`.

Tamaño de referencia: 39 KB comprimido (299 KB en claro) con 10 usuarios, 11 credenciales y 1148
registros de auditoría, en 0,4 s. Lo que crecerá con el tiempo es la auditoría.

Guarda además copia del `.env` (sin él hay que reconstruir la configuración a mano), **en otro sitio
que las copias**, porque lleva la `MASTER_KEY`.

---

## Programar la copia

### Linux (cron)

`npm run backup` no necesita que la aplicación esté corriendo, y puede ejecutarse en el servidor de
la aplicación o en cualquier máquina con acceso a la base y una copia del `.env`.

```cron
# Copia diaria a las 03:15; la salida queda en el log para poder revisarla.
15 3 * * *  cd /opt/icm/backend && /usr/bin/npm run --silent backup >> /var/log/icm-backup.log 2>&1

# Una vez por semana, además, se verifica restaurando de verdad (domingo 04:00).
0 4 * * 0   cd /opt/icm/backend && BACKUP_ADMIN_USER=postgres BACKUP_ADMIN_PASSWORD='...' /usr/bin/npm run --silent backup -- --verify >> /var/log/icm-backup.log 2>&1
```

Sale con código distinto de 0 si algo falla, así que cron manda el aviso por correo si está
configurado. Revisa ese log: una copia que falla en silencio es peor que no tenerla.

### Windows (Programador de tareas)

```powershell
$accion = New-ScheduledTaskAction -Execute "cmd.exe" `
  -Argument "/c cd /d C:\DEVS\icm\backend && npm run --silent backup >> C:\logs\icm-backup.log 2>&1"
$disparador = New-ScheduledTaskTrigger -Daily -At 3:15am
Register-ScheduledTask -TaskName "ICM copia de seguridad" -Action $accion -Trigger $disparador `
  -User "SYSTEM" -RunLevel Highest
```

Comprueba después que la tarea aparece en el Programador y **ejecútala a mano una vez**: casi todos
los fallos son de ruta o de permisos y se ven en el primer intento.

### Y lo que no automatiza el script

Llevarse las copias **fuera de la máquina** (otro servidor, almacenamiento de objetos, cinta). Una
copia en el mismo disco que la base no protege del incendio, del cifrado por ransomware ni del
borrado accidental del volumen. Eso depende de tu infraestructura: `rsync`, `rclone`, la herramienta
de copias corporativa o la que uses.

---

## Restauración

```bash
# 1. El rol de la aplicación DEBE existir: el volcado no lo crea.
psql -h <host> -U postgres -c "CREATE ROLE icm_user LOGIN PASSWORD '<la contraseña>';"

# 2. Base nueva, propiedad del rol de la aplicación.
createdb -h <host> -U postgres -O icm_user icm_db

# 3. Restaurar CONECTADO COMO icm_user, no como postgres (trampa R2).
psql -h <host> -U icm_user -d icm_db -v ON_ERROR_STOP=1 -f icm-2026-09-19.sql

# 4. El .env con la MASTER_KEY original, y arrancar.
npm start
```

`pgcrypto` y `uuid-ossp` viajan dentro del volcado: no hay que instalarlas aparte, y `icm_user` puede
crearlas porque en PostgreSQL 13+ son extensiones *trusted* y es el dueño de la base.

---

## Comprobar que la recuperación es buena

No des por buena una copia que no has restaurado. Las cuatro comprobaciones, de la más barata a la
más completa:

1. **La clave es la correcta**, antes incluso de arrancar: el SHA-256 de tu `MASTER_KEY` tiene que
   coincidir con el `key_hash` de la fila **activa** (`is_active = true`) de
   `sch_secret.tbl_master_config`. Ojo: si hubo una rotación, esa tabla guarda varias filas y solo
   una es la buena.
   ```sql
   SELECT key_alias, is_active, key_hash FROM sch_secret.tbl_master_config;
   ```
2. **Los recuentos cuadran** con el origen: usuarios, credenciales, auditoría, ajustes, servidores.
3. **Una credencial se descifra por SQL**:
   ```sql
   SELECT pgp_sym_decrypt(password_encrypted::bytea, '<MASTER_KEY>'::text)
     FROM sch_secret.tbl_credentials WHERE estado_registro = 'O' LIMIT 1;
   ```
4. **La aplicación entra y descifra**: iniciar sesión y revelar una credencial desde la interfaz.
   Es la única prueba que cubre también permisos, sesiones y auditoría.

---

## Las dos trampas que aparecieron en el ensayo

### R1 — Herramientas de una versión distinta a la del servidor

`pg_dump` 18 escribe en la cabecera `SET transaction_timeout = 0;`, que un servidor **16** no
reconoce. La restauración **aborta en la línea 13** con `ON_ERROR_STOP=1`, antes de crear nada:

```
ERROR: parámetro de configuración «transaction_timeout» no reconocido
```

Es un fallo que aparece **el día de la emergencia**, no el día de la copia. Evítalo usando el
`pg_dump` de la misma versión mayor que el servidor. Si ya te ha pasado y solo tienes ese volcado,
se puede quitar esa línea (`grep -v '^SET transaction_timeout'`) y restaura entero sin más errores
—probado—, pero es un parche, no el procedimiento.

### R2 — Restaurar como `postgres` deja la aplicación sin acceso

Restaurando el volcado conectado como `postgres`, las tablas quedan **propiedad de `postgres`**
aunque la base sea de `icm_user`. La restauración no da ningún error y los datos están todos ahí,
pero el rol de la aplicación no puede leer ni una fila, y la aplicación no arranca. Comprobado en
el ensayo. La solución es la del paso 3: **restaurar conectado como `icm_user`**.

Si ya restauraste como `postgres`, se arregla sin repetir la copia:

```sql
REASSIGN OWNED BY postgres TO icm_user;   -- ejecutado en la base restaurada
```

---

## Qué falta por decidir

- **Programar la tarea** en el servidor que toque (arriba están las dos formas) y **mirar el log la
  primera semana**.
- **Sacar las copias de la máquina**: el script las escribe, no las transporta.
- **Dónde se custodia la Master Key** y quién puede recuperarla; si se pierde, las credenciales son
  irrecuperables y no hay atajo.
- **Verificar de vez en cuando con `--verify`**, no solo confiar en que el fichero existe. Una copia
  que nunca se ha restaurado no es una copia.
