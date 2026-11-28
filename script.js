// ========================================
// ROUND STORE - FREE VERSION
// 상품 관리 + 재고 관리 + 판매 관리
// PRO 분석 기능 제거 버전
// ========================================

const $ = (id) => document.getElementById(id);

function createId() {
    return "rs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

// ========================================
// 저장소 및 Supabase 설정
// ========================================

const SUPABASE_URL = "https://fnhvaepttummlgtpqqzi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_L8cxzL08LASOjCGt1L9nZA___CVe95I";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const STORAGE_KEYS = {
    products: "roundStoreProducts",
    inventory: "roundStoreInventoryHistory",
    sales: "roundStoreSalesHistory"
};
const SESSION_KEYS = {
    products: "roundStoreTrialProducts",
    inventory: "roundStoreTrialInventoryHistory",
    sales: "roundStoreTrialSalesHistory"
};

let currentUser = null;
let storageMode = "locked"; // locked | guest | cloud
let cloudSaveTimer = null;
let cloudSaveInProgress = false;
let cloudSaveAgain = false;
let products = [];
let inventoryHistory = [];
let salesHistory = [];

function parseArray(value) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function readGuestData() {
    return {
        products: parseArray(sessionStorage.getItem(SESSION_KEYS.products)),
        inventoryHistory: parseArray(sessionStorage.getItem(SESSION_KEYS.inventory)),
        salesHistory: parseArray(sessionStorage.getItem(SESSION_KEYS.sales))
    };
}

function hasAnyData(data) {
    return data.products.length > 0 || data.inventoryHistory.length > 0 || data.salesHistory.length > 0;
}

function readLegacyBrowserData() {
    return {
        products: parseArray(localStorage.getItem(STORAGE_KEYS.products)),
        inventoryHistory: parseArray(localStorage.getItem(STORAGE_KEYS.inventory)),
        salesHistory: parseArray(localStorage.getItem(STORAGE_KEYS.sales))
    };
}

function clearGuestTrialData() {
    // 현재 탭의 체험 데이터 삭제
    Object.values(SESSION_KEYS).forEach(key => sessionStorage.removeItem(key));
    // 구버전에서 localStorage에 저장했던 ROUND STORE 데이터만 삭제
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
}

function writeGuestData() {
    try {
        sessionStorage.setItem(SESSION_KEYS.products, JSON.stringify(products));
        sessionStorage.setItem(SESSION_KEYS.inventory, JSON.stringify(inventoryHistory));
        sessionStorage.setItem(SESSION_KEYS.sales, JSON.stringify(salesHistory));
        return true;
    } catch (error) {
        console.error("무료체험 데이터 저장 실패:", error);
        alert("임시 저장 공간이 부족합니다. 데이터를 내보내거나 계정에 저장해 주세요.");
        return false;
    }
}

function scheduleCloudSave() {
    if (storageMode !== "cloud" || !currentUser) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(saveCloudData, 500);
}

async function saveCloudData() {
    if (storageMode !== "cloud" || !currentUser) return;
    if (cloudSaveInProgress) { cloudSaveAgain = true; return; }
    cloudSaveInProgress = true;
    const payload = {
        user_id: currentUser.id,
        products,
        inventory_history: inventoryHistory,
        sales_history: salesHistory,
        updated_at: new Date().toISOString()
    };
    const { error } = await supabaseClient.from("user_data").upsert(payload, { onConflict: "user_id" });
    cloudSaveInProgress = false;
    if (error) {
        console.error("클라우드 저장 실패:", error);
        showAuthMessage("저장에 실패했습니다. 인터넷 연결을 확인해 주세요. 다시 변경하면 재시도합니다.", false);
    } else {
        const message = $("account-status");
        if (message) message.textContent = "● 계정에 저장됨";
    }
    if (cloudSaveAgain) { cloudSaveAgain = false; saveCloudData(); }
}

function persistCurrentData() {
    if (storageMode === "guest") return writeGuestData();
    if (storageMode === "cloud") { scheduleCloudSave(); return true; }
    return false;
}

function saveProducts() { return persistCurrentData(); }
function saveInventoryHistory() { return persistCurrentData(); }
function saveSalesHistory() { return persistCurrentData(); }
function saveAllData() { return persistCurrentData(); }

function setData(data) {
    products = Array.isArray(data.products) ? data.products : [];
    inventoryHistory = Array.isArray(data.inventoryHistory) ? data.inventoryHistory : [];
    salesHistory = Array.isArray(data.salesHistory) ? data.salesHistory : [];
    products = products.map(product => ({
        ...product,
        price: Number(product.price) || 0,
        cost: Number(product.cost) || 0,
        stock: Number(product.stock) || 0
    }));
}

function showAuthMessage(message, success = false) {
    const el = $("auth-message");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("success", success);
}

function showApp(modeLabel) {
    $("auth-screen")?.classList.add("hidden");
    $("auth-screen").style.display = "none";
    $("main-app")?.classList.add("is-active");
    const status = $("account-status");
    if (status) status.textContent = modeLabel;
    const logout = $("logout-button");
    if (logout) logout.textContent = storageMode === "guest" ? "체험 종료" : "로그아웃";
    initializeApp();
}

async function activateUser(user) {
    currentUser = user;
    const { data: saved, error } = await supabaseClient
        .from("user_data")
        .select("products, inventory_history, sales_history")
        .eq("user_id", user.id)
        .maybeSingle();

    if (error) {
        console.error(error);
        showAuthMessage("계정 데이터를 불러오지 못했습니다. 잠시 후 다시 로그인해 주세요.");
        await supabaseClient.auth.signOut();
        return;
    }

    if (saved) {
        setData({
            products: saved.products,
            inventoryHistory: saved.inventory_history,
            salesHistory: saved.sales_history
        });
        storageMode = "cloud";
    } else {
        const guestData = readGuestData();
        if (hasAnyData(guestData) && confirm("무료체험에서 만든 상품·재고·판매 데이터를 이 계정으로 옮길까요? 기존 계정 데이터가 없을 때만 가져옵니다.")) {
            setData(guestData);
        } else {
            setData({ products: [], inventoryHistory: [], salesHistory: [] });
        }
        storageMode = "cloud";
        await saveCloudData();
    }

    sessionStorage.removeItem(SESSION_KEYS.products);
    sessionStorage.removeItem(SESSION_KEYS.inventory);
    sessionStorage.removeItem(SESSION_KEYS.sales);
    showAuthMessage("로그인되었습니다.", true);
    showApp("● 계정 저장 사용 중");
}

async function startGuestMode() {
    // 새 무료체험은 이전 체험 데이터나 과거 브라우저 데이터를 불러오지 않고 빈 상태로 시작
    clearGuestTrialData();
    setData({ products: [], inventoryHistory: [], salesHistory: [] });
    storageMode = "guest";
    showApp("● 무료체험 · 임시 저장");
}

function setupAuthUI() {
    let authMode = "login";
    const loginTab = $("show-login");
    const signupTab = $("show-signup");
    const submit = $("auth-submit");
    const form = $("auth-form");

    function setAuthMode(mode) {
        authMode = mode;
        loginTab.classList.toggle("active", mode === "login");
        signupTab.classList.toggle("active", mode === "signup");
        submit.textContent = mode === "login" ? "로그인" : "회원가입";
        $("auth-title").textContent = mode === "login" ? "매장 운영을 더 간편하게" : "ROUND STORE 시작하기";
        $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
        showAuthMessage("");
    }

    loginTab?.addEventListener("click", () => setAuthMode("login"));
    signupTab?.addEventListener("click", () => setAuthMode("signup"));
    $("start-guest")?.addEventListener("click", startGuestMode);

    form?.addEventListener("submit", async event => {
        event.preventDefault();
        const email = $("auth-email").value.trim();
        const password = $("auth-password").value;
        submit.disabled = true;
        showAuthMessage(authMode === "login" ? "로그인 중..." : "회원가입 처리 중...", true);
        try {
            if (authMode === "signup") {
                const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: "https://roundstore.github.io/round-store/" } });
                if (error) throw error;
                if (data.session) await activateUser(data.user);
                else showAuthMessage("가입 요청이 완료됐습니다. 이메일로 전송된 인증 링크를 확인한 뒤 로그인해 주세요.", true);
            } else {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
                if (error) throw error;
                await activateUser(data.user);
            }
        } catch (error) {
            console.error(error);
            showAuthMessage(error.message || "요청을 처리하지 못했습니다. 입력 내용을 확인해 주세요.");
        } finally {
            submit.disabled = false;
        }
    });

    $("logout-button")?.addEventListener("click", async () => {
        if (storageMode === "guest") {
            clearGuestTrialData();
        } else {
            await supabaseClient.auth.signOut();
        }
        currentUser = null;
        storageMode = "locked";
        products = []; inventoryHistory = []; salesHistory = [];
        $("main-app").classList.remove("is-active");
        $("auth-screen").style.display = "grid";
        $("auth-form")?.reset();
        showAuthMessage("로그아웃되었습니다.", true);
    });
}

