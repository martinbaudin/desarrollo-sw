# Explicación Completa del Proyecto JWT vs Macaroons

## **1. ARQUITECTURA GENERAL DEL PROYECTO**

El proyecto es una **comparación práctica entre dos sistemas de autenticación/autorización**:
- **JWT API** (puerto 3001) - Sistema tradicional
- **Macaroons API** (puerto 3002) - Sistema con delegación de permisos
- **Frontend único** (`index.html`) - Interfaz interactiva que consume ambas APIs

---

## **2. ARCHIVOS DE CONFIGURACIÓN**

### **package.json**
```json
"scripts": {
  "build": "tsc",                      // Compila TypeScript a JavaScript
  "start:jwt": "ts-node src/jwt-api.ts",     // Ejecuta JWT API sin compilar
  "start:macaroon": "node src/macaroon-api.js"  // Ejecuta Macaroons API
}
```

**Dependencias clave:**
- `express`: Framework web para crear las APIs
- `jsonwebtoken`: Librería para crear/verificar JWT
- `macaroons.js`: Implementación de Macaroons
- `typescript` + `ts-node`: Para ejecutar TypeScript directamente

### **tsconfig.json**
Configuración de TypeScript:
- `target: ES2020`: Compila a JavaScript moderno
- `module: commonjs`: Sistema de módulos compatible con Node.js
- `strict: true`: Máxima validación de tipos
- `rootDir: src` → `outDir: dist`: Organización de archivos

### **start-demo.sh**
Script Bash que ejecuta **ambos servidores en paralelo**:
```bash
npm run start:jwt & npm run start:macaroon & wait
```
- `&` ejecuta cada comando en background
- `wait` espera a que ambos terminen (útil para Ctrl+C)

---

## **3. JWT API (jwt-api.ts) - ANÁLISIS PROFUNDO**

### **3.1 Configuración Inicial**
```typescript
const validUsers = [
  { username: "martin", password: "pass123", role: "admin" },
  { username: "alvaro", password: "pass123", role: "admin" },
  { username: "gaston", password: "pass123", role: "user" }
];
```
**Base de datos en memoria** - En producción sería una DB real con passwords hasheadas.

```typescript
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";
```
**Clave secreta** para firmar JWT. El `||` es un fallback si no hay variable de entorno.

### **3.2 Middleware CORS**
```typescript
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");  // Permite cualquier origen
  res.header("Access-Control-Allow-Headers", "...");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {  // Preflight request
    return res.sendStatus(200);
  }
  next();
});
```
**¿Por qué?** El navegador bloquea peticiones entre diferentes orígenes (ej: `file://` a `http://localhost`). CORS permite estas peticiones.

**OPTIONS request:** El navegador hace una petición previa para verificar permisos antes del POST/PUT real.

### **3.3 Endpoint de Login**
```typescript
app.post("/auth/login", (req: Request, res: Response) => {
  const { username, password } = req.body;
  
  // Validación básica
  if (!username || !password) {
    return res.status(400).json({ error: "Faltan credenciales" });
  }

  // Buscar usuario en array
  const user = validUsers.find(
    (u) => u.username === username && u.password === password
  );

  if (!user) {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  // Crear JWT
  const payload: JwtPayloadCustom = {
    sub: "user-123",        // Subject (identificador único del usuario)
    role: "admin"           // Rol/permiso del usuario
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
  res.json({ token });
});
```

**Flujo:**
1. Recibe credenciales del body
2. Valida contra lista de usuarios
3. Crea un **payload** (datos a incluir en el token)
4. **Firma** el payload con la clave secreta → genera el JWT
5. Devuelve el token al cliente

**JWT Structure:**
```
header.payload.signature
eyJhbGc... (Base64URL encoded)
```
- **Header**: Algoritmo de firma (HS256)
- **Payload**: Los datos (`sub`, `role`, `exp`)
- **Signature**: HMAC del header+payload usando JWT_SECRET

