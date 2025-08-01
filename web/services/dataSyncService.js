// web/services/dataSyncService.js - Updated for Order-Based Products Only
import shopify from "../shopify.js";
import db from "../db.js";
import { generateToken } from "../utils/jwt.js";
class DataSyncService {
  constructor() {
    this.BATCH_SIZE = 50;
  }

  /**
   * Handles shop authentication and initial user/shop setup.
   */
  async handleShopAuthentication(session) {
    console.log("✅ OAuth Callback - Shop authenticated:", session.shop);

    try {
      const graphqlClient = new shopify.api.clients.Graphql({ session });
      const shopDataRes = await graphqlClient.query({
        data: {
          query: `
            {
              shop {
                id
                name
                email
                shopOwnerName
                myshopifyDomain
                currencyCode
              }
            }
          `,
        },
      });

      const shopData = shopDataRes.body.data.shop;
      const client = await db.getClient();
      await client.query("BEGIN");

      // Random gradient color
      function getRandomGradient() {
        const gradients = [
          "linear-gradient(135deg, #74b9ff, #0984e3)",
          "linear-gradient(135deg, #ff6b6b, #ee5a24)",
          "linear-gradient(135deg, #fd79a8, #e84393)",
          "linear-gradient(135deg, #55a3ff, #3742fa)",
          "linear-gradient(135deg, #fd7474, #ff3838)",
          "linear-gradient(135deg, #00b894, #00a085)",
        ];
        return gradients[Math.floor(Math.random() * gradients.length)];
      }

      // Check if user (store_owner) already exists
      const existingUser = await client.query(
        "SELECT id FROM users WHERE email = $1 AND user_type = 'store_owner'",
        [session.shop]
      );

      if (existingUser.rows.length === 0) {
        // Insert new store_owner
        const newUser = await client.query(
          `INSERT INTO users 
          (username, email, user_type, notify_mode, notify_value, shop_domain, color, is_verified, is_active)
          VALUES ($1, $2, 'store_owner', 'specific_time', '8 AM', $3, $4, true, true)
          RETURNING id`,
          [
            shopData.shopOwnerName || shopData.name,
            session.shop,
            session.shop,
            getRandomGradient(),
          ]
        );
        const userId = newUser.rows[0].id;

        // Generate token (for by pass email)
        const token = generateToken(userId, session.shop, "store_owner");

        // Update user as verified (for by pass email)
        await client.query(
          `UPDATE users 
          SET access_token = $2 
          WHERE id = $1`,
          [userId, token]
        );

        console.log("🆕 New store_owner user created:", shopData.email);
        console.log("🚀 Starting initial data sync for:", session.shop);

        // 🔁 Fetch products and store vendors (before order sync)
        const productVendorQuery = `
            query GetVendors($first: Int!, $after: String) {
              products(first: $first, after: $after) {
                edges {
                  node {
                    vendor
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }`;

        const seenVendors = new Set();
        let vendorCursor = null;
        let hasNextProductPage = true;

        console.log(`🔍 Fetching product vendors for: ${session.shop}`);

        while (hasNextProductPage) {
          try {
            const productRes = await graphqlClient.query({
              data: {
                query: productVendorQuery,
                variables: { first: this.BATCH_SIZE, after: vendorCursor },
              },
            });

            const products = productRes.body.data.products.edges;

            for (const edge of products) {
              const vendorName = edge.node.vendor?.trim();
              if (vendorName && !seenVendors.has(vendorName)) {
                seenVendors.add(vendorName);
                await client.query(
                  `
                  INSERT INTO vendors (name, contact_person, mobile, shop_domain)
                  VALUES ($1, '', '', $2)
                  ON CONFLICT (name, shop_domain) DO NOTHING
                `,
                  [vendorName, session.shop]
                );
              }
            }

            hasNextProductPage =
              productRes.body.data.products.pageInfo.hasNextPage;
            vendorCursor =
              products.length > 0 ? products[products.length - 1].cursor : null;
          } catch (error) {
            console.error("❌ Error fetching vendors from products:", error);
            break; // Optionally stop pagination if error occurs
          }
        }

        console.log(
          `✅ Stored ${seenVendors.size} unique vendors from product list for ${session.shop}`
        );

        // Run initial sync in background (don't wait for completion)
        this.performInitialSync(session).catch((error) => {
          console.error("❌ Initial sync failed:", error);
        });
      }

      await client.query("COMMIT");
      client.release();
    } catch (error) {
      console.error("❌ Error in OAuth callback during shop setup:", error);
      throw error; // Re-throw to ensure the original error is propagated
    }
  }

  /**
   * Perform initial sync - ONLY orders (which will create products as needed)
   */
  async performInitialSync(session) {
    const shopDomain = session.shop;
    console.log(`🔄 Starting initial sync for shop: ${shopDomain}`);

    try {
      await this.logSyncStart(shopDomain, "initial", "orders_and_products");

      // Check if already completed
      const shop = await db.query(
        "SELECT initial_sync_completed FROM users WHERE shop_domain = $1",
        [shopDomain]
      );

      if (shop.rows[0]?.initial_sync_completed) {
        console.log(`✅ Initial sync already completed for ${shopDomain}`);
        return;
      }

      // Sync orders only - this will automatically create products and vendors
      await this.syncAllOrders(session);

      // Mark initial sync as completed
      await db.query(
        "UPDATE users SET initial_sync_completed = TRUE, updated_at = NOW() WHERE shop_domain = $1",
        [shopDomain]
      );

      await this.logSyncComplete(
        shopDomain,
        "initial",
        "orders_and_products",
        "success"
      );
      console.log(`✅ Initial sync completed for shop: ${shopDomain}`);
    } catch (error) {
      console.error(`❌ Initial sync failed for ${shopDomain}:`, error);
      await this.logSyncComplete(
        shopDomain,
        "initial",
        "orders_and_products",
        "error",
        error.message
      );
      throw error;
    }
  }