async function restoreAuthSession() {
    setupAuthUI();
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.error(error);
    if (session?.user) await activateUser(session.user);
}

// ========================================
// 공통 기능
// ========================================

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

// ========================================
// 기존 데이터 보정
// ========================================

function migrateExistingData() {
    let changed = false;
    const now = Date.now();

    products.forEach(product => {
        if (!product.id) {
            product.id = createId();
            changed = true;
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

        if (history.type === "out" && history.salePrice === undefined) {
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
        sale.total = sale.quantity * sale.salePrice;

        const product = products.find(item => item.id === sale.productId);

        if (product && sale.productName !== product.name) {
            sale.productName = product.name;
            changed = true;
        }
    });

    products.forEach(product => {
        if (product.baseStock === undefined) {
            const inventoryMovement = inventoryHistory
                .filter(history => history.productId === product.id)
                .reduce((total, history) => {
                    return total + (
                        history.type === "in"
                            ? Number(history.quantity)
                            : -Number(history.quantity)
                    );
                }, 0);

            const salesMovement = salesHistory
                .filter(sale => sale.productId === product.id)
                .reduce((total, sale) => total + Number(sale.quantity), 0);

            product.baseStock = product.stock - inventoryMovement + salesMovement;
            changed = true;
        } else {
            product.baseStock = Number(product.baseStock) || 0;
        }
    });

    if (changed) saveAllData();
}

// ========================================
// 재고 자동 계산
// ========================================

function recalculateProductStocks() {
    products.forEach(product => {
        product.stock = Number(product.baseStock) || 0;
    });

    const events = [
        ...inventoryHistory.map(history => ({
            ...history,
            eventType: "inventory"
        })),
        ...salesHistory.map(sale => ({
            ...sale,
            eventType: "sale"
        }))
    ].sort((a, b) => {
        return Number(a.createdAt) - Number(b.createdAt);
    });

    for (const event of events) {
        const product = products.find(item => item.id === event.productId);

        if (!product) continue;

        const quantity = Number(event.quantity);

        if (!Number.isInteger(quantity) || quantity <= 0) {
            return false;
        }

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
            const original = salesHistory.find(item => item.id === event.id);
            if (original) original.stockAfter = product.stock;
        } else {
            const original = inventoryHistory.find(item => item.id === event.id);
            if (original) original.stockAfter = product.stock;
        }
    }

    return true;
}

// ========================================
// 페이지 이동
// ========================================

function setupNavigation() {
    const menuItems = document.querySelectorAll(".menu-item");

    const pageTitle = $("page-title");

    const titles = {
        "dashboard-section": "대시보드",
        "product-section": "상품 관리",
        "inventory-section": "재고 관리",
        "sales-section": "판매 관리",
        "dashboard": "대시보드",
        "products": "상품 관리",
        "inventory": "재고 관리",
        "sales": "판매 관리"
    };

    menuItems.forEach(item => {
        item.addEventListener("click", event => {
            const href = item.getAttribute("href");

            if (!href || !href.startsWith("#")) return;

            const target = $(href.substring(1));

            if (!target) return;

            event.preventDefault();

            menuItems.forEach(menu => menu.classList.remove("active"));
            item.classList.add("active");

            if (pageTitle) {
                pageTitle.textContent = titles[target.id] || "ROUND STORE";
            }

            target.scrollIntoView({
                behavior: "smooth",
                block: "start"
            });
        });
    });
}

// ========================================
// 상품 선택 목록
// ========================================

function updateInventoryOptions() {
    const select = $("inventory-product");
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = `
        <option value="">상품을 선택하세요</option>
    `;

    products.forEach(product => {
        const option = document.createElement("option");
        option.value = product.id;
        option.textContent = product.name;
        select.appendChild(option);
    });

    if (products.some(product => product.id === previousValue)) {
        select.value = previousValue;
    }
}

function updateSalesOptions() {
    const select = $("sales-product");
    if (!select) return;

    const previousValue = select.value;

    select.innerHTML = `
        <option value="">상품을 선택하세요</option>
    `;

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

// ========================================
// 판매 가격 및 총액 계산
// ========================================

function updateSalesPrice() {
    const productSelect = $("sales-product");
    const priceInput = $("sales-price");

    if (!productSelect || !priceInput) return;

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

// ========================================
// 재고 알림
// ========================================

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
            border: 1px solid #e4e6ed;
            border-radius: 11px;
            padding: 10px;
            background: #ffffff;
        }

        .round-alert-details.open {
            display: block;
        }

        .round-alert-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
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
            .topbar {
                padding-top: 8px;
                padding-bottom: 8px;
            }

            .round-alert-toggle {
                padding: 10px 12px;
            }
        }
    `;

    document.head.appendChild(style);
}
function getAlertLevel(product) {
    if (product.stock <= 0) return "danger";
    if (product.stock <= 3) return "urgent";
    if (product.stock <= 5) return "warning";
    return "safe";
}

function renderTopAlerts() {
    const area = $("round-alert-area");
    if (!area) return;

    const alertProducts = products
        .filter(product => product.stock <= 5)
        .sort((a, b) => a.stock - b.stock);

    const dangerCount = alertProducts.filter(product => product.stock <= 0).length;
    const urgentCount = alertProducts.filter(product => product.stock > 0 && product.stock <= 3).length;
    const warningCount = alertProducts.filter(product => product.stock > 3 && product.stock <= 5).length;

    let level = "safe";
    let summary = "재고 상태가 정상입니다.";

    if (dangerCount > 0) {
        level = "danger";
        summary = `품절 ${dangerCount}개`;
    } else if (urgentCount > 0) {
        level = "urgent";
        summary = `긴급 재고 ${urgentCount}개`;
    } else if (warningCount > 0) {
        level = "warning";
        summary = `재고 부족 ${warningCount}개`;
    }

    area.innerHTML = `
        <button
            type="button"
            class="round-alert-toggle ${level}"
            id="round-alert-toggle"
            aria-expanded="false"
            aria-controls="round-alert-details"
        >
            <span class="round-alert-summary">
                <span>재고 알림</span>
                <span>${summary}</span>
            </span>
            <span class="round-alert-chevron">⌄</span>
        </button>

        <div class="round-alert-details" id="round-alert-details">
            ${
                alertProducts.length === 0
                    ? `<div class="round-alert-empty">현재 재고 부족 상품이 없습니다.</div>`
                    : `
                        <div class="round-alert-group">
                            <div class="round-alert-group-title">재고 확인이 필요한 상품</div>
                            ${alertProducts.map(product => `
                                <button
                                    type="button"
                                    class="round-alert-product ${getAlertLevel(product)}"
                                    data-product-id="${escapeHTML(product.id)}"
                                >
                                    <span class="round-alert-product-name">${escapeHTML(product.name)}</span>
                                    <span class="round-alert-stock">${product.stock}개 남음</span>
                                </button>
                            `).join("")}
                        </div>
                    `
            }
        </div>
    `;

    const toggle = $("round-alert-toggle");
    const details = $("round-alert-details");

    toggle?.addEventListener("click", () => {
        const isOpen = details.classList.toggle("open");
        toggle.setAttribute("aria-expanded", String(isOpen));
    });

    area.querySelectorAll(".round-alert-product").forEach(button => {
        button.addEventListener("click", () => {
            const product = products.find(item => item.id === button.dataset.productId);
            if (product) goToInventory(product);
        });
    });
}

// ========================================
// 대시보드
// ========================================

function updateDashboard() {
    const productCount = products.length;
    const lowStockProducts = products.filter(product => product.stock <= 5);
    const lowStockCount = lowStockProducts.length;

    const totalProfit = products.reduce((total, product) => {
        return total + (product.price - product.cost) * product.stock;
    }, 0);

    const recentSales = getRecentSales();

    const totalSales = recentSales.reduce((total, sale) => {
        return total + Number(sale.quantity) * Number(sale.salePrice);
    }, 0);

    if ($("total-sales")) {
        $("total-sales").textContent = formatMoney(totalSales);
    }

    if ($("product-count")) {
        $("product-count").textContent = productCount + "개";
    }

    if ($("low-stock")) {
        $("low-stock").textContent = lowStockCount + "개";
    }

    if ($("total-profit")) {
        $("total-profit").textContent = formatMoney(totalProfit);
    }

    if ($("alert-count")) {
        $("alert-count").textContent = lowStockCount + "건";
    }

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
                const type = product.stock <= 3 ? "danger" : "warning";

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
                    if (product) goToInventory(product);
                });
            });
        }
    }

    renderSalesChart();
    renderTopAlerts();
}

// ========================================
// 최근 30일 매출 그래프
// ========================================

function renderSalesChart() {
    const chart = $("sales-chart");
    if (!chart) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailySales = [];

    for (let i = 29; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);

        dailySales.push({
            date,
            sales: 0
        });
    }

    getRecentSales().forEach(sale => {
        const timestamp = Number(sale.createdAt);

        if (!Number.isFinite(timestamp) || timestamp <= 0) return;

        const saleDate = new Date(timestamp);
        saleDate.setHours(0, 0, 0, 0);

        const day = dailySales.find(item => {
            return item.date.getTime() === saleDate.getTime();
        });

        if (day) {
            day.sales += Number(sale.quantity) * Number(sale.salePrice);
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

    const linePoints = coordinates
        .map(point => `${point.x},${point.y}`)
        .join(" ");

    const areaPoints = `${chartLeft},${chartBottom} ${linePoints} ${chartLeft + chartWidth},${chartBottom}`;

    const gridLines = [25, 65, 105, 145].map(y => `
        <line
            x1="${chartLeft}"
            y1="${y}"
            x2="${chartLeft + chartWidth}"
            y2="${y}"
            class="sales-chart-grid"
        />
    `).join("");

    const labels = dailySales.map((item, index) => {
        if (index % 5 !== 0 && index !== 29) return "";

        const x = chartLeft + (index * chartWidth / 29);
        const label = `${item.date.getMonth() + 1}/${item.date.getDate()}`;

        return `
            <text
                x="${x}"
                y="178"
                text-anchor="middle"
                class="sales-chart-label"
            >${label}</text>
        `;
    }).join("");

    const points = coordinates
        .filter(point => point.item.sales > 0)
        .map(point => `
            <circle
                cx="${point.x}"
                cy="${point.y}"
                r="3"
                class="sales-chart-point"
            >
                <title>${point.item.date.toLocaleDateString("ko-KR")} · ${formatMoney(point.item.sales)}</title>
            </circle>
        `).join("");

    const hasSales = dailySales.some(item => item.sales > 0);

    chart.classList.add("has-data");

    chart.innerHTML = `
        <svg
            class="sales-chart-svg"
            viewBox="0 0 700 195"
            role="img"
            aria-label="최근 30일 날짜별 매출 그래프"
        >
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

// ========================================
// 상품 목록 렌더링
// ========================================

function renderProducts() {
    updateInventoryOptions();
    updateSalesOptions();

    const productList = $("product-list");

    if (productList) {
        productList.innerHTML = "";

        if (products.length === 0) {
            productList.innerHTML = `
                <tr>
                    <td colspan="6">등록된 상품이 없습니다.</td>
                </tr>
            `;
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
}

// ========================================
// 상품 등록 / 수정
// ========================================

function resetForm() {
    $("product-form")?.reset();

    editingIndex = null;

    if ($("modal-title")) {
        $("modal-title").textContent = "새 상품 등록";
    }

    if ($("submit-button")) {
        $("submit-button").textContent = "상품 등록하기";
    }
}

function editProduct(index) {
    const product = products[index];
    if (!product) return;

    editingIndex = index;

    $("product-name").value = product.name;
    $("product-price").value = product.price;
    $("product-cost").value = product.cost;
    $("product-stock").value = product.stock;

    if ($("modal-title")) {
        $("modal-title").textContent = "상품 수정";
    }

    if ($("submit-button")) {
        $("submit-button").textContent = "수정 완료";
    }

    $("product-modal")?.classList.add("show");
}

function deleteProduct(index) {
    const product = products[index];
    if (!product) return;

    const hasInventoryHistory = inventoryHistory.some(history => {
        return history.productId === product.id;
    });

    const hasSalesHistory = salesHistory.some(sale => {
        return sale.productId === product.id;
    });

    if (hasInventoryHistory || hasSalesHistory) {
        alert("이 상품에는 입출고 또는 판매 기록이 있습니다.\n관련 기록을 먼저 삭제한 후 상품을 삭제해 주세요.");
        return;
    }

    if (!confirm(`'${product.name}' 상품을 삭제할까요?`)) return;

    const deletedProduct = products.splice(index, 1)[0];

    if (!saveProducts()) {
        products.splice(index, 0, deletedProduct);
        return;
    }

    renderProducts();
}

// ========================================
// 상품 이벤트
// ========================================

function setupProductEvents() {
    const openModal = $("open-modal");
    const closeModal = $("close-modal");
    const modal = $("product-modal");
    const productForm = $("product-form");
    const productList = $("product-list");

    openModal?.addEventListener("click", () => {
        resetForm();
        modal?.classList.add("show");
    });

    closeModal?.addEventListener("click", () => {
        modal?.classList.remove("show");
        resetForm();
    });

    modal?.addEventListener("click", event => {
        if (event.target === modal) {
            modal.classList.remove("show");
            resetForm();
        }
    });

    productList?.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;

        const index = Number(button.dataset.index);

        if (button.classList.contains("edit-button")) {
            editProduct(index);
        }

        if (button.classList.contains("delete-button")) {
            deleteProduct(index);
        }
    });

    productForm?.addEventListener("submit", event => {
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
            if (!confirm("원가가 판매 가격보다 높습니다. 그래도 진행할까요?")) {
                return;
            }
        }

        const previousIndex = editingIndex;

        const previousProducts = JSON.parse(JSON.stringify(products));
        const previousInventory = JSON.parse(JSON.stringify(inventoryHistory));
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
                baseStock: Number(oldProduct.baseStock) + stockDifference
            };

            inventoryHistory.forEach(history => {
                if (history.productId === oldProduct.id) {
                    history.productName = name;
                }
            });

            salesHistory.forEach(sale => {
                if (sale.productId === oldProduct.id) {
                    sale.productName = name;
                }
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
            inventoryHistory = previousInventory;
            salesHistory = previousSales;
            saveAllData();
            return;
        }

        renderProducts();
        renderInventoryHistory();
        renderSalesHistory();

        productForm.reset();
        modal?.classList.remove("show");
        resetForm();

        alert(previousIndex === null ? "상품이 등록되었습니다!" : "상품이 수정되었습니다!");
    });
}
// ========================================
// 재고 관리 이벤트
// ========================================