### **3.4 Middleware de Autenticación**
```typescript
function authenticateJwt(
  req: Request & { user?: JwtPayloadCustom },
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  // Validar formato "Bearer <token>"
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta header Authorization" });
  }

  // Extraer token (quitar "Bearer ")
  const token = authHeader.substring("Bearer ".length);

  try {
    // Verificar firma y decodificar
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayloadCustom;
    req.user = decoded;  // Adjuntar datos del usuario al request
    next();  // Continuar a la siguiente función
  } catch (err) {
    return res.status(401).json({ error: "JWT inválido o expirado" });
  }
}
```

**¿Qué hace `jwt.verify()`?**
1. Decodifica el token
2. Recalcula la firma usando `JWT_SECRET`
3. Compara firmas → Si no coinciden, alguien modificó el token
4. Verifica expiración (`exp`)
5. Si todo OK, devuelve el payload decodificado

### **3.5 Endpoint Protegido**
```typescript
app.get(
  "/api/self",
  authenticateJwt,  // ← Middleware ejecutado primero
  (req: Request & { user?: JwtPayloadCustom }, res: Response) => {
    res.json({
      message: "Acceso concedido vía JWT",
      user: req.user  // Datos del middleware
    });
  }
);
```

**Flujo de ejecución:**
1. Cliente hace `GET /api/self` con header `Authorization: Bearer eyJhbGc...`
2. Express ejecuta `authenticateJwt` primero
3. Si JWT es válido, `req.user` se llena y se llama `next()`
4. La función final devuelve los datos del usuario

---

## **4. MACAROONS API (macaroon-api.js) - ANÁLISIS PROFUNDO**

### **4.1 ¿Qué son los Macaroons?**
Son **tokens criptográficos con restricciones (caveats)** que permiten:
- **Delegación**: Crear nuevos tokens derivados
- **Atenuación**: Los tokens derivados tienen MENOS permisos
- **Verificación distribuida**: Se pueden agregar restricciones sin contactar al servidor original

### **4.2 Emisión de Macaroon**
```javascript
function emitirMacaroon(userId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + 15 * 60; // 15 minutos

  const location = "http://localhost:" + PORT;
  const secretKey = MACAROON_SECRET;
  const identifier = userId;

  const macaroon = new MacaroonsBuilder(location, secretKey, identifier)
    .add_first_party_caveat("role = admin")
    .add_first_party_caveat(`expires <= ${expiresAt}`)
    .getMacaroon();

  return macaroon.serialize();
}
```

**Estructura del Macaroon:**
```
Location: http://localhost:3002
Identifier: user-456
Caveats:
  - role = admin
  - expires <= 1700400000
Signature: <HMAC calculado>
```

**¿Cómo funciona la firma?**
```
signature1 = HMAC(secret, identifier)
signature2 = HMAC(signature1, "role = admin")
signature3 = HMAC(signature2, "expires <= 1700400000")
```
Cada caveat modifica la firma encadenadamente.

### **4.3 Middleware de Autenticación Macaroon**
```javascript
function authenticateMacaroon(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Macaroon ")) {
    return res.status(401).json({ error: "Falta header Authorization Macaroon" });
  }

  const token = authHeader.substring("Macaroon ".length).trim();

  try {
    // Deserializar el macaroon
    const m = MacaroonsBuilder.deserialize(token);

    // Crear verificador
    const verifier = new MacaroonsVerifier(m);
    const nowSeconds = Math.floor(Date.now() / 1000);

    // Función para validar CADA caveat
    verifier.satisfyGeneral((caveat) => {
      if (typeof caveat !== "string") return false;

      // Validar "role = admin"
      if (caveat.startsWith("role =")) {
        const role = caveat.split("=")[1].trim();
        return role === "admin";
      }

      // Validar "method = GET"
      if (caveat.startsWith("method =")) {
        const method = caveat.split("=")[1].trim();
        return method === req.method;  // ← Compara con método HTTP actual
      }

      // Validar "expires <= timestamp"
      if (caveat.startsWith("expires <=")) {
        const exp = Number(caveat.split("<=")[1].trim());
        if (Number.isNaN(exp)) return false;
        return nowSeconds <= exp;  // ← Verifica que no haya expirado
      }

      return false;  // Caveat desconocido → rechazar
    });

    // Verificar firma con el secreto
    const valid = verifier.isValid(MACAROON_SECRET);

    if (!valid) {
      return res.status(403).json({
        error: "Macaroon inválido o restricciones no cumplidas",
      });
    }

    req.userId = m.identifier;
    next();
  } catch (err) {
    console.error("Error verificando macaroon:", err);
    return res.status(403).json({
      error: "Macaroon inválido o restricciones no cumplidas",
    });
  }
}
```

