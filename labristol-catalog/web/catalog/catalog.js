// web/catalog/catalog.js
(() => {
    // Referencias a los contenedores principales a respetar
    const healthEl = document.getElementById("health");
    const productsEl = document.getElementById("products");

    // Drawer y componentes de carrito
    const cartBtn = document.getElementById("cartBtn");
    const cartCountEl = document.getElementById("cartCount");
    const cartOverlay = document.getElementById("cartOverlay");
    const cartDrawer = document.getElementById("cartDrawer");
    const cartCloseBtn = document.getElementById("cartCloseBtn");
    const cartItemsEl = document.getElementById("cartItems");
    const cartTotalEl = document.getElementById("cartTotal");
    const cartClearBtn = document.getElementById("cartClearBtn");
    const cartCheckoutBtn = document.getElementById("cartCheckoutBtn");

    // Checkout Modal
    const checkoutOverlay = document.getElementById("checkoutOverlay");
    const checkoutModal = document.getElementById("checkoutModal");
    const checkoutForm = document.getElementById("checkoutForm");
    const inputName = document.getElementById("inputName");
    const inputPhone = document.getElementById("inputPhone");
    const selectDelivery = document.getElementById("selectDelivery");
    const inputAddress = document.getElementById("inputAddress");
    const selectPayment = document.getElementById("selectPayment");
    const inputNotes = document.getElementById("inputNotes");
    const checkoutItems = document.getElementById("checkoutItems");
    const checkoutTotal = document.getElementById("checkoutTotal");
    const checkoutCloseBtn = document.getElementById("checkoutCloseBtn");
    const confirmOrderBtn = document.getElementById("confirmOrderBtn");

    const CART_KEY = "labristol_cart_v1";

    // -------------------------
    // Helpers
    // -------------------------
    const formatEuro = (n) => `€${Number(n || 0).toFixed(2)}`;

    function escapeHtml(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // -------------------------
    // Lógica Data Carrito LocalStorage
    // -------------------------
    function loadCart() {
        try {
            return JSON.parse(localStorage.getItem(CART_KEY)) || [];
        } catch {
            return [];
        }
    }

    function saveCart(cart) {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
    }

    function getCartTotals(cart) {
        const count = cart.reduce((acc, it) => acc + it.qty, 0);
        const total = cart.reduce((acc, it) => acc + (Number(it.price) * it.qty), 0);
        return { count, total };
    }

    // -------------------------
    // Carrito UI Updates
    // -------------------------
    function updateCartBadge() {
        const cart = loadCart();
        const { count } = getCartTotals(cart);
        if (cartCountEl) cartCountEl.textContent = String(count);
    }

    function renderCart() {
        if (!cartItemsEl || !cartTotalEl) return;

        const cart = loadCart();
        const { total } = getCartTotals(cart);
        cartTotalEl.textContent = formatEuro(total);

        if (!cart.length) {
            cartItemsEl.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); margin-top: 2rem;">
                    <span style="font-size: 2rem; display: block; margin-bottom: 1rem;">🛍️</span>
                    <p>Tu pedido está vacío</p>
                </div>`;
            return;
        }

        cartItemsEl.innerHTML = cart
            .map(
                (it) => `
        <div class="cart-item">
          <div class="cart-item__top">
            <div class="cart-item__title">${escapeHtml(it.title)}</div>
            <div class="cart-item__price">${formatEuro(Number(it.price) * it.qty)}</div>
          </div>
          <div class="cart-item__controls">
            <div class="qty-controls">
              <button aria-label="Reducir cantidad" class="qty-btn" type="button" data-qty="-1" data-id="${it.id}">−</button>
              <span class="qty-value">${it.qty}</span>
              <button aria-label="Aumentar cantidad" class="qty-btn" type="button" data-qty="1" data-id="${it.id}">+</button>
            </div>
          </div>
        </div>
      `
            )
            .join("");

        // Bind events a botones de cantidad
        cartItemsEl.querySelectorAll("button[data-qty]").forEach((btn) => {
            btn.addEventListener("click", () => {
                const id = Number(btn.getAttribute("data-id"));
                const delta = Number(btn.getAttribute("data-qty"));
                changeQty(id, delta);
            });
        });
    }

    // -------------------------
    // Drawer Acciones
    // -------------------------
    function openCart() {
        cartOverlay.classList.remove("hidden");
        cartDrawer.classList.remove("hidden");
        cartDrawer.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden"; // Prevent background scroll
        renderCart();
    }

    function closeCart() {
        cartOverlay.classList.add("hidden");
        cartDrawer.classList.add("hidden");
        cartDrawer.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    }

    cartBtn?.addEventListener("click", openCart);
    cartOverlay?.addEventListener("click", closeCart);
    cartCloseBtn?.addEventListener("click", closeCart);

    // -------------------------
    // Modificar Carrito
    // -------------------------
    function addToCart(product) {
        const cart = loadCart();
        const idx = cart.findIndex((x) => x.id === product.id);

        if (idx >= 0) {
            cart[idx].qty += 1;
        } else {
            cart.push({
                id: product.id,
                title: product.title,
                price: Number(product.price),
                qty: 1,
            });
        }

        saveCart(cart);
        updateCartBadge();

        // Efecto visual rápido de agregado (feedback opcional)
        openCart();
    }

    function changeQty(productId, delta) {
        const cart = loadCart();
        const idx = cart.findIndex((x) => x.id === productId);
        if (idx === -1) return;

        cart[idx].qty += delta;

        if (cart[idx].qty <= 0) {
            cart.splice(idx, 1);
        }

        saveCart(cart);
        updateCartBadge();
        renderCart();
    }

    function clearCart() {
        saveCart([]);
        updateCartBadge();
        renderCart();
    }

    cartClearBtn?.addEventListener("click", clearCart);

    cartCheckoutBtn?.addEventListener("click", () => {
        const cart = loadCart();
        if (!cart.length) {
            alert("No tienes productos cargados.");
            return;
        }
        openCheckoutModal();
    });

    // -------------------------
    // Funciones Modal Checkout
    // -------------------------
    function openCheckoutModal() {
        const cart = loadCart();
        const { total } = getCartTotals(cart);

        // Render summary
        checkoutItems.innerHTML = cart.map(it => `<div>${it.qty}x ${escapeHtml(it.title)} - ${formatEuro(it.price * it.qty)}</div>`).join("");
        checkoutTotal.textContent = formatEuro(total);

        checkoutOverlay.classList.remove("hidden");
        checkoutModal.classList.remove("hidden");
        checkoutModal.setAttribute("aria-hidden", "false");
        closeCart(); // Cerramos drawer
    }

    function closeCheckoutModal() {
        checkoutOverlay.classList.add("hidden");
        checkoutModal.classList.add("hidden");
        checkoutModal.setAttribute("aria-hidden", "true");
        checkoutForm.reset();
    }

    checkoutCloseBtn?.addEventListener("click", closeCheckoutModal);
    checkoutOverlay?.addEventListener("click", closeCheckoutModal);

    checkoutForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const cart = loadCart();
        if (!cart.length) return;

        confirmOrderBtn.disabled = true;
        confirmOrderBtn.textContent = "Procesando...";

        const payload = {
            customer_name: inputName.value.trim(),
            customer_phone: inputPhone.value.trim(),
            delivery_method: selectDelivery.value,
            delivery_address: inputAddress.value.trim(),
            payment_method: selectPayment.value,
            notes: inputNotes.value.trim(),
            items: cart,
            total: getCartTotals(cart).total
        };

        try {
            const res = await fetch("/api/orders", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (res.ok && data.ok) {
                alert(`¡Pedido procesado con éxito! (#${data.order_id})`);
                clearCart();
                closeCheckoutModal();
            } else {
                alert("Error al procesar el pedido: " + (data.error || "Desconocido"));
            }
        } catch (error) {
            alert("Error de conexión al procesar el pedido");
        } finally {
            confirmOrderBtn.disabled = false;
            confirmOrderBtn.textContent = "Confirmar Pedido";
        }
    });


    // -------------------------
    // Lógica Original / Endpoints Main
    // -------------------------
    async function loadHealth() {
        try {
            const res = await fetch("/api/health");
            const data = await res.json();
            // Manteniendo ID exacto #health, inyectamos la respuesta pero lo estilizamos.
            if (data.ok) {
                healthEl.innerHTML = `✓`;
                healthEl.setAttribute('data-status', 'ok');
                healthEl.title = "Health: " + JSON.stringify(data);
            } else {
                healthEl.innerHTML = `✗`;
                healthEl.title = "Error JSON: " + JSON.stringify(data);
            }
        } catch (e) {
            healthEl.innerHTML = `!`;
            healthEl.title = "Health Error";
        }
    }

    async function loadProducts() {
        try {
            const res = await fetch("/api/products");
            const products = await res.json();

            // Usando exactamente ul#products
            productsEl.innerHTML = products
                .map(
                    (p) => `
          <li class="product-card">
            <div class="product-card__body">
              <div class="product-card__top">
                <h4 class="product-card__title">${escapeHtml(p.title)}</h4>
                <span class="product-card__price">${formatEuro(p.price)}</span>
              </div>
              ${p.description ? `<p class="product-card__desc">${escapeHtml(p.description)}</p>` : ""}
            </div>
            <button class="btn btn--primary" type="button" data-add="${p.id}">Agregar</button>
          </li>
        `
                )
                .join("");

            // Listener a los botones agregar insertados dinámicamente
            productsEl.querySelectorAll("button[data-add]").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const id = Number(btn.getAttribute("data-add"));
                    const product = products.find((x) => x.id === id);
                    if (product) addToCart(product);
                });
            });
        } catch (e) {
            productsEl.innerHTML = `<li>Error cargando productos. Verifica la red.</li>`;
        }
    }

    // Socket: refresh realtime
    try {
        const socket = io();
        socket.on("connect", () => console.log("🟢 Conectado a socket:", socket.id));
        socket.on("products:upsert", () => {
            loadProducts();
        });
    } catch {
        // Fallback silencioso en caso extremo
        console.warn("Socket.io falló al cargar.");
    }

    // INIT GENERAL
    updateCartBadge();
    loadHealth();
    loadProducts();

})();