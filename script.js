
// Records are loaded from MySQL by api/index.php, not hard-coded demo arrays.
let products = [];
let orders = [];
let riders = [];
let customers = [];
let addresses = [];
let storeSettings = {delivery_fee: 40, free_delivery_min: 200};
let csrfToken = '';
let loadedUserId = null;
let loadingError = '';
let mailMode = 'log';
let gpsWatchId = null;
let gpsRefreshTimer = null;
let gpsOrderId = null;
let gpsLastSent = 0;
let gpsMap = null;
let gpsMapTimer = null;
let gpsMapGeneration = 0;
let gpsMapMarkers = [];

/*NAVIGATION MENUS*/

const customerMenu = [
  ["dashboard", "Dashboard", "grid"],
  ["products", "Products", "box-seam"],
  ["cart", "Cart", "cart3"],
  ["orders", "My Orders", "receipt"],
  ["tracking", "Order Tracking", "geo-alt"],
  ["addresses", "Addresses", "house"],
  ["profile", "Profile", "person"]
];

const adminMenu = [
  ["admin", "Dashboard", "grid"],
  ["admin-orders", "Orders", "receipt"],
  ["admin-products", "Products", "box-seam"],
  ["admin-customers", "Customers", "people"],
  ["admin-riders", "Riders", "bicycle"],
  ["admin-delivery", "Deliveries", "truck"],
  ["admin-reports", "Reports", "bar-chart"],
  ["admin-settings", "Settings", "gear"]
];

const riderMenu = [
  ["rider", "Dashboard", "grid"],
  ["deliveries", "Assigned Deliveries", "clipboard-check"],
  ["history", "Delivery History", "clock-history"],
  ["rider-profile", "Profile", "person"]
];


/*APPLICATION STATE*/
let cart = [];
let currentUser = null;
let portal = 'customer';
let selectedOrderId = sessionStorage.getItem('aquaflowSelectedOrder') || '';
let selectedProductQty = {};

async function api(action, data = null) {
  const options = {credentials:'same-origin', cache:'no-store'};
  if (data !== null) {
    options.method = 'POST';
    options.headers = {'Content-Type':'application/json', 'X-CSRF-Token':csrfToken};
    options.body = JSON.stringify(data);
  }
  let response;
  try { response = await fetch(`api/index.php?action=${encodeURIComponent(action)}`, options); }
  catch { throw new Error('Cannot reach PHP server. Start Apache and MySQL in XAMPP.'); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('PHP server returned an invalid response. Check Apache and PHP error logs.'); }
  if (!response.ok || !result.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
async function refreshData() {
  const data = await api('bootstrap');
  csrfToken = data.csrf;
  const previousId = loadedUserId;
  currentUser = data.user;
  portal = currentUser?.role || 'customer';
  if (previousId !== currentUser?.id) loadedUserId = currentUser?.id || null;
  products = data.products || [];
  cart = data.cart || [];
  orders = data.orders || [];
  riders = data.riders || [];
  customers = data.customers || [];
  addresses = data.addresses || [];
  storeSettings = data.settings || storeSettings;
  mailMode = data.mail_mode || 'log';
  if (!orders.some(order => order.id === selectedOrderId)) selectedOrderId = orders[0]?.id || '';
}
async function runAction(action, data, successMessage = 'Changes saved.') {
  try {
    const result = await api(action, data);
    await refreshData();
    render();
    if (successMessage) toast(successMessage);
    return result;
  } catch (e) { toast(e.message); return null; }
}
async function bootApp() {
  try { await refreshData(); loadingError = ''; render(); }
  catch (e) {
    loadingError = e.message;
    document.getElementById('app').innerHTML = `<main class="container py-5"><div class="alert alert-danger"><h4>Database connection error</h4><p>${esc(e.message)}</p><p class="mb-0">Import <code>database/aquaflow.sql</code> into phpMyAdmin, then check <code>api/config.php</code>. Open the website through <code>http://localhost/AquaFlow_PHP_MySQL/</code>.</p></div></main>`;
  }
}

/*HELPER FUNCTIONS*/

const money = (amount) => {
  return "₱" + Number(amount).toLocaleString("en-PH");
};

const esc = (value) => {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]
  );
};

const go = (path) => {
  location.hash = path;
};

const cartCount = () => {
  return cart.reduce((sum, item) => sum + item.qty, 0);
};