  /**
   * Sync all orders and create products/vendors as needed
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
                  cancelledAt
                  lineItems(first: 100) {
                    edges {
                      node {
                        id
                        title
                        vendor
                        quantity
                        image {
                          url
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
          await this.syncOrderWithProducts(edge.node, shopDomain);
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
   * Sync individual order and create products/vendors as needed
   */
  async syncOrderWithProducts(orderData, shopDomain) {
    console.log("✌️orderData --->", orderData);
    const client = await db.getClient();

    try {
      await client.query("BEGIN");

      const shopifyOrderId = parseInt(
        orderData.id.replace("gid://shopify/Order/", "")
      );

      // Insert/Update Order
      const orderResult = await client.query(
        `
        INSERT INTO orders (
          shopify_order_id, name, shop_domain,
          shopify_created_at, shopify_updated_at, updated_at, cancelled_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        ON CONFLICT (shopify_order_id) 
        DO UPDATE SET 
          name = EXCLUDED.name,
          shopify_updated_at = EXCLUDED.shopify_updated_at,
          updated_at = NOW(),
          cancelled_at = EXCLUDED.cancelled_at
        RETURNING id
      `,
        [
          shopifyOrderId,
          orderData.name,
          shopDomain,
          orderData.createdAt,
          orderData.updatedAt,
          orderData.cancelledAt || null,
        ]
      );      

      const orderId = orderResult.rows[0].id;

      // Process line items and create products/vendors as needed
      for (const lineItemEdge of orderData.lineItems.edges) {
        const lineItem = lineItemEdge.node;

        // Skip if no product data
        if (!lineItem.product?.id) continue;

        const shopifyProductId = parseInt(
          lineItem.product.id.replace("gid://shopify/Product/", "")
        );

        // Create/Update Vendor if exists
        let vendorId = null;
        if (lineItem.vendor) {
          vendorId = await this.ensureVendorExists(
            lineItem.vendor,
            shopDomain,
            client
          );
        }

        // Create/Update Product (no duplicates)
        const productId = await this.ensureProductExists(
          {
            shopifyProductId,
            title: lineItem.title,
            image: lineItem.image?.url,
            vendorName: lineItem.vendor,
            vendorId,
            shopDomain,
          },
          client
        );

        // Create Line Item
        await client.query(
          `
          INSERT INTO order_line_items (
            order_id, product_id, quantity, shop_domain
          ) VALUES ($1, $2, $3, $4)
        `,
          [orderId, productId, lineItem.quantity, shopDomain]
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error syncing order with products:", error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Ensure vendor exists (create if not exists)
   */
  async ensureVendorExists(vendorName, shopDomain, client) {
    // Check if vendor exists
    const existingVendor = await client.query(
      "SELECT id FROM vendors WHERE name = $1 AND shop_domain = $2",
      [vendorName, shopDomain]
    );

    if (existingVendor.rows.length > 0) {
      return existingVendor.rows[0].id;
    }

    // Create new vendor
    const newVendor = await client.query(
      `
      INSERT INTO vendors (name, shop_domain)
      VALUES ($1, $2)
      RETURNING id
    `,
      [vendorName, shopDomain]
    );

    return newVendor.rows[0].id;
  }

  /**
   * Ensure product exists (create if not exists, no duplicates)
   */
  async ensureProductExists(productData, client) {
    // Check if product exists
    const existingProduct = await client.query(
      "SELECT id FROM products WHERE shopify_product_id = $1",
      [productData.shopifyProductId]
    );

    if (existingProduct.rows.length > 0) {
      // Update existing product
      await client.query(
        `
        UPDATE products 
        SET title = $2, image = $3, vendor_name = $4, vendor_id = $5, updated_at = NOW()
        WHERE shopify_product_id = $1
      `,
        [
          productData.shopifyProductId,
          productData.title,
          productData.image,
          productData.vendorName,
          productData.vendorId,
        ]
      );
      return existingProduct.rows[0].id;
    }

    // Create new product
    const newProduct = await client.query(
      `
      INSERT INTO products (
        shopify_product_id, title, image, vendor_name, vendor_id, shop_domain
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `,
      [
        productData.shopifyProductId,
        productData.title,
        productData.image,
        productData.vendorName,
        productData.vendorId,
        productData.shopDomain,
      ]
    );

    return newProduct.rows[0].id;
  }

  /**
   * Handle webhook data sync
   */
  async handleWebhookSync(webhookData, shopDomain, topic) {
    console.log(`🔄 Processing webhook: ${topic} for shop: ${shopDomain}`);

    try {
      switch (topic) {
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
   * Sync order from webhook data
   */
  async syncOrderFromWebhook(orderData, shopDomain) {
    // Transform webhook data to match our sync format
    const transformedData = {
      id: `gid://shopify/Order/${orderData.id}`,
      name: orderData.name,
      cancelledAt: orderData.cancelled_at || null,
      lineItems: {
        edges: orderData.line_items.map((item) => ({
          node: {
            id: item.id ? `gid://shopify/LineItem/${item.id}` : null,
            title: item.title,
            vendor: item.vendor,
            quantity: item.quantity,
            image: item.image || null,
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

    await this.syncOrderWithProducts(transformedData, shopDomain);
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
