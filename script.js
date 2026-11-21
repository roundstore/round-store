
// ==============================
// ROUND STORE - FULL INTEGRATED VERSION
// 메인 기능 + PRO 분석 + 접이식 상단 재고 알림
// ==============================

const $ = (id) => document.getElementById(id);

function createId() {
    return "rs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

// ==============================
// 데이터 불러오기
// ==============================

function loadData(key, defaultValue) {
    try {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : defaultValue;
    } catch (error) {
        console.error("데이터 불러오기 실패:", error);
        return defaultValue;
    }
}

let products = loadData("roundStoreProducts", []);
let inventoryHistory = loadData("roundStoreInventoryHistory", []);
let salesHistory = loadData("roundStoreSalesHistory", []);

if (!Array.isArray(products)) products = [];
if (!Array.isArray(inventoryHistory)) inventoryHistory = [];
if (!Array.isArray(salesHistory)) salesHistory = [];

products = products.map(product => ({
    ...product,
    price: Number(product.price) || 0,
    cost: Number(product.cost) || 0,
    stock: Number(product.stock) || 0
}));

let editingIndex = null;
let editingHistoryId = null;

// ==============================
// 데이터 저장
// ==============================

function saveProducts() {
    try {
        localStorage.setItem("roundStoreProducts", JSON.stringify(products));
        return true;
    } catch (error) {
        alert("상품 저장에 실패했습니다.");
        console.error(error);
        return false;
    }
}

function saveInventoryHistory() {
    try {
        localStorage.setItem("roundStoreInventoryHistory", JSON.stringify(inventoryHistory));
        return true;
    } catch (error) {
        alert("입출고 기록 저장에 실패했습니다.");
        console.error(error);
        return false;
    }
}

function saveSalesHistory() {
    try {
        localStorage.setItem("roundStoreSalesHistory", JSON.stringify(salesHistory));
        return true;
    } catch (error) {
        alert("판매 기록 저장에 실패했습니다.");
        console.error(error);
        return false;
    }
}

function saveAllData() {
    return saveProducts() && saveInventoryHistory() && saveSalesHistory();
}

// ==============================
// 기존 데이터 보정
// ==============================

function migrateExistingData() {
    let changed = false;
    const now = Date.now();

    products.forEach(product => {
        if (!product.id) {
            product.id = createId();
            changed = true;
        }

        if (product.baseStock === undefined) {
            const netMovement = inventoryHistory
                .filter(history => history.productId === product.id)
                .reduce((total, history) => {
                    return total + (
                        history.type === "in"
                            ? Number(history.quantity)
                            : -Number(history.quantity)
                    );
                }, 0);

            product.baseStock = product.stock - netMovement;
            changed = true;
        } else {
            product.baseStock = Number(product.baseStock) || 0;
        }
    });

    inventoryHistory.forEach((history, index) => {
        if (!history.id) {
            history.id = createId();
            changed = true;
        }

        if (!history.productId) {
            const product = products.find(item => item.name === history.productName);
            if (product) {
                history.productId = product.id;
                changed = true;
            }
        }

        if (!history.createdAt) {
            history.createdAt = now - index;
            changed = true;
        }

        history.quantity = Number(history.quantity) || 0;
        history.type = history.type === "in" ? "in" : "out";

        if (
            history.type === "out" &&
            (
                history.salePrice === null ||
                history.salePrice === undefined ||
                history.salePrice === "" ||
                !Number.isFinite(Number(history.salePrice))
            )
        ) {
            const product = products.find(item => item.id === history.productId);
            history.salePrice = product ? product.price : 0;
            changed = true;
        }
    });

    salesHistory.forEach((sale, index) => {
        if (!sale.id) {
            sale.id = createId();
            changed = true;
        }

        if (!sale.createdAt) {
            sale.createdAt = now - index;
            changed = true;
        }

        sale.quantity = Number(sale.quantity) || 0;
        sale.salePrice = Number(sale.salePrice) || 0;

        const calculatedTotal = sale.quantity * sale.salePrice;

        if (sale.total !== calculatedTotal) {
            sale.total = calculatedTotal;
            changed = true;
        }

        const product = products.find(item => item.id === sale.productId);

        if (product && sale.productName !== product.name) {
            sale.productName = product.name;
            changed = true;
        }
    });

    if (changed) saveAllData();
}

// ==============================
// 재고 자동 재계산
// ==============================

function recalculateProductStocks() {
    products.forEach(product => {
        product.stock = Number(product.baseStock) || 0;
    });

    const events = [
        ...inventoryHistory.map(history => ({ ...history, eventType: "inventory" })),
        ...salesHistory.map(sale => ({ ...sale, eventType: "sale" }))
    ].sort((a, b) => Number(a.createdAt) - Number(b.createdAt));

    for (const event of events) {
        const product = products.find(item => item.id === event.productId);
        if (!product) continue;

        const quantity = Number(event.quantity);

        if (!Number.isInteger(quantity) || quantity <= 0) return false;

        if (event.eventType === "sale") {
            product.stock -= quantity;
        } else if (event.type === "in") {
            product.stock += quantity;
        } else if (event.type === "out") {
            product.stock -= quantity;
        } else {
            return false;
        }

        if (product.stock < 0) return false;

        if (event.eventType === "sale") {
            const originalSale = salesHistory.find(sale => sale.id === event.id);
            if (originalSale) originalSale.stockAfter = product.stock;
        } else {
            const originalHistory = inventoryHistory.find(history => history.id === event.id);
            if (originalHistory) originalHistory.stockAfter = product.stock;
        }
    }

    return true;
}

// ==============================
// 공통 기능
// ==============================

function formatMoney(number) {
    return "₩ " + Math.round(Number(number) || 0).toLocaleString("ko-KR");
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, character => {
        const entities = {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        };
        return entities[character];
    });
}

function getLatestCreatedAt() {
    const allRecords = [...inventoryHistory, ...salesHistory];
    return allRecords.reduce((latest, record) => {
        return Math.max(latest, Number(record.createdAt) || 0);
    }, 0);
}

function getThirtyDayStart() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 29);
    return date.getTime();
}

function getRecentSales() {
    const start = getThirtyDayStart();
    const now = Date.now();

    return salesHistory.filter(sale => {
        const createdAt = Number(sale.createdAt) || 0;
        return createdAt >= start && createdAt <= now;
    });
}

function getSaleCost(sale) {
    if (
        sale.costSnapshot !== undefined &&
        Number.isFinite(Number(sale.costSnapshot))
    ) {
        return Number(sale.costSnapshot);
    }

    const product = products.find(item => item.id === sale.productId);
    return product ? Number(product.cost) || 0 : 0;
}