**Proceso de verificación:**
1. **Deserializar**: Convertir string a objeto Macaroon
2. **Evaluar caveats**: Por cada restricción, verificar si se cumple
3. **Verificar firma**: Recalcular HMAC encadenado y comparar
4. Si TODO es válido → `next()`

### **4.4 Delegación de Permisos (LA MAGIA DE MACAROONS)**
```javascript
app.post(
  "/api/amigos/delegate-readonly",
  authenticateMacaroon,  // ← Solo admin puede delegar
  (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader.substring("Macaroon ".length).trim();

    try {
      // Deserializar token original
      let m = MacaroonsBuilder.deserialize(token);

      // CREAR NUEVO TOKEN DERIVADO con caveat adicional
      m = new MacaroonsBuilder(m)
        .add_first_party_caveat("method = GET")  // ← Nueva restricción
        .getMacaroon();

      res.json({
        delegated_macaroon: m.serialize(),
        note: "Este token solo sirve para peticiones GET",
      });
    } catch (err) {
      console.error("Error atenuando macaroon:", err);
      res.status(500).json({ error: "No se pudo delegar el token" });
    }
  }
);
```

**¿Qué pasa internamente?**

**Token Original:**
```
Caveats:
  - role = admin
  - expires <= 1700400000
Signature: ABC123
```

**Token Delegado:**
```
Caveats:
  - role = admin
  - expires <= 1700400000
  - method = GET  ← NUEVO
Signature: DEF456  ← Firma diferente
```

**Crucialmente:** El servidor NO necesitó ser contactado para crear el token delegado. El cliente lo hace localmente.

**¿Por qué funciona?**
La nueva firma se calcula como:
```
new_signature = HMAC(ABC123, "method = GET")
```
El servidor puede verificarla porque recalcula la cadena de HMACs.

### **4.5 Endpoints Protegidos**
```javascript
app.get("/api/amigos", authenticateMacaroon, (req, res) => {
  res.json({ data: amigos });
});

app.post("/api/amigos", authenticateMacaroon, (req, res) => {
  const { nombre, apellido } = req.body;
  if (!nombre || !apellido) res.status(400).json({ message: "Invalid data" });

  amigos.push({ nombre, apellido })
  res.status(200).json({ data: amigos });
});
```

**Escenarios:**

**Con token original (admin completo):**
- GET /api/amigos → ✅ Pasa (tiene caveat `role = admin`)
- POST /api/amigos → ✅ Pasa (no hay restricción de método)

**Con token delegado (solo GET):**
- GET /api/amigos → ✅ Pasa (método GET coincide con caveat `method = GET`)
- POST /api/amigos → ❌ FALLA (caveat `method = GET` no se cumple porque req.method = "POST")

### **4.6 Endpoint de Debug**
```javascript
app.post("/debug/parse-macaroon", (req, res) => {
  const { token } = req.body;
  
  try {
    const m = MacaroonsBuilder.deserialize(token);
    const inspectStr = m.inspect();  // Representación legible
    
    // Extraer caveats manualmente
    const jsonData = m._exportAsJSONObjectV2();
    const caveats = [];
    
    if (jsonData && jsonData.c) {
      jsonData.c.forEach(caveat => {
        if (caveat.i) {
          caveats.push(caveat.i);
        }
      });
    }

    res.json({
      identifier: m.identifier,
      location: m.location,
      caveats: caveats,
      raw_inspect: inspectStr
    });
  } catch (err) {
    return res.status(400).json({ error: "Token inválido" });
  }
});
```

Permite **inspeccionar** un macaroon sin verificarlo, útil para debugging.

---

## **5. FRONTEND (index.html) - ANÁLISIS PROFUNDO**