const initialsFor = (name) => {
  return (name || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
};

/*TOAST / NOTIFICATION */

function toast(message) {
  const toastArea = document.getElementById("toastArea");

  if (!toastArea) return;

  toastArea.innerHTML = `
    <div class="toast show shadow-sm" role="alert">
      <div class="toast-body">
        <i class="bi bi-check-circle-fill text-success me-2"></i>
        ${esc(message)}
      </div>
    </div>
  `;

  setTimeout(() => {
    toastArea.innerHTML = "";
  }, 2600);
}

/*CART FUNCTIONS
*/

async function addCart(id, qty = 1) {
  const product = products.find(p=>Number(p.id)===Number(id));
  if (!product || !currentUser || currentUser.role!=='customer') return;
  qty = Math.max(1, Math.floor(Number(qty)||1));
  const current = Number(cart.find(item=>Number(item.id)===Number(id))?.qty || 0);
  if (current + qty > Number(product.stock)) { toast('Not enough stock available.'); return; }
  await runAction('cart_set',{id,qty:current+qty},`${product.name} added to your cart.`);
}
async function changeQty(id, difference) {
  const item = cart.find(p=>Number(p.id)===Number(id));
  if (!item) return;
  const product=products.find(p=>Number(p.id)===Number(id));
  const qty=Math.max(0,Number(item.qty)+Number(difference));
  if (product && qty > Number(product.stock)) {toast('Not enough stock available.');return;}
  await runAction('cart_set',{id,qty},null);
}
async function removeCart(id) {await runAction('cart_set',{id,qty:0},'Item removed from cart.');}

/*PRODUCT FUNCTIONS*/

function productVisual(product, small = false) {
  if (!product) return '';
  return `
    <div class="${small ? "product-mini" : "product-placeholder"}">
      <i class="bi bi-${['droplet','water','droplet-half'].includes(product.icon) ? product.icon : 'droplet'}"></i>
    </div>
  `;
}

function changeProductQty(id, difference) {
  selectedProductQty[id] = Math.max(
    1,
    (selectedProductQty[id] || 1) + difference
  );

  const element = document.getElementById(`pq-${id}`);

  if (element) {
    element.textContent = selectedProductQty[id];
  }
}

function addProductFromPage(id) {
  addCart(
    id,
    selectedProductQty[id] || 1
  );

  selectedProductQty[id] = 1;
}

/*ORDER FUNCTIONS*/

function statusBadge(status) {
  const statusClasses = {
    Pending: "status-pending",
    Confirmed: "status-confirmed",
    Preparing: "status-preparing",
    Assigned: "status-assigned",
    "Out for Delivery": "status-out",
    Delivered: "status-delivered",
    Cancelled: "status-cancelled"
  };

  const className =
    statusClasses[status] || "badge-soft";

  return `
    <span class="badge ${className}">
      ${esc(status)}
    </span>
  `;
}

function currentOrder() {
  return orders.find((order) => order.id === selectedOrderId) || orders[0] || null;
}
function customerOrders() { return orders; }
function selectOrder(id) {
  if (!orders.some(order => order.id === id)) { toast('Order not found.'); return; }
  selectedOrderId = id;
  sessionStorage.setItem('aquaflowSelectedOrder', id);
  go('/tracking');
}

/* PUBLIC NAVIGATION */

function publicNav() {
  return `
  <nav class="navbar navbar-expand-lg sticky-top">
  <div class="container">

  <a class="navbar-brand d-flex align-items-center gap-2 fw-bold"
  href="#/">
  <span class="brand-mark">
  <i class="bi bi-droplet-fill"></i>
  </span>
  <span class="text-primary">AquaFlow</span>
  </a>

        <button
          class="navbar-toggler"
          data-bs-toggle="collapse"
          data-bs-target="#publicNav">
          <i class="bi bi-list"></i>
        </button>

        <div class="collapse navbar-collapse" id="publicNav">

          <div class="navbar-nav mx-auto gap-lg-3">
            <a class="nav-link" href="#/">Home</a>
            <a class="nav-link" href="#/products-public">Services</a>
            <a class="nav-link" href="#/about">About</a>
            <a class="nav-link" href="#/contact">Contact</a>
          </div>

          <div class="d-flex gap-2">
            <a class="btn btn-outline-primary btn-sm"
               href="#/login">
              Login
            </a>

            <a class="btn btn-primary btn-sm"
               href="#/register">
              Register
            </a>
    </div>
    </div>
    </div>
    </nav>
  `;
}

/*PUBLIC PAGES*/

function landing() {
  return `
    ${publicNav()}

  <section class="hero">
  <div class="container position-relative">
  <div class="row align-items-center g-5">

          <div class="col-lg-6">

            <span class="badge rounded-pill bg-white text-primary px-3 py-2 mb-3">
              <i class="bi bi-shield-check me-1"></i>
              Trusted local water delivery
            </span>

            <h1 class="display-4 fw-bold lh-sm">
              Convenient Water Delivery at Your Doorstep
            </h1>

            <p class="lead opacity-75 mt-3">
              Order quality drinking water for your home or office,
              choose your schedule, and keep every delivery organized
              in one place.
            </p>

            <div class="d-flex flex-wrap gap-2 mt-4">
              <a class="btn btn-light text-primary fw-semibold px-4"
                 href="#/products-public">
                Order Water Now
                <i class="bi bi-arrow-right ms-1"></i>
              </a>

              <a class="btn btn-outline-light px-4"
                 href="#/login">
                Sign In
              </a>
            </div>

            <div class="d-flex flex-wrap gap-4 mt-4 small">
              <span>
                <i class="bi bi-check2-circle me-1"></i>
                Same-day delivery
              </span>

              <span>
                <i class="bi bi-check2-circle me-1"></i>
                Easy scheduling
              </span>
            </div>

          </div>

          <div class="col-lg-6">
            <div class="hero-visual">

              <div class="hero-bubble one">
                <i class="bi bi-truck text-primary me-1"></i>
                Doorstep delivery
              </div>

              <div class="water-bottle">
                <div class="water-label">
                  AquaFlow
                  <br>
                  <small>PURE WATER</small>
                </div>
              </div>

              <div class="hero-bubble two">
                <i class="bi bi-clock text-primary me-1"></i>
                Choose your time
              </div>

    </div>
    </div>
    </div>
    </div>
    </section>

    <section class="py-5">
      <div class="container">

        <div class="section-title text-center mb-4">
          <h2 class="fw-bold">Available Water Products</h2>
          <p class="text-muted">
            Choose the water that fits your household or office needs.
          </p>
        </div>

        <div class="row g-4">

          ${products.map((product) => `
            <div class="col-md-4">

              <div class="card h-100 overflow-hidden">

                ${productVisual(product)}

                <div class="p-4">

                  <div class="d-flex justify-content-between gap-2">
                    <h5 class="mb-1">
                      ${esc(product.name)}
                    </h5>

                    <strong class="text-primary">
                      ${money(product.price)}
                    </strong>
                  </div>

                  <div class="small-muted mb-3">
                    per gallon
                  </div>

                  <p class="text-muted">
                    ${esc(product.desc)}
                  </p>

                  <a href="#/products-public"
                     class="btn btn-outline-primary btn-sm w-100">
                    View Product
                  </a>

                </div>
              </div>

            </div>
          `).join("")}

        </div>
      </div>
    </section>

    <section class="section-soft py-5">
      <div class="container">

        <div class="section-title text-center mb-5">
          <h2 class="fw-bold">How It Works</h2>
          <p class="text-muted">
            Four simple steps from order to doorstep.
          </p>
        </div>

        <div class="row g-4">

          ${[
            [
              "1",
              "Create Account",
              "Register your customer details and delivery address."
            ],
            [
              "2",
              "Choose Products",
              "Select your preferred water and quantity."
            ],
            [
              "3",
              "Schedule Delivery",
              "Choose a delivery date and available time slot."
            ],
            [
              "4",
              "Receive Your Order",
              "Follow the status and receive your water at home."
            ]
          ].map((item) => `
            <div class="col-md-3">

              <div class="card h-100 p-4 text-center">

                <div class="step-number mb-3">
                  ${esc(item[0])}
                </div>

                <h6>${item[1]}</h6>

                <p class="small-muted mb-0">
                  ${item[2]}
                </p>

              </div>

            </div>
          `).join("")}

        </div>
      </div>
    </section>

    <section class="py-5">
      <div class="container">

        <div class="row align-items-center g-5">

          <div class="col-lg-6">

            <span class="text-primary fw-semibold">
              WHY CHOOSE AQUAFLOW
            </span>

            <h2 class="fw-bold mt-2">
              Simple ordering for everyday water needs.
            </h2>

            <p class="text-muted">
              A practical local delivery service designed around
              clear prices, flexible schedules, organized orders,
              and easy status updates.
            </p>

            ${[
              [
                "Quality-focused",
                "Products are prepared for clean and convenient everyday drinking.",
                "shield-check"
              ],
              [
                "Reliable scheduling",
                "Choose a preferred date and time before placing your order.",
                "calendar-check"
              ],
              [
                "Clear pricing",
                "See item totals and delivery fees before checkout.",
                "receipt"
              ],
              [
                "Organized delivery",
                "Customer, staff, and rider screens keep each order easy to follow.",
                "people"
              ]
            ].map((item) => `
              <div class="d-flex gap-3 mb-3">

                <div class="icon-box">
                  <i class="bi bi-${item[2]}"></i>
                </div>

                <div>
                  <b>${esc(item[0])}</b>
                  <p class="small-muted mb-0">
                    ${item[1]}
                  </p>
                </div>

              </div>
            `).join("")}

          </div>

          <div class="col-lg-6">

            <div class="card p-4 bg-light border-0">

              <div class="d-flex justify-content-between align-items-center mb-3">
                <b>Delivery Service</b>

                <span class="badge badge-soft">
                  07:00 AM - 07:00 PM
                </span>
              </div>

              <div class="map-box">
                <i class="bi bi-geo-alt-fill map-pin"></i>
              </div>

              <p class="small-muted mt-3 mb-0">
                <i class="bi bi-info-circle me-1"></i>
                Delivery coverage and schedule are sample values
                for this college project.
              </p>

            </div>

          </div>

        </div>
      </div>
    </section>

    <section class="section-soft py-5">
      <div class="container">

        <div class="row g-4">

          <div class="col-md-4">
            <h5>Contact</h5>
            <p class="small-muted mb-1">0917-123-4567</p>
            <p class="small-muted">
              support@aquaflow.local
            </p>
          </div>

          <div class="col-md-4">
            <h5>Service Area</h5>
            <p class="small-muted">
              Selected areas in Metro Manila
            </p>
          </div>

          <div class="col-md-4">
            <h5>Business Hours</h5>
            <p class="small-muted">
              Monday - Sunday, 7:00 AM - 7:00 PM
            </p>
          </div>

        </div>
      </div>
    </section>

    <footer class="py-4">
      <div class="container d-flex flex-wrap justify-content-between gap-2 small">
        <span>© 2026 AquaFlow Water Delivery</span>
        <span>Convenient. Reliable. Fresh.</span>
      </div>
    </footer>
  `;
}

/*ABOUT PAGE*/

function aboutPage() {
  return `
    ${publicNav()}

    <div class="container py-5">

      <div class="row justify-content-center">
        <div class="col-lg-8 text-center">

          <span class="text-primary fw-semibold">
            ABOUT AQUAFLOW
          </span>

          <h1 class="fw-bold mt-2">
            A simple local water delivery platform.
          </h1>

          <p class="text-muted lead">
            AquaFlow is a web-based water delivery booking and order management
            system. It demonstrates how customers, staff, and riders can use
            connected screens to manage a water delivery workflow.
          </p>

        </div>
      </div>

      <div class="row g-4 mt-4">

        <div class="col-md-4">
          <div class="card p-4 h-100">

            <div class="icon-box mb-3">
              <i class="bi bi-droplet"></i>
            </div>

            <h5>Customer-first</h5>

            <p class="small-muted">
              Customers can browse products, build a cart,
              schedule delivery, and review order status.
            </p>

          </div>
        </div>

        <div class="col-md-4">
          <div class="card p-4 h-100">

            <div class="icon-box mb-3">
              <i class="bi bi-speedometer2"></i>
            </div>

            <h5>Organized operations</h5>

            <p class="small-muted">
              Staff can review orders, manage products,
              assign riders, and view reports.
            </p>

          </div>
        </div>

        <div class="col-md-4">
          <div class="card p-4 h-100">

            <div class="icon-box mb-3">
              <i class="bi bi-bicycle"></i>
            </div>

            <h5>Rider workflow</h5>

            <p class="small-muted">
              Riders can see assigned deliveries and update
              delivery progress.
            </p>

          </div>
        </div>

      </div>
    </div>
  `;
}

/*CONTACT PAGE*/

function contactPage() {
  return `
    ${publicNav()}

    <div class="container py-5">

      <div class="row g-4 justify-content-center">

        <div class="col-lg-5">

          <span class="text-primary fw-semibold">
            CONTACT US
          </span>

          <h1 class="fw-bold mt-2">
            Need help with your water order?
          </h1>

          <p class="text-muted">
            Use the sample contact details below for the prototype.
          </p>

          <div class="card p-4 mt-4">

            <p>
              <i class="bi bi-telephone text-primary me-2"></i>
              0917-123-4567
            </p>

            <p>
              <i class="bi bi-envelope text-primary me-2"></i>
              support@aquaflow.local
            </p>

            <p class="mb-0">
              <i class="bi bi-geo-alt text-primary me-2"></i>
              Metro Manila service area
            </p>

          </div>

        </div>

        <div class="col-lg-5">

          <div class="card p-4">

            <h5>Send a Message</h5>

            <input
              id="contactName" class="form-control mb-3"
              placeholder="Your name"
            >

            <input
              id="contactEmail" type="email" class="form-control mb-3"
              placeholder="Email address"
            >

            <textarea
              id="contactMessage" class="form-control mb-3"
              rows="5"
              placeholder="How can we help?"
            ></textarea>

            <button
              class="btn btn-primary w-100"
              onclick="submitContact()">
              Send Message
            </button>

          </div>

        </div>

      </div>
    </div>
  `;
}

async function submitContact() {
  const data={name:document.getElementById('contactName').value,email:document.getElementById('contactEmail').value,
  message:document.getElementById('contactMessage').value};
  const result=await runAction('contact_send',data,'Your message was submitted.');
}

/*  PUBLIC PRODUCTS*/

function publicProducts() {
  return `
    ${publicNav()}

    <div class="container py-5">

      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>
          <span class="text-primary fw-semibold">
            OUR SERVICES
          </span>

          <h2 class="fw-bold mt-1">
            Water Products
          </h2>

          <p class="text-muted mb-0">
            Current products and prices from our catalog.
          </p>
        </div>

        <a href="#/login" class="btn btn-primary">
          Order as Customer
        </a>

      </div>

      <div class="row g-4">

        ${products.map((product) => `
          <div class="col-md-4">

            <div class="card overflow-hidden h-100">

              ${productVisual(product)}

              <div class="p-4">

                <h5>${esc(product.name)}</h5>

                <p class="small-muted">
                  ${esc(product.desc)}
                </p>

                <div class="d-flex justify-content-between align-items-center">

                  <strong class="text-primary fs-5">
                    ${money(product.price)}
                  </strong>

                  <span class="small-muted">
                    ${product.stock} available
                  </span>

                </div>

              </div>

            </div>

          </div>
        `).join("")}

      </div>
    </div>
  `;
}

/* LOGIN / REGISTER*/

function authCard(mode) {
  const isRegister = mode === "register";

  return `
    <div class="auth-page">

      <div class="auth-card">

        <div class="text-center mb-4">

          <span class="brand-mark">
            <i class="bi bi-droplet-fill"></i>
          </span>

          <h3 class="fw-bold mt-3 mb-1">
            ${isRegister ? "Create your account" : "Welcome back"}
          </h3>

          <p class="small-muted">
            ${
              isRegister
                ? "Set up your AquaFlow account."
                : "Sign in to continue to AquaFlow."
            }
          </p>

        </div>

        ${
          isRegister
            ? `
              <div class="row g-3">

                <div class="col-md-6">
                  <label class="form-label">Full Name</label>
                  <input
                    id="regName"
                    class="form-control"
                    placeholder="Maria Santos"
                  >
                </div>

                <div class="col-md-6">
                  <label class="form-label">Contact Number</label>
                  <input
                    id="regContact"
                    class="form-control"
                    placeholder="0917-123-4567"
                  >
                </div>

                <div class="col-12">
                  <label class="form-label">Email Address</label>
                  <input
                    id="regEmail"
                    type="email"
                    class="form-control"
                    placeholder="maria.santos@email.com"
                  >
                </div>

                <div class="col-12">
                  <label class="form-label">Delivery Address</label>
                  <input
                    id="regAddress"
                    class="form-control"
                    placeholder="123 Sample St., Bagong Silang, Caloocan City"
                  >
                </div>

                <div class="col-md-6">
                  <label class="form-label">Password</label>
                  <input
                    id="regPass"
                    type="password"
                    class="form-control"
                    placeholder="Minimum 8 characters"
                  >
                </div>

                <div class="col-md-6">
                  <label class="form-label">Confirm Password</label>
                  <input
                    id="regConfirm"
                    type="password"
                    class="form-control"
                  >
                </div>

              </div>

              <button
                class="btn btn-primary w-100 mt-4"
                onclick="registerSubmit()">
                Create Account
              </button>

              <p class="text-center small mt-3 mb-0">
                Already have an account?
                <a href="#/login">Back to Login</a>
              </p>
            `
            : `
              <label class="form-label">
                Email / Username
              </label>

              <input
                id="loginEmail"
                class="form-control mb-3"
                placeholder="you@example.com"
              >

              <label class="form-label">
                Password
              </label>

              <input
                id="loginPassword"
                type="password"
                class="form-control mb-2"
                placeholder="*******"
              >

              <div class="d-flex justify-content-between align-items-center small mb-4">

                <label>
                  <input
                    type="checkbox"
                    class="form-check-input me-1"
                  >
                  Remember me
                </label>

                <a
                  href="#/forgot-password">
                  Forgot Password?
                </a>

              </div>

              <button
                class="btn btn-primary w-100"
                onclick="loginSubmit()">
                Sign In
              </button>

              <p class="text-center small mt-3 mb-0">
                Don't have an account?
                <a href="#/register">Register here</a>
              </p>
            `
        }

      </div>
    </div>
  `;
}

function login() {
  return authCard("login");
}

function register() {
  return authCard("register");
}

/*LOGIN / REGISTRATION LOGIC*/

async function loginSubmit() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) { toast('Enter your email and password.'); return; }
  try {
    await api('login', {email, password});
    await refreshData();
    toast(`Welcome back, ${currentUser.name}!`);
    go(portal === 'admin' ? '/admin' : portal === 'rider' ? '/rider' : '/dashboard');
    render();
  } catch (e) {
    if (e.message.toLowerCase().includes('not verified')) {
      sessionStorage.setItem('aquaflowVerifyEmail', email);
      go('/verify-email');
    }
    toast(e.message);
  }
}
async function registerSubmit() {
  const name = document.getElementById('regName').value.trim();
  const phone = document.getElementById('regContact').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const address = document.getElementById('regAddress').value.trim();
  const password = document.getElementById('regPass').value;
  const confirmPassword = document.getElementById('regConfirm').value;
  if (!name || !phone || !email || !address || password.length < 8 || password !== confirmPassword) {
    toast('Complete all fields. Password must have 8+ characters and match.'); return;
  }
  try {
    const response = await api('register', {name, phone, email, address, password});
    sessionStorage.setItem('aquaflowVerifyEmail', email.toLowerCase());
    sessionStorage.setItem('aquaflowVerifyDeliveryFailed', response.email_sent ? '0' : '1');
    go('/verify-email');
    toast(response.message);
  } catch (e) { toast(e.message); }
}


/* EMAIL VERIFICATION + FORGOT/RESET PASSWORD */
function authPage(title, intro, content) {
  return `<div class="auth-page"><div class="auth-card">
    <div class="text-center mb-4"><span class="brand-mark"><i class="bi bi-droplet-fill"></i></span>
      <h3 class="fw-bold mt-3 mb-1">${title}</h3><p class="small-muted">${intro}</p></div>
    ${content}<p class="text-center small mt-3 mb-0"><a href="#/login">Back to Login</a></p>
  </div></div>`;
}
function verifyEmailPage() {
  const email = sessionStorage.getItem('aquaflowVerifyEmail') || '';
  return authPage('Verify your email', 'Enter the 6-digit code sent to your inbox. Code expires in 10 minutes.', `
    <label class="form-label">Email Address</label>
    <input type="email" class="form-control mb-3" id="verifyEmail" value="${esc(email)}" autocomplete="email">
    <label class="form-label">Verification Code</label>
    <input type="text" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" class="form-control mb-3"
      id="verifyCode" placeholder="6-digit code" autocomplete="one-time-code">
    <button class="btn btn-primary w-100" onclick="submitVerification()">Verify Email</button>
    <button class="btn btn-outline-primary w-100 mt-2" onclick="resendCode()">Resend Code</button>
    ${sessionStorage.getItem('aquaflowVerifyDeliveryFailed')==='1'?'<div class="alert alert-warning small mt-3">Your account was created, but the verification email could not be sent. Check SMTP settings, then click Resend Code.</div>':''}
    ${mailMode==='log'?'<div class="alert alert-info small mt-3 mb-0">Local test mode: Emails are written to the PHP temporary mail log, not sent. See README for the file path.</div>':''}
  `);
}
async function submitVerification() {
  const email=document.getElementById('verifyEmail').value.trim().toLowerCase();
  const code=document.getElementById('verifyCode').value.trim();
  if (!/^\d{6}$/.test(code) || !email) {toast('Enter your email and the 6-digit code.');return;}
  try {const data=await api('verify_email',{email,code});sessionStorage.removeItem('aquaflowVerifyEmail');sessionStorage.removeItem('aquaflowVerifyDeliveryFailed');go('/login');toast(data.message);}
  catch(e){toast(e.message);}
}
async function resendCode() {
  const email=document.getElementById('verifyEmail').value.trim().toLowerCase();
  if(!email){toast('Enter the email you registered with.');return;}
  try {const data=await api('resend_verification',{email});sessionStorage.removeItem('aquaflowVerifyDeliveryFailed');render();toast(data.message);}
  catch(e){toast(e.message);}
}
function forgotPasswordPage() {
  return authPage('Forgot password?', 'We will send a one-time reset link to your verified email.', `
    <label class="form-label">Email Address</label>
    <input id="forgotEmail" type="email" class="form-control mb-3" autocomplete="email" placeholder="you@example.com">
    <button class="btn btn-primary w-100" onclick="sendResetLink()">Send Reset Link</button>
    ${mailMode==='log'?'<div class="alert alert-info small mt-3 mb-0">Local test mode: Find the reset link in the PHP temporary mail log. Actual email requires SMTP configuration.</div>':''}
  `);
}
async function sendResetLink() {
  const email=document.getElementById('forgotEmail').value.trim().toLowerCase();
  if(!email){toast('Enter your email first.');return;}
  try {const data=await api('password_forgot',{email});toast(data.message);}
  catch(e){toast(e.message);}
}
function resetPasswordPage() {
  const token=new URLSearchParams((location.hash.split('?')[1]||'')).get('token')||'';
  return authPage('Reset your password', 'Choose a new password (at least 8 characters).', `
    <input type="hidden" id="resetToken" value="${esc(token)}">
    <label class="form-label">New Password</label><input id="resetNew" class="form-control mb-3" type="password" autocomplete="new-password">
    <label class="form-label">Confirm New Password</label><input id="resetConfirm" class="form-control mb-3" type="password" autocomplete="new-password">
    <button class="btn btn-primary w-100" onclick="submitPasswordReset()">Update Password</button>
    ${!token?'<p class="text-danger small mt-3">The reset link has no token. Please request a new link.</p>':''}
  `);
}
async function submitPasswordReset() {
  const token=document.getElementById('resetToken').value;
  const password=document.getElementById('resetNew').value;
  if(password.length<8 || password!==document.getElementById('resetConfirm').value) {toast('Passwords must match and contain 8+ characters.');return;}
  try{const data=await api('password_reset',{token,password});go('/login');toast(data.message);}
  catch(e){toast(e.message);}
}

