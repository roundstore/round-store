// ========================================
// ROUND STORE - STARTER VERSION
// 상품 관리 + 재고 관리 + 판매 관리
// 실제 누적 매출 / 실제 누적 이익 대시보드
// ========================================

const $ = (id) => document.getElementById(id);

function createId() {
    return "rs_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

// ========================================
// Supabase 및 저장소 설정
// ========================================

const SUPABASE_URL = "https://fnhvaepttummlgtpqqzi.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_L8cxzL08LASOjCGt1L9nZA___CVe95I";

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY
);

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
let storageMode = "locked";

let cloudSaveTimer = null;
let cloudSaveInProgress = false;
let cloudSaveAgain = false;

let products = [];
let inventoryHistory = [];
let salesHistory = [];

let editingIndex = null;
let editingHistoryId = null;

let appInitialized = false;

// ========================================
// 데이터 저장 및 불러오기
// ========================================

function parseArray(value) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function readGuestData() {
    return {
        products: parseArray(sessionStorage.getItem(SESSION_KEYS.products)),
        inventoryHistory: parseArray(sessionStorage.getItem(SESSION_KEYS.inventory)),
        salesHistory: parseArray(sessionStorage.getItem(SESSION_KEYS.sales))
    };
}

function readLegacyBrowserData() {
    return {
        products: parseArray(localStorage.getItem(STORAGE_KEYS.products)),
        inventoryHistory: parseArray(localStorage.getItem(STORAGE_KEYS.inventory)),
        salesHistory: parseArray(localStorage.getItem(STORAGE_KEYS.sales))
    };
}

function hasAnyData(data) {
    return (
        data.products.length > 0 ||
        data.inventoryHistory.length > 0 ||
        data.salesHistory.length > 0
    );
}

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

function persistCurrentData() {
    if (storageMode === "guest") {
        return writeGuestData();
    }

    if (storageMode === "cloud") {
        scheduleCloudSave();
        return true;
    }

    return false;
}

function saveProducts() {
    return persistCurrentData();
}

function saveInventoryHistory() {
    return persistCurrentData();
}

function saveSalesHistory() {
    return persistCurrentData();
}

function saveAllData() {
    return persistCurrentData();
}

// ========================================
// 클라우드 저장
// ========================================

function scheduleCloudSave() {
    if (storageMode !== "cloud" || !currentUser) return;

    clearTimeout(cloudSaveTimer);

    cloudSaveTimer = setTimeout(() => {
        saveCloudData();
    }, 500);
}

async function saveCloudData() {
    if (storageMode !== "cloud" || !currentUser) return;

    if (cloudSaveInProgress) {
        cloudSaveAgain = true;
        return;
    }

    cloudSaveInProgress = true;

    const userId = currentUser.id;

    const payload = {
        user_id: userId,
        products: JSON.parse(JSON.stringify(products)),
        inventory_history: JSON.parse(JSON.stringify(inventoryHistory)),
        sales_history: JSON.parse(JSON.stringify(salesHistory)),
        updated_at: new Date().toISOString()
    };

    let saveError = null;

    try {
        const { error } = await supabaseClient
            .from("user_data")
            .upsert(payload, { onConflict: "user_id" });

        saveError = error;
    } catch (error) {
        saveError = error;
    }

    cloudSaveInProgress = false;

    if (currentUser?.id === userId && storageMode === "cloud") {
        if (saveError) {
            console.error("클라우드 저장 실패:", saveError);

            const status = $("account-status");
            if (status) status.textContent = "● 저장 오류";

            showAuthMessage(
                "저장에 실패했습니다. 인터넷 연결을 확인해 주세요. 다시 변경하면 재시도합니다.",
                false
            );
        } else {
            const status = $("account-status");
            if (status) status.textContent = "● 계정에 저장됨";
        }
    }

    if (cloudSaveAgain) {
        cloudSaveAgain = false;

        if (storageMode === "cloud" && currentUser) {
            saveCloudData();
        }
    }
}

// ========================================
// 인증 메시지
// ========================================

function showAuthMessage(message, success = false) {
    const el = $("auth-message");

    if (!el) return;

    el.textContent = message;
    el.classList.toggle("success", success);
}

function showApp(modeLabel) {
    const authScreen = $("auth-screen");
    const mainApp = $("main-app");

    if (authScreen) {
        authScreen.classList.add("hidden");
        authScreen.style.display = "none";
    }

    mainApp?.classList.add("is-active");

    const status = $("account-status");
    if (status) status.textContent = modeLabel;

    const logout = $("logout-button");

    if (logout) {
        logout.textContent = storageMode === "guest" ? "체험 종료" : "로그아웃";
    }

    initializeApp();
}

