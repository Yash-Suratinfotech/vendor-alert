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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "react-query";
import { RefreshIcon, CheckIcon, DatabaseIcon } from "@shopify/polaris-icons";

export default function DebugPage() {
  const queryClient = useQueryClient();

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
        throw new Error(`Failed to start ${type} sync`);
      }

      return await response.json();
    },
    onSuccess: (data, variables) => {
      // Refresh all data after sync
      queryClient.invalidateQueries(["products"]);
      queryClient.invalidateQueries(["vendors"]);
      queryClient.invalidateQueries(["orders"]);
    },
    onError: (error) => {
      console.error("Sync error:", error);
    },
  });

  const getDataCountBadge = (count, label) => {
    const status = count > 0 ? "success" : "critical";
    return (
      <div style={{ textAlign: "center" }}>
        <Badge status={status}>{count}</Badge>
        <Text variant="bodySm" tone="subdued" alignment="center">
          {label}
        </Text>
      </div>
    );
  };

  return (
    <Page>
      <TitleBar title="Debug & Sync" />
      <Layout>
        <Layout.Section>
          {/* Manual Sync Controls */}
          <Card title="Manual Sync Controls">
            <BlockStack>
              <BlockStack vertical spacing="loose">
                <Banner status="info">
                  <p>
                    Use these controls to manually sync data from Shopify. This
                    is useful for testing or if automatic sync fails.
                  </p>
                </Banner>

                <BlockStack vertical spacing="tight">
                  <Text variant="headingMd">Sync Options</Text>

                  <BlockStack distribution="fillEvenly" spacing="loose">
                    <Card sectioned>
                      <BlockStack vertical alignment="center" spacing="tight">
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
                      </BlockStack>
                    </Card>

                    <Card sectioned>
                      <BlockStack vertical alignment="center" spacing="tight">
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
                          Sync all orders with line items and customer data
                        </Text>
                      </BlockStack>
                    </Card>

                    <Card sectioned>
                      <BlockStack vertical alignment="center" spacing="tight">
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
                      </BlockStack>
                    </Card>
                  </BlockStack>
                </BlockStack>

                {syncMutation.isError && (
                  <Banner status="critical">
                    <p>
                      Sync failed:{" "}
                      {syncMutation.error?.message || "Unknown error occurred"}
                    </p>
                  </Banner>
                )}

                {syncMutation.isSuccess && (
                  <Banner status="success">
                    <p>Sync completed successfully! Data has been updated.</p>
                  </Banner>
                )}
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          {/* Webhook Status */}
          <Card title="Webhook Configuration">
            <BlockStack>
              {isLoadingWebhooks ? (
                <div style={{ textAlign: "center", padding: "1rem" }}>
                  <Spinner size="large" />
                </div>
              ) : (
                <BlockStack vertical spacing="loose">
                  <BlockStack distribution="equalSpacing" alignment="center">
                    <Text variant="bodyMd" fontWeight="medium">
                      Webhook Health:
                    </Text>
                    <Badge status="success" icon={CheckIcon}>
                      {webhookHealth?.status || "Unknown"}
                    </Badge>
                    <Button
                      size="slim"
                      icon={RefreshIcon}
                      onClick={() => refetchWebhooks()}
                    >
                      Check
                    </Button>
                  </BlockStack>

                  <Divider />

                  <Text variant="headingMd">Configured Webhooks</Text>
                  {webhookHealth?.webhooks && (
                    <List type="bullet">
                      {webhookHealth.webhooks.map((webhook, index) => (
                        <List.Item key={index}>
                          <BlockStack
                            distribution="equalSpacing"
                            alignment="center"
                          >
                            <Text>{webhook}</Text>
                            <Badge status="info">Active</Badge>
                          </BlockStack>
                        </List.Item>
                      ))}
                    </List>
                  )}

                  <Banner status="info">
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

        <Layout.Section secondary>
          {/* Quick Actions */}
          <Card title="Quick Actions">
            <BlockStack>
              <BlockStack vertical spacing="loose">
                <ButtonGroup segmented>
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

                <BlockStack vertical spacing="tight">
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
                </BlockStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