function setupInventoryEvents() {
    const form = $("inventory-form");
    const historyList = $("inventory-history");

    form?.addEventListener("submit", event => {
        event.preventDefault();

        const productId = $("inventory-product").value;
        const type = $("inventory-type").value;
        const quantity = Number($("inventory-quantity").value);
        const memo = $("inventory-memo")?.value.trim() || "";

        const product = products.find(item => item.id === productId);

        if (!product) {
            alert("상품을 선택해 주세요.");
            return;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            alert("수량은 1 이상의 정수로 입력해 주세요.");
            return;
        }

        if (type !== "in" && type !== "out") {
            alert("입출고 유형을 선택해 주세요.");
            return;
        }

        if (type === "out" && product.stock < quantity) {
            alert("현재 재고보다 많은 수량을 출고할 수 없습니다.");
            return;
        }

        const history = {
            id: createId(),
            productId: product.id,
            productName: product.name,
            type,
            quantity,
            memo,
            createdAt: Date.now(),
            date: new Date().toLocaleString("ko-KR")
        };

        if (type === "out") {
            history.salePrice = product.price;
        }

        inventoryHistory.push(history);

        if (!recalculateProductStocks()) {
            inventoryHistory.pop();
            recalculateProductStocks();
            alert("재고를 계산할 수 없습니다. 입력 내용을 확인해 주세요.");
            return;
        }

        if (!saveInventoryHistory() || !saveProducts()) {
            inventoryHistory.pop();
            recalculateProductStocks();
            saveInventoryHistory();
            saveProducts();
            return;
        }

        form.reset();

        renderProducts();
        renderInventoryHistory();

        alert(type === "in" ? "입고가 등록되었습니다!" : "출고가 등록되었습니다!");
    });

    historyList?.addEventListener("click", event => {
        const editButton = event.target.closest(".inventory-edit-button");
        const deleteButton = event.target.closest(".inventory-delete-button");

        if (editButton) {
            editInventoryHistory(editButton.dataset.id);
        }

        if (deleteButton) {
            deleteInventoryHistory(deleteButton.dataset.id);
        }
    });

    setupInventoryEditModal();
}

