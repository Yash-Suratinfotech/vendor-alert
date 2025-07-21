// web/utils/webhookVerification.js
import crypto from "crypto";

/**
 * Verify Shopify webhook authenticity
 * @param {string} rawBody - Raw request body
 * @param {string} signature - X-Shopify-Hmac-Sha256 header value
 * @param {string} secret - Webhook secret from Shopify
 * @returns {boolean} - True if webhook is authentic
 */
export function verifyShopifyWebhook(rawBody, signature, secret) {
  if (!signature || !secret) {
    return false;
  }

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(rawBody, "utf8");
  const calculatedSignature = hmac.digest("base64");

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(calculatedSignature)
  );
}

/**
 * Middleware to verify webhook authenticity
 * @param {string} webhookSecret - The webhook secret from environment
 * @returns {Function} Express middleware
 */
export function createWebhookVerificationMiddleware(webhookSecret) {
  return (req, res, next) => {
    const signature = req.get("X-Shopify-Hmac-Sha256");
    const shop = req.get("X-Shopify-Shop-Domain");
    const topic = req.get("X-Shopify-Topic");

    console.log(`🔍 Verifying webhook: ${topic} from shop: ${shop}`);

    if (!shop || !topic) {
      console.log("❌ Missing required webhook headers");
      return res
        .status(400)
        .json({ error: "Missing required webhook headers" });
    }

    // For development, you might want to skip verification
    if (
      process.env.NODE_ENV === "development" &&
      process.env.SKIP_WEBHOOK_VERIFICATION === "true"
    ) {
      console.log("⚠️ Skipping webhook verification in development mode");
      return next();
    }

    if (!webhookSecret) {
      console.log("❌ Webhook secret not configured");
      return res
        .status(500)
        .json({ error: "Webhook verification not configured" });
    }

    // Get raw body for verification
    let rawBody = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", () => {
      try {
        if (!verifyShopifyWebhook(rawBody, signature, webhookSecret)) {
          console.log("❌ Webhook signature verification failed");
          return res.status(401).json({ error: "Webhook verification failed" });
        }

        // Parse body and attach to request
        req.body = JSON.parse(rawBody);
        req.rawBody = rawBody;

        console.log("✅ Webhook verified successfully");
        next();
      } catch (error) {
        console.log("❌ Error verifying webhook:", error);
        return res.status(400).json({ error: "Invalid webhook payload" });
      }
    });
  };
}

/**
 * Extract Shopify ID from GraphQL GID
 * @param {string} gid - GraphQL Global ID (e.g., "gid://shopify/Product/123")
 * @returns {number} - Numeric ID
 */
export function extractShopifyId(gid) {
  if (!gid || typeof gid !== "string") {
    return null;
  }

  const parts = gid.split("/");
  const id = parts[parts.length - 1];
  return parseInt(id, 10);
}

/**
 * Convert REST API webhook data to GraphQL format for consistency
 * @param {Object} restData - Data from REST webhook
 * @param {string} resourceType - Type of resource (product, order, etc.)
 * @returns {Object} - Converted data
 */
export function convertRestToGraphQLFormat(restData, resourceType) {
  switch (resourceType) {
    case "product":
      return {
        id: `gid://shopify/Product/${restData.id}`,
        title: restData.title,
        handle: restData.handle,
        vendor: restData.vendor,
        productType: restData.product_type,
        status: restData.status,
        createdAt: restData.created_at,
        updatedAt: restData.updated_at,
        variants: {
          edges: restData.variants.map((variant) => ({
            node: {
              id: `gid://shopify/ProductVariant/${variant.id}`,
              sku: variant.sku,
              price: variant.price,
              inventoryQuantity: variant.inventory_quantity,
            },
          })),
        },
      };

    case "order":
      return {
        id: `gid://shopify/Order/${restData.id}`,
        name: restData.name,
        email: restData.email,
        totalPriceSet: {
          shopMoney: {
            amount: restData.total_price,
          },
        },
        displayFinancialStatus: restData.financial_status,
        displayFulfillmentStatus: restData.fulfillment_status,
        customer: restData.customer
          ? {
              displayName: `${restData.customer.first_name || ""} ${
                restData.customer.last_name || ""
              }`.trim(),
              email: restData.customer.email,
            }
          : null,
        lineItems: {
          edges: restData.line_items.map((item) => ({
            node: {
              id: `gid://shopify/LineItem/${item.id}`,
              title: item.title,
              vendor: item.vendor,
              quantity: item.quantity,
              originalUnitPriceSet: {
                shopMoney: {
                  amount: item.price,
                },
              },
              totalDiscountSet: {
                shopMoney: {
                  amount: item.total_discount || 0,
                },
              },
              product: item.product_id
                ? {
                    id: `gid://shopify/Product/${item.product_id}`,
                  }
                : null,
              variant: item.variant_id
                ? {
                    id: `gid://shopify/ProductVariant/${item.variant_id}`,
                  }
                : null,
            },
          })),
        },
        createdAt: restData.created_at,
        updatedAt: restData.updated_at,
      };

    default:
      return restData;
  }
}

/**
 * Rate limiting for webhooks to prevent spam
 */
class WebhookRateLimit {
  constructor(maxRequests = 100, windowMs = 60000) {
    // 100 requests per minute
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = new Map();
  }

  isAllowed(shopDomain) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.requests.has(shopDomain)) {
      this.requests.set(shopDomain, []);
    }

    const shopRequests = this.requests.get(shopDomain);

    // Remove old requests outside the window
    const validRequests = shopRequests.filter(
      (timestamp) => timestamp > windowStart
    );
    this.requests.set(shopDomain, validRequests);

    // Check if under limit
    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    return true;
  }

  cleanup() {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    for (const [shop, requests] of this.requests.entries()) {
      const validRequests = requests.filter(
        (timestamp) => timestamp > windowStart
      );
      if (validRequests.length === 0) {
        this.requests.delete(shop);
      } else {
        this.requests.set(shop, validRequests);
      }
    }
  }
}

// Create a global rate limiter instance
export const webhookRateLimit = new WebhookRateLimit();

// Cleanup old entries every 5 minutes
setInterval(() => {
  webhookRateLimit.cleanup();
}, 5 * 60 * 1000);

/**
 * Rate limiting middleware for webhooks
 */
export function webhookRateLimitMiddleware(req, res, next) {
  const shopDomain = req.get("X-Shopify-Shop-Domain");

  if (!shopDomain) {
    return res.status(400).json({ error: "Missing shop domain" });
  }

  if (!webhookRateLimit.isAllowed(shopDomain)) {
    console.log(`⚠️ Rate limit exceeded for shop: ${shopDomain}`);
    return res.status(429).json({ error: "Rate limit exceeded" });
  }

  next();
}