// ========================================
// 회원 계정 활성화
// ========================================

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

        currentUser = null;
        storageMode = "locked";

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

        if (
            hasAnyData(guestData) &&
            confirm("무료체험에서 만든 상품·재고·판매 데이터를 이 계정으로 옮길까요?")
        ) {
            setData(guestData);
        } else {
            setData({
                products: [],
                inventoryHistory: [],
                salesHistory: []
            });
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

// ========================================
// 무료체험 시작
// ========================================

async function startGuestMode() {
    let guestData = readGuestData();

    if (!hasAnyData(guestData)) {
        const legacy = readLegacyBrowserData();

        if (hasAnyData(legacy)) {
            guestData = legacy;

            sessionStorage.setItem(SESSION_KEYS.products, JSON.stringify(legacy.products));
            sessionStorage.setItem(SESSION_KEYS.inventory, JSON.stringify(legacy.inventoryHistory));
            sessionStorage.setItem(SESSION_KEYS.sales, JSON.stringify(legacy.salesHistory));

            showAuthMessage(
                "기존 브라우저 데이터를 무료체험으로 불러왔습니다. 가입하면 계정에 저장할 수 있습니다.",
                true
            );
        }
    }

    setData(guestData);

    storageMode = "guest";

    showApp("● 무료체험 · 임시 저장");
}

// ========================================
// 회원가입 및 로그인
// ========================================

function setupAuthUI() {
    let authMode = "login";

    const loginTab = $("show-login");
    const signupTab = $("show-signup");
    const submit = $("auth-submit");
    const form = $("auth-form");

    function setAuthMode(mode) {
        authMode = mode;

        loginTab?.classList.toggle("active", mode === "login");
        signupTab?.classList.toggle("active", mode === "signup");

        if (submit) {
            submit.textContent = mode === "login" ? "로그인" : "회원가입";
        }

        if ($("auth-title")) {
            $("auth-title").textContent =
                mode === "login"
                    ? "매장 운영을 더 간편하게"
                    : "ROUND STORE 시작하기";
        }

        if ($("auth-password")) {
            $("auth-password").autocomplete =
                mode === "login" ? "current-password" : "new-password";
        }

        showAuthMessage("");
    }

    loginTab?.addEventListener("click", () => setAuthMode("login"));
    signupTab?.addEventListener("click", () => setAuthMode("signup"));

    $("start-guest")?.addEventListener("click", startGuestMode);

    form?.addEventListener("submit", async event => {
        event.preventDefault();
        event.stopPropagation();

        if (!submit) return;

        const email = $("auth-email")?.value.trim();
        const password = $("auth-password")?.value;

        if (!email || !password) {
            showAuthMessage("이메일과 비밀번호를 입력해 주세요.");
            return;
        }

        submit.disabled = true;

        showAuthMessage(
            authMode === "login" ? "로그인 중..." : "회원가입 처리 중...",
            true
        );

        try {
            if (authMode === "signup") {
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        emailRedirectTo: "https://roundstore.github.io/round-store/"
                    }
                });

                if (error) throw error;

                if (data.session && data.user) {
                    await activateUser(data.user);
                } else {
                    showAuthMessage(
                        "가입 요청이 완료됐습니다. 이메일 인증 링크를 확인한 뒤 로그인해 주세요.",
                        true
                    );
                }
            } else {
                const { data, error } = await supabaseClient.auth.signInWithPassword({
                    email,
                    password
                });

                if (error) throw error;

                await activateUser(data.user);
            }
        } catch (error) {
            console.error(error);

            showAuthMessage(
                error.message || "요청을 처리하지 못했습니다. 입력 내용을 확인해 주세요."
            );
        } finally {
            submit.disabled = false;
        }
    });

    $("logout-button")?.addEventListener("click", async () => {
        clearTimeout(cloudSaveTimer);

        if (storageMode === "guest") {
            sessionStorage.removeItem(SESSION_KEYS.products);
            sessionStorage.removeItem(SESSION_KEYS.inventory);
            sessionStorage.removeItem(SESSION_KEYS.sales);
        } else {
            await supabaseClient.auth.signOut();
        }

        currentUser = null;
        storageMode = "locked";

        products = [];
        inventoryHistory = [];
        salesHistory = [];

        const mainApp = $("main-app");
        const authScreen = $("auth-screen");

        mainApp?.classList.remove("is-active");

        if (authScreen) {
            authScreen.style.display = "grid";
            authScreen.classList.remove("hidden");
        }

        $("auth-form")?.reset();

        showAuthMessage("로그아웃되었습니다.", true);
    });
}