// ========================================
// 재고 기록 수정
// ========================================

function setupInventoryEditModal() {
    const modal = $("inventory-edit-modal");
    const form = $("inventory-edit-form");
    const closeButton = $("close-inventory-modal");

    closeButton?.addEventListener("click", () => {
        modal?.classList.remove("show");
        editingHistoryId = null;
    });

    modal?.addEventListener("click", event => {
        if (event.target === modal) {
            modal.classList.remove("show");
            editingHistoryId = null;
        }
    });

    form?.addEventListener("submit", event => {
        event.preventDefault();

        const history = inventoryHistory.find(item => {
            return item.id === editingHistoryId;
        });

        if (!history) {
            alert("수정할 기록을 찾을 수 없습니다.");
            return;
        }

        const newType = $("edit-inventory-type").value;
        const newQuantity = Number($("edit-inventory-quantity").value);

        if (newType !== "in" && newType !== "out") {
            alert("입출고 유형을 확인해 주세요.");
            return;
        }

        if (!Number.isInteger(newQuantity) || newQuantity <= 0) {
            alert("수량은 1 이상의 정수로 입력해 주세요.");
            return;
        }

        const previousProducts = JSON.parse(JSON.stringify(products));
        const previousInventory = JSON.parse(JSON.stringify(inventoryHistory));

        history.type = newType;
        history.quantity = newQuantity;

        if (!recalculateProductStocks()) {
            products = previousProducts;
            inventoryHistory = previousInventory;
            alert("이렇게 수정하면 재고가 음수가 되어 변경할 수 없습니다.");
            return;
        }

        if (!saveProducts() || !saveInventoryHistory()) {
            products = previousProducts;
            inventoryHistory = previousInventory;
            saveProducts();
            saveInventoryHistory();
            return;
        }

        modal?.classList.remove("show");
        editingHistoryId = null;

        renderProducts();
        renderInventoryHistory();

        alert("입출고 기록이 수정되었습니다.");
    });
}

