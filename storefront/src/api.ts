const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type Product = {
  id: number;
  name: string;
  category: string;
  price_cents: number;
  stock: number;
};

export type OrderItemInput = {
  productId: number;
  quantity: number;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? `Request to ${path} failed with status ${response.status}`);
  }

  return body as T;
}

export function fetchProducts(search: string): Promise<{ products: Product[] }> {
  const query = search ? `?search=${encodeURIComponent(search)}` : "";
  return request(`/api/products${query}`);
}

export function placeOrder(
  customerName: string,
  customerEmail: string,
  items: OrderItemInput[]
): Promise<{ order: { id: number; status: string } }> {
  return request("/api/orders", {
    method: "POST",
    body: JSON.stringify({ customerName, customerEmail, items })
  });
}
