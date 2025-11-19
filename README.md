# Seguridad en el Desarrollo de Software - Trabajo Practico

## 🔐 JWT vs Macaroons - Demo Interactiva

Este proyecto demuestra las diferencias entre **JWT (JSON Web Tokens)** y **Macaroons** como mecanismos de autenticación y autorización, con una interfaz web interactiva para explorar sus características.

---

## 🎯 ¿Qué hace este proyecto?

Implementa **dos APIs separadas** que muestran:

### **JWT (JSON Web Token)** 🔵
- Autenticación tradicional con tokens firmados
- Permisos "todo o nada" (si tienes rol admin, lo eres completamente)
- **Limitación:** No se pueden delegar permisos reducidos

### **Macaroons** 🟢
- Autenticación con capacidad de **delegación y atenuación**
- Puedes crear tokens derivados con **menos permisos** (ej: solo lectura)
- **Ventaja clave:** Caveats (restricciones) flexibles sin necesidad del servidor

---

## 🚀 Inicio Rápido

### 1. Instalar dependencias:
```bash
npm install
```

### 2. Iniciar la demo (ambos servidores):
```bash
./start-demo.sh
```

O manualmente en terminales separadas:
```bash
# Terminal 1 - JWT API (puerto 3001)
npm run start:jwt

# Terminal 2 - Macaroons API (puerto 3002)
npm run start:macaroon
```

### 3. Abrir la demo web:
Abre tu navegador en:
- **http://localhost:3001** (desde el servidor JWT)
- **http://localhost:3002** (desde el servidor Macaroons)

---

## 🎮 Cómo usar la demo interactiva

### **Panel JWT (Azul)** 🔵

1. **Login**: Usuario `alice` / Contraseña `password123`
2. **Obtener JWT**: Haz clic en "Obtener JWT"
3. **Acceder a recurso**: Usa el token para acceder a `/api/self`

**Observación:** No puedes limitar los permisos del JWT una vez emitido.

---

### **Panel Macaroons (Verde)** 🟢

1. **Login**: Usuario `bob` / Contraseña `password123`
2. **Probar acceso completo**: 
   - ✅ GET /api/amigos (funciona)
   - ✅ POST /api/amigos (funciona)
3. **Delegar token solo-lectura**: Crea un token derivado con restricción `method = GET`
4. **Probar token delegado**:
   - ✅ GET /api/amigos (funciona - es lectura)
   - ❌ POST /api/amigos (falla - está restringido a GET)

**Observación clave:** El token delegado tiene **menos permisos** que el original, pero fue creado sin contactar al servidor.

---

## 📊 Diferencias Principales

| Característica | JWT | Macaroons |
|----------------|-----|-----------|
| **Autenticación** | ✓ Sí | ✓ Sí |
| **Delegación de permisos** | ✗ No | ✓ Sí (Atenuación) |
| **Revocación** | ✗ Difícil | ✓ Más fácil |
| **Restricciones contextuales** | ✗ Limitadas | ✓ Caveats flexibles |
| **Complejidad** | ⭐⭐ Baja | ⭐⭐⭐⭐ Alta |

---

## 🔧 Endpoints de las APIs

### **JWT API (puerto 3001)**
```
POST /auth/login          - Login (alice/password123)
GET  /api/self            - Recurso protegido (requiere JWT)
```

### **Macaroons API (puerto 3002)**
```
POST /auth/login                      - Login (bob/password123)
GET  /api/amigos                      - Listar amigos (requiere auth)
POST /api/amigos                      - Agregar amigo (requiere auth)
POST /api/amigos/delegate-readonly    - Delegar token solo-lectura
POST /debug/parse-macaroon            - Inspeccionar macaroon
```

---

## 🧪 Pruebas con cURL

### JWT:
```bash
# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"password123"}'

# Usar token
curl http://localhost:3001/api/self \
  -H "Authorization: Bearer <tu-token>"
```

### Macaroons:
```bash
# Login
curl -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"bob","password":"password123"}'

# Ver amigos
curl http://localhost:3002/api/amigos \
  -H "Authorization: Macaroon <tu-macaroon>"

# Delegar token
curl -X POST http://localhost:3002/api/amigos/delegate-readonly \
  -H "Authorization: Macaroon <tu-macaroon>"
```

---

## 💡 Concepto Clave: Atenuación de Macaroons

**Escenario:** Tienes un macaroon con permisos de admin completo.

1. **Sin servidor**, puedes crear un nuevo macaroon derivado añadiendo un **caveat** (restricción)
2. El nuevo macaroon tiene **menos permisos** (ej: solo GET)
3. Puedes compartir este token delegado con otra persona/servicio
4. El servidor valida que cumple todas las restricciones

**Con JWT esto es imposible** - necesitarías volver al servidor para emitir un nuevo token.

---

## 📦 Tecnologías

- **Node.js** + **Express**
- **TypeScript** (JWT API)
- **jsonwebtoken** - Librería JWT
- **macaroons.js** - Implementación de Macaroons
- **HTML/CSS/JavaScript** - Frontend interactivo

---

## 🎓 Casos de Uso

### JWT es mejor cuando:
- Necesitas algo simple y estándar
- No requieres delegación de permisos
- La revocación no es crítica

### Macaroons son mejores cuando:
- Necesitas delegar permisos limitados
- Quieres restricciones contextuales flexibles
- Implementas sistemas distribuidos complejos
- La seguridad granular es prioritaria

---

## 🤝 Contribuciones

Este es un proyecto educativo. Siéntete libre de explorar, modificar y aprender.

---

## 📄 Licencia

Proyecto académico - Universidad