function getSaleProfit(sale) {
    const quantity = Number(sale.quantity) || 0;
    const price = Number(sale.salePrice) || 0;
    const cost = getSaleCost(sale);
    return (price - cost) * quantity;
}

// ==================================================
// 상단 알림 시스템
// ==================================================

function applyAlertStyles() {
    if ($("round-store-alert-styles")) return;

    const style = document.createElement("style");
    style.id = "round-store-alert-styles";

    style.textContent = `
        @media (min-width: 751px) {
            .sidebar {
                position: fixed;
                top: 0;
                left: 0;
                height: 100vh;
                min-height: 100vh;
                overflow-y: auto;
                z-index: 100;
            }

            .main {
                margin-left: 245px;
                width: calc(100% - 245px);
            }
        }

        .topbar {
            position: sticky;
            top: 0;
            z-index: 90;
            background: #f5f6fa;
            padding-top: 12px;
            padding-bottom: 12px;
        }

        .round-alert-area {
            margin-top: 12px;
            margin-bottom: 8px;
            width: 100%;
        }

        .round-alert-toggle {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            width: 100%;
            border: 1px solid #e1e4ed;
            border-radius: 11px;
            padding: 12px 15px;
            background: #ffffff;
            color: #30364a;
            font-size: 13px;
            font-weight: 800;
            cursor: pointer;
            text-align: left;
            transition: 0.2s;
        }

        .round-alert-toggle:hover {
            border-color: #b9b2ed;
            background: #faf9ff;
        }

        .round-alert-toggle:focus-visible,
        .round-alert-product:focus-visible {
            outline: 3px solid #a99af5;
            outline-offset: 3px;
        }

        .round-alert-toggle.danger {
            background: #fff5f5;
            border-color: #f0cccc;
            color: #c73535;
        }

        .round-alert-toggle.urgent {
            background: #fff8f2;
            border-color: #f0d8c5;
            color: #c45b1d;
        }

        .round-alert-toggle.warning {
            background: #fffbee;
            border-color: #f0e5bd;
            color: #947014;
        }

        .round-alert-toggle.safe {
            background: #effaf3;
            border-color: #d4ecdc;
            color: #23845f;
        }

        .round-alert-summary {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 7px;
        }

        .round-alert-chevron {
            flex: 0 0 auto;
            font-size: 16px;
            transition: transform 0.2s;
        }

        .round-alert-toggle[aria-expanded="true"] .round-alert-chevron {
            transform: rotate(180deg);
        }

        .round-alert-details {
            display: none;
            margin-top: 8px;
            max-height: 220px;
            overflow-y: auto;
            overscroll-behavior: contain;
            border: 1px solid #e4e6ed;
            border-radius: 11px;
            padding: 10px;
            background: #ffffff;
            box-shadow: 0 5px 15px rgba(20, 25, 45, 0.05);
        }

        .round-alert-details.open {
            display: block;
        }

        .round-alert-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 12px;
        }

        .round-alert-group:last-child {
            margin-bottom: 0;
        }

        .round-alert-group-title {
            padding: 3px 4px;
            font-size: 11px;
            font-weight: 800;
            color: #70768a;
        }

        .round-alert-product {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            width: 100%;
            border: 1px solid #e7e9ef;
            border-radius: 8px;
            padding: 10px 12px;
            background: #ffffff;
            color: #34394b;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            text-align: left;
            transition: 0.15s;
        }

        .round-alert-product:hover {
            border-color: #aaa0e8;
            background: #f7f5ff;
        }

        .round-alert-product.danger {
            color: #c73535;
        }

        .round-alert-product.urgent {
            color: #c45b1d;
        }

        .round-alert-product.warning {
            color: #947014;
        }

        .round-alert-product-name {
            overflow-wrap: anywhere;
        }

        .round-alert-stock {
            flex: 0 0 auto;
            white-space: nowrap;
            font-weight: 800;
        }

        .round-alert-empty {
            font-size: 12px;
            font-weight: 700;
        }

        .dashboard-alert-item {
            cursor: pointer;
        }

        section[id] {
            scroll-margin-top: 25px;
        }

        @media (max-width: 750px) {
            .sidebar {
                position: relative;
                height: auto;
                min-height: auto;
                overflow: visible;
            }

            .main {
                margin-left: 0;
                width: 100%;
            }

            .round-alert-details {
                max-height: 180px;
            }
        }
    `;

    document.head.appendChild(style);
}

function createAlertArea() {
    let area = $("round-alert-area");
    if (area) return area;

    const topbar = document.querySelector(".topbar");
    if (!topbar) return null;

    area = document.createElement("div");
    area.id = "round-alert-area";
    area.className = "round-alert-area";
    area.setAttribute("aria-label", "재고 알림");

    topbar.appendChild(area);
    return area;
}

// ==============================
// 알림에서 상품별 재고 화면 이동
// ==============================

function goToInventory(product) {
    const section = $("inventory-section");
    if (!section) return;

    section.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });

    document.querySelectorAll(".menu-item").forEach(item => {
        item.classList.remove("active");

        if (item.getAttribute("href") === "#inventory-section") {
            item.classList.add("active");
        }
    });

    if ($("page-title")) {
        $("page-title").textContent = "재고 관리";
    }

    if (product) {
        const index = products.findIndex(item => item.id === product.id);
        const select = $("inventory-product");

        if (select && index >= 0) {
            select.value = String(index);
        }
    }
}

// ==============================
// 접이식 상품별 상단 재고 알림
// ==============================

