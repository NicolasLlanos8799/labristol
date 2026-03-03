(() => {
    let currentStatus = "pending";
    let ordersData = [];

    const socketStatusEl = document.getElementById("socketStatus");
    const refreshBtn = document.getElementById("refreshBtn");

    // View navigation
    const mainNavTabs = document.querySelectorAll(".view-selector");
    const ordersFilterNav = document.getElementById("ordersFilterNav");
    const viewOrders = document.getElementById("viewOrders");
    const viewProducts = document.getElementById("viewProducts");

    // Orders elements
    const tabs = document.querySelectorAll(".filter-btn");
    const ordersList = document.getElementById("ordersList");

    // Sound & Notifications references
    const soundToggleBtn = document.getElementById("soundToggleBtn");
    const soundStatusBadge = document.getElementById("soundStatusBadge");
    const toastContainer = document.getElementById("toastContainer");
    const pendingBadge = document.getElementById("pendingBadge");

    let soundEnabled = localStorage.getItem("admin_sound_enabled_v1") === "true";
    let audioCtx = null;
    let pendingCount = 0;
    let titleUnreadCount = 0;
    let highlightedOrderId = null; // To highlight after fetch
    const originalTitle = document.title;

    // Modal Orders
    const modalOverlay = document.getElementById("orderModalOverlay");
    const modal = document.getElementById("orderModal");
    const modalTitle = document.getElementById("modalTitle");
    const modalBody = document.getElementById("modalBody");
    const modalFooter = document.getElementById("modalFooter");
    const closeModalBtn = document.getElementById("closeModalBtn");

    // Products elements
    const productFilterSelect = document.getElementById("productFilterSelect");
    const productsTableBody = document.getElementById("productsTableBody");
    const addHeroProductBtn = document.getElementById("addHeroProductBtn");

    // Modal Products
    const productModalOverlay = document.getElementById("productModalOverlay");
    const productModal = document.getElementById("productModal");
    const productModalTitle = document.getElementById("productModalTitle");
    const closeProductBtn = document.getElementById("closeProductBtn");
    const cancelProductBtn = document.getElementById("cancelProductBtn");
    const productForm = document.getElementById("productForm");
    const productError = document.getElementById("productError");

    let currentView = "orders";
    let productsData = [];
    let currentProductFilter = "all";

    // Helpers
    const formatEuro = (n) => `€${Number(n || 0).toFixed(2)}`;
    const formatDate = (dateString) => {
        const d = new Date(dateString);
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' - ' + d.toLocaleDateString();
    };

    function escapeHtml(str) {
        return String(str ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Status map
    const statusText = {
        pending: "Nuevo",
        in_kitchen: "En cocina",
        ready: "Listo",
        delivered: "Entregado",
        cancelled: "Cancelado"
    };

    // -------------------------
    // Sound & Notifications
    // -------------------------
    function updateSoundUI() {
        if (!soundStatusBadge) return;
        if (soundEnabled) {
            soundStatusBadge.textContent = "Sound ON";
            soundStatusBadge.className = "sound-badge sound-on";
        } else {
            soundStatusBadge.textContent = "Sound OFF";
            soundStatusBadge.className = "sound-badge sound-off";
        }
    }

    soundToggleBtn?.addEventListener("click", () => {
        soundEnabled = !soundEnabled;
        localStorage.setItem("admin_sound_enabled_v1", soundEnabled);
        updateSoundUI();

        // Initialize AudioContext on first user interaction if enabled
        if (soundEnabled && !audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume();
        }
    });

    async function playNewOrderSound() {
        if (!soundEnabled) return;

        try {
            if (!audioCtx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                audioCtx = new AudioContext();
            }
            if (audioCtx.state === "suspended") {
                await audioCtx.resume();
            }

            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            osc.type = "sine";
            // Set un tono doble más audible (timbre)
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5

            gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            // Volumen más alto (0.8 en vez de 0.5) y release un poco más largo
            gainNode.gain.linearRampToValueAtTime(0.8, audioCtx.currentTime + 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.35);

            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            osc.start(audioCtx.currentTime);
            osc.stop(audioCtx.currentTime + 0.4);

        } catch (error) {
            console.warn("Audio blocked by browser. User must interact first.", error);
        }
    }

    function showToast(message, type = "success") {
        if (!toastContainer) return;
        const toast = document.createElement("div");
        toast.className = `toast ${type}`;
        toast.textContent = message;
        toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.classList.add("fade-out");
            toast.addEventListener("animationend", () => toast.remove());
        }, 5000);
    }

    function updateTitleUnread() {
        if (titleUnreadCount > 0) {
            document.title = `🟢 (${titleUnreadCount}) ${originalTitle}`;
        } else {
            document.title = originalTitle;
        }
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) {
            titleUnreadCount = 0;
            updateTitleUnread();
        }
    });

    // Load orders
    async function fetchOrders(status) {
        try {
            ordersList.innerHTML = `<p style="text-align:center; padding: 2rem; color:var(--text-muted);">Cargando...</p>`;
            const res = await fetch(`/api/admin/orders?status=${status}`);
            if (!res.ok) throw new Error("Error en red");
            const data = await res.json();
            ordersData = data;
            renderOrders();
        } catch (e) {
            ordersList.innerHTML = `<p style="text-align:center; padding: 2rem; color:var(--color-danger);">Error al cargar pedidos.</p>`;
        }
    }

    function renderOrders() {
        if (!ordersData || ordersData.length === 0) {
            ordersList.innerHTML = `<p style="text-align:center; padding: 2rem; color:var(--text-muted);">No hay pedidos en este estado.</p>`;
            return;
        }

        ordersList.innerHTML = ordersData.map(order => {
            const isHighlighted = order.id === highlightedOrderId ? "order-card--highlight" : "";
            return `
            <div class="order-card ${isHighlighted}" data-id="${order.id}">
                <div class="card-header">
                    <div>
                        <div class="card-title">Pedido #${order.id}</div>
                        <div class="card-time">${formatDate(order.created_at)}</div>
                    </div>
                    <div class="card-total">${formatEuro(order.total)}</div>
                </div>
                <div class="card-body">
                    <p><strong>Cliente:</strong> ${escapeHtml(order.customer_name)} (${escapeHtml(order.customer_phone)})</p>
                    <p><strong>Entrega:</strong> ${order.delivery_method === "delivery" ? "🚀 Domicilio" : "🏪 Recogida"} (${escapeHtml(order.delivery_time)})</p>
                    <p><strong>Pago:</strong> ${escapeHtml(order.payment_method)}</p>
                </div>
                <div class="card-footer">
                    <button class="btn btn-secondary view-detail-btn" data-id="${order.id}">Ver detalle</button>
                    ${getFastActionButtons(order)}
                </div>
            </div>
        `}).join("");

        highlightedOrderId = null; // reset highlight after render

        // Bind events
        ordersList.querySelectorAll(".view-detail-btn").forEach(btn => {
            btn.addEventListener("click", () => openOrderDetails(btn.getAttribute("data-id")));
        });

        ordersList.querySelectorAll(".fast-action-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const id = btn.getAttribute("data-id");
                const newStatus = btn.getAttribute("data-status");
                updateOrderStatus(id, newStatus);
            });
        });
    }

    function getFastActionButtons(order) {
        let btns = "";
        const id = order.id;
        if (order.status === "pending") {
            btns += `<button class="btn btn-primary fast-action-btn" data-id="${id}" data-status="in_kitchen">A cocina</button>`;
        } else if (order.status === "in_kitchen") {
            btns += `<button class="btn btn-warning fast-action-btn" data-id="${id}" data-status="ready">Listo</button>`;
        } else if (order.status === "ready") {
            btns += `<button class="btn btn-success fast-action-btn" data-id="${id}" data-status="delivered">Entregado</button>`;
        }
        return btns;
    }

    // Change status
    async function updateOrderStatus(orderId, newStatus) {
        try {
            const res = await fetch(`/api/admin/orders/${orderId}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus })
            });
            if (res.ok) {
                fetchOrders(currentStatus);
                closeModal();
            } else {
                alert("Error al actualizar estado");
            }
        } catch (e) {
            alert("Error de red");
        }
    }

    // Modal Details
    async function openOrderDetails(orderId) {
        modalOverlay.classList.remove("hidden");
        modal.classList.remove("hidden");
        modal.setAttribute("aria-hidden", "false");
        modalTitle.textContent = `Pedido #${orderId} - Cargando...`;
        modalBody.innerHTML = `<p style="text-align:center; padding: 2rem;">Cargando detalles...</p>`;
        modalFooter.innerHTML = "";

        try {
            const res = await fetch(`/api/admin/orders/${orderId}`);
            if (!res.ok) throw new Error("No encontrado");
            const data = await res.json();

            const order = data.order;
            const items = data.items;

            modalTitle.textContent = `Pedido #${order.id} - ${statusText[order.status]}`;

            modalBody.innerHTML = `
                <div class="detail-section">
                    <h4>Datos del Cliente</h4>
                    <p><strong>Nombre:</strong> ${escapeHtml(order.customer_name)}</p>
                    <p><strong>Teléfono:</strong> <a href="tel:${escapeHtml(order.customer_phone)}" style="color:var(--color-primary);">${escapeHtml(order.customer_phone)}</a></p>
                </div>
                <div class="detail-section">
                    <h4>Entrega y Pago</h4>
                    <p><strong>Tipo:</strong> ${order.delivery_method === "delivery" ? "🚀 Envío a domicilio" : "🏪 Recogida en local"}</p>
                    <p><strong>Horario:</strong> ${escapeHtml(order.delivery_time)}</p>
                    ${order.delivery_method === "delivery" ? `<p><strong>Dirección:</strong> ${escapeHtml(order.delivery_address)}</p>` : ""}
                    <p><strong>Método de pago:</strong> ${escapeHtml(order.payment_method)}</p>
                    ${order.notes ? `<p><strong>Notas:</strong> <span style="color:var(--color-warning);">${escapeHtml(order.notes)}</span></p>` : ""}
                </div>

                <div class="detail-section">
                    <h4>Items del pedido</h4>
                    <table class="items-table">
                        <thead>
                            <tr>
                                <th>Cant.</th>
                                <th>Producto</th>
                                <th class="text-right">P. Unit</th>
                                <th class="text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.map(it => `
                                <tr>
                                    <td>${it.qty}x</td>
                                    <td>${escapeHtml(it.title)}</td>
                                    <td class="text-right">${formatEuro(it.unit_price)}</td>
                                    <td class="text-right"><strong>${formatEuro(it.line_total)}</strong></td>
                                </tr>
                            `).join("")}
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3" class="text-right" style="padding-top:1rem;"><strong>Total a pagar:</strong></td>
                                <td class="text-right" style="padding-top:1rem; font-size:1.2rem; color:var(--color-success);"><strong>${formatEuro(order.total)}</strong></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;

            // Action buttons in modal
            let footerBtns = "";
            if (order.status === "pending") {
                footerBtns += `<button class="btn btn-primary modal-action-btn" data-status="in_kitchen">Mandar a Cocina</button>`;
            } else if (order.status === "in_kitchen") {
                footerBtns += `<button class="btn btn-warning modal-action-btn" data-status="ready">Marcar como Listo</button>`;
            } else if (order.status === "ready") {
                footerBtns += `<button class="btn btn-success modal-action-btn" data-status="delivered">Completar (Entregado)</button>`;
            }

            if (["pending", "in_kitchen", "ready"].includes(order.status)) {
                footerBtns += `<button class="btn btn-danger modal-action-btn" data-status="cancelled">Cancelar Pedido</button>`;
            }

            modalFooter.innerHTML = footerBtns;

            modalFooter.querySelectorAll(".modal-action-btn").forEach(btn => {
                btn.addEventListener("click", () => {
                    const status = btn.getAttribute("data-status");
                    if (status === "cancelled" && !confirm("¿Seguro que deseas cancelar este pedido?")) return;
                    updateOrderStatus(order.id, status);
                });
            });

        } catch (e) {
            modalBody.innerHTML = `<p style="color:var(--color-danger); text-align:center;">Error al cargar detalle del pedido.</p>`;
        }
    }

    function closeModal() {
        modalOverlay.classList.add("hidden");
        modal.classList.add("hidden");
        modal.setAttribute("aria-hidden", "true");
    }

    closeModalBtn.addEventListener("click", closeModal);
    modalOverlay.addEventListener("click", closeModal);

    // Tabs logic
    tabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            tabs.forEach(t => t.classList.remove("active"));
            e.target.classList.add("active");
            currentStatus = e.target.getAttribute("data-status");

            // Reset pending badge when clicking on "pending"
            if (currentStatus === "pending") {
                pendingCount = 0;
                if (pendingBadge) pendingBadge.classList.add("hidden");
            }

            fetchOrders(currentStatus);
        });
    });

    refreshBtn.addEventListener("click", () => {
        if (currentView === "orders") {
            fetchOrders(currentStatus);
        } else {
            fetchProducts();
        }
    });

    // Main View Routing Logic
    mainNavTabs.forEach(tab => {
        tab.addEventListener("click", (e) => {
            mainNavTabs.forEach(t => t.classList.remove("active"));
            e.target.classList.add("active");
            currentView = e.target.getAttribute("data-view");

            if (currentView === "orders") {
                ordersFilterNav.classList.remove("hidden");
                viewOrders.classList.remove("hidden");
                viewProducts.classList.add("hidden");
                fetchOrders(currentStatus);
            } else if (currentView === "products") {
                ordersFilterNav.classList.add("hidden");
                viewOrders.classList.add("hidden");
                viewProducts.classList.remove("hidden");
                fetchProducts();
            }
        });
    });

    // ==========================================
    // PRODUCTS SECTION LOGIC
    // ==========================================

    async function fetchProducts() {
        try {
            productsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--text-muted);">Cargando...</td></tr>`;
            const res = await fetch(`/api/admin/products?active=${currentProductFilter}`);
            if (!res.ok) throw new Error("Network error");
            productsData = await res.json();
            renderProducts();
        } catch (e) {
            productsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--color-danger);">Error al cargar productos.</td></tr>`;
        }
    }

    function renderProducts() {
        if (!productsData || productsData.length === 0) {
            productsTableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--text-muted);">No hay productos con este filtro.</td></tr>`;
            return;
        }

        productsTableBody.innerHTML = productsData.map(prod => `
            <tr>
                <td style="color:var(--text-muted); padding:1rem;">#${prod.id}</td>
                <td style="font-weight:600; padding:1rem;">${escapeHtml(prod.title)}</td>
                <td style="color:var(--text-muted); padding:1rem; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${escapeHtml(prod.description)}
                </td>
                <td class="text-right" style="font-weight:600; padding:1rem;">${formatEuro(prod.price)}</td>
                <td style="padding:1rem;">
                    <span class="sound-badge ${prod.active ? "sound-on" : "sound-off"}">
                        ${prod.active ? "Activo" : "Inactivo"}
                    </span>
                </td>
                <td style="text-align:center; padding:1rem; display:flex; gap:0.5rem; justify-content:center;">
                    <button class="btn btn-secondary edit-prod-btn" data-id="${prod.id}" style="padding:0.4rem 0.8rem; font-size:0.85rem; flex:none;">Editar</button>
                    ${prod.active
                ? `<button class="btn btn-warning toggle-prod-btn" data-id="${prod.id}" data-action="deactivate" style="padding:0.4rem 0.8rem; font-size:0.85rem; flex:none;">Desactivar</button>`
                : `<button class="btn btn-primary toggle-prod-btn" data-id="${prod.id}" data-action="activate" style="padding:0.4rem 0.8rem; font-size:0.85rem; flex:none;">Activar</button>`
            }
                    <button class="btn btn-danger delete-prod-btn" data-id="${prod.id}" style="padding:0.4rem 0.8rem; font-size:0.85rem; flex:none;">Eliminar</button>
                </td>
            </tr>
        `).join("");

        // Product Events
        productsTableBody.querySelectorAll(".edit-prod-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = parseInt(btn.getAttribute("data-id"));
                const prod = productsData.find(p => p.id === id);
                if (prod) openProductModal(prod);
            });
        });

        productsTableBody.querySelectorAll(".toggle-prod-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = btn.getAttribute("data-id");
                const action = btn.getAttribute("data-action");

                try {
                    const isActiveTarget = action === "activate";
                    const res = await fetch(`/api/admin/products/${id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ active: isActiveTarget })
                    });

                    if (res.ok) {
                        fetchProducts();
                    } else {
                        alert("Error al cambiar estado");
                    }
                } catch (e) {
                    alert("Error de red");
                }
            });
        });

        productsTableBody.querySelectorAll(".delete-prod-btn").forEach(btn => {
            btn.addEventListener("click", async () => {
                if (!confirm("⚠️ ¿Estás completamente seguro de ELIMINAR definitivamente este producto? Esto no se puede deshacer y borrará el registro de la Base de Datos.")) return;

                const id = btn.getAttribute("data-id");
                try {
                    const res = await fetch(`/api/admin/products/${id}`, { method: "DELETE" });

                    if (res.ok) {
                        fetchProducts();
                        showToast(`Producto #${id} eliminado definitivamente.`, "success");
                    } else {
                        alert("Error al eliminar definitivamente");
                    }
                } catch (e) {
                    alert("Error de red");
                }
            });
        });
    }

    productFilterSelect.addEventListener("change", (e) => {
        currentProductFilter = e.target.value;
        fetchProducts();
    });

    // Product Modal Logic
    function openProductModal(prod = null) {
        productError.classList.add("hidden");
        productError.textContent = "";

        if (prod) {
            productModalTitle.textContent = "Editar Producto #" + prod.id;
            document.getElementById("prodId").value = prod.id;
            document.getElementById("prodTitle").value = prod.title || "";
            document.getElementById("prodDesc").value = prod.description || "";
            document.getElementById("prodPrice").value = prod.price || "";
            document.getElementById("prodActive").checked = !!prod.active;
        } else {
            productModalTitle.textContent = "Nuevo Producto";
            productForm.reset();
            document.getElementById("prodId").value = "";
            document.getElementById("prodActive").checked = true;
        }

        productModalOverlay.classList.remove("hidden");
        productModal.classList.remove("hidden");
    }

    function closeProductModal() {
        productModalOverlay.classList.add("hidden");
        productModal.classList.add("hidden");
    }

    addHeroProductBtn.addEventListener("click", () => openProductModal(null));
    closeProductBtn.addEventListener("click", closeProductModal);
    cancelProductBtn.addEventListener("click", closeProductModal);
    productModalOverlay.addEventListener("click", closeProductModal);

    productForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const id = document.getElementById("prodId").value;
        const payload = {
            title: document.getElementById("prodTitle").value.trim(),
            description: document.getElementById("prodDesc").value.trim(),
            price: parseFloat(document.getElementById("prodPrice").value),
            active: document.getElementById("prodActive").checked
        };

        if (!payload.title || isNaN(payload.price) || payload.price <= 0) {
            productError.textContent = "Título obligatorio y precio mayor a 0.";
            productError.classList.remove("hidden");
            return;
        }

        try {
            const url = id ? `/api/admin/products/${id}` : "/api/admin/products";
            const method = id ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Error al guardar");
            }

            closeProductModal();
            fetchProducts();
            showToast(id ? "Producto modificado" : "Producto creado", "success");
        } catch (err) {
            productError.textContent = err.message;
            productError.classList.remove("hidden");
        }
    });

    // Socket Setup
    try {
        const socket = io();
        window.socket = socket;
        socket.on("connect", () => {
            socketStatusEl.textContent = "● Online";
            socketStatusEl.className = "socket-status online";
        });
        socket.on("disconnect", () => {
            socketStatusEl.textContent = "● Offline";
            socketStatusEl.className = "socket-status offline";
        });

        socket.on("orders:new", (data) => {
            playNewOrderSound();
            showToast(`Nuevo pedido #${data.order_id} • ${formatEuro(data.total)} • ${data.delivery_time}`, "success");

            if (document.hidden) {
                titleUnreadCount++;
                updateTitleUnread();
            }

            if (currentStatus === "pending") {
                highlightedOrderId = data.order_id;
                fetchOrders("pending");
            } else {
                pendingCount++;
                if (pendingBadge) {
                    pendingBadge.textContent = pendingCount;
                    pendingBadge.classList.remove("hidden");
                }
            }
        });

        socket.on("orders:status", (data) => {
            fetchOrders(currentStatus);
        });

    } catch (e) {
        socketStatusEl.textContent = "● Error";
    }

    // Init
    updateSoundUI();
    fetchOrders("pending");

})();
