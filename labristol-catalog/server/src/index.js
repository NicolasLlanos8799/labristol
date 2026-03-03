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

// Servir catálogo estático y panel admin
app.use("/", express.static(path.join(__dirname, "../../web/catalog")));
app.use("/admin", express.static(path.join(__dirname, "../../web/admin")));

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
      delivery_time VARCHAR(10) NOT NULL,
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
        delivery_time,
        notes,
        items
    } = req.body;

    if (!customer_name || !customer_phone || !delivery_method || !payment_method || !delivery_time || !items || !items.length) {
        return res.status(400).json({ error: "Faltan datos obligatorios para crear la orden" });
    }

    if (delivery_method === "delivery" && !delivery_address) {
        return res.status(400).json({ error: "delivery_address es obligatorio si delivery_method es delivery" });
    }

    // Recalcular total desde items y validar qty
    let total = 0;
    for (const item of items) {
        const qty = Number(item.qty);
        if (qty <= 0) {
            return res.status(400).json({ error: "La cantidad de cada producto debe ser mayor a 0" });
        }
        total += Number(item.unit_price || item.price) * qty;
    }

    try {
        await pool.query('BEGIN');

        const orderResult = await pool.query(
            `INSERT INTO orders (customer_name, customer_phone, delivery_method, delivery_address, payment_method, delivery_time, notes, total)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [customer_name, customer_phone, delivery_method, delivery_address || "", payment_method, delivery_time, notes || "", total]
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

        io.emit("orders:new", { order_id: orderId, total, delivery_time });

        res.status(201).json({ ok: true, order_id: orderId });
    } catch (error) {
        await pool.query('ROLLBACK');
        console.error("Error creating order:", error);
        res.status(500).json({ error: "Error interno al crear la orden" });
    }
});

// ---------- API Admin Orders ----------

app.get("/api/admin/orders", async (req, res) => {
    const statusFilter = req.query.status;
    try {
        let query = "SELECT * FROM orders";
        let params = [];
        if (statusFilter) {
            query += " WHERE status = $1";
            params.push(statusFilter);
        }
        query += " ORDER BY created_at DESC, id DESC";
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

app.get("/api/admin/orders/:id", async (req, res) => {
    try {
        const orderId = req.params.id;
        const result = await pool.query("SELECT * FROM orders WHERE id = $1", [orderId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ ok: false, error: "Not found" });
        }

        const order = result.rows[0];
        const itemsResult = await pool.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY id ASC", [orderId]);

        res.json({ ok: true, order, items: itemsResult.rows });
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

app.patch("/api/admin/orders/:id/status", async (req, res) => {
    const orderId = req.params.id;
    const { status } = req.body;

    const validStatuses = ["pending", "in_kitchen", "ready", "delivered", "cancelled"];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Status inválido" });
    }

    try {
        const result = await pool.query("UPDATE orders SET status = $1 WHERE id = $2 RETURNING id", [status, orderId]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Not found" });
        }
        io.emit("orders:status", { order_id: Number(orderId), status });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

// ---------- API Admin Products ----------

app.get("/api/admin/products", async (req, res) => {
    const activeFilter = req.query.active;
    try {
        let query = "SELECT * FROM products";
        let params = [];

        if (activeFilter === "true") {
            query += " WHERE active = true";
        } else if (activeFilter === "false") {
            query += " WHERE active = false";
        }

        query += " ORDER BY created_at DESC, id DESC";
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

app.post("/api/admin/products", async (req, res) => {
    const { title, description, price, active } = req.body;

    if (!title || title.trim().length < 2) {
        return res.status(400).json({ error: "El título debe tener al menos 2 caracteres" });
    }

    const numPrice = Number(price);
    if (!Number.isFinite(numPrice) || numPrice <= 0) {
        return res.status(400).json({ error: "El precio debe ser un número mayor a 0" });
    }

    const isActive = active !== undefined ? Boolean(active) : true;

    try {
        const result = await pool.query(
            `INSERT INTO products (title, description, price, active)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [title.trim(), description || "", numPrice, isActive]
        );

        const newProduct = result.rows[0];

        // Emitir a todos los clientes para refresco en tiempo real
        io.emit("products:upsert", newProduct);

        res.status(201).json(newProduct);
    } catch (e) {
        res.status(500).json({ error: "Error interno al crear producto" });
    }
});

app.patch("/api/admin/products/:id", async (req, res) => {
    const productId = req.params.id;
    if (isNaN(Number(productId))) {
        return res.status(400).json({ error: "ID inválido" });
    }

    const { title, description, price, active } = req.body;

    let updates = [];
    let params = [];
    let paramIndex = 1;

    if (title !== undefined) {
        const trimmedTitle = String(title).trim();
        if (trimmedTitle.length < 2) {
            return res.status(400).json({ error: "Título debe tener al menos 2 caracteres" });
        }
        updates.push(`title = $${paramIndex++}`);
        params.push(trimmedTitle);
    }

    if (description !== undefined) {
        updates.push(`description = $${paramIndex++}`);
        params.push(description);
    }

    if (price !== undefined) {
        const numPrice = Number(price);
        if (!Number.isFinite(numPrice) || numPrice <= 0) {
            return res.status(400).json({ error: "Precio debe ser mayor a 0" });
        }
        updates.push(`price = $${paramIndex++}`);
        params.push(numPrice);
    }

    if (active !== undefined) {
        const isActive = Boolean(active);
        updates.push(`active = $${paramIndex++}`);
        params.push(isActive);
    }

    if (updates.length === 0) {
        return res.status(400).json({ error: "Nada para actualizar" });
    }

    try {
        params.push(productId);
        const query = `UPDATE products SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
        const result = await pool.query(query, params);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }

        const updatedProduct = result.rows[0];
        // Emitir a todos los clientes para refresco en tiempo real
        io.emit("products:upsert", updatedProduct);

        res.json(updatedProduct);
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
    }
});

app.delete("/api/admin/products/:id", async (req, res) => {
    const productId = req.params.id;
    if (isNaN(Number(productId))) {
        return res.status(400).json({ error: "ID inválido" });
    }

    try {
        const result = await pool.query(
            "DELETE FROM products WHERE id = $1 RETURNING id",
            [productId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Producto no encontrado" });
        }

        // Emitimos trigger para que todo el mundo recargue su catálogo
        io.emit("products:upsert", { id: productId, deleted: true });

        res.status(204).send();
    } catch (e) {
        res.status(500).json({ error: "Error interno" });
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