// ========================================
// 기존 로그인 복구
// ========================================

async function restoreAuthSession() {
    setupAuthUI();

    const {
        data: { session },
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        console.error(error);
        return;
    }

    if (session?.user) {
        await activateUser(session.user);
    }
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

// ========================================
// 월별 매출 계산
// ========================================

function getCurrentMonthRange() {
    const now = new Date();

    const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
    );

    const nextMonth = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        1
    );

    const totalDays = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0
    ).getDate();

    return {
        start: start.getTime(),
        end: nextMonth.getTime(),
        elapsedDays: now.getDate(),
        totalDays,
        monthLabel: `${now.getMonth() + 1}월`
    };
}

function getCurrentMonthSales() {
    const month = getCurrentMonthRange();

    return salesHistory.filter(sale => {
        const createdAt = Number(sale.createdAt);

        return (
            Number.isFinite(createdAt) &&
            createdAt >= month.start &&
            createdAt < month.end
        );
    });
}

function hasValidCostSnapshot(sale) {
    return (
        sale.costSnapshot !== undefined &&
        sale.costSnapshot !== null &&
        Number.isFinite(Number(sale.costSnapshot))
    );
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
                .reduce((total, sale) => {
                    return total + Number(sale.quantity);
                }, 0);

            product.baseStock = product.stock - inventoryMovement + salesMovement;

            changed = true;
        } else {
            product.baseStock = Number(product.baseStock) || 0;
        }
    });

    if (changed) {
        saveAllData();
    }
}

// ========================================
// 재고 자동 계산
// ========================================