### **5.1 Estructura HTML**
- **Tabla comparativa**: Muestra diferencias JWT vs Macaroons
- **Panel JWT**: Login y prueba de acceso
- **Panel Macaroons**: Login, prueba de acceso completo, delegación
- **Inspector**: Para ver contenido de macaroons

### **5.2 Función de Login JWT**
```javascript
async function loginJWT() {
  const username = document.getElementById('jwt-username').value;
  const password = document.getElementById('jwt-password').value;

  try {
    const res = await fetch(`${JWT_API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    
    if (res.ok) {
      jwtToken = data.token;  // Guardar token globalmente
      document.getElementById('jwt-token').textContent = jwtToken;
      document.getElementById('jwt-token').classList.add('has-token');
      showResponse('jwt-response', `Login exitoso!...`, false);
    } else {
      showResponse('jwt-response', `Error: ${data.error}`, true);
    }
  } catch (err) {
    showResponse('jwt-response', `Error de conexión...`, true);
  }
}
```

**Flujo:**
1. Lee inputs del DOM
2. Hace POST a `/auth/login`
3. Si OK, guarda token en variable global `jwtToken`
4. Muestra token en el UI

### **5.3 Función de Acceso a Recurso JWT**
```javascript
async function accessJWTResource() {
  if (!jwtToken) {
    showResponse('jwt-response', 'Primero debes hacer login', true);
    return;
  }

  try {
    const res = await fetch(`${JWT_API}/api/self`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });

    const data = await res.json();
    showResponse('jwt-response', `Respuesta:\n${JSON.stringify(data, null, 2)}`, false);
  } catch (err) {
    showResponse('jwt-response', `Error: ${err.message}`, true);
  }
}
```

Envía el JWT en el header `Authorization: Bearer <token>`.

### **5.4 Delegación de Macaroon (Frontend)**
```javascript
async function delegateMacaroon() {
  if (!macToken) {
    showResponse('mac-response', 'Primero debes hacer login', true);
    return;
  }

  try {
    const res = await fetch(`${MAC_API}/api/amigos/delegate-readonly`, {
      method: 'POST',
      headers: { 'Authorization': `Macaroon ${macToken}` }
    });

    const data = await res.json();
    
    if (res.ok) {
      macDelegatedToken = data.delegated_macaroon;  // Guardar nuevo token
      document.getElementById('mac-delegated-token').textContent = macDelegatedToken;
      document.getElementById('delegated-section').classList.remove('hidden');
      document.getElementById('delegated-actions').classList.remove('hidden');
      showResponse('mac-response', `Token delegado creado...`, false);
    }
  } catch (err) {
    showResponse('mac-response', `Error: ${err.message}`, true);
  }
}
```

**Resultado:** Ahora hay DOS tokens:
- `macToken`: Original con permisos completos
- `macDelegatedToken`: Derivado solo para GET

### **5.5 Prueba de Token Delegado**
```javascript
async function postMacaroonAmigosDelegated() {
  if (!macDelegatedToken) {
    showResponse('mac-response', 'Primero debes delegar un token', true);
    return;
  }

  try {
    const res = await fetch(`${MAC_API}/api/amigos`, {
      method: 'POST',
      headers: { 
        'Authorization': `Macaroon ${macDelegatedToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ nombre: 'Intruso', apellido: 'Malicioso' })
    });

    const data = await res.json();
    
    if (!res.ok) {
      showResponse('mac-response', `✅ POST RECHAZADO (como esperado)!...`, false);
    } else {
      showResponse('mac-response', `⚠ INESPERADO: ${JSON.stringify(data)}`, true);
    }
  } catch (err) {
    showResponse('mac-response', `Error: ${err.message}`, true);
  }
}
```

**Demostración clave:** El POST falla porque el caveat `method = GET` no se cumple.

---

## **6. DIFERENCIAS CLAVE JWT vs MACAROONS**

### **JWT:**
✅ **Ventajas:**
- Simple de implementar
- Ampliamente soportado
- Stateless (servidor no guarda sesiones)

❌ **Limitaciones:**
- **No delegable**: No puedes crear un token con menos permisos
- **No revocable fácilmente**: Una vez emitido, es válido hasta expiración
- **Todo o nada**: Si tienes rol "admin", lo eres completamente

### **Macaroons:**
✅ **Ventajas:**
- **Atenuación**: Puedes crear tokens con menos permisos
- **Delegación descentralizada**: No requiere servidor
- **Caveats flexibles**: Restricciones contextuales (tiempo, IP, método HTTP, etc.)
- **Revocación más fácil**: Con third-party caveats

❌ **Limitaciones:**
- Mayor complejidad
- Menos herramientas/librerías
- Curva de aprendizaje más alta

---

## **7. FLUJO COMPLETO DE EJECUCIÓN**

### **Escenario JWT:**
1. Usuario abre `http://localhost:3001`
2. Ingresa credenciales → Click "Obtener JWT"
3. Frontend: `POST /auth/login` con credenciales
4. Backend: Valida, crea JWT firmado, devuelve token
5. Frontend: Guarda token, lo muestra
6. Usuario: Click "GET /api/self"
7. Frontend: `GET /api/self` con header `Authorization: Bearer <JWT>`
8. Backend: Verifica firma del JWT, devuelve datos
9. Frontend: Muestra respuesta

### **Escenario Macaroons con Delegación:**
1. Usuario abre `http://localhost:3002`
2. Login → Obtiene macaroon con caveats `role = admin` y `expires <= ...`
3. Click "GET /api/amigos" → ✅ Funciona (es admin)
4. Click "POST /api/amigos" → ✅ Funciona (es admin)
5. Click "Crear token solo-lectura"
6. Frontend: `POST /api/amigos/delegate-readonly` con macaroon original
7. Backend: Deserializa, agrega caveat `method = GET`, devuelve nuevo token
8. Frontend: Guarda token delegado
9. Click "GET con token delegado" → ✅ Funciona (GET cumple caveat)
10. Click "POST con token delegado" → ❌ FALLA (POST no cumple `method = GET`)

---

## **8. CONCEPTOS CRIPTOGRÁFICOS CLAVE**

### **HMAC (Hash-based Message Authentication Code):**
```
HMAC(secret, message) = hash((secret XOR opad) || hash((secret XOR ipad) || message))
```
- Garantiza **integridad** y **autenticidad**
- Solo quien tiene el `secret` puede crear o verificar el HMAC

### **JWT Signature:**
```
signature = HMAC-SHA256(
  base64url(header) + "." + base64url(payload),
  JWT_SECRET
)
```

### **Macaroon Signature Chaining:**
```
sig0 = HMAC(MACAROON_SECRET, identifier)
sig1 = HMAC(sig0, caveat1)
sig2 = HMAC(sig1, caveat2)
final_signature = sig2
```

**Ventaja:** Cada caveat adicional modifica la firma, pero de forma verificable.

---

## **9. CASOS DE USO PRÁCTICOS**

### **Cuándo usar JWT:**
- APIs simples con autenticación básica
- Sistemas donde los permisos no necesitan delegarse
- Aplicaciones con ciclo de vida corto de tokens
- Cuando se requiere amplia compatibilidad con herramientas existentes

### **Cuándo usar Macaroons:**
- Sistemas distribuidos donde diferentes servicios necesitan diferentes permisos
- Cuando necesitas delegar acceso temporal con restricciones específicas
- APIs que requieren control granular de permisos
- Microservicios donde un servicio necesita acceso limitado a otros servicios

### **Ejemplo real de Macaroons:**
Imagina que tienes acceso completo a un servicio de almacenamiento en la nube. Necesitas darle a un script automatizado acceso SOLO para:
- Leer archivos (no escribir)
- Solo de una carpeta específica
- Solo durante las próximas 24 horas

Con Macaroons, puedes crear ese token derivado **sin contactar al servidor** y sin comprometer tu token principal.

---

## **10. PUNTOS CLAVE PARA LA PRESENTACIÓN**

### **Problema que resuelve:**
- **JWT**: Autenticación simple pero inflexible
- **Macaroons**: Autenticación + delegación segura de permisos

### **Demo práctica:**
- Muestra cómo JWT no permite reducir permisos
- Macaroons permiten crear tokens "atenuados" sin servidor
- Ideal para microservicios, APIs compartidas, sistemas distribuidos

### **Punto destacado:**
> "Con Macaroons puedo darte acceso limitado SIN contactar al servidor que emitió el token original. Esto es imposible con JWT."

### **Consideraciones de seguridad:**
- **JWT**: La firma garantiza que el token no fue modificado
- **Macaroons**: La cadena de firmas garantiza que cada caveat fue agregado correctamente
- Ambos requieren HTTPS en producción para evitar interceptación
- Las claves secretas NUNCA deben estar en el código (usar variables de entorno)

### **Limitaciones conocidas:**
- **JWT**: Una vez emitido, no puede ser modificado ni revocado sin lista negra
- **Macaroons**: Mayor complejidad, menos adopción, curva de aprendizaje más pronunciada

---

## **11. COMANDOS ÚTILES**

### **Instalación:**
```bash
npm install
```

### **Iniciar ambos servidores:**
```bash
./start-demo.sh
# o manualmente:
npm run start:jwt      # Terminal 1
npm run start:macaroon # Terminal 2
```

### **Compilar TypeScript:**
```bash
npm run build
```

### **Probar endpoints con curl:**

**JWT:**
```bash
# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"martin","password":"pass123"}'

# Acceder a recurso protegido
curl http://localhost:3001/api/self \
  -H "Authorization: Bearer <TOKEN>"
```

**Macaroons:**
```bash
# Login
curl -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}'

# GET amigos
curl http://localhost:3002/api/amigos \
  -H "Authorization: Macaroon <TOKEN>"

# Delegar token
curl -X POST http://localhost:3002/api/amigos/delegate-readonly \
  -H "Authorization: Macaroon <TOKEN>"
```

---

## **12. ESTRUCTURA DEL PROYECTO**

```
desarrollo-sw/
├── package.json           # Dependencias y scripts
├── tsconfig.json          # Configuración TypeScript
├── start-demo.sh          # Script para iniciar ambos servidores
├── README.md              # Documentación principal
├── EXPLICACION_COMPLETA.md # Este archivo
├── public/
│   └── index.html         # Frontend interactivo
└── src/
    ├── data.js            # Datos de ejemplo (lista de amigos)
    ├── jwt-api.ts         # API con autenticación JWT
    └── macaroon-api.js    # API con autenticación Macaroons
```

---

## **13. PREGUNTAS FRECUENTES**

### **¿Por qué el payload del JWT siempre es "admin" aunque el usuario sea "user"?**
Es un bug/simplificación en el código actual. Debería ser:
```typescript
const payload: JwtPayloadCustom = {
  sub: user.username,  // Usar el username real
  role: user.role      // Usar el rol real del usuario
};
```

### **¿Los Macaroons son más seguros que JWT?**
No necesariamente "más seguros", son **diferentes**. Ambos usan criptografía sólida (HMAC). La ventaja de Macaroons es la **flexibilidad** en delegación y restricciones, no una seguridad superior.

### **¿Puedo usar Macaroons en producción?**
Sí, pero:
- Hay menos librerías maduras que para JWT
- Menor adopción en la industria
- Requiere más educación del equipo
- Beneficio real solo si necesitas delegación de permisos

### **¿Qué pasa si pierdo el MACAROON_SECRET?**
Todos los macaroons emitidos quedan inválidos, similar a perder el JWT_SECRET. En producción, usa gestores de secretos (AWS Secrets Manager, HashiCorp Vault, etc.).

---

## **CONCLUSIÓN**

Este proyecto demuestra dos enfoques fundamentalmente diferentes para autenticación y autorización:

- **JWT** es la navaja suiza de la autenticación: simple, efectiva, ampliamente adoptada.
- **Macaroons** son la herramienta especializada: más compleja, pero permite casos de uso que JWT no puede resolver (delegación descentralizada de permisos).

La elección depende de tus requisitos específicos. Para la mayoría de aplicaciones web, JWT es suficiente. Para sistemas distribuidos complejos con necesidades de delegación, Macaroons ofrecen ventajas únicas.
