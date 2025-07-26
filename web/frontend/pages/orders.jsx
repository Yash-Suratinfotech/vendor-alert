import {
  Page,
  Layout,
  Card,
  DataTable,
  Badge,
  Text,
  EmptyState,
  Spinner,
  Filters,
  Select,
  Button,
  Pagination,
  Modal,
  List,
  BlockStack,
  InlineStack,
  Frame,
  Banner,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useState, useCallback } from "react";
import { useQuery } from "react-query";
import { ViewIcon } from "@shopify/polaris-icons";

export default function OrdersPage() {
  const [vendorFilter, setVendorFilter] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isOrderModalOpen, setIsOrderModalOpen] = useState(false);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const itemsPerPage = 25;

  // Fetch orders data with enhanced debugging
  const {
    data: ordersData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["orders", vendorFilter, currentPage],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage,
        limit: itemsPerPage,
        ...(vendorFilter && { vendor: vendorFilter }),
      });

      console.log("🔍 Fetching orders with params:", params.toString());

      const response = await fetch(`/api/orders?${params}`);
      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ Orders API error:", response.status, errorText);
        throw new Error(`Failed to fetch orders: ${response.status}`);
      }

      const data = await response.json();
      return data;
    },
    refetchOnWindowFocus: false,
    keepPreviousData: true,
    onError: (error) => {
      console.error("❌ Orders query error:", error);
    },
  });

  // Fetch vendors for filter dropdown
  const { data: vendorsData } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const response = await fetch("/api/vendor/list");
      return await response.json();
    },
    refetchOnWindowFocus: false,
  });

  const handleVendorFilterChange = useCallback((value) => {
    setVendorFilter(value);
    setCurrentPage(1);
  }, []);

  const handleFiltersRemove = useCallback(() => {
    setVendorFilter("");
    setCurrentPage(1);
  }, []);

  const handleViewOrder = useCallback((order) => {
    setSelectedOrder(order);
    setIsOrderModalOpen(true);
  }, []);

  // Enhanced table data preparation
  const tableData =
    ordersData?.orders?.map((order) => [
      <Text variant="bodyMd" fontWeight="semibold">
        {order.name}
      </Text>,
      order.notified ? (
        <Badge tone="success">Notified</Badge>
      ) : (
        <Badge tone="warning">Pending</Badge>
      ),
      new Date(
        order.shopify_created_at || order.createdAt
      ).toLocaleDateString(),
      <Button
        size="slim"
        icon={ViewIcon}
        onClick={() => handleViewOrder(order)}
      >
        View
      </Button>,
    ]) || [];

  const tableHeaders = ["Order Number", "Notification", "Date", "Actions"];

  // Filter options
  const vendorOptions = [
    { label: "All vendors", value: "" },
    ...(vendorsData?.vendors?.map((vendor) => ({
      label: vendor.name,
      value: vendor.shopifyVendorName || vendor.name,
    })) || []),
  ];

  const appliedFilters = [];
  if (vendorFilter)
    appliedFilters.push({
      key: "vendor",
      label: `Vendor: ${vendorFilter}`,
      onRemove: () => setVendorFilter(""),
    });

  const filters = (
    <Filters
      filters={[
        {
          key: "vendor",
          label: "Vendor",
          filter: (
            <Select
              label="Vendor"
              labelHidden
              options={vendorOptions}
              value={vendorFilter}
              onChange={handleVendorFilterChange}
            />
          ),
        },
      ]}
      appliedFilters={appliedFilters}
      onClearAll={handleFiltersRemove}
    />
  );

  // Debug info for investigating single order issue
  const debugInfo = ordersData && (
    <Banner
      title="Debug Information"
      tone="info"
      onDismiss={() => setShowDebugInfo(false)}
    >
      <BlockStack gap="200">
        <Text>
          <strong>Total Orders in Database:</strong>{" "}
          {ordersData.pagination?.total || 0}
        </Text>
        <Text>
          <strong>Orders Returned:</strong> {ordersData.orders?.length || 0}
        </Text>
        <Text>
          <strong>Current Page:</strong> {currentPage}
        </Text>
        <Text>
          <strong>Items Per Page:</strong> {itemsPerPage}
        </Text>
        <Text>
          <strong>Applied Filters:</strong>{" "}
          {appliedFilters.length > 0
            ? appliedFilters.map((f) => f.label).join(", ")
            : "None"}
        </Text>
      </BlockStack>
    </Banner>
  );

  if (error) {
    return (
      <Frame>
        <Page fullWidth>
          <TitleBar title="Orders" />
          <Layout>
            <Layout.Section>
              <Card>
                <EmptyState
                  heading="Error loading orders"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    There was an error loading the orders data: {error.message}
                  </p>
                  <InlineStack gap="300">
                    <Button onClick={() => refetch()}>Try again</Button>
                    <Button onClick={() => setShowDebugInfo(true)}>
                      Show Debug Info
                    </Button>
                  </InlineStack>
                </EmptyState>
              </Card>
            </Layout.Section>
          </Layout>
        </Page>
      </Frame>
    );
  }

  return (
    <Frame>
      <Page fullWidth>
        <TitleBar title="Orders">
          <button variant="primary" onClick={() => refetch()}>
            Refresh
          </button>
        </TitleBar>
        <Layout>
          <Layout.Section>
            {showDebugInfo && debugInfo}

            <Card>
              <div style={{ marginBottom: "1rem" }}>{filters}</div>

              {isLoading ? (
                <div style={{ textAlign: "center", padding: "2rem" }}>
                  <Spinner size="large" />
                  <Text variant="bodyMd" tone="subdued">
                    Loading orders...
                  </Text>
                </div>
              ) : tableData.length === 0 ? (
                <EmptyState
                  heading="No orders found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    {appliedFilters.length > 0
                      ? "Try adjusting your filter criteria or check if orders exist in your store."
                      : "No orders have been synced yet. Orders will appear automatically when they are created in your store."}
                  </p>
                  <InlineStack gap="300">
                    {appliedFilters.length > 0 && (
                      <Button onClick={handleFiltersRemove}>
                        Clear Filters
                      </Button>
                    )}
                    <Button
                      primary
                      onClick={() => (window.location.href = "/debug")}
                    >
                      Sync Data
                    </Button>
                  </InlineStack>
                </EmptyState>
              ) : (
                <>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "text"]}
                    headings={tableHeaders}
                    rows={tableData}
                    hoverable
                  />

                  {ordersData?.pagination && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "1rem",
                        padding: "1rem 0",
                      }}
                    >
                      <Text variant="bodySm" tone="subdued">
                        Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
                        {Math.min(
                          currentPage * itemsPerPage,
                          ordersData.pagination.total
                        )}{" "}
                        of {ordersData.pagination.total} orders
                      </Text>

                      <Pagination
                        hasPrevious={currentPage > 1}
                        onPrevious={() => setCurrentPage(currentPage - 1)}
                        hasNext={currentPage < ordersData.pagination.totalPages}
                        onNext={() => setCurrentPage(currentPage + 1)}
                      />
                    </div>
                  )}
                </>
              )}
            </Card>
          </Layout.Section>

          {/* Order Stats Summary */}
          {ordersData?.orders && ordersData.orders.length > 0 && (
            <Layout.Section variant="oneThird">
              <Card>
                <BlockStack gap="400">
                  <Text variant="headingMd">Order Summary</Text>
                  <div>
                    <Text variant="headingLg" as="h3">
                      {ordersData.orders.filter((o) => o.notified).length}
                    </Text>
                    <Text variant="bodySm" tone="subdued">
                      Vendors Notified
                    </Text>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}
        </Layout>

        {/* Order Details Modal */}
        <Modal
          large
          open={isOrderModalOpen}
          onClose={() => {
            setIsOrderModalOpen(false);
            setSelectedOrder(null);
          }}
          title={`Order ${selectedOrder?.name}`}
          secondaryActions={[
            {
              content: "Close",
              onAction: () => {
                setIsOrderModalOpen(false);
                setSelectedOrder(null);
              },
            },
          ]}
        >
          <Modal.Section>
            {selectedOrder ? (
              <Layout>
                <Layout.Section oneHalf>
                  <Card title="Order Information">
                    <BlockStack gap="300">
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Order ID:
                        </Text>
                        <Text>{selectedOrder.name}</Text>
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Notification:
                        </Text>
                        {selectedOrder.notified ? (
                          <Badge tone="success">Vendors Notified</Badge>
                        ) : (
                          <Badge tone="warning">Pending</Badge>
                        )}
                      </InlineStack>
                      <InlineStack align="space-between">
                        <Text variant="bodyMd" fontWeight="medium">
                          Date:
                        </Text>
                        <Text>
                          {new Date(
                            selectedOrder.shopify_created_at ||
                              selectedOrder.createdAt
                          ).toLocaleString()}
                        </Text>
                      </InlineStack>
                    </BlockStack>
                  </Card>
                </Layout.Section>
                <Layout.Section oneHalf>
                  <Card title="Line Items">
                    {selectedOrder.lineItems &&
                    selectedOrder.lineItems.length > 0 ? (
                      <List type="bullet">
                        {selectedOrder.lineItems.map((item, index) => (
                          <List.Item key={index}>
                            <BlockStack gap="200">
                              <Text variant="bodyMd" fontWeight="medium">
                                {item.title}
                              </Text>
                              <InlineStack gap="400">
                                <Text variant="bodySm" tone="subdued">
                                  Vendor: {item.vendor || "—"}
                                </Text>
                                <Text variant="bodySm" tone="subdued">
                                  Qty: {item.quantity}
                                </Text>
                                <Text variant="bodySm" tone="subdued">
                                  Notification:{"  "}
                                  {item.notification ? (
                                    <Badge tone="success">
                                      Vendors Notified
                                    </Badge>
                                  ) : (
                                    <Badge tone="warning">Pending</Badge>
                                  )}
                                </Text>
                              </InlineStack>
                            </BlockStack>
                          </List.Item>
                        ))}
                      </List>
                    ) : (
                      <Text tone="subdued">No line items found</Text>
                    )}
                  </Card>
                </Layout.Section>
              </Layout>
            ) : (
              <EmptyState
                heading="No order selected"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>Select an order from the table to view its details.</p>
              </EmptyState>
            )}
          </Modal.Section>
        </Modal>
      </Page>
    </Frame>
  );
}
