import { DeliveryMethod } from "@shopify/shopify-api";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  // Order webhooks
  ORDERS_CREATE: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/orders",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const orderData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          orderData,
          shop,
          "orders/create"
        );
        console.log(`✅ Order created webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Order create webhook error:", error);
      }
    },
  },

  ORDERS_UPDATED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/orders",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const orderData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          orderData,
          shop,
          "orders/updated"
        );
        console.log(`✅ Order updated webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Order update webhook error:", error);
      }
    },
  },

  ORDERS_PAID: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/orders",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const orderData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(orderData, shop, "orders/paid");
        console.log(`✅ Order paid webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Order paid webhook error:", error);
      }
    },
  },

  ORDERS_CANCELLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/orders",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const orderData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          orderData,
          shop,
          "orders/cancelled"
        );
        console.log(`✅ Order cancelled webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Order cancelled webhook error:", error);
      }
    },
  },

  ORDERS_FULFILLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/orders",
    callback: async (topic, shop, body, webhookId) => {
      try {
        const orderData = JSON.parse(body);
        await dataSyncService.handleWebhookSync(
          orderData,
          shop,
          "orders/fulfilled"
        );
        console.log(`✅ Order fulfilled webhook processed for shop: ${shop}`);
      } catch (error) {
        console.error("❌ Order fulfilled webhook error:", error);
      }
    },
  },
};