/* APPLICATION SHELL*/

function shell(menu, title, body) {
  const name = currentUser?.name || 'Guest';

  const initials =
    initialsFor(name) || "U";

  const portalLabel =
    portal === "admin"
      ? "Staff / Admin"
      : portal.charAt(0).toUpperCase() + portal.slice(1);

  return `
    <div class="app-shell">

      <aside class="sidebar">

        <div class="sidebar-brand d-flex align-items-center gap-2">

          <span class="brand-mark">
            <i class="bi bi-droplet-fill"></i>
          </span>

          <div>
            <b>AquaFlow</b>

            <div style="font-size:10px;color:#c9d8ff">
              ${portalLabel} Portal
            </div>
          </div>

        </div>

        <nav class="nav flex-column">

          ${menu.map((item) => `
            <a
              class="nav-link ${
                location.hash.slice(2) === item[0]
                  ? "active"
                  : ""
              }"
              href="#/${esc(item[0])}">

              <i class="bi bi-${item[2]} me-2"></i>

              ${item[1]}

              ${
                item[0] === "cart" && cartCount()
                  ? `
                    <span class="badge bg-light text-primary float-end">
                      ${cartCount()}
                    </span>
                  `
                  : ""
              }

            </a>
          `).join("")}

        </nav>

        <div class="bottom-user">

          <div class="d-flex align-items-center gap-2">

            <span class="profile-avatar">
              ${initials}
            </span>

            <div>
              <b style="font-size:12px">
                ${esc(name)}
              </b>

              <div style="font-size:10px;color:#c9d8ff">
                ${portalLabel}
              </div>
            </div>

          </div>

          <a
            class="text-white small d-block mt-3"
            href="#/login"
            onclick="event.preventDefault();logout()">

            <i class="bi bi-box-arrow-left me-2"></i>
            Logout

          </a>

        </div>

      </aside>

      <main class="main">

        <header class="topbar">

          <div class="d-flex align-items-center gap-2">

            <button class="btn btn-light mobile-menu">
              <i class="bi bi-list"></i>
            </button>

            <span class="small-muted">
              AquaFlow
              <span class="mx-1">›</span>
              <b>${title}</b>
            </span>

          </div>

          <div class="d-flex align-items-center gap-2">

            <span class="profile-avatar">
              ${initials}
            </span>

            <span class="small">
              ${esc(name)}
            </span>

          </div>

        </header>

        <div class="content">
          ${body}
        </div>

      </main>

    </div>
  `;
}

/*LOGOUT */

async function logout() {
  if (gpsOrderId) { await stopSharingGPS(false); }
  try { await api('logout', {}); }
  catch (e) { toast(e.message); return; }
  currentUser = null; loadedUserId = null; cart = []; portal = 'customer';
  products = []; orders = []; riders = []; customers = []; addresses = [];
  await bootApp();
  go('/login');
}

/*CUSTOMER DASHBOARD*/

