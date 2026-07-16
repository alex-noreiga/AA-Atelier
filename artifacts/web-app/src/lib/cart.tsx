// Client-side shopping cart for the shop's ready-to-ship items. State lives in
// React context and is persisted to localStorage so a cart survives a refresh.
//
// Everything here (name, price, photo) is for DISPLAY ONLY — the server never
// trusts it. At checkout we send just { variantId, size?, quantity }, and the
// api-server recomputes prices and availability from live Notion inventory.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface CartItem {
  /** Notion inventory page id of the variant (a ProductVariant `id`). */
  variantId: string;
  /** Display name of the variant, without the size suffix. */
  name: string;
  /** Selected size band, when the variant is offered in sizes. */
  size?: string;
  /** Listed price in dollars — for display and the subtotal only. */
  price: number;
  /** A variant photo, if any (Notion signed URLs are short-lived). */
  photo?: string;
  /**
   * Live stock ceiling for this variant, when known. Display-only: the server
   * re-checks it at checkout (see checkout.service `toLineItem`). Used here to
   * stop the obvious over-order in the UI. Absent ⇒ uncapped (a one-off item).
   */
  quantityAvailable?: number;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  count: number;
  subtotal: number;
  addItem: (item: Omit<CartItem, "quantity">, quantity?: number) => void;
  removeItem: (variantId: string, size?: string) => void;
  updateQuantity: (
    variantId: string,
    size: string | undefined,
    quantity: number,
  ) => void;
  clear: () => void;
}

const STORAGE_KEY = "aa-cart";

/** A cart line is identified by its variant AND its chosen size. */
export function lineKey(variantId: string, size?: string): string {
  return `${variantId}::${size ?? ""}`;
}

const CartContext = createContext<CartContextValue | null>(null);

/** Cap a desired quantity at the stock ceiling, when one is known. */
function clampToStock(quantity: number, ceiling?: number): number {
  return typeof ceiling === "number" ? Math.min(quantity, ceiling) : quantity;
}

function readStored(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // A full or unavailable localStorage shouldn't break the cart in memory.
    }
  }, [items]);

  const addItem = useCallback(
    (item: Omit<CartItem, "quantity">, quantity = 1) => {
      setItems((current) => {
        const key = lineKey(item.variantId, item.size);
        const existing = current.find(
          (i) => lineKey(i.variantId, i.size) === key,
        );
        if (existing) {
          // Refresh the stored ceiling with the freshest known count, and clamp
          // the merged quantity to it so re-adding can't exceed stock.
          const ceiling = item.quantityAvailable ?? existing.quantityAvailable;
          return current.map((i) =>
            lineKey(i.variantId, i.size) === key
              ? {
                  ...i,
                  ...(ceiling !== undefined
                    ? { quantityAvailable: ceiling }
                    : {}),
                  quantity: clampToStock(i.quantity + quantity, ceiling),
                }
              : i,
          );
        }
        return [
          ...current,
          { ...item, quantity: clampToStock(quantity, item.quantityAvailable) },
        ];
      });
    },
    [],
  );

  const removeItem = useCallback((variantId: string, size?: string) => {
    const key = lineKey(variantId, size);
    setItems((current) =>
      current.filter((i) => lineKey(i.variantId, i.size) !== key),
    );
  }, []);

  const updateQuantity = useCallback(
    (variantId: string, size: string | undefined, quantity: number) => {
      const key = lineKey(variantId, size);
      setItems((current) =>
        quantity <= 0
          ? current.filter((i) => lineKey(i.variantId, i.size) !== key)
          : current.map((i) =>
              lineKey(i.variantId, i.size) === key
                ? { ...i, quantity: clampToStock(quantity, i.quantityAvailable) }
                : i,
            ),
      );
    },
    [],
  );

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const count = items.reduce((sum, i) => sum + i.quantity, 0);
    const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    return {
      items,
      count,
      subtotal,
      addItem,
      removeItem,
      updateQuantity,
      clear,
    };
  }, [items, addItem, removeItem, updateQuantity, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}
