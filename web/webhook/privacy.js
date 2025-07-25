import { DeliveryMethod } from "@shopify/shopify-api";

/**
 * @type {{[key: string]: import("@shopify/shopify-api").WebhookHandler}}
 */
export default {
  /**
   * Customers can request their data from a store owner. When this happens,
   * Shopify invokes this privacy webhook.
   *
   * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-data_request
   */
  CUSTOMERS_DATA_REQUEST: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/privacy/customers-data-request",
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      console.log(`📋 Customer data request received for shop: ${shop}`);

      // Log the request for compliance tracking (but don't store customer info)
      console.log(`Customer data request:`, {
        shop_domain: payload.shop_domain,
        data_request_id: payload.data_request?.id,
        orders_requested: payload.orders_requested?.length || 0,
      });

      // IMPORTANT: Our Vendor Alert app does NOT store personal customer data
      // We only store:
      // - Order IDs (not personal data)
      // - Product IDs and quantities (not personal data)
      // - Vendor business information (not customer personal data)
      // - Anonymous customer placeholders ("Anonymous Customer")

      console.log(
        `✅ Customer data request acknowledged - no personal customer data stored in vendor system`
      );
      console.log(
        `ℹ️ App only stores: order IDs, product IDs, quantities, and vendor business data`
      );
    },
  },

  /**
   * Store owners can request that data is deleted on behalf of a customer. When
   * this happens, Shopify invokes this privacy webhook.
   *
   * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#customers-redact
   */
  CUSTOMERS_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/privacy/customers-redact",
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      console.log(
        `🗑️ Customer data redaction request received for shop: ${shop}`
      );

      // Since we don't store actual customer personal data, just log the request
      console.log(`Customer redaction request:`, {
        shop_domain: payload.shop_domain,
        orders_to_redact: payload.orders_to_redact?.length || 0,
      });

      // IMPORTANT: Our app doesn't store personal customer data to redact
      // We only store:
      // - Order IDs (business data, not personal)
      // - Product IDs and quantities (business data)
      // - Vendor information (business contacts, not customer data)
      // - No customer names, emails, or addresses anywhere

      console.log(
        `✅ Customer redaction acknowledged - no personal customer data stored`
      );
      console.log(
        `ℹ️ All order data is business-only: order IDs, product IDs, quantities, vendors`
      );
    },
  },

  /**
   * 48 hours after a store owner uninstalls your app, Shopify invokes this
   * privacy webhook.
   *
   * https://shopify.dev/docs/apps/webhooks/configuration/mandatory-webhooks#shop-redact
   */
  SHOP_REDACT: {
    deliveryMethod: DeliveryMethod.Http,
    callbackUrl: "/api/webhooks/privacy/shop-redact",
    callback: async (topic, shop, body, webhookId) => {
      const payload = JSON.parse(body);
      console.log(`🗑️ Shop redaction request received for shop: ${shop}`);

      try {
        // Import db here to avoid circular dependencies
        const { default: db } = await import("../db.js");

        const client = await db.getClient();
        await client.query("BEGIN");

        console.log(
          `🗑️ App uninstalled - cleaning up ALL data for shop: ${shop}`
        );

        // Clean up all shop data in correct order (respecting foreign keys)
        // This removes all business data, not personal customer data
        await client.query(
          "DELETE FROM order_line_items WHERE order_id IN (SELECT id FROM orders WHERE shop_domain = $1)",
          [shop]
        );
        await client.query("DELETE FROM orders WHERE shop_domain = $1", [shop]);
        await client.query("DELETE FROM products WHERE shop_domain = $1", [
          shop,
        ]);
        await client.query("DELETE FROM vendors WHERE shop_domain = $1", [
          shop,
        ]);
        await client.query("DELETE FROM sync_logs WHERE shop_domain = $1", [
          shop,
        ]);
        await client.query("DELETE FROM users WHERE shop_domain = $1", [shop]);

        await client.query("COMMIT");
        client.release();

        console.log(`✅ All shop business data redacted for: ${shop}`);
      } catch (error) {
        console.error(`❌ Error processing shop redaction:`, error);
        // Don't throw - webhook should still return 200
      }
    },
  },
};