function updateTopAlerts() {
    const area = createAlertArea();
    if (!area) return;

    const outOfStock = products.filter(product => Number(product.stock) === 0);

    const urgentStock = products.filter(product => {
        return Number(product.stock) >= 1 && Number(product.stock) <= 3;
    });

    const warningStock = products.filter(product => {
        return Number(product.stock) >= 4 && Number(product.stock) <= 5;
    });

    const totalAlerts =
        outOfStock.length + urgentStock.length + warningStock.length;

    // 업데이트 전 펼쳐져 있었는지 기억
    const wasOpen = area.querySelector(".round-alert-details")?.classList.contains("open") || false;

    area.innerHTML = "";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "round-alert-toggle";
    toggle.setAttribute("aria-expanded", String(wasOpen));

    const summary = document.createElement("span");
    summary.className = "round-alert-summary";

    const chevron = document.createElement("span");
    chevron.className = "round-alert-chevron";
    chevron.textContent = wasOpen ? "▲" : "▼";
    chevron.setAttribute("aria-hidden", "true");

    const details = document.createElement("div");
    details.className = "round-alert-details";
    details.setAttribute("aria-label", "재고 알림 상세 목록");

    if (wasOpen) details.classList.add("open");

    if (totalAlerts === 0) {
        toggle.classList.add("safe");
        summary.textContent = "✓ 긴급 재고 알림 없음";
        details.textContent = "현재 품절 또는 재고 주의 상품이 없습니다.";
    } else {
        if (outOfStock.length > 0) {
            toggle.classList.add("danger");
        } else if (urgentStock.length > 0) {
            toggle.classList.add("urgent");
        } else {
            toggle.classList.add("warning");
        }

        const summaryParts = [];

        if (outOfStock.length > 0) {
            summaryParts.push(`🚨 품절 ${outOfStock.length}개`);
        }

        if (urgentStock.length > 0) {
            summaryParts.push(`⚠️ 긴급재고 ${urgentStock.length}개`);
        }

        if (warningStock.length > 0) {
            summaryParts.push(`재고주의 ${warningStock.length}개`);
        }

        summary.textContent = summaryParts.join(" · ");

        function addAlertGroup(label, matchingProducts, type) {
            if (matchingProducts.length === 0) return;

            const group = document.createElement("div");
            group.className = "round-alert-group";

            const heading = document.createElement("div");
            heading.className = "round-alert-group-title";
            heading.textContent = `${label} (${matchingProducts.length}개)`;

            group.appendChild(heading);

            matchingProducts.forEach(product => {
                const button = document.createElement("button");
                button.type = "button";
                button.className = `round-alert-product ${type}`;

                const name = document.createElement("span");
                name.className = "round-alert-product-name";
                name.textContent = product.name;

                const stock = document.createElement("span");
                stock.className = "round-alert-stock";
                stock.textContent = `재고 ${product.stock}개`;

                button.appendChild(name);
                button.appendChild(stock);

                button.setAttribute(
                    "aria-label",
                    `${product.name}, 현재 재고 ${product.stock}개. 재고 관리 화면으로 이동`
                );

                button.addEventListener("click", () => {
                    goToInventory(product);
                });

                group.appendChild(button);
            });

            details.appendChild(group);
        }

        addAlertGroup("🚨 품절 상품", outOfStock, "danger");
        addAlertGroup("⚠️ 긴급 재고 상품", urgentStock, "urgent");
        addAlertGroup("재고 주의 상품", warningStock, "warning");
    }

    toggle.appendChild(summary);
    toggle.appendChild(chevron);

    toggle.addEventListener("click", () => {
        const isOpen = details.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(isOpen));
        chevron.textContent = isOpen ? "▲" : "▼";
    });

    area.appendChild(toggle);
    area.appendChild(details);
}

// ==============================
// 사이드바 메뉴 이동
// ==============================

function setupNavigation() {
    const menuItems = document.querySelectorAll(".menu-item");
    const pageTitle = $("page-title");

    const titles = {
        "dashboard-section": "Dashboard",
        "product-section": "상품 관리",
        "inventory-section": "재고 관리",
        "sales-section": "판매 관리",
        "pro-section": "PRO 분석"
    };

    menuItems.forEach(item => {
        item.addEventListener("click", event => {
            const targetId = item.getAttribute("href")?.replace("#", "");
            const target = $(targetId);
            if (!target) return;

            event.preventDefault();

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });

            menuItems.forEach(menu => menu.classList.remove("active"));
            item.classList.add("active");

            if (pageTitle) {
                pageTitle.textContent = titles[targetId] || "ROUND STORE";
            }
        });
    });
}

// ==============================
// 재고 관리 상품 선택
// ==============================

function updateInventoryOptions() {
    const select = $("inventory-product");
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "상품을 선택하세요";
    select.appendChild(defaultOption);

    products.forEach((product, index) => {
        const option = document.createElement("option");
        option.value = String(index);
        option.textContent = product.name;
        select.appendChild(option);
    });

    if (previousValue !== "" && products[Number(previousValue)]) {
        select.value = previousValue;
    }
}

// ==============================
// 판매 관리 상품 선택
// ==============================

function updateSalesOptions() {
    const select = $("sales-product");
    if (!select) return;

    const previousValue = select.value;
    select.innerHTML = "";

    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "상품을 선택하세요";
    select.appendChild(defaultOption);

    products.forEach(product => {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = product.name;
        select.appendChild(option);
    });

    if (products.some(product => product.id === previousValue)) {
        select.value = previousValue;
    }

    updateSalesPrice();
}

// ==============================
// 판매 가격 및 총액 계산
// ==============================

function updateSalesPrice() {
    const productSelect = $("sales-product");
    const priceInput = $("sales-price");
    const totalDisplay = $("sales-total");

    if (!productSelect || !priceInput || !totalDisplay) return;

    const product = products.find(item => item.id === productSelect.value);
    priceInput.value = product ? product.price : "";

    updateSalesTotal();
}

function updateSalesTotal() {
    const quantity = Number($("sales-quantity")?.value) || 0;
    const price = Number($("sales-price")?.value) || 0;
    const totalDisplay = $("sales-total");

    if (totalDisplay) {
        totalDisplay.textContent = formatMoney(quantity * price);
    }
}

// ==============================
// 대시보드
// ==============================

function updateDashboard() {
    const productCount = products.length;

    const lowStockProducts = products.filter(product => product.stock <= 5);
    const lowStockCount = lowStockProducts.length;

    const totalProfit = products.reduce((total, product) => {
        return total + (product.price - product.cost) * product.stock;
    }, 0);

    const recentSales = getRecentSales();

    const totalSales = recentSales.reduce((total, sale) => {
        return total +
            (Number(sale.quantity) || 0) *
            (Number(sale.salePrice) || 0);
    }, 0);

    if ($("total-sales")) $("total-sales").textContent = formatMoney(totalSales);
    if ($("product-count")) $("product-count").textContent = productCount + "개";
    if ($("low-stock")) $("low-stock").textContent = lowStockCount + "개";
    if ($("total-profit")) $("total-profit").textContent = formatMoney(totalProfit);
    if ($("alert-count")) $("alert-count").textContent = lowStockCount + "건";

    const alertEmpty = $("alert-empty");
    const alertList = $("alert-list");

    if (alertEmpty) {
        alertEmpty.style.display = lowStockCount > 0 ? "none" : "flex";
    }

    if (alertList) {
        if (lowStockCount === 0) {
            alertList.innerHTML = "";
        } else {
            alertList.innerHTML = lowStockProducts.map(product => {
                const type = product.stock === 0 || product.stock <= 3
                    ? "danger"
                    : "warning";

                return `
                    <div
                        class="consultant-card ${type} dashboard-alert-item"
                        data-product-id="${escapeHTML(product.id)}"
                    >
                        <strong>${escapeHTML(product.name)}</strong>
                        <p>현재 재고가 ${product.stock}개입니다. 재고 상태를 확인해 주세요.</p>
                    </div>
                `;
            }).join("");

            alertList.querySelectorAll(".dashboard-alert-item").forEach(card => {
                card.addEventListener("click", () => {
                    const product = products.find(item => item.id === card.dataset.productId);
                    goToInventory(product);
                });
            });
        }
    }

    renderSalesChart();
    updateTopAlerts();
}