function editInventoryHistory(historyId) {
    const history = inventoryHistory.find(item => item.id === historyId);

    if (!history) {
        alert("수정할 입출고 기록을 찾을 수 없습니다.");
        return;
    }

    editingHistoryId = historyId;

    if ($("edit-inventory-type")) {
        $("edit-inventory-type").value = history.type;
    }

    if ($("edit-inventory-quantity")) {
        $("edit-inventory-quantity").value = history.quantity;
    }

    $("inventory-edit-modal")?.classList.add("show");
}

// ========================================
// 재고 기록 삭제
// ========================================

function deleteInventoryHistory(historyId) {
    const index = inventoryHistory.findIndex(history => {
        return history.id === historyId;
    });

    if (index === -1) {
        alert("삭제할 입출고 기록을 찾을 수 없습니다.");
        return;
    }

    if (!confirm("이 입출고 기록을 삭제할까요?\n삭제하면 재고가 다시 계산됩니다.")) {
        return;
    }

    const previousProducts = JSON.parse(JSON.stringify(products));
    const previousHistory = JSON.parse(JSON.stringify(inventoryHistory));

    inventoryHistory.splice(index, 1);

    if (!recalculateProductStocks()) {
        products = previousProducts;
        inventoryHistory = previousHistory;
        alert("기록을 삭제할 수 없습니다.");
        return;
    }

    if (!saveInventoryHistory() || !saveProducts()) {
        products = previousProducts;
        inventoryHistory = previousHistory;
        saveInventoryHistory();
        saveProducts();
        return;
    }

    renderProducts();
    renderInventoryHistory();

    alert("입출고 기록이 삭제되었습니다.");
}

