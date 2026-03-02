// server/src/index.js
const express = require("express");
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const pool = require("./db");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());

// Servir catálogo estático
app.use("/", express.static(path.join(__dirname, "../../web/catalog")));

// Health
app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

// Crear tabla si no existe
async function initDB() {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      title VARCHAR(120) NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL,
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_name VARCHAR(120) NOT NULL,
      customer_phone VARCHAR(60) NOT NULL,
      delivery_method VARCHAR(20) NOT NULL,
      delivery_address TEXT,
      payment_method VARCHAR(30) NOT NULL,
      notes TEXT,
      total DECIMAL(10,2) NOT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

    await pool.query(`
    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INT REFERENCES orders(id) ON DELETE CASCADE,
      product_id INT,
      title VARCHAR(120) NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      qty INT NOT NULL,
      line_total DECIMAL(10,2) NOT NULL
    )
  `);
    console.log("✅ Tables products, orders, order_items ready");
}

// ---------- API Productos (público para MVP) ----------

// Listar productos activos
app.get("/api/products", async (req, res) => {
    const result = await pool.query(
        "SELECT * FROM products WHERE active = true ORDER BY id DESC"
    );
    res.json(result.rows);
});

// Crear producto (MVP sin auth todavía)
app.post("/api/products", async (req, res) => {
    const { title, description, price } = req.body;

    if (!title || price === undefined) {
        return res.status(400).json({ error: "title y price son obligatorios" });
    }

    const result = await pool.query(
        `INSERT INTO products (title, description, price)
     VALUES ($1, $2, $3)
     RETURNING *`,
        [title, description || "", price]
    );

    const product = result.rows[0];

    // ✅ Emitir evento realtime para que el catálogo se actualice
    io.emit("products:upsert", product);

    res.status(201).json(product);
});

// ---------- API Orders ----------
app.post("/api/orders", async (req, res) => {
    const {
        customer_name,
        customer_phone,
        delivery_method,
        delivery_address,
        payment_method,
        notes,
        items
    } = req.body;

    if (!customer_name || !customer_phone || !delivery_method || !payment_method || !items || !items.length) {
        return res.status(400).json({ error: "Faltan datos obligatorios para crear la orden" });
    }

    try {
        await pool.query('BEGIN');

        // Recalcular total desde items
        let total = 0;
        for (const item of items) {
            total += Number(item.unit_price || item.price) * Number(item.qty);
        }

        const orderResult = await pool.query(
            `INSERT INTO orders (customer_name, customer_phone, delivery_method, delivery_address, payment_method, notes, total)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [customer_name, customer_phone, delivery_method, delivery_address, payment_method, notes || "", total]
        );
        const orderId = orderResult.rows[0].id;

        for (const item of items) {
            const unitPrice = Number(item.unit_price || item.price);
            const qty = Number(item.qty);
            const lineTotal = unitPrice * qty;
            await pool.query(
                `INSERT INTO order_items (order_id, product_id, title, unit_price, qty, line_total)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [orderId, item.id || item.product_id, item.title, unitPrice, qty, lineTotal]
            );
        }

        await pool.query('COMMIT');

        io.emit("orders:new", { order_id: orderId, total });

        res.status(201).json({ ok: true, order_id: orderId });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Error creating order:", error);
        res.status(500).json({ error: "Error interno al crear la orden" });
    }
});

// ---------- Socket.io ----------
const server = http.createServer(app);
const io = new Server(server);

io.on("connection", (socket) => {
    console.log("🟢 Socket conectado:", socket.id);
});

// Start
server.listen(PORT, async () => {
    await initDB();
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});