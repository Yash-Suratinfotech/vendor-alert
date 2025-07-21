// web/services/dataSyncService.js
import shopify from "../shopify.js";
import db from "../db.js";

class DataSyncService {
  constructor() {
    this.BATCH_SIZE = 50; // Process in batches to avoid timeouts
  }

  /**
   * Perform initial sync when app is installed
   */
  async performInitialSync(session) {
    const shopDomain = session.shop;
    console.log(`🔄 Starting initial sync for shop: ${shopDomain}`);

    try {
      // Log sync start
      await this.logSyncStart(shopDomain, "initial", "full_sync");

      // Check if initial sync already completed
      const shop = await db.query(
        "SELECT initial_sync_completed FROM shops WHERE shop_domain = $1",
        [shopDomain]
      );

      if (shop.rows[0]?.initial_sync_completed) {
        console.log(`✅ Initial sync already completed for ${shopDomain}`);
        return;
      }

      // Sync products first (includes vendors extraction)
      await this.syncAllProducts(session);

      // Sync orders (minimal data only)
      await this.syncAllOrders(session);

      // Mark initial sync as completed
      await db.query(
        "UPDATE shops SET initial_sync_completed = TRUE, updated_at = NOW() WHERE shop_domain = $1",
        [shopDomain]
      );

      await this.logSyncComplete(shopDomain, "initial", "full_sync", "success");
      console.log(`✅ Initial sync completed for shop: ${shopDomain}`);
    } catch (error) {
      console.error(`❌ Initial sync failed for ${shopDomain}:`, error);
      await this.logSyncComplete(
        shopDomain,
        "initial",
        "full_sync",
        "error",
        error.message
      );
      throw error;
    }
  }

  /**
   * Sync all products from Shopify
   */
  async syncAllProducts(session) {
    const shopDomain = session.shop;
    const client = new shopify.api.clients.Graphql({ session });

    let hasNextPage = true;
    let cursor = null;
    let totalSynced = 0;

    console.log(`📦 Starting product sync for ${shopDomain}`);

    while (hasNextPage) {
      try {
        const query = `
          query GetProducts($first: Int!, $after: String) {
            products(first: $first, after: $after) {
              edges {
                node {
                  id
                  title
                  handle
                  vendor
                  productType
                  status
                  createdAt
                  updatedAt
                  variants(first: 100) {
                    edges {
                      node {
                        id
                        sku
                        price
                        inventoryQuantity
                      }
                    }
                  }
                }
                cursor
              }
              pageInfo {
                hasNextPage
              }
            }
          }
        `;

        const response = await client.request(query, {
          variables: {
            first: this.BATCH_SIZE,
            after: cursor,
          },
        });

        const products = response.data.products.edges;

        for (const edge of products) {
          await this.syncProduct(edge.node, shopDomain);
          totalSynced++;
        }

        hasNextPage = response.data.products.pageInfo.hasNextPage;
        cursor =
          products.length > 0 ? products[products.length - 1].cursor : null;

        console.log(`📦 Synced ${totalSynced} products so far...`);
      } catch (error) {
        console.error("Error syncing products batch:", error);
        throw error;
      }
    }

    console.log(`✅ Product sync completed. Total synced: ${totalSynced}`);
    return totalSynced;
  }

  /**
   * Sync all orders from Shopify
   */
  async syncAllOrders(session) {
    const shopDomain = session.shop;
    const client = new shopify.api.clients.Graphql({ session });

    let hasNextPage = true;
    let cursor = null;
    let totalSynced = 0;

    console.log(`📋 Starting order sync for ${shopDomain}`);

    while (hasNextPage) {
      try {
        const query = `
          query GetOrders($first: Int!, $after: String) {
            orders(first: $first, after: $after) {
              edges {
                node {
                  id
                  name
                  totalPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                  displayFinancialStatus
                  displayFulfillmentStatus
                  lineItems(first: 100) {
                    edges {
                      node {
                        id
                        title
                        vendor
                        quantity
                        originalUnitPriceSet {
                          shopMoney {
                            amount
                          }
                        }
                        totalDiscountSet {
                          shopMoney {
                            amount
                          }
                        }
                        product {
                          id
                        }
                        variant {
                          id
                        }
                      }
                    }
                  }
                  createdAt
                  updatedAt
                }
                cursor
              }
              pageInfo {
                hasNextPage
              }
            }
          }
        `;

        const response = await client.request(query, {
          variables: {
            first: this.BATCH_SIZE,
            after: cursor,
          },
        });

        const orders = response.data.orders.edges;

        for (const edge of orders) {
          await this.syncOrderMinimal(edge.node, shopDomain);
          totalSynced++;
        }

        hasNextPage = response.data.orders.pageInfo.hasNextPage;
        cursor = orders.length > 0 ? orders[orders.length - 1].cursor : null;

        console.log(`📋 Synced ${totalSynced} orders so far...`);
      } catch (error) {
        console.error("Error syncing orders batch:", error);
        throw error;
      }
    }

    console.log(`✅ Order sync completed. Total synced: ${totalSynced}`);
    return totalSynced;
  }