// ========================================
// 재고 기록 화면
// ========================================

function renderInventoryHistory() {
    const historyList = $("inventory-history");
    if (!historyList) return;

    historyList.innerHTML = "";

    const sortedHistory = [...inventoryHistory].sort((a, b) => {
        return Number(b.createdAt) - Number(a.createdAt);
    });

    if (sortedHistory.length === 0) {
        historyList.innerHTML = `
            <tr>
                <td colspan="6">아직 입출고 기록이 없습니다.</td>
            </tr>
        `;
        return;
    }

    sortedHistory.forEach(history => {
        const row = document.createElement("tr");

        const typeText = history.type === "in" ? "입고" : "출고";
        const typeClass = history.type === "in" ? "in" : "out";

        const dateText = history.date || new Date(
            Number(history.createdAt)
        ).toLocaleString("ko-KR");

        row.innerHTML = `
            <td>${escapeHTML(dateText)}</td>
            <td>${escapeHTML(history.productName || "삭제된 상품")}</td>
            <td>
                <span class="history-type ${typeClass}">
                    ${typeText}
                </span>
            </td>
            <td>${Number(history.quantity)}개</td>
            <td>${escapeHTML(history.memo || "-")}</td>
            <td>
                <button
                    class="inventory-edit-button"
                    data-id="${escapeHTML(history.id)}"
                >수정</button>

                <button
                    class="inventory-delete-button"
                    data-id="${escapeHTML(history.id)}"
                >삭제</button>
            </td>
        `;

        historyList.appendChild(row);
    });
}

