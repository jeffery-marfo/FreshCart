import { fetchProducts, placeOrder, type Product } from "./api";

const productsEl = document.querySelector<HTMLElement>("#products")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const searchEl = document.querySelector<HTMLInputElement>("#search")!;

const dialogEl = document.querySelector<HTMLDialogElement>("#checkout-dialog")!;
const formEl = document.querySelector<HTMLFormElement>("#checkout-form")!;
const productNameEl = document.querySelector<HTMLElement>("#checkout-product-name")!;
const quantityEl = document.querySelector<HTMLInputElement>("#checkout-quantity")!;
const nameEl = document.querySelector<HTMLInputElement>("#checkout-name")!;
const emailEl = document.querySelector<HTMLInputElement>("#checkout-email")!;
const cancelEl = document.querySelector<HTMLButtonElement>("#checkout-cancel")!;

let selectedProduct: Product | null = null;

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function showStatus(message: string, kind: "error" | "success") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.hidden = false;
  window.setTimeout(() => {
    statusEl.hidden = true;
  }, 4000);
}

function renderProducts(products: Product[]) {
  productsEl.innerHTML = "";

  if (products.length === 0) {
    productsEl.innerHTML = `<p>No products match your search.</p>`;
    return;
  }

  for (const product of products) {
    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <span class="category">${product.category}</span>
      <h3>${product.name}</h3>
      <span class="price">${formatPrice(product.price_cents)}</span>
      <span class="stock">${product.stock > 0 ? `${product.stock} in stock` : "Out of stock"}</span>
      <button type="button" ${product.stock === 0 ? "disabled" : ""}>Buy</button>
    `;

    card.querySelector("button")!.addEventListener("click", () => openCheckout(product));
    productsEl.appendChild(card);
  }
}

async function loadProducts(search = "") {
  try {
    const { products } = await fetchProducts(search);
    renderProducts(products);
  } catch (error) {
    showStatus((error as Error).message, "error");
  }
}

function openCheckout(product: Product) {
  selectedProduct = product;
  productNameEl.textContent = `${product.name} — ${formatPrice(product.price_cents)} each`;
  quantityEl.value = "1";
  quantityEl.max = String(product.stock);
  dialogEl.showModal();
}

cancelEl.addEventListener("click", () => dialogEl.close());

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProduct) return;

  try {
    const { order } = await placeOrder(nameEl.value, emailEl.value, [
      { productId: selectedProduct.id, quantity: Number(quantityEl.value) }
    ]);
    dialogEl.close();
    showStatus(`Order #${order.id} placed — status: ${order.status}.`, "success");
    formEl.reset();
    loadProducts(searchEl.value);
  } catch (error) {
    showStatus((error as Error).message, "error");
  }
});

let searchTimeout: number | undefined;
searchEl.addEventListener("input", () => {
  window.clearTimeout(searchTimeout);
  searchTimeout = window.setTimeout(() => loadProducts(searchEl.value), 250);
});

loadProducts();