  /**
   * Sync individual product
   */
  async syncProduct(productData, shopDomain) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const shopifyProductId = parseInt(
        productData.id.replace("gid://shopify/Product/", "")
      );

      // Extract vendor and sync to vendors table
      if (productData.vendor) {
        await this.syncVendor(productData.vendor, shopDomain, client);
      }

      // Get vendor_id if exists
      let vendorId = null;
      if (productData.vendor) {
        const vendorResult = await client.query(
          "SELECT id FROM vendors WHERE shopify_vendor_name = $1 AND shop_domain = $2",
          [productData.vendor, shopDomain]
        );
        vendorId = vendorResult.rows[0]?.id || null;
      }

      // Get first variant data for pricing
      const firstVariant = productData.variants.edges[0]?.node;
      const price = firstVariant?.price || 0;
      const sku = firstVariant?.sku || null;
      const inventoryQuantity = firstVariant?.inventoryQuantity || 0;

      // Upsert product
      await client.query(
        `
        INSERT INTO products (
          shopify_product_id, name, sku, vendor_name, vendor_id, handle, 
          product_type, status, inventory_quantity, price, shop_domain,
          shopify_created_at, shopify_updated_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
        ON CONFLICT (shopify_product_id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          sku = EXCLUDED.sku,
          vendor_name = EXCLUDED.vendor_name,
          vendor_id = EXCLUDED.vendor_id,
          handle = EXCLUDED.handle,
          product_type = EXCLUDED.product_type,
          status = EXCLUDED.status,
          inventory_quantity = EXCLUDED.inventory_quantity,
          price = EXCLUDED.price,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          updated_at = NOW()
      `,
        [
          shopifyProductId,
          productData.title,
          sku,
          productData.vendor || null,
          vendorId,
          productData.handle,
          productData.productType,
          productData.status?.toLowerCase() || "active",
          inventoryQuantity,
          price,
          shopDomain,
          productData.createdAt,
          productData.updatedAt,
        ]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error syncing product:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync individual order
   */
  async syncOrderMinimal(orderData, shopDomain) {
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const shopifyOrderId = parseInt(
        orderData.id.replace("gid://shopify/Order/", "")
      );
      const totalPrice = parseFloat(
        orderData.totalPriceSet?.shopMoney?.amount || 0
      );

      // Upsert order with business data
      const orderResult = await db.query(
        `
        INSERT INTO orders (
          shopify_order_id, shopify_order_number, total_price, 
          financial_status, fulfillment_status, shop_domain,
          shopify_created_at, shopify_updated_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (shopify_order_id) 
        DO UPDATE SET 
          total_price = EXCLUDED.total_price,
          financial_status = EXCLUDED.financial_status,
          fulfillment_status = EXCLUDED.fulfillment_status,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          updated_at = NOW()
        RETURNING id
      `,
        [
          shopifyOrderId,
          orderData.name,
          totalPrice,
          orderData.displayFinancialStatus?.toLowerCase(),
          orderData.displayFulfillmentStatus?.toLowerCase(),
          shopDomain,
          orderData.createdAt,
          orderData.updatedAt,
        ]
      );

      const orderId = orderResult.rows[0].id;

      // Sync line items (this is what we actually need for vendor notifications)
      for (const lineItemEdge of orderData.lineItems.edges) {
        await this.syncOrderLineItem(lineItemEdge.node, orderId, client);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error syncing order:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Sync order line item (the important data for vendor notifications)
   */
  async syncOrderLineItem(lineItemData, orderId, client) {
    const shopifyLineItemId = parseInt(
      lineItemData.id.replace("gid://shopify/LineItem/", "")
    );
    const shopifyProductId = lineItemData.product?.id
      ? parseInt(lineItemData.product.id.replace("gid://shopify/Product/", ""))
      : null;
    const shopifyVariantId = lineItemData.variant?.id
      ? parseInt(
          lineItemData.variant.id.replace("gid://shopify/ProductVariant/", "")
        )
      : null;

    const price = parseFloat(
      lineItemData.originalUnitPriceSet?.shopMoney?.amount || 0
    );
    const totalDiscount = parseFloat(
      lineItemData.totalDiscountSet?.shopMoney?.amount || 0
    );

    // Get product_id from our database
    let productId = null;
    if (shopifyProductId) {
      const productResult = await client.query(
        "SELECT id FROM products WHERE shopify_product_id = $1",
        [shopifyProductId]
      );
      productId = productResult.rows[0]?.id || null;
    }

    await client.query(
      `
      INSERT INTO order_line_items (
        order_id, shopify_line_item_id, product_id, shopify_product_id,
        shopify_variant_id, title, vendor, quantity, price, total_discount
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (shopify_line_item_id) 
      DO UPDATE SET 
        product_id = EXCLUDED.product_id,
        title = EXCLUDED.title,
        vendor = EXCLUDED.vendor,
        quantity = EXCLUDED.quantity,
        price = EXCLUDED.price,
        total_discount = EXCLUDED.total_discount
    `,
      [
        orderId,
        shopifyLineItemId,
        productId,
        shopifyProductId,
        shopifyVariantId,
        lineItemData.title,
        lineItemData.vendor,
        lineItemData.quantity,
        price,
        totalDiscount,
      ]
    );
  }

  /**
   * Sync vendor
   */
  async syncVendor(vendorName, shopDomain, client = null) {
    const shouldReleaseClient = !client;
    if (!client) {
      client = await db.getClient();
    }

    try {
      if (shouldReleaseClient) await client.query("BEGIN");

      await client.query(
        `
        INSERT INTO vendors (shopify_vendor_name, name, shop_domain)
        VALUES ($1, $2, $3)
        ON CONFLICT (shopify_vendor_name, shop_domain) 
        DO UPDATE SET updated_at = NOW()
      `,
        [vendorName, vendorName, shopDomain]
      );

      if (shouldReleaseClient) await client.query("COMMIT");
    } catch (error) {
      if (shouldReleaseClient) await client.query("ROLLBACK");
      throw error;
    } finally {
      if (shouldReleaseClient) client.release();
    }
  }

  /**
   * Handle webhook data sync
   */
  async handleWebhookSync(webhookData, shopDomain, topic) {
    console.log(`🔄 Processing webhook: ${topic} for shop: ${shopDomain}`);

    try {
      switch (topic) {
        case "products/create":
        case "products/update":
          await this.syncProductFromWebhook(webhookData, shopDomain);
          break;
        case "products/delete":
          await this.deleteProduct(webhookData.id, shopDomain);
          break;
        case "orders/create":
        case "orders/updated":
        case "orders/paid":
        case "orders/cancelled":
        case "orders/fulfilled":
          await this.syncOrderFromWebhook(webhookData, shopDomain);
          break;
        default:
          console.log(`⚠️ Unhandled webhook topic: ${topic}`);
      }

      console.log(`✅ Webhook processed: ${topic}`);
    } catch (error) {
      console.error(`❌ Webhook processing failed for ${topic}:`, error);
      throw error;
    }
  }

  /**
   * Sync product from webhook data
   */
  async syncProductFromWebhook(productData, shopDomain) {
    // Transform webhook data to match our sync format
    const transformedData = {
      id: `gid://shopify/Product/${productData.id}`,
      title: productData.title,
      handle: productData.handle,
      vendor: productData.vendor,
      productType: productData.product_type,
      status: productData.status,
      createdAt: productData.created_at,
      updatedAt: productData.updated_at,
      variants: {
        edges: productData.variants.map((variant) => ({
          node: {
            id: variant.id,
            sku: variant.sku,
            price: variant.price,
            inventoryQuantity: variant.inventory_quantity,
          },
        })),
      },
    };

    await this.syncProduct(transformedData, shopDomain);
  }

  /**
   * Sync order from webhook data
   */
  async syncOrderFromWebhook(orderData, shopDomain) {
    // Transform webhook data to match our sync format
    const transformedData = {
      id: `gid://shopify/Order/${orderData.id}`,
      name: orderData.name,
      totalPriceSet: {
        shopMoney: {
          amount: orderData.total_price,
        },
      },
      displayFinancialStatus: orderData.financial_status,
      displayFulfillmentStatus: orderData.fulfillment_status,
      lineItems: {
        edges: orderData.line_items.map((item) => ({
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
      createdAt: orderData.created_at,
      updatedAt: orderData.updated_at,
    };

    await this.syncOrderMinimal(transformedData, shopDomain);
  }

  /**
   * Delete product
   */
  async deleteProduct(productId, shopDomain) {
    await db.query(
      "UPDATE products SET status = $1, updated_at = NOW() WHERE shopify_product_id = $2 AND shop_domain = $3",
      ["deleted", productId, shopDomain]
    );
  }

  /**
   * Logging functions
   */
  async logSyncStart(shopDomain, syncType, entityType) {
    await db.query(
      `
      INSERT INTO sync_logs (shop_domain, sync_type, entity_type, status, started_at)
      VALUES ($1, $2, $3, 'running', NOW())
    `,
      [shopDomain, syncType, entityType]
    );
  }

  async logSyncComplete(
    shopDomain,
    syncType,
    entityType,
    status,
    errorMessage = null
  ) {
    await db.query(
      `
      UPDATE sync_logs 
      SET status = $4, completed_at = NOW(), error_message = $5
      WHERE shop_domain = $1 AND sync_type = $2 AND entity_type = $3 
      AND completed_at IS NULL
    `,
      [shopDomain, syncType, entityType, status, errorMessage]
    );
  }
}

export default new DataSyncService();
