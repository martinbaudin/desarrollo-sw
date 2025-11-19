require("dotenv").config();
const express = require("express");
const path = require("path");
const {
  MacaroonsBuilder,
  MacaroonsVerifier,
} = require("macaroons.js");
const { amigos } = require("./data");
const { VID_NONCE_KEY_SZ } = require("macaroons.js/lib/MacaroonsConstants");

const app = express();

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, "../public")));

// Allow local demo frontend to call this API from http://localhost:3000
app.use((_, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});

app.use(express.json());

// Habilitar CORS para que el HTML pueda consumir la API
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const MACAROON_SECRET =
  process.env.MACAROON_SECRET || "dev-macaroon-secret";
const PORT = Number(process.env.PORT_MACAROON || 3002);


function emitirMacaroon(userId) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + 15 * 60; // 15 min

  const location = "http://localhost:" + PORT;
  const secretKey = MACAROON_SECRET;
  const identifier = userId;

  const macaroon = new MacaroonsBuilder(location, secretKey, identifier)
    .add_first_party_caveat("role = admin")
    //    .add_first_party_caveat("path = /api/secret-macaroons")
    .add_first_party_caveat(`expires <= ${expiresAt}`)
    .getMacaroon();

  // Serializamos según la doc (base64url)
  return macaroon.serialize();
}

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (username !== "bob" || password !== "password123") {
    return res.status(401).json({ error: "Credenciales inválidas" });
  }

  const userId = "user-456";
  const macaroonToken = emitirMacaroon(userId);

  res.json({
    macaroon: macaroonToken,
  });
});


// -------------------------------------------------------
// Middleware
// -------------------------------------------------------
function authenticateMacaroon(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Macaroon ")) {
    return res
      .status(401)
      .json({ error: "Falta header Authorization Macaroon" });
  }

  const token = authHeader.substring("Macaroon ".length).trim();

  try {

    const m = MacaroonsBuilder.deserialize(token);

    const verifier = new MacaroonsVerifier(m);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const requestedPath = req.path;

    verifier.satisfyGeneral((caveat) => {
      if (typeof caveat !== "string") return false;

      if (caveat.startsWith("role =")) {
        const role = caveat.split("=")[1].trim();
        return role === "admin";
      }

      // if (caveat.startsWith("path =")) {
      //   const path = caveat.split("=")[1].trim();
      //   return path === requestedPath;
      // }

      if (caveat.startsWith("method =")) {
        const method = caveat.split("=")[1].trim();
        // Comparamos el caveat con el método de la petición actual
        return method === req.method;
      }

      if (caveat.startsWith("expires <=")) {
        const exp = Number(caveat.split("<=")[1].trim());
        if (Number.isNaN(exp)) return false;
        return nowSeconds <= exp;
      }

      // Caveat desconocida
      return false;
    });

    const valid = verifier.isValid(MACAROON_SECRET);

    if (!valid) {
      return res.status(403).json({
        error: "Macaroon inválido o restricciones no cumplidas",
      });
    }

    // En macaroons.js el identifier es parte del macaroon
    req.userId = m.identifier;

    next();
  } catch (err) {
    console.error("Error verificando macaroon:", err);
    return res.status(403).json({
      error: "Macaroon inválido o restricciones no cumplidas",
    });
  }
}

// -------------------------------------------------------
// Endpoints protegidos
// -------------------------------------------------------
app.get("/api/amigos", authenticateMacaroon, (req, res) => {
  res.json({
    data: amigos
  });
});

app.post("/api/amigos", authenticateMacaroon, (req, res) => {
  const { nombre, apellido } = req.body;
  if (!nombre || !apellido) res.status(400).json({ message: "Invalid data" });

  amigos.push({ nombre, apellido })
  res.status(200).json({
    data: amigos
  });
});

app.post(
  "/api/amigos/delegate-readonly",
  authenticateMacaroon, // ¡Nos aseguramos de que solo un admin pueda delegar
  (req, res) => {
    const authHeader = req.headers.authorization;
    const token = authHeader.substring("Macaroon ".length).trim();

    try {
      let m = MacaroonsBuilder.deserialize(token);

      // Añadir el nuevo caveat 
      m = new MacaroonsBuilder(m)
        .add_first_party_caveat("method = GET")
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

// -------------------------------------------------------
// Debug endpoint para parsear macaroon
// -------------------------------------------------------
app.post("/debug/parse-macaroon", (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Falta token en el body" });
  }

  try {
    const m = MacaroonsBuilder.deserialize(token);

    // Extraer información del macaroon
    const caveats = [];
    
    // Obtener el inspect completo para debug
    const inspectStr = m.inspect();
    console.log("=== MACAROON INSPECT ===");
    console.log(inspectStr);
    console.log("========================");
    
    // La librería macaroons.js expone los caveats directamente
    // Accedemos a través de la propiedad interna _exportAsJSONObjectV2
    const jsonData = m._exportAsJSONObjectV2 ? m._exportAsJSONObjectV2() : null;
    
    if (jsonData && jsonData.c) {
      // Los caveats están en la propiedad 'c'
      jsonData.c.forEach(caveat => {
        if (caveat.i) {
          // 'i' contiene el identificador del caveat (la restricción)
          caveats.push(caveat.i);
        }
      });
    }
    
    // Método alternativo: parsear directamente desde inspect()
    if (caveats.length === 0) {
      const lines = inspectStr.split('\n');
      lines.forEach(line => {
        // Buscar líneas que contengan "cid" (caveat id)
        if (line.includes('cid') && line.includes('=')) {
          const match = line.match(/cid\s*=\s*(.+)/);
          if (match && match[1]) {
            caveats.push(match[1].trim());
          }
        }
      });
    }

    res.json({
      identifier: m.identifier || "N/A",
      location: m.location || "N/A",
      caveats: caveats.length > 0 ? caveats : ["Sin caveats de primer partido"],
      raw_inspect: inspectStr // Incluir el inspect completo para debugging
    });
  } catch (err) {
    console.error("Error parseando macaroon:", err);
    return res.status(400).json({ error: "Token inválido o corrupto" });
  }
});

app.listen(PORT, () => {
  console.log(`Macaroons API escuchando en http://localhost:${PORT}`);
});