// ==============================
// 최근 30일 매출 그래프
// ==============================

function renderSalesChart() {
    const chart = $("sales-chart");
    if (!chart) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailySales = [];

    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        dailySales.push({ date, sales: 0 });
    }

    getRecentSales().forEach(sale => {
        const timestamp = Number(sale.createdAt);
        if (!Number.isFinite(timestamp) || timestamp <= 0) return;

        const saleDate = new Date(timestamp);
        saleDate.setHours(0, 0, 0, 0);

        const day = dailySales.find(item => item.date.getTime() === saleDate.getTime());

        if (day) {
            day.sales +=
                (Number(sale.quantity) || 0) *
                (Number(sale.salePrice) || 0);
        }
    });

    const maxSales = Math.max(...dailySales.map(item => item.sales), 1);

    const chartWidth = 630;
    const chartLeft = 35;
    const chartTop = 25;
    const chartBottom = 145;
    const chartHeight = chartBottom - chartTop;

    const coordinates = dailySales.map((item, index) => {
        const x = chartLeft + (index * chartWidth / 29);
        const y = chartBottom - (item.sales / maxSales) * chartHeight;
        return { x, y, item };
    });

    const linePoints = coordinates.map(point => `${point.x},${point.y}`).join(" ");
    const areaPoints = `${chartLeft},${chartBottom} ${linePoints} ${chartLeft + chartWidth},${chartBottom}`;

    const gridLines = [25, 65, 105, 145].map(y => `
        <line x1="${chartLeft}" y1="${y}" x2="${chartLeft + chartWidth}" y2="${y}" class="sales-chart-grid" />
    `).join("");

    const labels = dailySales.map((item, index) => {
        if (index % 5 !== 0 && index !== 29) return "";

        const x = chartLeft + (index * chartWidth / 29);
        const label = `${item.date.getMonth() + 1}/${item.date.getDate()}`;

        return `
            <text x="${x}" y="178" text-anchor="middle" class="sales-chart-label">${label}</text>
        `;
    }).join("");

    const points = coordinates
        .filter(point => point.item.sales > 0)
        .map(point => `
            <circle cx="${point.x}" cy="${point.y}" r="3" class="sales-chart-point">
                <title>${point.item.date.toLocaleDateString("ko-KR")} · ${formatMoney(point.item.sales)}</title>
            </circle>
        `).join("");

    const hasSales = dailySales.some(item => item.sales > 0);
    chart.classList.add("has-data");

    chart.innerHTML = `
        <svg class="sales-chart-svg" viewBox="0 0 700 195" role="img" aria-label="최근 30일 날짜별 매출 그래프">
            ${gridLines}
            <polygon points="${areaPoints}" class="sales-chart-area"></polygon>
            <polyline points="${linePoints}" class="sales-chart-line"></polyline>
            ${points}
            ${labels}
        </svg>
        ${!hasSales ? `
            <div class="chart-message">
                <strong>아직 매출 데이터가 없습니다.</strong>
                <small>판매를 등록하면 그래프가 업데이트됩니다.</small>
            </div>
        ` : ""}
    `;
}

// ==============================
// 상품 목록
// ==============================

