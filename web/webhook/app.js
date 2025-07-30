import { DeliveryMethod } from "@shopify/shopify-api";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  // App uninstall webhook
  APP_UNINSTALLED: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/webhooks/app-uninstalled",
    callback: async (topic, shop, body, webhookId) => {
      try {
        console.log(`🗑️ App uninstalled webhook received for shop: ${shop}`);
        // The cleanup will be handled by the webhook route
      } catch (error) {
        console.error("❌ App uninstall webhook error:", error);
      }
    },
  },
};
