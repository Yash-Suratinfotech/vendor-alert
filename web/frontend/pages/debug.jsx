import {
  Page,
  Layout,
  Card,
  Button,
  Text,
  BlockStack,
  Banner,
  Icon,
  InlineStack,
  Frame,
  Toast,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState } from "react";
import {  useMutation, useQueryClient } from "react-query";
import {
  RefreshIcon,
  DatabaseIcon,
} from "@shopify/polaris-icons";

export default function DebugPage() {
  const queryClient = useQueryClient();
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  // Manual sync mutation
  const syncMutation = useMutation({
    mutationFn: async (type) => {
      const response = await fetch(`/api/settings/manual-sync/${type}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
        </Layout>
      </Page>
      {toastMarkup}
    </Frame>
  );
}