function renderProducts() {
    updateInventoryOptions();
    updateSalesOptions();

    const productList = $("product-list");

    if (productList) {
        productList.innerHTML = "";

        if (products.length === 0) {
            productList.innerHTML = `<tr><td colspan="6">등록된 상품이 없습니다.</td></tr>`;
        }

        products.forEach((product, index) => {
            const profit = (product.price - product.cost) * product.stock;
            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${escapeHTML(product.name)}</td>
                <td>${formatMoney(product.price)}</td>
                <td>${formatMoney(product.cost)}</td>
                <td>${product.stock}개</td>
                <td>${formatMoney(profit)}</td>
                <td>
                    <button class="edit-button" data-index="${index}">수정</button>
                    <button class="delete-button" data-index="${index}">삭제</button>
                </td>
            `;

            productList.appendChild(row);
        });
    }

    updateDashboard();
    renderProAnalysis();
}

// ==============================
// 상품 등록 창
// ==============================

function resetForm() {
    if ($("product-form")) $("product-form").reset();

    editingIndex = null;

    if ($("modal-title")) $("modal-title").textContent = "새 상품 등록";
    if ($("submit-button")) $("submit-button").textContent = "상품 등록하기";
}

function editProduct(index) {
    const product = products[index];
    if (!product) return;

    editingIndex = index;

    $("product-name").value = product.name;
    $("product-price").value = product.price;
    $("product-cost").value = product.cost;
    $("product-stock").value = product.stock;

    $("modal-title").textContent = "상품 수정";
    $("submit-button").textContent = "수정 완료";
    $("product-modal").classList.add("show");
}

function deleteProduct(index) {
    const product = products[index];
    if (!product) return;

    const hasInventoryHistory = inventoryHistory.some(history => history.productId === product.id);
    const hasSalesHistory = salesHistory.some(sale => sale.productId === product.id);

    if (hasInventoryHistory || hasSalesHistory) {
        alert("이 상품에는 입출고 또는 판매 기록이 있습니다.\n관련 기록을 먼저 삭제한 후 상품을 삭제해 주세요.");
        return;
    }

    if (!confirm("'" + product.name + "' 상품을 삭제할까요?")) return;

    const deletedProduct = products.splice(index, 1)[0];

    if (!saveProducts()) {
        products.splice(index, 0, deletedProduct);
        return;
    }

    renderProducts();
}

// ==============================
// 상품 등록 및 수정 이벤트
// ==============================

function setupProductEvents() {
    const openModal = $("open-modal");
    const closeModal = $("close-modal");
    const modal = $("product-modal");
    const productForm = $("product-form");
    const productList = $("product-list");

    if (openModal && modal) {
        openModal.addEventListener("click", () => {
            resetForm();
            modal.classList.add("show");
        });
    }

    if (closeModal && modal) {
        closeModal.addEventListener("click", () => {
            modal.classList.remove("show");
            resetForm();
        });
    }

    if (modal) {
        modal.addEventListener("click", event => {
            if (event.target === modal) {
                modal.classList.remove("show");
                resetForm();
            }
        });
    }

    if (productList) {
        productList.addEventListener("click", event => {
            const button = event.target.closest("button");
            if (!button) return;

            const index = Number(button.dataset.index);

            if (button.classList.contains("edit-button")) editProduct(index);
            if (button.classList.contains("delete-button")) deleteProduct(index);
        });
    }

    if (productForm) {
        productForm.addEventListener("submit", event => {
            event.preventDefault();

            const name = $("product-name").value.trim();
            const price = Number($("product-price").value);
            const cost = Number($("product-cost").value);
            const stock = Number($("product-stock").value);

            if (
                !name ||
                !Number.isFinite(price) ||
                !Number.isFinite(cost) ||
                !Number.isFinite(stock) ||
                price < 0 ||
                cost < 0 ||
                stock < 0 ||
                !Number.isInteger(stock)
            ) {
                alert("상품 정보를 올바르게 입력해 주세요.");
                return;
            }

            if (cost > price) {
                if (!confirm("원가가 판매 가격보다 높습니다. 그래도 진행할까요?")) return;
            }

            const previousIndex = editingIndex;
            const previousProducts = JSON.parse(JSON.stringify(products));
            const previousHistory = JSON.parse(JSON.stringify(inventoryHistory));
            const previousSales = JSON.parse(JSON.stringify(salesHistory));

            if (previousIndex !== null) {
                const oldProduct = products[previousIndex];
                const stockDifference = stock - oldProduct.stock;

                products[previousIndex] = {
                    ...oldProduct,
                    name,
                    price,
                    cost,
                    stock,
                    baseStock: oldProduct.baseStock + stockDifference
                };

                inventoryHistory.forEach(history => {
                    if (history.productId === oldProduct.id) history.productName = name;
                });

                salesHistory.forEach(sale => {
                    if (sale.productId === oldProduct.id) sale.productName = name;
                });
            } else {
                products.push({
                    id: createId(),
                    name,
                    price,
                    cost,
                    stock,
                    baseStock: stock
                });
            }

            if (!saveAllData()) {
                products = previousProducts;
                inventoryHistory = previousHistory;
                salesHistory = previousSales;
                saveAllData();
                return;
            }

            renderProducts();
            renderInventoryHistory();
            renderSalesHistory();

            productForm.reset();
            $("product-modal").classList.remove("show");
            resetForm();

            alert(previousIndex === null ? "상품이 등록되었습니다!" : "상품이 수정되었습니다!");
        });
    }
}

// ==============================
// 입고 및 출고
// ==============================

function setupInventoryEvents() {
    const inventoryForm = $("inventory-form");
    if (!inventoryForm) return;

    inventoryForm.addEventListener("submit", event => {
        event.preventDefault();

        const selectedValue = $("inventory-product").value;
        const productIndex = Number(selectedValue);
        const type = $("inventory-type").value;
        const quantity = Number($("inventory-quantity").value);

        if (
            selectedValue === "" ||
            !products[productIndex] ||
            !Number.isInteger(quantity) ||
            quantity <= 0
        ) {
            alert("상품과 올바른 수량을 입력해 주세요.");
            return;
        }

        if (type !== "in" && type !== "out") {
            alert("입출고 유형을 확인해 주세요.");
            return;
        }

        const previousProducts = JSON.parse(JSON.stringify(products));
        const previousHistory = JSON.parse(JSON.stringify(inventoryHistory));
        const product = products[productIndex];

        inventoryHistory.push({
            id: createId(),
            productId: product.id,
            productName: product.name,
            type,
            quantity,
            stockAfter: 0,
            date: new Date().toLocaleString("ko-KR"),
            createdAt: Math.max(Date.now(), getLatestCreatedAt() + 1),
            salePrice: null
        });

        if (!recalculateProductStocks()) {
            products = previousProducts;
            inventoryHistory = previousHistory;
            alert("현재 재고보다 많은 수량을 출고할 수 없습니다.");
            return;
        }

        if (!saveProducts() || !saveInventoryHistory()) {
            products = previousProducts;
            inventoryHistory = previousHistory;
            saveProducts();
            saveInventoryHistory();
            return;
        }

        inventoryForm.reset();
        renderProducts();
        renderInventoryHistory();

        alert(type === "in" ? "입고가 완료되었습니다!" : "출고가 완료되었습니다!");
    });
}

// ==============================
// 입출고 기록 화면
// ==============================

function renderInventoryHistory() {
    const historyList = $("inventory-history");
    if (!historyList) return;

    historyList.innerHTML = "";

    const sortedHistory = [...inventoryHistory].sort(
        (a, b) => Number(b.createdAt) - Number(a.createdAt)
    );

    if (sortedHistory.length === 0) {
        historyList.innerHTML = `<tr><td colspan="6">아직 입출고 기록이 없습니다.</td></tr>`;
        return;
    }

    sortedHistory.forEach(history => {
        const row = document.createElement("tr");

        const dateText = history.date || new Date(Number(history.createdAt)).toLocaleString("ko-KR");
        const typeText = history.type === "in" ? "입고" : "출고";
        const typeClass = history.type === "in" ? "in" : "out";

        row.innerHTML = `
            <td>${escapeHTML(dateText)}</td>
            <td>${escapeHTML(history.productName || "삭제된 상품")}</td>
            <td class="${typeClass}">${typeText}</td>
            <td>${Number(history.quantity)}개</td>
            <td>${Number(history.stockAfter) || 0}개</td>
            <td>
                <div class="history-action-buttons">
                    <button class="history-edit-button" data-id="${escapeHTML(history.id)}">수정</button>
                    <button class="history-delete-button" data-id="${escapeHTML(history.id)}">삭제</button>
                </div>
            </td>
        `;

        historyList.appendChild(row);
    });
}

// ==============================
// 입출고 기록 삭제
// ==============================

function deleteInventoryHistory(historyId) {
    const index = inventoryHistory.findIndex(history => history.id === historyId);

    if (index === -1) {
        alert("삭제할 기록을 찾을 수 없습니다.");
        return;
    }

    if (!confirm("이 입출고 기록을 삭제할까요?")) return;

    const previousProducts = JSON.parse(JSON.stringify(products));
    const previousHistory = JSON.parse(JSON.stringify(inventoryHistory));

    inventoryHistory.splice(index, 1);

    if (!recalculateProductStocks()) {
        products = previousProducts;
        inventoryHistory = previousHistory;
        alert("기록을 삭제할 수 없습니다.");
        return;
    }

    if (!saveProducts() || !saveInventoryHistory()) {
        products = previousProducts;
        inventoryHistory = previousHistory;
        saveProducts();
        saveInventoryHistory();
        return;
    }

    renderProducts();
    renderInventoryHistory();
    alert("입출고 기록이 삭제되었습니다!");
}

// ==============================
// 입출고 기록 수정 창
// ==============================

function closeInventoryEditModal() {
    const modal = $("inventory-edit-modal");
    if (modal) modal.classList.remove("show");

    editingHistoryId = null;

    if ($("inventory-edit-form")) $("inventory-edit-form").reset();
}

function openInventoryEditModal(historyId) {
    const history = inventoryHistory.find(item => item.id === historyId);
    if (!history) return;

    editingHistoryId = historyId;

    $("edit-inventory-type").value = history.type;
    $("edit-inventory-quantity").value = history.quantity;
    $("inventory-edit-modal").classList.add("show");
}

// ==============================
// 입출고 기록 수정 및 삭제 이벤트
// ==============================

function setupInventoryHistoryEvents() {
    const historyList = $("inventory-history");
    const editModal = $("inventory-edit-modal");
    const editForm = $("inventory-edit-form");
    const closeButton = $("close-inventory-modal");

    if (historyList) {
        historyList.addEventListener("click", event => {
            const editButton = event.target.closest(".history-edit-button");
            const deleteButton = event.target.closest(".history-delete-button");

            if (editButton) openInventoryEditModal(editButton.dataset.id);
            if (deleteButton) deleteInventoryHistory(deleteButton.dataset.id);
        });
    }

    if (closeButton) closeButton.addEventListener("click", closeInventoryEditModal);

    if (editModal) {
        editModal.addEventListener("click", event => {
            if (event.target === editModal) closeInventoryEditModal();
        });
    }

    if (editForm) {
        editForm.addEventListener("submit", event => {
            event.preventDefault();

            const history = inventoryHistory.find(item => item.id === editingHistoryId);

            if (!history) {
                alert("수정할 기록을 찾을 수 없습니다.");
                closeInventoryEditModal();
                return;
            }

            const newType = $("edit-inventory-type").value;
            const newQuantity = Number($("edit-inventory-quantity").value);

            if (
                (newType !== "in" && newType !== "out") ||
                !Number.isInteger(newQuantity) ||
                newQuantity <= 0
            ) {
                alert("올바른 작업 유형과 수량을 입력해 주세요.");
                return;
            }

            const previousProducts = JSON.parse(JSON.stringify(products));
            const previousHistory = JSON.parse(JSON.stringify(inventoryHistory));

            history.type = newType;
            history.quantity = newQuantity;

            if (!recalculateProductStocks()) {
                products = previousProducts;
                inventoryHistory = previousHistory;

                alert("수정할 수 없습니다.\n기록을 변경하면 특정 시점의 재고가 음수가 됩니다.");
                return;
            }

            if (!saveProducts() || !saveInventoryHistory()) {
                products = previousProducts;
                inventoryHistory = previousHistory;
                saveProducts();
                saveInventoryHistory();
                return;
            }

            closeInventoryEditModal();
            renderProducts();
            renderInventoryHistory();
            alert("입출고 기록이 수정되었습니다!");
        });
    }
}

// ==============================
// 판매 등록
// ==============================

function setupSalesEvents() {
    const salesForm = $("sales-form");
    const productSelect = $("sales-product");
    const quantityInput = $("sales-quantity");
    const priceInput = $("sales-price");
    const historyList = $("sales-history");

    if (!salesForm) return;

    if (productSelect) productSelect.addEventListener("change", updateSalesPrice);
    if (quantityInput) quantityInput.addEventListener("input", updateSalesTotal);
    if (priceInput) priceInput.addEventListener("input", updateSalesTotal);

    salesForm.addEventListener("submit", event => {
        event.preventDefault();

        const productId = $("sales-product").value;
        const quantity = Number($("sales-quantity").value);
        const salePrice = Number($("sales-price").value);

        const product = products.find(item => item.id === productId);

        if (!product) {
            alert("판매할 상품을 선택해 주세요.");
            return;
        }

        if (
            !Number.isInteger(quantity) ||
            quantity <= 0 ||
            !Number.isFinite(salePrice) ||
            salePrice < 0
        ) {
            alert("판매 수량과 가격을 올바르게 입력해 주세요.");
            return;
        }

        if (quantity > product.stock) {
            alert("현재 재고가 부족합니다.\n현재 재고: " + product.stock + "개");
            return;
        }

        const previousProducts = JSON.parse(JSON.stringify(products));
        const previousSales = JSON.parse(JSON.stringify(salesHistory));

        salesHistory.push({
            id: createId(),
            productId: product.id,
            productName: product.name,
            quantity,
            salePrice,
            costSnapshot: product.cost,
            total: quantity * salePrice,
            stockAfter: 0,
            date: new Date().toLocaleString("ko-KR"),
            createdAt: Math.max(Date.now(), getLatestCreatedAt() + 1)
        });

        if (!recalculateProductStocks()) {
            products = previousProducts;
            salesHistory = previousSales;
            alert("판매 등록 중 재고 계산에 실패했습니다.");
            return;
        }

        if (!saveProducts() || !saveSalesHistory()) {
            products = previousProducts;
            salesHistory = previousSales;
            saveProducts();
            saveSalesHistory();
            return;
        }

        salesForm.reset();
        updateSalesPrice();

        renderProducts();
        renderSalesHistory();
        alert("판매가 등록되었습니다!");
    });

    if (historyList) {
        historyList.addEventListener("click", event => {
            const deleteButton = event.target.closest(".sales-delete-button");
            if (deleteButton) deleteSale(deleteButton.dataset.id);
        });
    }
}

// ==============================
// 판매 기록 화면
// ==============================

function renderSalesHistory() {
    const historyList = $("sales-history");
    if (!historyList) return;

    historyList.innerHTML = "";

    const sortedHistory = [...salesHistory].sort(
        (a, b) => Number(b.createdAt) - Number(a.createdAt)
    );

    if (sortedHistory.length === 0) {
        historyList.innerHTML = `<tr><td colspan="6">아직 판매 기록이 없습니다.</td></tr>`;
        return;
    }

    sortedHistory.forEach(sale => {
        const row = document.createElement("tr");
        const dateText = sale.date || new Date(Number(sale.createdAt)).toLocaleString("ko-KR");

        row.innerHTML = `
            <td>${escapeHTML(dateText)}</td>
            <td>${escapeHTML(sale.productName || "삭제된 상품")}</td>
            <td>${Number(sale.quantity)}개</td>
            <td>${formatMoney(sale.salePrice)}</td>
            <td>${formatMoney(sale.quantity * sale.salePrice)}</td>
            <td><button class="sales-delete-button" data-id="${escapeHTML(sale.id)}">삭제</button></td>
        `;

        historyList.appendChild(row);
    });
}

// ==============================
// 판매 기록 삭제
// ==============================

function deleteSale(saleId) {
    const index = salesHistory.findIndex(sale => sale.id === saleId);

    if (index === -1) {
        alert("삭제할 판매 기록을 찾을 수 없습니다.");
        return;
    }

    const confirmed = confirm("이 판매 기록을 삭제할까요?\n삭제하면 해당 상품의 재고가 복구됩니다.");
    if (!confirmed) return;

    const previousProducts = JSON.parse(JSON.stringify(products));
    const previousSales = JSON.parse(JSON.stringify(salesHistory));

    salesHistory.splice(index, 1);

    if (!recalculateProductStocks()) {
        products = previousProducts;
        salesHistory = previousSales;
        alert("판매 기록을 삭제할 수 없습니다.");
        return;
    }

    if (!saveProducts() || !saveSalesHistory()) {
        products = previousProducts;
        salesHistory = previousSales;
        saveProducts();
        saveSalesHistory();
        return;
    }

    renderProducts();
    renderSalesHistory();
    alert("판매 기록이 삭제되었습니다. 재고가 복구되었습니다!");
}

// ==================================================
// PRO 분석 기능
// ==================================================

function getProductSalesAnalysis() {
    const recentSales = getRecentSales();

    return products.map(product => {
        const productSales = recentSales.filter(sale => sale.productId === product.id);

        const quantity = productSales.reduce((total, sale) => {
            return total + (Number(sale.quantity) || 0);
        }, 0);

        const revenue = productSales.reduce((total, sale) => {
            return total + (Number(sale.quantity) || 0) * (Number(sale.salePrice) || 0);
        }, 0);

        const profit = productSales.reduce((total, sale) => total + getSaleProfit(sale), 0);
        const averageDailySales = quantity / 30;

        const daysRemaining = averageDailySales > 0
            ? product.stock / averageDailySales
            : null;

        return {
            id: product.id,
            name: product.name,
            stock: product.stock,
            price: product.price,
            cost: product.cost,
            quantity,
            revenue,
            profit,
            averageDailySales,
            daysRemaining,
            revenueRank: null,
            quantityRank: null,
            revenueShare: 0,
            grade: "-"
        };
    });
}

// ==============================
// 매출 순위 / 판매량 순위 / ABC 등급
// ==============================

function calculateProductRanks(analysis) {
    const totalRevenue = analysis.reduce((total, item) => total + item.revenue, 0);

    const revenueRanked = [...analysis]
        .filter(item => item.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity);

    const quantityRanked = [...analysis]
        .filter(item => item.quantity > 0)
        .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);

    revenueRanked.forEach((item, index) => {
        item.revenueRank = index + 1;
    });

    quantityRanked.forEach((item, index) => {
        item.quantityRank = index + 1;
    });

    analysis.forEach(item => {
        item.revenueShare = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
        item.grade = "-";
    });

    let cumulativeShare = 0;

    revenueRanked.forEach(item => {
        const cumulativeAfter = cumulativeShare + item.revenueShare;

        if (cumulativeAfter <= 80) {
            item.grade = "A";
        } else if (cumulativeAfter <= 95) {
            item.grade = "B";
        } else {
            item.grade = "C";
        }

        cumulativeShare = cumulativeAfter;
    });

    return { totalRevenue, revenueRanked, quantityRanked };
}

// ==============================
// PRO 요약 카드
// ==============================

function renderProSummary(analysis) {
    const totalQuantity = analysis.reduce((total, item) => total + item.quantity, 0);
    const totalProfit = analysis.reduce((total, item) => total + item.profit, 0);
    const lowStockCount = products.filter(product => product.stock <= 5).length;
    const activeProducts = analysis.filter(item => item.quantity > 0).length;

    if ($("pro-sales-quantity")) $("pro-sales-quantity").textContent = totalQuantity + "개";
    if ($("pro-sales-profit")) $("pro-sales-profit").textContent = formatMoney(totalProfit);
    if ($("pro-low-stock")) $("pro-low-stock").textContent = lowStockCount + "개";
    if ($("pro-active-products")) $("pro-active-products").textContent = activeProducts + "개";
}

// ==============================
// 순위 배지 클래스
// ==============================

function getRankBadge(rank) {
    if (!rank) return "-";

    let rankClass = "";
    if (rank === 1) rankClass = "first";
    else if (rank === 2) rankClass = "second";
    else if (rank === 3) rankClass = "third";

    return `<span class="rank-badge ${rankClass}">${rank}위</span>`;
}

// ==============================
// 상품별 통합 순위표
// ==============================

function renderProRanking(analysis) {
    const list = $("pro-ranking-list");
    if (!list) return;

    calculateProductRanks(analysis);

    const ranked = [...analysis]
        .filter(item => item.quantity > 0 || item.revenue > 0)
        .sort((a, b) => b.revenue - a.revenue || b.quantity - a.quantity);

    if (ranked.length === 0) {
        list.innerHTML = `<tr><td colspan="8">최근 30일 판매 데이터가 없습니다.</td></tr>`;
        return;
    }

    list.innerHTML = ranked.map(item => {
        const gradeClass = item.grade === "-" ? "" : `grade-${item.grade.toLowerCase()}`;
        const safeShare = Math.min(100, Math.max(0, item.revenueShare));

        return `
            <tr>
                <td>${getRankBadge(item.revenueRank)}</td>
                <td>${getRankBadge(item.quantityRank)}</td>
                <td>${escapeHTML(item.name)}</td>
                <td>${formatMoney(item.revenue)}</td>
                <td>
                    <div class="contribution-cell">
                        <span class="contribution-value">${item.revenueShare.toFixed(1)}%</span>
                        <div class="contribution-track">
                            <div class="contribution-fill" style="width: ${safeShare}%"></div>
                        </div>
                    </div>
                </td>
                <td>${item.quantity.toLocaleString("ko-KR")}개</td>
                <td>${formatMoney(item.profit)}</td>
                <td><span class="grade-badge ${gradeClass}">${item.grade}</span></td>
            </tr>
        `;
    }).join("");
}

// ==============================
// 재고 분석
// ==============================

function renderProInventory(analysis) {
    const list = $("pro-inventory-list");
    if (!list) return;

    if (analysis.length === 0) {
        list.innerHTML = `<tr><td colspan="5">등록된 상품이 없습니다.</td></tr>`;
        return;
    }

    list.innerHTML = analysis.map(item => {
        let remainingText = "판매 데이터 부족";

        if (item.daysRemaining !== null) {
            if (item.stock === 0) {
                remainingText = "재고 없음";
            } else if (item.daysRemaining <= 7) {
                remainingText = `약 ${item.daysRemaining.toFixed(1)}일`;
            } else {
                remainingText = `약 ${Math.round(item.daysRemaining)}일`;
            }
        }

        return `
            <tr>
                <td>${escapeHTML(item.name)}</td>
                <td>${item.stock}개</td>
                <td>${item.quantity}개</td>
                <td>${item.averageDailySales.toFixed(2)}개</td>
                <td>${remainingText}</td>
            </tr>
        `;
    }).join("");
}

// ==============================
// 운영 컨설턴트 제안 생성
// ==============================

function createConsultantSuggestions(analysis) {
    const suggestions = [];

    if (products.length === 0) {
        suggestions.push({
            type: "info",
            title: "상품부터 등록해 보세요",
            message: "상품명, 판매 가격, 원가와 재고를 등록하면 운영 분석을 시작할 수 있습니다."
        });
        return suggestions;
    }

    const lossProducts = products.filter(product => product.price < product.cost);

    lossProducts.forEach(product => {
        suggestions.push({
            type: "danger",
            title: `가격 점검: ${product.name}`,
            message: `현재 판매 가격(${formatMoney(product.price)})이 원가(${formatMoney(product.cost)})보다 낮습니다. 판매 가격과 비용 구조를 확인해 보세요.`
        });
    });

    analysis.forEach(item => {
        if (item.stock === 0) {
            suggestions.push({
                type: "danger",
                title: `품절: ${item.name}`,
                message: "현재 재고가 0개입니다. 판매가 중단되지 않도록 재입고 여부를 긴급하게 확인하세요."
            });
        } else if (item.stock <= 3) {
            suggestions.push({
                type: "danger",
                title: `긴급 발주 검토: ${item.name}`,
                message: `현재 재고는 ${item.stock}개입니다. 재고 소진 위험이 높습니다. 판매 속도와 입고 기간을 확인하고 빠른 보충을 검토하세요.`
            });
        } else if (item.stock <= 5) {
            suggestions.push({
                type: "warning",
                title: `재고 부족 주의: ${item.name}`,
                message: `현재 재고는 ${item.stock}개입니다. 재고가 부족해질 수 있으니 최근 판매 속도와 입고 기간을 고려해 보충을 준비하세요.`
            });
        }
    });

    const restockProducts = analysis.filter(item => {
        return item.quantity > 0 &&
            item.daysRemaining !== null &&
            item.daysRemaining <= 7 &&
            item.stock > 5;
    });

    restockProducts.forEach(item => {
        const estimatedNeed = Math.ceil(item.averageDailySales * 14);
        const suggestedQuantity = Math.max(0, estimatedNeed - item.stock);

        if (suggestedQuantity > 0) {
            suggestions.push({
                type: "warning",
                title: `재고 보충 검토: ${item.name}`,
                message: `최근 판매 속도가 유지된다면 현재 재고는 약 ${Math.ceil(item.daysRemaining)}일분입니다. 14일 예상 수요를 기준으로 약 ${suggestedQuantity}개 추가 확보를 검토해 보세요. 실제 발주량은 납기와 보유 예산을 함께 고려해야 합니다.`
            });
        }
    });

    const slowProducts = analysis.filter(item => item.quantity === 0 && item.stock > 5);

    slowProducts.forEach(item => {
        suggestions.push({
            type: "info",
            title: `판매 흐름 확인: ${item.name}`,
            message: `최근 30일 판매 기록이 없고 현재 재고는 ${item.stock}개입니다. 상품 노출, 가격, 상세 페이지와 수요를 확인해 보세요.`
        });
    });

    const bestSeller = [...analysis]
        .filter(item => item.quantity > 0)
        .sort((a, b) => b.revenue - a.revenue)[0];

    if (bestSeller) {
        suggestions.push({
            type: "success",
            title: `매출 우수 상품: ${bestSeller.name}`,
            message: `최근 30일 매출은 ${formatMoney(bestSeller.revenue)}이며 전체 매출의 ${bestSeller.revenueShare.toFixed(1)}%를 차지합니다. 재고 상태를 확인하고 상품 노출을 유지해 보세요.`
        });
    }

    if (getRecentSales().length === 0) {
        suggestions.push({
            type: "info",
            title: "판매 기록이 더 필요합니다",
            message: "판매를 등록하면 상품별 매출 순위와 판매량 순위, 매출 기여도 및 재고 소진 예상치를 확인할 수 있습니다."
        });
    }

    if (suggestions.length === 0) {
        suggestions.push({
            type: "success",
            title: "현재 특별한 위험 신호가 없습니다",
            message: "상품과 재고 상태를 계속 확인하고 판매 기록을 꾸준히 쌓아 보세요."
        });
    }

    return suggestions;
}

// ==============================
// 운영 컨설턴트 화면
// ==============================

function renderConsultant(analysis) {
    const container = $("pro-consultant");
    if (!container) return;

    const suggestions = createConsultantSuggestions(analysis);

    container.innerHTML = suggestions.map(item => `
        <div class="consultant-card ${item.type}">
            <strong>${escapeHTML(item.title)}</strong>
            <p>${escapeHTML(item.message)}</p>
        </div>
    `).join("");
}

// ==============================
// PRO 분석 전체 업데이트
// ==============================

function renderProAnalysis() {
    const analysis = getProductSalesAnalysis();

    calculateProductRanks(analysis);
    renderProSummary(analysis);
    renderProRanking(analysis);
    renderProInventory(analysis);
    renderConsultant(analysis);
}

// ==============================
// ROUND STORE 시작
// ==============================

function initializeRoundStore() {
    migrateExistingData();

    const previousProducts = JSON.parse(JSON.stringify(products));
    const stockCalculationSuccess = recalculateProductStocks();

    if (!stockCalculationSuccess) {
        console.error("재고 기록을 재계산할 수 없습니다. 기존 기록을 확인해 주세요.");
        products = previousProducts;
    } else {
        saveProducts();
        saveInventoryHistory();
        saveSalesHistory();
    }

    applyAlertStyles();

    setupNavigation();
    setupProductEvents();
    setupInventoryEvents();
    setupInventoryHistoryEvents();
    setupSalesEvents();

    renderProducts();
    renderInventoryHistory();
    renderSalesHistory();
    renderProAnalysis();
    updateTopAlerts();

    console.log("ROUND STORE가 정상적으로 시작되었습니다.");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeRoundStore);
} else {
    initializeRoundStore();
}
