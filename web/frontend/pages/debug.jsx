import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  BlockStack,
  Badge,
  Banner,
  Spinner,
  List,
  Divider,
  ButtonGroup,
  Icon,
  InlineStack,
  Frame,
  Toast,
  DataTable,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import {
  RefreshIcon,
  CheckIcon,
  DatabaseIcon,
  BugIcon,
} from "@shopify/polaris-icons";

export default function DebugPage() {
  const queryClient = useQueryClient();
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  // Fetch webhook health
  const {
    data: webhookHealth,
    isLoading: isLoadingWebhooks,
    refetch: refetchWebhooks,
  } = useQuery({
    queryKey: ["webhook-health"],
    queryFn: async () => {
      const response = await fetch("/api/webhooks/health");
      if (!response.ok) {
        throw new Error("Failed to fetch webhook health");
      }
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  // Fetch database debug info
  const {
    data: dbDebugInfo,
    isLoading: isLoadingDbDebug,
    refetch: refetchDbDebug,
  } = useQuery({
    queryKey: ["db-debug"],
    queryFn: async () => {
      const response = await fetch("/api/orders/debug/database");
      if (!response.ok) {
        throw new Error("Failed to fetch database debug info");
      }
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async (type) => {
      const response = await fetch(`/api/webhooks/manual-sync/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to start ${type} sync: ${errorText}`);
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      // Refresh all data after sync
      queryClient.invalidateQueries(["products"]);
      queryClient.invalidateQueries(["vendors"]);
      queryClient.invalidateQueries(["orders"]);
      queryClient.invalidateQueries(["db-debug"]);

      setToastMessage(`${variables} sync completed successfully!`);
      setToastError(false);
      setShowToast(true);
    },
    onError: (error, variables) => {
      console.error("Sync error:", error);
      setToastMessage(`${variables} sync failed: ${error.message}`);
      setToastError(true);
      setShowToast(true);
    },
  });

  const showToastMessage = (message, isError = false) => {
    setToastMessage(message);
    setToastError(isError);
    setShowToast(true);
  };

  const getDatabaseStatsTable = () => {
    if (!dbDebugInfo?.stats) return null;

    const stats = dbDebugInfo.stats;
    const tableData = [
      ["Total Orders", stats.total_orders || "0"],
      ["Paid Orders", stats.paid_orders || "0"],
      ["Fulfilled Orders", stats.fulfilled_orders || "0"],
      ["Notified Orders", stats.notified_orders || "0"],
      ["Total Line Items", stats.total_line_items || "0"],
      ["Unique Vendors in Orders", stats.unique_vendors_in_orders || "0"],
      [
        "Oldest Order",
        stats.oldest_order
          ? new Date(stats.oldest_order).toLocaleDateString()
          : "None",
      ],
      [
        "Newest Order",
        stats.newest_order
          ? new Date(stats.newest_order).toLocaleDateString()
          : "None",
      ],
    ];

    return (
      <DataTable
        columnContentTypes={["text", "text"]}
        headings={["Metric", "Value"]}
        rows={tableData}
      />
    );
  };

  const getSampleOrdersTable = () => {
    if (!dbDebugInfo?.sampleOrders?.length) return null;

    const tableData = dbDebugInfo.sampleOrders.map((order) => [
      order.shopify_order_number || `#${order.shopify_order_id}`,
      `${parseFloat(order.total_price || 0).toFixed(2)}`,
      order.financial_status || "—",
      order.fulfillment_status || "—",
      new Date(order.shopify_created_at).toLocaleDateString(),
    ]);

    return (
      <DataTable
        columnContentTypes={["text", "numeric", "text", "text", "text"]}
        headings={["Order", "Total", "Payment", "Fulfillment", "Date"]}
        rows={tableData}
      />
    );
  };

  const toastMarkup = showToast ? (
    <Toast
      content={toastMessage}
      error={toastError}
      onDismiss={() => setShowToast(false)}
    />
  ) : null;

  return (
    <Frame>
      <Page fullWidth>
        <TitleBar title="Debug & Sync" />
        <Layout>
          <Layout.Section>
            {/* Manual Sync Controls */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg">Manual Sync Controls</Text>

                <Banner tone="info">
                  <p>
                    Use these controls to manually sync data from Shopify. This
                    is useful for testing or if automatic sync fails.
                  </p>
                </Banner>

                <BlockStack gap="400">
                  <Text variant="headingMd">Sync Options</Text>

                  <InlineStack gap="400" align="start">
                    <Card background="bg-surface-secondary" padding="400">
                      <BlockStack gap="300" align="center">
                        <Icon source={DatabaseIcon} />
                        <Text
                          variant="bodyMd"
                          fontWeight="medium"
                          alignment="center"
                        >
                          Products Sync
                        </Text>
                        <Text
                          variant="bodySm"
                          tone="subdued"
                          alignment="center"
                        >
                          Sync all products and extract vendor information
                        </Text>
                        <Button
                          loading={syncMutation.isLoading}
                          onClick={() => syncMutation.mutate("products")}
                          primary
                        >
                          Sync Products
                        </Button>
                      </BlockStack>
                    </Card>

                    <Card background="bg-surface-secondary" padding="400">
                      <BlockStack gap="300" align="center">
                        <Icon source={DatabaseIcon} />
                        <Text
                          variant="bodyMd"
                          fontWeight="medium"
                          alignment="center"
                        >
                          Orders Sync
                        </Text>
                        <Text
                          variant="bodySm"
                          tone="subdued"
                          alignment="center"
                        >
                          Sync all orders with line items (no customer data)
                        </Text>
                        <Button
                          loading={syncMutation.isLoading}
                          onClick={() => syncMutation.mutate("orders")}
                          primary
                        >
                          Sync Orders
                        </Button>
                      </BlockStack>
                    </Card>

                    <Card background="bg-surface-secondary" padding="400">
                      <BlockStack gap="300" align="center">
                        <Icon source={RefreshIcon} />
                        <Text
                          variant="bodyMd"
                          fontWeight="medium"
                          alignment="center"
                        >
                          Full Sync
                        </Text>
                        <Text
                          variant="bodySm"
                          tone="subdued"
                          alignment="center"
                        >
                          Complete resync of all data (products + orders)
                        </Text>
                        <Button
                          loading={syncMutation.isLoading}
                          onClick={() => syncMutation.mutate("full")}
                          primary
                        >
                          Full Sync
                        </Button>
                      </BlockStack>
                    </Card>
                  </InlineStack>
                </BlockStack>

                {syncMutation.isError && (
                  <Banner tone="critical">
                    <p>
                      Sync failed:{" "}
                      {syncMutation.error?.message || "Unknown error occurred"}
                    </p>
                  </Banner>
                )}

                {syncMutation.isSuccess && (
                  <Banner tone="success">
                    <p>Sync completed successfully! Data has been updated.</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            {/* Database Debug Information */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text variant="headingLg">Database Debug Information</Text>
                  <Button
                    icon={RefreshIcon}
                    onClick={() => refetchDbDebug()}
                    loading={isLoadingDbDebug}
                  >
                    Refresh
                  </Button>
                </InlineStack>

                {isLoadingDbDebug ? (
                  <div style={{ textAlign: "center", padding: "2rem" }}>
                    <Spinner size="large" />
                  </div>
                ) : dbDebugInfo ? (
                  <BlockStack gap="400">
                    <Card background="bg-surface-secondary">
                      <BlockStack gap="300">
                        <Text variant="headingMd">Database Statistics</Text>
                        {getDatabaseStatsTable()}
                      </BlockStack>
                    </Card>

                    {dbDebugInfo.sampleOrders?.length > 0 && (
                      <Card background="bg-surface-secondary">
                        <BlockStack gap="300">
                          <Text variant="headingMd">Recent Orders Sample</Text>
                          {getSampleOrdersTable()}
                        </BlockStack>
                      </Card>
                    )}

                    {dbDebugInfo.statusBreakdown?.length > 0 && (
                      <Card background="bg-surface-secondary">
                        <BlockStack gap="300">
                          <Text variant="headingMd">
                            Order Status Breakdown
                          </Text>
                          <List type="bullet">
                            {dbDebugInfo.statusBreakdown.map(
                              (status, index) => (
                                <List.Item key={index}>
                                  <InlineStack gap="200">
                                    <Text fontWeight="medium">
                                      {status.financial_status || "null"} /{" "}
                                      {status.fulfillment_status || "null"}:
                                    </Text>
                                    <Badge>{status.count} orders</Badge>
                                  </InlineStack>
                                </List.Item>
                              )
                            )}
                          </List>
                        </BlockStack>
                      </Card>
                    )}

                    {(!dbDebugInfo.stats?.total_orders ||
                      dbDebugInfo.stats.total_orders === "0") && (
                      <Banner tone="warning">
                        <p>
                          <strong>No orders found in database!</strong> This
                          could mean:
                        </p>
                        <List type="bullet">
                          <List.Item>Orders haven't been synced yet</List.Item>
                          <List.Item>
                            No orders exist in your Shopify store
                          </List.Item>
                          <List.Item>
                            There was an error during the initial sync
                          </List.Item>
                        </List>
                        <p>Try running a manual orders sync above.</p>
                      </Banner>
                    )}
                  </BlockStack>
                ) : (
                  <Banner tone="critical">
                    <p>Failed to load database debug information.</p>
                  </Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            {/* Webhook Status */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingLg">Webhook Configuration</Text>

                {isLoadingWebhooks ? (
                  <div style={{ textAlign: "center", padding: "1rem" }}>
                    <Spinner size="large" />
                  </div>
                ) : (
                  <BlockStack gap="400">
                    <InlineStack align="space-between">
                      <Text variant="bodyMd" fontWeight="medium">
                        Webhook Health:
                      </Text>
                      <InlineStack gap="200">
                        <Badge tone="success" icon={CheckIcon}>
                          {webhookHealth?.status || "Unknown"}
                        </Badge>
                        <Button
                          size="slim"
                          icon={RefreshIcon}
                          onClick={() => refetchWebhooks()}
                        >
                          Check
                        </Button>
                      </InlineStack>
                    </InlineStack>

                    <Divider />

                    <Text variant="headingMd">Configured Webhooks</Text>
                    {webhookHealth?.webhooks && (
                      <List type="bullet">
                        {webhookHealth.webhooks.map((webhook, index) => (
                          <List.Item key={index}>
                            <InlineStack align="space-between">
                              <Text>{webhook}</Text>
                              <Badge tone="info">Active</Badge>
                            </InlineStack>
                          </List.Item>
                        ))}
                      </List>
                    )}

                    <Banner tone="info">
                      <p>
                        Webhooks automatically sync data when changes occur in
                        your Shopify store. If webhooks are not working, use
                        manual sync instead.
                      </p>
                    </Banner>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            {/* Quick Actions */}
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd">Quick Actions</Text>

                <ButtonGroup vertical>
                  <Button onClick={() => (window.location.href = "/products")}>
                    View Products
                  </Button>
                  <Button onClick={() => (window.location.href = "/vendors")}>
                    View Vendors
                  </Button>
                  <Button onClick={() => (window.location.href = "/orders")}>
                    View Orders
                  </Button>
                </ButtonGroup>

                <Divider />

                <BlockStack gap="200">
                  <Text variant="bodyMd" fontWeight="medium">
                    Debug Information
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Last sync check: {webhookHealth?.timestamp || "Unknown"}
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    App status: Running
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Database: Connected
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Shop: {dbDebugInfo?.shopDomain || "Unknown"}
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