function customerDashboard() {
  const customerOrderList = customerOrders().slice(0, 4);
  const active = orders.filter(o => !['Delivered','Cancelled'].includes(o.status));
  const latest = active[0] || orders[0] || null;

  return shell(
    customerMenu,
    "Dashboard",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>
          <h4 class="fw-bold mb-1">
            Welcome!
          </h4>

          <div class="small-muted">
            Here's what's happening with your water orders.
          </div>
        </div>

        <a
          class="btn btn-primary btn-sm"
          href="#/products">

          <i class="bi bi-plus-lg me-1"></i>
          Quick Order

        </a>

      </div>

      <div class="row g-3 mb-4">

        ${[
          [active.length, "Active Orders", "clock"],
          [orders.filter(o => o.status === 'Delivered').length, "Completed Orders", "check-circle"],
          [orders.filter(o => o.status === 'Pending').length, "Pending Orders", "clock-history"],
          [orders.length, "Total Orders", "box"]
        ].map((item) => `
          <div class="col-6 col-lg-3">

            <div class="card stat-card">

              <div class="stat-icon">
                <i class="bi bi-${item[2]}"></i>
              </div>

              <h3 class="mt-3 mb-0">
                ${esc(item[0])}
              </h3>

              <span class="small-muted">
                ${item[1]}
              </span>

            </div>

          </div>
        `).join("")}

      </div>

      <div class="row g-3">

        <div class="col-lg-8">

          <div class="card p-4">

            <div class="d-flex justify-content-between">
              <h6 class="fw-bold">
                Current Order
              </h6>

              <a href="#/tracking">
                View tracking
              </a>
            </div>

            ${latest ? `<div class="order-panel mt-3">

              <div class="d-flex justify-content-between align-items-center">

                <b>${latest.id}</b>

                ${statusBadge(latest.status)}

              </div>

              <div class="small-muted mt-1">
                ${esc(latest.schedule)}
              </div>

              <div class="mt-2">
                ${esc(latest.products)}
              </div>

              <strong class="d-block mt-2">
                ${money(latest.total)}
              </strong>

              <div class="text-end mt-2">

                <button
                  class="btn btn-primary btn-sm"
                  onclick="selectOrder('${latest.id}')">

                  Track Order

                </button>

              </div>

            </div>` : '<div class="text-muted py-3">No orders yet. Place your first order!</div>'}

            ${latest?.rider ? `<div class="mt-3 p-3 bg-light rounded-3"><small>Your Rider: <b>${esc(latest.rider)}</b></small></div>` : ''}

          </div>

        </div>

        <div class="col-lg-4">

          <div class="card p-4">

            <div class="d-flex justify-content-between">

              <h6 class="fw-bold">
                Available Products
              </h6>

              <a href="#/products">
                View all
              </a>

            </div>

            ${products.map((product) => `
              <div class="d-flex align-items-center gap-2 mt-3">

                ${productVisual(product, true)}

                <div class="flex-grow-1 small">

                  <b>${esc(product.name)}</b>

                  <div class="small-muted">
                    ${money(product.price)}/gal
                  </div>

                </div>

                <button
                  class="btn btn-outline-primary btn-sm"
                  onclick="addCart(${product.id})">

                  Add

                </button>

              </div>
            `).join("")}

          </div>

        </div>

      </div>

      <div class="card table-card mt-3">

        <div class="p-4 d-flex justify-content-between">

          <h6 class="fw-bold mb-0">
            Recent Orders
          </h6>

          <a href="#/orders">
            View all
          </a>

        </div>

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Products</th>
                <th>Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>

            <tbody>

              ${customerOrderList.map((order) => `
                <tr>

                  <td>
                    <b>${order.id}</b>
                  </td>

                  <td>${order.date}</td>

                  <td>${esc(order.products)}</td>

                  <td>${money(order.total)}</td>

                  <td>
                    ${statusBadge(order.status)}
                  </td>

                  <td>

                    <button
                      class="btn btn-sm btn-link"
                      onclick="selectOrder('${order.id}')">

                      View

                    </button>

                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}

/* CUSTOMER PRODUCT*/

function productsPage() {
  return shell(
    customerMenu,
    "Products",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>
          <h4 class="fw-bold mb-1">
            Water Products
          </h4>

          <div class="small-muted">
            Choose a product, quantity, and add it to your cart.
          </div>
        </div>

        <a
          class="btn btn-outline-primary btn-sm"
          href="#/cart">

          <i class="bi bi-cart3 me-1"></i>
          Cart (${cartCount()})

        </a>

      </div>

      <div class="row g-4">

        ${products.map((product) => `
          <div class="col-md-4">

            <div class="card h-100 overflow-hidden">

              ${productVisual(product)}

              <div class="p-4">

                <div class="d-flex justify-content-between">

                  <h5>${esc(product.name)}</h5>

                  <strong class="text-primary">
                    ${money(product.price)}
                  </strong>

                </div>

                <div class="small-muted">
                  per gallon • ${product.stock} available
                </div>

                <p class="text-muted mt-3">
                  ${esc(product.desc)}
                </p>

                <div class="d-flex align-items-center justify-content-between mt-4">

                  <span class="small-muted">
                    Quantity
                  </span>

                  <div class="quantity">

                    <button
                      onclick="changeProductQty(${product.id}, -1)">
                      −
                    </button>

                    <span id="pq-${product.id}">
                      ${selectedProductQty[product.id] || 1}
                    </span>

                    <button
                      onclick="changeProductQty(${product.id}, 1)">
                      +
                    </button>

                  </div>

                </div>

                <button
                  class="btn btn-primary w-100 mt-3"
                  onclick="addProductFromPage(${product.id})">

                  Add to Cart

                </button>

              </div>

            </div>

          </div>
        `).join("")}

      </div>
    `
  );
}


/*CART PAGE*/

function cartPage() {
  const subtotal = cart.reduce(
    (sum, item) => {
      const product = products.find(
        (p) => p.id === item.id
      );

      return sum + (product?.price || 0) * item.qty;
    },
    0
  );

  const fee = subtotal >= Number(storeSettings.free_delivery_min) || subtotal === 0 ? 0 : Number(storeSettings.delivery_fee);

  const total = subtotal + fee;

  return shell(
    customerMenu,
    "Cart",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>
          <h4 class="fw-bold mb-1">
            Shopping Cart
          </h4>

          <div class="small-muted">
            ${cartCount()} item(s) selected for delivery.
          </div>
        </div>

        <a
          href="#/products"
          class="btn btn-outline-primary btn-sm">

          Continue Shopping

        </a>

      </div>

      ${
        cart.length
          ? `
            <div class="row g-4">

              <div class="col-lg-8">

                <div class="card p-4">

                  ${cart.map((item) => {

                    const product = products.find(
                      (p) => p.id === item.id
                    );

                    return `
                      <div class="d-flex align-items-center gap-3 border-bottom py-3">

                        <div style="width:72px">
                          ${productVisual(product, true)}
                        </div>

                        <div class="flex-grow-1">

                          <b>${esc(product.name)}</b>

                          <div class="small-muted">
                            ${money(product.price)} per gallon
                          </div>

                        </div>

                        <div class="quantity">

                          <button
                            onclick="changeQty(${product.id}, -1)">
                            −
                          </button>

                          <span>${item.qty}</span>

                          <button
                            onclick="changeQty(${product.id}, 1)">
                            +
                          </button>

                        </div>

                        <strong
                          style="min-width:80px;text-align:right">

                          ${money(product.price * item.qty)}

                        </strong>

                        <button
                          class="btn btn-sm btn-light text-danger"
                          onclick="removeCart(${product.id})">

                          <i class="bi bi-trash"></i>

                        </button>

                      </div>
                    `;
                  }).join("")}

                </div>

              </div>

              <div class="col-lg-4">

                <div class="card p-4">

                  <h6 class="fw-bold">
                    Order Summary
                  </h6>

                  <div class="d-flex justify-content-between mt-3">
                    <span>Subtotal</span>
                    <span>${money(subtotal)}</span>
                  </div>

                  <div class="d-flex justify-content-between mt-2">
                    <span>Delivery Fee</span>
                    <span>${fee ? money(fee) : "Free"}</span>
                  </div>

                  <hr>

                  <div class="d-flex justify-content-between">

                    <b>Total</b>

                    <b class="text-primary fs-5">
                      ${money(total)}
                    </b>

                  </div>

                  <button
                    class="btn btn-primary w-100 mt-3"
                    onclick="go('/checkout')">

                    Proceed to Checkout

                  </button>

                  <div class="small-muted mt-2 text-center">
                    Free delivery for orders of ${money(storeSettings.free_delivery_min)} or more.
                  </div>

                </div>

              </div>

            </div>
          `
          : `
            <div class="card empty-state text-center">

              <i class="bi bi-cart3 text-primary display-5"></i>

              <h5 class="mt-3">
                Your cart is empty
              </h5>

              <p class="small-muted">
                Browse our water products and add items
                to start an order.
              </p>

              <a
                href="#/products"
                class="btn btn-primary btn-sm">

                Browse Products

              </a>

            </div>
          `
      }
    `
  );
}


/* CHECKOUT*/

function checkoutPage() {
  if (!cart.length) {
    go("/products");
    return "";
  }

  const subtotal = cart.reduce(
    (sum, item) => {
      const product = products.find(
        (p) => p.id === item.id
      );

      return sum + (product?.price || 0) * item.qty;
    },
    0
  );

  const fee = subtotal >= Number(storeSettings.free_delivery_min) ? 0 : Number(storeSettings.delivery_fee);

  return shell(
    customerMenu,
    "Checkout",
    `
      <div class="mb-4">

        <h4 class="fw-bold mb-1">
          Checkout
        </h4>

        <div class="small-muted">
          Review your information and schedule your delivery.
        </div>

      </div>

      <div class="row g-4">

        <div class="col-lg-7">

          <div class="card p-4 mb-3">

            <h6 class="fw-bold">
              Customer Information
            </h6>

            <div class="row g-3 mt-1">

              <div class="col-md-6">

                <label class="form-label">
                  Name
                </label>

                <input
                  id="coName"
                  class="form-control"
                  value="${esc(currentUser?.name || '')}">

              </div>

              <div class="col-md-6">

                <label class="form-label">
                  Contact Number
                </label>

                <input
                  id="coContact"
                  class="form-control"
                  value="${esc(currentUser?.phone || '')}">

              </div>

            </div>

          </div>

          <div class="card p-4 mb-3">

            <h6 class="fw-bold">
              Delivery Information
            </h6>

            <label class="form-label mt-2">
              Delivery Address
            </label>

            <input
              id="coAddress"
              class="form-control"
              value="${esc(currentUser?.default_address || '')}">

            <div class="row g-3 mt-1">

              <div class="col-md-6">

                <label class="form-label">
                  Preferred Delivery Date
                </label>

                <input
                  id="coDate"
                  type="date"
                  class="form-control"
                  min="${new Date().toLocaleDateString('sv-SE', {timeZone:'Asia/Manila'})}">

              </div>

              <div class="col-md-6">

                <label class="form-label">
                  Preferred Delivery Time
                </label>

                <select
                  id="coTime"
                  class="form-select">

                  <option>
                    9:00 AM - 11:00 AM
                  </option>

                  <option selected>
                    10:00 AM - 12:00 PM
                  </option>

                  <option>
                    1:00 PM - 3:00 PM
                  </option>

                  <option>
                    3:00 PM - 5:00 PM
                  </option>

                </select>

              </div>

            </div>

            <div class="map-box mt-3">

              <span class="position-absolute top-0 start-0 m-3 badge bg-white text-dark shadow-sm">
                Delivery location preview
              </span>

              <i class="bi bi-geo-alt-fill map-pin"></i>

            </div>

            <div class="small-muted mt-2">
              <i class="bi bi-info-circle me-1"></i>
              Prototype map only. No real-time GPS tracking is used.
            </div>

          </div>

        </div>

        <div class="col-lg-5">

          <div
            class="card p-4 sticky-lg-top"
            style="top:90px">

            <h6 class="fw-bold">
              Order Summary
            </h6>

            ${cart.map((item) => {

              const product = products.find(
                (p) => p.id === item.id
              );

              return `
                <div class="d-flex justify-content-between mt-3">

                  <span>
                    ${item.qty}x ${esc(product.name)}
                  </span>

                  <b>
                    ${money(product.price * item.qty)}
                  </b>

                </div>
              `;
            }).join("")}

            <hr>

            <div class="d-flex justify-content-between">
              <span>Delivery Fee</span>
              <span>
                ${fee ? money(fee) : "Free"}
              </span>
            </div>

            <div class="d-flex justify-content-between mt-2">

              <b>Total</b>

              <b class="text-primary fs-5">
                ${money(subtotal + fee)}
              </b>

            </div>

            <button
              class="btn btn-primary w-100 mt-4"
              onclick="placeOrder()">

              Place Order

            </button>

          </div>

        </div>

      </div>
    `
  );
}

/*PLACE ORDER*/

async function placeOrder() {
  const name = document.getElementById('coName').value.trim();
  const phone = document.getElementById('coContact').value.trim();
  const address = document.getElementById('coAddress').value.trim();
  const date = document.getElementById('coDate').value;
  const time = document.getElementById('coTime').value;
  if (!name || !phone || !address || !date || !cart.length) {
    toast('Complete the delivery information and add products.'); return;
  }
  try {
    const result = await api('order_create', {name, phone, address, date, time, cart});
    await refreshData();
    selectedOrderId = result.id;
    sessionStorage.setItem('aquaflowSelectedOrder', result.id);
    go('/confirmation'); render();
  } catch (e) { toast(e.message); }
}

/* CONFIRMATION PAGE*/

function confirmationPage() {
  const order = currentOrder();
  if (!order) return shell(customerMenu, 'Confirmation', '<div class="card p-4">No order available.</div>');

  return shell(
    customerMenu,
    "Order Confirmation",
    `
      <div
        class="card p-5 text-center mx-auto"
        style="max-width:720px">

        <div
          class="icon-box mx-auto"
          style="width:64px;height:64px;border-radius:50%;font-size:28px">

          <i class="bi bi-check-lg"></i>

        </div>

        <h3 class="fw-bold mt-4">
          Order Successfully Placed!
        </h3>

        <p class="text-muted">
          Your water delivery request has been recorded.
        </p>

        <div class="row text-start g-3 mt-4">

          <div class="col-md-6">
            <div class="small-muted">
              Order Number
            </div>
            <b>${order.id}</b>
          </div>

          <div class="col-md-6">
            <div class="small-muted">
              Total Amount
            </div>
            <b class="text-primary">
              ${money(order.total)}
            </b>
          </div>

          <div class="col-12">
            <div class="small-muted">
              Ordered Products
            </div>
            <b>${esc(order.products)}</b>
          </div>

          <div class="col-12">
            <div class="small-muted">
              Delivery Address
            </div>
            <span>${esc(order.address)}</span>
          </div>

          <div class="col-12">
            <div class="small-muted">
              Delivery Schedule
            </div>
            <span>${esc(order.schedule)}</span>
          </div>

        </div>

        <div class="d-flex justify-content-center flex-wrap gap-2 mt-4">

          <button
            class="btn btn-primary"
            onclick="selectOrder('${order.id}')">

            Track Order

          </button>

          <a
            class="btn btn-outline-primary"
            href="#/dashboard">

            Back to Dashboard

          </a>

        </div>

      </div>
    `
  );
}

/*CUSTOMER ORDERS*/

function ordersPage() {
  const statuses = [
    "All",
    "Pending",
    "Confirmed",
    "Preparing",
    "Out for Delivery",
    "Delivered",
    "Cancelled"
  ];

  return shell(
    customerMenu,
    "My Orders",
    `
      <div class="mb-3">

        <h4 class="fw-bold mb-1">
          My Orders
        </h4>

        <div class="small-muted">
          Review your order history and current delivery status.
        </div>

      </div>

      <div class="filter-tabs mb-3">

        ${statuses.map((status, index) => `
          <button
            class="btn btn-sm ${
              index === 0
                ? "btn-primary"
                : "btn-outline-primary"
            }"
            onclick="filterCustomerOrders('${status}', this)">

            ${status}

          </button>
        `).join("")}

      </div>

      <div id="customerOrderTable">
        ${customerOrderTable("All")}
      </div>
    `
  );
}

function customerOrderTable(filter) {
  const list = customerOrders().filter(
    (order) =>
      filter === "All" ||
      order.status === filter
  );

  return `
    <div class="card table-card">

      <div class="table-responsive">

        <table class="table mb-0">

          <thead>
            <tr>
              <th>Order Number</th>
              <th>Date</th>
              <th>Products</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>

          <tbody>

            ${
              list.length
                ? list.map((order) => `
                    <tr>

                      <td>
                        <b>${order.id}</b>
                      </td>

                      <td>${order.date}</td>

                      <td>${esc(order.products)}</td>

                      <td>${money(order.total)}</td>

                      <td>
                        ${statusBadge(order.status)}
                      </td>

                      <td>

                        <button
                          class="btn btn-sm btn-link"
                          onclick="selectOrder('${order.id}')">

                          View Details

                        </button>

                      </td>

                    </tr>
                  `).join("")
                : `
                    <tr>

                      <td
                        colspan="6"
                        class="text-center py-5 text-muted">

                        No orders found for this status.

                      </td>

                    </tr>
                  `
            }

          </tbody>

        </table>

      </div>

    </div>
  `;
}

function filterCustomerOrders(filter, button) {
  document
    .querySelectorAll(".filter-tabs .btn")
    .forEach((btn) => {
      btn.classList.remove("btn-primary");
      btn.classList.add("btn-outline-primary");
    });

  button.classList.add("btn-primary");
  button.classList.remove("btn-outline-primary");

  document.getElementById(
    "customerOrderTable"
  ).innerHTML = customerOrderTable(filter);
}


/*TRACKING*/

function trackingPage() {
  const order = currentOrder();
  if (!order) return shell(customerMenu,'Tracking','<div class="card p-4">No orders to track yet.</div>');

  const steps = [
    "Pending",
    "Confirmed",
    "Preparing",
    "Assigned",
    "Out for Delivery",
    "Delivered"
  ];

  const currentIndex =
    steps.indexOf(order.status);

  return shell(
    customerMenu,
    "Order Tracking",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>
          <h4 class="fw-bold mb-1">
            Order Tracking
          </h4>

          <div class="small-muted">
            Tracking for ${order.id}
          </div>
        </div>

        ${statusBadge(order.status)}

      </div>

      <div class="card p-4 mb-3">

        <div class="progress-track">

          ${steps.map((step, index) => `
            <div
              class="
                progress-step
                ${index <= currentIndex ? "done" : ""}
                ${index === currentIndex ? "current" : ""}
              ">

              <div class="progress-dot">
                ${
                  index < currentIndex
                    ? "✓"
                    : index === currentIndex
                      ? "•"
                      : index + 1
                }
              </div>

              <div class="progress-label">
                ${step}
              </div>

            </div>
          `).join("")}

        </div>

      </div>

      <div class="row g-4">

        <div class="col-lg-7">

          <div class="card p-4">

            <h6 class="fw-bold">
              Delivery Location
            </h6>

            <div id="liveGpsMap" class="gps-map mt-3"></div>
            <div id="gpsStatus" class="small-muted mt-2">Checking for rider location...</div>
            <div class="small-muted mt-2"><i class="bi bi-info-circle me-1"></i>
              Live location appears only while the assigned rider has opted in and the browser is actively sharing GPS.
              Destination: ${esc(order.address)}
            </div>

          </div>

        </div>

        <div class="col-lg-5">

          <div class="card p-4">

            <h6 class="fw-bold">
              Order Information
            </h6>

            <div class="small-muted mt-3">
              Products
            </div>

            <b>${esc(order.products)}</b>

            <div class="small-muted mt-3">
              Delivery Schedule
            </div>

            <span>${esc(order.schedule)}</span>

            <div class="small-muted mt-3">
              Delivery Address
            </div>

            <span>${esc(order.address)}</span>

            <div class="small-muted mt-3">
              Rider
            </div>

            <span>
              ${order.rider || "Not yet assigned"}
            </span>

          </div>

        </div>

      </div>
    `
  );
}


/*ADDRESSES*/

function addressesPage() {
  return shell(customerMenu, 'Addresses', `
    <div class="d-flex justify-content-between mb-4"><div><h4>Delivery Addresses</h4><p class="small-muted">Your saved delivery locations</p></div>
    <button class="btn btn-primary btn-sm" onclick="addressModal()"><i class="bi bi-plus-lg"></i> Add Address</button></div>
    <div class="row g-3">${addresses.length ? addresses.map(a => `
      <div class="col-md-6"><div class="card p-4 h-100">
      <div class="d-flex justify-content-between align-items-center"><h6><i class="bi bi-house text-primary me-2"></i>${esc(a.label)}</h6>
      ${Number(a.is_default) ? '<span class="badge badge-soft">Default</span>' : ''}</div>
      <p class="text-muted mt-2">${esc(a.address)}</p><div class="d-flex gap-2 flex-wrap mt-auto">
      <button class="btn btn-outline-primary btn-sm" onclick="addressModal(${a.id})">Edit</button>
      ${!Number(a.is_default) ? `<button class="btn btn-light btn-sm" onclick="setDefaultAddress(${a.id})">Set Default</button>
      <button class="btn btn-outline-danger btn-sm" onclick="deleteAddress(${a.id})">Delete</button>` : ''}
      </div></div></div>`).join('') : '<div class="col-12"><p class="text-muted">No saved addresses yet.</p></div>'}</div>`);
}
function addressModal(id = null) {
  const a = addresses.find(x => Number(x.id) === Number(id));
  showModal(`<div class="modal-header"><h5 class="modal-title">${a ? 'Edit' : 'Add'} Address</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body"><label class="form-label">Address Label</label><input id="addrLabel" class="form-control mb-3" value="${esc(a?.label || '')}" placeholder="Home / Office">
    <label class="form-label">Complete Address</label><textarea id="addrText" class="form-control" rows="4" placeholder="House, Street, Barangay, City">${esc(a?.address || '')}</textarea></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="saveAddress(${a ? a.id : 'null'})">Save Address</button></div>`);
}
async function saveAddress(id) {
  const label = document.getElementById('addrLabel').value.trim();
  const address = document.getElementById('addrText').value.trim();
  const result = await runAction('address_save',{id,label,address}, 'Address saved.');
  if (result) closeModal();
}
async function setDefaultAddress(id) { await runAction('address_default',{id},'Default address updated.'); }
async function deleteAddress(id) {
  if (confirm('Delete this address?')) await runAction('address_delete',{id},'Address deleted.');
}

/*CUSTOMER PROFILE*/

function profilePage() {
  return shell(customerMenu,'Profile',profileForm('My Profile'));
}
function profileForm(title = 'My Profile') {
  return `<div class="mb-4"><h4 class="fw-bold">${title}</h4><p class="small-muted">Update your account details.</p></div>
    <div class="card p-4" style="max-width:760px"><div class="d-flex align-items-center gap-3 mb-4"><span class="profile-avatar avatar-lg">${initialsFor(currentUser?.name)}</span>
    <div><h5 class="mb-1">${esc(currentUser?.name)}</h5><small class="text-muted">${esc(currentUser?.role)}</small></div></div>
    <div class="row g-3"><div class="col-md-6"><label class="form-label">Full Name</label><input id="profileName" class="form-control" value="${esc(currentUser?.name)}"></div>
    <div class="col-md-6"><label class="form-label">Email (cannot be changed here)</label><input class="form-control" value="${esc(currentUser?.email)}" readonly></div>
    <div class="col-md-6"><label class="form-label">Contact Number</label><input id="profilePhone" class="form-control" value="${esc(currentUser?.phone)}"></div>
    <div class="col-md-6"><label class="form-label">Default Address</label><input id="profileAddress" class="form-control" value="${esc(currentUser?.default_address)}"></div></div>
    <div class="d-flex gap-2 mt-4"><button class="btn btn-primary" onclick="saveProfile()">Save Changes</button><button class="btn btn-outline-primary" onclick="passwordModal()">Change Password</button></div></div>`;
}
async function saveProfile() {
  await runAction('profile_save', {name:document.getElementById('profileName').value,
    phone:document.getElementById('profilePhone').value, address:document.getElementById('profileAddress').value}, 'Profile updated.');
}
function passwordModal() {
  showModal(`<div class="modal-header"><h5 class="modal-title">Change Password</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body"><label>Current password</label><input id="oldPass" type="password" class="form-control mb-3">
    <label>New password</label><input id="newPass" type="password" class="form-control mb-3">
    <label>Confirm new password</label><input id="confirmPass" type="password" class="form-control"></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="changePassword()">Update Password</button></div>`);
}
async function changePassword() {
  const current=document.getElementById('oldPass').value;
  const new_password=document.getElementById('newPass').value;
  if (new_password.length < 8 || new_password !== document.getElementById('confirmPass').value) {toast('Passwords must match and have at least 8 characters.');return;}
  const result=await runAction('password_change',{current,new_password},'Password changed.');
  if (result) closeModal();
}

/* ADMIN DASHBOARD*/

function adminDashboard() {
  return shell(
    adminMenu,
    "Dashboard",
    `
      <div class="mb-4">

        <h4 class="fw-bold mb-1">
          Admin Dashboard
        </h4>

        <div class="small-muted">
          Overview of AquaFlow operations.
        </div>

      </div>

      <div class="row g-3">

        ${[
          [orders.length, "Total Orders", "receipt"],
          [orders.filter(o=>o.status==='Pending').length, "Pending Orders", "clock"],
          [orders.filter(o=>o.status==='Out for Delivery').length, "Out for Delivery", "truck"],
          [orders.filter(o=>o.status==='Delivered').length, "Completed Orders", "check-circle"],
          [money(orders.filter(o=>o.status==='Delivered').reduce((n,o)=>n+Number(o.total),0)), "Completed Sales", "cash-stack"],
          [riders.filter(r=>r.availability==='Available').length, "Available Riders", "bicycle"]
        ].map((item) => `
          <div class="col-6 col-lg-2">

            <div class="card stat-card">

              <div class="stat-icon">
                <i class="bi bi-${item[2]}"></i>
              </div>

              <h5 class="mt-3 mb-1">
                ${esc(item[0])}
              </h5>

              <span class="small-muted">
                ${item[1]}
              </span>

            </div>

          </div>
        `).join("")}

      </div>

      <div class="row g-3 mt-1">

        <div class="col-lg-7">

          <div class="card p-4">

            <div class="d-flex justify-content-between">

              <h6 class="fw-bold">
                Order Status
              </h6>

              <span class="small-muted">
                Last 7 days
              </span>

            </div>

            <div class="chart-box mt-3">

              ${lastSevenDays().map((d) => `
                <div class="chart-col">

                  <div
                    class="bar"
                    style="height:${d.height}%">
                  </div>

                  <small class="text-muted">
                    ${d.label}
                  </small>

                </div>
              `).join("")}

            </div>

          </div>

        </div>

        <div class="col-lg-5">

          <div class="card p-4">

            <h6 class="fw-bold">
              Available Products / Inventory
            </h6>

            ${products.filter(p=>Number(p.active)).slice(0,5).map((p,index) => [p.name, `${p.stock} in stock`]).map((item, index) => `
              <div class="d-flex justify-content-between py-3 border-bottom">

                <span>
                  <span class="badge badge-soft me-2">
                    ${index + 1}
                  </span>

                  ${esc(item[0])}
                </span>

                <b>${item[1]}</b>

              </div>
            `).join("")}

          </div>

        </div>

      </div>

      <div class="card table-card mt-3">

        <div class="p-4">
          <h6 class="fw-bold mb-0">
            Recent Orders
          </h6>
        </div>

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Total</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>

              ${orders.slice(0, 5).map((order) => `
                <tr>

                  <td>${order.id}</td>

                  <td>${esc(order.customer)}</td>

                  <td>${esc(order.products)}</td>

                  <td>${money(order.total)}</td>

                  <td>
                    ${statusBadge(order.status)}
                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}

/*ADMIN ORDERS*/

function adminOrders() {
  return shell(
    adminMenu,
    "Orders",
    `
      <div class="d-flex justify-content-between align-items-center mb-3">

        <div>

          <h4 class="fw-bold mb-1">
            Order Management
          </h4>

          <div class="small-muted">
            Review, confirm, reject, assign, and update orders.
          </div>

        </div>

        <button
          class="btn btn-primary btn-sm"
          onclick="newOrderModal()">

          + New Order

        </button>

      </div>

      <div class="card table-card">

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Schedule</th>
                <th>Total</th>
                <th>Status</th>
                <th>Rider</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody>

              ${orders.map((order) => `
                <tr>

                  <td>
                    <b>${order.id}</b>
                  </td>

                  <td>${esc(order.customer)}</td>

                  <td>${esc(order.products)}</td>

                  <td>${order.qty}</td>

                  <td>${esc(order.schedule)}</td>

                  <td>${money(order.total)}</td>

                  <td>
                    ${statusBadge(order.status)}
                  </td>

                  <td>
                    ${order.rider || "Unassigned"}
                  </td>

                  <td>

                    <div class="dropdown">

                      <button
                        class="btn btn-sm btn-outline-primary dropdown-toggle"
                        data-bs-toggle="dropdown">

                        Actions

                      </button>

                      <ul class="dropdown-menu">
                        <li><button class="dropdown-item" onclick="adminOrderDetails('${order.id}')">View Details</button></li>
                        <li>${adminStatusButtons(order, true)}</li>
                      </ul>

                    </div>

                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}


/* ADMIN ORDER DETAILS*/

function adminOrderDetails(id) {
  selectedOrderId = id;

  sessionStorage.setItem('aquaflowSelectedOrder',id);

  go("/admin-order-details");
}

function adminOrderDetailsPage() {
  if (!orders.length) return shell(adminMenu,'Order Details','<div class="card p-4">No orders yet.</div>');
  const order =
    orders.find(
      (item) => item.id === selectedOrderId
    ) || orders[0];

  return shell(
    adminMenu,
    "Order Details",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>

          <h4 class="fw-bold mb-1">
            Order Details
          </h4>

          <div class="small-muted">
            ${order.id}
          </div>

        </div>

        ${statusBadge(order.status)}

      </div>

      <div class="row g-4">

        <div class="col-lg-7">

          <div class="card p-4">

            <h6 class="fw-bold">
              Customer Information
            </h6>

            <div class="row mt-2">

              <div class="col-md-6">

                <span class="small-muted">
                  Customer
                </span>

                <p>
                  <b>${esc(order.customer)}</b>
                </p>

              </div>

              <div class="col-md-6">

                <span class="small-muted">
                  Contact
                </span>

                <p>
                  0917-123-4567
                </p>

              </div>

            </div>

            <hr>

            <h6 class="fw-bold">
              Order Information
            </h6>

            <p class="mt-3 mb-1">
              ${esc(order.products)}
            </p>

            <p class="small-muted">
              Total:
              <b class="text-primary">
                ${money(order.total)}
              </b>
            </p>

            <hr>

            <h6 class="fw-bold">
              Delivery Information
            </h6>

            <p class="small-muted mb-1">
              Address
            </p>

            <p>
              ${esc(order.address)}
            </p>

            <p class="small-muted mb-1">
              Schedule
            </p>

            <p>
              ${esc(order.schedule)}
            </p>

            <p class="small-muted mb-1">
              Assigned Rider
            </p>

            <p>
              ${order.rider || "Not assigned"}
            </p>

          </div>

        </div>

        <div class="col-lg-5">

          <div class="card p-4">

            <h6 class="fw-bold">Order Actions</h6>
            ${adminStatusButtons(order)}
          </div>

          <div class="card p-4 mt-3">

            <h6 class="fw-bold">
              Delivery Location
            </h6>

            <div class="map-box mt-3">
              <i class="bi bi-geo-alt-fill map-pin"></i>
            </div>

          </div>

        </div>

      </div>
    `
  );
}


function adminStatusButtons(order, compact = false) {
  const next = {
    Pending:['Confirmed','Cancelled'], Confirmed:['Preparing','Cancelled'],
    Preparing:['Cancelled'], Assigned:['Out for Delivery','Cancelled'],
    'Out for Delivery':['Delivered','Cancelled']
  }[order.status] || [];
  return `${next.map(status=>`<button class="${compact?'dropdown-item':'btn btn-outline-primary w-100 mt-2'} ${status==='Cancelled'?'text-danger':''}"
    onclick="updateOrderStatus('${order.id}','${status}')">${status==='Cancelled'?'Cancel Order':'Mark '+status}</button>`).join('')}
    ${['Confirmed','Preparing','Assigned'].includes(order.status) ?
      `<button class="${compact?'dropdown-item':'btn btn-primary w-100 mt-2'}" onclick="assignRider('${order.id}')">Assign Rider</button>` : ''}`;
}

/*ADMIN ORDER ACTIONS*/

async function updateOrderStatus(id, status) {
  if (status === 'Cancelled' && !confirm(`Cancel order ${id}?`)) return;
  await runAction('order_status',{id:id.replace('#',''), status},`${id} updated to ${status}.`);
}
function assignRider(id) {
  const order=orders.find(o=>o.id===id);
  const possible=riders.filter(r=>r.availability !== 'Offline');
  showModal(`<div class="modal-header"><h5 class="modal-title">Assign Rider to ${id}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
   <div class="modal-body"><label class="form-label">Rider</label><select id="riderSelect" class="form-select">
   ${possible.map(r=>`<option value="${r.id}" ${Number(order?.rider_id)===Number(r.id)?'selected':''}>${esc(r.name)} (${esc(r.availability)})</option>`).join('')}
   </select></div><div class="modal-footer"><button class="btn btn-primary" onclick="saveRiderAssignment('${id}')" ${possible.length?'':'disabled'}>Assign Rider</button></div>`);
}
async function saveRiderAssignment(id) {
  const rider_id=Number(document.getElementById('riderSelect')?.value);
  const result=await runAction('order_assign',{id:id.replace('#',''),rider_id},'Rider assigned.');
  if(result)closeModal();
}
function newOrderModal() {
  const date = new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Manila'});
  showModal(`<div class="modal-header"><h5 class="modal-title">Create New Order</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body"><label>Customer</label><select id="adminNewCustomer" class="form-select mb-3">${customers.map(u=>`<option value="${u.id}">${esc(u.name)} (${esc(u.email)})</option>`).join('')}</select>
    <label>Product</label><select id="adminNewProduct" class="form-select mb-3">${products.filter(p=>Number(p.active)).map(p=>`<option value="${p.id}">${esc(p.name)} - ${money(p.price)}</option>`).join('')}</select>
    <label>Quantity</label><input id="adminNewQty" type="number" class="form-control mb-3" value="1" min="1">
    <label>Delivery Date</label><input id="adminNewDate" type="date" class="form-control mb-3" min="${date}" value="${date}">
    <label>Delivery Time</label><select id="adminNewTime" class="form-select">${['9:00 AM - 11:00 AM','10:00 AM - 12:00 PM','1:00 PM - 3:00 PM','3:00 PM - 5:00 PM'].map(t=>`<option>${t}</option>`).join('')}</select>
    <small class="text-muted">Customer must have a contact number and default address.</small></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="submitAdminOrder()">Create Order</button></div>`);
}
async function submitAdminOrder() {
  const data={customer_id:Number(document.getElementById('adminNewCustomer').value),
    cart:[{id:Number(document.getElementById('adminNewProduct').value),qty:Number(document.getElementById('adminNewQty').value)}],
    date:document.getElementById('adminNewDate').value,time:document.getElementById('adminNewTime').value};
  const result=await runAction('order_admin_create',data,'Order created.');
  if(result)closeModal();
}

/*ADMIN PRODUCTS*/

function adminProducts() {
  return shell(
    adminMenu,
    "Products",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>

          <h4 class="fw-bold mb-1">
            Product Management
          </h4>

          <div class="small-muted">
            Manage prices, stock, and product status.
          </div>

        </div>

        <button
          class="btn btn-primary btn-sm"
          onclick="newProductModal()">

          + Add Product

        </button>

      </div>

      <div class="card table-card">

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>

              <tr>
                <th>Product Name</th>
                <th>Price</th>
                <th>Available Quantity</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>

            </thead>

            <tbody>

              ${products.filter(product=>Number(product.active)).map((product) => `
                <tr>

                  <td>

                    <div class="d-flex align-items-center gap-2">

                      <div style="width:48px">
                        ${productVisual(product, true)}
                      </div>

                      <b>${esc(product.name)}</b>

                    </div>

                  </td>

                  <td>
                    ${money(product.price)}
                  </td>

                  <td>
                    ${product.stock}
                  </td>

                  <td>

                    <span class="badge bg-success-subtle text-success">
                      ${
                        product.stock > 0
                          ? "Available"
                          : "Out of Stock"
                      }
                    </span>

                  </td>

                  <td>

                    <button
                      class="btn btn-sm btn-outline-primary me-1"
                      onclick="editProductModal(${product.id})">

                      Edit

                    </button>

                    <button
                      class="btn btn-sm btn-outline-danger"
                      onclick="deleteProduct(${product.id})">

                      Delete

                    </button>

                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}

function newProductModal() { productModal(); }
function editProductModal(id) { productModal(id); }
function productModal(id = null) {
  const product=products.find(p=>Number(p.id)===Number(id));
  showModal(`<div class="modal-header"><h5 class="modal-title">${product?'Edit':'Add'} Product</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
    <div class="modal-body"><label>Name</label><input id="editProductName" class="form-control mb-3" value="${esc(product?.name||'')}">
    <label>Price (PHP)</label><input id="editProductPrice" type="number" step="0.01" min="0.01" class="form-control mb-3" value="${product?.price||''}">
    <label>Stock</label><input id="editProductStock" type="number" min="0" class="form-control mb-3" value="${product?.stock??0}">
    <label>Description</label><textarea id="editProductDesc" class="form-control">${esc(product?.desc||'')}</textarea></div>
    <div class="modal-footer"><button class="btn btn-primary" onclick="saveProduct(${product?product.id:'null'})">Save Product</button></div>`);
}
async function saveProduct(id) {
  const data={id,name:document.getElementById('editProductName').value,price:document.getElementById('editProductPrice').value,
    stock:document.getElementById('editProductStock').value,desc:document.getElementById('editProductDesc').value};
  const result=await runAction('product_save',data,'Product saved.');
  if(result)closeModal();
}
async function deleteProduct(id) {if(confirm('Remove this product from the catalog?'))await runAction('product_delete',{id},'Product removed.');}

/*ADMIN CUSTOMERS*/

function adminCustomers() {
  return shell(adminMenu, 'Customers', `<h4 class="fw-bold mb-3">Customer Management</h4>
    <div class="card table-card"><div class="table-responsive"><table class="table mb-0">
    <thead><tr><th>Name</th><th>Contact</th><th>Email</th><th>Orders</th><th>Default Address</th></tr></thead><tbody>
    ${customers.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td>
    <td>${c.order_count}</td><td>${esc(c.default_address)}</td></tr>`).join('')||'<tr><td colspan="5">No customers yet.</td></tr>'}</tbody></table></div></div>`);
}

/*ADMIN RIDERS */

function adminRiders() {
  return shell(
    adminMenu,
    "Riders",
    `
      <div class="mb-4">

        <h4 class="fw-bold mb-1">
          Rider Management
        </h4>

        <div class="small-muted">
          Monitor rider availability and assigned deliveries.
        </div>

      </div>

      <button class="btn btn-primary btn-sm mb-3" onclick="newRiderModal()">+ Add Rider</button>
      <div class="card table-card">

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>
              <tr>
                <th>Rider Name</th>
                <th>Contact</th>
                <th>Availability</th>
                <th>Assigned Deliveries</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>

              ${riders.map((rider) => `
                <tr>

                  <td>
                    <b>${esc(rider.name)}</b>
                  </td>

                  <td>${esc(rider.phone)}</td>

                  <td>${esc(rider.availability)}</td>

                  <td>${rider.assigned}</td>

                  <td>

                    <span
                      class="badge ${
                        rider.status === "Available"
                          ? "bg-success-subtle text-success"
                          : rider.status === "Busy"
                            ? "bg-warning-subtle text-warning"
                            : "bg-secondary-subtle text-secondary"
                      }">

                      ${esc(rider.status)}

                    </span>

                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}


function newRiderModal() {
  showModal(`<div class="modal-header"><h5>Add Rider</h5><button class="btn-close" data-bs-dismiss="modal"></button></div>
   <div class="modal-body"><label>Name</label><input id="nrName" class="form-control mb-3"><label>Email</label><input type="email" id="nrEmail" class="form-control mb-3">
   <label>Contact</label><input id="nrPhone" class="form-control mb-3"><label>Temporary Password (8+ characters)</label><input type="password" id="nrPass" class="form-control"></div>
   <div class="modal-footer"><button class="btn btn-primary" onclick="createRider()">Create Rider</button></div>`);
}
async function createRider() {
  const data={name:document.getElementById('nrName').value,email:document.getElementById('nrEmail').value,
    phone:document.getElementById('nrPhone').value,password:document.getElementById('nrPass').value};
  const result=await runAction('rider_create',data,'Rider account created.');
  if(result)closeModal();
}

/*ADMIN DELIVERY*/

function adminDelivery() {
  const activeOrders = orders.filter(o=>['Assigned','Out for Delivery'].includes(o.status));
  const today = todayPH();

  return shell(
    adminMenu,
    "Deliveries",
    `
      <div class="mb-4">

        <h4 class="fw-bold mb-1">
          Delivery Management
        </h4>

        <div class="small-muted">
          Monitor scheduled deliveries and rider assignments.
        </div>

      </div>

      <div class="row g-4">

        <div class="col-lg-7">

          <div class="card p-4">

            <h6 class="fw-bold">
              Live Rider Locations
            </h6>

            <div id="adminGpsMap" class="gps-map mt-3"></div>
            <div id="gpsStatus" class="small-muted mt-2">Loading active rider GPS locations...</div>
            <p class="small-muted mt-2 mb-0">Only riders with GPS sharing enabled appear here. Stale updates are labeled.</p>

          </div>

        </div>

        <div class="col-lg-5">

          <div class="card p-4">

            <h6 class="fw-bold">
              Today's Summary
            </h6>

            <div class="row g-3 mt-1">

              <div class="col-6">
                <div class="kpi-label">
                  Scheduled
                </div>
                <h4>${orders.filter(o=>o.delivery_date===today).length}</h4>
              </div>

              <div class="col-6">
                <div class="kpi-label">
                  In Progress
                </div>
                <h4>${activeOrders.length}</h4>
              </div>

              <div class="col-6">
                <div class="kpi-label">
                  Completed
                </div>
                <h4>${orders.filter(o=>o.delivery_date===today&&o.status==='Delivered').length}</h4>
              </div>

              <div class="col-6">
                <div class="kpi-label">
                  Unassigned
                </div>
                <h4>${orders.filter(o=>o.delivery_date===today&&!o.rider_id&&!['Cancelled','Delivered'].includes(o.status)).length}</h4>
              </div>

            </div>

          </div>

        </div>

      </div>

      <div class="card table-card mt-3">

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>
              <tr>
                <th>Delivery ID</th>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Rider</th>
                <th>Address</th>
                <th>Schedule</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>

              ${activeOrders.map((order) => `
                <tr>

                  <td>
                    D-${order.id.replace("#", "")}
                  </td>

                  <td>${order.id}</td>

                  <td>${esc(order.customer)}</td>

                  <td>
                    ${order.rider || "Unassigned"}
                  </td>

                  <td>${esc(order.address)}</td>

                  <td>${esc(order.schedule)}</td>

                  <td>
                    ${statusBadge(order.status)}
                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}


/*ADMIN REPORTS*/

function adminReports() {
  const now = new Date();
  const today = todayPH();
  const inWeek = o => (now - new Date(o.date+'T00:00:00')) <= 7*86400000;
  const inMonth = o => o.date?.slice(0,7) === today.slice(0,7);
  const delivered=orders.filter(o=>o.status==='Delivered');
  const top=products.filter(p=>Number(p.active));
  return shell(adminMenu,'Reports',`<h4 class="fw-bold mb-3">Reports</h4>
    <div class="row g-3">${[
      [orders.filter(o=>o.date===today).length,'Orders Today'],
      [orders.filter(inWeek).length,'Orders in Last 7 Days'],
      [orders.filter(inMonth).length,'Orders This Month'],
      [delivered.length,'Completed Deliveries'],
      [orders.filter(o=>o.status==='Cancelled').length,'Cancelled Orders'],
      [money(delivered.reduce((sum,o)=>sum+Number(o.total),0)),'Completed Sales']
    ].map(v=>`<div class="col-6 col-lg-2"><div class="card stat-card"><h5>${v[0]}</h5><span class="small-muted">${v[1]}</span></div></div>`).join('')}</div>
    <div class="card p-4 mt-4"><h6>Orders Placed in the Last 7 Days</h6>
      <div class="chart-box mt-3">${lastSevenDays().map(d=>`<div class="chart-col" style="flex:1;text-align:center"><div class="bar" style="height:${d.height}%" title="${d.count} orders"></div><small>${d.label}: ${d.count}</small></div>`).join('')}</div>
    </div><div class="card table-card mt-3"><div class="p-3"><b>Order Status Breakdown</b></div><div class="table-responsive"><table class="table mb-0">
    <thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>${['Pending','Confirmed','Preparing','Assigned','Out for Delivery','Delivered','Cancelled'].map(t=>`<tr><td>${statusBadge(t)}</td><td>${orders.filter(o=>o.status===t).length}</td></tr>`).join('')}</tbody></table></div></div>`);
}
function todayPH() {return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Manila'});}
function lastSevenDays() {
  const list=[];
  for(let i=6;i>=0;i--) {
    const d=new Date();d.setDate(d.getDate()-i);
    const date=d.toLocaleDateString('sv-SE',{timeZone:'Asia/Manila'});
    list.push({date,label:d.toLocaleDateString('en-US',{weekday:'short'}),count:orders.filter(o=>o.date===date).length});
  }
  const max=Math.max(1,...list.map(d=>d.count));
  return list.map(d=>({...d,height:Math.max(4,Math.round(100*d.count/max))}));
}

/*ADMIN SETTINGS */

function adminSettings() {
  return shell(adminMenu,'Settings',`<h4 class="fw-bold mb-4">Store Settings</h4>
    <div class="card p-4" style="max-width:800px"><div class="row g-3">
    <div class="col-md-6"><label>Business Name</label><input id="stName" class="form-control" value="${esc(storeSettings.business_name)}"></div>
    <div class="col-md-6"><label>Business Address</label><input id="stAddress" class="form-control" value="${esc(storeSettings.business_address)}"></div>
    <div class="col-md-6"><label>Delivery Fee (PHP)</label><input id="stFee" type="number" min="0" step="0.01" class="form-control" value="${storeSettings.delivery_fee}"></div>
    <div class="col-md-6"><label>Free Delivery Minimum (PHP)</label><input id="stMin" type="number" min="0" step="0.01" class="form-control" value="${storeSettings.free_delivery_min}"></div>
    <div class="col-12"><label>Operating Hours</label><input id="stHours" class="form-control" value="${esc(storeSettings.business_hours)}"></div></div>
    <div class="form-check form-switch mt-3"><input id="stNotify" class="form-check-input" type="checkbox" ${Number(storeSettings.notifications_enabled)?'checked':''}>
      <label class="form-check-label" for="stNotify">Enable order notifications (configuration only)</label></div>
    <button class="btn btn-primary mt-4" onclick="saveSettings()">Save Settings</button></div>`);
}
async function saveSettings() {
  await runAction('settings_save',{business_name:document.getElementById('stName').value,
    business_address:document.getElementById('stAddress').value,delivery_fee:document.getElementById('stFee').value,
    free_delivery_min:document.getElementById('stMin').value,business_hours:document.getElementById('stHours').value,
    notifications_enabled:document.getElementById('stNotify').checked},'Settings updated.');
}

/* RIDER DASHBOARD*/

function riderDashboard() {
  const ongoing=orders.filter(o=>o.status!=='Delivered'&&o.status!=='Cancelled');
  const current=ongoing[0];
  const summary=[
    [orders.filter(o=>o.delivery_date===todayPH()).length,"Today's Deliveries",'clipboard-check'],
    [orders.filter(o=>o.status==='Delivered').length,'Completed Deliveries','check-circle'],
    [ongoing.length,'Active Deliveries','truck'],
    [currentUser?.availability||'Available','Rider Availability','person-check']
  ];
  return shell(riderMenu,'Dashboard', `<h4 class="fw-bold mb-3">Rider Dashboard</h4>
    <p class="small-muted">Welcome back, ${esc(currentUser?.name)}.</p>
    <div class="row g-3">${summary.map(v=>`<div class="col-6 col-lg-3"><div class="card stat-card"><div class="stat-icon"><i class="bi bi-${v[2]}"></i></div><h5 class="mt-3">${v[0]}</h5><span class="small-muted">${v[1]}</span></div></div>`).join('')}</div>
    <div class="card p-4 mt-4"><h6>Your Availability</h6>
    <select id="riderAvailability" class="form-select" style="max-width:260px" onchange="saveAvailability(this.value)">
      ${['Available','Busy','Offline'].map(v=>`<option ${currentUser?.availability===v?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="card p-4 mt-3"><h6>Current Delivery</h6>${current?`<div class="order-panel mt-3"><b>${current.id} • ${esc(current.customer)}</b>
    <div class="small-muted mt-2">${esc(current.address)}</div><div class="mt-2">${statusBadge(current.status)}</div>
    <div class="mt-3"><button class="btn btn-outline-primary btn-sm" onclick="riderOrderDetails('${current.id}')">View Details</button></div></div>`:'<p class="text-muted mb-0">No active deliveries assigned.</p>'}</div>`);
}
async function saveAvailability(availability) {await runAction('rider_availability',{availability},'Availability updated.');}

/*RIDER DELIVERIES */

function deliveriesPage() {
  const assignedOrders = orders.filter(
    (order) =>
      !['Delivered','Cancelled'].includes(order.status)
  );

  return shell(
    riderMenu,
    "Assigned Deliveries",
    `
      <div class="mb-4">

        <h4 class="fw-bold mb-1">
          Assigned Deliveries
        </h4>

        <div class="small-muted">
          Review customer, address, schedule, and order details.
        </div>

      </div>

      <div class="row g-3">

        ${assignedOrders.map((order) => `
          <div class="col-lg-6">

            <div class="card p-4 h-100">

              <div class="d-flex justify-content-between">

                <b>${order.id}</b>

                ${statusBadge(order.status)}

              </div>

              <h6 class="mt-3 mb-1">
                ${esc(order.customer)}
              </h6>

              <div class="small-muted">
                <i class="bi bi-telephone me-1"></i>
                0917-123-4567
              </div>

              <p class="small-muted mt-3 mb-1">
                Address
              </p>

              <p>${esc(order.address)}</p>

              <p class="small-muted mb-1">
                Products
              </p>

              <p>${esc(order.products)}</p>

              <p class="small-muted mb-1">
                Schedule
              </p>

              <p>${esc(order.schedule)}</p>

              <button
                class="btn btn-outline-primary btn-sm"
                onclick="riderOrderDetails('${order.id}')">

                View Details

              </button>

            </div>

          </div>
        `).join("")}

      </div>
    `
  );
}


/*RIDER ORDER DETAILS*/

function riderOrderDetails(id) {
  selectedOrderId = id;

  sessionStorage.setItem('aquaflowSelectedOrder',id);

  go("/delivery-details");
}

function deliveryDetailsPage() {
  if (!orders.length) return shell(riderMenu,'Delivery Details','<div class="card p-4">No assigned deliveries yet.</div>');
  const order =
    orders.find(
      (item) => item.id === selectedOrderId
    ) ||
    orders[0];

  return shell(
    riderMenu,
    "Delivery Details",
    `
      <div class="d-flex justify-content-between align-items-center mb-4">

        <div>

          <h4 class="fw-bold mb-1">
            Delivery Details
          </h4>

          <div class="small-muted">
            ${order.id}
          </div>

        </div>

        ${statusBadge(order.status)}

      </div>

      <div class="row g-4">

        <div class="col-lg-7">

          <div class="card p-4">

            <h6 class="fw-bold">
              Customer Information
            </h6>

            <p class="mt-3 mb-1">
              <b>${esc(order.customer)}</b>
            </p>

            <p class="small-muted">
              0917-123-4567
            </p>

            <h6 class="fw-bold mt-4">
              Delivery Address
            </h6>

            <p class="mt-3">
              ${esc(order.address)}
            </p>

            <div id="riderGpsMap" class="gps-map mt-3"></div>
            <div id="gpsStatus" class="small-muted mt-2">GPS is not currently being shared.</div>

          </div>

        </div>

        <div class="col-lg-5">

          <div class="card p-4">

            <h6 class="fw-bold">
              Order Details
            </h6>

            <p class="mt-3">
              ${esc(order.products)}
            </p>

            <p class="small-muted mb-1">
              Schedule
            </p>

            <p>
              ${esc(order.schedule)}
            </p>

            <p class="small-muted mb-1">
              Order Status
            </p>

            <p>
              ${statusBadge(order.status)}
            </p>

            ${order.status==='Out for Delivery'?`<div class="mt-3">
              <button class="btn ${gpsOrderId===order.id?'btn-outline-danger':'btn-success'} w-100"
                onclick="${gpsOrderId===order.id?`stopSharingGPS(true)`:`startSharingGPS('${order.id}')`}">
                <i class="bi bi-geo-alt me-1"></i>${gpsOrderId===order.id?'Stop Live GPS':'Start Live GPS'}</button>
              <p class="small-muted mt-2 mb-0">Your phone must allow location access and keep this browser tab active.</p>
            </div>`:''}
            <div class="d-grid gap-2 mt-4">
            ${order.status==='Assigned'?`<button class="btn btn-primary" onclick="riderUpdate('${order.id}','Out for Delivery')">Out for Delivery</button>`:''}
            ${order.status==='Out for Delivery'?`<button class="btn btn-outline-primary" onclick="riderUpdate('${order.id}','Delivered')">Mark as Delivered</button>`:''}
            </div>

          </div>

        </div>

      </div>
    `
  );
}

async function riderUpdate(id, status) {
  const result=await runAction('order_status',{id:id.replace('#',''),status},`${id} marked ${status}.`);
  if(result && (status==='Delivered' || status==='Cancelled') && gpsOrderId===id) stopLocalGpsWatch();
}

/*RIDER HISTORY*/

function historyPage() {
  const history = orders
    .filter(
      (order) => order.status === "Delivered" || order.status === "Cancelled"
    )
    .slice(0, 6);

  return shell(
    riderMenu,
    "Delivery History",
    `
      <div class="mb-4">

        <h4 class="fw-bold mb-1">
          Delivery History
        </h4>

        <div class="small-muted">
          Completed and past deliveries.
        </div>

      </div>

      <div class="card table-card">

        <div class="table-responsive">

          <table class="table mb-0">

            <thead>
              <tr>
                <th>Order Number</th>
                <th>Customer</th>
                <th>Date</th>
                <th>Delivery Address</th>
                <th>Status</th>
              </tr>
            </thead>

            <tbody>

              ${history.map((order) => `
                <tr>

                  <td>${order.id}</td>

                  <td>${esc(order.customer)}</td>

                  <td>${order.date}</td>

                  <td>${esc(order.address)}</td>

                  <td>
                    ${statusBadge(order.status)}
                  </td>

                </tr>
              `).join("")}

            </tbody>

          </table>

        </div>

      </div>
    `
  );
}


/*RIDER PROFILE*/

function riderProfile() {return shell(riderMenu,'Profile',profileForm('Rider Profile'));}

/*MODAL FUNCTIONS */

function showModal(html) {
  const modalContent =
    document.getElementById("modalContent");

  const modal =
    document.getElementById("appModal");

  if (!modalContent || !modal) return;

  modalContent.innerHTML = html;

  bootstrap.Modal
    .getOrCreateInstance(modal)
    .show();
}

function closeModal() {
  const modal =
    document.getElementById("appModal");

  if (!modal) return;

  bootstrap.Modal
    .getOrCreateInstance(modal)
    .hide();
}


/* BROWSER GPS SHARING (foreground-only) + LEAFLET MAP POLLING */
function stopLocalGpsWatch() {
  if (gpsWatchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(gpsWatchId);
  if(gpsRefreshTimer!==null)clearInterval(gpsRefreshTimer);
  gpsRefreshTimer=null; gpsWatchId=null; gpsOrderId=null; gpsLastSent=0;
}
async function stopSharingGPS(showMessage=true) {
  const id=gpsOrderId;
  stopLocalGpsWatch();
  if(id) {
    try { await api('tracking_stop',{id:id.replace('#','')}); }
    catch(e) { if(showMessage) toast(e.message); }
  }
  if(showMessage) {toast('GPS sharing stopped.');render();}
}
async function startSharingGPS(orderId) {
  if (!navigator.geolocation) {toast('Your browser does not support GPS geolocation.');return;}
  if (!window.isSecureContext) {toast('GPS needs HTTPS, or localhost on the same device. Open AquaFlow over a secure URL on your phone.');return;}
  if (gpsOrderId && gpsOrderId!==orderId) await stopSharingGPS(false);
  if (gpsOrderId === orderId) {toast('GPS sharing is already running.');return;}
  try {await api('tracking_start',{id:orderId.replace('#','')});}
  catch(e) {toast(e.message);return;}
  gpsOrderId=orderId;
  gpsLastSent=0;
  gpsWatchId=navigator.geolocation.watchPosition(async position=>{
    if(gpsOrderId!==orderId) return;
    const now=Date.now();
    if(now-gpsLastSent<7000)return;
    gpsLastSent=now;
    try {
      await api('tracking_update',{
        id:orderId.replace('#',''),
        latitude:position.coords.latitude,longitude:position.coords.longitude,
        accuracy_m:Math.min(9999, Math.max(0, position.coords.accuracy || 0))
      });
      const text=document.getElementById('gpsStatus');
      if(text && gpsOrderId===orderId) text.textContent='GPS sent to server • '+new Date().toLocaleTimeString();
    } catch(e) {
      if(gpsOrderId===orderId){stopLocalGpsWatch();toast('GPS update failed: '+e.message);render();}
    }
  }, async error=>{
    if(gpsOrderId!==orderId)return;
    if(error.code===3) {toast('GPS fix timed out. Trying again...');return;}
    stopLocalGpsWatch();
    try{await api('tracking_stop',{id:orderId.replace('#','')});}catch{}
    toast('GPS access failed: '+error.message);
    render();
  },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
  // Request a fresh GPS fix even if the rider stays in the same place (watchPosition
  // may not deliver frequent callbacks while stationary).
  gpsRefreshTimer=setInterval(()=>{
    if(gpsOrderId!==orderId)return;
    navigator.geolocation.getCurrentPosition(position=>{
      if(gpsOrderId!==orderId)return;
      // A new enough fix is sent by the watch callback on most browsers. For browsers
      // that don't emit stationary updates, we send a periodic fresh reading here.
      if(Date.now()-gpsLastSent>=7000){
        gpsLastSent=Date.now();
        api('tracking_update',{id:orderId.replace('#',''),latitude:position.coords.latitude,
          longitude:position.coords.longitude,accuracy_m:Math.min(9999,Math.max(0,position.coords.accuracy||0))})
          .catch(e=>{if(gpsOrderId===orderId)toast('GPS update: '+e.message);});
      }
    },()=>{},{enableHighAccuracy:true,maximumAge:10000,timeout:12000});
  },12000);
  toast('GPS enabled. Keep this tab open and the screen on while testing.');
  render();
}
function clearGpsMap() {
  gpsMapGeneration++;
  if(gpsMapTimer!==null) clearInterval(gpsMapTimer);
  gpsMapTimer=null;
  if(gpsMap){gpsMap.remove();gpsMap=null;}
  gpsMapMarkers=[];
}
function gpsStatus(text) {
  const el=document.getElementById('gpsStatus');
  if(el)el.textContent=text;
}
function markerText(place, subtitle) {
  const container=document.createElement('div');
  const title=document.createElement('strong'); title.textContent=place;
  const sub=document.createElement('div'); sub.textContent=subtitle;
  container.append(title,sub);
  return container;
}
function gpsMarker(lat,lng,label,description) {
  const marker=L.marker([lat,lng]).addTo(gpsMap).bindPopup(markerText(label,description));
  gpsMapMarkers.push(marker);return marker;
}
function prepareGpsMap(elementId) {
  const mapEl=document.getElementById(elementId);
  if(!mapEl)return false;
  if(typeof L==='undefined') {gpsStatus('Cannot load Leaflet maps. Check your internet connection.');return false;}
  gpsMap=L.map(mapEl).setView([14.5995,120.9842],10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(gpsMap);
  setTimeout(()=>{if(gpsMap)gpsMap.invalidateSize();},200);
  return true;
}
function showSingleTracking(tracking, order) {
  if(!gpsMap)return;
  gpsMapMarkers.forEach(m=>gpsMap.removeLayer(m));gpsMapMarkers=[];
  if(!tracking || tracking.latitude==null || tracking.longitude==null) {
    gpsStatus(order.status==='Out for Delivery'?'Waiting for rider to turn on Live GPS.':'Live GPS is available only when the order is Out for Delivery.');
    return;
  }
  const date=new Date(tracking.updated_epoch*1000);
  const stamp=date.toLocaleTimeString('en-PH');
  const age=Math.max(0,Math.round(Date.now()/1000-tracking.updated_epoch));
  const label=tracking.live?'LIVE • Rider location':'STALE • Last known rider location';
  gpsMarker(tracking.latitude,tracking.longitude,label,`Updated ${stamp}, ±${Math.round(tracking.accuracy_m)}m accuracy`);
  gpsMap.setView([tracking.latitude,tracking.longitude],15);
  gpsStatus(tracking.live?`Live rider location • updated ${age}s ago • GPS accuracy ±${Math.round(tracking.accuracy_m)}m`:
    `Location is stale (last update ${stamp}). Rider browser may be paused/offline; not live.`);
}
function showAdminTracking(locations) {
  if(!gpsMap)return;
  gpsMapMarkers.forEach(m=>gpsMap.removeLayer(m));gpsMapMarkers=[];
  for(const t of locations){
    gpsMarker(t.latitude,t.longitude,`${t.live?'Live':'Stale'}: ${t.rider_name} • ${t.order_id}`,
      `Customer: ${t.customer}. Last seen: ${new Date(t.updated_epoch*1000).toLocaleTimeString('en-PH')}`);
  }
  if(gpsMapMarkers.length){
    const bounds=L.featureGroup(gpsMapMarkers).getBounds();
    gpsMap.fitBounds(bounds,{padding:[35,35],maxZoom:15});
  }
  gpsStatus(`${locations.filter(l=>l.live).length} rider(s) live • ${locations.filter(l=>!l.live).length} stale locations. Updates every 8 seconds.`);
}
function setupGpsMap(path) {
  const mode=path==='tracking'?'liveGpsMap':path==='admin-delivery'?'adminGpsMap':path==='delivery-details'?'riderGpsMap':null;
  if(!mode || !prepareGpsMap(mode)) return;
  const generation=gpsMapGeneration;
  const load=async()=>{
    try {
      if(path==='admin-delivery'){
        const result=await api('tracking_list',{});
        if(generation===gpsMapGeneration)showAdminTracking(result.locations||[]);
      }else{
        const order=currentOrder();
        if(!order)return;
        const result=await api('tracking_get',{id:order.id.replace('#','')});
        if(generation===gpsMapGeneration)showSingleTracking(result.tracking,order);
      }
    }catch(e){if(generation===gpsMapGeneration)gpsStatus('Could not fetch GPS updates: '+e.message);}
  };
  load();
  gpsMapTimer=setInterval(load,8000);
}

/* ROUTER*/

function render() {
  const path =
    (location.hash.slice(2).split('?')[0]) || "";

  const routes = {

    /* Public */
    "": landing,
    "/": landing,
    "login": login,
    "register": register,
    "verify-email": verifyEmailPage,
    "forgot-password": forgotPasswordPage,
    "reset-password": resetPasswordPage,
    "products-public": publicProducts,
    "about": aboutPage,
    "contact": contactPage,

    /* Customer */
    "dashboard": customerDashboard,
    "products": productsPage,
    "cart": cartPage,
    "checkout": checkoutPage,
    "confirmation": confirmationPage,
    "orders": ordersPage,
    "tracking": trackingPage,
    "addresses": addressesPage,
    "profile": profilePage,

    /* Admin */
    "admin": adminDashboard,
    "admin-orders": adminOrders,
    "admin-order-details": adminOrderDetailsPage,
    "admin-products": adminProducts,
    "admin-customers": adminCustomers,
    "admin-riders": adminRiders,
    "admin-delivery": adminDelivery,
    "admin-reports": adminReports,
    "admin-settings": adminSettings,

    /* Rider */
    "rider": riderDashboard,
    "deliveries": deliveriesPage,
    "delivery-details": deliveryDetailsPage,
    "history": historyPage,
    "rider-profile": riderProfile
  };

  const customerPaths = ['dashboard','products','cart','checkout','confirmation','orders','tracking','addresses','profile'];
  const adminPaths = ['admin','admin-orders','admin-order-details','admin-products','admin-customers','admin-riders','admin-delivery','admin-reports','admin-settings'];
  const riderPaths = ['rider','deliveries','delivery-details','history','rider-profile'];
  const roleNeeded = customerPaths.includes(path) ? 'customer' : adminPaths.includes(path) ? 'admin' : riderPaths.includes(path) ? 'rider' : null;
  if (roleNeeded && portal !== roleNeeded || (roleNeeded && !currentUser)) {
    go('/login');
    document.getElementById('app').innerHTML = login();
    return;
  }
  const page =
    routes[path]
      ? routes[path]()
      : landing();

  clearGpsMap();
  document.getElementById("app").innerHTML = page;
  setupGpsMap(path);
}


window.addEventListener(
  "hashchange",
  render
);

window.addEventListener(
  "load",
  bootApp
);


(function () {
  "use strict";
  function createPageLoader() {
    if (document.querySelector(".af-page-loader")) return;

    const loader = document.createElement("div");
    loader.className = "af-page-loader";

    loader.innerHTML = `
      <div class="af-loader-content">
        <div class="af-loader-logo">
          <i class="bi bi-droplet-fill"></i>
        </div>
        <div class="af-loader-name">AquaFlow</div>
        <div class="af-loader-spinner"></div>
      </div>
    `;

    document.body.appendChild(loader);

    setTimeout(function () {
      loader.classList.add("af-loader-hidden");

      setTimeout(function () {
        if (loader && loader.parentNode) {
          loader.parentNode.removeChild(loader);
        }
      }, 500);
    }, 500);
  }


  function injectEnhancementStyles() {
    if (document.getElementById("aquaflow-enhancement-styles")) return;

    const style = document.createElement("style");
    style.id = "aquaflow-enhancement-styles";

    style.textContent = `
      /* Page Loader */
      .af-page-loader {
        position: fixed;
        inset: 0;
        background: linear-gradient(135deg, #1769e0, #123f91);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99999;
        opacity: 1;
        visibility: visible;
        transition: opacity .45s ease, visibility .45s ease;
      }

      .af-page-loader.af-loader-hidden {
        opacity: 0;
        visibility: hidden;
      }

      .af-loader-content {
        text-align: center;
        color: white;
      }

      .af-loader-logo {
        width: 72px;
        height: 72px;
        border-radius: 22px;
        background: rgba(255,255,255,.16);
        border: 1px solid rgba(255,255,255,.25);
        display: flex;
        align-items: center;
        justify-content: center;
        margin: auto;
        font-size: 32px;
        box-shadow: 0 15px 40px rgba(0,0,0,.15);
        animation: afLoaderFloat 1.5s ease-in-out infinite;
      }

      .af-loader-name {
        font-size: 24px;
        font-weight: 700;
        margin-top: 14px;
      }

      .af-loader-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid rgba(255,255,255,.3);
        border-top-color: white;
        border-radius: 50%;
        margin: 18px auto 0;
        animation: afSpin .8s linear infinite;
      }

      @keyframes afLoaderFloat {
        0%,100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-8px);
        }
      }

      @keyframes afSpin {
        to {
          transform: rotate(360deg);
        }
      }


      /* Scroll Reveal */
      .af-reveal {
        opacity: 0;
        transform: translateY(24px);
        transition:
          opacity .65s ease,
          transform .65s ease;
      }

      .af-reveal.af-visible {
        opacity: 1;
        transform: translateY(0);
      }


      /* Card Hover */
      .card {
        transition:
          transform .25s ease,
          box-shadow .25s ease,
          border-color .25s ease;
      }

      .card:hover {
        box-shadow: 0 14px 35px rgba(20,55,100,.10);
      }


      /* Product Visual */
      .product-placeholder,
      .product-mini {
        transition: transform .3s ease;
      }

      .card:hover .product-placeholder {
        transform: scale(1.04);
      }

      .card:hover .product-mini {
        transform: scale(1.06);
      }


      /* Hero */
      .hero {
        overflow: hidden;
      }

      .hero h1 {
        animation: afHeroText .7s ease both;
      }

      .hero p {
        animation: afHeroText .8s ease .08s both;
      }

      .hero .btn {
        animation: afHeroText .8s ease .15s both;
      }

      @keyframes afHeroText {
        from {
          opacity: 0;
          transform: translateY(15px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }


      /* Water Bottle */
      .water-bottle {
        animation: afBottleFloat 4s ease-in-out infinite;
      }

      @keyframes afBottleFloat {
        0%,100% {
          transform: translateY(0) rotate(0deg);
        }
        50% {
          transform: translateY(-10px) rotate(1deg);
        }
      }


      /* Hero bubbles */
      .hero-bubble {
        animation: afBubbleFloat 3.5s ease-in-out infinite;
      }

      .hero-bubble.two {
        animation-delay: .8s;
      }

      @keyframes afBubbleFloat {
        0%,100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-7px);
        }
      }


      /* Buttons */
      .btn {
        transition:
          transform .2s ease,
          box-shadow .2s ease,
          background-color .2s ease;
      }

      .btn:hover {
        transform: translateY(-2px);
      }

      .btn-primary:hover {
        box-shadow: 0 8px 20px rgba(23,105,224,.22);
      }


      /* Ripple */
      .af-ripple {
        position: absolute;
        border-radius: 50%;
        transform: scale(0);
        animation: afRipple .55s linear;
        background: rgba(255,255,255,.35);
        pointer-events: none;
      }

      @keyframes afRipple {
        to {
          transform: scale(4);
          opacity: 0;
        }
      }


      /* Stats */
      .stat-card {
        overflow: hidden;
        position: relative;
      }

      .stat-card::after {
        content: "";
        position: absolute;
        width: 90px;
        height: 90px;
        border-radius: 50%;
        right: -35px;
        bottom: -35px;
        background: rgba(23,105,224,.05);
        pointer-events: none;
      }

      .stat-icon {
        transition: transform .25s ease;
      }

      .stat-card:hover .stat-icon {
        transform: translateY(-3px) scale(1.05);
      }


      /* Quantity buttons */
      .quantity button {
        transition: .2s ease;
      }

      .quantity button:hover {
        background: #1769e0;
        color: white;
        border-color: #1769e0;
      }


      /* Map pin */
      .map-pin {
        animation: afMapPin 1.7s ease-in-out infinite;
      }

      @keyframes afMapPin {
        0%,100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-7px);
        }
      }


      /* Floating bubbles */
      .af-water-bubble {
        position: fixed;
        bottom: -30px;
        border-radius: 50%;
        background: rgba(40,169,224,.10);
        pointer-events: none;
        z-index: 0;
        animation: afWaterBubble linear forwards;
      }

      @keyframes afWaterBubble {
        from {
          transform: translateY(0) scale(1);
          opacity: .7;
        }
        to {
          transform: translateY(-110vh) scale(1.4);
          opacity: 0;
        }
      }


      /* Toast enhancement */
      #toastArea {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 9999;
      }

      #toastArea .toast {
        border: 0;
        border-radius: 14px;
        box-shadow: 0 12px 35px rgba(0,0,0,.15);
        overflow: hidden;
      }


      /* Mobile */
      @media (max-width: 767.98px) {
        .af-loader-logo {
          width: 64px;
          height: 64px;
        }

        #toastArea {
          left: 15px;
          right: 15px;
          bottom: 15px;
        }

        #toastArea .toast {
          width: 100%;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function setupRevealAnimations() {
    const selectors = [
      ".hero .col-lg-6",
      ".section-title",
      ".hero-bubble",
      ".card",
      ".stat-card",
      ".table-card",
      ".order-panel",
      ".icon-box"
    ];

    const elements = document.querySelectorAll(selectors.join(","));

    elements.forEach(function (element) {
      if (
        element.classList.contains("af-page-loader") ||
        element.closest(".af-page-loader")
      ) {
        return;
      }

      element.classList.add("af-reveal");
    });

    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) {
        element.classList.add("af-visible");
      });
      return;
    }

    const observer = new IntersectionObserver(
      function (entries, obs) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("af-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.08
      }
    );

    document.querySelectorAll(".af-reveal").forEach(function (element) {
      observer.observe(element);
    });
  }

  function setupRipple() {
    document.querySelectorAll(".btn").forEach(function (button) {

      if (button.dataset.afRippleReady === "true") return;

      button.dataset.afRippleReady = "true";

      button.addEventListener("click", function (event) {

        const rect = button.getBoundingClientRect();

        const size = Math.max(rect.width, rect.height);

        const ripple = document.createElement("span");

        ripple.className = "af-ripple";

        ripple.style.width = size + "px";
        ripple.style.height = size + "px";

        ripple.style.left =
          event.clientX - rect.left - size / 2 + "px";

        ripple.style.top =
          event.clientY - rect.top - size / 2 + "px";

        if (getComputedStyle(button).position === "static") {
          button.style.position = "relative";
        }

        button.style.overflow = "hidden";

        button.appendChild(ripple);

        setTimeout(function () {
          if (ripple && ripple.parentNode) {
            ripple.parentNode.removeChild(ripple);
          }
        }, 600);
      });
    });
  }

  function createWaterBubble() {

    if (!document.body) return;

    const bubble = document.createElement("span");

    bubble.className = "af-water-bubble";

    const size = Math.floor(Math.random() * 18) + 8;

    bubble.style.width = size + "px";
    bubble.style.height = size + "px";

    bubble.style.left =
      Math.floor(Math.random() * 100) + "vw";

    bubble.style.animationDuration =
      (Math.floor(Math.random() * 7) + 7) + "s";

    bubble.style.opacity =
      (Math.random() * .35 + .15).toFixed(2);

    document.body.appendChild(bubble);

    setTimeout(function () {
      if (bubble && bubble.parentNode) {
        bubble.parentNode.removeChild(bubble);
      }
    }, 15000);
  }

  function startWaterBubbles() {
    setInterval(function () {
      if (document.hidden) return;

      createWaterBubble();

    }, 1800);
  }

  function setupNavbarEffect() {

    function updateNavbar() {

      const navbar = document.querySelector(".navbar");

      if (!navbar) return;

      if (window.scrollY > 20) {
        navbar.classList.add("shadow-sm");
      } else {
        navbar.classList.remove("shadow-sm");
      }
    }

    window.addEventListener("scroll", updateNavbar);

    updateNavbar();
  }

  function updatePublicNav() {

    const hash = location.hash || "#/";

    document.querySelectorAll(".navbar .nav-link").forEach(function (link) {

      link.classList.remove("active");

      const href = link.getAttribute("href");

      if (!href) return;

      if (href === hash) {
        link.classList.add("active");
      }
    });
  }

  function animateCounters() {

    document.querySelectorAll(".stat-card h3, .stat-card h5").forEach(function (element) {

      if (element.dataset.afCounterDone === "true") return;

      const original = element.textContent.trim();
      const match = original.match(/^(\d+)$/);

      if (!match) return;

      const target = Number(match[1]);

      if (target <= 0) return;

      element.dataset.afCounterDone = "true";

      const duration = 700;
      const startTime = performance.now();

      function updateCounter(currentTime) {

        const progress = Math.min(
          (currentTime - startTime) / duration,
          1
        );

        const eased =
          1 - Math.pow(1 - progress, 3);

        const current =
          Math.floor(target * eased);

        element.textContent =
          current.toLocaleString("en-PH");

        if (progress < 1) {
          requestAnimationFrame(updateCounter);
        } else {
          element.textContent =
            target.toLocaleString("en-PH");
        }
      }

      requestAnimationFrame(updateCounter);
    });
  }

  function setupCardTilt() {

    document.querySelectorAll(".hero-visual .card, .product-placeholder")
      .forEach(function (element) {

        if (element.dataset.afTiltReady === "true") return;

        element.dataset.afTiltReady = "true";

        element.addEventListener("mousemove", function (event) {

          const rect = element.getBoundingClientRect();

          const x =
            (event.clientX - rect.left) / rect.width;

          const y =
            (event.clientY - rect.top) / rect.height;

          const rotateX =
            (y - .5) * -4;

          const rotateY =
            (x - .5) * 4;

          element.style.transform =
            `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale(1.02)`;
        });

        element.addEventListener("mouseleave", function () {
          element.style.transform = "";
        });
      });
  }

  function setupMobileMenu() {

    document.querySelectorAll(".mobile-menu").forEach(function (button) {

      if (button.dataset.afMenuReady === "true") return;

      button.dataset.afMenuReady = "true";

      button.addEventListener("click", function () {

        const sidebar =
          document.querySelector(".sidebar");

        if (!sidebar) return;

        sidebar.classList.toggle("af-sidebar-open");

      });
    });
  }

  function closeMobileSidebar() {

    const sidebar =
      document.querySelector(".sidebar");

    if (!sidebar) return;

    sidebar.classList.remove("af-sidebar-open");
  }

  function runAquaFlowEffects() {

    injectEnhancementStyles();

    setupRevealAnimations();

    setupRipple();

    setupNavbarEffect();

    updatePublicNav();

    animateCounters();

    setupCardTilt();

    setupMobileMenu();

    closeMobileSidebar();
  }

  function injectMobileSidebarStyle() {

    if (document.getElementById("aquaflow-mobile-style")) return;

    const style = document.createElement("style");

    style.id = "aquaflow-mobile-style";

    style.textContent = `
      @media (max-width: 991.98px) {

        .sidebar {
          transition:
            transform .3s ease,
            box-shadow .3s ease;
        }

        .sidebar.af-sidebar-open {
          transform: translateX(0) !important;
          box-shadow: 12px 0 35px rgba(0,0,0,.15);
        }
      }
    `;

    document.head.appendChild(style);
  }

  function startAquaFlowEnhancements() {

    injectEnhancementStyles();

    injectMobileSidebarStyle();

    createPageLoader();

    setTimeout(function () {
      runAquaFlowEffects();
    }, 100);

    startWaterBubbles();
  }

  window.addEventListener("hashchange", function () {

    setTimeout(function () {
      runAquaFlowEffects();
    }, 80);

  });
  if (document.readyState === "loading") {

    document.addEventListener(
      "DOMContentLoaded",
      startAquaFlowEnhancements
    );

  } else {

    startAquaFlowEnhancements();

  }

})();