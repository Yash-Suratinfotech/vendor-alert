import { DeliveryMethod } from "@shopify/shopify-api";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  // Product webhooks
  PRODUCTS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/products",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const productData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          productData,
          shop,
          "products/create"
        );
        console.log(`✅ Product created webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Product create webhook error:", error);
      }
    },
  },

  PRODUCTS_UPDATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/products",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const productData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          productData,
          shop,
          "products/update"
        );
        console.log(`✅ Product updated webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Product update webhook error:", error);
      }
    },
  },

  PRODUCTS_DELETE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/products",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const productData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          productData,
          shop,
          "products/delete"
        );
        console.log(`✅ Product deleted webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Product delete webhook error:", error);
      }
    },
  },
};