function recalculateProductStocks() {
    const stockMap = new Map();

    products.forEach(product => {
        stockMap.set(product.id, Number(product.baseStock) || 0);
    });

    const events = [
        ...inventoryHistory.map((history, index) => ({
            ...history,
            eventType: "inventory",
            originalIndex: index
        })),

        ...salesHistory.map((sale, index) => ({
            ...sale,
            eventType: "sale",
            originalIndex: index
        }))
    ].sort((a, b) => {
        const timeDifference = Number(a.createdAt) - Number(b.createdAt);

        if (timeDifference !== 0) return timeDifference;

        return a.eventType.localeCompare(b.eventType);
    });

    const inventoryStockAfter = new Map();
    const salesStockAfter = new Map();

    for (const event of events) {
        if (!stockMap.has(event.productId)) continue;

        const quantity = Number(event.quantity);

        if (!Number.isInteger(quantity) || quantity <= 0) {
            return false;
        }

        let stock = stockMap.get(event.productId);

        if (event.eventType === "sale") {
            stock -= quantity;
        } else if (event.type === "in") {
            stock += quantity;
        } else if (event.type === "out") {
            stock -= quantity;
        } else {
            return false;
        }

        if (stock < 0) return false;

        stockMap.set(event.productId, stock);

        if (event.eventType === "sale") {
            salesStockAfter.set(event.id, stock);
        } else {
            inventoryStockAfter.set(event.id, stock);
        }
    }

    products.forEach(product => {
        product.stock = stockMap.get(product.id) ?? 0;
    });

    inventoryHistory.forEach(history => {
        if (inventoryStockAfter.has(history.id)) {
            history.stockAfter = inventoryStockAfter.get(history.id);
        }
    });

    salesHistory.forEach(sale => {
        if (salesStockAfter.has(sale.id)) {
            sale.stockAfter = salesStockAfter.get(sale.id);
        }
    });

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

    select.innerHTML = `<option value="">상품을 선택하세요</option>`;

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

    select.innerHTML = `<option value="">상품을 선택하세요</option>`;

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
// 재고 알림 스타일 및 영역
// ========================================

function applyAlertStyles() {
    if (!$("round-store-alert-styles")) {
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
                background: #fff;
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
                transition: transform .2s;
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
                background: #fff;
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
                background: #fff;
                color: #34394b;
                font-size: 12px;
                font-weight: 600;
                cursor: pointer;
                text-align: left;
            }

            .round-alert-product.danger { color: #c73535; }
            .round-alert-product.urgent { color: #c45b1d; }
            .round-alert-product.warning { color: #947014; }

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

    if (!$("round-alert-area")) {
        const topbar = document.querySelector(".topbar");

        if (topbar) {
            const area = document.createElement("div");

            area.id = "round-alert-area";
            area.className = "round-alert-area";

            topbar.insertAdjacentElement("afterend", area);
        }
    }
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

    const urgentCount = alertProducts.filter(product => {
        return product.stock > 0 && product.stock <= 3;
    }).length;

    const warningCount = alertProducts.filter(product => {
        return product.stock > 3 && product.stock <= 5;
    }).length;

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
                            <div class="round-alert-group-title">
                                재고 확인이 필요한 상품
                            </div>

                            ${alertProducts.map(product => `
                                <button
                                    type="button"
                                    class="round-alert-product ${getAlertLevel(product)}"
                                    data-product-id="${escapeHTML(product.id)}"
                                >
                                    <span class="round-alert-product-name">
                                        ${escapeHTML(product.name)}
                                    </span>

                                    <span class="round-alert-stock">
                                        ${product.stock}개 남음
                                    </span>
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
            const product = products.find(item => {
                return item.id === button.dataset.productId;
            });

            if (product) goToInventory(product);
        });
    });
}

// ========================================
// 대시보드 - 실제 누적 통계
// ========================================

function updateDashboard() {
    const productCount = products.length;

    const lowStockProducts = products.filter(product => {
        return product.stock <= 5;
    });

    const lowStockCount = lowStockProducts.length;

    const month = getCurrentMonthRange();
    const monthSales = getCurrentMonthSales();

    // 이번 달 실제 누적 매출
    const monthRevenue = monthSales.reduce((total, sale) => {
        return total + (
            Number(sale.quantity) * Number(sale.salePrice)
        );
    }, 0);

    // 전체 기간 실제 누적 매출
    const allTimeRevenue = salesHistory.reduce((total, sale) => {
        return total + (
            Number(sale.quantity) * Number(sale.salePrice)
        );
    }, 0);

    // 원가 기록이 있는 이번 달 판매만 이익 계산
    const validProfitSales = monthSales.filter(sale => {
        return hasValidCostSnapshot(sale);
    });

    const monthProfit = validProfitSales.reduce((total, sale) => {
        const cost = Number(sale.costSnapshot);

        return total + (
            (Number(sale.salePrice) - cost) *
            Number(sale.quantity)
        );
    }, 0);

    // 대시보드 제목
    if ($("month-total-sales-label")) {
        $("month-total-sales-label").textContent =
            `${month.monthLabel} 누적 매출`;
    }

    if ($("all-total-sales-label")) {
        $("all-total-sales-label").textContent = "전체 누적 매출";
    }

    if ($("month-total-profit-label")) {
        $("month-total-profit-label").textContent =
            `${month.monthLabel} 누적 이익`;
    }

    // 이번 달 실제 매출
    if ($("month-total-sales")) {
        $("month-total-sales").textContent =
            formatMoney(monthRevenue);
    }

    // 전체 실제 매출
    if ($("total-sales")) {
        $("total-sales").textContent =
            formatMoney(allTimeRevenue);
    }

    // 이번 달 실제 이익
    if ($("total-profit")) {
        $("total-profit").textContent =
            formatMoney(monthProfit);
    }

    // 이익 계산 기준 안내
    if ($("month-profit-note")) {
        $("month-profit-note").textContent =
            validProfitSales.length > 0
                ? `원가 기록이 있는 판매 ${validProfitSales.length}건 기준`
                : "원가 기록이 있는 판매 내역 없음";
    }

    // 상품 수
    if ($("product-count")) {
        $("product-count").textContent = productCount + "개";
    }

    // 재고 부족 상품 수
    if ($("low-stock")) {
        $("low-stock").textContent = lowStockCount + "개";
    }

    if ($("alert-count")) {
        $("alert-count").textContent = lowStockCount + "건";
    }

    // 대시보드 재고 알림
    const alertEmpty = $("alert-empty");
    const alertList = $("alert-list");

    if (alertEmpty) {
        alertEmpty.style.display =
            lowStockCount > 0 ? "none" : "flex";
    }

    if (alertList) {
        if (lowStockCount === 0) {
            alertList.innerHTML = "";
        } else {
            alertList.innerHTML = lowStockProducts.map(product => {
                const type = product.stock <= 3
                    ? "danger"
                    : "warning";

                return `
                    <div
                        class="consultant-card ${type} dashboard-alert-item"
                        data-product-id="${escapeHTML(product.id)}"
                    >
                        <strong>${escapeHTML(product.name)}</strong>
                        <p>
                            현재 재고가 ${product.stock}개입니다.
                            재고 상태를 확인해 주세요.
                        </p>
                    </div>
                `;
            }).join("");

            alertList.querySelectorAll(".dashboard-alert-item").forEach(card => {
                card.addEventListener("click", () => {
                    const product = products.find(item => {
                        return item.id === card.dataset.productId;
                    });

                    if (product) goToInventory(product);
                });
            });
        }
    }

    renderTopAlerts();
}

// ========================================
// 상품 목록
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
            const profit = (
                Number(product.price) - Number(product.cost)
            ) * Number(product.stock);

            const row = document.createElement("tr");

            row.innerHTML = `
                <td>${escapeHTML(product.name)}</td>
                <td>${formatMoney(product.price)}</td>
                <td>${formatMoney(product.cost)}</td>
                <td>${product.stock}개</td>
                <td>${formatMoney(profit)}</td>
                <td>
                    <button class="edit-button" data-index="${index}">
                        수정
                    </button>

                    <button class="delete-button" data-index="${index}">
                        삭제
                    </button>
                </td>
            `;

            productList.appendChild(row);
        });
    }

    updateDashboard();
}

// ========================================
// 상품 등록 / 수정 공통
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
        alert(
            "이 상품에는 입출고 또는 판매 기록이 있습니다.\n" +
            "관련 기록을 먼저 삭제한 후 상품을 삭제해 주세요."
        );

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
        event.stopPropagation();

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

            if (!oldProduct) {
                alert("수정할 상품을 찾을 수 없습니다.");
                return;
            }

            const stockDifference = stock - oldProduct.stock;

            products[previousIndex] = {
                ...oldProduct,
                name,
                price,
                cost,
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

        if (!recalculateProductStocks()) {
            products = previousProducts;
            inventoryHistory = previousInventory;
            salesHistory = previousSales;

            alert("변경 후 재고가 음수가 됩니다. 수량을 다시 확인해 주세요.");

            return;
        }

        if (!saveAllData()) {
            products = previousProducts;
            inventoryHistory = previousInventory;
            salesHistory = previousSales;

            return;
        }

        renderProducts();
        renderInventoryHistory();
        renderSalesHistory();

        productForm.reset();
        modal?.classList.remove("show");

        resetForm();

        alert(
            previousIndex === null
                ? "상품이 등록되었습니다!"
                : "상품이 수정되었습니다!"
        );
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
        event.stopPropagation();

        const productId = $("inventory-product").value;
        const type = $("inventory-type").value;
        const quantity = Number($("inventory-quantity").value);

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
            memo: "",
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

        if (!saveAllData()) {
            inventoryHistory.pop();
            recalculateProductStocks();

            return;
        }

        form.reset();

        renderProducts();
        renderInventoryHistory();

        alert(
            type === "in"
                ? "입고가 등록되었습니다!"
                : "출고가 등록되었습니다!"
        );
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
// 재고 기록 수정 모달
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
        event.stopPropagation();

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

        if (!saveAllData()) {
            products = previousProducts;
            inventoryHistory = previousInventory;

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

    $("edit-inventory-type").value = history.type;
    $("edit-inventory-quantity").value = history.quantity;

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

    if (!saveAllData()) {
        products = previousProducts;
        inventoryHistory = previousHistory;

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

            <td>${Number(history.stockAfter ?? 0)}개</td>

            <td>
                <button
                    class="inventory-edit-button history-edit-button"
                    data-id="${escapeHTML(history.id)}"
                >수정</button>

                <button
                    class="inventory-delete-button history-delete-button"
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
        event.stopPropagation();

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

        if (!saveAllData()) {
            salesHistory.pop();
            recalculateProductStocks();

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

    if (!saveAllData()) {
        products = previousProducts;
        salesHistory = previousSales;

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

    if (!confirm(
        "이 판매 기록을 삭제할까요?\n삭제하면 해당 상품의 재고가 복구됩니다."
    )) {
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

    if (!saveAllData()) {
        products = previousProducts;
        salesHistory = previousSales;

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
            href === "#inventory-section" ||
            item.dataset.target === "inventory"
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
    if (appInitialized) {
        renderProducts();
        renderInventoryHistory();
        renderSalesHistory();
        updateDashboard();

        return;
    }

    appInitialized = true;

    migrateExistingData();

    if (!recalculateProductStocks()) {
        console.warn("기존 재고 기록을 다시 계산하지 못했습니다.");
    } else {
        saveAllData();
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

    console.log("ROUND STORE STARTER 버전이 실행되었습니다.");
}

// ========================================
// 앱 시작
// ========================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restoreAuthSession);
} else {
    restoreAuthSession();
}