// ========================================
// 판매 관리 이벤트
// ========================================

function setupSalesEvents() {
    const form = $("sales-form");
    const productSelect = $("sales-product");
    const quantityInput = $("sales-quantity");
    const priceInput = $("sales-price");
    const historyList = $("sales-history");

    productSelect?.addEventListener("change", updateSalesPrice);
    quantityInput?.addEventListener("input", updateSalesTotal);
    priceInput?.addEventListener("input", updateSalesTotal);

    form?.addEventListener("submit", event => {
        event.preventDefault();

        const productId = $("sales-product").value;
        const quantity = Number($("sales-quantity").value);
        const salePrice = Number($("sales-price").value);

        const product = products.find(item => item.id === productId);

        if (!product) {
            alert("상품을 선택해 주세요.");
            return;
        }

        if (!Number.isInteger(quantity) || quantity <= 0) {
            alert("판매 수량은 1 이상의 정수로 입력해 주세요.");
            return;
        }

        if (!Number.isFinite(salePrice) || salePrice < 0) {
            alert("판매 가격을 올바르게 입력해 주세요.");
            return;
        }

        if (product.stock < quantity) {
            alert("현재 재고가 부족합니다.");
            return;
        }

        const sale = {
            id: createId(),
            productId: product.id,
            productName: product.name,
            quantity,
            salePrice,
            total: quantity * salePrice,
            costSnapshot: product.cost,
            createdAt: Date.now(),
            date: new Date().toLocaleString("ko-KR")
        };

        salesHistory.push(sale);

        if (!recalculateProductStocks()) {
            salesHistory.pop();
            recalculateProductStocks();
            alert("재고를 계산할 수 없습니다. 입력 내용을 확인해 주세요.");
            return;
        }

        if (!saveSalesHistory() || !saveProducts()) {
            salesHistory.pop();
            recalculateProductStocks();
            saveSalesHistory();
            saveProducts();
            return;
        }

        form.reset();

        renderProducts();
        renderSalesHistory();

        alert("판매가 등록되었습니다!");
    });

    historyList?.addEventListener("click", event => {
        const editButton = event.target.closest(".sales-edit-button");
        const deleteButton = event.target.closest(".sales-delete-button");

        if (editButton) {
            editSale(editButton.dataset.id);
        }

        if (deleteButton) {
            deleteSale(deleteButton.dataset.id);
        }
    });
}

// ========================================
// 판매 기록 화면
// ========================================

function renderSalesHistory() {
    const historyList = $("sales-history");
    if (!historyList) return;

    historyList.innerHTML = "";

    const sortedHistory = [...salesHistory].sort((a, b) => {
        return Number(b.createdAt) - Number(a.createdAt);
    });

    if (sortedHistory.length === 0) {
        historyList.innerHTML = `
            <tr>
                <td colspan="6">아직 판매 기록이 없습니다.</td>
            </tr>
        `;
        return;
    }

    sortedHistory.forEach(sale => {
        const row = document.createElement("tr");

        const dateText = sale.date || new Date(
            Number(sale.createdAt)
        ).toLocaleString("ko-KR");

        row.innerHTML = `
            <td>${escapeHTML(dateText)}</td>
            <td>${escapeHTML(sale.productName || "삭제된 상품")}</td>
            <td>${Number(sale.quantity)}개</td>
            <td>${formatMoney(sale.salePrice)}</td>
            <td>${formatMoney(sale.quantity * sale.salePrice)}</td>
            <td>
                <div class="history-action-buttons">
                    <button
                        class="sales-edit-button"
                        data-id="${escapeHTML(sale.id)}"
                    >수정</button>

                    <button
                        class="sales-delete-button"
                        data-id="${escapeHTML(sale.id)}"
                    >삭제</button>
                </div>
            </td>
        `;

        historyList.appendChild(row);
    });
}

// ========================================
// 판매 기록 수정
// ========================================

function editSale(saleId) {
    const sale = salesHistory.find(item => item.id === saleId);

    if (!sale) {
        alert("수정할 판매 기록을 찾을 수 없습니다.");
        return;
    }

    const quantityInput = prompt(
        "변경할 판매 수량을 입력해 주세요.",
        String(sale.quantity)
    );

    if (quantityInput === null) return;

    const newQuantity = Number(quantityInput);

    if (!Number.isInteger(newQuantity) || newQuantity <= 0) {
        alert("판매 수량은 1 이상의 정수로 입력해 주세요.");
        return;
    }

    const priceInput = prompt(
        "변경할 개당 판매 가격을 입력해 주세요.",
        String(sale.salePrice)
    );

    if (priceInput === null) return;

    const newSalePrice = Number(priceInput);

    if (!Number.isFinite(newSalePrice) || newSalePrice < 0) {
        alert("판매 가격은 0 이상의 숫자로 입력해 주세요.");
        return;
    }

    if (
        newQuantity === Number(sale.quantity) &&
        newSalePrice === Number(sale.salePrice)
    ) {
        alert("변경된 내용이 없습니다.");
        return;
    }

    const previousProducts = JSON.parse(JSON.stringify(products));
    const previousSales = JSON.parse(JSON.stringify(salesHistory));

    sale.quantity = newQuantity;
    sale.salePrice = newSalePrice;
    sale.total = newQuantity * newSalePrice;

    if (!recalculateProductStocks()) {
        products = previousProducts;
        salesHistory = previousSales;

        alert("수정할 수 없습니다. 변경 후 재고가 음수가 됩니다.");
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

    alert("판매 기록이 수정되었습니다.");
}

// ========================================
// 판매 기록 삭제
// ========================================

function deleteSale(saleId) {
    const index = salesHistory.findIndex(sale => sale.id === saleId);

    if (index === -1) {
        alert("삭제할 판매 기록을 찾을 수 없습니다.");
        return;
    }

    if (!confirm("이 판매 기록을 삭제할까요?\n삭제하면 해당 상품의 재고가 복구됩니다.")) {
        return;
    }

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

// ========================================
// 재고 관리 화면으로 이동
// ========================================

function goToInventory(product) {
    if (!product) return;

    const target = $("inventory-section") || $("inventory");

    if (target) {
        target.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
    }

    document.querySelectorAll(".menu-item").forEach(item => {
        const href = item.getAttribute("href");

        item.classList.toggle(
            "active",
            href === "#inventory-section" || item.dataset.target === "inventory"
        );
    });

    if ($("page-title")) {
        $("page-title").textContent = "재고 관리";
    }

    const select = $("inventory-product");

    if (select) {
        select.value = product.id;
    }
}

// ========================================
// ROUND STORE 초기화
// ========================================

function initializeApp() {
    migrateExistingData();

    const previousProducts = JSON.parse(JSON.stringify(products));

    if (!recalculateProductStocks()) {
        console.warn("기존 재고 기록을 다시 계산하지 못했습니다.");
        products = previousProducts;
    } else {
        saveProducts();
    }

    applyAlertStyles();

    setupNavigation();
    setupProductEvents();
    setupInventoryEvents();
    setupSalesEvents();

    renderProducts();
    renderInventoryHistory();
    renderSalesHistory();
    updateDashboard();

    console.log("ROUND STORE FREE 버전이 실행되었습니다.");
}

// ========================================
// 앱 시작
// ========================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreAuthSession);
} else {
    restoreAuthSession();
}
